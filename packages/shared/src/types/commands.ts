// Command System Types

export interface Command {
  name: string;
  description: string;
  arguments?: string[];
  scope: 'builtin' | 'user' | 'project';
  content?: string;  // Template content for custom commands
  projectPath?: string;  // For project-scoped commands
}

export interface ParsedCommand {
  name: string;
  args: string[];
  rawArgs: string;
}

export interface CommandExecutionResult {
  success: boolean;
  response?: string;
  error?: string;
  action?: 'clear' | 'clear_with_restart' | 'model_change' | 'send_message' | 'compact_context' | 'send_claude_command';
  data?: Record<string, unknown>;
}

// Built-in command names
export const BUILTIN_COMMANDS = [
  'help',
  'clear',
  'model',
  'status',
  'cost',
  'compact',
  'context',
] as const;

export type BuiltinCommandName = typeof BUILTIN_COMMANDS[number];
