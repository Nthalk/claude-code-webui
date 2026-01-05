import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Square, FolderOpen, Image, X, Paperclip, Brain, ListTodo, Circle, CheckCircle, Loader2, GitBranch, MessageSquare, Code2, Star, RotateCcw, MoreVertical, Settings, Menu, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
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
import { StreamingContent } from '@/components/chat/StreamingContent';
import { SessionControls } from '@/components/session/SessionControls';
import { FileTree } from '@/components/file-tree';
import { GitPanel } from '@/components/git-panel';
import { EditorPanel } from '@/components/code-editor';
import type { MobileView } from '@/components/mobile';
import { useSessionStore } from '@/stores/sessionStore';
import { useAuthStore } from '@/stores/authStore';
import { api } from '@/services/api';
import { socketService } from '@/services/socket';
import type { Session, Message, ApiResponse, MessageImage, CliTool, CliToolExecution, Command, CommandExecutionResult, SessionMode, ModelType, ToolExecution } from '@claude-code-webui/shared';
import { cn } from '@/lib/utils';
import { CommandMenu } from '@/components/chat/CommandMenu';
import { InteractiveOptions, detectOptions, isChoicePrompt } from '@/components/chat/InteractiveOptions';
import { ToolExecutionCard } from '@/components/chat/ToolExecutionCard';
import { PermissionApprovalDialog } from '@/components/chat/PermissionApprovalDialog';
import { UserQuestionDialog } from '@/components/chat/UserQuestionDialog';
import { useDocumentSwipeGesture } from '@/hooks';
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

// Format timestamp iMessage-style: relative for recent, time for same day, date+time for older
function formatMessageTimestamp(timestamp: string | number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);

  // Within the last minute: show seconds ago
  if (diffSeconds < 60) {
    return diffSeconds <= 1 ? 'just now' : `${diffSeconds}s ago`;
  }

  // Within the last hour: show minutes ago
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  // Same day: show time only
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (isToday) {
    return timeStr;
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${timeStr}`;
  }

  // Same year: show month and day with time
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + timeStr;
  }

  // Different year: show full date with time
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) + ', ' + timeStr;
}

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>('auto-accept');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const { messages, streamingContent, activity, todos, generatedImages, toolExecutions, pendingPermissions, pendingUserQuestions, setMessages, setToolExecutions, clearToolExecutions, clearGeneratedImages, clearStreamingContent, selectedFile, setSelectedFile, openFile: openFileInStore, openFiles } = useSessionStore();
  const [selectedCliTool, setSelectedCliTool] = useState<string | null>(null);
  const [isExecutingTool, setIsExecutingTool] = useState(false);
  const cliToolAbortRef = useRef<AbortController | null>(null);
  const [showCommandMenu, setShowCommandMenu] = useState(false);
  const [commandMenuIndex, setCommandMenuIndex] = useState(0);
  const [visibleTimestamp, setVisibleTimestamp] = useState<string | null>(null);
  const [showProjectSettings, setShowProjectSettings] = useState(false);

  const { usage, addMessage, mobileView, setMobileView, setMobileMenuOpen } = useSessionStore();
  const { settings: themeSettings, updateDesktopFont, updateDesktopSize, updateMobileFont, updateMobileSize } = useTheme();

  // Mobile swipe gesture navigation
  const mobileViewOrder = useMemo((): MobileView[] => {
    const views: MobileView[] = ['files', 'chat', 'git'];
    return views;
  }, []);

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
    threshold: 50,
    velocityThreshold: 0.25,
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
        return {
          session: {
            percentUsed: Math.round(data.fiveHour?.utilization ?? 0),
            resetsAt: data.fiveHour?.resetsAt ? new Date(data.fiveHour.resetsAt) : undefined,
          },
          weeklyAll: {
            percentUsed: Math.round(data.sevenDay?.utilization ?? 0),
            resetsAt: data.sevenDay?.resetsAt ? new Date(data.sevenDay.resetsAt) : undefined,
          },
          weeklySonnet: {
            percentUsed: Math.round(data.sevenDaySonnet?.utilization ?? 0),
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
  const currentToolExecutions = toolExecutions[id || ''] || [];
  const currentPendingPermission = pendingPermissions[id || ''] || null;
  const currentPendingUserQuestion = pendingUserQuestions[id || ''] || null;

  // Right panel state from store (controlled by sidebar toggle buttons)
  const { rightPanelTab, setRightPanelTab } = useSessionStore();

  const [mainView, setMainView] = useState<'chat' | 'editor'>('chat');
  const currentSelectedFile = selectedFile[id || ''];
  const currentOpenFiles = openFiles[id || ''] || [];
  const hasOpenFiles = currentOpenFiles.length > 0;

  // Combine messages, generated images, and tool executions into a single timeline
  type TimelineItem =
    | { type: 'message'; data: Message; timestamp: number }
    | { type: 'image'; data: typeof currentGeneratedImages[0]; timestamp: number }
    | { type: 'tool'; data: typeof currentToolExecutions[0]; timestamp: number };

  const timeline: TimelineItem[] = [
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
    ...currentToolExecutions.map(exec => ({
      type: 'tool' as const,
      data: exec,
      timestamp: exec.timestamp,
    })),
  ].sort((a, b) => a.timestamp - b.timestamp); // Chronological order

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
      console.log(`[SESSION] Heartbeat detected session ${sessionId} not found, starting session`);
      // Backend restarted - start the session by sending an empty message
      // sendMessage will auto-start the session if it doesn't exist
      socketService.sendMessage(sessionId, '');
      // Also reconnect to get proper subscription
      setTimeout(() => socketService.reconnectToSession(sessionId), 500);
    });

    return () => {
      socketService.stopHeartbeat();
      socketService.unsubscribeFromSession(id);
    };
  }, [id]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    }
  }, [input]);

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
    }
  }, [timeline.length, currentStreamingContent, isAtBottom]);

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
    } else if (mobileView === 'todos') {
      setRightPanelTab('todos');
    } else if (mobileView === 'files') {
      setRightPanelTab('files');
    } else if (mobileView === 'editor') {
      setMainView('editor');
    } else if (mobileView === 'chat') {
      setMainView('chat');
    }
  }, [mobileView, setRightPanelTab]);

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
    if ((!input.trim() && attachments.length === 0) || !id || isSending || isExecutingTool) return;

    // Check for slash commands
    if (input.startsWith('/')) {
      setShowCommandMenu(false);
      try {
        const response = await api.post<ApiResponse<CommandExecutionResult>>('/api/commands/execute', {
          input,
          projectPath: session?.workingDirectory,
          sessionId: id,
          currentModel: 'claude-sonnet-4-20250514',
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
          } else if (result.action === 'send_message' && result.response) {
            // Send the processed command template as a message
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
        setInput('');
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

        setInput('');
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
      setInput('');
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
    setSessionMode(newMode);
    if (id) {
      socketService.setSessionMode(id, newMode);
    }
  }, [id]);

  const handleModelChange = useCallback((newModel: ModelType) => {
    if (id) {
      socketService.setSessionModel(id, newModel);
    }
  }, [id]);

  const handlePermissionResponse = useCallback(async (action: PermissionAction, pattern?: string) => {
    if (!id || !currentPendingPermission) return;
    try {
      await socketService.respondToPermission(
        id,
        currentPendingPermission.requestId,
        action,
        pattern
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

  return (
    <div
      ref={dropZoneRef}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="flex flex-col h-full min-h-0 relative overflow-hidden"
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
        <div className="flex items-center justify-between gap-2 md:gap-4 md:flex-wrap">
          {/* Mobile menu button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden h-8 w-8 shrink-0"
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="min-w-0 flex-1 md:flex-initial">
            <h2 className="text-base md:text-xl font-bold flex items-center gap-2">
              <button
                onClick={() => starMutation.mutate()}
                disabled={starMutation.isPending}
                className="hover:scale-110 transition-transform hidden md:block"
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
            {/* Hide working directory on mobile to save space */}
            <p className="hidden md:flex text-sm text-muted-foreground items-center gap-1.5 max-w-full">
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
            />

            {/* CLI Tool selector - hidden on mobile */}
            {cliTools && cliTools.length > 0 && (
              <div className="relative shrink-0 hidden md:block">
                <select
                  value={selectedCliTool || ''}
                  onChange={(e) => setSelectedCliTool(e.target.value || null)}
                  className={cn(
                    "h-9 px-3 rounded-lg border text-sm font-medium transition-all cursor-pointer",
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
              <Button variant="outline" onClick={handleCancelCliTool} className="gap-2 h-9 border-orange-500/50 text-orange-600 hover:bg-orange-500/10">
                <Square className="h-4 w-4" />
                <span className="hidden sm:inline">Cancel</span>
              </Button>
            )}

            {/* Session Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" className="h-9 w-9">
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

            {/* View Toggle - desktop only (mobile uses layout header dropdown) */}
            {hasOpenFiles && (
              <div className="hidden md:flex gap-1 bg-muted rounded-lg p-0.5">
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
          // Mobile: hide for files, git, todos views
          (mobileView === 'files' || mobileView === 'git' || mobileView === 'todos') && "hidden md:block"
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

        {/* Unified timeline: messages and generated images sorted by timestamp (chronological) */}
        {timeline.map((item, index) => {
          if (item.type === 'message') {
            const message = item.data;
            const isTimestampVisible = visibleTimestamp === message.id;
            return (
              <div
                key={message.id}
                className={cn('flex flex-col animate-fade-in w-full', message.role === 'user' ? 'items-end' : 'items-start')}
              >
                {/* Timestamp - shown when message is clicked */}
                <div
                  className={cn(
                    'text-xs text-muted-foreground/70 mb-1 transition-all duration-200',
                    isTimestampVisible ? 'opacity-100 h-auto' : 'opacity-0 h-0 overflow-hidden'
                  )}
                >
                  {formatMessageTimestamp(message.createdAt)}
                </div>
                <div className={cn('flex w-full', message.role === 'user' ? 'justify-end' : 'justify-start')}>
                  {/* iMessage-style tail for assistant messages */}
                  {message.role === 'assistant' && (
                    <div className="flex-shrink-0 w-2 self-end">
                      <svg viewBox="0 0 8 13" className="w-2 h-3 text-card fill-current" style={{ marginBottom: '-1px' }}>
                        <path d="M0 0 L8 0 L8 13 C8 13 8 6 0 0" />
                      </svg>
                    </div>
                  )}
                  <Card
                    className={cn(
                      'p-2 md:p-4 cursor-pointer select-none max-w-[calc(100vw-2rem)] md:max-w-none overflow-hidden',
                      message.role === 'user'
                        ? 'bg-primary text-primary-foreground rounded-br-sm border-primary'
                        : 'bg-card rounded-bl-sm'
                    )}
                    onClick={() => setVisibleTimestamp(isTimestampVisible ? null : message.id)}
                  >
                    {/* Image thumbnails for user messages */}
                    {message.images && message.images.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-3">
                        {message.images.map((img: MessageImage, imgIndex: number) => {
                          const token = useAuthStore.getState().token || '';
                          const imageUrl = `/api/sessions/${id}/images/${img.filename}?token=${encodeURIComponent(token)}`;
                          return (
                            <img
                              key={imgIndex}
                              src={imageUrl}
                              alt={`Attachment ${imgIndex + 1}`}
                              className="max-h-32 max-w-48 rounded-lg border border-primary-foreground/20 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                window.open(imageUrl, '_blank');
                              }}
                            />
                          );
                        })}
                      </div>
                    )}
                    <div className={cn(
                      'prose prose-sm max-w-none overflow-x-auto',
                      message.role === 'user' ? 'prose-invert' : 'dark:prose-invert'
                    )}>
                      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{message.content}</ReactMarkdown>
                    </div>
                    {/* Interactive options for assistant messages with choices */}
                    {message.role === 'assistant' && isChoicePrompt(message.content) && (() => {
                      const options = detectOptions(message.content);
                      return options ? (
                        <InteractiveOptions
                          options={options}
                          onSelect={(selected) => {
                            if (id) {
                              socketService.sendMessage(id, selected);
                            }
                          }}
                          disabled={session.status !== 'running'}
                        />
                      ) : null;
                    })()}
                  </Card>
                  {/* iMessage-style tail for user messages */}
                  {message.role === 'user' && (
                    <div className="flex-shrink-0 w-2 self-end mb-1">
                      <svg viewBox="0 0 8 13" className="w-2 h-3 text-primary fill-current">
                        <path d="M8 0 L0 0 L0 13 C0 13 0 6 8 0" />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            );
          } else if (item.type === 'image') {
            // Generated Image
            const img = item.data;
            return (
              <div key={`gen-img-${img.timestamp}-${index}`} className="flex justify-start animate-fade-in w-full">
                <Card className="p-2 md:p-4 bg-gradient-to-br from-purple-500/10 to-blue-500/10 border-purple-500/30">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="p-1.5 rounded-full bg-purple-500/20">
                      <Image className="h-4 w-4 text-purple-500" />
                    </div>
                    <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                      Generated Image (Gemini)
                    </span>
                  </div>
                  {img.imageBase64 && (
                    <img
                      src={`data:${img.mimeType};base64,${img.imageBase64}`}
                      alt={img.prompt}
                      className="max-w-full rounded-lg border border-purple-500/20 cursor-pointer hover:opacity-90 transition-opacity mb-3"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = `data:${img.mimeType};base64,${img.imageBase64}`;
                        link.download = `gemini-image-${img.timestamp}.png`;
                        link.click();
                      }}
                    />
                  )}
                  <p className="text-xs text-muted-foreground italic">"{img.prompt}"</p>
                </Card>
              </div>
            );
          } else {
            // Tool Execution
            const exec = item.data;
            return (
              <div key={`tool-${exec.toolId}-${index}`} className="flex justify-start animate-fade-in w-full">
                <ToolExecutionCard execution={exec} />
              </div>
            );
          }
        })}

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
            (mobileView !== 'git' && mobileView !== 'todos' && mobileView !== 'files') && "hidden md:block",
            (mobileView === 'git' || mobileView === 'todos' || mobileView === 'files') && "md:block w-full md:w-72"
          )}>
            <Card className="h-full flex flex-col bg-card/50 backdrop-blur-sm border">
              {/* Panel Header */}
              <div className="shrink-0 p-2 border-b">
                <div className="flex items-center gap-2 px-1">
                  {rightPanelTab === 'files' && <FolderOpen className="h-4 w-4 text-muted-foreground" />}
                  {rightPanelTab === 'todos' && <ListTodo className="h-4 w-4 text-muted-foreground" />}
                  {rightPanelTab === 'git' && <GitBranch className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-medium">
                    {rightPanelTab === 'files' && 'Files'}
                    {rightPanelTab === 'todos' && 'Tasks'}
                    {rightPanelTab === 'git' && 'Git'}
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
                    onFileOpen={(path, content) => id && openFileInStore(id, path, content)}
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
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 pt-1 md:pt-4 border-t space-y-1 md:space-y-3">
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
            {(currentActivity.type === 'thinking' || currentActivity.type === 'tool' || currentStreamingContent) ? (
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
                filter={input.startsWith('/') ? input.slice(1) : ''}
                selectedIndex={commandMenuIndex}
                onSelect={(cmd) => {
                  setInput(`/${cmd.name} `);
                  setShowCommandMenu(false);
                  textareaRef.current?.focus();
                }}
                onClose={() => setShowCommandMenu(false)}
              />
            )}
            <div className="relative flex-1">
              <textarea
                ref={textareaRef}
                value={input}
                rows={1}
                onChange={(e) => {
                  const value = e.target.value;
                  setInput(value);
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
                    const filteredCommands = commands?.filter(cmd =>
                      cmd.name.toLowerCase().includes((input.slice(1) || '').toLowerCase())
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
                      if (selected) {
                        setInput(`/${selected.name} `);
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
                  "w-full min-h-[40px] md:min-h-[44px] max-h-[200px] pl-3 pr-10 md:px-4 py-2 md:py-2.5 rounded border bg-background focus:outline-none focus:ring-2 focus:ring-ring text-base resize-none",
                  selectedCliTool && "border-orange-500/30 focus:ring-orange-500/50"
                )}
              />
              {/* Mobile: attach button inside input / thinking indicator */}
              <div className="md:hidden absolute right-2 top-1/2 -translate-y-[calc(50%+1px)]">
                {(currentActivity.type === 'thinking' || currentActivity.type === 'tool' || currentStreamingContent) ? (
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
      </div>

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
  );
}
