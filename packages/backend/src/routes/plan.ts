import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { Server } from 'socket.io';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { pendingActionsQueue } from '../services/pendingActionsQueue';

const router = Router();

// Types
interface PendingPlanApproval {
  sessionId: string;
  requestId: string;
  status: 'pending' | 'approved' | 'denied';
  reason?: string;
  createdAt: number;
  planContent?: string;
  planPath?: string;
}

// In-memory storage for pending plan approval requests
// Key: requestId, Value: PendingPlanApproval
const pendingRequests = new Map<string, PendingPlanApproval>();

// Cleanup old requests (older than 3 minutes)
function cleanupOldRequests(): void {
  const maxAge = 3 * 60 * 1000; // 3 minutes
  const now = Date.now();
  for (const [requestId, request] of pendingRequests.entries()) {
    if (now - request.createdAt > maxAge) {
      pendingRequests.delete(requestId);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupOldRequests, 60 * 1000);

// Helper to sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Validation schemas
const planRequestSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().uuid(),
  planContent: z.string().optional(),
  planPath: z.string().optional(),
});

const planRespondSchema = z.object({
  requestId: z.string().min(1), // Accept any string ID (UUID for process manager, nanoid for SDK)
  approved: z.boolean(),
  reason: z.string().optional(),
});

/**
 * POST /api/plan/request
 * Called by the gate-exit-plan-mode-hook script when Claude wants to exit plan mode.
 * Stores the request and emits to frontend via WebSocket.
 * No authentication required (called by local script).
 */
router.post('/request', async (req: Request, res: Response) => {
  const parsed = planRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request data',
    });
  }

  const { sessionId, requestId, planContent, planPath } = parsed.data;

  // Store the pending request
  const pendingRequest: PendingPlanApproval = {
    sessionId,
    requestId,
    status: 'pending',
    createdAt: Date.now(),
    planContent,
    planPath,
  };

  pendingRequests.set(requestId, pendingRequest);

  // Add to queue instead of directly emitting
  pendingActionsQueue.addAction(sessionId, 'plan', requestId, {
    sessionId,
    requestId,
    planContent,
    planPath,
  });

  console.log(`[PLAN] Approval request ${requestId} created for session ${sessionId}`);

  res.json({ success: true, requestId });
});

/**
 * GET /api/plan/response/:requestId
 * Long-polled by the gate-exit-plan-mode-hook script to wait for user response.
 * No authentication required (called by local script).
 */
router.get('/response/:requestId', async (req: Request, res: Response) => {
  const requestId = req.params.requestId;
  if (!requestId) {
    return res.status(400).json({ approved: false, error: 'Missing requestId' });
  }

  const timeout = 120000; // 2 minute timeout
  const startTime = Date.now();

  // Poll until response or timeout
  while (Date.now() - startTime < timeout) {
    const request = pendingRequests.get(requestId);

    if (!request) {
      // Request not found - probably already cleaned up or never existed
      return res.json({
        approved: false,
        error: 'Request not found',
      });
    }

    if (request.status !== 'pending') {
      // User has responded
      const approved = request.status === 'approved';

      // Clean up the request
      pendingRequests.delete(requestId);

      console.log(`[PLAN] Request ${requestId} resolved: ${request.status}`);

      const response: any = {
        approved,
      };

      // Include reason if available (for denial)
      if (!approved && request.reason) {
        response.reason = request.reason;
      }

      return res.json(response);
    }

    // Wait a bit before checking again
    await sleep(100);
  }

  // Timeout - deny by default
  pendingRequests.delete(requestId);

  console.log(`[PLAN] Request ${requestId} timed out`);

  res.json({
    approved: false,
    error: 'Approval timeout. Please try again.',
  });
});

/**
 * POST /api/plan/respond
 * Called by the frontend when user approves or denies a plan exit request.
 * Requires authentication.
 */
router.post('/respond', requireAuth, async (req: Request, res: Response) => {
  const parsed = planRespondSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid request data', 400, 'VALIDATION_ERROR');
  }

  const { requestId, approved, reason } = parsed.data;

  const request = pendingRequests.get(requestId);

  if (!request) {
    // Check if this is a plan approval that came through the permission system
    const permissionsModule = await import('./permissions');
    const permission = permissionsModule.getPendingPermissionById(requestId);

    if (permission && permission.toolName === 'ExitPlanMode') {
      console.log(`[PLAN] Found ExitPlanMode permission request ${requestId}, updating it`);

      // Update the permission request status
      const updated = permissionsModule.updatePermissionStatus(requestId, approved, reason);
      if (!updated) {
        throw new AppError('Failed to update permission status', 500, 'INTERNAL_ERROR');
      }

      // Notify the queue that this action is resolved
      pendingActionsQueue.resolveAction(permission.sessionId, requestId);

      // Broadcast to all clients
      const io: Server = req.app.get('io');
      io.to(`session:${permission.sessionId}`).emit('session:plan_approval_resolved', {
        sessionId: permission.sessionId,
        requestId,
      });

      return res.json({
        success: true,
        approved,
      });
    }

    throw new AppError('Plan approval request not found or expired', 404, 'NOT_FOUND');
  }

  // Update request status
  if (approved) {
    request.status = 'approved';
  } else {
    request.status = 'denied';
    if (reason) {
      request.reason = reason;
    }
  }

  console.log(`[PLAN] User responded to ${requestId}: ${approved ? 'approved' : 'denied'}`);

  // Notify the queue that this action is resolved
  pendingActionsQueue.resolveAction(request.sessionId, requestId);

  // Broadcast to all clients that this request was resolved
  // This dismisses the dialog on other tabs/devices
  const io: Server = req.app.get('io');
  io.to(`session:${request.sessionId}`).emit('session:plan_approval_resolved', {
    sessionId: request.sessionId,
    requestId,
  });

  res.json({
    success: true,
    approved,
  });
});

/**
 * GET /api/plan/pending/:sessionId
 * Get pending plan approval requests for a session.
 * Useful for frontend to check if there are outstanding requests.
 * Requires authentication.
 */
router.get('/pending/:sessionId', requireAuth, (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing sessionId' });
  }

  const pending: PendingPlanApproval[] = [];
  for (const request of pendingRequests.values()) {
    if (request.sessionId === sessionId && request.status === 'pending') {
      pending.push(request);
    }
  }

  res.json({
    success: true,
    data: pending,
  });
});

// Export helper functions for internal use

/**
 * Register a pending plan approval request (used by SDK manager)
 * This allows SDK-based sessions to use the same REST API endpoint as process-manager sessions
 */
export function registerPendingPlanApproval(
  sessionId: string,
  requestId: string,
  planContent?: string,
  planPath?: string
): void {
  const pendingRequest: PendingPlanApproval = {
    sessionId,
    requestId,
    status: 'pending',
    createdAt: Date.now(),
    planContent,
    planPath,
  };
  pendingRequests.set(requestId, pendingRequest);
  console.log(`[PLAN] Registered SDK plan approval request ${requestId} for session ${sessionId}`);
}

export function getPendingPlanApprovalsForSession(sessionId: string): PendingPlanApproval[] {
  const pending: PendingPlanApproval[] = [];
  for (const request of pendingRequests.values()) {
    if (request.sessionId === sessionId && request.status === 'pending') {
      pending.push(request);
    }
  }
  return pending;
}

// Clear all pending plan approvals for a session (used when process is terminated)
export function clearPendingPlanApprovalsForSession(sessionId: string): void {
  const cleared: string[] = [];
  for (const [requestId, request] of pendingRequests.entries()) {
    if (request.sessionId === sessionId) {
      pendingRequests.delete(requestId);
      cleared.push(requestId);
    }
  }
  if (cleared.length > 0) {
    console.log(`[PLAN] Cleared ${cleared.length} pending plan approvals for session ${sessionId}`);
  }
}

// Deny all pending plan approvals for a session (used for /clear and interrupt)
export function denyPendingPlanApprovalsForSession(sessionId: string): void {
  const denied: string[] = [];
  for (const [requestId, request] of pendingRequests.entries()) {
    if (request.sessionId === sessionId && request.status === 'pending') {
      request.status = 'denied';
      request.reason = 'Session interrupted';
      denied.push(requestId);
    }
  }
  if (denied.length > 0) {
    console.log(`[PLAN] Denied ${denied.length} pending plan approvals for session ${sessionId}`);
  }
}

export default router;