import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getLanguageFromPath } from '@/components/code-editor/language-map';
import type { ReadToolInput } from '@claude-code-webui/shared';

interface ReadToolRendererProps {
  input: ReadToolInput;
  result?: string;
  error?: string;
  workingDirectory?: string;
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
  workingDirectory: _workingDirectory, // Prefix with _ to indicate intentionally unused
}) => {
  const filePath = input.file_path || '';
  const monacoLang = getLanguageFromPath(filePath);
  const prismLang = monacoToPrismLanguage[monacoLang] || monacoLang;

  // Parse result - SDK returns structured JSON
  let fileContent = '';
  let actualStartLine = input.offset || 1;

  if (result) {
    if (typeof result === 'string') {
      try {
        const parsed = JSON.parse(result);
        // Check if it's structured SDK response
        if (parsed.type === 'text' && parsed.file?.content) {
          fileContent = parsed.file.content;
          actualStartLine = parsed.file.startLine || actualStartLine;
        } else {
          // Not SDK format, use as is
          fileContent = result;
        }
      } catch {
        // Not JSON, use as string
        fileContent = result;
      }
    } else {
      fileContent = String(result);
    }
  }

  return (
    <div className="space-y-2">
      {/* File content */}
      {fileContent && (
        <div className="overflow-auto max-h-[500px] rounded">
          <SyntaxHighlighter
            language={prismLang}
            style={oneDark}
            showLineNumbers={true}
            startingLineNumber={actualStartLine}
            className="!m-0 !text-xs"
            customStyle={{
              margin: 0,
              borderRadius: '0.375rem',
              fontSize: '0.75rem',
            }}
          >
            {fileContent}
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