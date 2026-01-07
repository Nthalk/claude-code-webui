/**
 * Claude Manager Factory
 *
 * Provides a unified interface to create Claude managers.
 * Currently supports:
 * - 'process': CLI-based process spawning (ClaudeProcessManager)
 * - 'sdk': Agent SDK-based (ClaudeSdkManager) - not yet fully implemented
 */

import {config} from '../../config';
import type {IClaudeManager, SocketIOServer} from './types';
import {ClaudeProcessManager} from './ClaudeProcessManager';
import {ClaudeSdkManager} from './ClaudeSdkManager';

export type ClaudeManagerType = 'process' | 'sdk';

/**
 * Create a Claude manager instance.
 *
 * @param io - Socket.IO server instance
 * @param type - Manager type ('process' or 'sdk'), defaults to config or 'process'
 * @returns A Claude manager implementing IClaudeManager
 */
export function createClaudeManager(
    io: SocketIOServer,
    type?: ClaudeManagerType
): IClaudeManager {
    // Use provided type, or config, or default to 'process'
    const managerType = type ?? (config.claudeManagerType as ClaudeManagerType) ?? 'process';

    console.log(`[FACTORY] Creating Claude manager of type: ${managerType}`);

    switch (managerType) {
        case 'sdk':
            console.log('[FACTORY] Using SDK-based manager (experimental)');
            return new ClaudeSdkManager(io);

        case 'process':
        default:
            console.log('[FACTORY] Using process-based manager');
            return new ClaudeProcessManager(io);
    }
}

// Re-export types and classes for convenience
export {ClaudeProcessManager} from './ClaudeProcessManager';
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
