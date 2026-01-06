import { useState, useEffect, useRef } from 'react';
import { Send, Trash2, Copy, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { api } from '@/services/api';
import { socketService } from '@/services/socket';

interface JsonMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  timestamp: number;
  data: any;
  raw?: string;
}

interface JsonDebugPanelProps {
  sessionId: string;
}

export function JsonDebugPanel({ sessionId }: JsonDebugPanelProps) {
  const [messages, setMessages] = useState<JsonMessage[]>([]);
  const [rawInput, setRawInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Listen for Claude JSON messages via WebSocket
  useEffect(() => {
    // Handler for inbound messages (from Claude)
    const handleClaudeMessage = (data: { sessionId: string; message: any }) => {
      if (data.sessionId === sessionId) {
        const msg: JsonMessage = {
          id: `msg-${Date.now()}-${Math.random()}`,
          direction: 'outbound',
          timestamp: Date.now(),
          data: data.message,
          raw: JSON.stringify(data.message, null, 2),
        };
        setMessages(prev => [...prev, msg]);
      }
    };

    // Handler for messages sent to Claude
    const handleSentMessage = (data: { sessionId: string; message: any }) => {
      if (data.sessionId === sessionId) {
        const msg: JsonMessage = {
          id: `msg-${Date.now()}-${Math.random()}`,
          direction: 'inbound',
          timestamp: Date.now(),
          data: data.message,
          raw: JSON.stringify(data.message, null, 2),
        };
        setMessages(prev => [...prev, msg]);
      }
    };

    // Subscribe to debug events
    const socket = socketService.getSocket();
    if (!socket) return;
    socket.on('debug:claude:message', handleClaudeMessage);
    socket.on('debug:claude:sent', handleSentMessage);

    return () => {
      socket.off('debug:claude:message', handleClaudeMessage);
      socket.off('debug:claude:sent', handleSentMessage);
    };
  }, [sessionId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  const handleSendRaw = async () => {
    setError(null);

    try {
      // Validate JSON
      const parsed = JSON.parse(rawInput);

      // Send via API (throws on error)
      await api.post(`/api/sessions/${sessionId}/raw-json`, {
        message: parsed,
      });

      // Clear input on success
      setRawInput('');
    } catch (err) {
      if (err instanceof SyntaxError) {
        setError('Invalid JSON format');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to send message');
      }
    }
  };

  const toggleExpanded = (id: string) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const clearMessages = () => {
    setMessages([]);
  };

  const getMessagePreview = (data: any): string => {
    if (data.type) return `type: ${data.type}`;
    if (data.message?.role) return `${data.message.role} message`;
    return JSON.stringify(data).substring(0, 50) + '...';
  };

  const getMessageColor = (msg: JsonMessage): string => {
    if (msg.direction === 'inbound') return 'border-blue-500/50';
    if (msg.data.type === 'error') return 'border-red-500/50';
    if (msg.data.type === 'tool_use') return 'border-purple-500/50';
    return 'border-green-500/50';
  };

  // Example templates for common messages
  const templates = {
    userMessage: JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: '/usage',
      }
    }, null, 2),
    interrupt: JSON.stringify({
      type: 'interrupt'
    }, null, 2),
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b bg-muted/50">
        <h3 className="text-sm font-medium">JSON Debug</h3>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
            className={cn('h-7 px-2', autoScroll && 'text-primary')}
          >
            Auto
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearMessages}
            className="h-7 px-2"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-2">
        <div className="space-y-2">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              No messages yet. Send a message to see JSON communication.
            </div>
          ) : (
            messages.map(msg => {
              const isExpanded = expandedMessages.has(msg.id);
              return (
                <div
                  key={msg.id}
                  className={cn(
                    'border rounded-md overflow-hidden',
                    getMessageColor(msg)
                  )}
                >
                  <button
                    onClick={() => toggleExpanded(msg.id)}
                    className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/50 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 shrink-0" />
                    )}
                    <span className={cn(
                      'text-xs font-medium',
                      msg.direction === 'inbound' ? 'text-blue-500' : 'text-green-500'
                    )}>
                      {msg.direction === 'inbound' ? '→' : '←'}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="flex-1 text-xs font-mono truncate">
                      {getMessagePreview(msg.data)}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="border-t">
                      <div className="relative">
                        <pre className="p-2 text-xs font-mono overflow-x-auto">
                          {msg.raw}
                        </pre>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(msg.raw || '')}
                          className="absolute top-1 right-1 h-6 px-2"
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input Section */}
      <div className="border-t p-2 space-y-2">
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-500">
            <AlertCircle className="h-3 w-3" />
            {error}
          </div>
        )}

        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRawInput(templates.userMessage)}
            className="h-7 text-xs"
          >
            User Msg
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRawInput(templates.interrupt)}
            className="h-7 text-xs"
          >
            Interrupt
          </Button>
        </div>

        <textarea
          value={rawInput}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRawInput(e.target.value)}
          placeholder="Enter JSON message..."
          className="min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <Button
          onClick={handleSendRaw}
          disabled={!rawInput.trim()}
          className="w-full"
          size="sm"
        >
          <Send className="h-3 w-3 mr-2" />
          Send Raw JSON
        </Button>
      </div>
    </div>
  );
}