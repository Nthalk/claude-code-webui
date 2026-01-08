import React from 'react';
import { FileText } from 'lucide-react';
import type { GrepToolInput } from '@claude-code-webui/shared';
import { stripWorkingDirectory } from '@/lib/utils';

interface GrepToolRendererProps {
  input: GrepToolInput;
  result?: string | {content?: string; [key: string]: any};
  error?: string;
  className?: string;
  workingDirectory?: string;
}

export const GrepToolRenderer: React.FC<GrepToolRendererProps> = ({
  input,
  result,
  error,
  className = '',
  workingDirectory
}) => {
  // Parse grep output based on output mode
  const renderResult = () => {
    if (!result) return null;

    // Check if result is a structured JSON response from SDK
    let parsedResult: any;
    let resultString: string;

    if (typeof result === 'string') {
      try {
        parsedResult = JSON.parse(result);
        // If it has a 'mode' property, it's the SDK format
        if (parsedResult.mode) {
          // Use the structured data directly
          if (parsedResult.mode === 'files_with_matches' && parsedResult.filenames) {
            return (
              <div className="space-y-1">
                {parsedResult.filenames.map((file: string, idx: number) => (
                  <div key={idx} className="flex items-center gap-2 px-3 py-1 hover:bg-muted/50 transition-colors">
                    <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    <code className="text-xs text-blue-600 dark:text-blue-400 truncate">
                      {stripWorkingDirectory(file, workingDirectory || '')}
                    </code>
                  </div>
                ))}
                {parsedResult.numFiles > 0 && (
                  <div className="px-3 py-1 text-xs text-muted-foreground">
                    Found {parsedResult.numFiles} file{parsedResult.numFiles !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            );
          } else if (parsedResult.mode === 'content' && parsedResult.content) {
            // Content mode - use the content directly
            resultString = parsedResult.content;
          } else if (parsedResult.filenames) {
            // Other modes with filenames
            resultString = parsedResult.filenames.join('\n');
          } else {
            // Fallback
            resultString = '';
          }
        } else {
          // Not SDK format, use as string
          resultString = result;
        }
      } catch {
        // Not JSON, use as string
        resultString = result;
      }
    } else if (typeof result === 'object' && 'content' in result) {
      // Result is an object with content property
      resultString = result.content || '';
    } else {
      // Fallback: stringify the result
      resultString = JSON.stringify(result, null, 2);
    }

    const lines = resultString.split('\n').filter(line => line.trim());

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
                  <code className="text-xs text-blue-600 dark:text-blue-400 truncate">
                    {stripWorkingDirectory(file || '', workingDirectory)}
                  </code>
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
                  <span className="text-blue-600 dark:text-blue-400">
                    {stripWorkingDirectory(file || '', workingDirectory)}
                  </span>
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