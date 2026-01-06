import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getLanguageFromPath } from '@/components/code-editor/language-map';
import type { ReadToolInput } from '@claude-code-webui/shared';

interface ReadToolRendererProps {
  input: ReadToolInput;
  result?: string;
  error?: string;
}

// Map Monaco language IDs to Prism language IDs where they differ
const monacoToPrismLanguage: Record<string, string> = {
  typescript: 'typescript',
  javascript: 'javascript',
  python: 'python',
  shell: 'bash',
  dockerfile: 'docker',
  ini: 'ini',
  plaintext: 'text',
  pgsql: 'sql',
  mysql: 'sql',
  csharp: 'csharp',
  cpp: 'cpp',
  c: 'c',
  // Add more mappings as needed
};

export const ReadToolRenderer: React.FC<ReadToolRendererProps> = ({
  input,
  result,
  error,
}) => {
  const filePath = input.file_path || '';
  const monacoLang = getLanguageFromPath(filePath);
  const prismLang = monacoToPrismLanguage[monacoLang] || monacoLang;

  // Extract line range info if present
  const hasLineRange = input.offset !== undefined || input.limit !== undefined;
  const startLine = input.offset || 1;
  const endLine = input.limit ? startLine + input.limit - 1 : undefined;

  return (
    <div className="space-y-2">
      {/* File header with path */}
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 rounded-t border border-gray-200 dark:border-gray-700">
        <span className="font-semibold flex-shrink-0 text-xs">File:</span>
        <span className="overflow-x-auto whitespace-nowrap scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent text-xs font-mono">
          {filePath}
        </span>
        {hasLineRange && (
          <span className="ml-auto flex-shrink-0 text-xs opacity-70">
            Lines {startLine}{endLine ? `-${endLine}` : '+'}
          </span>
        )}
      </div>

      {/* File content */}
      {result && (
        <div className="overflow-auto max-h-[500px] rounded-b">
          <SyntaxHighlighter
            language={prismLang}
            style={oneDark}
            showLineNumbers={true}
            startingLineNumber={startLine}
            className="!m-0 !text-xs"
            customStyle={{
              margin: 0,
              borderRadius: '0 0 0.375rem 0.375rem',
              fontSize: '0.75rem',
            }}
          >
            {result}
          </SyntaxHighlighter>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="px-3 py-2 bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 rounded border border-red-200 dark:border-red-700">
          <div className="font-semibold text-xs mb-1">Error reading file:</div>
          <pre className="text-xs font-mono whitespace-pre-wrap">{error}</pre>
        </div>
      )}
    </div>
  );
};