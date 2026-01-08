import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, Copy, Check, FileJson, Table2, AlertTriangle } from 'lucide-react';
import { cn } from '../../lib/utils';

interface BashOutputRendererProps {
  output: string;
  error?: string;
  exitCode?: number;
  className?: string;
}

// Structured bash result from Claude SDK
interface BashResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
  interrupted?: boolean;
  isImage?: boolean;
}

// Detect the type of output for better formatting
type OutputType = 'json' | 'table' | 'ansi' | 'plain' | 'empty';

function detectOutputType(text: string): OutputType {
  if (!text || text.trim().length === 0) return 'empty';

  // Check for JSON
  const trimmed = text.trim();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Not valid JSON
    }
  }

  // Check for table-like output (has consistent column separators)
  const lines = text.split('\n').filter(line => line.trim());
  if (lines.length > 2) {
    const hasTableSeparators = lines.some(line =>
      /^[\s|-]+$/.test(line) || // Table separator lines
      /^\+[-+]+\+$/.test(line)   // Box drawing separators
    );
    const hasConsistentColumns = lines.filter(line =>
      line.includes('|') || line.includes('\t')
    ).length > lines.length * 0.5;

    if (hasTableSeparators || hasConsistentColumns) {
      return 'table';
    }
  }

  // Check for ANSI color codes
  if (/\x1b\[[0-9;]+m/.test(text)) {
    return 'ansi';
  }

  return 'plain';
}

// Enhanced ANSI color parser
function parseAnsiToReact(text: string): React.ReactNode[] {
  const ansiRegex = /\x1b\[([0-9;]+)m/g;
  const segments: React.ReactNode[] = [];
  let lastIndex = 0;
  let currentStyles: string[] = [];

  const styleMap: Record<string, string> = {
    '0': '', // Reset
    '1': 'font-bold',
    '2': 'opacity-75',
    '3': 'italic',
    '4': 'underline',
    // Foreground colors
    '30': 'text-gray-900 dark:text-gray-100',
    '31': 'text-red-600 dark:text-red-400',
    '32': 'text-green-600 dark:text-green-400',
    '33': 'text-yellow-600 dark:text-yellow-400',
    '34': 'text-blue-600 dark:text-blue-400',
    '35': 'text-purple-600 dark:text-purple-400',
    '36': 'text-cyan-600 dark:text-cyan-400',
    '37': 'text-gray-100 dark:text-gray-900',
    // Bright colors
    '90': 'text-gray-500',
    '91': 'text-red-500',
    '92': 'text-green-500',
    '93': 'text-yellow-500',
    '94': 'text-blue-500',
    '95': 'text-purple-500',
    '96': 'text-cyan-500',
    '97': 'text-white',
    // Background colors
    '40': 'bg-gray-900 dark:bg-gray-100',
    '41': 'bg-red-600 dark:bg-red-400',
    '42': 'bg-green-600 dark:bg-green-400',
    '43': 'bg-yellow-600 dark:bg-yellow-400',
    '44': 'bg-blue-600 dark:bg-blue-400',
    '45': 'bg-purple-600 dark:bg-purple-400',
    '46': 'bg-cyan-600 dark:bg-cyan-400',
    '47': 'bg-gray-100 dark:bg-gray-900',
  };

  let match;
  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this ANSI code
    if (match.index > lastIndex) {
      const content = text.slice(lastIndex, match.index);
      if (content) {
        segments.push(
          <span key={lastIndex} className={currentStyles.join(' ')}>
            {content}
          </span>
        );
      }
    }

    // Process ANSI codes
    const codes = match?.[1]?.split(';') || [];
    for (const code of codes) {
      if (code === '0') {
        currentStyles = []; // Reset all styles
      } else if (styleMap[code]) {
        // Remove conflicting styles (e.g., other colors)
        const codeNum = parseInt(code);
        if (codeNum >= 30 && codeNum <= 37) {
          currentStyles = currentStyles.filter(s => !s.startsWith('text-'));
        }
        if (codeNum >= 40 && codeNum <= 47) {
          currentStyles = currentStyles.filter(s => !s.startsWith('bg-'));
        }
        currentStyles.push(styleMap[code]);
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const content = text.slice(lastIndex);
    if (content) {
      segments.push(
        <span key={lastIndex} className={currentStyles.join(' ')}>
          {content}
        </span>
      );
    }
  }

  return segments.length > 0 ? segments : [text];
}

export const BashOutputRenderer: React.FC<BashOutputRendererProps> = ({
  output,
  error,
  exitCode,
  className = ''
}) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isCopied, setIsCopied] = useState(false);

  // Check if the output is a structured bash result JSON
  const parsedResult = useMemo(() => {
    if (!output) return null;
    try {
      const parsed = JSON.parse(output);
      // Check if it has the expected bash result structure
      if (typeof parsed === 'object' &&
          'stdout' in parsed &&
          typeof parsed.stdout === 'string') {
        return parsed as BashResult;
      }
    } catch {
      // Not JSON or not the expected structure
    }
    return null;
  }, [output]);

  // Use parsed result if available, otherwise use raw output
  const displayOutput = parsedResult?.stdout || output;
  const displayError = parsedResult?.stderr || error;
  const displayExitCode = parsedResult?.exitCode ?? exitCode;

  const outputType = useMemo(() => detectOutputType(displayOutput), [displayOutput]);
  const lineCount = useMemo(() => displayOutput.split('\n').length, [displayOutput]);
  const shouldAllowCollapse = lineCount > 20;

  const copyToClipboard = async () => {
    try {
      // Copy the actual output (stdout if structured, otherwise raw)
      await navigator.clipboard.writeText(displayOutput);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const renderOutput = () => {
    if (outputType === 'empty') {
      return <span className="text-gray-500 italic">No output</span>;
    }

    if (outputType === 'json') {
      try {
        const formatted = JSON.stringify(JSON.parse(output.trim()), null, 2);
        return (
          <div className="relative">
            <div className="absolute top-2 right-2">
              <FileJson className="h-4 w-4 text-blue-500" />
            </div>
            <pre className="language-json">{formatted}</pre>
          </div>
        );
      } catch {
        // Fallback to plain rendering
      }
    }

    if (outputType === 'table') {
      return (
        <div className="relative">
          <div className="absolute top-2 right-2">
            <Table2 className="h-4 w-4 text-purple-500" />
          </div>
          <pre className="whitespace-pre">{output}</pre>
        </div>
      );
    }

    if (outputType === 'ansi') {
      return <pre className="whitespace-pre-wrap">{parseAnsiToReact(displayOutput)}</pre>;
    }

    return <pre className="whitespace-pre-wrap break-all">{displayOutput}</pre>;
  };


  return (
    <div className={cn('relative group', className)}>
      {/* Toolbar */}
      <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
        {shouldAllowCollapse && (
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="p-1.5 rounded hover:bg-gray-700/50 transition-colors"
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </button>
        )}
        <button
          onClick={copyToClipboard}
          className="p-1.5 rounded hover:bg-gray-700/50 transition-colors"
          title="Copy to clipboard"
        >
          {isCopied ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <Copy className="h-4 w-4 text-gray-400" />
          )}
        </button>
      </div>

      {/* Output content */}
      <div className={cn(
        'overflow-auto transition-all',
        shouldAllowCollapse && isCollapsed ? 'max-h-64' : 'max-h-[600px]'
      )}>
        {/* Show stderr or error */}
        {(displayError || (displayExitCode && displayExitCode !== 0)) ? (
          <div>
            {/* Error header if exit code is non-zero */}
            {displayExitCode && displayExitCode !== 0 && (
              <div className="text-red-400 mb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">
                    Command failed with exit code {displayExitCode}
                  </span>
                  {parsedResult?.interrupted && (
                    <span className="text-xs text-red-300">(interrupted)</span>
                  )}
                </div>
              </div>
            )}

            {/* Show stdout if present */}
            {displayOutput && displayOutput.trim() && (
              <div className="mb-4">
                <div className="text-xs text-gray-500 mb-1">stdout:</div>
                {renderOutput()}
              </div>
            )}

            {/* Show stderr if present */}
            {displayError && displayError.trim() && (
              <div>
                <div className="text-xs text-red-400 mb-1">stderr:</div>
                <pre className="whitespace-pre-wrap break-all text-red-300 opacity-90">{displayError}</pre>
              </div>
            )}
          </div>
        ) : (
          // Normal output (no error)
          renderOutput()
        )}
      </div>

      {/* Collapse indicator */}
      {shouldAllowCollapse && isCollapsed && (
        <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-gray-900 to-transparent pointer-events-none" />
      )}

      {/* Line count indicator */}
      {lineCount > 10 && (
        <div className="absolute bottom-2 left-2 text-xs text-gray-500">
          {lineCount} lines {isCollapsed && '(collapsed)'}
        </div>
      )}
    </div>
  );
};