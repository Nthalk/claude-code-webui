export type SessionStatus = 'running' | 'stopped' | 'error';

// Session state for persistence across reconnects
// - 'inactive': Session is idle, no pending work
// - 'active': Claude process is running or was running when client disconnected
// - 'has-pending': Has queued messages waiting to be processed
export type SessionState = 'inactive' | 'active' | 'has-pending';

export interface Session {
  id: string;
  userId: string;
  name: string;
  workingDirectory: string;
  claudeSessionId: string | null;
  status: SessionStatus;
  sessionState: SessionState;
  lastMessage: string | null;
  starred: boolean;
  model?: string;
  mode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PendingMessage {
  id: string;
  sessionId: string;
  content: string;
  createdAt: string;
}

export interface CreateSessionInput {
  name: string;
  workingDirectory: string;
}

export interface UpdateSessionInput {
  name?: string;
  workingDirectory?: string;
}
