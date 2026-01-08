/**
 * User Questions Route
 *
 * Handles the mcp__webui__ask_user tool interaction between Claude and the WebUI.
 * The WebUI MCP server calls these endpoints to surface questions to users.
 *
 * Flow:
 * 1. Claude calls mcp__webui__ask_user tool (AskUserQuestion is denied by hook)
 * 2. MCP server calls POST /request with questions
 * 3. Backend emits to frontend via WebSocket, user answers in UI
 * 4. Frontend calls POST /respond with answers
 * 5. MCP server's long-poll receives the answers and returns them to Claude
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import type { Server } from 'socket.io';
import { requireAuth } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { pendingActionsQueue } from '../services/pendingActionsQueue';

const router = Router();

// Types
interface UserQuestionOption {
  label: string;
  description?: string;
}

interface UserQuestion {
  question: string;
  header: string;
  options: UserQuestionOption[];
  multiSelect: boolean;
}

interface PendingUserQuestion {
  sessionId: string;
  requestId: string;
  toolUseId: string; // Claude's tool_use_id for injecting result
  questions: UserQuestion[];
  status: 'pending' | 'answered';
  answers?: Record<string, string | string[]>;
  createdAt: number;
}

// In-memory storage for pending question requests
// Key: requestId, Value: PendingUserQuestion
const pendingQuestions = new Map<string, PendingUserQuestion>();

// Cleanup old requests (older than 5 minutes)
function cleanupOldRequests(): void {
  const maxAge = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();
  for (const [requestId, request] of pendingQuestions.entries()) {
    if (now - request.createdAt > maxAge) {
      pendingQuestions.delete(requestId);
    }
  }
}

// Run cleanup every minute
setInterval(cleanupOldRequests, 60 * 1000);

// Helper to sleep
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Validation schemas
const questionOptionSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
});

const questionSchema = z.object({
  question: z.string().min(1),
  header: z.string().min(1),
  options: z.array(questionOptionSchema).min(2).max(4),
  multiSelect: z.boolean(),
});

const questionRequestSchema = z.object({
  sessionId: z.string().min(1),
  requestId: z.string().uuid(),
  toolUseId: z.string().min(1), // Claude's tool_use_id
  questions: z.array(questionSchema).min(1).max(4),
});

const questionRespondSchema = z.object({
  requestId: z.string().min(1), // Accept any string ID (UUID for process manager, nanoid for SDK)
  answers: z.record(z.union([z.string(), z.array(z.string())])),
});

/**
 * POST /api/user-questions/request
 * Called by the hook script when Claude uses AskUserQuestion.
 * Stores the request and emits to frontend via WebSocket.
 * No authentication required (called by local script).
 */
router.post('/request', async (req: Request, res: Response) => {
  const parsed = questionRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    console.error('[USER-QUESTIONS] Validation error:', parsed.error);
    return res.status(400).json({
      success: false,
      error: 'Invalid request data',
      details: parsed.error.format(),
    });
  }

  const { sessionId, requestId, toolUseId, questions } = parsed.data;

  // Store the pending request
  const pendingRequest: PendingUserQuestion = {
    sessionId,
    requestId,
    toolUseId,
    questions,
    status: 'pending',
    createdAt: Date.now(),
  };

  pendingQuestions.set(requestId, pendingRequest);

  // Add to queue instead of directly emitting
  pendingActionsQueue.addAction(sessionId, 'question', requestId, {
    sessionId,
    requestId,
    questions,
  });

  console.log(`[USER-QUESTIONS] Request ${requestId} created for session ${sessionId}: ${questions.length} questions`);

  res.json({ success: true, requestId });
});

/**
 * GET /api/user-questions/response/:requestId
 * Long-polled by the hook script to wait for user response.
 * No authentication required (called by local script).
 */
router.get('/response/:requestId', async (req: Request, res: Response) => {
  const requestId = req.params.requestId;
  if (!requestId) {
    return res.status(400).json({ success: false, error: 'Missing requestId' });
  }

  const timeout = 120000; // 2 minute timeout
  const startTime = Date.now();

  // Poll until response or timeout
  while (Date.now() - startTime < timeout) {
    const request = pendingQuestions.get(requestId);

    if (!request) {
      // Request not found - probably already cleaned up or never existed
      return res.json({
        success: false,
        error: 'Request not found',
      });
    }

    if (request.status === 'answered') {
      // User has responded
      const answers = request.answers;

      // Clean up the request
      pendingQuestions.delete(requestId);

      console.log(`[USER-QUESTIONS] Request ${requestId} answered`);

      return res.json({
        success: true,
        answers,
      });
    }

    // Wait a bit before checking again
    await sleep(100);
  }

  // Timeout - return empty answers
  pendingQuestions.delete(requestId);

  console.log(`[USER-QUESTIONS] Request ${requestId} timed out`);

  res.json({
    success: false,
    error: 'Timeout',
  });
});

/**
 * POST /api/user-questions/respond
 * Called by the frontend when user answers questions.
 * Requires authentication.
 */
router.post('/respond', requireAuth, async (req: Request, res: Response) => {
  const parsed = questionRespondSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid request data', 400, 'VALIDATION_ERROR');
  }

  const { requestId, answers } = parsed.data;

  const request = pendingQuestions.get(requestId);

  if (!request) {
    // Check if this is an AskUserQuestion that came through the permission system
    const permissionsModule = await import('./permissions');
    const permission = permissionsModule.getPendingPermissionById(requestId);

    if (permission && permission.toolName === 'AskUserQuestion') {
      console.log(`[USER-QUESTIONS] Found AskUserQuestion permission request ${requestId}, updating it`);

      // Update the permission request status
      const updated = permissionsModule.updatePermissionStatus(requestId, true); // Always approve for answered questions
      if (!updated) {
        throw new AppError('Failed to update permission status', 500, 'INTERNAL_ERROR');
      }

      // Notify the queue that this action is resolved
      pendingActionsQueue.resolveAction(permission.sessionId, requestId);

      // Broadcast to all clients
      const io: Server = req.app.get('io');
      io.to(`session:${permission.sessionId}`).emit('session:question_resolved', {
        sessionId: permission.sessionId,
        requestId,
      });

      return res.json({
        success: true,
        answers,
      });
    }

    // Request not found - might be an SDK session (handled via WebSocket) or expired
    // Return success to avoid crashing - the WebSocket handler handles SDK sessions
    console.log(`[USER-QUESTIONS] Request ${requestId} not found in pending questions (likely SDK session)`);
    return res.json({ success: true, message: 'Request handled via WebSocket or not found' });
  }

  // Update request with answers
  request.status = 'answered';
  request.answers = answers;

  console.log(`[USER-QUESTIONS] User answered ${requestId}:`, JSON.stringify(answers));

  // Notify the queue that this action is resolved
  pendingActionsQueue.resolveAction(request.sessionId, requestId);

  // Broadcast to all clients that this question was resolved
  // This dismisses the dialog on other tabs/devices
  const io: Server = req.app.get('io');
  io.to(`session:${request.sessionId}`).emit('session:question_resolved', {
    sessionId: request.sessionId,
    requestId,
  });

  // Note: The MCP server's long-polling endpoint will pick up this status change
  // and return the response. No need to inject tool_result - the MCP server
  // handles the full request/response cycle.

  res.json({
    success: true,
    answers,
  });
});

/**
 * GET /api/user-questions/pending/:sessionId
 * Get pending question requests for a session.
 * Requires authentication.
 */
router.get('/pending/:sessionId', requireAuth, (req: Request, res: Response) => {
  const sessionId = req.params.sessionId;
  if (!sessionId) {
    return res.status(400).json({ success: false, error: 'Missing sessionId' });
  }

  const pending: PendingUserQuestion[] = [];
  for (const request of pendingQuestions.values()) {
    if (request.sessionId === sessionId && request.status === 'pending') {
      pending.push(request);
    }
  }

  res.json({
    success: true,
    data: pending,
  });
});

export default router;
