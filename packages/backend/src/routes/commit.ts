import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { Server } from 'socket.io';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { pendingActionsQueue } from '../services/pendingActionsQueue';

const router = Router();

// Types
interface PendingCommitApproval {
  sessionId: string;
  requestId: string;
  status: 'pending' | 'approved' | 'denied';
  push?: boolean;
  reason?: string;
  createdAt: number;
  commitMessage: string;
  gitStatus: string;
}

// In-memory storage for pending commit approval requests
// Key: requestId, Value: PendingCommitApproval
const pendingRequests = new Map<string, PendingCommitApproval>();

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
const commitRequestSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().uuid(),
  commitMessage: z.string().min(1),
  gitStatus: z.string(),
});

const commitRespondSchema = z.object({
  requestId: z.string().uuid(),
  approved: z.boolean(),
  push: z.boolean().optional(),
  reason: z.string().optional(),
});

/**
 * POST /api/commit/request
 * Called by the MCP server when Claude wants to create a commit.
 * Stores the request and emits to frontend via WebSocket.
 * No authentication required (called by local script).
 */
router.post('/request', async (req: Request, res: Response) => {
  const parsed = commitRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request data',
    });
  }

  const { sessionId, requestId, commitMessage, gitStatus } = parsed.data;

  // Store the pending request
  const pendingRequest: PendingCommitApproval = {
    sessionId,
    requestId,
    status: 'pending',
    createdAt: Date.now(),
    commitMessage,
    gitStatus,
  };

  pendingRequests.set(requestId, pendingRequest);

  // Add to queue instead of directly emitting
  pendingActionsQueue.addAction(sessionId, 'commit', requestId, {
    sessionId,
    requestId,
    commitMessage,
    gitStatus,
  });

  console.log(`[COMMIT] Approval request ${requestId} created for session ${sessionId}`);

  res.json({ success: true, requestId });
});

/**
 * GET /api/commit/response/:requestId
 * Long-polled by the MCP server to wait for user response.
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

      console.log(`[COMMIT] Request ${requestId} resolved: ${request.status}`);

      const response: any = {
        approved,
      };

      // Include push flag if approved
      if (approved && request.push !== undefined) {
        response.push = request.push;
      }

      // Include reason if denied
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

  console.log(`[COMMIT] Request ${requestId} timed out`);

  res.json({
    approved: false,
    error: 'Approval timeout. Please try again.',
  });
});

/**
 * POST /api/commit/respond
 * Called by the frontend when user approves or denies a commit request.
 * Requires authentication.
 */
router.post('/respond', requireAuth, async (req: Request, res: Response) => {
  const parsed = commitRespondSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid request data', 400, 'VALIDATION_ERROR');
  }

  const { requestId, approved, push, reason } = parsed.data;

  const request = pendingRequests.get(requestId);

  if (!request) {
    throw new AppError('Commit approval request not found or expired', 404, 'NOT_FOUND');
  }

  // Update request status
  if (approved) {
    request.status = 'approved';
    request.push = push || false;
  } else {
    request.status = 'denied';
    if (reason) {
      request.reason = reason;
    }
  }

  console.log(`[COMMIT] User responded to ${requestId}: ${approved ? 'approved' : 'denied'}`);

  // Notify the queue that this action is resolved
  pendingActionsQueue.resolveAction(request.sessionId, requestId);

  // Broadcast to all clients that this request was resolved
  // This dismisses the dialog on other tabs/devices
  const io: Server = req.app.get('io');
  io.to(`session:${request.sessionId}`).emit('session:commit_approval_resolved', {
    sessionId: request.sessionId,
    requestId,
  });

  res.json({
    success: true,
    approved,
  });
});

/**
 * GET /api/commit/pending/:sessionId
 * Get pending commit approval requests for a session.
 * Useful for frontend to check if there are outstanding requests.
 * Requires authentication.
 */
router.get('/pending/:sessionId', requireAuth, (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing sessionId' });
  }

  const pending: PendingCommitApproval[] = [];
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
export function getPendingCommitApprovalsForSession(sessionId: string): PendingCommitApproval[] {
  const pending: PendingCommitApproval[] = [];
  for (const request of pendingRequests.values()) {
    if (request.sessionId === sessionId && request.status === 'pending') {
      pending.push(request);
    }
  }
  return pending;
}

// Clear all pending commit approvals for a session (used when process is terminated)
export function clearPendingCommitApprovalsForSession(sessionId: string): void {
  const cleared: string[] = [];
  for (const [requestId, request] of pendingRequests.entries()) {
    if (request.sessionId === sessionId) {
      pendingRequests.delete(requestId);
      cleared.push(requestId);
    }
  }
  if (cleared.length > 0) {
    console.log(`[COMMIT] Cleared ${cleared.length} pending commit approvals for session ${sessionId}`);
  }
}

// Deny all pending commit approvals for a session (used for /clear and interrupt)
export function denyPendingCommitApprovalsForSession(sessionId: string): void {
  const denied: string[] = [];
  for (const [requestId, request] of pendingRequests.entries()) {
    if (request.sessionId === sessionId && request.status === 'pending') {
      request.status = 'denied';
      request.reason = 'Session interrupted';
      denied.push(requestId);
    }
  }
  if (denied.length > 0) {
    console.log(`[COMMIT] Denied ${denied.length} pending commit approvals for session ${sessionId}`);
  }
}

export default router;