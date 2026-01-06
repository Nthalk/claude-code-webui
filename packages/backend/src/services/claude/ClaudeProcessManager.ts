import type {Server} from 'socket.io';
import type {
    BufferedMessage,
    ClientToServerEvents,
    InterServerEvents,
    ModelType,
    ServerToClientEvents,
    SessionMode,
    SocketData,
} from '@claude-code-webui/shared';
import {getDatabase} from '../../db';
import {replaceTodos, deleteTodosBySessionId} from '../../db/todos.js';
import {nanoid} from 'nanoid';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {ChildProcess, spawn as cpSpawn} from 'child_process';
import {config} from '../../config';
import {getHookJson} from './hooks';

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
        input?: unknown;
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
    // Auto-compacting state
    isCompacting: boolean;
    hasAutoCompacted: boolean;
    compactStartTime?: number;
    compactStartContext?: number;
    // Compaction buffering
    compactionBuffer: any[];
    waitingForContextUpdate: boolean;
    isDetectingCompaction: boolean;
    // Context threshold management
    isCheckingContext: boolean;
    outgoingMessageQueue: Array<{
        message: string;
        images?: ImageData[];
        suppressSaving?: boolean;
    }>;
    contextCheckThreshold: number; // Percentage at which to start checking
    // Context relay counter - increment when user runs /context
    relayContextMessage: number;
}

const MODEL_IDS: Record<ModelType, string> = {
    opus: 'claude-opus-4-20250514',
    sonnet: 'claude-sonnet-4-20250514',
    haiku: 'claude-haiku-3-5-20241022',
};

export class ClaudeProcessManager {
    private processes: Map<string, ClaudeProcess> = new Map();
    private pendingModes: Map<string, SessionMode> = new Map(); // Store modes for sessions not yet started
    private pendingModels: Map<string, ModelType> = new Map(); // Store models for sessions not yet started
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


    // Get the path to the WebUI MCP server script
    private getMcpServerScriptPath(): string {
        // Similar logic to permission prompt script
        // In dev (tsx): __dirname = packages/backend/src/services/claude
        // MCP server is at: packages/backend/src/mcp/webui-server.ts

        // First, try relative to source (development)
        // From services/claude/ to mcp/ is ../../mcp/
        const devPath = path.resolve(__dirname, '../../mcp/webui-server.ts');
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


    // Generate MCP config JSON string for --mcp-config flag
    private getMcpConfigJson(sessionId: string, workingDirectory: string, mode: SessionMode): string {
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

        return JSON.stringify(mcpConfig);
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

    // Get current usage for a session
    getCurrentUsage(sessionId: string): void {
        const proc = this.processes.get(sessionId);
        if (proc) {
            this.emitUsage(sessionId, proc);
        }
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

    async startSession(sessionId: string, userId: string, mode?: SessionMode, model?: ModelType): Promise<void> {
        const db = getDatabase();

        const session = db
            .prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
            .get(sessionId, userId) as {
            working_directory: string;
            claude_session_id: string | null;
            model?: string;
            mode?: string;
        } | undefined;

        if (!session) {
            throw new Error('Session not found');
        }

        if (this.processes.has(sessionId)) {
            return;
        }

        // Use provided mode, or pending mode, or session's stored mode, or default to 'auto-accept'
        const effectiveMode = mode ?? this.pendingModes.get(sessionId) ?? (session.mode as SessionMode) ?? 'auto-accept';
        this.pendingModes.delete(sessionId); // Clear pending mode once used
        console.log(`[MODE] Starting session ${sessionId} with mode ${effectiveMode}`);

        // Use provided model, or pending model, or session's stored model, or default to 'opus'
        const effectiveModel: ModelType = model ?? this.pendingModels.get(sessionId) ?? (session.model as ModelType) ?? 'opus';
        this.pendingModels.delete(sessionId); // Clear pending model once used
        const modelId = MODEL_IDS[effectiveModel];
        console.log(`[MODEL] Starting session ${sessionId} with model ${effectiveModel} (${modelId})`);

        // Build command args for stream-json mode
        const args: string[] = [
            '--print',
            '--verbose',
            '--output-format', 'stream-json',
            '--input-format', 'stream-json',
            '--include-partial-messages',
            '--model', modelId,
        ];

        // Add MCP config for WebUI tools (ask_user, permission_prompt, etc.)
        // Pass the mode so the MCP server knows how to handle permissions
        const mcpConfigJson = this.getMcpConfigJson(sessionId, session.working_directory, effectiveMode);
        args.push('--mcp-config', mcpConfigJson);

        // Use MCP tool for all permission prompts
        // The MCP server will auto-approve in 'danger' mode
        args.push('--permission-prompt-tool', 'mcp__webui__permission_prompt');

        // Configure hooks for path transform and ban AskUserQuestion
        const hookSettings = getHookJson();
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
            // Auto-compacting state
            isCompacting: false,
            hasAutoCompacted: false,
            // Compaction buffering
            compactionBuffer: [],
            waitingForContextUpdate: false,
            isDetectingCompaction: false,
            // Context threshold management
            isCheckingContext: false,
            outgoingMessageQueue: [],
            contextCheckThreshold: 80, // Start checking at 80% usage
            // Context relay counter
            relayContextMessage: 0,
        };

        this.processes.set(sessionId, claudeProcess);

        db.prepare('UPDATE sessions SET status = ?, session_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            'running',
            'active',
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
        // Total input = Input + Cache Create + Cache Read
        // Total output = Output
        // Total contextWindowTokens = Total input + Total output
        const totalInputTokens = proc.totalInputTokens + proc.cacheCreationTokens + proc.cacheReadTokens;
        const totalTokens = totalInputTokens + proc.totalOutputTokens;
        const contextUsedPercent = Math.round((totalTokens / proc.contextWindow) * 100);
        // For UI display: show remaining buffer as positive percentage, or negative when over limit
        // If we're at 138% used, we want to show -38% buffer
        const contextRemainingPercent = 100 - contextUsedPercent;

        console.log(`[USAGE] Emitting usage for ${sessionId}: model=${proc.model}, tokens=${totalTokens}, context=${contextRemainingPercent}% remaining, cost=$${proc.totalCostUsd}`);

        this.io.to(`session:${sessionId}`).emit('session:usage', {
            sessionId,
            inputTokens: proc.totalInputTokens,
            outputTokens: proc.totalOutputTokens,
            cacheReadTokens: proc.cacheReadTokens,
            cacheCreationTokens: proc.cacheCreationTokens,
            totalTokens,
            contextWindow: proc.contextWindow,
            contextUsedPercent,
            contextRemainingPercent,
            totalCostUsd: proc.totalCostUsd,
            model: proc.model,
        });

        // Store token usage in database
        try {
            const db = getDatabase();
            const existingUsage = db.prepare(`
                SELECT id FROM token_usage WHERE session_id = ?
            `).get(sessionId) as any;

            if (existingUsage) {
                // Update existing usage
                db.prepare(`
                    UPDATE token_usage SET
                        input_tokens = ?,
                        output_tokens = ?,
                        cache_read_tokens = ?,
                        cache_creation_tokens = ?,
                        total_tokens = ?,
                        context_window = ?,
                        context_used_percent = ?,
                        total_cost_usd = ?,
                        model = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(
                    proc.totalInputTokens,
                    proc.totalOutputTokens,
                    proc.cacheReadTokens,
                    proc.cacheCreationTokens,
                    totalTokens,
                    proc.contextWindow,
                    contextUsedPercent,
                    proc.totalCostUsd,
                    proc.model,
                    existingUsage.id
                );
            } else {
                // Insert new usage record
                db.prepare(`
                    INSERT INTO token_usage (
                        id, session_id, input_tokens, output_tokens,
                        cache_read_tokens, cache_creation_tokens, total_tokens,
                        context_window, context_used_percent, total_cost_usd, model
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    nanoid(),
                    sessionId,
                    proc.totalInputTokens,
                    proc.totalOutputTokens,
                    proc.cacheReadTokens,
                    proc.cacheCreationTokens,
                    totalTokens,
                    proc.contextWindow,
                    contextUsedPercent,
                    proc.totalCostUsd,
                    proc.model
                );
            }
        } catch (error) {
            console.error(`[USAGE] Failed to store usage in database:`, error);
        }

        // Check for auto-compact if not already compacting or already auto-compacted
        if (!proc.isCompacting && !proc.hasAutoCompacted && contextRemainingPercent < 100) {
            const db = getDatabase();
            const settings = db
                .prepare(
                    `SELECT auto_compact_enabled as autoCompactEnabled, auto_compact_threshold as autoCompactThreshold
                     FROM user_settings
                     WHERE user_id = ?`
                )
                .get(proc.userId) as { autoCompactEnabled: number; autoCompactThreshold: number } | undefined;

            if (settings && settings.autoCompactEnabled) {
                // Convert threshold from "usage" to "remaining" semantics
                // If threshold is 95% (meaning compact at 95% used), we should compact when 5% remaining
                const remainingThreshold = 100 - settings.autoCompactThreshold;
                if (contextRemainingPercent <= remainingThreshold) {
                    console.log(`[AUTO-COMPACT] Suspected overage for session ${sessionId}: ${contextRemainingPercent}% remaining <= ${remainingThreshold}% threshold (${settings.autoCompactThreshold}% usage threshold)`);

                    // Mark that we've attempted auto-compact (to prevent repeated attempts)
                    proc.hasAutoCompacted = true;

                    // Start checking context to verify if we actually need to compact
                    if (!proc.isCheckingContext) {
                        proc.isCheckingContext = true;
                        console.log(`[AUTO-COMPACT] Checking context to verify if compaction is needed`);
                        this.sendMessage(sessionId, proc.userId, '/context', undefined, true);
                    }
                }
            }
        }
    }

    private processStreamMessage(sessionId: string, msg: StreamJsonMessage): void {
        const proc = this.processes.get(sessionId);
        if (!proc) return;

        console.log(`[MSG] type=${msg.type} subtype=${msg.subtype || ''} event.type=${msg.event?.type || ''}`);

        // Debug: Log full message for stream_event
        if (msg.type === 'stream_event') {
            console.log(`[MSG] stream_event details:`, JSON.stringify(msg.event).substring(0, 200));
        }

        // Emit debug event for received message
        this.io.to(`session:${sessionId}`).emit('debug:claude:message', {
            sessionId,
            message: msg,
        });

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

        // Handle system status messages
        if (msg.type === 'system' && msg.subtype === 'status') {
            const statusMsg = msg as { status?: string };
            if (statusMsg.status === 'compacting') {
                console.log(`[COMPACT] Detected compaction starting for session ${sessionId}`);
                proc.isDetectingCompaction = true;
                proc.compactionBuffer = [];

                // NOW we know Claude is actually compacting, so set the compacting state
                proc.isCompacting = true;
                proc.compactStartTime = Date.now();
                proc.compactStartContext = proc.totalInputTokens + proc.totalOutputTokens;

                // Save compact start meta message
                this.saveMetaMessage(sessionId, 'compact', {
                    startContext: proc.compactStartContext,
                    endContext: 0, // Will be updated when complete
                    isActive: true,
                });

                // Emit compacting status
                this.io.to(`session:${sessionId}`).emit('session:compacting', {
                    sessionId,
                    isCompacting: true,
                });
            }
        }

        // Handle compact boundary
        if (msg.type === 'system' && msg.subtype === 'compact_boundary') {
            console.log(`[COMPACT] Detected compact boundary for session ${sessionId}`);
            proc.isDetectingCompaction = false;

            // Clear buffer (we no longer buffer incoming messages)
            proc.compactionBuffer = [];

            // Send /context command automatically
            console.log(`[COMPACT] Sending /context command for session ${sessionId}`);
            proc.waitingForContextUpdate = true;

            // If we have queued messages, mark that we're checking context
            if (proc.outgoingMessageQueue.length > 0) {
                console.log(`[COMPACT] Have ${proc.outgoingMessageQueue.length} queued messages, will check context after compact`);
                proc.isCheckingContext = true;
            }

            this.sendMessage(sessionId, proc.userId, '/context', undefined, true);

            // Update compact metadata
            const compactMsg = msg as { compact_metadata?: { trigger?: string; pre_tokens?: number } };
            if (compactMsg.compact_metadata) {
                this.saveMetaMessage(sessionId, 'compact', {
                    trigger: compactMsg.compact_metadata.trigger,
                    preTokens: compactMsg.compact_metadata.pre_tokens,
                    isActive: false,
                });
            }

            this.io.to(`session:${sessionId}`).emit('session:compacting', {
                sessionId,
                isCompacting: false,
            });
        }

        // During compaction, we should still display incoming messages from Claude
        // Only outgoing messages (from user to Claude) should be buffered when approaching context limit
        // Remove this incorrect buffering of incoming messages

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
                const contentBlock = (event as {
                    content_block?: { type: string; name?: string; id?: string }
                }).content_block;
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
                        // Save tool execution to database
                        this.saveToolExecution(sessionId, proc.currentToolId, contentBlock.name);

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

                    // Check if we're receiving /context output
                    if (proc.streamingText.includes('## Context Usage') &&
                        proc.streamingText.includes('Model:') &&
                        proc.streamingText.includes('Tokens:')) {

                        const contextData = this.parseContextOutput(proc.streamingText);
                        if (contextData) {
                            console.log(`[CONTEXT] Parsed authoritative usage: ${contextData.tokens} / ${contextData.contextWindow} (${contextData.usedPercent}%)`);

                            // Update process state with authoritative values from /context
                            if (contextData.model) proc.model = contextData.model;
                            if (contextData.tokens) {
                                // The /context output shows total tokens in use, not broken down by type
                                // Reset all token counters and use the total from /context as input tokens
                                proc.totalInputTokens = contextData.tokens;
                                proc.totalOutputTokens = 0;
                                proc.cacheReadTokens = 0;
                                proc.cacheCreationTokens = 0;
                            }
                            if (contextData.contextWindow) proc.contextWindow = contextData.contextWindow;

                            // Emit usage update with authoritative values
                            this.emitUsage(sessionId, proc);

                            // If we were checking context for buffered messages
                            if (proc.isCheckingContext && contextData.usedPercent !== undefined) {
                                console.log(`[CONTEXT] Got context update: ${contextData.usedPercent}% used`);
                                proc.isCheckingContext = false;

                                // Check if we need to compact
                                if (contextData.usedPercent >= 100) {
                                    console.log(`[CONTEXT] Need to compact - at ${contextData.usedPercent}% usage`);

                                    // NOW we know we need to compact, so set the compacting state
                                    proc.isCompacting = true;
                                    proc.compactStartTime = Date.now();
                                    proc.compactStartContext = proc.totalInputTokens + proc.totalOutputTokens;

                                    // Save compact start meta message
                                    this.saveMetaMessage(sessionId, 'compact', {
                                        startContext: proc.compactStartContext,
                                        endContext: 0, // Will be updated when complete
                                        isActive: true,
                                    });

                                    // Emit compacting status
                                    this.io.to(`session:${sessionId}`).emit('session:compacting', {
                                        sessionId,
                                        isCompacting: true,
                                    });

                                    // Send compact command
                                    this.sendMessage(sessionId, proc.userId, '/compact', undefined, true);
                                } else {
                                    console.log(`[CONTEXT] No compact needed - at ${contextData.usedPercent}% usage`);
                                    // Process queued messages
                                    this.processQueuedMessages(sessionId);
                                }
                            }
                        } else if (proc.isCheckingContext) {
                            // Safety reset: context output detected but parsing failed
                            console.log(`[CONTEXT] WARNING: Context output detected but parsing failed, resetting isCheckingContext`);
                            console.log(`[CONTEXT] Raw content: ${proc.streamingText.substring(0, 500)}`);
                            proc.isCheckingContext = false;
                            // Process any queued messages to prevent stuck state
                            this.processQueuedMessages(sessionId);
                        }
                    }

                    // Emit full accumulated text to avoid out-of-order issues (unless compacting)
                    if (!proc.isCompacting) {
                        this.io.to(`session:${sessionId}`).emit('session:output', {
                            sessionId,
                            content: proc.streamingText,
                            isComplete: false,
                        });
                    }
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

                // Process tool input (but don't mark as completed yet - wait for result)
                if (proc.currentToolName && proc.currentToolInput) {
                    console.log(`[TOOL] ${proc.currentToolName} input received, length: ${proc.currentToolInput.length}`);

                    // Parse and store tool input for matching with result later
                    try {
                        const inputData = JSON.parse(proc.currentToolInput);

                        // Store tool info for matching with result later
                        if (proc.currentToolId) {
                            proc.pendingToolResults = proc.pendingToolResults || new Map();
                            proc.pendingToolResults.set(proc.currentToolId, {
                                toolName: proc.currentToolName,
                                input: inputData,
                            });

                            // Update tool execution with input in database (but keep status as started)
                            this.updateToolExecution(proc.currentToolId, {input: inputData});
                        }

                        // Emit input update (keep status as started - will complete when result arrives)
                        this.io.to(`session:${sessionId}`).emit('session:tool_use', {
                            sessionId,
                            toolName: proc.currentToolName,
                            toolId: proc.currentToolId || undefined,
                            status: 'started',
                            input: inputData,
                        });
                    } catch {
                        // If parsing fails, just update with raw input
                        if (proc.currentToolId) {
                            this.updateToolExecution(proc.currentToolId, {input: proc.currentToolInput});
                        }

                        this.io.to(`session:${sessionId}`).emit('session:tool_use', {
                            sessionId,
                            toolName: proc.currentToolName,
                            toolId: proc.currentToolId || undefined,
                            status: 'started',
                            input: proc.currentToolInput,
                        });
                    }

                    // Handle TodoWrite tool
                    if (proc.currentToolName === 'TodoWrite') {
                        try {
                            const todoInput = JSON.parse(proc.currentToolInput) as {
                                todos?: Array<{ content: string; status: string; activeForm?: string }>
                            };
                            if (todoInput.todos && Array.isArray(todoInput.todos)) {
                                console.log(`[TODOS] Saving ${todoInput.todos.length} todos to database`);

                                const todoItems = todoInput.todos.map((t) => ({
                                    content: t.content,
                                    status: t.status as 'pending' | 'in_progress' | 'completed',
                                    activeForm: t.activeForm,
                                }));

                                // Save to database
                                replaceTodos(sessionId, todoItems);

                                // Buffer the todos for reconnection
                                this.bufferMessage(sessionId, 'todos', { todos: todoItems });

                                // Emit to connected clients
                                this.io.to(`session:${sessionId}`).emit('session:todos', {
                                    sessionId,
                                    todos: todoItems,
                                });
                            }
                        } catch (err) {
                            console.error(`[TODOS] Failed to parse TodoWrite input:`, err);
                        }
                    }

                    // Handle Task tool (agents)
                    if (proc.currentToolName === 'Task') {
                        try {
                            const taskInput = JSON.parse(proc.currentToolInput) as {
                                subagent_type?: string;
                                description?: string
                            };
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
            // Emit streaming content to frontend (unless compacting)
            if (!proc.isCompacting) {
                this.io.to(`session:${sessionId}`).emit('session:output', {
                    sessionId,
                    content: msg.delta.text,
                    isComplete: false,
                });
            }
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

            // Get tool id from the message (or generate one)
            const toolId = msg.tool_use.id || nanoid();
            const toolName = msg.tool_use.name;

            // Track tool in process state
            proc.currentToolId = toolId;
            proc.currentToolName = toolName;
            proc.currentToolInput = '';

            // Save to database
            if (toolName) {
                this.saveToolExecution(sessionId, toolId, toolName, msg.tool_use.input);
            }

            this.io.to(`session:${sessionId}`).emit('session:thinking', {
                sessionId,
                isThinking: true,
            });
            this.io.to(`session:${sessionId}`).emit('session:tool_use', {
                sessionId,
                toolName,
                toolId,
                status: 'started',
                input: msg.tool_use.input,
            });
        }

        // Handle user messages in stream (from subagent interactions) - show thinking
        // Also extract tool_result content to update tool executions
        if (msg.type === 'user') {
            this.io.to(`session:${sessionId}`).emit('session:thinking', {
                sessionId,
                isThinking: true,
            });

            // Extract tool results and command output from user message content
            const userMsg = msg as {
                message?: {
                    role?: string;
                    content?: string | Array<{
                        type: string;
                        tool_use_id?: string;
                        content?: string | Array<{ type: string; text?: string }>
                    }>
                }
            };

            // Handle simple string content (could contain local-command-stdout)
            if (userMsg.message?.content && typeof userMsg.message.content === 'string') {
                const content = userMsg.message.content;

                // Check for local-command-stdout content
                const commandOutputMatch = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
                if (commandOutputMatch && commandOutputMatch[1]) {
                    const commandOutput = commandOutputMatch[1];
                    console.log(`[COMMAND] Detected command output from Claude`);

                    // Check if this is /context output
                    if (commandOutput.includes('## Context Usage') &&
                        commandOutput.includes('Model:') &&
                        commandOutput.includes('Tokens:')) {

                        const contextData = this.parseContextOutput(commandOutput);
                        const proc = this.processes.get(sessionId);
                        if (contextData && proc) {
                            console.log(`[CONTEXT] Parsed authoritative usage from command: ${contextData.tokens} / ${contextData.contextWindow} (${contextData.usedPercent}%)`);

                            // Update process state with authoritative values from /context
                            if (contextData.model) proc.model = contextData.model;
                            if (contextData.tokens) {
                                // The /context output shows total tokens in use, not broken down by type
                                // Reset all token counters and use the total from /context as input tokens
                                proc.totalInputTokens = contextData.tokens;
                                proc.totalOutputTokens = 0;
                                proc.cacheReadTokens = 0;
                                proc.cacheCreationTokens = 0;
                            }
                            if (contextData.contextWindow) proc.contextWindow = contextData.contextWindow;

                            // Emit usage update with authoritative values
                            this.emitUsage(sessionId, proc);

                            // Handle context checking flow
                            if (proc.isCheckingContext && contextData.usedPercent !== undefined) {
                                console.log(`[CONTEXT] Got context update from manual command: ${contextData.usedPercent}% used`);
                                proc.isCheckingContext = false;

                                // Check if we need to compact
                                if (contextData.usedPercent >= 100) {
                                    console.log(`[CONTEXT] Need to compact - at ${contextData.usedPercent}% usage`);

                                    // NOW we know we need to compact, so set the compacting state
                                    proc.isCompacting = true;
                                    proc.compactStartTime = Date.now();
                                    proc.compactStartContext = proc.totalInputTokens + proc.totalOutputTokens;

                                    // Save compact start meta message
                                    this.saveMetaMessage(sessionId, 'compact', {
                                        startContext: proc.compactStartContext,
                                        endContext: 0, // Will be updated when complete
                                        isActive: true,
                                    });

                                    // Emit compacting status
                                    this.io.to(`session:${sessionId}`).emit('session:compacting', {
                                        sessionId,
                                        isCompacting: true,
                                    });

                                    // Send compact command
                                    this.sendMessage(sessionId, proc.userId, '/compact', undefined, true);
                                } else {
                                    console.log(`[CONTEXT] No compact needed - at ${contextData.usedPercent}% usage`);
                                    // Process queued messages
                                    this.processQueuedMessages(sessionId);
                                }
                            }
                        } else if (proc?.isCheckingContext) {
                            // Safety reset: context output detected but parsing failed
                            console.log(`[CONTEXT] WARNING: Context output (command) detected but parsing failed, resetting isCheckingContext`);
                            console.log(`[CONTEXT] Raw command output: ${commandOutput.substring(0, 500)}`);
                            proc.isCheckingContext = false;
                            // Process any queued messages to prevent stuck state
                            this.processQueuedMessages(sessionId);
                        }
                    }

                    // Check if we should relay this context message to the user
                    const proc = this.processes.get(sessionId);
                    const isContextCommand = commandOutput.includes('## Context Usage');
                    const shouldRelay = !isContextCommand || (proc && proc.relayContextMessage > 0);

                    if (shouldRelay) {
                        // Emit as command_output event (creates meta message in frontend)
                        const commandOutputData = {
                            sessionId,
                            output: commandOutput,
                        };
                        this.bufferMessage(sessionId, 'command_output', commandOutputData);
                        this.io.to(`session:${sessionId}`).emit('session:command_output', commandOutputData);

                        // Decrement counter if this was a context command
                        if (isContextCommand && proc && proc.relayContextMessage > 0) {
                            proc.relayContextMessage--;
                            console.log(`[CONTEXT] Relayed context message, counter now: ${proc.relayContextMessage}`);
                        }
                    } else {
                        console.log(`[CONTEXT] Suppressing context output (counter: ${proc?.relayContextMessage || 0})`);
                    }
                }
            }

            // Handle array content (tool results)
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

                            // Update tool execution with result in database
                            this.updateToolExecution(block.tool_use_id, {
                                status: 'completed',
                                result: resultText,
                            });

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

            // If we were compacting, mark it as complete
            if (proc.isCompacting) {
                proc.isCompacting = false;
                const endContext = proc.totalInputTokens + proc.totalOutputTokens;
                const duration = proc.compactStartTime ? Date.now() - proc.compactStartTime : undefined;

                console.log(`[AUTO-COMPACT] Compaction complete for session ${sessionId}`);

                // Save compact complete meta message
                this.saveMetaMessage(sessionId, 'compact', {
                    startContext: proc.compactStartContext || 0,
                    endContext,
                    duration,
                    isActive: false,
                });

                this.io.to(`session:${sessionId}`).emit('session:compacting', {
                    sessionId,
                    isCompacting: false,
                });
            }

            // Safety reset: if we were checking context and the turn ended, reset the flag
            // This prevents stuck state if context output wasn't properly detected
            if (proc.isCheckingContext) {
                console.log(`[CONTEXT] WARNING: Turn ended while still checking context, resetting isCheckingContext`);
                proc.isCheckingContext = false;
                // Process any queued messages to prevent stuck state
                this.processQueuedMessages(sessionId);
            }
        }
    }

    private saveAssistantMessage(sessionId: string, content: string): void {
        const proc = this.processes.get(sessionId);

        // Suppress messages during auto-compacting
        if (proc?.isCompacting) {
            console.log(`[AUTO-COMPACT] Suppressing assistant message during compaction`);
            return;
        }

        // Handle conversation resumed message
        if (content.trim() === 'Conversation resumed successfully.' ||
            content.trim().startsWith('Conversation resumed')) {
            console.log(`[RESUME] Converting conversation resumed to meta message`);
            this.saveMetaMessage(sessionId, 'resume', {});
            return;
        }

        const db = getDatabase();
        const messageId = nanoid();
        const createdAt = new Date().toISOString();

        // Use explicit createdAt to ensure millisecond precision for proper ordering
        db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
            messageId,
            sessionId,
            'assistant',
            content,
            createdAt
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

    private saveMetaMessage(sessionId: string, metaType: 'compact' | 'resume' | 'restart' | 'command_output', metaData: any): void {
        const db = getDatabase();
        const messageId = nanoid();
        const createdAt = new Date().toISOString();

        // Insert meta message with serialized metadata
        db.prepare('INSERT INTO messages (id, session_id, role, content, created_at, meta_type, meta_data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            messageId,
            sessionId,
            'meta',
            '', // Meta messages have empty content
            createdAt,
            metaType,
            JSON.stringify(metaData)
        );

        // Emit meta message to frontend
        this.io.to(`session:${sessionId}`).emit('session:message', {
            id: messageId,
            sessionId,
            role: 'meta',
            content: '',
            createdAt,
            metaType,
            metaData,
        });

        console.log(`Saved meta message [${sessionId}]: ${metaType}`, metaData);
    }

    private saveToolExecution(
        sessionId: string,
        toolId: string,
        toolName: string,
        input?: unknown,
        status: 'started' | 'completed' | 'error' = 'started'
    ): void {
        const db = getDatabase();
        const inputStr = input ? JSON.stringify(input) : null;
        const createdAt = new Date().toISOString();

        // Use explicit createdAt to ensure millisecond precision for proper ordering
        db.prepare(
            'INSERT INTO tool_executions (id, session_id, tool_name, input, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(toolId, sessionId, toolName, inputStr, status, createdAt);

        console.log(`[TOOL DB] Saved tool execution: ${toolName} (${toolId}) - ${status}`);
    }

    private updateToolExecution(
        toolId: string,
        updates: { status?: 'started' | 'completed' | 'error'; result?: string; error?: string; input?: unknown }
    ): void {
        const db = getDatabase();
        const setClauses: string[] = [];
        const values: unknown[] = [];

        if (updates.status) {
            setClauses.push('status = ?');
            values.push(updates.status);
        }
        if (updates.result !== undefined) {
            setClauses.push('result = ?');
            values.push(updates.result);
        }
        if (updates.error !== undefined) {
            setClauses.push('error = ?');
            values.push(updates.error);
        }
        if (updates.input !== undefined) {
            setClauses.push('input = ?');
            values.push(JSON.stringify(updates.input));
        }

        if (setClauses.length > 0) {
            values.push(toolId);
            db.prepare(`UPDATE tool_executions
                        SET ${setClauses.join(', ')}
                        WHERE id = ?`).run(...values);
            console.log(`[TOOL DB] Updated tool execution: ${toolId}`);
        }
    }

    async sendMessage(
        sessionId: string,
        userId: string,
        message: string,
        images?: ImageData[],
        suppressSaving = false
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
            await fs.mkdir(imageDir, {recursive: true});

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

        // Check if this is a user-initiated /context command
        if (!suppressSaving && message.trim() === '/context' && proc) {
            proc.relayContextMessage++;
            console.log(`[CONTEXT] User ran /context command, relay counter: ${proc.relayContextMessage}`);
        }

        // Save user message and emit to frontend (show original message, images as metadata)
        if (!suppressSaving) {
            const db = getDatabase();
            const messageId = nanoid();
            const createdAt = new Date().toISOString();
            // Use explicit createdAt to ensure millisecond precision for proper ordering
            db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
                messageId,
                sessionId,
                'user',
                message, // Store only the user's original message
                createdAt
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
        }

        // Check context usage before sending (skip for system commands like /context, /compact)
        // System commands use suppressSaving=true and must bypass buffering to avoid deadlock
        if (!suppressSaving) {
            const totalInputTokens = proc.totalInputTokens + proc.cacheCreationTokens + proc.cacheReadTokens;
            const totalTokens = totalInputTokens + proc.totalOutputTokens;
            const contextUsedPercent = Math.round((totalTokens / proc.contextWindow) * 100);

            // If we're approaching the threshold or already checking context, buffer the message
            if (contextUsedPercent >= proc.contextCheckThreshold || proc.isCheckingContext) {
                console.log(`[CONTEXT] Buffering message - usage at ${contextUsedPercent}%, threshold is ${proc.contextCheckThreshold}%`);
                proc.outgoingMessageQueue.push({message: messageForClaude, images: undefined, suppressSaving});

                // If not already checking context, start the check
                if (!proc.isCheckingContext) {
                    console.log(`[CONTEXT] Starting context check for session ${sessionId}`);
                    proc.isCheckingContext = true;

                    // Send /context command to get real usage
                    this.sendMessage(sessionId, userId, '/context', undefined, true);
                }

                return; // Don't send the message yet
            }
        }

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

    async interrupt(sessionId: string, userId: string): Promise<void> {
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

        // Deny any pending permissions on interrupt
        const { denyPendingPermissionsForSession } = await import('../../routes/permissions');
        denyPendingPermissionsForSession(sessionId);

        // Deny any pending plan approvals on interrupt
        const { denyPendingPlanApprovalsForSession } = await import('../../routes/plan');
        denyPendingPlanApprovalsForSession(sessionId);

        // Update session status to stopped
        this.io.to(`session:${sessionId}`).emit('session:status', {
            sessionId,
            status: 'stopped',
        });

        // Update database to mark session as inactive
        const db = getDatabase();
        db.prepare('UPDATE sessions SET status = ?, session_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            'stopped',
            'inactive',
            sessionId
        );

        // In stream-json mode, we can't just send Ctrl+C since there's no PTY.
        // Try sending an interrupt message via stdin in stream-json format.
        // If that doesn't work, fall back to SIGINT which may kill the process.
        const interruptMsg = {type: 'interrupt'};
        proc.process.stdin?.write(JSON.stringify(interruptMsg) + '\n');
        console.log(`[INTERRUPT] Sent interrupt message to session ${sessionId}`);
    }

    async sendRawInput(sessionId: string, userId: string, input: string): Promise<void> {
        // In stream-json mode, raw input is treated as a user message
        await this.sendMessage(sessionId, userId, input);
    }

    /**
     * Send raw JSON message to Claude process.
     * Used for debug panel to send arbitrary JSON messages.
     */
    async sendRawJson(sessionId: string, userId: string, jsonMessage: any): Promise<void> {
        const proc = this.processes.get(sessionId);

        if (!proc) {
            await this.startSession(sessionId, userId);
            const newProc = this.processes.get(sessionId);
            if (!newProc) {
                throw new Error('Failed to start session');
            }
            // Wait for Claude to initialize
            await new Promise((resolve) => setTimeout(resolve, 500));
        } else if (proc.userId !== userId) {
            throw new Error('Unauthorized');
        }

        const finalProc = this.processes.get(sessionId);
        if (!finalProc) {
            throw new Error('Session not found');
        }

        // Emit debug event for sent message
        this.io.to(`session:${sessionId}`).emit('debug:claude:sent', {
            sessionId,
            message: jsonMessage,
        });

        // Send the raw JSON
        finalProc.process.stdin?.write(JSON.stringify(jsonMessage) + '\n');
        console.log(`[DEBUG] Sent raw JSON to session ${sessionId}:`, JSON.stringify(jsonMessage).substring(0, 200));
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
        db.prepare('UPDATE sessions SET status = ?, session_state = ?, claude_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            'stopped',
            'inactive',
            sessionId
        );
        console.log(`[SESSION] Cleared claude_session_id for fresh start`);

        // Don't delete messages - we want to preserve chat history
        // Only clear tool executions since those are tied to the Claude session
        const toolsResult = db.prepare('DELETE FROM tool_executions WHERE session_id = ?').run(sessionId);
        console.log(`[SESSION] Deleted ${toolsResult.changes} tool executions`);

        // Clear any pending permissions since the process is gone
        const { clearPendingPermissionsForSession } = await import('../../routes/permissions');
        clearPendingPermissionsForSession(sessionId);

        // Clear any pending plan approvals since the process is gone
        const { clearPendingPlanApprovalsForSession } = await import('../../routes/plan');
        clearPendingPlanApprovalsForSession(sessionId);

        // Clear todos from database since we're starting fresh
        deleteTodosBySessionId(sessionId);
        console.log(`[SESSION] Cleared todos for session ${sessionId}`);

        // Emit restarted event so frontend knows the Claude process restarted
        this.io.to(`session:${sessionId}`).emit('session:restarted', {sessionId});

        // Wait a moment for cleanup
        await new Promise(resolve => setTimeout(resolve, 500));

        // Start fresh with the same mode
        await this.startSession(sessionId, userId, currentMode);

        // Save restart meta message
        this.saveMetaMessage(sessionId, 'restart', {time: new Date().toISOString()});

        console.log(`[SESSION] Session ${sessionId} restarted`);
    }

    // Resume a session (used after backend restart to reconnect without empty message)
    async resumeSession(sessionId: string, userId: string): Promise<void> {
        console.log(`[SESSION] Resuming session ${sessionId}`);

        const proc = this.processes.get(sessionId);
        if (proc) {
            console.log(`[SESSION] Session ${sessionId} is already running`);
            return;
        }

        // Get session details from database
        const db = getDatabase();
        const session = db
            .prepare('SELECT working_directory, claude_session_id, session_state FROM sessions WHERE id = ? AND user_id = ?')
            .get(sessionId, userId) as { working_directory: string; claude_session_id: string | null; session_state: string } | undefined;

        if (!session) {
            throw new Error('Session not found');
        }

        // Check the mode that was set for this session (either from pending or default)
        const mode = this.pendingModes.get(sessionId) ?? 'auto-accept';

        // Start the session - it will automatically resume from previous context
        // because we're keeping the claude_session_id
        await this.startSession(sessionId, userId, mode);

        // Save resume meta message to indicate the conversation was resumed
        this.saveMetaMessage(sessionId, 'resume', { time: new Date().toISOString() });

        // Send an empty message to trigger Claude to continue
        // This is needed when Claude was waiting for a permission response
        setTimeout(() => {
            console.log(`[SESSION] Sending empty message to trigger continuation for session ${sessionId}`);
            this.sendMessage(sessionId, userId, '', undefined, true).catch(err => {
                console.error(`[SESSION] Failed to send continuation message:`, err);
            });
        }, 1000);

        console.log(`[SESSION] Session ${sessionId} resumed with existing context`);
    }

    // Set permission mode for a session
    setMode(sessionId: string, userId: string, mode: SessionMode): void {
        const proc = this.processes.get(sessionId);
        const db = getDatabase();

        // Update the mode in the database
        db.prepare('UPDATE sessions SET mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            mode,
            sessionId
        );

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

        // Emit mode changing event
        this.io.emit('session:mode_changing', {
            sessionId,
            from: proc.mode,
            to: mode
        });

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
                // Emit mode changed event on success
                this.io.emit('session:mode_changed', {
                    sessionId,
                    mode
                });
            } catch (err) {
                console.error(`[MODE] Failed to restart session ${sessionId}:`, err);
                // Revert mode on failure
                const newProc = this.processes.get(sessionId);
                if (newProc) {
                    newProc.mode = previousMode;
                }
                // Emit mode changed event with reverted mode on failure
                this.io.emit('session:mode_changed', {
                    sessionId,
                    mode: previousMode
                });
            }
        }, 1000);
    }

    // Set model for a session
    setModel(sessionId: string, userId: string, model: ModelType): void {
        const proc = this.processes.get(sessionId);
        const db = getDatabase();

        // Update the model in the database
        db.prepare('UPDATE sessions SET model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            model,
            sessionId
        );

        // If no process running, store the model for when it starts
        if (!proc) {
            console.log(`[MODEL] No running process for ${sessionId}, storing model ${model} for next start`);
            this.pendingModels.set(sessionId, model);
            return;
        }

        if (proc.userId !== userId) {
            throw new Error('Unauthorized');
        }

        // Check if model is already the same (avoid unnecessary restart)
        const currentModel = proc.model.includes('opus') ? 'opus' :
            proc.model.includes('haiku') ? 'haiku' :
                proc.model.includes('sonnet') ? 'sonnet' : 'opus';

        if (currentModel === model) {
            console.log(`[MODEL] Session ${sessionId} already using model ${model}`);
            return;
        }

        console.log(`[MODEL] Changing session ${sessionId} from ${currentModel} to ${model}`);

        // Emit model changing event
        this.io.emit('session:model_changing', {
            sessionId,
            from: currentModel as ModelType,
            to: model
        });

        // For model changes on running sessions, we need to restart the process
        // Save any pending streaming content first
        if (proc.streamingText.trim().length > 0) {
            this.saveAssistantMessage(sessionId, proc.streamingText.trim());
            proc.streamingText = '';
            proc.isStreaming = false;
        }

        // Kill the current process and restart with new model
        proc.process.kill('SIGTERM');

        // Wait a bit for the process to terminate, then restart
        setTimeout(async () => {
            this.processes.delete(sessionId);
            try {
                await this.startSession(sessionId, userId, proc.mode, model);
                console.log(`[MODEL] Session ${sessionId} restarted with model ${model}`);
                // Emit model changed event on success
                this.io.emit('session:model_changed', {
                    sessionId,
                    model
                });
            } catch (err) {
                console.error(`[MODEL] Failed to restart session ${sessionId}:`, err);
                // Emit model changed event with current model on failure
                this.io.emit('session:model_changed', {
                    sessionId,
                    model: currentModel as ModelType
                });
            }
        }, 1000);
    }

    private cleanupProcess(sessionId: string): void {
        const proc = this.processes.get(sessionId);
        if (!proc) return;

        this.processes.delete(sessionId);

        const db = getDatabase();
        // Check if there are pending messages - if so, set to 'has-pending' instead of 'inactive'
        const pendingCount = db.prepare('SELECT COUNT(*) as count FROM pending_messages WHERE session_id = ?')
            .get(sessionId) as { count: number } | undefined;
        const newState = (pendingCount?.count ?? 0) > 0 ? 'has-pending' : 'inactive';

        db.prepare('UPDATE sessions SET status = ?, session_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
            'stopped',
            newState,
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

    private parseContextOutput(content: string): {
        model?: string;
        tokens?: number;
        contextWindow?: number;
        usedPercent?: number;
    } | null {
        // Match the model line
        const modelMatch = content.match(/\*\*Model:\*\*\s+(\S+)/);

        // Match the tokens line (e.g., "66.6k / 200.0k (33%)")
        const tokensMatch = content.match(/\*\*Tokens:\*\*\s+([\d.]+)k\s*\/\s*([\d.]+)k\s*\((\d+)%\)/);

        if (modelMatch && modelMatch[1] && tokensMatch && tokensMatch[1] && tokensMatch[2] && tokensMatch[3]) {
            return {
                model: modelMatch[1],
                tokens: parseFloat(tokensMatch[1]) * 1000,
                contextWindow: parseFloat(tokensMatch[2]) * 1000,
                usedPercent: parseInt(tokensMatch[3])
            };
        }

        return null;
    }

    private processQueuedMessages(sessionId: string): void {
        const proc = this.processes.get(sessionId);
        if (!proc) return;

        console.log(`[CONTEXT] Processing ${proc.outgoingMessageQueue.length} queued messages`);

        // Process all queued messages
        const messages = [...proc.outgoingMessageQueue];
        proc.outgoingMessageQueue = [];

        for (const queuedMsg of messages) {
            // Send the message directly (bypassing the check since we just verified context)
            console.log(`[CONTEXT] Sending queued message: ${queuedMsg.message.substring(0, 50)}...`);

            // Emit thinking indicator
            this.io.to(`session:${sessionId}`).emit('session:thinking', {
                sessionId,
                isThinking: true,
            });

            // Send as stream-json input
            const inputMsg = {
                type: 'user',
                message: {
                    role: 'user',
                    content: queuedMsg.message,
                },
            };

            proc.process.stdin?.write(JSON.stringify(inputMsg) + '\n');
        }
    }
}
