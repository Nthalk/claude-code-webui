export type Theme = 'dark' | 'light' | 'system';

export interface UserSettings {
  userId: string;
  theme: Theme;
  defaultWorkingDir: string | null;
  allowedTools: string[];
  customSystemPrompt: string | null;
  autoCompactEnabled: boolean;
  autoCompactThreshold: number; // percentage 0-100
}

export interface UpdateSettingsInput {
  theme?: Theme;
  defaultWorkingDir?: string | null;
  allowedTools?: string[];
  customSystemPrompt?: string | null;
  autoCompactEnabled?: boolean;
  autoCompactThreshold?: number;
}

export interface ClaudeSettings {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}
