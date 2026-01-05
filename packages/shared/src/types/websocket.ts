import type { Message, StreamingMessage } from './message';
import type { SessionStatus } from './session';

// Session permission mode
export type SessionMode = 'planning' | 'auto-accept' | 'manual' | 'danger';

// Model type for Claude sessions
export type ModelType = 'opus' | 'sonnet' | 'haiku';

// Image data for sending to Claude
export interface ImageAttachmentData {
  data: string; // base64 encoded
  mimeType: string;
}

// Buffered message for reconnection replay
export interface BufferedMessage {
  type: 'output' | 'message' | 'thinking' | 'tool_use' | 'usage' | 'todos' | 'agent' | 'image' | 'status';
  data: unknown;
  timestamp: number;
}

// Permission response action type
export type PermissionAction = 'allow_once' | 'allow_project' | 'allow_global' | 'deny';

// Client to Server Events
export interface ClientToServerEvents {
  'heartbeat': (data: { sessionId: string }) => void;
  'session:send': (data: {
    sessionId: string;
    message: string;
    images?: ImageAttachmentData[];
  }) => void;
  'session:input': (data: {
    sessionId: string;
    input: string;
  }) => void;
  'session:subscribe': (sessionId: string) => void;
  'session:unsubscribe': (sessionId: string) => void;
  'session:interrupt': (sessionId: string) => void;
  'session:restart': (sessionId: string) => void;
  'session:reconnect': (data: {
    sessionId: string;
    lastTimestamp?: number;
  }) => void;
  'session:generate-image': (data: {
    sessionId: string;
    prompt: string;
    model?: 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview';
    referenceImages?: string[];
  }) => void;
  'session:set-mode': (data: {
    sessionId: string;
    mode: SessionMode;
  }) => void;
  'session:set-model': (data: {
    sessionId: string;
    model: ModelType;
  }) => void;
  'session:permission_respond': (data: {
    sessionId: string;
    requestId: string;
    action: PermissionAction;
    pattern?: string;
  }) => void;
  'session:question_respond': (data: {
    sessionId: string;
    requestId: string;
    answers: UserQuestionAnswers;
  }) => void;
}

// Usage data from Claude CLI
export interface UsageData {
  sessionId: string;
  // Token usage
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  // Context window
  contextWindow: number;
  contextUsedPercent: number;
  // Cost
  totalCostUsd: number;
  // Model info
  model: string;
}

// Todo item from Claude's TodoWrite tool
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Tool execution record for display
export interface ToolExecution {
  toolId: string;
  toolName: string;
  status: 'started' | 'completed' | 'error';
  input?: unknown;
  result?: string;
  error?: string;
  timestamp: number;
}

// Pending permission request from Claude
export interface PendingPermission {
  sessionId: string;
  requestId: string;
  toolName: string;
  toolInput: unknown;
  description: string;
  suggestedPattern: string;
}

// User question option for AskUserQuestion tool
export interface UserQuestionOption {
  label: string;
  description?: string;
}

// Single question from AskUserQuestion tool
export interface UserQuestion {
  question: string;
  header: string;
  options: UserQuestionOption[];
  multiSelect: boolean;
}

// Pending user question request from Claude
export interface PendingUserQuestion {
  sessionId: string;
  requestId: string;
  questions: UserQuestion[];
}

// User's answers to questions
export interface UserQuestionAnswers {
  [questionIndex: string]: string | string[]; // index -> selected option label(s) or custom text
}

// Generated image data
export interface GeneratedImageData {
  sessionId: string;
  imagePath: string;
  imageBase64?: string;
  mimeType: string;
  prompt: string;
  generator: 'gemini' | 'other';
}

// Server to Client Events
export interface ServerToClientEvents {
  'session:output': (data: StreamingMessage) => void;
  'session:message': (data: Message) => void;
  'session:status': (data: { sessionId: string; status: SessionStatus }) => void;
  'session:error': (data: { sessionId: string; error: string }) => void;
  'session:tool_use': (data: {
    sessionId: string;
    toolName: string;
    status: 'started' | 'completed' | 'error';
    toolId?: string;
    input?: unknown;
    result?: string;
    error?: string;
  }) => void;
  'session:agent': (data: {
    sessionId: string;
    agentType: string;
    description?: string;
    status: 'started' | 'completed' | 'error';
  }) => void;
  'session:thinking': (data: { sessionId: string; isThinking: boolean }) => void;
  'session:todos': (data: { sessionId: string; todos: TodoItem[] }) => void;
  'session:usage': (data: UsageData) => void;
  'session:image': (data: GeneratedImageData) => void;
  'session:restarted': (data: { sessionId: string }) => void;
  'session:cleared': (data: { sessionId: string }) => void;
  'session:reconnected': (data: {
    sessionId: string;
    bufferedMessages: BufferedMessage[];
    isRunning: boolean;
  }) => void;
  'session:permission_request': (data: PendingPermission) => void;
  'session:permission_resolved': (data: { sessionId: string; requestId: string }) => void;
  'session:question_request': (data: PendingUserQuestion) => void;
  'session:question_resolved': (data: { sessionId: string; requestId: string }) => void;
  'heartbeat': (data: { sessionId: string; status: 'ok' | 'not_found' }) => void;
  error: (message: string) => void;
}

// Inter-server Events (for scaling)
export interface InterServerEvents {
  ping: () => void;
}

// Socket Data
export interface SocketData {
  userId: string;
  subscribedSessions: Set<string>;
}
