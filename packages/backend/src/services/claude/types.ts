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

// Re-export shared types
export type {SessionMode, ModelType, BufferedMessage};

// Socket.IO server type
export type SocketIOServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

// Image data for messages
export interface ImageData {
    data: string; // base64
    mimeType: string;
}

// Usage info from Claude
export interface UsageInfo {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
}

// Model usage info
export interface ModelUsageInfo {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    contextWindow: number;
    costUSD: number;
}

// Session options for starting
export interface SessionOptions {
    mode?: SessionMode;
    model?: ModelType;
}

// Session state (common between implementations)
export interface ClaudeSession {
    sessionId: string;
    userId: string;
    workingDirectory: string;
    claudeSessionId: string | null;
    mode: SessionMode;
    model: string;
    isStreaming: boolean;
    isCompacting: boolean;

    // Usage tracking
    contextWindow: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalCostUsd: number;

    // Reconnection state
    lastActivityAt: number;
    disconnectedAt: number | null;
}

// Events emitted by ClaudeManager
export type ClaudeEventType =
    | 'status'
    | 'output'
    | 'message'
    | 'thinking'
    | 'tool_use'
    | 'usage'
    | 'compacting'
    | 'agent'
    | 'command_output'
    | 'todos'
    | 'restarted'
    | 'mode_changing'
    | 'mode_changed'
    | 'model_changing'
    | 'model_changed';

export interface ClaudeEvent {
    type: ClaudeEventType;
    sessionId: string;
    data: unknown;
}

// Tool execution tracking
export interface ToolExecution {
    toolId: string;
    toolName: string;
    input?: unknown;
    result?: string;
    status: 'started' | 'completed' | 'error';
}

// Permission request (for SDK manager to handle inline)
export interface PermissionRequest {
    requestId: string;
    sessionId: string;
    toolName: string;
    input: unknown;
    description?: string;
}

// User question (for SDK manager to handle inline)
export interface UserQuestion {
    questionId: string;
    sessionId: string;
    questions: Array<{
        question: string;
        header: string;
        options: Array<{label: string; description: string}>;
        multiSelect: boolean;
    }>;
}

// Plan approval request
export interface PlanApprovalRequest {
    requestId: string;
    sessionId: string;
    planPath?: string;
}

// Commit approval request
export interface CommitApprovalRequest {
    requestId: string;
    sessionId: string;
    commitData: {
        title: string;
        body?: string;
        files?: string[];
    };
}

// Abstract interface for Claude management
export interface IClaudeManager {
    // Lifecycle
    startSession(sessionId: string, userId: string, options?: SessionOptions): Promise<void>;
    stopSession(sessionId: string, userId: string): void;
    restartSession(sessionId: string, userId: string): Promise<void>;
    resumeSession(sessionId: string, userId: string): Promise<void>;

    // Communication
    sendMessage(sessionId: string, userId: string, message: string, images?: ImageData[], suppressSaving?: boolean): Promise<void>;
    interrupt(sessionId: string, userId: string): Promise<void>;
    sendRawInput(sessionId: string, userId: string, input: string): Promise<void>;
    sendRawJson(sessionId: string, userId: string, jsonMessage: unknown): Promise<void>;

    // Tool handling (for process manager - SDK handles inline)
    injectToolResult(sessionId: string, toolUseId: string, result: unknown): void;

    // Configuration
    setMode(sessionId: string, userId: string, mode: SessionMode): void;
    setModel(sessionId: string, userId: string, model: ModelType): void;

    // State queries
    isSessionRunning(sessionId: string): boolean;
    getRunningSessionIds(): string[];
    getSessionBuffer(sessionId: string, sinceTimestamp?: number): BufferedMessage[];
    getCurrentUsage(sessionId: string): void;

    // Reconnection management
    markSessionDisconnected(sessionId: string): void;
    markSessionReconnected(sessionId: string): void;
}

// Model IDs mapping
export const MODEL_IDS: Record<ModelType, string> = {
    opus: 'claude-opus-4-20250514',
    sonnet: 'claude-sonnet-4-20250514',
    haiku: 'claude-haiku-3-5-20241022',
};
