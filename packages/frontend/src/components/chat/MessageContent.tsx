import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '@/lib/utils';

interface MessageContentProps {
  content: string;
  role: 'user' | 'assistant' | 'system';
  className?: string;
}

// Detect if content is likely code based on patterns
function detectCodeLanguage(content: string): string | null {
  const trimmed = content.trim();

  // Check for JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {}
  }

  // Check for diff format
  if (/^(@@|diff|---|\+\+\+|\+|-)\s/m.test(trimmed)) {
    return 'diff';
  }

  // Check for common code patterns
  const patterns = [
    { pattern: /^import\s+.+from\s+['"]/, lang: 'javascript' },
    { pattern: /^const\s+\w+\s*=|^let\s+\w+\s*=|^var\s+\w+\s*=/, lang: 'javascript' },
    { pattern: /^function\s+\w+\s*\(|^\w+\s*:\s*function/, lang: 'javascript' },
    { pattern: /^export\s+(default\s+)?/, lang: 'javascript' },
    { pattern: /^import\s+\w+|^from\s+\w+\s+import/, lang: 'python' },
    { pattern: /^def\s+\w+\s*\(|^class\s+\w+/, lang: 'python' },
    { pattern: /^#!/, lang: 'bash' },
    { pattern: /^\$\s*\w+/, lang: 'bash' },
    { pattern: /^SELECT\s+|^INSERT\s+|^UPDATE\s+|^DELETE\s+/i, lang: 'sql' },
    { pattern: /^CREATE\s+TABLE|^ALTER\s+TABLE/i, lang: 'sql' },
    { pattern: /^\s*\w+\s*:\s*$/m, lang: 'yaml' },
    { pattern: /^<\?php/, lang: 'php' },
    { pattern: /^package\s+\w+|^import\s+java/, lang: 'java' },
    { pattern: /^using\s+System|^namespace\s+/, lang: 'csharp' },
    { pattern: /^#include\s+[<"]/, lang: 'cpp' },
  ];

  for (const { pattern, lang } of patterns) {
    if (pattern.test(trimmed)) {
      return lang;
    }
  }

  // Check for TypeScript/TSX
  if (/^interface\s+\w+|^type\s+\w+\s*=/m.test(trimmed)) {
    return 'typescript';
  }

  // Check for JSX/TSX
  if (/<[A-Z]\w*/.test(trimmed) && /\/>|<\//.test(trimmed)) {
    return 'tsx';
  }

  return null;
}

// Check if content is multi-line and likely code
function shouldRenderAsCode(content: string): boolean {
  const lines = content.split('\n');
  if (lines.length < 2) return false;

  // Don't highlight if it looks like natural language
  const hasCodeIndicators = /[{}[\]();=<>]|^\s{2,}|\t/m.test(content);
  const hasSentenceEndings = /[.!?]\s*$/m.test(content);
  const hasMarkdownFormatting = /^#{1,6}\s|^\*{1,2}\s|^-\s|^\d+\.|```|^\|.*\|/m.test(content);

  return hasCodeIndicators && !hasSentenceEndings && !hasMarkdownFormatting;
}

// Format diff content for better display
function formatDiffContent(content: string): string {
  // Ensure diff lines have proper prefixes
  return content.split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return line;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      return line;
    } else if (line.startsWith('@@ ')) {
      return line;
    }
    return line;
  }).join('\n');
}

export function MessageContent({ content, role, className }: MessageContentProps) {
  // Always use dark theme for code blocks for consistency
  const codeTheme = oneDark;

  // For multi-line content that looks like code, use syntax highlighting
  if (shouldRenderAsCode(content)) {
    const language = detectCodeLanguage(content) || 'plaintext';
    const displayContent = language === 'diff' ? formatDiffContent(content) : content.trim();

    return (
      <div className={cn('overflow-x-auto rounded-md', className)}>
        <SyntaxHighlighter
          language={language}
          style={codeTheme as any}
          customStyle={{
            margin: 0,
            padding: '1rem',
            fontSize: '0.875rem',
            lineHeight: '1.5',
            borderRadius: '0.375rem',
          }}
          showLineNumbers={language !== 'diff'}
          wrapLines={true}
          wrapLongLines={true}
        >
          {displayContent}
        </SyntaxHighlighter>
      </div>
    );
  }

  // For regular content or markdown, use ReactMarkdown
  return (
    <div className={cn(
      'prose prose-sm max-w-none overflow-x-auto',
      // Improve prose styling for lists and bold text
      'prose-li:my-1 prose-ol:my-2 prose-ul:my-2',
      'prose-strong:font-bold prose-strong:text-foreground dark:prose-strong:text-foreground',
      'prose-li:marker:text-foreground dark:prose-li:marker:text-foreground',
      role === 'user' ? 'prose-invert' : role === 'system' ? 'prose-muted dark:prose-invert' : 'dark:prose-invert',
      className
    )}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // Custom code block rendering
          code({ className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const inline = !className || !match;

            // For inline code
            if (inline) {
              return (
                <code className="bg-gray-200 dark:bg-gray-800 px-1 py-0.5 rounded text-sm" {...props}>
                  {children}
                </code>
              );
            }

            // For code blocks
            if (language) {
              const codeString = String(children).replace(/\n$/, '');
              const isDiff = language === 'diff';
              const displayContent = isDiff ? formatDiffContent(codeString) : codeString;

              return (
                <div className="rounded-md overflow-hidden my-2">
                  <SyntaxHighlighter
                    language={language}
                    style={codeTheme as any}
                    customStyle={{
                      margin: 0,
                      padding: '1rem',
                      fontSize: '0.875rem',
                      borderRadius: '0.375rem',
                    }}
                    showLineNumbers={!isDiff}
                    wrapLines={true}
                    wrapLongLines={true}
                  >
                    {displayContent}
                  </SyntaxHighlighter>
                </div>
              );
            }

            // Fallback for code blocks without language
            return (
              <pre className="bg-gray-100 dark:bg-gray-900 p-4 rounded-md overflow-x-auto">
                <code className="text-sm" {...props}>
                  {children}
                </code>
              </pre>
            );
          },
          // Override pre to prevent double wrapping
          pre({ children, ...props }) {
            // If the child is our SyntaxHighlighter, just return children
            if (children && typeof children === 'object' && 'props' in children && children.props?.className?.includes('language-')) {
              return <>{children}</>;
            }
            return <pre {...props}>{children}</pre>;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}