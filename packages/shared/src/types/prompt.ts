/**
 * Unified User Prompt System Types
 *
 * Replaces fragmented pending request systems (permissions, plan approvals, questions)
 * with a single discriminated union type system.
 */

// Prompt type discriminator
export type PromptType = 'permission' | 'plan_approval' | 'user_question' | 'commit_approval';

// Base prompt interface with common fields
export interface BasePrompt {
  id: string;
  sessionId: string;
  type: PromptType;
  createdAt: number;
}

// Permission prompt - tool permission requests
export interface PermissionPrompt extends BasePrompt {
  type: 'permission';
  toolName: string;
  toolInput: unknown;
  description: string;
  suggestedPattern: string;
}

// Plan approval prompt - ExitPlanMode approval
export interface PlanApprovalPrompt extends BasePrompt {
  type: 'plan_approval';
  planContent?: string;
  planPath?: string;
}

// User question prompt - AskUserQuestion tool
export interface UserQuestionPrompt extends BasePrompt {
  type: 'user_question';
  questions: UserQuestionItem[];
}

// Question item within UserQuestionPrompt
export interface UserQuestionItem {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
}

// Commit approval prompt - git commit approval
export interface CommitApprovalPrompt extends BasePrompt {
  type: 'commit_approval';
  commitMessage: string;
  gitStatus: string;
}

// Discriminated union of all prompt types
export type Prompt = PermissionPrompt | PlanApprovalPrompt | UserQuestionPrompt | CommitApprovalPrompt;

// Session's prompt queue
export interface Promptable {
  sessionId: string;
  promptQueue: Prompt[];
}

// Response type discriminator
export type PromptResponseType = PromptType;

// Base response interface
export interface BasePromptResponse {
  type: PromptResponseType;
}

// Permission response
export interface PermissionPromptResponse extends BasePromptResponse {
  type: 'permission';
  approved: boolean;
  pattern?: string;
}

// Plan approval response
export interface PlanApprovalPromptResponse extends BasePromptResponse {
  type: 'plan_approval';
  approved: boolean;
  reason?: string;
}

// User question response
export interface UserQuestionPromptResponse extends BasePromptResponse {
  type: 'user_question';
  answers: Record<string, string | string[]>;
}

// Commit approval response
export interface CommitApprovalPromptResponse extends BasePromptResponse {
  type: 'commit_approval';
  approved: boolean;
  push?: boolean;
  reason?: string;
}

// Discriminated union of all response types
export type PromptResponse =
  | PermissionPromptResponse
  | PlanApprovalPromptResponse
  | UserQuestionPromptResponse
  | CommitApprovalPromptResponse;

// Helper type to get response type for a given prompt type
export type PromptResponseFor<T extends PromptType> =
  T extends 'permission' ? PermissionPromptResponse :
  T extends 'plan_approval' ? PlanApprovalPromptResponse :
  T extends 'user_question' ? UserQuestionPromptResponse :
  T extends 'commit_approval' ? CommitApprovalPromptResponse :
  never;

// Priority order for prompt types (lower = higher priority)
export const PROMPT_PRIORITY: Record<PromptType, number> = {
  permission: 0,      // Highest - security critical
  user_question: 1,
  plan_approval: 2,
  commit_approval: 3, // Lowest
};
