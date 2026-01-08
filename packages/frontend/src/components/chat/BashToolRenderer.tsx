import React from 'react';
import { Terminal } from 'lucide-react';
import type { BashToolInput } from '@claude-code-webui/shared';
import { BashOutputRenderer } from './BashOutputRenderer';

interface BashToolRendererProps {
  input: BashToolInput;
  result?: string;
  error?: string;
  className?: string;
}

export const BashToolRenderer: React.FC<BashToolRendererProps> = ({
  input,
  result,
  error,
  className = ''
}) => {
  // Extract exit code from error if present
  const exitCode = error?.match(/Exit code (\d+)/)?.[1];
  const numericExitCode = exitCode ? parseInt(exitCode) : undefined;

  return (
    <div className={`font-mono text-xs ${className}`}>
      {/* Command header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 dark:bg-black text-gray-100 border-b border-gray-700">
        <Terminal className="h-4 w-4" />
        <span className="text-green-400">$</span>
        <span className="flex-1 break-all">{input.command}</span>
      </div>

      {/* Description if provided */}
      {input.description && (
        <div className="px-3 py-1 bg-gray-800 dark:bg-gray-900 text-gray-300 text-xs italic border-b border-gray-700">
          {input.description}
        </div>
      )}

      {/* Output/Result */}
      {(result || error) ? (
        <div className="bg-gray-900 dark:bg-black text-gray-100 p-3">
          <BashOutputRenderer
            output={result || ''}
            error={error}
            exitCode={numericExitCode}
          />
        </div>
      ) : (
        <div className="bg-gray-900 dark:bg-black text-gray-400 p-3 flex items-center gap-2">
          <span className="animate-pulse">Executing...</span>
        </div>
      )}
    </div>
  );
};