export type MessageRole = 'user' | 'assistant' | 'system' | 'meta';

export interface MessageImage {
  path: string;
  filename: string;
}

export interface CompactMetadata {
  startContext: number;
  endContext: number;
  duration?: number;
  trigger?: string;
  pre_tokens?: number;
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  createdAt: string;
  images?: MessageImage[];
  // Meta message fields
  metaType?: 'compact' | 'resume' | 'restart' | 'command_output' | 'system';
  metaData?: CompactMetadata | { time?: string } | { output: string } | { subtype?: string };
  // Pending state for user messages that haven't been acknowledged by Claude
  isPending?: boolean;
}

export interface ToolUse {
  name: string;
  input: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface StreamingMessage {
  sessionId: string;
  content: string;
  isComplete: boolean;
  toolUse?: ToolUse;
}
