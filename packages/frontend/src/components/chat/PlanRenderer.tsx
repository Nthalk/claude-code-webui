import { useState, useCallback } from 'react';
import { CheckCircle2, XCircle, FileText, Loader2, ChevronRight, ChevronDown, Cpu } from 'lucide-react';
import type { TaskToolInput } from '@claude-code-webui/shared';

interface PlanRendererProps {
  input: TaskToolInput;
  result: string | undefined;
  error: string | undefined;
  status: 'started' | 'completed' | 'error';
  onAccept?: () => void;
  onReject?: (reason: string) => void;
}

export function PlanRenderer({ input, result, error, status, onAccept, onReject }: PlanRendererProps) {
  const [expanded, setExpanded] = useState(true);
  const [showRejectReason, setShowRejectReason] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const isPlanAgent = input.subagent_type === 'Plan' || input.subagent_type === 'plan';
  const isExploreAgent = input.subagent_type === 'Explore' || input.subagent_type === 'explore';
  const canAcceptReject = isPlanAgent && status === 'completed' && result && onAccept && onReject;

  const handleReject = useCallback(() => {
    if (rejectReason.trim() && onReject) {
      onReject(rejectReason);
      setShowRejectReason(false);
      setRejectReason('');
    }
  }, [rejectReason, onReject]);

  const getAgentIcon = () => {
    if (isPlanAgent) return FileText;
    if (isExploreAgent) return ChevronRight;
    return Cpu;
  };

  const AgentIcon = getAgentIcon();

  return (
    <div className="space-y-2">
      {/* Header */}
      <div
        className="flex items-center gap-2 cursor-pointer hover:opacity-80"
        onClick={() => setExpanded(!expanded)}
      >
        <AgentIcon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium text-sm">
          {input.subagent_type} Agent: {input.description}
        </span>
        <span className="flex-1" />
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        {status === 'started' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
        {status === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
      </div>

      {/* Content */}
      {expanded && (
        <>
          {/* Prompt */}
          <div className="space-y-1">
            <span className="text-muted-foreground text-[10px] uppercase tracking-wide">Prompt</span>
            <pre className="p-2 bg-muted/50 rounded text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all text-foreground font-mono">
              {input.prompt}
            </pre>
          </div>

          {/* Result/Plan */}
          {result && (
            <div className="space-y-1">
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide">
                {isPlanAgent ? 'Implementation Plan' : 'Result'}
              </span>
              <div className="p-3 bg-muted/30 rounded-lg border border-border/50">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <pre className="text-xs overflow-auto whitespace-pre-wrap break-words text-foreground font-sans">
                    {result}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="space-y-1">
              <span className="text-red-400 text-[10px] uppercase tracking-wide">Error</span>
              <pre className="p-2 bg-red-500/10 rounded text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all text-red-400 font-mono">
                {error}
              </pre>
            </div>
          )}

          {/* Accept/Reject buttons for Plan agents */}
          {canAcceptReject && (
            <div className="mt-4 space-y-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                Review the plan above and decide whether to proceed:
              </p>

              <div className="flex gap-2">
                <button
                  onClick={onAccept}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Accept Plan
                </button>
                <button
                  onClick={() => setShowRejectReason(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <XCircle className="h-4 w-4" />
                  Reject Plan
                </button>
              </div>

              {/* Rejection reason input */}
              {showRejectReason && (
                <div className="mt-3 space-y-2 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded">
                  <label className="text-sm font-medium text-red-700 dark:text-red-300 block">
                    Feedback for Claude (optional but recommended)
                  </label>
                  <textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Explain what needs to be changed in the plan..."
                    className="w-full p-2 bg-white dark:bg-background border border-red-300 dark:border-red-700 rounded text-sm min-h-[80px] resize-none"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleReject}
                      disabled={!rejectReason.trim()}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded text-sm font-medium transition-colors"
                    >
                      Send Feedback
                    </button>
                    <button
                      onClick={() => {
                        setShowRejectReason(false);
                        setRejectReason('');
                      }}
                      className="px-3 py-1.5 bg-gray-500 hover:bg-gray-600 text-white rounded text-sm font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}