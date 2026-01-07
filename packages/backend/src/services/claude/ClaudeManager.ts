import type {
    BufferedMessage,
    ModelType,
    SessionMode,
} from '@claude-code-webui/shared';
import {getDatabase} from '../../db';
import {nanoid} from 'nanoid';
import type {
    IClaudeManager,
    ImageData,
    SessionOptions,
    SocketIOServer,
} from './types';

// Circular buffer for storing messages for reconnection
const BUFFER_SIZE = 5000;

export class CircularBuffer<T> {
    private buffer: T[] = [];
    private maxSize: number;

    constructor(maxSize: number = BUFFER_SIZE) {
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

/**
 * Abstract base class for Claude managers.
 * Provides common functionality for both Process and SDK implementations.
 */
export abstract class ClaudeManager implements IClaudeManager {
    protected io: SocketIOServer;
    protected pendingModes: Map<string, SessionMode> = new Map();
    protected pendingModels: Map<string, ModelType> = new Map();

    constructor(io: SocketIOServer) {
        this.io = io;
    }

    // Abstract methods - must be implemented by subclasses
    abstract startSession(sessionId: string, userId: string, options?: SessionOptions): Promise<void>;
    abstract stopSession(sessionId: string, userId: string): void;
    abstract restartSession(sessionId: string, userId: string): Promise<void>;
    abstract resumeSession(sessionId: string, userId: string): Promise<void>;
    abstract sendMessage(sessionId: string, userId: string, message: string, images?: ImageData[], suppressSaving?: boolean): Promise<void>;
    abstract interrupt(sessionId: string, userId: string): Promise<void>;
    abstract sendRawInput(sessionId: string, userId: string, input: string): Promise<void>;
    abstract sendRawJson(sessionId: string, userId: string, jsonMessage: unknown): Promise<void>;
    abstract injectToolResult(sessionId: string, toolUseId: string, result: unknown): void;
    abstract setMode(sessionId: string, userId: string, mode: SessionMode): void;
    abstract setModel(sessionId: string, userId: string, model: ModelType): void;
    abstract isSessionRunning(sessionId: string): boolean;
    abstract getRunningSessionIds(): string[];
    abstract getSessionBuffer(sessionId: string, sinceTimestamp?: number): BufferedMessage[];
    abstract getCurrentUsage(sessionId: string): void;
    abstract markSessionDisconnected(sessionId: string): void;
    abstract markSessionReconnected(sessionId: string): void;

    // Common helper methods

    /**
     * Save an assistant message to the database and emit to clients
     */
    protected saveAssistantMessage(sessionId: string, content: string, skipCompactCheck = false): void {
        // Subclass should check for compacting state if needed
        if (!skipCompactCheck && this.isCompacting(sessionId)) {
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

    /**
     * Save a meta message (compact, resume, restart, command_output)
     */
    protected saveMetaMessage(
        sessionId: string,
        metaType: 'compact' | 'resume' | 'restart' | 'command_output',
        metaData: Record<string, unknown>
    ): void {
        const db = getDatabase();
        const messageId = nanoid();
        const createdAt = new Date().toISOString();

        db.prepare('INSERT INTO messages (id, session_id, role, content, created_at, meta_type, meta_data) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
            messageId,
            sessionId,
            'meta',
            '',
            createdAt,
            metaType,
            JSON.stringify(metaData)
        );

        this.io.to(`session:${sessionId}`).emit('session:message', {
            id: messageId,
            sessionId,
            role: 'meta' as const,
            content: '',
            createdAt,
            metaType,
            metaData: metaData as { time?: string } | { output: string },
        });

        console.log(`Saved meta message [${sessionId}]: ${metaType}`, metaData);
    }

    /**
     * Save a tool execution to the database
     */
    protected saveToolExecution(
        sessionId: string,
        toolId: string,
        toolName: string,
        input?: unknown,
        status: 'started' | 'completed' | 'error' = 'started'
    ): void {
        const db = getDatabase();
        const inputStr = input ? JSON.stringify(input) : null;
        const createdAt = new Date().toISOString();

        db.prepare(
            'INSERT INTO tool_executions (id, session_id, tool_name, input, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(toolId, sessionId, toolName, inputStr, status, createdAt);

        console.log(`[TOOL DB] Saved tool execution: ${toolName} (${toolId}) - ${status}`);
    }

    /**
     * Update a tool execution in the database
     */
    protected updateToolExecution(
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
            db.prepare(`UPDATE tool_executions SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
            console.log(`[TOOL DB] Updated tool execution: ${toolId}`);
        }
    }

    /**
     * Emit usage data to connected clients
     */
    protected emitUsageData(
        sessionId: string,
        data: {
            model: string;
            contextWindow: number;
            totalInputTokens: number;
            totalOutputTokens: number;
            cacheReadTokens: number;
            cacheCreationTokens: number;
            totalCostUsd: number;
            userId: string;
        }
    ): void {
        const totalInputTokens = data.totalInputTokens + data.cacheCreationTokens + data.cacheReadTokens;
        const totalTokens = totalInputTokens + data.totalOutputTokens;
        const contextUsedPercent = Math.round((totalTokens / data.contextWindow) * 100);
        const contextRemainingPercent = 100 - contextUsedPercent;

        console.log(`[USAGE] Emitting usage for ${sessionId}: model=${data.model}, tokens=${totalTokens}, context=${contextRemainingPercent}% remaining, cost=$${data.totalCostUsd}`);

        this.io.to(`session:${sessionId}`).emit('session:usage', {
            sessionId,
            inputTokens: data.totalInputTokens,
            outputTokens: data.totalOutputTokens,
            cacheReadTokens: data.cacheReadTokens,
            cacheCreationTokens: data.cacheCreationTokens,
            totalTokens,
            contextWindow: data.contextWindow,
            contextUsedPercent,
            contextRemainingPercent,
            totalCostUsd: data.totalCostUsd,
            model: data.model,
        });

        // Store token usage in database
        this.storeTokenUsage(sessionId, data);
    }

    /**
     * Store token usage in database
     */
    private storeTokenUsage(
        sessionId: string,
        data: {
            model: string;
            contextWindow: number;
            totalInputTokens: number;
            totalOutputTokens: number;
            cacheReadTokens: number;
            cacheCreationTokens: number;
            totalCostUsd: number;
        }
    ): void {
        try {
            const db = getDatabase();
            const totalInputTokens = data.totalInputTokens + data.cacheCreationTokens + data.cacheReadTokens;
            const totalTokens = totalInputTokens + data.totalOutputTokens;
            const contextUsedPercent = Math.round((totalTokens / data.contextWindow) * 100);

            const existingUsage = db.prepare(`SELECT id FROM token_usage WHERE session_id = ?`).get(sessionId) as {id: string} | undefined;

            if (existingUsage) {
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
                    data.totalInputTokens,
                    data.totalOutputTokens,
                    data.cacheReadTokens,
                    data.cacheCreationTokens,
                    totalTokens,
                    data.contextWindow,
                    contextUsedPercent,
                    data.totalCostUsd,
                    data.model,
                    existingUsage.id
                );
            } else {
                db.prepare(`
                    INSERT INTO token_usage (
                        id, session_id, input_tokens, output_tokens,
                        cache_read_tokens, cache_creation_tokens, total_tokens,
                        context_window, context_used_percent, total_cost_usd, model
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    nanoid(),
                    sessionId,
                    data.totalInputTokens,
                    data.totalOutputTokens,
                    data.cacheReadTokens,
                    data.cacheCreationTokens,
                    totalTokens,
                    data.contextWindow,
                    contextUsedPercent,
                    data.totalCostUsd,
                    data.model
                );
            }
        } catch (error) {
            console.error(`[USAGE] Failed to store usage in database:`, error);
        }
    }

    /**
     * Parse /context command output
     */
    protected parseContextOutput(content: string): {
        model?: string;
        tokens?: number;
        contextWindow?: number;
        usedPercent?: number;
    } | null {
        const modelMatch = content.match(/\*\*Model:\*\*\s+(\S+)/);
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

    /**
     * Check if a session is currently compacting
     * Subclasses should override this
     */
    protected isCompacting(_sessionId: string): boolean {
        return false;
    }
}
