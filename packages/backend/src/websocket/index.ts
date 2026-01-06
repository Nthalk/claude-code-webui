import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from '@claude-code-webui/shared';
import { config } from '../config';
import { ClaudeProcessManager } from '../services/claude/ClaudeProcessManager';
import { GeminiService } from '../services/gemini';
import { getTodosBySessionId } from '../db/todos';

// Global reference to the process manager for use by routes
let _processManager: ClaudeProcessManager | null = null;

export function getProcessManager(): ClaudeProcessManager {
  if (!_processManager) {
    throw new Error('Process manager not initialized. Call setupWebSocket first.');
  }
  return _processManager;
}

export function setupWebSocket(httpServer: HttpServer): Server {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
    httpServer,
    {
      cors: {
        origin: (origin, callback) => {
          // Allow same-origin requests (no origin header) or matching frontend URL (case-insensitive)
          if (!origin || origin.toLowerCase() === config.frontendUrl.toLowerCase()) {
            callback(null, true);
          } else {
            callback(null, true); // Allow all origins in production for Docker
          }
        },
        credentials: true,
      },
      maxHttpBufferSize: 50 * 1024 * 1024, // 50MB for large images
    }
  );

  const processManager = new ClaudeProcessManager(io);
  _processManager = processManager; // Store global reference for routes
  const geminiService = new GeminiService(io);

  // Check Gemini CLI availability on startup
  geminiService.checkAvailability().then((result) => {
    if (result.available) {
      console.log(`[GEMINI] Gemini CLI available: ${result.version}`);
    } else {
      console.warn(`[GEMINI] Gemini CLI not available: ${result.error}`);
    }
  });

  // Authentication middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { userId: string };
      socket.data.userId = decoded.userId;
      socket.data.subscribedSessions = new Set();
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id} (user: ${socket.data.userId})`);

    // Debug: Log all incoming events
    socket.onAny((eventName, ...args) => {
      console.log(`[SOCKET EVENT] ${eventName}:`, args[0]?.sessionId || '', args[0]?.message?.substring(0, 30) || '');
    });

    // Subscribe to session output
    socket.on('session:subscribe', (sessionId) => {
      socket.data.subscribedSessions.add(sessionId);
      socket.join(`session:${sessionId}`);
      console.log(`Socket ${socket.id} subscribed to session ${sessionId}`);

      // Load and emit todos for the session
      try {
        const todos = getTodosBySessionId(sessionId);
        if (todos.length > 0) {
          console.log(`[TODOS] Loading ${todos.length} todos from database for session ${sessionId}`);
          socket.emit('session:todos', {
            sessionId,
            todos,
          });
        }
      } catch (err) {
        console.error(`[TODOS] Failed to load todos for session ${sessionId}:`, err);
      }

      // Emit current usage if session is running
      if (processManager.isSessionRunning(sessionId)) {
        processManager.getCurrentUsage(sessionId);
      }
    });

    // Unsubscribe from session output
    socket.on('session:unsubscribe', (sessionId) => {
      socket.data.subscribedSessions.delete(sessionId);
      socket.leave(`session:${sessionId}`);
      console.log(`Socket ${socket.id} unsubscribed from session ${sessionId}`);
    });

    // Send message to Claude
    socket.on('session:send', async ({ sessionId, message, images }) => {
      console.log(`Received session:send for ${sessionId}: "${message?.substring(0, 50)}..."`);
      try {
        await processManager.sendMessage(sessionId, socket.data.userId, message, images);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to send message',
        });
      }
    });

    // Interrupt Claude session
    socket.on('session:interrupt', (sessionId) => {
      try {
        processManager.interrupt(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to interrupt session',
        });
      }
    });

    // Set session permission mode
    socket.on('session:set-mode', ({ sessionId, mode }) => {
      console.log(`Setting session ${sessionId} mode to ${mode}`);
      try {
        processManager.setMode(sessionId, socket.data.userId, mode);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to set mode',
        });
      }
    });

    // Set session model
    socket.on('session:set-model', ({ sessionId, model }) => {
      console.log(`Setting session ${sessionId} model to ${model}`);
      try {
        processManager.setModel(sessionId, socket.data.userId, model);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to set model',
        });
      }
    });

    // Restart session (stop and start fresh)
    socket.on('session:restart', async (sessionId) => {
      console.log(`Restart request for session ${sessionId}`);
      try {
        await processManager.restartSession(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to restart session',
        });
      }
    });

    // Send raw input for interactive prompts (trust dialogs, etc.)
    socket.on('session:input', async ({ sessionId, input }) => {
      console.log(`Received session:input for ${sessionId}: "${input}"`);
      try {
        await processManager.sendRawInput(sessionId, socket.data.userId, input);
        console.log(`Input sent successfully to session ${sessionId}`);
      } catch (err) {
        console.error(`Failed to send input to session ${sessionId}:`, err);
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to send input',
        });
      }
    });

    // Generate image using Gemini CLI
    socket.on('session:generate-image', async ({ sessionId, prompt, model, referenceImages }) => {
      console.log(`Received session:generate-image for ${sessionId}: "${prompt}"`);
      try {
        const result = await geminiService.generateImage(sessionId, prompt, {
          model,
          referenceImages,
          userId: socket.data.userId,
        });

        if (result.success && result.imagePath) {
          socket.emit('session:image', {
            sessionId,
            imagePath: result.imagePath,
            imageBase64: result.imageBase64,
            mimeType: result.mimeType || 'image/png',
            prompt,
            generator: 'gemini',
          });
        } else {
          socket.emit('session:error', {
            sessionId,
            error: result.error || 'Failed to generate image',
          });
        }
      } catch (err) {
        console.error(`Failed to generate image for session ${sessionId}:`, err);
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to generate image',
        });
      }
    });

    // Resume a session (used after backend restart)
    socket.on('session:resume', async (sessionId) => {
      console.log(`Resume request for session ${sessionId} from user ${socket.data.userId}`);
      try {
        await processManager.resumeSession(sessionId, socket.data.userId);
      } catch (err) {
        socket.emit('session:error', {
          sessionId,
          error: err instanceof Error ? err.message : 'Failed to resume session',
        });
      }
    });

    // Heartbeat - check if session is still alive
    socket.on('heartbeat', ({ sessionId }) => {
      // Session is "ok" if it has an active process tracked by the manager
      // "not_found" means backend restarted and lost the session process
      const hasProcess = processManager.isSessionRunning(sessionId);
      socket.emit('heartbeat', {
        sessionId,
        status: hasProcess ? 'ok' : 'not_found',
      });
    });

    // Reconnect to a running session
    socket.on('session:reconnect', async ({ sessionId, lastTimestamp }) => {
      console.log(`Reconnect request for session ${sessionId} from socket ${socket.id}`);

      // ALWAYS subscribe to the session room, regardless of running state
      // This ensures the socket receives events when a session starts
      socket.data.subscribedSessions.add(sessionId);
      socket.join(`session:${sessionId}`);
      console.log(`Socket ${socket.id} joined session room ${sessionId}`);

      let isRunning = processManager.isSessionRunning(sessionId);

      // If not running, check if the session was previously active and should be resumed
      if (!isRunning) {
        try {
          const db = await import('../db');
          const session = db.getDatabase()
            .prepare('SELECT status, session_state, claude_session_id FROM sessions WHERE id = ? AND user_id = ?')
            .get(sessionId, socket.data.userId) as { status: string; session_state: string; claude_session_id: string | null } | undefined;

          if (session && (session.status === 'running' || session.session_state === 'active') && session.claude_session_id) {
            console.log(`[SOCKET] Session ${sessionId} was previously active, resuming...`);

            // Resume the session
            await processManager.resumeSession(sessionId, socket.data.userId);

            // Give the process a moment to start
            await new Promise(resolve => setTimeout(resolve, 500));

            // Check if it's running now
            isRunning = processManager.isSessionRunning(sessionId);
          }
        } catch (error) {
          console.error(`[SOCKET] Error checking/resuming session:`, error);
        }
      }

      if (isRunning) {
        // Mark session as reconnected
        processManager.markSessionReconnected(sessionId);

        // Get buffered messages since last timestamp
        const bufferedMessages = processManager.getSessionBuffer(sessionId, lastTimestamp);

        console.log(`Session ${sessionId} reconnected with ${bufferedMessages.length} buffered messages`);

        // Send reconnection data
        socket.emit('session:reconnected', {
          sessionId,
          bufferedMessages,
          isRunning: true,
        });

        // Emit current usage
        processManager.getCurrentUsage(sessionId);
      } else {
        // Session is not running, send empty reconnection data
        socket.emit('session:reconnected', {
          sessionId,
          bufferedMessages: [],
          isRunning: false,
        });
      }

      // Load and emit todos for the session on reconnect
      try {
        const todos = getTodosBySessionId(sessionId);
        if (todos.length > 0) {
          console.log(`[TODOS] Loading ${todos.length} todos from database for reconnected session ${sessionId}`);
          socket.emit('session:todos', {
            sessionId,
            todos,
          });
        }
      } catch (err) {
        console.error(`[TODOS] Failed to load todos for reconnected session ${sessionId}:`, err);
      }

      // Check for pending permissions and re-emit them to the reconnecting client
      // Import the pending requests directly from the permissions module
      const { getPendingPermissionsForSession } = await import('../routes/permissions');
      const pendingPermissions = getPendingPermissionsForSession(sessionId);

      if (pendingPermissions.length > 0) {
        console.log(`[SOCKET] Re-emitting ${pendingPermissions.length} pending permissions for session ${sessionId}`);

        // Emit each pending permission to the reconnecting client
        for (const permission of pendingPermissions) {
          socket.emit('session:permission_request', {
            sessionId: permission.sessionId,
            requestId: permission.requestId,
            toolName: permission.toolName,
            toolInput: permission.toolInput,
            description: permission.description,
            suggestedPattern: permission.suggestedPattern,
          });
        }
      }
    });

    // Cleanup on disconnect
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      // Mark subscribed sessions as disconnected
      for (const sessionId of socket.data.subscribedSessions) {
        processManager.markSessionDisconnected(sessionId);
      }
    });
  });

  return io;
}

export type { Server };
