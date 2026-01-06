import { io, Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  BufferedMessage,
  SessionMode,
  ModelType,
  PermissionAction,
  UserQuestionAnswers,
  ToolExecution,
} from '@claude-code-webui/shared';
import { useAuthStore } from '@/stores/authStore';
import { useSessionStore } from '@/stores/sessionStore';
import { timeBlock } from '@/hooks/useTimeBlock';

// Simple ID generator
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

class SocketService {
  private socket: TypedSocket | null = null;
  private subscribedSessions: Set<string> = new Set();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private currentSessionId: string | null = null;
  private onSessionNotFound: ((sessionId: string) => void) | null = null;

  connect(): TypedSocket {
    if (this.socket?.connected) {
      return this.socket;
    }

    const token = useAuthStore.getState().token;
    if (!token) {
      throw new Error('No auth token');
    }

    this.socket = io({
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      console.log('[SOCKET] Socket connected successfully');
      // Resubscribe to sessions
      this.subscribedSessions.forEach((sessionId) => {
        console.log(`[SOCKET] Resubscribing to session: ${sessionId}`);
        this.socket?.emit('session:subscribe', sessionId);
      });
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[SOCKET] Socket disconnected:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('[SOCKET] Connection error:', error);
    });

    this.socket.on('session:output', (data) => {
      timeBlock('socket:session:output', () => {
        // Backend sends full accumulated content, not deltas, to avoid ordering issues
        useSessionStore.getState().setStreamingContent(data.sessionId, data.content);
      });
    });

    this.socket.on('session:message', (message) => {
      timeBlock('socket:session:message', () => {
        console.log(`[SOCKET] session:message received:`, {
          id: message.id,
          role: message.role,
          createdAt: message.createdAt,
          contentPreview: message.content?.substring(0, 50),
        });
        const { addMessage, clearStreamingContent } = useSessionStore.getState();
        addMessage(message.sessionId, message);
        clearStreamingContent(message.sessionId);
      });
    });

    this.socket.on('session:status', (data) => {
      useSessionStore.getState().updateSessionStatus(data.sessionId, data.status);
    });

    this.socket.on('session:error', (data) => {
      console.error('Session error:', data.error);
    });

    this.socket.on('session:thinking', (data) => {
      const { setThinking, setActivity } = useSessionStore.getState();
      setThinking(data.sessionId, data.isThinking);
      // Update activity state
      if (data.isThinking) {
        setActivity(data.sessionId, { type: 'thinking' });
      } else {
        setActivity(data.sessionId, { type: 'idle' });
      }
    });

    this.socket.on('session:tool_use', (data) => {
      timeBlock('socket:session:tool_use', () => {
        const store = useSessionStore.getState();

        // If we have a toolId, check if the execution already exists
        if (data.toolId) {
          const existingExecutions = store.toolExecutions[data.sessionId] || [];
          const exists = existingExecutions.some(e => e.toolId === data.toolId);

          if (exists) {
            // Update existing execution
            const update: Partial<ToolExecution> = {};
            if (data.status !== undefined) update.status = data.status as ToolExecution['status'];
            if (data.input !== undefined) update.input = data.input;
            if (data.result !== undefined) update.result = data.result;
            if (data.error !== undefined) update.error = data.error;
            store.updateToolExecution(data.sessionId, data.toolId, update);
          } else if (data.status === 'started') {
            // Create new execution
            store.addToolExecution(data.sessionId, {
              toolId: data.toolId,
              toolName: data.toolName,
              status: 'started',
              input: data.input,
              timestamp: Date.now(),
            });
          }
        } else if (data.status === 'started') {
          // No toolId provided, create new execution with generated ID
          store.addToolExecution(data.sessionId, {
            toolId: generateId(),
            toolName: data.toolName,
            status: 'started',
            input: data.input,
            timestamp: Date.now(),
          });
        }

        // Update activity indicator
        store.setActivity(data.sessionId, {
          type: 'tool',
          toolName: data.toolName,
          toolStatus: data.status,
        });
      });
    });

    this.socket.on('session:agent', (data) => {
      const { setActiveAgent } = useSessionStore.getState();
      console.log(`[SOCKET] session:agent received:`, data.agentType, data.description);
      if (data.status === 'started') {
        setActiveAgent(data.sessionId, {
          agentType: data.agentType,
          description: data.description,
          status: data.status,
        });
      } else {
        // Clear agent when completed or error
        setActiveAgent(data.sessionId, null);
      }
    });

    this.socket.on('session:todos', (data) => {
      console.log(`[SOCKET] Received ${data.todos.length} todos for session ${data.sessionId}`);
      useSessionStore.getState().setTodos(data.sessionId, data.todos);
    });

    this.socket.on('session:usage', (data) => {
      useSessionStore.getState().setUsage(data.sessionId, data);
    });

    this.socket.on('session:restarted', (data) => {
      console.log(`[SOCKET] session:restarted received for ${data.sessionId}`);
      const store = useSessionStore.getState();
      // Clear all local state for this session
      store.setMessages(data.sessionId, []);
      store.clearToolExecutions(data.sessionId);
      store.clearGeneratedImages(data.sessionId);
      store.setTodos(data.sessionId, []);
      // Clear any pending permissions and questions in the UI
      store.setPendingPermission(data.sessionId, null);
      store.setPendingUserQuestion(data.sessionId, null);
      store.setUsage(data.sessionId, {
        sessionId: data.sessionId,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 0,
        contextWindow: 200000,
        contextUsedPercent: 0,
        contextRemainingPercent: 100,
        totalCostUsd: 0,
        model: '',
      });
    });

    this.socket.on('session:image', (data) => {
      console.log(`[SOCKET] session:image received:`, data.prompt?.substring(0, 50));
      useSessionStore.getState().addGeneratedImage(data.sessionId, {
        imageBase64: data.imageBase64,
        mimeType: data.mimeType,
        prompt: data.prompt,
        generator: data.generator,
      });
    });

    this.socket.on('session:reconnected', (data) => {
      timeBlock('socket:session:reconnected', () => {
        console.log(`[SOCKET] session:reconnected received: ${data.bufferedMessages.length} messages, isRunning=${data.isRunning}`);
        this.replayBufferedMessages(data.sessionId, data.bufferedMessages);

        // Update session status based on isRunning
        if (data.isRunning) {
          useSessionStore.getState().updateSessionStatus(data.sessionId, 'running');
        }
      });
    });

    this.socket.on('session:permission_request', (data) => {
      console.log(`[SOCKET] session:permission_request received:`, data.toolName);
      useSessionStore.getState().setPendingPermission(data.sessionId, data);
    });

    this.socket.on('session:question_request', (data) => {
      console.log(`[SOCKET] session:question_request received:`, data.questions.length, 'questions');
      useSessionStore.getState().setPendingUserQuestion(data.sessionId, data);
    });

    this.socket.on('session:plan_approval_request', (data) => {
      console.log(`[SOCKET] session:plan_approval_request received for session:`, data.sessionId);
      useSessionStore.getState().setPendingPlanApproval(data.sessionId, data);
    });

    // Handle permission/question resolved (dismiss dialog on other tabs)
    this.socket.on('session:permission_resolved', (data) => {
      console.log(`[SOCKET] session:permission_resolved received:`, data.requestId);
      const store = useSessionStore.getState();
      const pending = store.pendingPermissions[data.sessionId];
      if (pending?.requestId === data.requestId) {
        store.setPendingPermission(data.sessionId, null);
      }
    });

    this.socket.on('session:question_resolved', (data) => {
      console.log(`[SOCKET] session:question_resolved received:`, data.requestId);
      const store = useSessionStore.getState();
      const pending = store.pendingUserQuestions[data.sessionId];
      if (pending?.requestId === data.requestId) {
        store.setPendingUserQuestion(data.sessionId, null);
      }
    });

    this.socket.on('session:plan_approval_resolved', (data) => {
      console.log(`[SOCKET] session:plan_approval_resolved received:`, data.requestId);
      const store = useSessionStore.getState();
      const pending = store.pendingPlanApprovals[data.sessionId];
      if (pending?.requestId === data.requestId) {
        store.setPendingPlanApproval(data.sessionId, null);
      }
    });

    this.socket.on('session:cleared', (data) => {
      console.log(`[SOCKET] session:cleared received for ${data.sessionId}`);
      const store = useSessionStore.getState();
      // Clear UI state to match cleared session
      store.setMessages(data.sessionId, []);
      store.clearToolExecutions(data.sessionId);
      store.clearGeneratedImages(data.sessionId);
    });

    this.socket.on('session:compacting', (data) => {
      console.log(`[SOCKET] session:compacting received for ${data.sessionId}: ${data.isCompacting}`);
      useSessionStore.getState().setCompacting(data.sessionId, data.isCompacting);
    });

    this.socket.on('session:command_output', (data) => {
      console.log(`[SOCKET] session:command_output received for ${data.sessionId}`);
      // Add a meta message to show the command output
      const message: any = {
        id: generateId(),
        sessionId: data.sessionId,
        role: 'meta' as const,
        content: '',
        createdAt: new Date().toISOString(),
        metaType: 'command_output' as const,
        metaData: { output: data.output },
      };
      useSessionStore.getState().addMessage(data.sessionId, message);
    });

    // Handle heartbeat response
    this.socket.on('heartbeat', (data) => {
      if (data.status === 'not_found' && this.onSessionNotFound) {
        console.log(`[SOCKET] heartbeat: session ${data.sessionId} not found, triggering callback`);
        this.onSessionNotFound(data.sessionId);
      }
    });

    this.socket.on('error', (message) => {
      console.error('Socket error:', message);
    });

    return this.socket;
  }

  // Replay buffered messages from reconnection
  private replayBufferedMessages(sessionId: string, messages: BufferedMessage[]): void {
    timeBlock('replayBufferedMessages', () => {
      const store = useSessionStore.getState();

      for (const msg of messages) {
        switch (msg.type) {
        case 'output': {
          const data = msg.data as { content: string };
          store.appendStreamingContent(sessionId, data.content);
          break;
        }
        case 'message': {
          const data = msg.data as { id: string; sessionId: string; role: 'user' | 'assistant' | 'system'; content: string; createdAt: string; images?: { path: string; filename: string }[] };
          store.addMessage(sessionId, data);
          store.clearStreamingContent(sessionId);
          break;
        }
        case 'thinking': {
          const data = msg.data as { isThinking: boolean };
          store.setThinking(sessionId, data.isThinking);
          if (data.isThinking) {
            store.setActivity(sessionId, { type: 'thinking' });
          } else {
            store.setActivity(sessionId, { type: 'idle' });
          }
          break;
        }
        case 'tool_use': {
          const data = msg.data as { toolName: string; status: 'started' | 'completed' | 'error' };
          store.setActivity(sessionId, {
            type: 'tool',
            toolName: data.toolName,
            toolStatus: data.status,
          });
          break;
        }
        case 'todos': {
          const data = msg.data as { todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; activeForm?: string }> };
          store.setTodos(sessionId, data.todos);
          break;
        }
        case 'usage': {
          const data = msg.data as Parameters<typeof store.setUsage>[1];
          store.setUsage(sessionId, data);
          break;
        }
        case 'agent': {
          const data = msg.data as { agentType: string; description?: string; status: 'started' | 'completed' | 'error' };
          if (data.status === 'started') {
            store.setActiveAgent(sessionId, {
              agentType: data.agentType,
              description: data.description,
              status: data.status,
            });
          } else {
            store.setActiveAgent(sessionId, null);
          }
          break;
        }
        case 'status': {
          const data = msg.data as { status: 'running' | 'stopped' | 'error' };
          store.updateSessionStatus(sessionId, data.status);
          break;
        }
        case 'command_output': {
          const data = msg.data as { output: string };
          const message: any = {
            id: generateId(),
            sessionId,
            role: 'meta' as const,
            content: '',
            createdAt: new Date(msg.timestamp).toISOString(),
            metaType: 'command_output' as const,
            metaData: { output: data.output },
          };
          store.addMessage(sessionId, message);
          break;
        }
      }
    }
    });
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.socket?.disconnect();
    this.socket = null;
    this.subscribedSessions.clear();
  }

  // Start heartbeat for a session (call when entering SessionPage)
  startHeartbeat(sessionId: string, onSessionNotFound: (sessionId: string) => void): void {
    this.stopHeartbeat();
    this.currentSessionId = sessionId;
    this.onSessionNotFound = onSessionNotFound;

    // Send heartbeat every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.socket?.connected && this.currentSessionId) {
        console.log(`[SOCKET] Sending periodic heartbeat for ${this.currentSessionId}`);
        this.socket.emit('heartbeat', { sessionId: this.currentSessionId });
      } else {
        console.log(`[SOCKET] Heartbeat skipped - socket connected: ${this.socket?.connected}, sessionId: ${this.currentSessionId}`);
      }
    }, 30000);

    // Send initial heartbeat (with small delay to ensure socket is ready)
    setTimeout(() => {
      if (this.socket?.connected && this.currentSessionId) {
        console.log(`[SOCKET] Sending initial heartbeat for ${this.currentSessionId}`);
        this.socket.emit('heartbeat', { sessionId: this.currentSessionId });
      } else {
        console.log(`[SOCKET] Initial heartbeat skipped - socket connected: ${this.socket?.connected}, sessionId: ${this.currentSessionId}`);
      }
    }, 100);
  }

  // Stop heartbeat (call when leaving SessionPage)
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    this.currentSessionId = null;
    this.onSessionNotFound = null;
  }

  subscribeToSession(sessionId: string): void {
    this.subscribedSessions.add(sessionId);
    this.socket?.emit('session:subscribe', sessionId);
  }

  unsubscribeFromSession(sessionId: string): void {
    this.subscribedSessions.delete(sessionId);
    this.socket?.emit('session:unsubscribe', sessionId);
  }

  sendMessage(sessionId: string, message: string, images?: { data: string; mimeType: string }[]): void {
    console.log(`sendMessage: sessionId=${sessionId}, message="${message}", socket=${!!this.socket}, connected=${this.socket?.connected}`);
    this.socket?.emit('session:send', { sessionId, message, images });
  }

  // Send raw input for interactive prompts (trust dialogs, selections, etc.)
  sendInput(sessionId: string, input: string): void {
    console.log(`Sending input to session ${sessionId}: "${input}"`);
    this.socket?.emit('session:input', { sessionId, input });
  }

  async sendMessageWithImages(
    sessionId: string,
    message: string,
    imageFiles: File[]
  ): Promise<void> {
    // Convert files to base64
    const images = await Promise.all(
      imageFiles.map(async (file) => {
        const base64 = await this.fileToBase64(file);
        return {
          data: base64,
          mimeType: file.type,
        };
      })
    );

    this.sendMessage(sessionId, message, images.length > 0 ? images : undefined);
  }

  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix (e.g., "data:image/png;base64,")
        const base64 = result.split(',')[1] ?? '';
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  interruptSession(sessionId: string): void {
    this.socket?.emit('session:interrupt', sessionId);
  }

  // Restart session (stop and start fresh)
  restartSession(sessionId: string): void {
    console.log(`[SOCKET] Restarting session ${sessionId}`);
    this.socket?.emit('session:restart', sessionId);
  }

  // Set session permission mode
  setSessionMode(sessionId: string, mode: SessionMode): void {
    console.log(`[SOCKET] Setting session ${sessionId} mode to ${mode}`);
    this.socket?.emit('session:set-mode', { sessionId, mode });
  }

  // Set session model
  setSessionModel(sessionId: string, model: ModelType): void {
    console.log(`[SOCKET] Setting session ${sessionId} model to ${model}`);
    this.socket?.emit('session:set-model', { sessionId, model });
  }

  // Request to reconnect to a running session and get buffered messages
  reconnectToSession(sessionId: string, lastTimestamp?: number): void {
    console.log(`[SOCKET] Reconnecting to session ${sessionId}, lastTimestamp=${lastTimestamp}`);
    this.subscribedSessions.add(sessionId);
    this.socket?.emit('session:reconnect', { sessionId, lastTimestamp });
  }

  // Resume a session that was stopped/disconnected
  resumeSession(sessionId: string): void {
    console.log(`[SOCKET] Resuming session ${sessionId}`);
    this.socket?.emit('session:resume', sessionId);
  }

  // Respond to a permission request
  async respondToPermission(
    sessionId: string,
    requestId: string,
    action: PermissionAction,
    pattern?: string,
    reason?: string
  ): Promise<void> {
    console.log(`[SOCKET] Responding to permission ${requestId}: ${action}`);

    // Call the backend API to respond (the long-polling endpoint will pick this up)
    const token = useAuthStore.getState().token;
    if (!token) {
      throw new Error('No auth token');
    }

    const response = await fetch('/api/permissions/respond', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        requestId,
        action,
        pattern,
        reason,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to respond to permission request');
    }

    // Clear the pending permission from the store
    useSessionStore.getState().setPendingPermission(sessionId, null);
  }

  // Respond to a user question request
  async respondToUserQuestion(
    sessionId: string,
    requestId: string,
    answers: UserQuestionAnswers
  ): Promise<void> {
    console.log(`[SOCKET] Responding to user question ${requestId}`);

    // Call the backend API to respond (the long-polling endpoint will pick this up)
    const token = useAuthStore.getState().token;
    if (!token) {
      throw new Error('No auth token');
    }

    const response = await fetch('/api/user-questions/respond', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        requestId,
        answers,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to respond to user question');
    }

    // Clear the pending question from the store
    useSessionStore.getState().setPendingUserQuestion(sessionId, null);
  }

  getSocket(): TypedSocket | null {
    return this.socket;
  }
}

export const socketService = new SocketService();
