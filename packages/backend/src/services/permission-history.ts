/**
 * Permission History Service
 *
 * Tracks permission decisions in-memory for debugging and audit purposes.
 * Emits WebSocket events for real-time updates to the debug panel.
 */

import type { Server as SocketIOServer } from 'socket.io';

export interface PermissionDecision {
  id: string;
  sessionId: string;
  timestamp: number;
  toolName: string;
  toolInput: unknown;
  decision: 'allow' | 'deny';
  reason: 'pattern' | 'mode' | 'user';
  matchedPattern?: string;
  mode?: string;
  duration?: number;
}

export interface PermissionStats {
  totalAllowed: number;
  totalDenied: number;
  byPattern: number;
  byMode: number;
  byUser: number;
  avgDuration: number;
}

const MAX_HISTORY_PER_SESSION = 1000;

class PermissionHistoryService {
  private history: Map<string, PermissionDecision[]> = new Map();
  private io: SocketIOServer | null = null;

  /**
   * Set the Socket.IO server instance for emitting events
   */
  setSocketIO(io: SocketIOServer): void {
    this.io = io;
  }

  /**
   * Track a permission decision
   */
  track(decision: PermissionDecision): void {
    let sessionHistory = this.history.get(decision.sessionId);

    if (!sessionHistory) {
      sessionHistory = [];
      this.history.set(decision.sessionId, sessionHistory);
    }

    // Add decision
    sessionHistory.push(decision);

    // Trim to max size (circular buffer behavior)
    if (sessionHistory.length > MAX_HISTORY_PER_SESSION) {
      sessionHistory.shift();
    }

    // Emit WebSocket event for real-time updates
    if (this.io) {
      console.log(`[PERMISSION] Emitting permission:decision to session:${decision.sessionId}`);
      this.io.to(`session:${decision.sessionId}`).emit('permission:decision', {
        sessionId: decision.sessionId,
        decision,
      });
    } else {
      console.log(`[PERMISSION] WARNING: No Socket.IO instance set, cannot emit permission:decision`);
    }

    console.log(`[PERMISSION] ${decision.decision.toUpperCase()} ${decision.toolName} (${decision.reason}${decision.matchedPattern ? `: ${decision.matchedPattern}` : ''})`);
  }

  /**
   * Get permission history for a session
   */
  getHistory(sessionId: string, limit?: number): PermissionDecision[] {
    const history = this.history.get(sessionId) || [];

    if (limit && limit > 0) {
      // Return most recent entries
      return history.slice(-limit);
    }

    return history;
  }

  /**
   * Get permission statistics for a session
   */
  getStats(sessionId: string): PermissionStats {
    const history = this.history.get(sessionId) || [];

    const stats: PermissionStats = {
      totalAllowed: 0,
      totalDenied: 0,
      byPattern: 0,
      byMode: 0,
      byUser: 0,
      avgDuration: 0,
    };

    let totalDuration = 0;
    let durationCount = 0;

    for (const decision of history) {
      if (decision.decision === 'allow') {
        stats.totalAllowed++;
      } else {
        stats.totalDenied++;
      }

      switch (decision.reason) {
        case 'pattern':
          stats.byPattern++;
          break;
        case 'mode':
          stats.byMode++;
          break;
        case 'user':
          stats.byUser++;
          break;
      }

      if (decision.duration !== undefined) {
        totalDuration += decision.duration;
        durationCount++;
      }
    }

    stats.avgDuration = durationCount > 0 ? totalDuration / durationCount : 0;

    return stats;
  }

  /**
   * Clear history for a session
   */
  clearHistory(sessionId: string): void {
    this.history.delete(sessionId);

    if (this.io) {
      this.io.to(`session:${sessionId}`).emit('permission:cleared', {
        sessionId,
      });
    }
  }

  /**
   * Get all session IDs with history
   */
  getSessionIds(): string[] {
    return Array.from(this.history.keys());
  }
}

// Singleton instance
export const permissionHistory = new PermissionHistoryService();
