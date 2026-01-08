import React from 'react';
import type { BashToolInput } from '@claude-code-webui/shared';
import { BashOutputRenderer } from './BashOutputRenderer';

interface BashToolRendererProps {
  input: BashToolInput;
  result?: string;
  error?: string;
  className?: string;
}

export const BashToolRenderer: React.FC<BashToolRendererProps> = ({
  input: _input, // Prefix with _ to indicate intentionally unused
  result,
  error,
  className = ''
}) => {
  // Extract exit code from error if present
  const exitCode = error?.match(/Exit code (\d+)/)?.[1];
  const numericExitCode = exitCode ? parseInt(exitCode) : undefined;

  return (
    <div className={`font-mono text-xs ${className}`}>
      {/* Output/Result */}
      {(result || error) ? (
        <div className="bg-gray-900 dark:bg-black text-gray-100 p-3 rounded">
          <BashOutputRenderer
            output={result || ''}
            error={error}
            exitCode={numericExitCode}
          />
        </div>
      ) : (
        <div className="bg-gray-900 dark:bg-black text-gray-400 p-3 flex items-center gap-2 rounded">
          <span className="animate-pulse">Executing...</span>
        </div>
      )}
    </div>
  );
};