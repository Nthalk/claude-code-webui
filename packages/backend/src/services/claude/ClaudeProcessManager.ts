import type { Server } from 'socket.io';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  BufferedMessage,
  SessionMode,
} from '@claude-code-webui/shared';
import { getDatabase } from '../../db';
import { nanoid } from 'nanoid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChildProcess, spawn as cpSpawn } from 'child_process';
import { config } from '../../config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Circular buffer for storing messages for reconnection
const BUFFER_SIZE = 5000;
const DISCONNECT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class CircularBuffer<T> {
  private buffer: T[] = [];
  private maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  push(item: T): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift();
    }
    this.buffer.push(item);
  }

  getAll(): T[] {
    return [...this.buffer];
  }

  getSince(predicate: (item: T) => boolean): T[] {
    const startIndex = this.buffer.findIndex(predicate);
    if (startIndex === -1) return [];
    return this.buffer.slice(startIndex);
  }

  clear(): void {
    this.buffer = [];
  }
}

interface ImageData {
  data: string; // base64
  mimeType: string;
}

interface UsageInfo {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface StreamEventMessage {
  type: string;
  message?: {
    model?: string;
    usage?: UsageInfo;
  };
  delta?: {
    type?: string;
    text?: string;
    stop_reason?: string;
    stop_sequence?: string | null;
  };
  usage?: UsageInfo;
  context_management?: unknown;
  index?: number;
}

interface ModelUsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  contextWindow: number;
  costUSD: number;
}

interface StreamJsonMessage {
  type: string;
  content?: string;
  message?: {
    role: string;
    model?: string;
    content: string | { type: string; text?: string }[];
    usage?: UsageInfo;
  };
  tool_use?: {
    name: string;
    id: string;
  };
  result?: string;
  session_id?: string;
  subtype?: string;
  // For partial message streaming
  content_block?: {
    type: string;
    text?: string;
  };
  delta?: {
    type: string;
    text?: string;
  };
  index?: number;
  // For stream_event wrapper
  event?: StreamEventMessage;
  // For result message
  total_cost_usd?: number;
  usage?: UsageInfo;
  modelUsage?: Record<string, ModelUsageInfo>;
}

interface ClaudeProcess {
  process: ChildProcess;
  sessionId: string;
  userId: string;
  workingDirectory: string;
  claudeSessionId: string | null;
  buffer: string;
  streamingText: string; // Accumulates text during streaming
  isStreaming: boolean;
  // Permission mode
  mode: SessionMode;
  // Tool tracking
  currentToolName: string | null;
  currentToolId: string | null; // Tool use ID from Claude
  currentToolInput: string; // Accumulates JSON input during tool use
  pendingToolResults: Map<string, { toolName: string; input: unknown }>; // Track tools awaiting results
  // Agent tracking
  currentAgentType: string | null;
  // Usage tracking
  model: string;
  contextWindow: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalCostUsd: number;
  // Context reminder flag for resumed sessions
  needsWorkingDirReminder: boolean;
  // Reconnect buffer
  outputBuffer: CircularBuffer<BufferedMessage>;
  lastActivityAt: number;
  disconnectedAt: number | null;
}

export class ClaudeProcessManager {
  private processes: Map<string, ClaudeProcess> = new Map();
  private pendingModes: Map<string, SessionMode> = new Map(); // Store modes for sessions not yet started
  private io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

  constructor(
    io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
  ) {
    this.io = io;

    // Start cleanup timer for disconnected sessions (every 60 seconds)
    setInterval(() => {
      this.cleanupDisconnectedSessions();
    }, 60 * 1000);
  }

  // Get the path to the path transform hook script
  private getPathTransformHookPath(): string {
    // In dev (tsx): __dirname = packages/backend/src/services/claude
    // Hook is at: packages/backend/src/cli/path-transform-hook.ts

    const devPath = path.resolve(__dirname, '../../cli/path-transform-hook.ts');
    if (fsSync.existsSync(devPath)) {
      return devPath;
    }

    // If running from dist, the script is in src (parallel to dist)
    const prodPath = path.resolve(__dirname, '../../../src/cli/path-transform-hook.ts');
    if (fsSync.existsSync(prodPath)) {
      return prodPath;
    }

    console.warn(`[HOOKS] Could not find path-transform-hook.ts, tried: ${devPath}, ${prodPath}`);
    return devPath;
  }

  // Get the path to the WebUI MCP server script
  private getMcpServerScriptPath(): string {
    // Similar logic to permission prompt script
    // In dev (tsx): __dirname = packages/backend/src/services/claude
    // MCP server is at: packages/backend/src/mcp/webui-server.ts

    // First, try relative to source (development)
    const devPath = path.resolve(__dirname, '../mcp/webui-server.ts');
    if (fsSync.existsSync(devPath)) {
      return devPath;
    }

    // If running from dist, the script is in src (parallel to dist)
    const prodPath = path.resolve(__dirname, '../../../src/mcp/webui-server.ts');
    if (fsSync.existsSync(prodPath)) {
      return prodPath;
    }

    // Fallback
    const packageRoot = path.resolve(__dirname, '../../../../');
    const fallbackPath = path.join(packageRoot, 'src/mcp/webui-server.ts');
    if (fsSync.existsSync(fallbackPath)) {
      return fallbackPath;
    }

    console.warn(`[MCP] Could not find webui-server.ts, tried: ${devPath}, ${prodPath}, ${fallbackPath}`);
    return devPath;
  }

  // Generate settings JSON with hooks configured
  private getHookSettings(): string {
    const hookScriptPath = this.getPathTransformHookPath();
    console.log(`[HOOKS] Using path transform hook: ${hookScriptPath}`);

    // PreToolUse hook to transform absolute paths to relative paths
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Read|Write|Edit|Glob|Grep|NotebookEdit',
            hooks: [
              {
                type: 'command',
                command: `npx tsx ${hookScriptPath}`,
              },
            ],
          },
        ],
      },
    };

    return JSON.stringify(settings);
  }

  // Create .mcp.json file in the working directory to register WebUI MCP server
  private async setupMcpConfig(sessionId: string, workingDirectory: string, mode: SessionMode): Promise<void> {
    const mcpScriptPath = this.getMcpServerScriptPath();
    console.log(`[MCP] Setting up MCP config with server script: ${mcpScriptPath}, mode: ${mode}`);

    const mcpConfig = {
      mcpServers: {
        webui: {
          type: 'stdio',
          command: 'npx',
          args: ['tsx', mcpScriptPath],
          env: {
            WEBUI_SESSION_ID: sessionId,
            WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
            WEBUI_PROJECT_PATH: workingDirectory,
            WEBUI_PERMISSION_MODE: mode,
          },
        },
      },
    };

    const mcpJsonPath = path.join(workingDirectory, '.mcp.json');

    // Check if .mcp.json already exists and merge if needed
    let existingConfig: { mcpServers?: Record<string, unknown> } = {};
    try {
      const existingContent = await fs.readFile(mcpJsonPath, 'utf-8');
      existingConfig = JSON.parse(existingContent);
      console.log(`[MCP] Found existing .mcp.json, merging configs`);
    } catch {
      // File doesn't exist or is invalid, start fresh
      console.log(`[MCP] No existing .mcp.json, creating new one`);
    }

    // Merge our webui server with any existing servers
    const mergedConfig = {
      ...existingConfig,
      mcpServers: {
        ...existingConfig.mcpServers,
        ...mcpConfig.mcpServers,
      },
    };

    await fs.writeFile(mcpJsonPath, JSON.stringify(mergedConfig, null, 2));
    console.log(`[MCP] Wrote MCP config to ${mcpJsonPath}`);
  }

  // Helper method to buffer a message
  private bufferMessage(sessionId: string, type: BufferedMessage['type'], data: unknown): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    const bufferedMsg: BufferedMessage = {
      type,
      data,
      timestamp: Date.now(),
    };
    proc.outputBuffer.push(bufferedMsg);
    proc.lastActivityAt = Date.now();
  }

  // Wrapper to emit and buffer status
  private emitStatus(sessionId: string, data: { sessionId: string; status: 'running' | 'stopped' | 'error' }): void {
    this.bufferMessage(sessionId, 'status', data);
    this.io.to(`session:${sessionId}`).emit('session:status', data);
  }

  // Get buffered messages since a timestamp for reconnection
  getSessionBuffer(sessionId: string, sinceTimestamp?: number): BufferedMessage[] {
    const proc = this.processes.get(sessionId);
    if (!proc) return [];

    if (sinceTimestamp) {
      return proc.outputBuffer.getSince((msg) => msg.timestamp > sinceTimestamp);
    }
    return proc.outputBuffer.getAll();
  }

  // Check if a session is running (for reconnection)
  isSessionRunning(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  // Mark session as disconnected (client disconnected but process keeps running)
  markSessionDisconnected(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (proc && !proc.disconnectedAt) {
      proc.disconnectedAt = Date.now();
      console.log(`Session ${sessionId} marked as disconnected`);
    }
  }

  // Mark session as reconnected
  markSessionReconnected(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (proc) {
      proc.disconnectedAt = null;
      console.log(`Session ${sessionId} marked as reconnected`);
    }
  }

  // Cleanup sessions that have been disconnected too long
  private cleanupDisconnectedSessions(): void {
    const now = Date.now();
    for (const [sessionId, proc] of this.processes.entries()) {
      if (proc.disconnectedAt && (now - proc.disconnectedAt) > DISCONNECT_TIMEOUT_MS) {
        console.log(`Cleaning up disconnected session ${sessionId} (timeout exceeded)`);
        this.stopSessionInternal(sessionId);
      }
    }
  }

  private stopSessionInternal(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    proc.process.stdin?.end();
    setTimeout(() => {
      if (this.processes.has(sessionId)) {
        proc.process.kill();
        this.cleanupProcess(sessionId);
      }
    }, 2000);
  }

  async startSession(sessionId: string, userId: string, mode?: SessionMode): Promise<void> {
    const db = getDatabase();

    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionId, userId) as { working_directory: string; claude_session_id: string | null } | undefined;

    if (!session) {
      throw new Error('Session not found');
    }

    if (this.processes.has(sessionId)) {
      return;
    }

    // Use provided mode, or pending mode, or default to 'auto-accept'
    const effectiveMode = mode ?? this.pendingModes.get(sessionId) ?? 'auto-accept';
    this.pendingModes.delete(sessionId); // Clear pending mode once used
    console.log(`[MODE] Starting session ${sessionId} with mode ${effectiveMode}`);

    // Build command args for stream-json mode
    const args: string[] = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--include-partial-messages',
    ];

    // Set up MCP config for WebUI tools (ask_user, permission_prompt, etc.)
    // Pass the mode so the MCP server knows how to handle permissions
    await this.setupMcpConfig(sessionId, session.working_directory, effectiveMode);

    // Use MCP tool for all permission prompts
    // The MCP server will auto-approve in 'danger' mode
    args.push('--permission-prompt-tool', 'mcp__webui__permission_prompt');

    // Add hook settings for path transformation (converts absolute paths to relative)
    const hookSettings = this.getHookSettings();
    args.push('--settings', hookSettings);

    const isResuming = !!session.claude_session_id;
    if (isResuming && session.claude_session_id) {
      args.push('--resume', session.claude_session_id);
    }

    console.log(`[SESSION] ========== Starting Claude Session ==========`);
    console.log(`[SESSION] Session ID: ${sessionId}`);
    console.log(`[SESSION] Working directory: ${session.working_directory}`);
    console.log(`[SESSION] Mode: ${effectiveMode}`);
    console.log(`[SESSION] Resuming: ${isResuming}`);
    console.log(`[SESSION] Args: ${args.join(' ')}`);
    console.log(`[SESSION] Env WEBUI_SESSION_ID: ${sessionId}`);
    console.log(`[SESSION] Env WEBUI_BACKEND_URL: http://localhost:${config.port}`);
    console.log(`[SESSION] Env WEBUI_PROJECT_PATH: ${session.working_directory}`);
    console.log(`[SESSION] ==============================================`);

    // Use regular spawn instead of PTY for stream-json mode
    const proc = cpSpawn('claude', args, {
      cwd: session.working_directory,
      env: {
        ...process.env,
        // Pass session ID so Claude can use it for image generation and permissions
        WEBUI_SESSION_ID: sessionId,
        // Pass backend URL for permission-prompt script
        WEBUI_BACKEND_URL: `http://localhost:${config.port}`,
        // Pass project path for loading project-specific settings
        WEBUI_PROJECT_PATH: session.working_directory,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const claudeProcess: ClaudeProcess = {
      process: proc,
      sessionId,
      userId,
      workingDirectory: session.working_directory,
      claudeSessionId: session.claude_session_id,
      buffer: '',
      streamingText: '',
      isStreaming: false,
      // Permission mode
      mode: effectiveMode,
      // Tool tracking
      currentToolName: null,
      currentToolId: null,
      currentToolInput: '',
      pendingToolResults: new Map(),
      // Agent tracking
      currentAgentType: null,
      // Usage tracking defaults
      model: 'unknown',
      contextWindow: 200000, // Default for Opus
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalCostUsd: 0,
      // Only need reminder for resumed sessions
      needsWorkingDirReminder: isResuming,
      // Reconnect buffer
      outputBuffer: new CircularBuffer<BufferedMessage>(BUFFER_SIZE),
      lastActivityAt: Date.now(),
      disconnectedAt: null,
    };

    this.processes.set(sessionId, claudeProcess);

    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'running',
      sessionId
    );

    this.emitStatus(sessionId, {
      sessionId,
      status: 'running',
    });

    // Handle stdout - JSON messages
    proc.stdout?.on('data', (data: Buffer) => {
      this.handleJsonOutput(sessionId, data.toString());
    });

    // Handle stderr
    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`Claude stderr [${sessionId}]:`, data.toString());
    });

    proc.on('exit', (exitCode) => {
      console.log(`Claude process for session ${sessionId} exited with code ${exitCode}`);
      this.cleanupProcess(sessionId);
    });

    proc.on('error', (err) => {
      console.error(`Claude process error [${sessionId}]:`, err);
      this.cleanupProcess(sessionId);
    });
  }

  private handleJsonOutput(sessionId: string, data: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    proc.buffer += data;

    // Process complete JSON lines
    const lines = proc.buffer.split('\n');
    proc.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const msg: StreamJsonMessage = JSON.parse(line);
        this.processStreamMessage(sessionId, msg);
      } catch (e) {
        // Not valid JSON, emit as raw output for debugging
        console.log(`Non-JSON output [${sessionId}]:`, line);
        this.io.to(`session:${sessionId}`).emit('session:output', {
          sessionId,
          content: line + '\n',
          isComplete: false,
        });
      }
    }
  }

  private emitUsage(sessionId: string, proc: ClaudeProcess): void {
    const totalTokens = proc.totalInputTokens + proc.totalOutputTokens +
                       proc.cacheReadTokens + proc.cacheCreationTokens;
    const contextUsedPercent = Math.round((totalTokens / proc.contextWindow) * 100);

    console.log(`[USAGE] Emitting usage for ${sessionId}: model=${proc.model}, tokens=${totalTokens}, context=${contextUsedPercent}%, cost=$${proc.totalCostUsd}`);

    this.io.to(`session:${sessionId}`).emit('session:usage', {
      sessionId,
      inputTokens: proc.totalInputTokens,
      outputTokens: proc.totalOutputTokens,
      cacheReadTokens: proc.cacheReadTokens,
      cacheCreationTokens: proc.cacheCreationTokens,
      totalTokens,
      contextWindow: proc.contextWindow,
      contextUsedPercent,
      totalCostUsd: proc.totalCostUsd,
      model: proc.model,
    });
  }

  private processStreamMessage(sessionId: string, msg: StreamJsonMessage): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    console.log(`[MSG] type=${msg.type} subtype=${msg.subtype || ''} event.type=${msg.event?.type || ''}`);

    // Debug: Log full message for stream_event
    if (msg.type === 'stream_event') {
      console.log(`[MSG] stream_event details:`, JSON.stringify(msg.event).substring(0, 200));
    }

    // Capture session ID and model from init message
    if (msg.type === 'system' && msg.subtype === 'init') {
      if (msg.session_id) {
        proc.claudeSessionId = msg.session_id;
        const db = getDatabase();
        db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?').run(
          msg.session_id,
          sessionId
        );
      }
      // Extract model from init message (it's in the raw JSON)
      const rawMsg = msg as { model?: string };
      if (rawMsg.model) {
        proc.model = rawMsg.model;
      }
    }

    // Handle stream_event wrapper (contains usage info)
    if (msg.type === 'stream_event' && msg.event) {
      const event = msg.event;

      // message_start contains initial usage and model - also means new response is starting
      if (event.type === 'message_start') {
        console.log(`[MSG] message_start - new response beginning`);
        // A new message is starting, Claude is responding
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });
        if (event.message) {
          if (event.message.model) {
            proc.model = event.message.model;
          }
          if (event.message.usage) {
            proc.totalInputTokens = event.message.usage.input_tokens || 0;
            proc.totalOutputTokens = event.message.usage.output_tokens || 0;
            proc.cacheReadTokens = event.message.usage.cache_read_input_tokens || 0;
            proc.cacheCreationTokens = event.message.usage.cache_creation_input_tokens || 0;
            this.emitUsage(sessionId, proc);
          }
        }
      }

      // message_delta contains updated usage and stop_reason
      if (event.type === 'message_delta') {
        if (event.usage) {
          proc.totalInputTokens = event.usage.input_tokens || proc.totalInputTokens;
          proc.totalOutputTokens = event.usage.output_tokens || proc.totalOutputTokens;
          proc.cacheReadTokens = event.usage.cache_read_input_tokens || proc.cacheReadTokens;
          proc.cacheCreationTokens = event.usage.cache_creation_input_tokens || proc.cacheCreationTokens;
          this.emitUsage(sessionId, proc);
        }
        // If stop_reason is tool_use, Claude is about to use a tool - show thinking
        if (event.delta?.stop_reason === 'tool_use') {
          console.log(`[TOOL] Claude is using a tool, showing thinking indicator`);
          // Save any pending streaming content
          if (proc.streamingText.trim().length > 0) {
            this.saveAssistantMessage(sessionId, proc.streamingText.trim());
            proc.streamingText = '';
            proc.isStreaming = false;
          }
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
          });
        }
      }

      // Handle content_block_start inside stream_event
      if (event.type === 'content_block_start') {
        // Check if this is a tool_use block or text block
        const contentBlock = (event as { content_block?: { type: string; name?: string; id?: string } }).content_block;
        if (contentBlock?.type === 'tool_use') {
          // Tool is being called - track it and show indicator
          proc.currentToolName = contentBlock.name || null;
          proc.currentToolId = contentBlock.id || nanoid();
          proc.currentToolInput = '';
          console.log(`[TOOL] Tool starting: ${contentBlock.name} (id: ${proc.currentToolId})`);
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: true,
          });
          if (contentBlock.name) {
            this.io.to(`session:${sessionId}`).emit('session:tool_use', {
              sessionId,
              toolName: contentBlock.name,
              toolId: proc.currentToolId,
              status: 'started',
            });
          }
        } else {
          // Text block - start streaming
          proc.isStreaming = true;
          proc.streamingText = '';
          proc.currentToolName = null;
          proc.currentToolId = null;
          proc.currentToolInput = '';
          // Clear any active agent when text response starts
          if (proc.currentAgentType) {
            console.log(`[AGENT] Agent completed: ${proc.currentAgentType}`);
            this.io.to(`session:${sessionId}`).emit('session:agent', {
              sessionId,
              agentType: proc.currentAgentType,
              status: 'completed',
            });
            proc.currentAgentType = null;
          }
          this.io.to(`session:${sessionId}`).emit('session:thinking', {
            sessionId,
            isThinking: false,
          });
        }
      }

      // Handle content_block_delta inside stream_event
      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type?: string; text?: string; partial_json?: string } | undefined;

        // Handle text streaming
        if (delta?.type === 'text_delta' && delta.text) {
          proc.streamingText += delta.text;
          console.log(`[STREAM] Emitting session:output with text: "${delta.text.substring(0, 50)}..."`);
          this.io.to(`session:${sessionId}`).emit('session:output', {
            sessionId,
            content: delta.text,
            isComplete: false,
          });
        }

        // Handle tool input JSON streaming
        if (delta?.type === 'input_json_delta' && delta.partial_json) {
          proc.currentToolInput += delta.partial_json;
        }
      }

      // Handle content_block_stop inside stream_event
      if (event.type === 'content_block_stop') {
        // Save any streaming text
        if (proc.streamingText.trim().length > 0) {
          this.saveAssistantMessage(sessionId, proc.streamingText.trim());
        }

        // Process completed tool input and emit completion
        if (proc.currentToolName && proc.currentToolInput) {
          console.log(`[TOOL] ${proc.currentToolName} completed with input length: ${proc.currentToolInput.length}`);

          // Emit tool completion with full input data
          try {
            const inputData = JSON.parse(proc.currentToolInput);

            // Store tool info for matching with result later
            if (proc.currentToolId) {
              proc.pendingToolResults = proc.pendingToolResults || new Map();
              proc.pendingToolResults.set(proc.currentToolId, {
                toolName: proc.currentToolName,
                input: inputData,
              });
            }

            this.io.to(`session:${sessionId}`).emit('session:tool_use', {
              sessionId,
              toolName: proc.currentToolName,
              toolId: proc.currentToolId || undefined,
              status: 'completed',
              input: inputData,
            });
          } catch {
            // If parsing fails, just emit with raw input
            this.io.to(`session:${sessionId}`).emit('session:tool_use', {
              sessionId,
              toolName: proc.currentToolName,
              toolId: proc.currentToolId || undefined,
              status: 'completed',
              input: proc.currentToolInput,
            });
          }

          // Handle TodoWrite tool
          if (proc.currentToolName === 'TodoWrite') {
            try {
              const todoInput = JSON.parse(proc.currentToolInput) as { todos?: Array<{ content: string; status: string; activeForm?: string }> };
              if (todoInput.todos && Array.isArray(todoInput.todos)) {
                console.log(`[TODOS] Emitting ${todoInput.todos.length} todos`);
                this.io.to(`session:${sessionId}`).emit('session:todos', {
                  sessionId,
                  todos: todoInput.todos.map((t) => ({
                    content: t.content,
                    status: t.status as 'pending' | 'in_progress' | 'completed',
                    activeForm: t.activeForm,
                  })),
                });
              }
            } catch (err) {
              console.error(`[TODOS] Failed to parse TodoWrite input:`, err);
            }
          }

          // Handle Task tool (agents)
          if (proc.currentToolName === 'Task') {
            try {
              const taskInput = JSON.parse(proc.currentToolInput) as { subagent_type?: string; description?: string };
              if (taskInput.subagent_type) {
                console.log(`[AGENT] Agent starting: ${taskInput.subagent_type} - ${taskInput.description || ''}`);
                proc.currentAgentType = taskInput.subagent_type;
                this.io.to(`session:${sessionId}`).emit('session:agent', {
                  sessionId,
                  agentType: taskInput.subagent_type,
                  description: taskInput.description,
                  status: 'started',
                });
              }
            } catch (err) {
              console.error(`[AGENT] Failed to parse Task input:`, err);
            }
          }
        }

        // Reset state
        proc.isStreaming = false;
        proc.streamingText = '';
        proc.currentToolName = null;
        proc.currentToolId = null;
        proc.currentToolInput = '';
      }
    }

    // Handle result message with final usage
    if (msg.type === 'result') {
      // Clear any active agent on result (safety net)
      if (proc.currentAgentType) {
        console.log(`[AGENT] Agent completed (on result): ${proc.currentAgentType}`);
        this.io.to(`session:${sessionId}`).emit('session:agent', {
          sessionId,
          agentType: proc.currentAgentType,
          status: 'completed',
        });
        proc.currentAgentType = null;
      }
      if (msg.total_cost_usd !== undefined) {
        proc.totalCostUsd = msg.total_cost_usd;
      }
      if (msg.usage) {
        proc.totalInputTokens = msg.usage.input_tokens || proc.totalInputTokens;
        proc.totalOutputTokens = msg.usage.output_tokens || proc.totalOutputTokens;
        proc.cacheReadTokens = msg.usage.cache_read_input_tokens || proc.cacheReadTokens;
        proc.cacheCreationTokens = msg.usage.cache_creation_input_tokens || proc.cacheCreationTokens;
      }
      // Get context window from modelUsage if available
      if (msg.modelUsage) {
        const primaryModel = Object.entries(msg.modelUsage).find(([key]) =>
          key.includes('opus') || key.includes('sonnet')
        );
        if (primaryModel && primaryModel[1].contextWindow) {
          proc.contextWindow = primaryModel[1].contextWindow;
        }
      }
      this.emitUsage(sessionId, proc);
    }

    // Handle content_block_start - begin streaming text
    if (msg.type === 'content_block_start') {
      proc.isStreaming = true;
      proc.streamingText = '';
      // Stop thinking, start showing content
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
    }

    // Handle content_block_delta - stream text in real-time
    if (msg.type === 'content_block_delta' && msg.delta?.text) {
      proc.streamingText += msg.delta.text;
      // Emit streaming content to frontend
      this.io.to(`session:${sessionId}`).emit('session:output', {
        sessionId,
        content: msg.delta.text,
        isComplete: false,
      });
    }

    // Handle content_block_stop - save complete message
    if (msg.type === 'content_block_stop') {
      if (proc.streamingText.trim().length > 0) {
        this.saveAssistantMessage(sessionId, proc.streamingText.trim());
      }
      proc.isStreaming = false;
      proc.streamingText = '';
    }

    // Handle complete assistant messages (non-streaming fallback)
    if (msg.type === 'assistant' && msg.message && !proc.isStreaming) {
      let content = '';
      if (typeof msg.message.content === 'string') {
        content = msg.message.content;
      } else if (Array.isArray(msg.message.content)) {
        content = msg.message.content
          .filter((c) => c.type === 'text' && c.text)
          .map((c) => c.text)
          .join('');
      }

      if (content && content.trim().length > 0) {
        // Stop thinking, show the message
        this.io.to(`session:${sessionId}`).emit('session:thinking', {
          sessionId,
          isThinking: false,
        });

        // Save immediately as separate message
        this.saveAssistantMessage(sessionId, content.trim());
      }
    }

    // Handle tool use - show thinking while tool runs
    if (msg.type === 'tool_use' && msg.tool_use) {
      // Save any pending streaming content before tool use
      if (proc.streamingText.trim().length > 0) {
        this.saveAssistantMessage(sessionId, proc.streamingText.trim());
        proc.streamingText = '';
        proc.isStreaming = false;
      }
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });
      this.io.to(`session:${sessionId}`).emit('session:tool_use', {
        sessionId,
        toolName: msg.tool_use.name,
        status: 'started',
      });
    }

    // Handle user messages in stream (from subagent interactions) - show thinking
    // Also extract tool_result content to update tool executions
    if (msg.type === 'user') {
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: true,
      });

      // Extract tool results from user message content
      const userMsg = msg as { message?: { content?: Array<{ type: string; tool_use_id?: string; content?: string | Array<{ type: string; text?: string }> }> } };
      if (userMsg.message?.content && Array.isArray(userMsg.message.content)) {
        for (const block of userMsg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            // Extract result text
            let resultText = '';
            if (typeof block.content === 'string') {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = block.content
                .filter((c) => c.type === 'text' && c.text)
                .map((c) => c.text)
                .join('\n');
            }

            // Emit tool result update
            if (resultText) {
              console.log(`[TOOL] Result for ${block.tool_use_id}: ${resultText.substring(0, 100)}...`);
              this.io.to(`session:${sessionId}`).emit('session:tool_use', {
                sessionId,
                toolId: block.tool_use_id,
                toolName: proc.pendingToolResults?.get(block.tool_use_id)?.toolName || 'Unknown',
                status: 'completed',
                result: resultText,
              });
              // Clean up pending
              proc.pendingToolResults?.delete(block.tool_use_id);
            }
          }
        }
      }
    }

    // Handle result/completion
    if (msg.type === 'result' || (msg.type === 'system' && msg.subtype === 'turn_end')) {
      // Save any remaining streaming content
      if (proc.streamingText.trim().length > 0) {
        this.saveAssistantMessage(sessionId, proc.streamingText.trim());
        proc.streamingText = '';
        proc.isStreaming = false;
      }
      // Stop thinking indicator
      this.io.to(`session:${sessionId}`).emit('session:thinking', {
        sessionId,
        isThinking: false,
      });
    }
  }

  private saveAssistantMessage(sessionId: string, content: string): void {
    const db = getDatabase();
    const messageId = nanoid();
    const createdAt = new Date().toISOString();

    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
      messageId,
      sessionId,
      'assistant',
      content
    );
    db.prepare('UPDATE sessions SET last_message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      content.substring(0, 200),
      sessionId
    );

    this.io.to(`session:${sessionId}`).emit('session:message', {
      id: messageId,
      sessionId,
      role: 'assistant',
      content,
      createdAt,
    });

    console.log(`Saved assistant message [${sessionId}]: ${content.substring(0, 100)}...`);
  }

  async sendMessage(
    sessionId: string,
    userId: string,
    message: string,
    images?: ImageData[]
  ): Promise<void> {
    let proc = this.processes.get(sessionId);

    if (!proc) {
      await this.startSession(sessionId, userId);
      proc = this.processes.get(sessionId);
      if (!proc) {
        throw new Error('Failed to start session');
      }
      // Wait for Claude to initialize
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    // Handle images
    let imagePaths: string[] = [];
    if (images && images.length > 0) {
      const imageDir = path.join(proc.workingDirectory, '.claude-webui-images');
      await fs.mkdir(imageDir, { recursive: true });

      imagePaths = await Promise.all(
        images.map(async (img, index) => {
          const ext = img.mimeType.split('/')[1] || 'png';
          const filename = `image_${Date.now()}_${index}.${ext}`;
          const filepath = path.join(imageDir, filename);
          const buffer = Buffer.from(img.data, 'base64');
          await fs.writeFile(filepath, buffer);
          return filepath;
        })
      );
    }

    // Build message for Claude (with image instructions and/or working dir reminder if needed)
    let messageForClaude = message;

    // Add working directory reminder for resumed sessions (only once)
    if (proc.needsWorkingDirReminder) {
      const workingDirReminder = `<system-reminder>
IMPORTANT: Your current working directory is: ${proc.workingDirectory}
This is the project you should be working on. All file operations should be relative to this directory.
</system-reminder>

`;
      messageForClaude = workingDirReminder + messageForClaude;
      proc.needsWorkingDirReminder = false;
      console.log(`Added working directory reminder for resumed session [${sessionId}]`);
    }

    if (imagePaths.length > 0) {
      const imageRefs = imagePaths.map((p) => `- ${p}`).join('\n');
      const imagePrompt = `Please analyze the following image files:\n${imageRefs}\nUse the Read tool on these paths.\n\n`;
      messageForClaude = imagePrompt + messageForClaude;
    }

    // Build image metadata for frontend (filename only, served via API)
    const imageMetadata = imagePaths.map((p) => ({
      path: p,
      filename: path.basename(p),
    }));

    // Save user message and emit to frontend (show original message, images as metadata)
    const db = getDatabase();
    const messageId = nanoid();
    const createdAt = new Date().toISOString();
    db.prepare('INSERT INTO messages (id, session_id, role, content) VALUES (?, ?, ?, ?)').run(
      messageId,
      sessionId,
      'user',
      message // Store only the user's original message
    );

    // Emit user message to frontend so it appears in chat
    this.io.to(`session:${sessionId}`).emit('session:message', {
      id: messageId,
      sessionId,
      role: 'user',
      content: message,
      createdAt,
      images: imageMetadata.length > 0 ? imageMetadata : undefined,
    });

    // Emit thinking indicator
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: true,
    });

    // Send as stream-json input (with full message including image instructions)
    const inputMsg = {
      type: 'user',
      message: {
        role: 'user',
        content: messageForClaude,
      },
    };

    proc.process.stdin?.write(JSON.stringify(inputMsg) + '\n');
    console.log(`Sent message [${sessionId}]: ${messageForClaude.substring(0, 100)}...`);
  }

  interrupt(sessionId: string, userId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      throw new Error('Session not running');
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    console.log(`Interrupting session [${sessionId}]`);

    // Clear any pending streaming content
    if (proc.streamingText.trim().length > 0) {
      // Save partial response before interrupt
      this.saveAssistantMessage(sessionId, proc.streamingText.trim() + '\n\n[Interrupted]');
      proc.streamingText = '';
      proc.isStreaming = false;
    }

    // Stop thinking indicator
    this.io.to(`session:${sessionId}`).emit('session:thinking', {
      sessionId,
      isThinking: false,
    });

    // Send interrupt signal
    proc.process.kill('SIGINT');
  }

  async sendRawInput(sessionId: string, userId: string, input: string): Promise<void> {
    // In stream-json mode, raw input is treated as a user message
    await this.sendMessage(sessionId, userId, input);
  }

  /**
   * Inject a tool result directly into Claude's stdin.
   * Used for tools like AskUserQuestion where we handle the interaction
   * externally and need to provide the result directly.
   */
  injectToolResult(sessionId: string, toolUseId: string, result: unknown): void {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      console.error(`[TOOL-INJECT] Session ${sessionId} not found`);
      return;
    }

    // Format as a tool_result message
    const toolResultMsg = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: typeof result === 'string' ? result : JSON.stringify(result),
          },
        ],
      },
    };

    console.log(`[TOOL-INJECT] Injecting tool result for ${toolUseId} in session ${sessionId}`);
    console.log(`[TOOL-INJECT] Result: ${JSON.stringify(result).substring(0, 200)}...`);

    proc.process.stdin?.write(JSON.stringify(toolResultMsg) + '\n');
  }

  stopSession(sessionId: string, userId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) {
      return;
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    // Close stdin to signal end
    proc.process.stdin?.end();

    setTimeout(() => {
      if (this.processes.has(sessionId)) {
        proc.process.kill();
        this.cleanupProcess(sessionId);
      }
    }, 2000);
  }

  // Restart a session (stop and start fresh)
  async restartSession(sessionId: string, userId: string): Promise<void> {
    console.log(`[SESSION] Restarting session ${sessionId}`);

    const proc = this.processes.get(sessionId);
    const currentMode = proc?.mode ?? this.pendingModes.get(sessionId) ?? 'auto-accept';

    // Stop if running
    if (proc) {
      if (proc.userId !== userId) {
        throw new Error('Unauthorized');
      }

      // Kill the process immediately
      proc.process.kill('SIGTERM');
      this.processes.delete(sessionId);
    }

    // Clear claude_session_id to start fresh (not resume)
    const db = getDatabase();
    db.prepare('UPDATE sessions SET status = ?, claude_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'stopped',
      sessionId
    );
    console.log(`[SESSION] Cleared claude_session_id for fresh start`);

    // Wait a moment for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));

    // Start fresh with the same mode
    await this.startSession(sessionId, userId, currentMode);

    console.log(`[SESSION] Session ${sessionId} restarted`);
  }

  // Set permission mode for a session
  setMode(sessionId: string, userId: string, mode: SessionMode): void {
    const proc = this.processes.get(sessionId);

    // If no process running, store the mode for when it starts
    if (!proc) {
      console.log(`[MODE] No running process for ${sessionId}, storing mode ${mode} for next start`);
      this.pendingModes.set(sessionId, mode);
      return;
    }

    if (proc.userId !== userId) {
      throw new Error('Unauthorized');
    }

    if (proc.mode === mode) {
      console.log(`[MODE] Session ${sessionId} already in mode ${mode}`);
      return;
    }

    console.log(`[MODE] Changing session ${sessionId} from ${proc.mode} to ${mode}`);

    // Store the new mode
    const previousMode = proc.mode;
    proc.mode = mode;

    // For mode changes on running sessions, we need to restart the process
    // Save any pending streaming content first
    if (proc.streamingText.trim().length > 0) {
      this.saveAssistantMessage(sessionId, proc.streamingText.trim());
      proc.streamingText = '';
      proc.isStreaming = false;
    }

    // Kill the current process and restart with new mode
    proc.process.kill('SIGTERM');

    // Wait a bit for the process to terminate, then restart
    setTimeout(async () => {
      this.processes.delete(sessionId);
      try {
        await this.startSession(sessionId, userId, mode);
        console.log(`[MODE] Session ${sessionId} restarted with mode ${mode}`);
      } catch (err) {
        console.error(`[MODE] Failed to restart session ${sessionId}:`, err);
        // Revert mode on failure
        const newProc = this.processes.get(sessionId);
        if (newProc) {
          newProc.mode = previousMode;
        }
      }
    }, 1000);
  }

  private cleanupProcess(sessionId: string): void {
    const proc = this.processes.get(sessionId);
    if (!proc) return;

    this.processes.delete(sessionId);

    const db = getDatabase();
    db.prepare('UPDATE sessions SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      'stopped',
      sessionId
    );

    this.emitStatus(sessionId, {
      sessionId,
      status: 'stopped',
    });
  }

  getRunningSessionIds(): string[] {
    return Array.from(this.processes.keys());
  }
}
