import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Square, FolderOpen, Image, X, Paperclip, Brain, ListTodo, Circle, CheckCircle, Loader2, GitBranch, MessageSquare, Code2, Star, RotateCcw, MoreVertical, Settings, Menu, ChevronDown, Loader, Bug } from 'lucide-react';
import 'katex/dist/katex.min.css';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { StreamingContent } from '@/components/chat/messages/StreamingContent';
import { SessionControls } from '@/components/session/SessionControls';
import { FileTree } from '@/components/file-tree';
import { GitPanel } from '@/components/git-panel';
import { DebugPanel } from '@/components/debug/DebugPanel';
import { EditorPanel } from '@/components/code-editor';
import { TodoBar } from '@/components/todo/TodoBar';
import { ChatMessage } from '@/components/chat/messages/ChatMessage';
import { GeneratedImage } from '@/components/chat/GeneratedImage';
import type { MobileView } from '@/components/mobile';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { socketService } from '@/services/socket';
import type { Session, Message, ApiResponse, CliTool, CliToolExecution, Command, CommandExecutionResult, SessionMode, ModelType, ToolExecution } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';
import { CommandMenu } from '@/components/chat/CommandMenu';
import { ToolExecutionCard } from '@/components/chat/messages/ToolExecutionCard';
import { PermissionApprovalDialog } from '@/components/chat/PermissionApprovalDialog';
import { UserQuestionDialog } from '@/components/chat/UserQuestionDialog';
import { PlanApprovalInput } from '@/components/chat/PlanApprovalInput';
import { useDocumentSwipeGesture, useChanged, timeBlock } from '@/hooks';
import { useTheme, type FontFamily, type FontSize } from '@/providers/ThemeProvider';
import type { PermissionAction, UserQuestionAnswers } from '@claude-code-webui/shared';

interface ImageAttachment {
  id: string;
  file: File;
  preview: string;
}

function generateId() {
  return Math.random().toString(36).substring(2, 9);
}

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('auto-accept');
  const [isChangingMode, setIsChangingMode] = useState(false);
  const [isChangingModel, setIsChangingModel] = useState(false);
  const [targetMode, setTargetMode] = useState<SessionMode | undefined>();
  const [targetModel, setTargetModel] = useState<ModelType | undefined>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);

  // Track what props/state changed between renders
  useChanged('SessionPage', {
    id,
    attachmentsLength: attachments.length,
    isDragging,
    isSending,
    sessionMode,
    isAtBottom,
    showScrollButton,
  }, ['id', 'attachmentsLength', 'isDragging', 'isSending', 'sessionMode', 'isAtBottom', 'showScrollButton']);

  // Use selectors to only subscribe to specific parts of the store
  const messages = useSessionStore((state) => state.messages);
  const streamingContent = useSessionStore((state) => state.streamingContent);
  const activity = useSessionStore((state) => state.activity);
  const compacting = useSessionStore((state) => state.compacting);
  const todos = useSessionStore((state) => state.todos);
  const generatedImages = useSessionStore((state) => state.generatedImages);
  const toolExecutions = useSessionStore((state) => state.toolExecutions);
  const pendingPermissions = useSessionStore((state) => state.pendingPermissions);
  const pendingUserQuestions = useSessionStore((state) => state.pendingUserQuestions);
  const pendingPlanApprovals = useSessionStore((state) => state.pendingPlanApprovals);
  const selectedFile = useSessionStore((state) => state.selectedFile);
  const openFiles = useSessionStore((state) => state.openFiles);
  const usage = useSessionStore((state) => state.usage);
  const mobileView = useSessionStore((state) => state.mobileView);
  const sessions = useSessionStore((state) => state.sessions);

  // Actions are stable references in Zustand - get them individually to avoid creating new objects
  const setMessages = useSessionStore((state) => state.setMessages);
  const setToolExecutions = useSessionStore((state) => state.setToolExecutions);
  const clearToolExecutions = useSessionStore((state) => state.clearToolExecutions);
  const clearGeneratedImages = useSessionStore((state) => state.clearGeneratedImages);
  const clearStreamingContent = useSessionStore((state) => state.clearStreamingContent);
  const setSelectedFile = useSessionStore((state) => state.setSelectedFile);
  const openFileInStore = useSessionStore((state) => state.openFile);
  const addMessage = useSessionStore((state) => state.addMessage);
  const setMobileView = useSessionStore((state) => state.setMobileView);
  const setMobileMenuOpen = useSessionStore((state) => state.setMobileMenuOpen);
  const setSessions = useSessionStore((state) => state.setSessions);

  const [selectedCliTool, setSelectedCliTool] = useState<string | null>(null);
  const [isExecutingTool, setIsExecutingTool] = useState(false);
  const cliToolAbortRef = useRef<AbortController | null>(null);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandMenuIndex, setCommandMenuIndex] = useState(0);
  const [visibleTimestamp, setVisibleTimestamp] = useState<string | null>(null);
  const [showProjectSettings, setShowProjectSettings] = useState(false);
  const { settings: themeSettings, updateDesktopFont, updateDesktopSize, updateMobileFont, updateMobileSize } = useTheme();

  // Get open files early for mobile view order
  const currentOpenFiles = openFiles[id || ''] || [];
  const hasOpenFiles = currentOpenFiles.length > 0;

  // Mobile swipe gesture navigation
  const mobileViewOrder = useMemo((): MobileView[] => {
    const views: MobileView[] = ['files', 'chat'];

    // Include editor if there are open files
    if (hasOpenFiles) {
      views.push('editor');
    }

    views.push('git', 'debug');
    return views;
  }, [hasOpenFiles]);

  const handleSwipeLeft = useCallback(() => {
    // Only work on mobile (screen width < 768px)
    if (window.innerWidth >= 768) return;

    const currentIndex = mobileViewOrder.indexOf(mobileView);
    const nextView = mobileViewOrder[currentIndex + 1];
    if (currentIndex < mobileViewOrder.length - 1 && nextView) {
      setMobileView(nextView);
    }
  }, [mobileView, mobileViewOrder]);

  const handleSwipeRight = useCallback(() => {
    // Only work on mobile (screen width < 768px)
    if (window.innerWidth >= 768) return;

    const currentIndex = mobileViewOrder.indexOf(mobileView);
    const prevView = mobileViewOrder[currentIndex - 1];
    if (currentIndex > 0 && prevView) {
      setMobileView(prevView);
    }
  }, [mobileView, mobileViewOrder]);

  // Set up edge swipe gestures for mobile navigation
  useDocumentSwipeGesture({
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    threshold: 30, // Reduced from 50 for more sensitivity
    velocityThreshold: 0.15, // Reduced from 0.25 for easier triggering
    enabled: true,
  });

  // Fetch available CLI tools
  const { data: cliTools } = useQuery({
    queryKey: ['cli-tools'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CliTool[]>>('/api/cli-tools');
      return (response.data.data || []).filter(t => t.enabled);
    },
  });

  // Fetch usage limits
  const { data: usageLimits } = useQuery({
    queryKey: ['usage-limits'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<{
        rateLimitTier: string;
        fiveHour: { utilization: number; resetsAt: string | null } | null;
        sevenDay: { utilization: number; resetsAt: string | null } | null;
        sevenDaySonnet: { utilization: number; resetsAt: string | null } | null;
      }>>('/api/usage/limits');
      if (response.data.success && response.data.data) {
        const data = response.data.data;
        const sessionUsed = Math.round(data.fiveHour?.utilization ?? 0);
        const weeklyAllUsed = Math.round(data.sevenDay?.utilization ?? 0);
        const weeklySonnetUsed = Math.round(data.sevenDaySonnet?.utilization ?? 0);

        return {
          session: {
            percentUsed: sessionUsed,
            percentRemaining: 100 - sessionUsed,
            resetsAt: data.fiveHour?.resetsAt ? new Date(data.fiveHour.resetsAt) : undefined,
          },
          weeklyAll: {
            percentUsed: weeklyAllUsed,
            percentRemaining: 100 - weeklyAllUsed,
            resetsAt: data.sevenDay?.resetsAt ? new Date(data.sevenDay.resetsAt) : undefined,
          },
          weeklySonnet: {
            percentUsed: weeklySonnetUsed,
            percentRemaining: 100 - weeklySonnetUsed,
            resetsAt: data.sevenDaySonnet?.resetsAt ? new Date(data.sevenDaySonnet.resetsAt) : undefined,
          },
        };
      }
      return null;
    },
    refetchInterval: 60000, // Refresh every minute
    retry: false, // Don't retry on error (Cloudflare may block)
    refetchOnWindowFocus: false,
  });

  const sessionMessages = messages[id || ''] || [];
  const currentStreamingContent = streamingContent[id || ''] || '';
  const currentActivity = activity[id || ''] || { type: 'idle' as const };
  const currentUsage = usage[id || ''];
  const currentTodos = todos[id || ''] || [];
  const currentGeneratedImages = generatedImages[id || ''] || [];
  const isCompacting = compacting[id || ''] || false;
  const currentToolExecutions = toolExecutions[id || ''] || [];
  const currentPendingPermission = pendingPermissions[id || ''] || null;
  const currentPendingUserQuestion = pendingUserQuestions[id || ''] || null;
  const currentPendingPlanApproval = pendingPlanApprovals[id || ''] || null;
  const hasTodos = currentTodos.length > 0 && currentTodos.some(t => t.status !== 'completed');

  // Right panel state from store (controlled by sidebar toggle buttons)
  const rightPanelTab = useSessionStore((state) => state.rightPanelTab);
  const setRightPanelTab = useSessionStore((state) => state.setRightPanelTab);

  const [mainView, setMainView] = useState<'chat' | 'editor'>('chat');
  const currentSelectedFile = selectedFile[id || ''];

  // State for how many messages to show
  const [messagesToShow, setMessagesToShow] = useState(50);

  // Combine messages, generated images, and tool executions into a single timeline
  type TimelineItem =
    | { type: 'message'; data: Message; timestamp: number }
    | { type: 'image'; data: typeof currentGeneratedImages[0]; timestamp: number }
    | { type: 'tool'; data: typeof currentToolExecutions[0]; timestamp: number };

  const timeline: TimelineItem[] = useMemo(() => timeBlock('timeline-creation', () => {
    const items = [
      ...sessionMessages.map(msg => ({
        type: 'message' as const,
        data: msg,
        timestamp: new Date(msg.createdAt).getTime(),
      })),
      ...currentGeneratedImages.map(img => ({
        type: 'image' as const,
        data: img,
        timestamp: img.timestamp,
      })),
      ...currentToolExecutions
        // Hide completed TodoWrite tool executions
        .filter(exec => !(exec.toolName === 'TodoWrite' && exec.status === 'completed'))
        .map(exec => ({
          type: 'tool' as const,
          data: exec,
          timestamp: exec.timestamp,
        })),
    ];
    return items.sort((a, b) => a.timestamp - b.timestamp);
  }), [sessionMessages, currentGeneratedImages, currentToolExecutions]); // Chronological order

  // Get visible timeline items - show the last N items
  const visibleTimeline = useMemo(() => timeBlock('visible-timeline', () => {
    if (timeline.length <= messagesToShow) return timeline;
    return timeline.slice(-messagesToShow);
  }), [timeline, messagesToShow]);

  const hasMoreMessages = timeline.length > messagesToShow;

  // Fetch all sessions for sidebar
  useQuery({
    queryKey: ['sessions'],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Session[]>>('/api/sessions');
      if (response.data.success && response.data.data) {
        setSessions(response.data.data);
        return response.data.data;
      }
      return [];
    },
  });

  // Fetch session details
  const { data: session, isLoading: sessionLoading } = useQuery({
    queryKey: ['session', id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Session>>(`/api/sessions/${id}`);
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return null;
    },
    enabled: !!id,
  });

  // Fetch messages
  const { isLoading: messagesLoading } = useQuery({
    queryKey: ['messages', id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Message[]>>(`/api/sessions/${id}/messages`);
      if (response.data.success && response.data.data) {
        setMessages(id!, response.data.data);
        return response.data.data;
      }
      return [];
    },
    enabled: !!id,
  });

  // Fetch tool executions
  useQuery({
    queryKey: ['toolExecutions', id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<ToolExecution[]>>(`/api/sessions/${id}/tool-executions`);
      if (response.data.success && response.data.data) {
        setToolExecutions(id!, response.data.data);
        return response.data.data;
      }
      return [];
    },
    enabled: !!id,
  });

  // Fetch available commands
  const { data: commands } = useQuery({
    queryKey: ['commands', session?.workingDirectory],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Command[]>>(
        `/api/commands?projectPath=${encodeURIComponent(session?.workingDirectory || '')}`
      );
      return response.data.data || [];
    },
    enabled: !!session,
  });

  const queryClient = useQueryClient();

  // Star/unstar session mutation
  const starMutation = useMutation({
    mutationFn: async () => {
      const response = await api.patch<ApiResponse<{ starred: boolean }>>(`/api/sessions/${id}/star`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
  });

  // Connect to socket and subscribe to session (with reconnect support)
  useEffect(() => {
    if (!id) return;

    socketService.connect();
    // Use reconnect instead of subscribe to get buffered messages if session is running
    socketService.reconnectToSession(id);

    // Start heartbeat to detect if backend restarts
    socketService.startHeartbeat(id, (sessionId) => {
      console.log(`[SESSION] Heartbeat detected session ${sessionId} not found, resuming session`);
      // Backend restarted - resume the session without sending an empty message
      socketService.resumeSession(sessionId);
      // Also reconnect to get proper subscription
      setTimeout(() => socketService.reconnectToSession(sessionId), 500);
    });

    return () => {
      socketService.stopHeartbeat();
      socketService.unsubscribeFromSession(id);
    };
  }, [id]);

  // Auto-resume session if it has pending messages or was active
  const [hasAutoResumed, setHasAutoResumed] = useState(false);
  useEffect(() => {
    if (!id || !session || hasAutoResumed) return;

    const autoResume = async () => {
      // Check if session needs to be resumed
      if (session.sessionState === 'has-pending' || session.sessionState === 'active') {
        console.log(`[SESSION] Auto-resuming session ${id} (state: ${session.sessionState})`);

        // Fetch pending messages if any
        if (session.sessionState === 'has-pending') {
          try {
            const response = await api.get<ApiResponse<Array<{ id: string; content: string }>>>(`/api/sessions/${id}/pending-messages`);
            if (response.data.success && response.data.data && response.data.data.length > 0) {
              console.log(`[SESSION] Found ${response.data.data.length} pending messages`);

              // Send each pending message
              for (const pendingMsg of response.data.data) {
                socketService.sendMessage(id, pendingMsg.content);
              }

              // Clear pending messages after sending
              await api.delete(`/api/sessions/${id}/pending-messages`);
            }
          } catch (error) {
            console.error('[SESSION] Error processing pending messages:', error);
          }
        } else if (session.sessionState === 'active') {
          // Session was active - just reconnect, it should resume automatically
          console.log(`[SESSION] Reconnecting to active session ${id}`);
          socketService.reconnectToSession(id);
        }

        setHasAutoResumed(true);
      }
    };

    autoResume();
  }, [id, session, hasAutoResumed]);

  // Track scroll position to determine if user is at bottom
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    const atBottom = distanceFromBottom < 50; // Within 50px of bottom

    setIsAtBottom(atBottom);
    setShowScrollButton(!atBottom && scrollHeight > clientHeight);
  }, []);

  // Auto-scroll to bottom when messages change, but only if already at bottom
  useEffect(() => {
    if (isAtBottom) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
      // Reset to showing last 50 messages when new messages arrive
      if (timeline.length > messagesToShow && messagesToShow < timeline.length) {
        setMessagesToShow(50);
      }
    }
  }, [timeline.length, currentStreamingContent, isAtBottom, messagesToShow]);

  // Scroll to bottom function for the button
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setIsAtBottom(true);
    setShowScrollButton(false);
    // Focus the input after scrolling
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 100);
  }, []);


  // Handle paste for images
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const imageItems = Array.from(items).filter(item => item.type.startsWith('image/'));
      if (imageItems.length === 0) return;

      e.preventDefault();
      const files = imageItems
        .map(item => item.getAsFile())
        .filter((f): f is File => f !== null);

      addImages(files);
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [attachments]);

  // Sync mobile view with right panel tab
  useEffect(() => {
    if (mobileView === 'git') {
      setRightPanelTab('git');
    } else if (mobileView === 'files') {
      setRightPanelTab('files');
    } else if (mobileView === 'debug') {
      setRightPanelTab('debug');
    } else if (mobileView === 'editor') {
      setMainView('editor');
    } else if (mobileView === 'chat') {
      setMainView('chat');
    }
  }, [mobileView, setRightPanelTab]);

  // Listen for model/mode change events
  useEffect(() => {
    const socket = socketService.getSocket();
    if (!socket || !id) return;

    const handleModelChanging = (data: { sessionId: string; from: ModelType; to: ModelType }) => {
      if (data.sessionId === id) {
        setIsChangingModel(true);
        setTargetModel(data.to);
      }
    };

    const handleModeChanging = (data: { sessionId: string; from: SessionMode; to: SessionMode }) => {
      if (data.sessionId === id) {
        setIsChangingMode(true);
        setTargetMode(data.to);
      }
    };

    const handleModelChanged = (data: { sessionId: string; model: ModelType }) => {
      if (data.sessionId === id) {
        setIsChangingModel(false);
        setTargetModel(undefined);
        // Model is already reflected in usage data
      }
    };

    const handleModeChanged = (data: { sessionId: string; mode: SessionMode }) => {
      if (data.sessionId === id) {
        setIsChangingMode(false);
        setTargetMode(undefined);
        setSessionMode(data.mode);
      }
    };

    socket.on('session:model_changing', handleModelChanging);
    socket.on('session:mode_changing', handleModeChanging);
    socket.on('session:model_changed', handleModelChanged);
    socket.on('session:mode_changed', handleModeChanged);

    return () => {
      socket.off('session:model_changing', handleModelChanging);
      socket.off('session:mode_changing', handleModeChanging);
      socket.off('session:model_changed', handleModelChanged);
      socket.off('session:mode_changed', handleModeChanged);
    };
  }, [id]);

  // Load mode from session data when sessions are loaded
  useEffect(() => {
    if (!id || sessions.length === 0) return;
    const currentSession = sessions.find(s => s.id === id);
    if (currentSession && 'mode' in currentSession) {
      setSessionMode(currentSession.mode as SessionMode);
    }
  }, [id, sessions]);

  const addImages = useCallback((files: File[]) => {
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    const maxImages = 5;
    const remaining = maxImages - attachments.length;

    if (remaining <= 0) return;

    const filesToAdd = imageFiles.slice(0, remaining);
    const newAttachments: ImageAttachment[] = filesToAdd.map(file => ({
      id: generateId(),
      file,
      preview: URL.createObjectURL(file),
    }));

    setAttachments(prev => [...prev, ...newAttachments]);
  }, [attachments.length]);

  const removeAttachment = (attachmentId: string) => {
    const attachment = attachments.find(a => a.id === attachmentId);
    if (attachment) {
      URL.revokeObjectURL(attachment.preview);
    }
    setAttachments(prev => prev.filter(a => a.id !== attachmentId));
  };

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget === dropZoneRef.current) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    addImages(files);
  }, [addImages]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    addImages(files);
    e.target.value = '';
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const input = textareaRef.current?.value || '';
    if ((!input.trim() && attachments.length === 0) || !id || isSending || isExecutingTool) return;

    // Check for slash commands
    if (input.startsWith('/')) {
      setShowCommandMenu(false);
      try {
        const response = await api.post<ApiResponse<CommandExecutionResult>>('/api/commands/execute', {
          input,
          projectPath: session?.workingDirectory,
          sessionId: id,
          currentModel: 'claude-opus-4-20250514',
          usage: currentUsage ? {
            inputTokens: currentUsage.inputTokens,
            outputTokens: currentUsage.outputTokens,
            cost: currentUsage.totalCostUsd,
          } : undefined,
        });

        const result = response.data.data;
        if (result) {
          if (result.action === 'clear') {
            // Delete messages and tool executions from database
            await api.delete(`/api/sessions/${id}/messages`);
            // Clear UI state
            setMessages(id, []);
            clearToolExecutions(id);
            clearGeneratedImages(id);
          } else if (result.action === 'clear_with_restart') {
            // Delete messages and tool executions from database
            await api.delete(`/api/sessions/${id}/messages`);
            // Clear UI state
            setMessages(id, []);
            clearToolExecutions(id);
            clearGeneratedImages(id);
            // Restart the Claude session
            await api.post(`/api/sessions/${id}/restart`);
          } else if (result.action === 'send_message' && result.response) {
            // Send the processed command template as a message
            socketService.sendMessage(id, result.response);
          } else if (result.action === 'compact_context') {
            // Trigger context compaction in Claude
            socketService.sendMessage(id, '/compact');
          } else if (result.action === 'send_claude_command' && result.response) {
            // Send command directly to Claude
            socketService.sendMessage(id, result.response);
          } else if (result.response) {
            // Show command response as a system message
            addMessage(id, {
              id: generateId(),
              sessionId: id,
              role: 'assistant',
              content: result.response,
              createdAt: new Date().toISOString(),
            });
          }
          if (!result.success && result.error) {
            addMessage(id, {
              id: generateId(),
              sessionId: id,
              role: 'assistant',
              content: `⚠️ ${result.error}`,
              createdAt: new Date().toISOString(),
            });
          }
        }
        if (textareaRef.current) {
          textareaRef.current.value = '';
          textareaRef.current.style.height = 'auto';
        }
      } catch (error) {
        console.error('Command execution failed:', error);
      }
      return;
    }

    // If a CLI tool is selected, execute it instead of Claude
    if (selectedCliTool) {
      setIsExecutingTool(true);

      // Create abort controller for this execution
      const abortController = new AbortController();
      cliToolAbortRef.current = abortController;

      try {
        // Execute CLI tool - backend will save messages
        await api.post<ApiResponse<CliToolExecution>>(
          `/api/cli-tools/${selectedCliTool}/execute`,
          { prompt: input, workingDirectory: session?.workingDirectory, sessionId: id },
          { signal: abortController.signal }
        );

        // Reload messages from server to show saved messages
        const messagesResponse = await api.get<ApiResponse<Message[]>>(`/api/sessions/${id}/messages`);
        if (messagesResponse.data.data) {
          setMessages(id, messagesResponse.data.data);
        }

        if (textareaRef.current) {
          textareaRef.current.value = '';
          textareaRef.current.style.height = 'auto';
        }
        setSelectedCliTool(null); // Reset tool selection after use
      } catch (error) {
        // Don't show error if it was cancelled
        if (error instanceof Error && error.name === 'CanceledError') {
          const tool = cliTools?.find(t => t.id === selectedCliTool);
          const cancelMsgId = generateId();
          addMessage(id, {
            id: cancelMsgId,
            sessionId: id,
            role: 'assistant',
            content: `**${tool?.name || 'Tool'}** ⏹ Abgebrochen`,
            createdAt: new Date().toISOString(),
          });
        } else {
          console.error('CLI tool execution failed:', error);
          // Reload messages in case partial save happened
          const messagesResponse = await api.get<ApiResponse<Message[]>>(`/api/sessions/${id}/messages`);
          if (messagesResponse.data.data) {
            setMessages(id, messagesResponse.data.data);
          }
        }
      } finally {
        setIsExecutingTool(false);
        cliToolAbortRef.current = null;
      }
      return;
    }

    setIsSending(true);

    try {
      if (attachments.length > 0) {
        await socketService.sendMessageWithImages(
          id,
          input,
          attachments.map(a => a.file)
        );
        // Clean up previews
        attachments.forEach(a => URL.revokeObjectURL(a.preview));
        setAttachments([]);
      } else {
        socketService.sendMessage(id, input);
      }
      if (textareaRef.current) {
        textareaRef.current.value = '';
        textareaRef.current.style.height = 'auto';
      }
      clearStreamingContent(id);
    } finally {
      setIsSending(false);
    }
  };

  const handleInterrupt = () => {
    if (!id) return;
    socketService.interruptSession(id);
  };

  const handleRestart = () => {
    if (!id) return;
    socketService.restartSession(id);
  };

  const handleModeChange = useCallback((newMode: SessionMode) => {
    if (isChangingMode) return; // Prevent changes while another is in progress
    setTargetMode(newMode);
    setIsChangingMode(true);
    if (id) {
      socketService.setSessionMode(id, newMode);
    }
  }, [id, isChangingMode]);

  const handleModelChange = useCallback((newModel: ModelType) => {
    if (isChangingModel) return; // Prevent changes while another is in progress
    setTargetModel(newModel);
    setIsChangingModel(true);
    if (id) {
      socketService.setSessionModel(id, newModel);
    }
  }, [id, isChangingModel]);

  const handlePermissionResponse = useCallback(async (action: PermissionAction, pattern?: string, reason?: string) => {
    if (!id || !currentPendingPermission) return;
    try {
      await socketService.respondToPermission(
        id,
        currentPendingPermission.requestId,
        action,
        pattern,
        reason
      );
    } catch (error) {
      console.error('Failed to respond to permission request:', error);
    }
  }, [id, currentPendingPermission]);

  const handleUserQuestionResponse = useCallback(async (answers: UserQuestionAnswers) => {
    if (!id || !currentPendingUserQuestion) return;
    try {
      await socketService.respondToUserQuestion(
        id,
        currentPendingUserQuestion.requestId,
        answers
      );
    } catch (error) {
      console.error('Failed to respond to user question:', error);
    }
  }, [id, currentPendingUserQuestion]);

  const handlePlanApprovalResponse = useCallback(async (approved: boolean, reason?: string) => {
    if (!id || !currentPendingPlanApproval) return;
    try {
      const token = useAuthStore.getState().token;
      if (!token) {
        throw new Error('No auth token');
      }

      // Send response to backend API
      const response = await fetch('/api/plan/respond', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          requestId: currentPendingPlanApproval.requestId,
          approved,
          reason
        })
      });

      if (!response.ok) {
        throw new Error('Failed to respond to plan approval');
      }
    } catch (error) {
      console.error('Failed to respond to plan approval request:', error);
    }
  }, [id, currentPendingPlanApproval]);

  const handleCancelCliTool = () => {
    if (cliToolAbortRef.current) {
      cliToolAbortRef.current.abort();
    }
  };

  if (sessionLoading || messagesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="loader" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Session not found</p>
      </div>
    );
  }

  return timeBlock('SessionPage-render', () => (
    <>
      {/* TodoBar - only shown when there are incomplete todos */}
      {hasTodos && <TodoBar todos={currentTodos} />}

      <div
        ref={dropZoneRef}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col h-full min-h-0 relative overflow-hidden",
          hasTodos && "pt-12" // Add padding when TodoBar is showing
        )}
      >
      {/* Drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary rounded-xl">
          <div className="text-center">
            <Image className="h-12 w-12 mx-auto mb-2 text-primary" />
            <p className="text-lg font-medium text-primary">Drop images here</p>
          </div>
        </div>
      )}

      {/* Session Header */}
      <div className="shrink-0 pb-1 md:pb-4 border-b mb-1 md:mb-4 overflow-visible">
        {/* Mobile layout - two rows */}
        <div className="md:hidden space-y-1">
          {/* First row: menu button, session name, status */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(true)}
              className="h-8 w-8 shrink-0"
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold flex items-center gap-2">
                <span className="truncate">{session.name}</span>
                <span
                  className={cn(
                    'inline-block h-2 w-2 rounded-full shrink-0',
                    session.status === 'running' && 'bg-green-500 animate-pulse',
                    session.status === 'stopped' && 'bg-gray-400',
                    session.status === 'error' && 'bg-red-500'
                  )}
                />
              </h2>
            </div>
            {/* Session Menu - mobile */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-8 w-8">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {session.status === 'running' && (
                  <DropdownMenuItem onClick={handleInterrupt}>
                    <Square className="h-4 w-4 mr-2" />
                    Interrupt
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleRestart}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restart Session
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => starMutation.mutate()}>
                  <Star
                    className={cn(
                      'h-4 w-4 mr-2',
                      session.starred
                        ? 'text-amber-500 fill-amber-500'
                        : 'text-muted-foreground'
                    )}
                  />
                  {session.starred ? 'Unstar' : 'Star'} Session
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowProjectSettings(true)}>
                  <Settings className="h-4 w-4 mr-2" />
                  Project Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {/* Second row: controls */}
          <div className="flex items-center gap-2">
            <SessionControls
              mode={sessionMode}
              onModeChange={handleModeChange}
              onModelChange={handleModelChange}
              usage={currentUsage}
              sessionLimit={usageLimits?.session}
              weeklyAllModels={usageLimits?.weeklyAll}
              weeklySonnet={usageLimits?.weeklySonnet}
              variant="mobile"
              isChangingMode={isChangingMode}
              isChangingModel={isChangingModel}
              targetMode={targetMode}
              targetModel={targetModel}
            />
          </div>
        </div>

        {/* Desktop layout - single row */}
        <div className="hidden md:flex items-center justify-between gap-2 md:gap-4 md:flex-wrap">
          <div className="min-w-0 flex-1 md:flex-initial">
            <h2 className="text-base md:text-xl font-bold flex items-center gap-2">
              <button
                onClick={() => starMutation.mutate()}
                disabled={starMutation.isPending}
                className="hover:scale-110 transition-transform"
                title={session.starred ? 'Unstar session' : 'Star session'}
              >
                <Star
                  className={cn(
                    'h-4 w-4 md:h-5 md:w-5 transition-colors',
                    session.starred
                      ? 'text-amber-500 fill-amber-500'
                      : 'text-muted-foreground hover:text-amber-400'
                  )}
                />
              </button>
              <span className="truncate">{session.name}</span>
              <span
                className={cn(
                  'inline-block h-2 w-2 md:h-2.5 md:w-2.5 rounded-full shrink-0',
                  session.status === 'running' && 'bg-green-500 animate-pulse',
                  session.status === 'stopped' && 'bg-gray-400',
                  session.status === 'error' && 'bg-red-500'
                )}
              />
            </h2>
            <p className="flex text-sm text-muted-foreground items-center gap-1.5 max-w-full">
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{session.workingDirectory}</span>
            </p>
          </div>
          <div className="flex gap-2 items-center shrink-0">
            {/* Session controls - unified for mobile and desktop */}
            <SessionControls
              mode={sessionMode}
              onModeChange={handleModeChange}
              onModelChange={handleModelChange}
              usage={currentUsage}
              sessionLimit={usageLimits?.session}
              weeklyAllModels={usageLimits?.weeklyAll}
              weeklySonnet={usageLimits?.weeklySonnet}
              isChangingMode={isChangingMode}
              isChangingModel={isChangingModel}
              targetMode={targetMode}
              targetModel={targetModel}
            />

            {/* CLI Tool selector - desktop only */}
            {cliTools && cliTools.length > 0 && (
              <div className="relative shrink-0">
                <select
                  value={selectedCliTool || ''}
                  onChange={(e) => setSelectedCliTool(e.target.value || null)}
                  className={cn(
                    "h-7 px-2 rounded-lg border text-xs font-medium transition-all cursor-pointer",
                    "focus:outline-none focus:ring-2 focus:ring-ring",
                    selectedCliTool
                      ? "bg-orange-500/10 border-orange-500/50 text-orange-600 dark:text-orange-400"
                      : "bg-background border-input text-muted-foreground hover:bg-muted"
                  )}
                >
                  <option value="">Claude</option>
                  {cliTools.map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.name}
                    </option>
                  ))}
                </select>
                {selectedCliTool && (
                  <div className="absolute -top-1 -right-1 w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                )}
              </div>
            )}

            {isExecutingTool && (
              <Button variant="outline" onClick={handleCancelCliTool} className="gap-2 h-7 text-xs px-2 border-orange-500/50 text-orange-600 hover:bg-orange-500/10">
                <Square className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cancel</span>
              </Button>
            )}

            {/* Session Menu - desktop */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-7 w-7">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {session.status === 'running' && (
                  <DropdownMenuItem onClick={handleInterrupt}>
                    <Square className="h-4 w-4 mr-2" />
                    Interrupt
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleRestart}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Restart Session
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowProjectSettings(true)}>
                  <Settings className="h-4 w-4 mr-2" />
                  Project Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* View Toggle - desktop only */}
            {hasOpenFiles && (
              <div className="flex gap-1 bg-muted rounded-lg p-0.5">
                <button
                  onClick={() => setMainView('chat')}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors",
                    mainView === 'chat'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  Chat
                </button>
                <button
                  onClick={() => setMainView('editor')}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1 text-xs rounded-md transition-colors",
                    mainView === 'editor'
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  Editor
                  <span className="px-1 py-0.5 text-[10px] rounded-full bg-muted">
                    {currentOpenFiles.length}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>

      </div>

      {/* Main content area with sidebar */}
      <div className="flex-1 min-h-0 flex gap-4 overflow-hidden">
        {/* Main Content - Chat or Editor (hidden on mobile for files/git/todos views) */}
        <div className={cn(
          "flex-1 min-h-0 overflow-hidden relative",
          // Mobile: hide for files, git, debug views
          (mobileView === 'files' || mobileView === 'git' || mobileView === 'debug') && "hidden md:block"
        )}>
        {mainView === 'editor' ? (
          <EditorPanel sessionId={id || ''} />
        ) : (
          <>
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="flex flex-col h-full overflow-y-auto overflow-x-hidden overscroll-contain"
            >
              {/* Empty state - centered */}
              {timeline.length === 0 && !currentStreamingContent && (
                <div className="flex-1 flex items-center justify-center text-center">
                  <div>
                    <div className="p-4 rounded-full bg-muted/50 mb-4 mx-auto w-fit">
                      <Image className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                    <p className="text-muted-foreground mb-1">Start a conversation</p>
                    <p className="text-xs text-muted-foreground/70">
                      Type a message or paste/drop an image
                    </p>
                  </div>
                </div>
              )}

              {/* Spacer to push messages to bottom */}
              {(timeline.length > 0 || currentStreamingContent) && (
                <div className="flex-1 min-h-0" />
              )}

              {/* Messages */}
              <div className="flex flex-col gap-2 md:gap-4 pb-2 md:pb-4">

        {/* Load more button */}
        {hasMoreMessages && (
          <div className="flex justify-center py-4 animate-fade-in">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMessagesToShow(prev => Math.min(prev + 50, timeline.length))}
              className="gap-2"
            >
              Show earlier messages
              <span className="text-xs text-muted-foreground">
                ({timeline.length - messagesToShow} more)
              </span>
            </Button>
          </div>
        )}

        {/* Unified timeline: messages and generated images sorted by timestamp (chronological) */}
        {visibleTimeline.map((item, index) => timeBlock('timeline-item-render', () => {
          if (item.type === 'message') {
            const message = item.data;
            return (
              <ChatMessage
                key={message.id}
                message={message}
                sessionId={id || ''}
                visibleTimestamp={visibleTimestamp}
                onTimestampClick={setVisibleTimestamp}
                sessionStatus={session?.status}
              />
            );
          } else if (item.type === 'image') {
            // Generated Image
            const img = item.data;
            return <GeneratedImage key={`gen-img-${img.timestamp}-${index}`} image={img} index={index} />;
          } else {
            // Tool Execution
            const exec = item.data;
            return (
              <div key={`tool-${exec.toolId}`} className="flex justify-start animate-fade-in w-full">
                <ToolExecutionCard execution={exec} workingDirectory={session?.workingDirectory} />
              </div>
            );
          }
        }))}

        {/* Streaming content - at the end */}
        {currentStreamingContent && (
          <div className="flex justify-start animate-fade-in">
            <StreamingContent
              content={currentStreamingContent}
              onResponse={(response) => {
                if (id) {
                  socketService.sendInput(id, response);
                  clearStreamingContent(id);
                }
              }}
            />
          </div>
        )}

                {/* Scroll anchor */}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Scroll to bottom button */}
            {showScrollButton && (
              <button
                onClick={scrollToBottom}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all text-sm font-medium animate-fade-in"
              >
                <ChevronDown className="h-4 w-4" />
                <span className="hidden sm:inline">New messages</span>
              </button>
            )}
          </>
        )}
        </div>

        {/* Right Panel - Files/Todos/Git (only shown when a panel is selected via sidebar buttons) */}
        {rightPanelTab && (
          <div className={cn(
            "shrink-0 w-72 transition-all duration-200",
            // Mobile: hide unless mobileView matches
            (mobileView !== 'git' && mobileView !== 'files' && mobileView !== 'debug') && "hidden md:block",
            (mobileView === 'git' || mobileView === 'files' || mobileView === 'debug') && "md:block w-full md:w-72"
          )}>
            <Card className="h-full flex flex-col bg-card/50 backdrop-blur-sm border">
              {/* Panel Header */}
              <div className="shrink-0 p-2 border-b">
                <div className="flex items-center gap-2 px-1">
                  {rightPanelTab === 'files' && <FolderOpen className="h-4 w-4 text-muted-foreground" />}
                  {rightPanelTab === 'todos' && <ListTodo className="h-4 w-4 text-muted-foreground" />}
                  {rightPanelTab === 'git' && <GitBranch className="h-4 w-4 text-muted-foreground" />}
                  {rightPanelTab === 'debug' && <Bug className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-medium">
                    {rightPanelTab === 'files' && 'Files'}
                    {rightPanelTab === 'todos' && 'Tasks'}
                    {rightPanelTab === 'git' && 'Git'}
                    {rightPanelTab === 'debug' && 'Debug'}
                  </span>
                  {rightPanelTab === 'todos' && currentTodos.length > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-muted text-muted-foreground">
                      {currentTodos.filter(t => t.status !== 'completed').length}
                    </span>
                  )}
                </div>
              </div>

              {/* Panel Content */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {rightPanelTab === 'files' && (
                  <FileTree
                    workingDirectory={session.workingDirectory}
                    selectedFile={currentSelectedFile || null}
                    onFileSelect={(path) => id && setSelectedFile(id, path)}
                    onFileOpen={(path, content) => {
                      if (id) {
                        openFileInStore(id, path, content);
                        // Switch to editor view on mobile when opening a file
                        if (window.innerWidth < 768) {
                          setMobileView('editor');
                        }
                      }
                    }}
                    className="h-full"
                  />
                )}
                {rightPanelTab === 'todos' && (
                  <div className="p-2 space-y-2 overflow-auto h-full">
                    {currentTodos.length === 0 ? (
                      <div className="text-center py-4 text-sm text-muted-foreground">
                        No tasks
                      </div>
                    ) : (
                      currentTodos.map((todo, index) => (
                        <div
                          key={index}
                          className={cn(
                            "flex items-start gap-2 p-2 rounded-lg text-xs transition-colors",
                            todo.status === 'completed' && "bg-green-500/10 text-muted-foreground",
                            todo.status === 'in_progress' && "bg-blue-500/10 border border-blue-500/30",
                            todo.status === 'pending' && "bg-muted/50"
                          )}
                        >
                          {/* Status Icon */}
                          <div className="shrink-0 mt-0.5">
                            {todo.status === 'completed' && (
                              <CheckCircle className="h-4 w-4 text-green-500" />
                            )}
                            {todo.status === 'in_progress' && (
                              <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
                            )}
                            {todo.status === 'pending' && (
                              <Circle className="h-4 w-4 text-muted-foreground" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <p className={cn(
                              "leading-snug",
                              todo.status === 'completed' && "line-through",
                              todo.status === 'in_progress' && "font-medium text-blue-600 dark:text-blue-400"
                            )}>
                              {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {rightPanelTab === 'git' && (
                  <GitPanel workingDirectory={session.workingDirectory} className="h-full" />
                )}
                {rightPanelTab === 'debug' && (
                  <DebugPanel sessionId={id} />
                )}
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Input - Hidden when in editor view */}
      {mainView !== 'editor' && (
        <div className="shrink-0 pt-1 md:pt-4 border-t space-y-1 md:space-y-3">
          {/* Plan Approval Input - replaces regular input when a plan needs approval */}
          {currentPendingPlanApproval ? (
            <PlanApprovalInput
              onRespond={handlePlanApprovalResponse}
              planContent={currentPendingPlanApproval?.planContent}
            />
          ) : (
            <>
            {/* Image attachments preview */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-muted/50 border animate-scale-in">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="relative group">
                    <img
                      src={attachment.preview}
                      alt="Attachment"
                      className="h-16 w-16 object-cover rounded-lg border shadow-sm"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.id)}
                      className="absolute -top-2 -right-2 p-1 rounded-full bg-destructive text-destructive-foreground shadow-sm opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={handleSend} className="flex gap-2 items-center px-1">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Image upload button / Working indicator - desktop only */}
          <div className="hidden md:flex">
            {isCompacting ? (
              <div className="h-10 w-10 shrink-0 flex items-center justify-center">
                <Loader className="h-5 w-5 text-blue-500 animate-spin" />
              </div>
            ) : (currentActivity.type === 'thinking' || currentActivity.type === 'tool' || currentStreamingContent) ? (
              <div className="h-10 w-10 shrink-0 flex items-center justify-center">
                <Brain className="h-5 w-5 text-primary animate-pulse" />
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => fileInputRef.current?.click()}
                className="h-10 w-10 shrink-0"
                title="Add image (or paste/drop)"
              >
                <Paperclip className="h-5 w-5" />
              </Button>
            )}
          </div>

          {/* Text input */}
          <div className="flex-1 flex items-center relative">
            {/* Command autocomplete menu */}
            {showCommandMenu && commands && commands.length > 0 && (
              <CommandMenu
                commands={commands}
                filter={textareaRef.current?.value.startsWith('/') ? textareaRef.current.value.slice(1) : ''}
                selectedIndex={commandMenuIndex}
                onSelect={(cmd) => {
                  if (textareaRef.current) {
                    textareaRef.current.value = `/${cmd.name} `;
                    textareaRef.current.focus();
                  }
                  setShowCommandMenu(false);
                }}
                onClose={() => setShowCommandMenu(false)}
              />
            )}
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                rows={1}
                onChange={(e) => {
                  const value = e.target.value;
                  // Auto-resize textarea
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';

                  // Show command menu when typing /
                  if (value.startsWith('/') && !value.includes(' ')) {
                    setShowCommandMenu(true);
                    setCommandMenuIndex(0);
                  } else {
                    setShowCommandMenu(false);
                  }
                }}
                onFocus={() => {
                  // On mobile, switch to chat view when input is focused
                  if (mobileView !== 'chat') {
                    setMobileView('chat');
                  }
                  // Scroll input into view after keyboard opens (mobile)
                  setTimeout(() => {
                    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                  }, 300);
                }}
                onKeyDown={(e) => {
                  if (showCommandMenu) {
                    const currentValue = textareaRef.current?.value || '';
                    const filteredCommands = commands?.filter(cmd =>
                      cmd.name.toLowerCase().includes((currentValue.slice(1) || '').toLowerCase())
                    ) || [];

                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setCommandMenuIndex(i => Math.min(i + 1, filteredCommands.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setCommandMenuIndex(i => Math.max(i - 1, 0));
                    } else if (e.key === 'Tab' || e.key === 'Enter') {
                      e.preventDefault();
                      const selected = filteredCommands[commandMenuIndex];
                      if (selected && textareaRef.current) {
                        textareaRef.current.value = `/${selected.name} `;
                        setShowCommandMenu(false);
                      }
                    } else if (e.key === 'Escape') {
                      setShowCommandMenu(false);
                    }
                  } else if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend(e as unknown as React.FormEvent);
                  }
                }}
                placeholder={selectedCliTool
                  ? `Prompt for ${cliTools?.find(t => t.id === selectedCliTool)?.name}...`
                  : "Message..."
                }
                className={cn(
                  "w-full min-h-[40px] md:min-h-[44px] max-h-[200px] pl-3 pr-10 md:px-4 py-2 md:py-2.5 rounded border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-base resize-none scrollbar-hide",
                  selectedCliTool && "border-orange-500/30 focus:ring-orange-500/50"
                )}
              />
              {/* Mobile: attach button inside input / thinking indicator */}
              <div className="md:hidden absolute right-2 top-1/2 -translate-y-[calc(50%+1px)]">
                {isCompacting ? (
                  <Loader className="h-5 w-5 text-blue-500 animate-spin" />
                ) : (currentActivity.type === 'thinking' || currentActivity.type === 'tool' || currentStreamingContent) ? (
                  <Brain className="h-5 w-5 text-primary animate-pulse" />
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    title="Add image"
                  >
                    <Paperclip className="h-5 w-5" />
                  </button>
                )}
              </div>
            </div>
          </div>

            </form>
          </>
        )}
      </div>
      )}

      {/* Permission Approval Dialog */}
      {currentPendingPermission && (
        <PermissionApprovalDialog
          permission={currentPendingPermission}
          onRespond={handlePermissionResponse}
        />
      )}

      {/* User Question Dialog */}
      {currentPendingUserQuestion && (
        <UserQuestionDialog
          question={currentPendingUserQuestion}
          onRespond={handleUserQuestionResponse}
        />
      )}

      {/* Project Settings Modal */}
      <Dialog open={showProjectSettings} onOpenChange={setShowProjectSettings}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Project Settings</DialogTitle>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Appearance Section */}
            <div>
              <h3 className="text-sm font-medium mb-4">Appearance</h3>

              {/* Desktop Settings */}
              <div className="space-y-3 mb-6">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Desktop</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="desktop-font" className="text-xs">Font Family</Label>
                    <select
                      id="desktop-font"
                      className="w-full h-9 px-3 rounded-md border bg-background text-sm"
                      value={themeSettings.desktop.fontFamily}
                      onChange={(e) => updateDesktopFont(e.target.value as FontFamily)}
                    >
                      <option value="system">System Default</option>
                      <option value="inter">Inter</option>
                      <option value="roboto">Roboto</option>
                      <option value="sf-pro">SF Pro</option>
                      <option value="jetbrains-mono">JetBrains Mono</option>
                      <option value="fira-code">Fira Code</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="desktop-size" className="text-xs">Font Size</Label>
                    <select
                      id="desktop-size"
                      className="w-full h-9 px-3 rounded-md border bg-background text-sm"
                      value={themeSettings.desktop.fontSize}
                      onChange={(e) => updateDesktopSize(e.target.value as FontSize)}
                    >
                      <option value="12">12px</option>
                      <option value="13">13px</option>
                      <option value="14">14px</option>
                      <option value="15">15px</option>
                      <option value="16">16px</option>
                      <option value="18">18px</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Mobile Settings */}
              <div className="space-y-3">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Mobile</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="mobile-font" className="text-xs">Font Family</Label>
                    <select
                      id="mobile-font"
                      className="w-full h-9 px-3 rounded-md border bg-background text-sm"
                      value={themeSettings.mobile.fontFamily}
                      onChange={(e) => updateMobileFont(e.target.value as FontFamily)}
                    >
                      <option value="system">System Default</option>
                      <option value="inter">Inter</option>
                      <option value="roboto">Roboto</option>
                      <option value="sf-pro">SF Pro</option>
                      <option value="jetbrains-mono">JetBrains Mono</option>
                      <option value="fira-code">Fira Code</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mobile-size" className="text-xs">Font Size</Label>
                    <select
                      id="mobile-size"
                      className="w-full h-9 px-3 rounded-md border bg-background text-sm"
                      value={themeSettings.mobile.fontSize}
                      onChange={(e) => updateMobileSize(e.target.value as FontSize)}
                    >
                      <option value="14">14px</option>
                      <option value="15">15px</option>
                      <option value="16">16px</option>
                      <option value="17">17px</option>
                      <option value="18">18px</option>
                      <option value="20">20px</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      </div>
    </>
  ));
}
