import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { Server } from 'socket.io';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { addPatternToSettings } from './claude-settings';
import { getDatabase } from '../db';
import { pendingActionsQueue } from '../services/pendingActionsQueue';
import { permissionHistory } from '../services/permission-history';

const router = Router();

// Types
interface PendingPermission {
  sessionId: string;
  requestId: string;
  toolName: string;
  toolInput: unknown;
  description: string;
  suggestedPattern: string;
  status: 'pending' | 'approved' | 'denied';
  pattern?: string;
  denialReason?: string;
  createdAt: number;
}

// In-memory storage for pending permission requests
// Key: requestId, Value: PendingPermission
const pendingRequests = new Map<string, PendingPermission>();

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
const permissionRequestSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().uuid(),
  toolName: z.string().min(1),
  toolInput: z.unknown(),
  description: z.string().optional(),
  suggestedPattern: z.string().optional(),
});

const permissionRespondSchema = z.object({
  requestId: z.string().min(1),  // Accept any string ID (UUID for process manager, nanoid for SDK)
  action: z.enum(['allow_once', 'allow_project', 'allow_global', 'deny']),
  pattern: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * POST /api/permissions/request
 * Called by the permission-prompt script when Claude needs permission.
 * Stores the request and emits to frontend via WebSocket.
 * No authentication required (called by local script).
 */
router.post('/request', async (req: Request, res: Response) => {
  const parsed = permissionRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      error: 'Invalid request data',
    });
  }

  const { sessionId, requestId, toolName, toolInput, description, suggestedPattern } = parsed.data;

  // Determine default pattern based on tool type
  const isMcpTool = toolName.startsWith('mcp__');
  const isWebSearch = toolName === 'WebSearch';
  const defaultPattern = isMcpTool || isWebSearch ? toolName : `${toolName}(:*)`;

  // Special handling for ExitPlanMode - convert to plan approval
  if (toolName === 'ExitPlanMode') {
    console.log(`[PERMISSIONS] Intercepting ExitPlanMode permission request, converting to plan approval`);

    // Extract plan content from toolInput if available
    const planContent = typeof toolInput === 'object' && toolInput !== null && 'plan' in toolInput
      ? (toolInput as { plan?: string }).plan
      : undefined;

    // Add to plan approval queue instead of permission queue
    pendingActionsQueue.addAction(sessionId, 'plan', requestId, {
      sessionId,
      requestId,
      planContent,
      planPath: undefined, // We don't have the path from the permission request
    });

    // Store as pending permission so the response endpoint still works
    const pendingRequest: PendingPermission = {
      sessionId,
      requestId,
      toolName,
      toolInput,
      description: 'Plan approval request',
      suggestedPattern: 'ExitPlanMode',
      status: 'pending',
      createdAt: Date.now(),
    };
    pendingRequests.set(requestId, pendingRequest);

    console.log(`[PERMISSIONS] ExitPlanMode request ${requestId} queued as plan approval`);
    return res.json({ success: true, requestId });
  }

  // Special handling for AskUserQuestion - convert to user question
  if (toolName === 'AskUserQuestion') {
    console.log(`[PERMISSIONS] Intercepting AskUserQuestion permission request, converting to user question`);

    // Extract questions from toolInput
    const questions = typeof toolInput === 'object' && toolInput !== null && 'questions' in toolInput
      ? (toolInput as { questions?: any }).questions
      : [];

    // Add to question queue instead of permission queue
    pendingActionsQueue.addAction(sessionId, 'question', requestId, {
      sessionId,
      requestId,
      questions: Array.isArray(questions) ? questions : [],
    });

    // Store as pending permission so the response endpoint still works
    const pendingRequest: PendingPermission = {
      sessionId,
      requestId,
      toolName,
      toolInput,
      description: 'User question request',
      suggestedPattern: 'AskUserQuestion',
      status: 'pending',
      createdAt: Date.now(),
    };
    pendingRequests.set(requestId, pendingRequest);

    console.log(`[PERMISSIONS] AskUserQuestion request ${requestId} queued as user question`);
    return res.json({ success: true, requestId });
  }

  // Store the pending request
  const pendingRequest: PendingPermission = {
    sessionId,
    requestId,
    toolName,
    toolInput,
    description: description || `${toolName} tool`,
    suggestedPattern: suggestedPattern || defaultPattern,
    status: 'pending',
    createdAt: Date.now(),
  };

  pendingRequests.set(requestId, pendingRequest);

  // Add to queue instead of directly emitting
  pendingActionsQueue.addAction(sessionId, 'permission', requestId, {
    sessionId,
    requestId,
    toolName,
    toolInput,
    description: pendingRequest.description,
    suggestedPattern: pendingRequest.suggestedPattern,
  });

  console.log(`[PERMISSIONS] Request ${requestId} created for session ${sessionId}: ${toolName}`);

  res.json({ success: true, requestId });
});

/**
 * GET /api/permissions/response/:requestId
 * Long-polled by the permission-prompt script to wait for user response.
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
      const pattern = request.pattern;

      // Clean up the request
      pendingRequests.delete(requestId);

      console.log(`[PERMISSIONS] Request ${requestId} resolved: ${request.status}, approved=${approved}`);

      const response: any = {
        approved,
        pattern,
      };

      // Include denial reason if available
      if (!approved && request.denialReason) {
        response.error = request.denialReason;
      }

      console.log(`[PERMISSIONS] Returning response: ${JSON.stringify(response)}`);
      return res.json(response);
    }

    // Wait a bit before checking again
    await sleep(100);
  }

  // Timeout - deny by default
  pendingRequests.delete(requestId);

  console.log(`[PERMISSIONS] Request ${requestId} timed out`);

  res.json({
    approved: false,
    error: 'Timeout',
  });
});

/**
 * POST /api/permissions/respond
 * Called by the frontend when user approves or denies a permission request.
 * Requires authentication.
 */
router.post('/respond', requireAuth, async (req: Request, res: Response) => {
  const parsed = permissionRespondSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid request data', 400, 'VALIDATION_ERROR');
  }

  const { requestId, action, pattern, reason } = parsed.data;

  const request = pendingRequests.get(requestId);

  if (!request) {
    // Request not found - might be an SDK session (handled via WebSocket) or expired
    // Return success to avoid crashing - the WebSocket handler handles SDK sessions
    console.log(`[PERMISSIONS] Request ${requestId} not found in pending requests (likely SDK session)`);
    return res.json({ success: true, message: 'Request handled via WebSocket or not found' });
  }

  // Update request status
  if (action === 'deny') {
    request.status = 'denied';
    if (reason) {
      request.denialReason = reason;
    }
  } else {
    request.status = 'approved';
    request.pattern = pattern || request.suggestedPattern;

    // Save pattern if user selected allow_project or allow_global
    if (action === 'allow_project' || action === 'allow_global') {
      try {
        const scope = action === 'allow_global' ? 'global' : 'project';
        let projectPath: string | undefined;

        if (scope === 'project') {
          // Get project path from session
          const db = getDatabase();
          const session = db
            .prepare('SELECT working_directory FROM sessions WHERE id = ?')
            .get(request.sessionId) as { working_directory: string } | undefined;
          projectPath = session?.working_directory;
        }

        await addPatternToSettings(request.pattern!, scope, projectPath);
        console.log(`[PERMISSIONS] Saved pattern "${request.pattern}" to ${scope} settings`);
      } catch (err) {
        console.error(`[PERMISSIONS] Failed to save pattern:`, err);
        // Don't fail the request if pattern saving fails
      }
    }
  }

  console.log(`[PERMISSIONS] User responded to ${requestId}: ${action}`);

  // Notify the queue that this action is resolved
  pendingActionsQueue.resolveAction(request.sessionId, requestId);

  // Broadcast to all clients that this permission was resolved
  // This dismisses the dialog on other tabs/devices
  const io: Server = req.app.get('io');
  io.to(`session:${request.sessionId}`).emit('session:permission_resolved', {
    sessionId: request.sessionId,
    requestId,
  });

  // Note: The long-polling endpoint will pick up this status change
  // and return the response to the permission-prompt script

  res.json({
    success: true,
    action,
    pattern: request.pattern,
  });
});

/**
 * GET /api/permissions/pending/:sessionId
 * Get pending permission requests for a session.
 * Useful for frontend to check if there are outstanding requests.
 * Requires authentication.
 */
router.get('/pending/:sessionId', requireAuth, (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing sessionId' });
  }

  const pending: PendingPermission[] = [];
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

// Export helper function for internal use
export function getPendingPermissionsForSession(sessionId: string): PendingPermission[] {
  const pending: PendingPermission[] = [];
  for (const request of pendingRequests.values()) {
    if (request.sessionId === sessionId && request.status === 'pending') {
      pending.push(request);
    }
  }
  return pending;
}

// Export helper to get a specific permission request by ID
export function getPendingPermissionById(requestId: string): PendingPermission | undefined {
  return pendingRequests.get(requestId);
}

// Export helper to update permission status (for plan approval handling)
export function updatePermissionStatus(requestId: string, approved: boolean, reason?: string): boolean {
  const request = pendingRequests.get(requestId);
  if (!request) {
    return false;
  }

  if (approved) {
    request.status = 'approved';
  } else {
    request.status = 'denied';
    if (reason) {
      request.denialReason = reason;
    }
  }

  return true;
}

// Clear all pending permissions for a session (used when process is terminated)
export function clearPendingPermissionsForSession(sessionId: string): void {
  const cleared: string[] = [];
  for (const [requestId, request] of pendingRequests.entries()) {
    if (request.sessionId === sessionId) {
      pendingRequests.delete(requestId);
      cleared.push(requestId);
    }
  }
  if (cleared.length > 0) {
    console.log(`[PERMISSIONS] Cleared ${cleared.length} pending permissions for session ${sessionId}`);
  }
}

// Deny all pending permissions for a session (used for /clear and interrupt)
export function denyPendingPermissionsForSession(sessionId: string): void {
  const denied: string[] = [];
  for (const [requestId, request] of pendingRequests.entries()) {
    if (request.sessionId === sessionId && request.status === 'pending') {
      request.status = 'denied';
      denied.push(requestId);
    }
  }
  if (denied.length > 0) {
    console.log(`[PERMISSIONS] Denied ${denied.length} pending permissions for session ${sessionId}`);
  }
}

// ============================================================
// Permission History Endpoints (for SDK-based sessions)
// ============================================================

/**
 * GET /api/permissions/history/:sessionId
 * Get permission decision history for a session.
 * Useful for debugging and auditing permission decisions.
 * Requires authentication.
 */
router.get('/history/:sessionId', requireAuth, (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing sessionId' });
  }

  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const history = permissionHistory.getHistory(sessionId, limit);

  res.json({
    success: true,
    data: history,
  });
});

/**
 * GET /api/permissions/stats/:sessionId
 * Get permission statistics for a session.
 * Requires authentication.
 */
router.get('/stats/:sessionId', requireAuth, (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing sessionId' });
  }

  const stats = permissionHistory.getStats(sessionId);

  res.json({
    success: true,
    data: stats,
  });
});

/**
 * DELETE /api/permissions/history/:sessionId
 * Clear permission history for a session.
 * Requires authentication.
 */
router.delete('/history/:sessionId', requireAuth, (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing sessionId' });
  }

  permissionHistory.clearHistory(sessionId);

  res.json({
    success: true,
    message: 'Permission history cleared',
  });
});

export default router;
