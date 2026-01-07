import { useState, useEffect, useRef } from 'react';
import { Trash2, Play, Pause, ChevronDown, ChevronRight, Clock, Hash, TrendingUp, Bug, Send, Copy, AlertCircle, Shield, CheckCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useDebugStore, getTopTimings, type TimingStats } from '@/hooks';
import { api } from '@/services/api';
import { socketService } from '@/services/socket';

// Permission decision type for the Permissions tab
interface PermissionDecision {
  id: string;
  sessionId: string;
  timestamp: number;
  toolName: string;
  toolInput: unknown;
  decision: 'allow' | 'deny';
  reason: 'pattern' | 'mode' | 'user';
  matchedPattern?: string;
  mode?: string;
  duration?: number;
}

function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function StatsRow({ name, stats }: { name: string; stats: TimingStats }) {
  const [expanded, setExpanded] = useState(false);
  const isSlow = stats.avg > 16; // More than one frame

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full flex items-center gap-2 p-2 text-left hover:bg-muted/50 transition-colors',
          isSlow && 'bg-red-500/10'
        )}
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('flex-1 text-xs font-mono truncate', isSlow && 'text-red-500')}>
          {name}
        </span>
        <span className="text-xs font-semibold">
          {formatDuration(stats.total)}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px]">
          <div className="flex items-center gap-1 text-muted-foreground">
            <Hash className="h-3 w-3" />
            Count:
          </div>
          <div className="font-mono text-right">{stats.count}</div>

          <div className="flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            Total:
          </div>
          <div className="font-mono text-right">{formatDuration(stats.total)}</div>

          <div className="flex items-center gap-1 text-muted-foreground">
            <TrendingUp className="h-3 w-3" />
            Avg:
          </div>
          <div className={cn('font-mono text-right', isSlow && 'text-red-500')}>
            {formatDuration(stats.avg)}
          </div>

          <div className="text-muted-foreground">Min:</div>
          <div className="font-mono text-right">{formatDuration(stats.min)}</div>

          <div className="text-muted-foreground">Max:</div>
          <div className={cn('font-mono text-right', stats.max > 16 && 'text-amber-500')}>
            {formatDuration(stats.max)}
          </div>

          <div className="text-muted-foreground">Last:</div>
          <div className="font-mono text-right">{formatDuration(stats.lastDuration)}</div>
        </div>
      )}
    </div>
  );
}

interface DebugPanelProps {
  sessionId?: string;
}

export function DebugPanel({ sessionId }: DebugPanelProps) {
  const enabled = useDebugStore((s) => s.enabled);
  const stats = useDebugStore((s) => s.stats);
  const recentEntries = useDebugStore((s) => s.recentEntries);
  const toggleEnabled = useDebugStore((s) => s.toggleEnabled);
  const clearStats = useDebugStore((s) => s.clearStats);

  const [view, setView] = useState<'stats' | 'recent' | 'json' | 'permissions'>('stats');

  // Permissions state
  const [permissions, setPermissions] = useState<PermissionDecision[]>([]);
  const [expandedPermissions, setExpandedPermissions] = useState<Set<string>>(new Set());

  // JSON debug state
  const [jsonMessages, setJsonMessages] = useState<Array<{
    id: string;
    direction: 'inbound' | 'outbound';
    timestamp: number;
    data: any;
    raw?: string;
  }>>([]);
  const [rawInput, setRawInput] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const topTimings = getTopTimings(20);

  const totalCount = Object.values(stats).reduce((sum, s) => sum + s.count, 0);
  const totalTime = Object.values(stats).reduce((sum, s) => sum + s.total, 0);

  console.log('DebugPanel rendering, enabled:', enabled, 'stats:', Object.keys(stats).length);

  // Listen for Claude JSON messages via WebSocket
  useEffect(() => {
    if (!sessionId) return;

    // Handler for inbound messages (from Claude)
    const handleClaudeMessage = (data: { sessionId: string; message: any }) => {
      if (data.sessionId === sessionId) {
        const msg = {
          id: `msg-${Date.now()}-${Math.random()}`,
          direction: 'outbound' as const,
          timestamp: Date.now(),
          data: data.message,
          raw: JSON.stringify(data.message, null, 2),
        };
        setJsonMessages(prev => [...prev, msg]);
      }
    };

    // Handler for messages sent to Claude
    const handleSentMessage = (data: { sessionId: string; message: any }) => {
      if (data.sessionId === sessionId) {
        const msg = {
          id: `msg-${Date.now()}-${Math.random()}`,
          direction: 'inbound' as const,
          timestamp: Date.now(),
          data: data.message,
          raw: JSON.stringify(data.message, null, 2),
        };
        setJsonMessages(prev => [...prev, msg]);
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

  // Listen for permission decision events
  useEffect(() => {
    if (!sessionId) return;

    const handlePermissionDecision = (data: { sessionId: string; decision: PermissionDecision }) => {
      if (data.sessionId === sessionId) {
        setPermissions(prev => [...prev, data.decision]);
      }
    };

    const handlePermissionCleared = (data: { sessionId: string }) => {
      if (data.sessionId === sessionId) {
        setPermissions([]);
      }
    };

    const socket = socketService.getSocket();
    if (!socket) return;
    socket.on('permission:decision', handlePermissionDecision);
    socket.on('permission:cleared', handlePermissionCleared);

    return () => {
      socket.off('permission:decision', handlePermissionDecision);
      socket.off('permission:cleared', handlePermissionCleared);
    };
  }, [sessionId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [jsonMessages, autoScroll]);

  // Helper functions for JSON view
  const handleSendRaw = async () => {
    if (!sessionId) return;
    setJsonError(null);

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
        setJsonError('Invalid JSON format');
      } else {
        setJsonError(err instanceof Error ? err.message : 'Failed to send message');
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

  const clearJsonMessages = () => {
    setJsonMessages([]);
  };

  const clearPermissions = () => {
    setPermissions([]);
  };

  const togglePermissionExpanded = (id: string) => {
    setExpandedPermissions(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getPermissionStats = () => {
    const allowed = permissions.filter(p => p.decision === 'allow').length;
    const denied = permissions.filter(p => p.decision === 'deny').length;
    const byPattern = permissions.filter(p => p.reason === 'pattern').length;
    const byMode = permissions.filter(p => p.reason === 'mode').length;
    const byUser = permissions.filter(p => p.reason === 'user').length;
    const durations = permissions.filter(p => p.duration !== undefined).map(p => p.duration as number);
    const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    return { allowed, denied, byPattern, byMode, byUser, avgDuration };
  };

  const getReasonBadgeColor = (reason: string): string => {
    switch (reason) {
      case 'pattern': return 'bg-blue-500/20 text-blue-400';
      case 'mode': return 'bg-purple-500/20 text-purple-400';
      case 'user': return 'bg-amber-500/20 text-amber-400';
      default: return 'bg-gray-500/20 text-gray-400';
    }
  };

  const getMessagePreview = (data: any): string => {
    if (data.type) return `type: ${data.type}`;
    if (data.message?.role) return `${data.message.role} message`;
    return JSON.stringify(data).substring(0, 50) + '...';
  };

  const getMessageColor = (msg: typeof jsonMessages[0]): string => {
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
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 border-b bg-muted/50">
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleEnabled}
          className={cn(
            'h-7 px-2 gap-1',
            enabled ? 'text-green-500' : 'text-muted-foreground'
          )}
        >
          {enabled ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {enabled ? 'Tracking On' : 'Tracking Off'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={clearStats}
          className="h-7 px-2"
          title="Clear all stats"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Summary */}
      {enabled && (
        <div className="flex items-center gap-4 px-3 py-2 bg-muted/30 border-b text-[10px]">
          <div>
            <span className="text-muted-foreground">Calls: </span>
            <span className="font-mono">{totalCount}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Total: </span>
            <span className="font-mono">{formatDuration(totalTime)}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Blocks: </span>
            <span className="font-mono">{Object.keys(stats).length}</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b">
        <button
          onClick={() => setView('stats')}
          className={cn(
            'flex-1 px-3 py-1.5 text-xs font-medium transition-colors',
            view === 'stats'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Stats
        </button>
        <button
          onClick={() => setView('recent')}
          className={cn(
            'flex-1 px-3 py-1.5 text-xs font-medium transition-colors',
            view === 'recent'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Recent
        </button>
        {sessionId && (
          <button
            onClick={() => setView('json')}
            className={cn(
              'flex-1 px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'json'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            JSON
          </button>
        )}
        {sessionId && (
          <button
            onClick={() => setView('permissions')}
            className={cn(
              'flex-1 px-3 py-1.5 text-xs font-medium transition-colors',
              view === 'permissions'
                ? 'border-b-2 border-primary text-primary'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            Perms
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!enabled && view !== 'json' && view !== 'permissions' ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
            <Bug className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm text-center">
              Debug timing is disabled.
              <br />
              Click "Off" to enable.
            </p>
          </div>
        ) : view === 'stats' ? (
          <div>
            {topTimings.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No timing data yet.
                <br />
                Use timeBlock() to record timings.
              </div>
            ) : (
              topTimings.map(({ name, stats }) => (
                <StatsRow key={name} name={name} stats={stats} />
              ))
            )}
          </div>
        ) : view === 'recent' ? (
          <div className="divide-y divide-border/50">
            {recentEntries.length === 0 ? (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No recent entries.
              </div>
            ) : (
              [...recentEntries].reverse().map((entry) => (
                <div
                  key={entry.id}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 text-[10px]',
                    entry.duration > 16 && 'bg-red-500/10'
                  )}
                >
                  <span className="flex-1 font-mono truncate">{entry.name}</span>
                  <span
                    className={cn(
                      'font-mono',
                      entry.duration > 16 ? 'text-red-500' : 'text-muted-foreground'
                    )}
                  >
                    {formatDuration(entry.duration)}
                  </span>
                </div>
              ))
            )}
          </div>
        ) : view === 'json' ? (
          <div className="flex-1 flex flex-col h-full">
            {/* JSON Messages */}
            <div className="flex-1 overflow-y-auto p-2">
              <div className="space-y-2">
                {jsonMessages.length === 0 ? (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    No messages yet. Send a message to see JSON communication.
                  </div>
                ) : (
                  jsonMessages.map(msg => {
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
            </div>

            {/* Input Section */}
            <div className="border-t p-2 space-y-2">
              {jsonError && (
                <div className="flex items-center gap-2 text-xs text-red-500">
                  <AlertCircle className="h-3 w-3" />
                  {jsonError}
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
                <div className="flex-1" />
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
                  onClick={clearJsonMessages}
                  className="h-7 px-2"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>

              <textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
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
        ) : view === 'permissions' ? (
          <div className="flex-1 flex flex-col h-full">
            {/* Permissions Summary */}
            {permissions.length > 0 && (
              <div className="flex items-center gap-4 px-3 py-2 bg-muted/30 border-b text-[10px]">
                {(() => {
                  const stats = getPermissionStats();
                  return (
                    <>
                      <div className="flex items-center gap-1">
                        <CheckCircle className="h-3 w-3 text-green-500" />
                        <span className="font-mono">{stats.allowed}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <XCircle className="h-3 w-3 text-red-500" />
                        <span className="font-mono">{stats.denied}</span>
                      </div>
                      <div className="text-muted-foreground">
                        avg: <span className="font-mono">{formatDuration(stats.avgDuration)}</span>
                      </div>
                    </>
                  );
                })()}
                <div className="flex-1" />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearPermissions}
                  className="h-6 px-2"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            )}

            {/* Permissions List */}
            <div className="flex-1 overflow-y-auto p-2">
              <div className="space-y-2">
                {permissions.length === 0 ? (
                  <div className="text-center text-muted-foreground text-sm py-8">
                    <Shield className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No permission decisions yet.</p>
                    <p className="text-xs mt-1">Tool permissions will appear here.</p>
                  </div>
                ) : (
                  [...permissions].reverse().map(perm => {
                    const isExpanded = expandedPermissions.has(perm.id);
                    return (
                      <div
                        key={perm.id}
                        className={cn(
                          'border rounded-md overflow-hidden',
                          perm.decision === 'allow' ? 'border-green-500/30' : 'border-red-500/30'
                        )}
                      >
                        <button
                          onClick={() => togglePermissionExpanded(perm.id)}
                          className="w-full flex items-center gap-2 p-2 text-left hover:bg-muted/50 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          )}
                          {perm.decision === 'allow' ? (
                            <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />
                          ) : (
                            <XCircle className="h-3 w-3 text-red-500 shrink-0" />
                          )}
                          <span className="text-xs font-mono flex-1 truncate">
                            {perm.toolName}
                          </span>
                          <span className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded',
                            getReasonBadgeColor(perm.reason)
                          )}>
                            {perm.reason}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatDuration(perm.duration ?? 0)}
                          </span>
                        </button>

                        {isExpanded && (
                          <div className="border-t p-2 space-y-2 text-xs">
                            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                              <div className="text-muted-foreground">Time:</div>
                              <div>{new Date(perm.timestamp).toLocaleTimeString()}</div>

                              <div className="text-muted-foreground">Mode:</div>
                              <div className="font-mono">{perm.mode || '-'}</div>

                              {perm.matchedPattern && (
                                <>
                                  <div className="text-muted-foreground">Pattern:</div>
                                  <div className="font-mono text-blue-400 truncate" title={perm.matchedPattern}>
                                    {perm.matchedPattern}
                                  </div>
                                </>
                              )}
                            </div>

                            {perm.toolInput !== undefined && perm.toolInput !== null && (
                              <div>
                                <div className="text-muted-foreground mb-1">Input:</div>
                                <pre className="p-2 bg-muted/50 rounded text-[10px] font-mono overflow-x-auto max-h-32">
                                  {JSON.stringify(perm.toolInput, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
