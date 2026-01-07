import { useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle2, XCircle, GitCommit, Send, Upload, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CommitApprovalInputProps {
  onRespond: (approved: boolean, push?: boolean, reason?: string) => void;
  commitMessage: string;
  gitStatus: string;
}

export function CommitApprovalInput({ onRespond, commitMessage, gitStatus }: CommitApprovalInputProps) {
  const [mode, setMode] = useState<'buttons' | 'reason'>('buttons');
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showCommitMessage, setShowCommitMessage] = useState(true);
  const [showGitStatus, setShowGitStatus] = useState(true);
  const [wantsPush, setWantsPush] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode === 'reason' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  const handleApprove = useCallback(async (push: boolean) => {
    setIsSubmitting(true);
    try {
      await onRespond(true, push);
    } finally {
      setIsSubmitting(false);
    }
  }, [onRespond]);

  const handleReject = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await onRespond(false, undefined, rejectReason || undefined);
    } finally {
      setIsSubmitting(false);
    }
  }, [onRespond, rejectReason]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleReject();
    } else if (e.key === 'Escape') {
      setMode('buttons');
      setRejectReason('');
    }
  }, [handleReject]);

  // Parse git status into a more readable format
  const formatGitStatus = (status: string): { action: string; file: string }[] => {
    const lines = status.trim().split('\n').filter(line => line.trim());
    return lines.map(line => {
      const parts = line.trim().split(/\s+/);
      const statusCode = parts[0] || '';
      const file = parts[1] || '';

      let action = 'unknown';
      switch (statusCode) {
        case 'M':
          action = 'modified';
          break;
        case 'A':
          action = 'added';
          break;
        case 'D':
          action = 'deleted';
          break;
        case 'R':
          action = 'renamed';
          break;
        case '??':
          action = 'untracked';
          break;
        case 'MM':
          action = 'modified';
          break;
        case 'AM':
          action = 'added+modified';
          break;
        default:
          action = statusCode;
      }

      return { action, file };
    });
  };

  const statusItems = formatGitStatus(gitStatus);

  if (mode === 'reason') {
    return (
      <div className="flex flex-col gap-3 px-1">
        {/* Info banner */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
          <div className="p-1.5 bg-red-500/20 rounded-lg shrink-0">
            <XCircle className="h-5 w-5 text-red-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-700 dark:text-red-300">
              Rejecting Commit
            </p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80">
              Please provide feedback to help Claude understand why this commit should not proceed.
            </p>
          </div>
        </div>

        {/* Reason input */}
        <div className="flex-1 flex items-center relative">
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                // Auto-resize
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onKeyDown={handleKeyDown}
              rows={1}
              placeholder="What's wrong with this commit? (Enter to send, Esc to cancel)"
              className="w-full min-h-[40px] md:min-h-[44px] max-h-[200px] pl-3 pr-10 md:px-4 py-2 md:py-2.5 rounded border bg-background focus:outline-none focus:ring-2 focus:ring-red-500/50 border-red-500/30 text-base resize-none scrollbar-hide"
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            type="button"
            onClick={() => {
              setMode('buttons');
              setRejectReason('');
            }}
            disabled={isSubmitting}
            variant="ghost"
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleReject}
            disabled={isSubmitting}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white"
          >
            <Send className="h-4 w-4 mr-2" />
            Send Rejection
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full max-h-[600px] px-1">
      {/* Info banner - Clickable header */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 cursor-pointer hover:bg-blue-500/15 transition-colors shrink-0"
      >
        <div className="p-1.5 bg-blue-500/20 rounded-lg shrink-0">
          <GitCommit className="h-5 w-5 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
            Commit Approval Required
          </p>
          {isExpanded && (
            <p className="text-xs text-blue-600/80 dark:text-blue-400/80">
              Claude wants to create a git commit. Review the changes below.
            </p>
          )}
        </div>
        <div className="shrink-0">
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-blue-500" />
          ) : (
            <ChevronDown className="h-5 w-5 text-blue-500" />
          )}
        </div>
      </div>

      {/* Content sections - only show when expanded */}
      {isExpanded && (
        <>
          {/* Scrollable content area */}
          <div className="flex-1 overflow-y-auto py-3 space-y-3">
            {/* Commit message */}
            <div className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setShowCommitMessage(!showCommitMessage)}
                className="w-full p-3 bg-muted/30 hover:bg-muted/50 flex items-center justify-between text-sm font-medium transition-colors"
              >
                <span>Commit Message</span>
                {showCommitMessage ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {showCommitMessage && (
                <div className="p-3 bg-background border-t border-border">
                  <pre className="text-sm font-mono text-muted-foreground whitespace-pre-wrap break-words">
                    {commitMessage}
                  </pre>
                </div>
              )}
            </div>

            {/* Git status */}
            <div className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => setShowGitStatus(!showGitStatus)}
                className="w-full p-3 bg-muted/30 hover:bg-muted/50 flex items-center justify-between text-sm font-medium transition-colors"
              >
                <span>Git Status ({statusItems.length} {statusItems.length === 1 ? 'change' : 'changes'})</span>
                {showGitStatus ? (
                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
              {showGitStatus && (
                <div className="max-h-64 overflow-y-auto p-3 bg-background">
                  {statusItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No changes detected</p>
                  ) : (
                    <div className="space-y-1">
                      {statusItems.map((item, index) => (
                        <div key={index} className="flex items-center gap-2 text-sm font-mono">
                          <span className={`
                            px-1.5 py-0.5 rounded text-xs font-bold uppercase
                            ${item.action === 'modified' ? 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400' : ''}
                            ${item.action === 'added' ? 'bg-green-500/20 text-green-600 dark:text-green-400' : ''}
                            ${item.action === 'deleted' ? 'bg-red-500/20 text-red-600 dark:text-red-400' : ''}
                            ${item.action === 'renamed' ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400' : ''}
                            ${item.action === 'untracked' ? 'bg-gray-500/20 text-gray-600 dark:text-gray-400' : ''}
                            ${!['modified', 'added', 'deleted', 'renamed', 'untracked'].includes(item.action) ? 'bg-muted text-muted-foreground' : ''}
                          `}>
                            {item.action}
                          </span>
                          <span className="text-muted-foreground">{item.file}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Fixed bottom section */}
          <div className="shrink-0 pt-3 space-y-3 border-t border-border">
            {/* Push option */}
            <label className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors">
              <input
                type="checkbox"
                checked={wantsPush}
                onChange={(e) => setWantsPush(e.target.checked)}
                disabled={isSubmitting}
                className="rounded border-border text-primary focus:ring-primary"
              />
              <span className="text-sm font-medium">Push to remote after commit</span>
              <Upload className="h-4 w-4 text-muted-foreground ml-auto" />
            </label>

            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() => handleApprove(wantsPush)}
                disabled={isSubmitting}
                className="h-11 bg-green-600 hover:bg-green-700 text-white font-medium"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Approve
              </Button>
              <Button
                type="button"
                onClick={() => setMode('reason')}
                disabled={isSubmitting}
                className="h-11 bg-red-600 hover:bg-red-700 text-white font-medium"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Deny
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}