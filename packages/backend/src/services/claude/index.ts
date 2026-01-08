/**
 * Claude Manager Module
 *
 * Provides the Claude SDK-based manager for handling Claude CLI interactions.
 */

import type {IClaudeManager, SocketIOServer} from './types';
import {ClaudeSdkManager} from './ClaudeSdkManager';

/**
 * Create a Claude manager instance.
 *
 * @param io - Socket.IO server instance
 * @returns A Claude manager implementing IClaudeManager
 */
export function createClaudeManager(io: SocketIOServer): IClaudeManager {
    console.log('[FACTORY] Creating Claude SDK manager');
    return new ClaudeSdkManager(io);
}

// Re-export types and classes for convenience
export {ClaudeSdkManager} from './ClaudeSdkManager';
export {ClaudeManager} from './ClaudeManager';
export type {
    IClaudeManager,
    ImageData,
    SessionOptions,
    SocketIOServer,
    ClaudeSession,
    PermissionRequest,
    UserQuestion,
    PlanApprovalRequest,
    CommitApprovalRequest,
} from './types';
export {MODEL_IDS} from './types';
