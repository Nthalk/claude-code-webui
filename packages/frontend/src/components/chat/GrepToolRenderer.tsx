import React from 'react';
import { Search, FileText } from 'lucide-react';
import type { GrepToolInput } from '@claude-code-webui/shared';

interface GrepToolRendererProps {
  input: GrepToolInput;
  result?: string;
  error?: string;
  className?: string;
}

export const GrepToolRenderer: React.FC<GrepToolRendererProps> = ({
  input,
  result,
  error,
  className = ''
}) => {
  // Parse grep output based on output mode
  const renderResult = () => {
    if (!result) return null;

    const lines = result.split('\n').filter(line => line.trim());

    // For files_with_matches mode - simple file list
    if (input.output_mode === 'files_with_matches' || (!input.output_mode && !input['-n'])) {
      return (
        <div className="space-y-1">
          {lines.map((file, idx) => (
            <div key={idx} className="flex items-center gap-2 px-3 py-1 hover:bg-muted/50 transition-colors">
              <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
              <code className="text-xs text-blue-600 dark:text-blue-400 truncate">{file}</code>
            </div>
          ))}
        </div>
      );
    }

    // For count mode
    if (input.output_mode === 'count') {
      return (
        <div className="space-y-1">
          {lines.map((line, idx) => {
            const [file, count] = line.split(':');
            return (
              <div key={idx} className="flex items-center justify-between px-3 py-1 hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2 truncate">
                  <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  <code className="text-xs text-blue-600 dark:text-blue-400 truncate">{file}</code>
                </div>
                <span className="text-xs font-medium text-muted-foreground">{count} matches</span>
              </div>
            );
          })}
        </div>
      );
    }

    // For content mode - show matches with line numbers
    return (
      <div className="overflow-auto max-h-96">
        <pre className="p-3 text-xs">
          {lines.map((line, idx) => {
            // Try to parse line with format: filename:linenum:content
            const match = line.match(/^([^:]+):(\d+):(.*)$/);
            if (match) {
              const [, file, lineNum, content] = match;
              return (
                <div key={idx} className="hover:bg-muted/30 px-1 -mx-1">
                  <span className="text-blue-600 dark:text-blue-400">{file}</span>
                  <span className="text-gray-500 dark:text-gray-400">:</span>
                  <span className="text-green-600 dark:text-green-400">{lineNum}</span>
                  <span className="text-gray-500 dark:text-gray-400">:</span>
                  <span className="text-foreground">{highlightMatch(content || '', String(input.pattern || ''))}</span>
                </div>
              );
            }
            return <div key={idx} className="text-foreground">{line}</div>;
          })}
        </pre>
      </div>
    );
  };

  // Highlight the pattern in the content
  const highlightMatch = (content: string, pattern: string): React.ReactNode => {
    if (!pattern) return content;

    try {
      const regex = new RegExp(`(${pattern})`, input['-i'] ? 'gi' : 'g');
      const parts = content.split(regex);

      return parts.map((part, idx) => {
        if (idx % 2 === 1) {
          return <mark key={idx} className="bg-yellow-200 dark:bg-yellow-800 text-inherit px-0.5">{part}</mark>;
        }
        return part;
      });
    } catch {
      // If regex is invalid, just return the content
      return content;
    }
  };

  return (
    <div className={`font-mono text-xs ${className}`}>
      {/* Search header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        <Search className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Pattern:</span>
        <code className="text-purple-600 dark:text-purple-400 font-semibold">{input.pattern}</code>
        {input['-i'] && (
          <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
            case-insensitive
          </span>
        )}
      </div>

      {/* Search options */}
      <div className="flex flex-wrap gap-2 px-3 py-2 bg-gray-50/50 dark:bg-gray-800/30 border-b border-gray-200 dark:border-gray-700 text-[10px]">
        {input.path && (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">Path:</span>
            <code className="text-foreground">{input.path}</code>
          </span>
        )}
        {input.glob && (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">Glob:</span>
            <code className="text-foreground">{input.glob}</code>
          </span>
        )}
        {input.type && (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">Type:</span>
            <code className="text-foreground">{input.type}</code>
          </span>
        )}
        {input.output_mode && (
          <span className="flex items-center gap-1">
            <span className="text-muted-foreground">Mode:</span>
            <code className="text-foreground">{input.output_mode}</code>
          </span>
        )}
      </div>

      {/* Results */}
      {result ? (
        renderResult()
      ) : !error ? (
        <div className="px-4 py-3 text-center text-muted-foreground animate-pulse">
          Searching...
        </div>
      ) : null}

      {/* Error */}
      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400">
          <pre className="whitespace-pre-wrap">{error}</pre>
        </div>
      )}
    </div>
  );
};