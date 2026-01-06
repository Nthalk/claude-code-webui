import { useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle2, XCircle, FileText, Send, ArrowLeft, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ReactMarkdown from 'react-markdown';

interface PlanApprovalInputProps {
  onRespond: (approved: boolean, reason?: string) => void;
  planContent?: string;
}

export function PlanApprovalInput({ onRespond, planContent }: PlanApprovalInputProps) {
  const [mode, setMode] = useState<'buttons' | 'reason'>('buttons');
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPlan, setShowPlan] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (mode === 'reason' && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [mode]);

  const handleApprove = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await onRespond(true);
    } finally {
      setIsSubmitting(false);
    }
  }, [onRespond]);

  const handleReject = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await onRespond(false, rejectReason || undefined);
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

  if (mode === 'reason') {
    return (
      <div className="flex gap-2 items-center px-1">
        {/* Back button */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => {
            setMode('buttons');
            setRejectReason('');
          }}
          className="h-10 w-10 shrink-0"
          title="Back to options"
          disabled={isSubmitting}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>

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
              placeholder="What changes would you like to the plan? (Enter to send, Esc to cancel)"
              className="w-full min-h-[40px] md:min-h-[44px] max-h-[200px] pl-3 pr-10 md:px-4 py-2 md:py-2.5 rounded border bg-background focus:outline-none focus:ring-2 focus:ring-red-500/50 border-red-500/30 text-base resize-none scrollbar-hide"
              disabled={isSubmitting}
            />
          </div>
        </div>

        {/* Send button */}
        <Button
          type="button"
          onClick={handleReject}
          disabled={isSubmitting}
          className="h-10 px-4 bg-red-600 hover:bg-red-700 text-white"
        >
          <Send className="h-4 w-4 mr-2" />
          Send
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-1">
      {/* Info banner */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/30">
        <div className="p-1.5 bg-blue-500/20 rounded-lg shrink-0">
          <FileText className="h-5 w-5 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
            Plan Review Required
          </p>
          <p className="text-xs text-blue-600/80 dark:text-blue-400/80">
            Claude has completed planning. Review the plan {planContent ? 'below' : 'above'} and approve to proceed with implementation.
          </p>
        </div>
      </div>

      {/* Plan content */}
      {planContent && (
        <div className="border border-border rounded-lg overflow-hidden">
          <button
            onClick={() => setShowPlan(!showPlan)}
            className="w-full p-3 bg-muted/30 hover:bg-muted/50 flex items-center justify-between text-sm font-medium transition-colors"
          >
            <span>Implementation Plan</span>
            {showPlan ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showPlan && (
            <div className="max-h-96 overflow-y-auto p-4 bg-background">
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown>{planContent}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          type="button"
          onClick={handleApprove}
          disabled={isSubmitting}
          className="flex-1 h-11 bg-green-600 hover:bg-green-700 text-white font-medium"
        >
          <CheckCircle2 className="h-4 w-4 mr-2" />
          Approve Plan
        </Button>
        <Button
          type="button"
          onClick={() => setMode('reason')}
          disabled={isSubmitting}
          className="flex-1 h-11 bg-red-600 hover:bg-red-700 text-white font-medium"
        >
          <XCircle className="h-4 w-4 mr-2" />
          Request Changes
        </Button>
      </div>
    </div>
  );
}
