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
    TodoItem,
} from '@claude-code-webui/shared';
import {query, createSdkMcpServer, tool, type Query, type SDKMessage, type PermissionResult, type PostToolUseHookInput, type HookJSONOutput} from '@anthropic-ai/claude-agent-sdk';
import {z} from 'zod';
import {ClaudeManager, CircularBuffer} from './ClaudeManager';
import {getDatabase} from '../../db';
import {nanoid} from 'nanoid';
import type {
    ImageData,
    SessionOptions,
    SocketIOServer,
} from './types';
import {MODEL_IDS} from './types';
import {PermissionMatcher} from '../../utils/permission-matcher';
import {permissionHistory} from '../permission-history';
import {userPromptManager} from '../UserPromptManager';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {exec} from 'child_process';
import {promisify} from 'util';

const execAsync = promisify(exec);

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

    // Permission patterns from settings
    allowPatterns: string[];
    denyPatterns: string[];

    // Streaming input generator control
    inputResolvers: Array<{
        resolve: (value: {type: 'user'; message: {role: 'user'; content: string | Array<{type: string; [key: string]: unknown}>}}) => void;
    }>;

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
        // Set Socket.IO instance for permission history events
        permissionHistory.setSocketIO(io);
        console.log('[SDK] ClaudeSdkManager initialized');
    }

    /**
     * Reload permission patterns for a session
     */
    public async reloadPermissionPatternsForSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return;
        }

        const patterns = await this.loadPermissionPatterns(session.workingDirectory);
        session.allowPatterns = patterns.allow;
        session.denyPatterns = patterns.deny;
        console.log(`[SDK] Reloaded permission patterns for session ${sessionId}: ${patterns.allow.length} allow, ${patterns.deny.length} deny`);
    }

    /**
     * Load permission patterns from settings files
     */
    private async loadPermissionPatterns(workingDirectory: string): Promise<{allow: string[]; deny: string[]}> {
        const settings: Array<{permissions?: {allow?: string[]; deny?: string[]}} | null> = [];

        // Load global settings (~/.claude/settings.json)
        const globalSettingsPath = path.join(os.homedir(), '.claude', 'settings.json');
        try {
            const content = await fs.readFile(globalSettingsPath, 'utf-8');
            settings.push(JSON.parse(content));
        } catch {
            settings.push(null);
        }

        // Load global local settings (~/.claude/settings.local.json)
        const globalLocalPath = path.join(os.homedir(), '.claude', 'settings.local.json');
        try {
            const content = await fs.readFile(globalLocalPath, 'utf-8');
            settings.push(JSON.parse(content));
        } catch {
            settings.push(null);
        }

        // Load project settings (<project>/.claude/settings.json)
        const projectSettingsPath = path.join(workingDirectory, '.claude', 'settings.json');
        try {
            const content = await fs.readFile(projectSettingsPath, 'utf-8');
            settings.push(JSON.parse(content));
        } catch {
            settings.push(null);
        }

        // Load project local settings (<project>/.claude/settings.local.json)
        const projectLocalPath = path.join(workingDirectory, '.claude', 'settings.local.json');
        try {
            const content = await fs.readFile(projectLocalPath, 'utf-8');
            settings.push(JSON.parse(content));
        } catch {
            settings.push(null);
        }

        return PermissionMatcher.loadPatterns(settings);
    }

    protected override isCompacting(sessionId: string): boolean {
        const session = this.sessions.get(sessionId);
        return session?.isCompacting ?? false;
    }

    /**
     * Handle commit tool execution
     */
    private async handleCommitTool(
        sessionId: string,
        workingDirectory: string,
        commitMessage: string
    ): Promise<string> {
        console.log(`[SDK] Handling commit request with message: ${commitMessage}`);

        // Get current git status
        let gitStatus: string;
        try {
            const {stdout} = await execAsync('git status --porcelain=v1', {cwd: workingDirectory});
            gitStatus = stdout;

            if (!gitStatus.trim()) {
                return 'No changes to commit. Working directory is clean.';
            }
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.log(`[SDK] Error getting git status: ${errMsg}`);
            return `Failed to get git status: ${errMsg}`;
        }

        // Use unified prompt system for commit approval
        const response = await userPromptManager.prompt(sessionId, {
            type: 'commit_approval',
            sessionId,
            commitMessage,
            gitStatus,
        });

        if (response.type !== 'commit_approval' || !response.approved) {
            const reason = response.type === 'commit_approval' ? response.reason : 'User denied commit';
            console.log(`[SDK] User denied commit: ${reason}`);
            return reason || 'User denied commit';
        }

        console.log('[SDK] User approved commit');

        // Execute the commit
        try {
            await execAsync('git add -A', {cwd: workingDirectory});
            await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {cwd: workingDirectory});
            console.log('[SDK] Commit successful');

            // Push if requested
            if (response.push) {
                console.log('[SDK] User requested push, pushing to remote...');
                try {
                    await execAsync('git push', {cwd: workingDirectory});
                    console.log('[SDK] Push successful');
                    return 'Commit created and pushed successfully';
                } catch (err) {
                    const errMsg = err instanceof Error ? err.message : String(err);
                    console.log(`[SDK] Push failed: ${errMsg}`);
                    return `Commit created successfully but push failed: ${errMsg}`;
                }
            }

            return 'Commit created successfully';
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.log(`[SDK] Commit failed: ${errMsg}`);
            return `Failed to create commit: ${errMsg}`;
        }
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

        // Load permission patterns from settings
        const patterns = await this.loadPermissionPatterns(dbSession.working_directory);
        console.log(`[SDK] Loaded ${patterns.allow.length} allow patterns and ${patterns.deny.length} deny patterns for session ${sessionId}`);

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
            allowPatterns: patterns.allow,
            denyPatterns: patterns.deny,
            inputResolvers: [],
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

        // IMPORTANT: Always use 'default' permissionMode so canUseTool is ALWAYS called.
        // We handle our own permission logic (auto-accept, planning, danger) inside canUseTool.
        //
        // If we use 'acceptEdits' or 'bypassPermissions', the SDK auto-approves tools
        // WITHOUT calling canUseTool, which means:
        // - AskUserQuestion would be auto-approved without getting user answers
        // - We lose control over permission handling
        const permissionMode = 'default';

        console.log(`[SDK] Creating query for session ${sessionId} with permissionMode=${permissionMode}, sessionMode=${mode}`);

        // Create in-process MCP server for commit tool using the tool() helper
        const commitTool = tool(
            'commit',
            `Create a git commit with user approval. Shows git status and allows the user to approve, deny, or choose to push.

Usage:
- Provide a commit message as input
- User will see git status, can approve/deny, and optionally push
- Returns result of commit operation`,
            {message: z.string().describe('The commit message')},
            async (args) => {
                const result = await this.handleCommitTool(sessionId, workingDirectory, args.message);
                return {content: [{type: 'text' as const, text: result}]};
            }
        );

        const sdkUiMcpServer = createSdkMcpServer({
            name: 'sdk_ui',
            version: '1.0.0',
            tools: [commitTool],
        });

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
                // Register SDK UI MCP server for commit tool (in-process)
                mcpServers: {sdk_ui: sdkUiMcpServer},
                // Don't use allowDangerouslySkipPermissions - we handle danger mode in canUseTool
                canUseTool: async (toolName, input, {signal}) => {
                    return this.handleToolPermission(sessionId, toolName, input, signal);
                },
                // Add PostToolUse hook to handle tool execution results
                hooks: {
                    PostToolUse: [{
                        hooks: [async (hookInput, _toolUseId, _options) => {
                            // Only handle PostToolUse hooks
                            if (hookInput.hook_event_name === 'PostToolUse') {
                                return this.handlePostToolUse(sessionId, hookInput);
                            }
                            return { continue: true };
                        }],
                    }],
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
     * Handle tool permission requests via canUseTool callback.
     * This is called for ALL tool uses because we use permissionMode: 'default'.
     */
    private async handleToolPermission(
        sessionId: string,
        toolName: string,
        input: unknown,
        _signal: AbortSignal
    ): Promise<PermissionResult> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.log(`[SDK] canUseTool: session ${sessionId} not found, denying`);
            return {behavior: 'deny', message: 'Session not found'};
        }

        console.log(`[SDK] canUseTool called: tool=${toolName}, mode=${session.mode}`);

        // Intercept git commit commands and redirect to MCP tool
        if (toolName === 'Bash') {
            const bashInput = input as {command?: string};
            const command = bashInput.command || '';
            if (command.match(/^git\s+commit\b/)) {
                console.log(`[SDK] Intercepting git commit command, redirecting to MCP tool`);
                return {
                    behavior: 'deny',
                    message: 'Please use the mcp__sdk_ui__commit tool instead of git commit. Example: Use the commit tool with your message.',
                };
            }
        }

        // Handle ExitPlanMode - ALWAYS require approval regardless of patterns
        if (toolName === 'ExitPlanMode') {
            console.log(`[SDK] ExitPlanMode detected, converting to plan approval request`);

            // Extract plan content from input if available
            const planContent = typeof input === 'object' && input !== null && 'plan' in input
                ? (input as { plan?: string }).plan
                : undefined;

            // Use unified prompt system
            const response = await userPromptManager.prompt(sessionId, {
                type: 'plan_approval',
                sessionId,
                planContent,
                planPath: undefined,
            });

            if (response.type === 'plan_approval' && response.approved) {
                console.log(`[SDK] ExitPlanMode approved by user`);
                return {behavior: 'allow', updatedInput: input as Record<string, unknown>};
            } else {
                console.log(`[SDK] ExitPlanMode denied by user`);
                return {behavior: 'deny', message: 'Plan not approved. Please revise based on feedback.'};
            }
        }

        // Handle AskUserQuestion - ALWAYS wait for user answers regardless of mode
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

            // Use unified prompt system
            const response = await userPromptManager.prompt(sessionId, {
                type: 'user_question',
                sessionId,
                questions: questionInput.questions,
            });

            // Extract answers from response
            const answers = response.type === 'user_question' ? response.answers : {};

            console.log(`[SDK] AskUserQuestion answers received:`, answers);

            // Store the result for display (format matches what the tool expects)
            const resultText = `User has answered your questions: ${Object.entries(answers).map(([k, v]) => `"${k}"="${v}"`).join(', ')}. You can now continue with the user's answers in mind.`;

            // Save tool execution with the result
            if (session.currentToolId) {
                this.updateToolExecution(session.currentToolId, {
                    result: resultText,
                    status: 'completed',
                });
            }

            // Return with answers filled in (per SDK docs)
            return {
                behavior: 'allow',
                updatedInput: {
                    questions: questionInput.questions,  // Pass through original questions
                    answers,  // Add user's answers
                },
            };
        }

        // Check permission patterns BEFORE mode-based decisions
        // This allows users to auto-approve tools even in planning mode
        const startTime = Date.now();
        const matchResult = PermissionMatcher.checkPatterns(
            toolName,
            input,
            session.allowPatterns,
            session.denyPatterns
        );

        if (matchResult.matched) {
            const decision = matchResult.type === 'allow' ? 'allow' : 'deny';
            permissionHistory.track({
                id: nanoid(),
                sessionId,
                timestamp: Date.now(),
                toolName,
                toolInput: input,
                decision,
                reason: 'pattern',
                matchedPattern: matchResult.pattern,
                mode: session.mode,
                duration: Date.now() - startTime,
            });

            if (matchResult.type === 'allow') {
                console.log(`[SDK] Auto-approved ${toolName} by pattern: ${matchResult.pattern}`);
                return {behavior: 'allow', updatedInput: input as Record<string, unknown>};
            } else {
                console.log(`[SDK] Auto-denied ${toolName} by pattern: ${matchResult.pattern}`);
                return {behavior: 'deny', message: `Denied by pattern: ${matchResult.pattern}`};
            }
        }

        // For planning mode, ask user for approval on all tools (no pattern matched)
        if (session.mode === 'planning') {
            console.log(`[SDK] Permission request for ${toolName} in planning mode`);

            // Use unified prompt system
            const response = await userPromptManager.prompt(sessionId, {
                type: 'permission',
                sessionId,
                toolName,
                toolInput: input,
                description: `${toolName} tool`,
                suggestedPattern: `${toolName}(:*)`,
            });

            const approved = response.type === 'permission' && response.approved;

            permissionHistory.track({
                id: nanoid(),
                sessionId,
                timestamp: Date.now(),
                toolName,
                toolInput: input,
                decision: approved ? 'allow' : 'deny',
                reason: 'user',
                mode: session.mode,
                duration: Date.now() - startTime,
            });

            if (approved) {
                console.log(`[SDK] Tool ${toolName} approved by user`);
                return {behavior: 'allow', updatedInput: input as Record<string, unknown>};
            } else {
                console.log(`[SDK] Tool ${toolName} denied by user`);
                return {behavior: 'deny', message: 'User denied permission'};
            }
        }

        // For auto-accept mode, check against safe patterns
        if (session.mode === 'auto-accept') {
            // Define safe patterns for auto-accept mode
            const autoAcceptPatterns = [
                // Planning operations
                'EnterPlanMode',

                // File operations within project
                'Read(*)',
                'Write(*)',
                'Edit(*)',
                'Glob(*)',
                'Grep(*)',

                // Safe bash commands
                'Bash(ls*)',
                'Bash(pwd*)',
                'Bash(echo*)',
                'Bash(cat*)',
                'Bash(grep*)',
                'Bash(find*)',
                'Bash(head*)',
                'Bash(tail*)',
                'Bash(wc*)',
                'Bash(which*)',
                'Bash(date*)',
                'Bash(whoami*)',
                'Bash(uname*)',
                'Bash(pnpm typecheck*)',
                'Bash(pnpm test*)',
                'Bash(pnpm lint*)',
                'Bash(npm run*)',
                'Bash(yarn*)',

                // Git read operations (safe)
                'Bash(git status*)',
                'Bash(git diff*)',
                'Bash(git log*)',
                'Bash(git branch*)',
                'Bash(git remote -v*)',
                'Bash(git show*)',

                // Development tools
                'TodoWrite(*)',
                'AskUserQuestion(*)',
                'Task(*)',
                'LSP(*)',
                'NotebookEdit(*)',

                // Web operations
                'WebFetch(*)',
                'WebSearch(*)',
            ];

            // Check if tool matches any auto-accept pattern
            const matchResult = PermissionMatcher.checkPatterns(
                toolName,
                input,
                autoAcceptPatterns,
                [] // no deny patterns for auto-accept check
            );

            if (matchResult.matched && matchResult.type === 'allow') {
                permissionHistory.track({
                    id: nanoid(),
                    sessionId,
                    timestamp: Date.now(),
                    toolName,
                    toolInput: input,
                    decision: 'allow',
                    reason: 'mode',
                    matchedPattern: matchResult.pattern,
                    mode: session.mode,
                    duration: Date.now() - startTime,
                });

                console.log(`[SDK] Auto-approved ${toolName} in auto-accept mode by pattern: ${matchResult.pattern}`);
                return {behavior: 'allow', updatedInput: input as Record<string, unknown>};
            } else {
                // Not in safe list - ask user
                console.log(`[SDK] Tool ${toolName} not in auto-accept safe list, requesting permission`);

                // Use unified prompt system
                const response = await userPromptManager.prompt(sessionId, {
                    type: 'permission',
                    sessionId,
                    toolName,
                    toolInput: input,
                    description: `${toolName} tool`,
                    suggestedPattern: `${toolName}(:*)`,
                });

                const approved = response.type === 'permission' && response.approved;

                permissionHistory.track({
                    id: nanoid(),
                    sessionId,
                    timestamp: Date.now(),
                    toolName,
                    toolInput: input,
                    decision: approved ? 'allow' : 'deny',
                    reason: 'user',
                    mode: session.mode,
                    duration: Date.now() - startTime,
                });

                if (approved) {
                    console.log(`[SDK] Tool ${toolName} approved by user in auto-accept mode`);
                    return {behavior: 'allow', updatedInput: input as Record<string, unknown>};
                } else {
                    console.log(`[SDK] Tool ${toolName} denied by user in auto-accept mode`);
                    return {behavior: 'deny', message: 'User denied permission'};
                }
            }
        }

        // For danger mode, auto-approve everything
        if (session.mode === 'danger') {
            permissionHistory.track({
                id: nanoid(),
                sessionId,
                timestamp: Date.now(),
                toolName,
                toolInput: input,
                decision: 'allow',
                reason: 'mode',
                mode: session.mode,
                duration: Date.now() - startTime,
            });

            console.log(`[SDK] Auto-approving ${toolName} (danger mode - all tools allowed)`);
            return {behavior: 'allow', updatedInput: input as Record<string, unknown>};
        }

        // Should not reach here - invalid mode
        console.log(`[SDK] WARNING: Invalid session mode ${session.mode}, denying by default`);
        return {behavior: 'deny', message: 'Invalid session mode'};
    }

    /**
     * Handle PostToolUse hook - called after a tool has been executed
     * This allows us to observe and potentially modify tool results
     */
    private async handlePostToolUse(sessionId: string, hookInput: PostToolUseHookInput): Promise<HookJSONOutput> {
        const session = this.sessions.get(sessionId);
        if (!session) {
            console.log(`[SDK] PostToolUse: session ${sessionId} not found`);
            return { continue: true };
        }

        const { tool_name, tool_input, tool_response, tool_use_id } = hookInput;

        console.log(`[SDK] PostToolUse hook called: tool=${tool_name}, toolUseId=${tool_use_id}`);

        // Update tool execution with the result
        if (tool_use_id && tool_response !== undefined) {
            // Convert tool response to string for storage
            const resultStr = typeof tool_response === 'string'
                ? tool_response
                : JSON.stringify(tool_response, null, 2);

            this.updateToolExecution(tool_use_id, {
                result: resultStr,
                status: 'completed',
            });

            // Emit tool completion event with result
            this.io.to(`session:${sessionId}`).emit('session:tool_use', {
                sessionId,
                toolName: tool_name,
                toolId: tool_use_id,
                status: 'completed',
                result: resultStr,
            });

            console.log(`[SDK] Tool ${tool_name} (${tool_use_id}) completed with result`);
        }

        // Special handling for specific tools that need result processing
        switch (tool_name) {
            case 'WebFetch':
            case 'WebSearch':
                // These tools might return large results that could be summarized
                console.log(`[SDK] ${tool_name} returned ${typeof tool_response === 'string' ? tool_response.length : 'structured'} data`);
                break;

            case 'Task':
                // Task tool spawns subagents - track their completion
                if (tool_response && typeof tool_response === 'object' && 'agentId' in tool_response) {
                    console.log(`[SDK] Task completed with agent ID: ${tool_response.agentId}`);
                }
                break;

            case 'TodoWrite':
                // TodoWrite updates the task list - emit an event for UI update
                if (tool_response && tool_input && typeof tool_input === 'object' && 'todos' in tool_input) {
                    this.io.to(`session:${sessionId}`).emit('session:todos', {
                        sessionId,
                        todos: tool_input.todos as TodoItem[],
                    });
                }
                break;
        }

        // Return continue: true to proceed with normal execution
        // We could potentially modify the tool output here by returning:
        // {
        //     continue: true,
        //     hookSpecificOutput: {
        //         hookEventName: 'PostToolUse',
        //         updatedMCPToolOutput: modifiedResponse
        //     }
        // }
        return { continue: true };
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
     * Note: Text content is already saved during streaming (in content_block_stop),
     * so we only handle tool uses here to avoid duplicates.
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

        // Note: Text content is NOT saved here because it's already saved
        // during streaming in handleStreamEvent -> content_block_stop.
        // With includePartialMessages: true, we get both streaming events
        // AND this complete message, so saving here would cause duplicates.

        // Handle tool uses (these aren't duplicated because we track by toolId)
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
                    const deltaText = event.delta.text;
                    session.currentText += deltaText;

                    // Emit only the NEW delta text, not the full accumulated text
                    // (Frontend appends deltas to build the complete message)
                    this.io.to(`session:${sessionId}`).emit('session:output', {
                        sessionId,
                        content: deltaText,
                        isComplete: false,
                    });

                    // Buffer the delta for reconnection
                    session.outputBuffer.push({
                        type: 'output',
                        data: {content: deltaText, isComplete: false},
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
                if (session.currentToolId && session.currentToolName) {
                    // Mark the tool as completed
                    this.updateToolExecution(session.currentToolId, {
                        status: 'completed',
                    });

                    // Emit tool completion event
                    this.io.to(`session:${sessionId}`).emit('session:tool_use', {
                        sessionId,
                        toolName: session.currentToolName,
                        toolId: session.currentToolId,
                        status: 'completed',
                    });

                    console.log(`[SDK] Tool ${session.currentToolName} (${session.currentToolId}) completed`);

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

        // Clear any pending prompts
        userPromptManager.clearSession(sessionId);

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

    /**
     * Build initial prompt with project context for the first message.
     * Loads CLAUDE.md and basic project info to give Claude context.
     */
    private async buildInitialPromptWithContext(session: SdkSession, userMessage: string): Promise<string> {
        const {workingDirectory, claudeSessionId} = session;

        // If resuming an existing session, don't add context (Claude already has it)
        if (claudeSessionId) {
            return userMessage;
        }

        const contextParts: string[] = [];

        // Try to load CLAUDE.md from project root
        const claudeMdPath = path.join(workingDirectory, 'CLAUDE.md');
        try {
            const claudeMdContent = await fs.readFile(claudeMdPath, 'utf-8');
            contextParts.push(`# claudeMd
Codebase and user instructions are shown below. Be sure to adhere to these instructions. IMPORTANT: These instructions OVERRIDE any default behavior and you MUST follow them exactly as written.

Contents of ${claudeMdPath} (project instructions, checked into the codebase):

${claudeMdContent}`);
        } catch {
            // No CLAUDE.md found, that's ok
        }

        // If no context was found, just return the user message
        if (contextParts.length === 0) {
            return userMessage;
        }

        // Combine context with user message
        const contextBlock = `<system-reminder>
As you answer the user's questions, you can use the following context:
${contextParts.join('\n\n')}

      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>`;

        console.log(`[SDK] Added project context from CLAUDE.md for session ${session.sessionId}`);
        return `${contextBlock}\n${userMessage}`;
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

        // If no query exists, create one with project context for the first message
        if (!session.query) {
            // Preload project context on first message
            const contextualPrompt = await this.buildInitialPromptWithContext(session, typeof prompt === 'string' ? prompt : message);
            await this.createQuery(session, contextualPrompt);
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

}
