/**
 * ClaudeSdkManager - SDK-based implementation of ClaudeManager
 *
 * Uses the Claude Agent SDK instead of spawning CLI processes.
 * Benefits over ClaudeProcessManager:
 * - Direct tool call interception via canUseTool hook
 * - Native async/await for permission handling (no HTTP long-polling)
 * - Typed tool schemas and inputs
 * - No MCP server required for permissions
 */

import type {
    BufferedMessage,
    ModelType,
    SessionMode,
} from '@claude-code-webui/shared';
import {query, type Query, type SDKMessage, type PermissionResult} from '@anthropic-ai/claude-agent-sdk';
import {ClaudeManager, CircularBuffer} from './ClaudeManager';
import {getDatabase} from '../../db';
import {nanoid} from 'nanoid';
import type {
    ImageData,
    SessionOptions,
    SocketIOServer,
    PermissionRequest,
    UserQuestion,
    PlanApprovalRequest,
} from './types';
import {MODEL_IDS} from './types';

// Buffer size for reconnection
const BUFFER_SIZE = 5000;

interface SdkSession {
    sessionId: string;
    userId: string;
    workingDirectory: string;
    claudeSessionId: string | null;
    mode: SessionMode;
    model: string;
    isStreaming: boolean;
    isCompacting: boolean;

    // SDK query instance
    query: Query | null;
    abortController: AbortController;

    // Streaming input generator control
    inputResolvers: Array<{
        resolve: (value: {type: 'user'; message: {role: 'user'; content: string | Array<{type: string; [key: string]: unknown}>}}) => void;
    }>;

    // Pending permission/question promises (resolved by user action)
    pendingPermission: {
        request: PermissionRequest;
        resolve: (result: PermissionResult) => void;
    } | null;
    pendingQuestion: {
        request: UserQuestion;
        resolve: (answers: Record<string, string>) => void;
    } | null;
    pendingPlanApproval: {
        request: PlanApprovalRequest;
        resolve: (approved: boolean) => void;
    } | null;

    // Current streaming state
    currentText: string;
    currentToolName: string | null;
    currentToolId: string | null;

    // Usage tracking
    contextWindow: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalCostUsd: number;

    // Reconnection buffer
    outputBuffer: CircularBuffer<BufferedMessage>;
    lastActivityAt: number;
    disconnectedAt: number | null;
}

/**
 * SDK-based Claude manager using @anthropic-ai/claude-agent-sdk
 */
export class ClaudeSdkManager extends ClaudeManager {
    private sessions: Map<string, SdkSession> = new Map();

    constructor(io: SocketIOServer) {
        super(io);
        console.log('[SDK] ClaudeSdkManager initialized');
    }

    protected override isCompacting(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        return session?.isCompacting ?? false;
    }

    async startSession(sessionId: string, userId: string, options?: SessionOptions): Promise<void> {
        console.log(`[SDK] Starting session ${sessionId}`);

        const db = getDatabase();
        const dbSession = db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?')
            .get(sessionId, userId) as {
            working_directory: string;
            claude_session_id: string | null;
            model?: string;
            mode?: string;
        } | undefined;

        if (!dbSession) {
            throw new Error('Session not found');
        }

        if (this.sessions.has(sessionId)) {
            console.log(`[SDK] Session ${sessionId} already running`);
            return;
        }

        // Determine effective mode and model
        const effectiveMode = options?.mode ?? this.pendingModes.get(sessionId) ?? (dbSession.mode as SessionMode) ?? 'auto-accept';
        this.pendingModes.delete(sessionId);

        const effectiveModel: ModelType = options?.model ?? this.pendingModels.get(sessionId) ?? (dbSession.model as ModelType) ?? 'sonnet';
        this.pendingModels.delete(sessionId);

        const modelId = MODEL_IDS[effectiveModel];
        console.log(`[SDK] Session ${sessionId} using model ${effectiveModel} (${modelId}), mode ${effectiveMode}`);

        // Create abort controller for this session
        const abortController = new AbortController();

        // Create session state
        const session: SdkSession = {
            sessionId,
            userId,
            workingDirectory: dbSession.working_directory,
            claudeSessionId: dbSession.claude_session_id,
            mode: effectiveMode,
            model: effectiveModel,
            isStreaming: false,
            isCompacting: false,
            query: null,
            abortController,
            inputResolvers: [],
            pendingPermission: null,
            pendingQuestion: null,
            pendingPlanApproval: null,
            currentText: '',
            currentToolName: null,
            currentToolId: null,
            contextWindow: 200000,
            totalInputTokens: 0,
            totalOutputTokens: 0,
            cacheReadTokens: 0,
            cacheCreationTokens: 0,
            totalCostUsd: 0,
            outputBuffer: new CircularBuffer<BufferedMessage>(BUFFER_SIZE),
            lastActivityAt: Date.now(),
            disconnectedAt: null,
        };

        this.sessions.set(sessionId, session);

        // Update database status
        db.prepare('UPDATE sessions SET status = ?, session_state = ?, mode = ?, model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run('running', 'active', effectiveMode, effectiveModel, sessionId);

        // Emit status
        this.io.to(`session:${sessionId}`).emit('session:status', {
            sessionId,
            status: 'running',
        });

        console.log(`[SDK] Session ${sessionId} started`);
    }

    /**
     * Create and start the SDK query for a session
     */
    private async createQuery(session: SdkSession, initialPrompt: string): Promise<void> {
        const {sessionId, workingDirectory, mode} = session;

        // Determine permission mode for SDK
        let permissionMode: 'default' | 'acceptEdits' | 'bypassPermissions' = 'default';
        if (mode === 'danger') {
            permissionMode = 'bypassPermissions';
        } else if (mode === 'auto-accept') {
            permissionMode = 'acceptEdits';
        }

        console.log(`[SDK] Creating query for session ${sessionId} with permissionMode=${permissionMode}`);

        // Create the query with canUseTool for permission handling
        const q = query({
            prompt: initialPrompt,
            options: {
                cwd: workingDirectory,
                model: MODEL_IDS[session.model as ModelType],
                permissionMode,
                includePartialMessages: true,
                resume: session.claudeSessionId ?? undefined,
                abortController: session.abortController,
                allowDangerouslySkipPermissions: mode === 'danger',
                canUseTool: async (toolName, input, {signal}) => {
                    return this.handleToolPermission(sessionId, toolName, input, signal);
                },
            },
        });

        session.query = q;

        // Process messages in background
        this.processMessages(session, q).catch(err => {
            console.error(`[SDK] Error processing messages for ${sessionId}:`, err);
        });
    }

    /**
     * Handle tool permission requests via canUseTool callback
     */
    private async handleToolPermission(
        sessionId: string,
        toolName: string,
        input: unknown,
        _signal: AbortSignal
    ): Promise<PermissionResult> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return {behavior: 'deny', message: 'Session not found'};
        }

        // Handle AskUserQuestion specially
        if (toolName === 'AskUserQuestion') {
            const questionInput = input as {
                questions: Array<{
                    question: string;
                    header: string;
                    options: Array<{label: string; description: string}>;
                    multiSelect: boolean;
                }>;
            };

            console.log(`[SDK] AskUserQuestion for ${sessionId}:`, questionInput.questions.map(q => q.question));

            // Create promise for user response
            const answers = await new Promise<Record<string, string>>((resolve) => {
                const questionId = nanoid();

                session.pendingQuestion = {
                    request: {
                        questionId,
                        sessionId,
                        questions: questionInput.questions,
                    },
                    resolve,
                };

                // Emit to frontend (SDK-specific event)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.io.to(`session:${sessionId}`) as any).emit('action_request', {
                    type: 'user_question',
                    requestId: questionId,
                    sessionId,
                    questions: questionInput.questions,
                });
            });

            // Return with answers filled in
            return {
                behavior: 'allow',
                updatedInput: {
                    ...questionInput,
                    answers,
                },
            };
        }

        // For other tools in planning mode, request user approval
        if (session.mode === 'planning') {
            console.log(`[SDK] Permission request for ${toolName} in planning mode`);

            const approved = await new Promise<boolean>((resolve) => {
                const requestId = nanoid();

                session.pendingPermission = {
                    request: {
                        requestId,
                        sessionId,
                        toolName,
                        input,
                    },
                    resolve: (result) => resolve(result.behavior === 'allow'),
                };

                // Emit to frontend (SDK-specific event)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.io.to(`session:${sessionId}`) as any).emit('action_request', {
                    type: 'permission',
                    requestId,
                    sessionId,
                    toolName,
                    input,
                });
            });

            if (approved) {
                return {behavior: 'allow', updatedInput: input as Record<string, unknown>};
            } else {
                return {behavior: 'deny', message: 'User denied permission'};
            }
        }

        // Auto-accept and danger modes are handled by SDK's permissionMode
        return {behavior: 'allow', updatedInput: input as Record<string, unknown>};
    }

    /**
     * Process messages from the SDK query
     */
    private async processMessages(session: SdkSession, q: Query): Promise<void> {
        const {sessionId} = session;

        try {
            for await (const message of q) {
                session.lastActivityAt = Date.now();
                await this.handleMessage(session, message);
            }
        } catch (err) {
            if ((err as Error).name === 'AbortError') {
                console.log(`[SDK] Query aborted for ${sessionId}`);
            } else {
                console.error(`[SDK] Query error for ${sessionId}:`, err);
                this.io.to(`session:${sessionId}`).emit('session:error', {
                    sessionId,
                    error: (err as Error).message,
                });
            }
        } finally {
            // Clean up session state
            session.query = null;
            session.isStreaming = false;

            // Emit stopped status
            this.io.to(`session:${sessionId}`).emit('session:status', {
                sessionId,
                status: 'stopped',
            });

            // Update database
            const db = getDatabase();
            db.prepare('UPDATE sessions SET status = ?, session_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run('stopped', 'idle', sessionId);
        }
    }

    /**
     * Handle a single SDK message
     */
    private async handleMessage(session: SdkSession, message: SDKMessage): Promise<void> {
        const {sessionId} = session;

        switch (message.type) {
            case 'system':
                if (message.subtype === 'init') {
                    // Capture session ID from Claude
                    session.claudeSessionId = message.session_id;

                    // Update database with Claude session ID
                    const db = getDatabase();
                    db.prepare('UPDATE sessions SET claude_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
                        .run(message.session_id, sessionId);

                    console.log(`[SDK] Session ${sessionId} initialized with Claude session ${message.session_id}`);
                    console.log(`[SDK] Model: ${message.model}, Tools: ${message.tools.length}`);
                } else if (message.subtype === 'compact_boundary') {
                    // Handle compaction
                    this.saveMetaMessage(sessionId, 'compact', {
                        trigger: message.compact_metadata?.trigger ?? 'auto',
                        pre_tokens: message.compact_metadata?.pre_tokens ?? 0,
                    });
                }
                break;

            case 'assistant':
                // Complete assistant message
                this.handleAssistantMessage(session, message);
                break;

            case 'stream_event':
                // Streaming partial message
                this.handleStreamEvent(session, message);
                break;

            case 'result':
                // Final result with usage
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                this.handleResult(session, message as any);
                break;

            case 'user':
                // User message replay (when resuming)
                console.log(`[SDK] User message replay for ${sessionId}`);
                break;
        }
    }

    /**
     * Handle complete assistant message
     */
    private handleAssistantMessage(session: SdkSession, message: {
        type: 'assistant';
        uuid: string;
        session_id: string;
        message: {
            role: 'assistant';
            content: Array<{type: string; text?: string; name?: string; id?: string; input?: unknown}>;
        };
        parent_tool_use_id: string | null;
    }): void {
        const {sessionId} = session;

        // Extract text content
        const textContent = message.message.content
            .filter(block => block.type === 'text')
            .map(block => block.text ?? '')
            .join('');

        if (textContent) {
            // Save and emit the message
            this.saveAssistantMessage(sessionId, textContent);
        }

        // Handle tool uses
        for (const block of message.message.content) {
            if (block.type === 'tool_use' && block.name && block.id) {
                this.saveToolExecution(sessionId, block.id, block.name, block.input, 'started');
                this.io.to(`session:${sessionId}`).emit('session:tool_use', {
                    sessionId,
                    toolName: block.name,
                    toolId: block.id,
                    status: 'started',
                    input: block.input,
                });
            }
        }

        // If in a subagent context, emit agent event
        if (message.parent_tool_use_id) {
            this.io.to(`session:${sessionId}`).emit('session:agent', {
                sessionId,
                agentType: 'subagent',
                status: 'started',
            });
        }
    }

    /**
     * Handle streaming event
     */
    private handleStreamEvent(session: SdkSession, message: {
        type: 'stream_event';
        event: {
            type: string;
            index?: number;
            delta?: {type: string; text?: string; partial_json?: string};
            content_block?: {type: string; text?: string; name?: string; id?: string};
        };
        parent_tool_use_id: string | null;
        uuid: string;
        session_id: string;
    }): void {
        const {sessionId} = session;
        const event = message.event;

        switch (event.type) {
            case 'content_block_start':
                if (event.content_block?.type === 'text') {
                    session.isStreaming = true;
                    session.currentText = '';
                    this.io.to(`session:${sessionId}`).emit('session:thinking', {
                        sessionId,
                        isThinking: true,
                    });
                } else if (event.content_block?.type === 'tool_use') {
                    session.currentToolName = event.content_block.name ?? null;
                    session.currentToolId = event.content_block.id ?? null;
                    if (session.currentToolId && session.currentToolName) {
                        this.io.to(`session:${sessionId}`).emit('session:tool_use', {
                            sessionId,
                            toolName: session.currentToolName,
                            toolId: session.currentToolId,
                            status: 'started',
                        });
                    }
                }
                break;

            case 'content_block_delta':
                if (event.delta?.type === 'text_delta' && event.delta.text) {
                    session.currentText += event.delta.text;
                    this.io.to(`session:${sessionId}`).emit('session:output', {
                        sessionId,
                        content: session.currentText,
                        isComplete: false,
                    });

                    // Buffer for reconnection
                    session.outputBuffer.push({
                        type: 'output',
                        data: {content: session.currentText, isComplete: false},
                        timestamp: Date.now(),
                    });
                }
                break;

            case 'content_block_stop':
                if (session.isStreaming && session.currentText) {
                    session.isStreaming = false;
                    // Save the complete message to database
                    this.saveAssistantMessage(sessionId, session.currentText);
                    this.io.to(`session:${sessionId}`).emit('session:thinking', {
                        sessionId,
                        isThinking: false,
                    });
                    session.currentText = '';
                }
                if (session.currentToolId) {
                    session.currentToolId = null;
                    session.currentToolName = null;
                }
                break;

            case 'message_stop':
                session.isStreaming = false;
                this.io.to(`session:${sessionId}`).emit('session:thinking', {
                    sessionId,
                    isThinking: false,
                });
                break;
        }
    }

    /**
     * Handle final result message
     */
    private handleResult(session: SdkSession, message: {
        type: 'result';
        subtype: string;
        uuid: string;
        session_id: string;
        duration_ms: number;
        duration_api_ms: number;
        is_error: boolean;
        num_turns: number;
        result?: string;
        total_cost_usd: number;
        usage: {
            input_tokens: number;
            output_tokens: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
        };
        modelUsage?: Record<string, {
            inputTokens: number;
            outputTokens: number;
            cacheReadInputTokens: number;
            cacheCreationInputTokens: number;
            costUSD: number;
            contextWindow: number;
        }>;
        errors?: string[];
    }): void {
        const {sessionId} = session;

        // Update usage tracking
        session.totalInputTokens += message.usage.input_tokens;
        session.totalOutputTokens += message.usage.output_tokens;
        session.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
        session.cacheCreationTokens += message.usage.cache_creation_input_tokens ?? 0;
        session.totalCostUsd += message.total_cost_usd;

        // Get context window from model usage if available
        if (message.modelUsage) {
            const firstModel = Object.values(message.modelUsage)[0];
            if (firstModel) {
                session.contextWindow = firstModel.contextWindow;
            }
        }

        // Emit usage
        this.emitUsageData(sessionId, {
            model: session.model,
            contextWindow: session.contextWindow,
            totalInputTokens: session.totalInputTokens,
            totalOutputTokens: session.totalOutputTokens,
            cacheReadTokens: session.cacheReadTokens,
            cacheCreationTokens: session.cacheCreationTokens,
            totalCostUsd: session.totalCostUsd,
            userId: session.userId,
        });

        // Handle errors
        if (message.is_error && message.errors) {
            console.error(`[SDK] Session ${sessionId} errors:`, message.errors);
            this.io.to(`session:${sessionId}`).emit('session:error', {
                sessionId,
                error: message.errors.join('\n'),
            });
        }

        console.log(`[SDK] Session ${sessionId} result: ${message.subtype}, turns=${message.num_turns}, cost=$${message.total_cost_usd.toFixed(4)}`);
    }

    stopSession(sessionId: string, _userId: string): void {
        console.log(`[SDK] Stopping session ${sessionId}`);

        const session = this.sessions.get(sessionId);
        if (!session) {
            console.log(`[SDK] Session ${sessionId} not found`);
            return;
        }

        // Abort the query
        session.abortController.abort();

        // Deny any pending permissions
        if (session.pendingPermission) {
            session.pendingPermission.resolve({behavior: 'deny', message: 'Session stopped'});
            session.pendingPermission = null;
        }
        if (session.pendingQuestion) {
            session.pendingQuestion.resolve({});
            session.pendingQuestion = null;
        }

        // Clean up
        this.sessions.delete(sessionId);

        // Update database
        const db = getDatabase();
        db.prepare('UPDATE sessions SET status = ?, session_state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run('stopped', 'idle', sessionId);

        this.io.to(`session:${sessionId}`).emit('session:status', {
            sessionId,
            status: 'stopped',
        });
    }

    async restartSession(sessionId: string, userId: string): Promise<void> {
        console.log(`[SDK] Restarting session ${sessionId}`);

        // Stop if running
        this.stopSession(sessionId, userId);

        // Clear Claude session ID to start fresh
        const db = getDatabase();
        db.prepare('UPDATE sessions SET claude_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(sessionId);

        // Start fresh
        await this.startSession(sessionId, userId);

        // Save restart meta message
        this.saveMetaMessage(sessionId, 'restart', {time: new Date().toISOString()});
    }

    async resumeSession(sessionId: string, userId: string): Promise<void> {
        console.log(`[SDK] Resuming session ${sessionId}`);

        // Just start the session - it will use the existing claude_session_id
        await this.startSession(sessionId, userId);

        // Save resume meta message
        this.saveMetaMessage(sessionId, 'resume', {time: new Date().toISOString()});
    }

    async sendMessage(
        sessionId: string,
        userId: string,
        message: string,
        images?: ImageData[],
        suppressSaving = false
    ): Promise<void> {
        let session = this.sessions.get(sessionId);

        // Start session if not running
        if (!session) {
            await this.startSession(sessionId, userId);
            session = this.sessions.get(sessionId);
            if (!session) {
                throw new Error('Failed to start session');
            }
        }

        // Save user message to database
        if (!suppressSaving && message.trim()) {
            const db = getDatabase();
            const messageId = nanoid();
            const createdAt = new Date().toISOString();

            db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(
                messageId,
                sessionId,
                'user',
                message,
                createdAt
            );

            this.io.to(`session:${sessionId}`).emit('session:message', {
                id: messageId,
                sessionId,
                role: 'user',
                content: message,
                createdAt,
            });
        }

        // Build prompt with images if provided
        let prompt: string | Array<{type: string; [key: string]: unknown}> = message;
        if (images && images.length > 0) {
            const content: Array<{type: string; [key: string]: unknown}> = [];
            for (const img of images) {
                content.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: img.mimeType,
                        data: img.data,
                    },
                });
            }
            content.push({type: 'text', text: message});
            prompt = content as unknown as string; // SDK accepts this format
        }

        // If no query exists, create one
        if (!session.query) {
            await this.createQuery(session, typeof prompt === 'string' ? prompt : message);
        } else {
            // For streaming mode, we'd need to yield to the input generator
            // For now, create a new query for each message
            await this.createQuery(session, typeof prompt === 'string' ? prompt : message);
        }
    }

    async interrupt(sessionId: string, _userId: string): Promise<void> {
        console.log(`[SDK] Interrupting session ${sessionId}`);

        const session = this.sessions.get(sessionId);
        if (!session?.query) {
            console.log(`[SDK] No active query for ${sessionId}`);
            return;
        }

        try {
            await session.query.interrupt();
        } catch (err) {
            console.error(`[SDK] Error interrupting ${sessionId}:`, err);
        }
    }

    async sendRawInput(sessionId: string, userId: string, input: string): Promise<void> {
        // In SDK mode, raw input is just a message
        await this.sendMessage(sessionId, userId, input);
    }

    async sendRawJson(sessionId: string, _userId: string, _jsonMessage: unknown): Promise<void> {
        console.log(`[SDK] sendRawJson not supported in SDK mode for ${sessionId}`);
        // SDK doesn't support raw JSON messages like the CLI does
    }

    injectToolResult(sessionId: string, _toolUseId: string, _result: unknown): void {
        console.log(`[SDK] injectToolResult not needed in SDK mode for ${sessionId}`);
        // SDK handles tool results internally via canUseTool
    }

    setMode(sessionId: string, _userId: string, mode: SessionMode): void {
        console.log(`[SDK] Setting mode for ${sessionId} to ${mode}`);

        const session = this.sessions.get(sessionId);
        if (session) {
            session.mode = mode;
            // Note: Changing mode mid-session may require restarting the query
            // to change the SDK's permissionMode
        }

        // Store for next session start
        this.pendingModes.set(sessionId, mode);

        // Update database
        const db = getDatabase();
        db.prepare('UPDATE sessions SET mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(mode, sessionId);

        this.io.emit('session:mode_changed', {sessionId, mode});
    }

    setModel(sessionId: string, _userId: string, model: ModelType): void {
        console.log(`[SDK] Setting model for ${sessionId} to ${model}`);

        const session = this.sessions.get(sessionId);
        if (session) {
            session.model = model;
        }

        // Store for next session start
        this.pendingModels.set(sessionId, model);

        // Update database
        const db = getDatabase();
        db.prepare('UPDATE sessions SET model = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(model, sessionId);

        this.io.emit('session:model_changed', {sessionId, model});
    }

    isSessionRunning(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    getRunningSessionIds(): string[] {
        return Array.from(this.sessions.keys());
    }

    getSessionBuffer(sessionId: string, sinceTimestamp?: number): BufferedMessage[] {
        const session = this.sessions.get(sessionId);
        if (!session) return [];

        if (sinceTimestamp) {
            return session.outputBuffer.getSince((msg) => msg.timestamp > sinceTimestamp);
        }
        return session.outputBuffer.getAll();
    }

    getCurrentUsage(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            this.emitUsageData(sessionId, {
                model: session.model,
                contextWindow: session.contextWindow,
                totalInputTokens: session.totalInputTokens,
                totalOutputTokens: session.totalOutputTokens,
                cacheReadTokens: session.cacheReadTokens,
                cacheCreationTokens: session.cacheCreationTokens,
                totalCostUsd: session.totalCostUsd,
                userId: session.userId,
            });
        }
    }

    markSessionDisconnected(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session && !session.disconnectedAt) {
            session.disconnectedAt = Date.now();
            console.log(`[SDK] Session ${sessionId} marked as disconnected`);
        }
    }

    markSessionReconnected(sessionId: string): void {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.disconnectedAt = null;
            console.log(`[SDK] Session ${sessionId} marked as reconnected`);
        }
    }

    // ============================================================
    // Response handlers for pending actions
    // ============================================================

    /**
     * Respond to a pending permission request
     */
    respondToPermission(sessionId: string, requestId: string, approved: boolean): void {
        const session = this.sessions.get(sessionId);
        if (!session?.pendingPermission) return;

        if (session.pendingPermission.request.requestId === requestId) {
            if (approved) {
                session.pendingPermission.resolve({
                    behavior: 'allow',
                    updatedInput: session.pendingPermission.request.input as Record<string, unknown>,
                });
            } else {
                session.pendingPermission.resolve({
                    behavior: 'deny',
                    message: 'User denied permission',
                });
            }
            session.pendingPermission = null;
        }
    }

    /**
     * Respond to a pending user question
     */
    respondToQuestion(sessionId: string, questionId: string, answers: Record<string, string>): void {
        const session = this.sessions.get(sessionId);
        if (!session?.pendingQuestion) return;

        if (session.pendingQuestion.request.questionId === questionId) {
            session.pendingQuestion.resolve(answers);
            session.pendingQuestion = null;
        }
    }

    /**
     * Respond to a pending plan approval
     */
    respondToPlanApproval(sessionId: string, requestId: string, approved: boolean): void {
        const session = this.sessions.get(sessionId);
        if (!session?.pendingPlanApproval) return;

        if (session.pendingPlanApproval.request.requestId === requestId) {
            session.pendingPlanApproval.resolve(approved);
            session.pendingPlanApproval = null;
        }
    }
}
