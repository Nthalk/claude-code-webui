import { useState } from 'react';
import { Search, ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import type { TaskToolInput } from '@claude-code-webui/shared';
import { MessageContent } from './MessageContent';

interface ExploreRendererProps {
  input: TaskToolInput;
  result: string | undefined;
  error: string | undefined;
  status: 'started' | 'completed' | 'error';
}

export function ExploreRenderer({ input, result, error, status }: ExploreRendererProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div
        className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
        onClick={() => setExpanded(!expanded)}
      >
        <Search className="h-4 w-4 text-blue-500" />
        <span className="font-medium text-sm">
          Explore: {input.description}
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
        <div className="pl-6 space-y-3">
          {/* Search Query */}
          <div className="space-y-1">
            <span className="text-muted-foreground text-[10px] uppercase tracking-wide font-medium">
              Search Query
            </span>
            <div className="p-2 bg-muted/30 rounded-md border border-border/50">
              <p className="text-sm text-muted-foreground">
                {input.prompt}
              </p>
            </div>
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-1">
              <span className="text-muted-foreground text-[10px] uppercase tracking-wide font-medium">
                Exploration Results
              </span>
              <div className="bg-muted/10 rounded-lg border border-border/50 p-4">
                <MessageContent content={result} role="assistant" />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="space-y-1">
              <span className="text-red-400 text-[10px] uppercase tracking-wide font-medium">
                Error
              </span>
              <div className="p-3 bg-red-500/10 rounded-md border border-red-500/30">
                <pre className="text-xs text-red-400 font-mono whitespace-pre-wrap break-all">
                  {error}
                </pre>
              </div>
            </div>
          )}

          {/* Status indicator when still running */}
          {status === 'started' && !result && !error && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Exploring the codebase...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}