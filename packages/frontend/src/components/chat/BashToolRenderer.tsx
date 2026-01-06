import React from 'react';
import { Terminal } from 'lucide-react';
import type { BashToolInput } from '@claude-code-webui/shared';

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
  // ANSI color code handling
  const formatAnsiOutput = (text: string): React.ReactNode[] => {
    const ansiRegex = /\x1b\[([0-9;]+)m/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    const colorMap: Record<string, string> = {
      '30': 'text-gray-900 dark:text-gray-100',
      '31': 'text-red-600 dark:text-red-400',
      '32': 'text-green-600 dark:text-green-400',
      '33': 'text-yellow-600 dark:text-yellow-400',
      '34': 'text-blue-600 dark:text-blue-400',
      '35': 'text-purple-600 dark:text-purple-400',
      '36': 'text-cyan-600 dark:text-cyan-400',
      '37': 'text-gray-100 dark:text-gray-900',
      '1': 'font-bold',
      '0': '',
    };

    while ((match = ansiRegex.exec(text)) !== null) {
      if (match && match.index > lastIndex) {
        parts.push(text.slice(lastIndex, match.index));
      }

      const codes = match?.[1]?.split(';') || [];
      const classes = codes.map(code => colorMap[code] || '').join(' ');

      if (!match) continue;

      const nextMatch = ansiRegex.exec(text);
      const endIndex = nextMatch ? nextMatch.index : text.length;
      ansiRegex.lastIndex = match.index + match[0].length;

      if (endIndex > ansiRegex.lastIndex) {
        parts.push(
          <span key={match.index} className={classes}>
            {text.slice(ansiRegex.lastIndex, endIndex)}
          </span>
        );
      }

      lastIndex = endIndex;
      if (nextMatch) {
        ansiRegex.lastIndex = nextMatch.index;
      }
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts.length > 0 ? parts : [text];
  };

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
      {result ? (
        <div className="bg-gray-900 dark:bg-black text-gray-100">
          <pre className="p-3 overflow-auto max-h-96 whitespace-pre-wrap break-all">
            {formatAnsiOutput(result)}
          </pre>
        </div>
      ) : !error ? (
        <div className="bg-gray-900 dark:bg-black text-gray-400 p-3 flex items-center gap-2">
          <span className="animate-pulse">Executing...</span>
        </div>
      ) : null}

      {/* Error output */}
      {error && (
        <div className="bg-red-950 dark:bg-red-900/20 border-t border-red-800">
          <div className="px-3 py-1 text-red-400 text-xs font-semibold">
            Exit code {error.includes('Exit code') ? error.match(/Exit code (\d+)/)?.[1] : 'unknown'}
          </div>
          <pre className="p-3 text-red-300 overflow-auto max-h-60 whitespace-pre-wrap break-all">
            {error}
          </pre>
        </div>
      )}
    </div>
  );
};