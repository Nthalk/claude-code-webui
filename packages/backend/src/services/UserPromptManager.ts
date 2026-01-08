/**
 * UserPromptManager - Unified prompt management service
 *
 * Replaces fragmented systems (pendingActionsQueue, permissions.ts, plan.ts, user-questions.ts)
 * with a single service that manages all user prompts via WebSocket.
 */

import type { Server } from 'socket.io';
import { nanoid } from 'nanoid';
import type {
  Prompt,
  PromptType,
  PromptResponse,
  Promptable,
  PermissionPrompt,
  PlanApprovalPrompt,
  UserQuestionPrompt,
  CommitApprovalPrompt,
} from '@claude-code-webui/shared';

// Re-export priority for sorting
const PRIORITY: Record<PromptType, number> = {
  permission: 0,
  user_question: 1,
  plan_approval: 2,
  commit_approval: 3,
};

// Type for prompt creation (without id and createdAt)
type PromptInput =
  | Omit<PermissionPrompt, 'id' | 'createdAt'>
  | Omit<PlanApprovalPrompt, 'id' | 'createdAt'>
  | Omit<UserQuestionPrompt, 'id' | 'createdAt'>
  | Omit<CommitApprovalPrompt, 'id' | 'createdAt'>;

export class UserPromptManager {
  // Store: sessionId -> Promptable
  private sessions: Map<string, Promptable> = new Map();

  // Resolvers for pending prompts: promptId -> resolve function
  private resolvers: Map<string, (response: PromptResponse) => void> = new Map();

  // Socket.IO server for emitting events
  private io: Server | null = null;

  /**
   * Set the Socket.IO server instance for emitting events
   */
  setSocketServer(io: Server): void {
    this.io = io;
    console.log('[PROMPT] UserPromptManager initialized with Socket.IO');
  }

  /**
   * Add a prompt to the queue and wait for user response.
   * Returns a Promise that resolves when the user responds.
   */
  async prompt(
    sessionId: string,
    promptInput: PromptInput
  ): Promise<PromptResponse> {
    const promptId = nanoid();
    const prompt: Prompt = {
      ...promptInput,
      id: promptId,
      createdAt: Date.now(),
    } as Prompt;

    // Get or create session's promptable
    let promptable = this.sessions.get(sessionId);
    if (!promptable) {
      promptable = { sessionId, promptQueue: [] };
      this.sessions.set(sessionId, promptable);
    }

    // Add to queue
    promptable.promptQueue.push(prompt);

    // Sort queue by priority (lower number = higher priority)
    promptable.promptQueue.sort((a, b) => PRIORITY[a.type] - PRIORITY[b.type]);

    console.log(`[PROMPT] Added ${prompt.type} prompt ${promptId} for session ${sessionId}. Queue length: ${promptable.promptQueue.length}`);

    // Emit to frontend if this is now the active (first) prompt
    if (promptable.promptQueue[0]?.id === promptId) {
      this.emitActivePrompt(sessionId);
    }

    // Create and store resolver, return promise
    return new Promise<PromptResponse>((resolve) => {
      this.resolvers.set(promptId, resolve);
    });
  }

  /**
   * Respond to a prompt. Called by WebSocket handler when user responds.
   * Returns true if the prompt was found and resolved.
   */
  respond(sessionId: string, promptId: string, response: PromptResponse): boolean {
    const resolver = this.resolvers.get(promptId);
    if (!resolver) {
      console.warn(`[PROMPT] No resolver found for prompt ${promptId}`);
      return false;
    }

    // Remove from resolvers
    this.resolvers.delete(promptId);

    // Remove from queue
    const promptable = this.sessions.get(sessionId);
    if (promptable) {
      const index = promptable.promptQueue.findIndex(p => p.id === promptId);
      if (index !== -1) {
        promptable.promptQueue.splice(index, 1);
        console.log(`[PROMPT] Resolved ${response.type} prompt ${promptId} for session ${sessionId}. Queue length: ${promptable.promptQueue.length}`);
      }
    }

    // Resolve the promise
    resolver(response);

    // Emit resolved event to all clients (dismisses dialog on other tabs)
    if (this.io) {
      this.io.to(`session:${sessionId}`).emit('prompt:resolved', {
        sessionId,
        promptId,
      });
    }

    // Emit next active prompt if queue is not empty
    if (promptable && promptable.promptQueue.length > 0) {
      this.emitActivePrompt(sessionId);
    }

    return true;
  }

  /**
   * Get the active (first) prompt for a session.
   * Used for reconnection to re-emit pending prompts.
   */
  getActivePrompt(sessionId: string): Prompt | null {
    const promptable = this.sessions.get(sessionId);
    if (!promptable || promptable.promptQueue.length === 0) {
      return null;
    }
    return promptable.promptQueue[0] ?? null;
  }

  /**
   * Get all prompts for a session (for debugging)
   */
  getQueue(sessionId: string): Prompt[] {
    return this.sessions.get(sessionId)?.promptQueue ?? [];
  }

  /**
   * Clear all prompts for a session (on session end/disconnect)
   */
  clearSession(sessionId: string): void {
    const promptable = this.sessions.get(sessionId);
    if (!promptable) return;

    // Reject all pending resolvers with a clear error
    for (const prompt of promptable.promptQueue) {
      const resolver = this.resolvers.get(prompt.id);
      if (resolver) {
        // Resolve with denied/empty response based on type
        resolver(this.createDeniedResponse(prompt.type, 'Session cleared'));
        this.resolvers.delete(prompt.id);
      }
    }

    this.sessions.delete(sessionId);
    console.log(`[PROMPT] Cleared session ${sessionId}`);
  }

  /**
   * Deny all pending prompts for a session (on interrupt)
   */
  denyAll(sessionId: string, reason: string): void {
    const promptable = this.sessions.get(sessionId);
    if (!promptable) return;

    const count = promptable.promptQueue.length;
    for (const prompt of promptable.promptQueue) {
      const resolver = this.resolvers.get(prompt.id);
      if (resolver) {
        resolver(this.createDeniedResponse(prompt.type, reason));
        this.resolvers.delete(prompt.id);
      }
    }

    promptable.promptQueue = [];

    if (count > 0) {
      console.log(`[PROMPT] Denied ${count} prompts for session ${sessionId}: ${reason}`);
    }
  }

  /**
   * Emit the active prompt to the frontend
   */
  private emitActivePrompt(sessionId: string): void {
    if (!this.io) {
      console.warn('[PROMPT] Cannot emit - Socket.IO not initialized');
      return;
    }

    const prompt = this.getActivePrompt(sessionId);
    if (prompt) {
      this.io.to(`session:${sessionId}`).emit('prompt:request', prompt);
      console.log(`[PROMPT] Emitted ${prompt.type} prompt ${prompt.id} to session ${sessionId}`);
    }
  }

  /**
   * Re-emit active prompt to a specific socket (for reconnection)
   */
  emitToSocket(sessionId: string, socketId: string): void {
    if (!this.io) return;

    const prompt = this.getActivePrompt(sessionId);
    if (prompt) {
      this.io.to(socketId).emit('prompt:request', prompt);
      console.log(`[PROMPT] Re-emitted ${prompt.type} prompt ${prompt.id} to socket ${socketId}`);
    }
  }

  /**
   * Create a denied/empty response for a prompt type
   */
  private createDeniedResponse(type: PromptType, reason: string): PromptResponse {
    switch (type) {
      case 'permission':
        return { type: 'permission', approved: false };
      case 'plan_approval':
        return { type: 'plan_approval', approved: false, reason };
      case 'user_question':
        return { type: 'user_question', answers: {} };
      case 'commit_approval':
        return { type: 'commit_approval', approved: false, reason };
    }
  }
}

// Singleton instance
export const userPromptManager = new UserPromptManager();
