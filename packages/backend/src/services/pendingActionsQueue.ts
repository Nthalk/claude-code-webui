import type { Server } from 'socket.io';
import type {
  PendingPermission,
  PendingUserQuestion,
  PendingPlanApproval,
  PendingCommitApproval
} from '@claude-code-webui/shared';

export type ActionType = 'permission' | 'question' | 'plan' | 'commit';

interface QueuedAction {
  type: ActionType;
  sessionId: string;
  requestId: string;
  createdAt: number;
  data: PendingPermission | PendingUserQuestion | PendingPlanApproval | PendingCommitApproval;
}

/**
 * Manages a queue of pending actions (permissions, questions, plan approvals, commit approvals)
 * ensuring only one is active at a time per session.
 *
 * Priority order:
 * 1. Permissions (highest - security critical)
 * 2. User Questions
 * 3. Plan Approvals
 * 4. Commit Approvals (lowest)
 */
export class PendingActionsQueue {
  // Queue per session
  private queues = new Map<string, QueuedAction[]>();
  // Currently active action per session
  private activeActions = new Map<string, QueuedAction>();
  // Socket.IO server for emitting events
  private io: Server | null = null;

  setSocketServer(io: Server) {
    this.io = io;
  }

  /**
   * Add an action to the queue for a session
   */
  addAction(sessionId: string, type: ActionType, requestId: string, data: any) {
    const action: QueuedAction = {
      type,
      sessionId,
      requestId,
      createdAt: Date.now(),
      data
    };

    // Get or create queue for session
    let queue = this.queues.get(sessionId);
    if (!queue) {
      queue = [];
      this.queues.set(sessionId, queue);
    }

    // Add to queue
    queue.push(action);

    // Sort queue by priority (permissions first, then questions, then plans, then commits)
    queue.sort((a, b) => {
      const priorityOrder = ['permission', 'question', 'plan', 'commit'];
      return priorityOrder.indexOf(a.type) - priorityOrder.indexOf(b.type);
    });

    console.log(`[QUEUE] Added ${type} action ${requestId} for session ${sessionId}. Queue length: ${queue.length}`);

    // Process queue if no active action
    if (!this.activeActions.has(sessionId)) {
      this.processQueue(sessionId);
    }
  }

  /**
   * Mark an action as resolved and process the next one
   */
  resolveAction(sessionId: string, requestId: string) {
    const activeAction = this.activeActions.get(sessionId);

    if (activeAction && activeAction.requestId === requestId) {
      console.log(`[QUEUE] Resolved ${activeAction.type} action ${requestId} for session ${sessionId}`);
      this.activeActions.delete(sessionId);

      // Remove from queue if still there (shouldn't be, but just in case)
      const queue = this.queues.get(sessionId);
      if (queue) {
        const index = queue.findIndex(a => a.requestId === requestId);
        if (index !== -1) {
          queue.splice(index, 1);
        }
      }

      // Process next action
      this.processQueue(sessionId);
    } else {
      console.warn(`[QUEUE] Attempted to resolve non-active action ${requestId} for session ${sessionId}`);
    }
  }

  /**
   * Mark an action as failed and notify the user
   */
  failAction(sessionId: string, requestId: string, error: string) {
    const activeAction = this.activeActions.get(sessionId);

    if (activeAction && activeAction.requestId === requestId) {
      console.log(`[QUEUE] Failed ${activeAction.type} action ${requestId} for session ${sessionId}: ${error}`);

      // Remove from active actions
      this.activeActions.delete(sessionId);

      // Emit an error event to the frontend
      if (this.io) {
        this.io.to(`session:${sessionId}`).emit('session:action_failed', {
          sessionId,
          requestId,
          type: activeAction.type,
          error,
        });
      }

      // Process next action
      this.processQueue(sessionId);
    }
  }

  /**
   * Process the queue for a session - emit the highest priority action
   */
  private processQueue(sessionId: string) {
    const queue = this.queues.get(sessionId);
    if (!queue || queue.length === 0) {
      console.log(`[QUEUE] No pending actions for session ${sessionId}`);
      return;
    }

    // Get the highest priority action (queue is already sorted)
    const nextAction = queue.shift()!;
    this.activeActions.set(sessionId, nextAction);

    console.log(`[QUEUE] Processing ${nextAction.type} action ${nextAction.requestId} for session ${sessionId}. Remaining: ${queue.length}`);

    // Emit the appropriate event
    if (this.io) {
      const eventMap = {
        'permission': 'session:permission_request',
        'question': 'session:question_request',
        'plan': 'session:plan_approval_request',
        'commit': 'session:commit_approval_request'
      };

      const event = eventMap[nextAction.type];
      if (!event) {
        console.error(`[QUEUE] Unknown action type: ${nextAction.type}`);
        this.failAction(sessionId, nextAction.requestId, `Unknown action type: ${nextAction.type}`);
        return;
      }

      this.io.to(`session:${sessionId}`).emit(event as any, nextAction.data);
    }
  }

  /**
   * Clear all pending actions for a session (e.g., when session ends)
   */
  clearSession(sessionId: string) {
    const queue = this.queues.get(sessionId);
    const queueLength = queue?.length || 0;

    this.queues.delete(sessionId);
    this.activeActions.delete(sessionId);

    if (queueLength > 0) {
      console.log(`[QUEUE] Cleared ${queueLength} pending actions for session ${sessionId}`);
    }
  }

  /**
   * Get the active action for a session (for debugging)
   */
  getActiveAction(sessionId: string): QueuedAction | undefined {
    return this.activeActions.get(sessionId);
  }

  /**
   * Get queue length for a session (for debugging)
   */
  getQueueLength(sessionId: string): number {
    return this.queues.get(sessionId)?.length || 0;
  }
}

// Singleton instance
export const pendingActionsQueue = new PendingActionsQueue();