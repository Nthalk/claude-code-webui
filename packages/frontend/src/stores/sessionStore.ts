import { create } from 'zustand';
import type { Session, Message, SessionStatus, UsageData, ToolExecution, PendingPermission, PendingUserQuestion, PendingPlanApproval } from '@claude-code-webui/shared';

// Activity state for showing what Claude is doing
export interface ActivityState {
  type: 'idle' | 'thinking' | 'tool';
  toolName?: string;
  toolStatus?: 'started' | 'completed' | 'error';
}

// Active agent state
export interface AgentState {
  agentType: string;
  description?: string;
  status: 'started' | 'completed' | 'error';
}

// Todo item from Claude's TodoWrite tool
export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

// Generated image from Gemini
export interface GeneratedImage {
  imageBase64?: string;
  mimeType: string;
  prompt: string;
  generator: 'gemini' | 'other';
  timestamp: number;
}

// Open file in code editor
export interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
  originalContent: string;
}

interface SessionState {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Record<string, Message[]>;
  streamingContent: Record<string, string>;
  thinking: Record<string, boolean>;
  compacting: Record<string, boolean>;
  compactingBuffer: Record<string, Message[]>;
  activity: Record<string, ActivityState>;
  activeAgent: Record<string, AgentState | null>;
  todos: Record<string, TodoItem[]>;
  usage: Record<string, UsageData>;
  generatedImages: Record<string, GeneratedImage[]>;
  toolExecutions: Record<string, ToolExecution[]>;
  pendingPermissions: Record<string, PendingPermission | null>;
  pendingUserQuestions: Record<string, PendingUserQuestion | null>;
  pendingPlanApprovals: Record<string, PendingPlanApproval | null>;

  // File Tree state
  fileTreeOpen: Record<string, boolean>;
  selectedFile: Record<string, string | null>;

  // Code Editor state
  openFiles: Record<string, OpenFile[]>;
  activeFileTab: Record<string, string | null>;

  // Right panel state (global, not per-session)
  rightPanelTab: 'files' | 'todos' | 'git' | 'debug' | null;
  setRightPanelTab: (tab: 'files' | 'todos' | 'git' | 'debug' | null) => void;

  // Mobile view state (for session pages)
  mobileView: 'chat' | 'files' | 'git' | 'editor' | 'debug';
  setMobileView: (view: 'chat' | 'files' | 'git' | 'editor' | 'debug') => void;

  // Mobile menu state (shared between Layout and SessionPage)
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;

  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string | null) => void;

  setMessages: (sessionId: string, messages: Message[]) => void;
  addMessage: (sessionId: string, message: Message) => void;

  setStreamingContent: (sessionId: string, content: string) => void;
  appendStreamingContent: (sessionId: string, content: string) => void;
  clearStreamingContent: (sessionId: string) => void;

  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  setThinking: (sessionId: string, isThinking: boolean) => void;
  setCompacting: (sessionId: string, isCompacting: boolean) => void;
  addToCompactingBuffer: (sessionId: string, message: Message) => void;
  flushCompactingBuffer: (sessionId: string) => void;
  setActivity: (sessionId: string, activity: ActivityState) => void;
  setActiveAgent: (sessionId: string, agent: AgentState | null) => void;
  setTodos: (sessionId: string, todos: TodoItem[]) => void;
  setUsage: (sessionId: string, usage: UsageData) => void;
  addGeneratedImage: (sessionId: string, image: Omit<GeneratedImage, 'timestamp'>) => void;
  clearGeneratedImages: (sessionId: string) => void;
  setToolExecutions: (sessionId: string, executions: ToolExecution[]) => void;
  addToolExecution: (sessionId: string, execution: ToolExecution) => void;
  updateToolExecution: (sessionId: string, toolId: string, update: Partial<ToolExecution>) => void;
  clearToolExecutions: (sessionId: string) => void;
  setPendingPermission: (sessionId: string, permission: PendingPermission | null) => void;
  setPendingUserQuestion: (sessionId: string, question: PendingUserQuestion | null) => void;
  setPendingPlanApproval: (sessionId: string, approval: PendingPlanApproval | null) => void;

  // File Tree actions
  setFileTreeOpen: (sessionId: string, open: boolean) => void;
  setSelectedFile: (sessionId: string, path: string | null) => void;

  // Code Editor actions
  openFile: (sessionId: string, path: string, content: string) => void;
  closeFile: (sessionId: string, path: string) => void;
  updateFileContent: (sessionId: string, path: string, content: string) => void;
  markFileSaved: (sessionId: string, path: string) => void;
  setActiveTab: (sessionId: string, path: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  sessions: [],
  activeSessionId: null,
  messages: {},
  streamingContent: {},
  thinking: {},
  compacting: {},
  compactingBuffer: {},
  activity: {},
  activeAgent: {},
  todos: {},
  usage: {},
  generatedImages: {},
  toolExecutions: {},
  pendingPermissions: {},
  pendingUserQuestions: {},
  pendingPlanApprovals: {},
  fileTreeOpen: {},
  selectedFile: {},
  openFiles: {},
  activeFileTab: {},
  rightPanelTab: (() => {
    const saved = localStorage.getItem('right-panel-tab');
    console.log('Loading rightPanelTab from localStorage:', saved);
    // Validate the saved value
    const validTabs = ['files', 'todos', 'git', 'debug', null];
    const value = saved && validTabs.includes(saved) ? saved : null;
    return value as 'files' | 'todos' | 'git' | 'debug' | null;
  })(),

  setRightPanelTab: (tab) => {
    console.log('setRightPanelTab called with:', tab);
    if (tab) {
      localStorage.setItem('right-panel-tab', tab);
    } else {
      localStorage.removeItem('right-panel-tab');
    }
    set({ rightPanelTab: tab });
    console.log('rightPanelTab set to:', tab);
  },

  mobileView: 'chat',
  setMobileView: (view) => set({ mobileView: view }),

  mobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((state) => ({
      sessions: [session, ...state.sessions],
    })),

  updateSession: (id, updates) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    })),

  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      activeSessionId: state.activeSessionId === id ? null : state.activeSessionId,
    })),

  setActiveSession: (id) => set({ activeSessionId: id }),

  setMessages: (sessionId, messages) =>
    set((state) => ({
      messages: { ...state.messages, [sessionId]: messages },
    })),

  addMessage: (sessionId, message) =>
    set((state) => {
      const existingMessages = state.messages[sessionId] || [];
      // Deduplicate: don't add if message with same ID already exists
      if (existingMessages.some((m) => m.id === message.id)) {
        return state;
      }
      // Ensure message has createdAt, default to now if missing
      const messageWithTimestamp = message.createdAt
        ? message
        : { ...message, createdAt: new Date().toISOString() };
      // Insert message in chronological order
      const newMessages = [...existingMessages, messageWithTimestamp].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      return {
        messages: {
          ...state.messages,
          [sessionId]: newMessages,
        },
      };
    }),

  setStreamingContent: (sessionId, content) =>
    set((state) => ({
      streamingContent: {
        ...state.streamingContent,
        [sessionId]: content,
      },
    })),

  appendStreamingContent: (sessionId, content) =>
    set((state) => ({
      streamingContent: {
        ...state.streamingContent,
        [sessionId]: (state.streamingContent[sessionId] || '') + content,
      },
    })),

  clearStreamingContent: (sessionId) =>
    set((state) => ({
      streamingContent: {
        ...state.streamingContent,
        [sessionId]: '',
      },
    })),

  updateSessionStatus: (sessionId, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === sessionId ? { ...s, status } : s)),
    })),

  setThinking: (sessionId, isThinking) =>
    set((state) => ({
      thinking: { ...state.thinking, [sessionId]: isThinking },
    })),

  setCompacting: (sessionId, isCompacting) =>
    set((state) => ({
      compacting: { ...state.compacting, [sessionId]: isCompacting },
    })),

  addToCompactingBuffer: (sessionId, message) =>
    set((state) => ({
      compactingBuffer: {
        ...state.compactingBuffer,
        [sessionId]: [...(state.compactingBuffer[sessionId] || []), message],
      },
    })),

  flushCompactingBuffer: (sessionId) =>
    set((state) => ({
      compactingBuffer: { ...state.compactingBuffer, [sessionId]: [] },
    })),

  setActivity: (sessionId, activity) =>
    set((state) => ({
      activity: { ...state.activity, [sessionId]: activity },
    })),

  setActiveAgent: (sessionId, agent) =>
    set((state) => ({
      activeAgent: { ...state.activeAgent, [sessionId]: agent },
    })),

  setTodos: (sessionId, todos) =>
    set((state) => ({
      todos: { ...state.todos, [sessionId]: todos },
    })),

  setUsage: (sessionId, usage) =>
    set((state) => ({
      usage: { ...state.usage, [sessionId]: usage },
    })),

  addGeneratedImage: (sessionId, image) =>
    set((state) => ({
      generatedImages: {
        ...state.generatedImages,
        [sessionId]: [
          ...(state.generatedImages[sessionId] || []),
          { ...image, timestamp: Date.now() },
        ],
      },
    })),

  clearGeneratedImages: (sessionId) =>
    set((state) => ({
      generatedImages: {
        ...state.generatedImages,
        [sessionId]: [],
      },
    })),

  setToolExecutions: (sessionId, executions) =>
    set((state) => {
      const existing = state.toolExecutions[sessionId] || [];
      // Merge: API data as base, but preserve any socket updates (started tools not yet in DB)
      const existingMap = new Map(existing.map(e => [e.toolId, e]));
      const apiMap = new Map(executions.map(e => [e.toolId, e]));

      // Start with API data, then overlay any "started" tools from socket that aren't in API yet
      const merged: typeof executions = [...executions];
      for (const [toolId, exec] of existingMap) {
        if (!apiMap.has(toolId)) {
          // Tool exists in socket state but not in API - keep it (still in progress)
          merged.push(exec);
        }
      }

      return {
        toolExecutions: {
          ...state.toolExecutions,
          [sessionId]: merged,
        },
      };
    }),

  addToolExecution: (sessionId, execution) =>
    set((state) => {
      const existingExecutions = state.toolExecutions[sessionId] || [];
      // Deduplicate: don't add if tool execution with same ID already exists
      if (existingExecutions.some((e) => e.toolId === execution.toolId)) {
        return state;
      }
      return {
        toolExecutions: {
          ...state.toolExecutions,
          [sessionId]: [...existingExecutions, execution],
        },
      };
    }),

  updateToolExecution: (sessionId, toolId, update) =>
    set((state) => ({
      toolExecutions: {
        ...state.toolExecutions,
        [sessionId]: (state.toolExecutions[sessionId] || []).map((exec) =>
          exec.toolId === toolId ? { ...exec, ...update } : exec
        ),
      },
    })),

  clearToolExecutions: (sessionId) =>
    set((state) => ({
      toolExecutions: {
        ...state.toolExecutions,
        [sessionId]: [],
      },
    })),

  setPendingPermission: (sessionId, permission) =>
    set((state) => ({
      pendingPermissions: {
        ...state.pendingPermissions,
        [sessionId]: permission,
      },
    })),

  setPendingUserQuestion: (sessionId, question) =>
    set((state) => ({
      pendingUserQuestions: {
        ...state.pendingUserQuestions,
        [sessionId]: question,
      },
    })),

  setPendingPlanApproval: (sessionId, approval) =>
    set((state) => ({
      pendingPlanApprovals: {
        ...state.pendingPlanApprovals,
        [sessionId]: approval,
      },
    })),

  // File Tree actions
  setFileTreeOpen: (sessionId, open) =>
    set((state) => ({
      fileTreeOpen: { ...state.fileTreeOpen, [sessionId]: open },
    })),

  setSelectedFile: (sessionId, path) =>
    set((state) => ({
      selectedFile: { ...state.selectedFile, [sessionId]: path },
    })),

  // Code Editor actions
  openFile: (sessionId, path, content) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      const existing = files.find((f) => f.path === path);
      if (existing) {
        // File already open, just switch to it
        return {
          activeFileTab: { ...state.activeFileTab, [sessionId]: path },
        };
      }
      return {
        openFiles: {
          ...state.openFiles,
          [sessionId]: [
            ...files,
            { path, content, isDirty: false, originalContent: content },
          ],
        },
        activeFileTab: { ...state.activeFileTab, [sessionId]: path },
      };
    }),

  closeFile: (sessionId, path) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      const newFiles = files.filter((f) => f.path !== path);
      const currentTab = state.activeFileTab[sessionId] ?? null;
      let newActiveTab: string | null = currentTab;

      // If closing the active tab, switch to another
      if (currentTab === path) {
        const closedIndex = files.findIndex((f) => f.path === path);
        if (newFiles.length > 0) {
          const newIndex = Math.min(closedIndex, newFiles.length - 1);
          newActiveTab = newFiles[newIndex]?.path ?? null;
        } else {
          newActiveTab = null;
        }
      }

      const newActiveFileTab: Record<string, string | null> = { ...state.activeFileTab };
      newActiveFileTab[sessionId] = newActiveTab;

      return {
        openFiles: { ...state.openFiles, [sessionId]: newFiles },
        activeFileTab: newActiveFileTab,
      };
    }),

  updateFileContent: (sessionId, path, content) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      return {
        openFiles: {
          ...state.openFiles,
          [sessionId]: files.map((f) =>
            f.path === path
              ? { ...f, content, isDirty: content !== f.originalContent }
              : f
          ),
        },
      };
    }),

  markFileSaved: (sessionId, path) =>
    set((state) => {
      const files = state.openFiles[sessionId] || [];
      return {
        openFiles: {
          ...state.openFiles,
          [sessionId]: files.map((f) =>
            f.path === path
              ? { ...f, isDirty: false, originalContent: f.content }
              : f
          ),
        },
      };
    }),

  setActiveTab: (sessionId, path) =>
    set((state) => ({
      activeFileTab: { ...state.activeFileTab, [sessionId]: path },
    })),
}));
