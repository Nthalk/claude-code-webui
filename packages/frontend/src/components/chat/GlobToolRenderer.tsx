import React from 'react';
import { FileText, FolderOpen } from 'lucide-react';
import type { GlobToolInput } from '@claude-code-webui/shared';
import { stripWorkingDirectory } from '@/lib/utils';

interface GlobToolRendererProps {
  input: GlobToolInput;
  result?: string;
  error?: string;
  className?: string;
  workingDirectory?: string;
}

export const GlobToolRenderer: React.FC<GlobToolRendererProps> = ({
  input: _input, // Prefix with _ to indicate intentionally unused
  result,
  error,
  className = '',
  workingDirectory
}) => {
  // Parse glob output
  const renderResult = () => {
    if (!result) return null;

    let files: string[] = [];
    let content: string | null = null;
    let mode: string = 'filenames';
    let numFiles: number | null = null;
    let truncated: boolean = false;
    let durationMs: number | null = null;

    // Check if result is structured JSON from SDK
    if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result);
        // Handle both formats: with mode property and without
        if (parsed.filenames && Array.isArray(parsed.filenames)) {
          // Direct filenames array (the format user is seeing)
          files = parsed.filenames;
          // Extract metadata if available
          if (typeof parsed.numFiles === 'number') numFiles = parsed.numFiles;
          if (typeof parsed.truncated === 'boolean') truncated = parsed.truncated;
          if (typeof parsed.durationMs === 'number') durationMs = parsed.durationMs;
        } else if (parsed.mode) {
          // Format with mode property
          mode = parsed.mode;
          if (mode === 'content' && parsed.content) {
            // Content mode - used by Grep
            content = parsed.content;
          } else if (parsed.filenames && Array.isArray(parsed.filenames)) {
            // Filenames mode
            files = parsed.filenames;
          }
        } else {
          // Not SDK format, assume newline-separated files
          files = result.split('\n').filter(line => line.trim());
        }
      } catch {
        // Not JSON, assume newline-separated files
        files = result.split('\n').filter(line => line.trim());
      }
    }

    // Render based on mode
    if (mode === 'content' && content) {
      // Content mode - show the actual content (used by Grep)
      return (
        <pre className="p-3 text-xs overflow-auto max-h-96 whitespace-pre-wrap break-all">
          {content}
        </pre>
      );
    }

    // Filenames mode
    if (files.length === 0) {
      return (
        <div className="px-3 py-8 text-center text-muted-foreground text-sm">
          <FolderOpen className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <div>No files found matching pattern</div>
        </div>
      );
    }

    return (
      <div className="space-y-1 py-2">
        {files.map((file, idx) => (
          <div key={idx} className="flex items-center gap-2 px-3 py-1 hover:bg-muted/50 transition-colors">
            <FileText className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            <code className="text-xs text-blue-600 dark:text-blue-400 truncate">
              {stripWorkingDirectory(file, workingDirectory || '')}
            </code>
          </div>
        ))}
        <div className="px-3 py-1 text-xs text-muted-foreground border-t border-muted mt-2 pt-2 space-y-1">
          <div className="flex items-center justify-between">
            <span>
              Found {numFiles !== null ? numFiles : files.length} file{(numFiles !== null ? numFiles : files.length) !== 1 ? 's' : ''}
            </span>
            {durationMs !== null && (
              <span className="text-[10px] opacity-70">{durationMs}ms</span>
            )}
          </div>
          {truncated && (
            <div className="text-amber-600 dark:text-amber-400 text-[11px]">
              Results truncated - showing first {files.length} files
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`font-mono text-xs ${className}`}>
      {result ? (
        renderResult()
      ) : !error ? (
        <div className="px-4 py-3 text-center text-muted-foreground animate-pulse">
          Searching for files...
        </div>
      ) : null}

      {/* Error display */}
      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded">
          <pre className="whitespace-pre-wrap">{error}</pre>
        </div>
      )}
    </div>
  );
};