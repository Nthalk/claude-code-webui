import { useState, useCallback } from 'react';
import {
  FileText,
  Search,
  Edit3,
  Terminal,
  Globe,
  FolderSearch,
  GitBranch,
  CheckSquare,
  Cpu,
  Wrench,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Loader2,
  Copy,
  Check,
} from 'lucide-react';
import type { ToolExecution } from '@claude-code-webui/shared';

interface ToolExecutionCardProps {
  execution: ToolExecution;
}

// Smart path truncation: /first-dir/.../parent-dir/.../filename
// Shows first dir, ..., one parent dir near file, ..., filename
const truncatePath = (path: string, maxLength: number = 45): string => {
  if (path.length <= maxLength) return path;

  const hasLeadingSlash = path.startsWith('/');
  const parts = path.split('/').filter(p => p !== '');

  if (parts.length <= 3) {
    // Short path - just truncate from end
    return '...' + path.slice(-(maxLength - 3));
  }

  const firstDir = parts[0] || '';
  const parentDir = parts[parts.length - 2] || '';
  const fileName = parts[parts.length - 1] || '';

  if (!firstDir || !fileName) {
    return '...' + path.slice(-(maxLength - 3));
  }

  // Format: /firstDir/.../parentDir/.../fileName
  const prefix = hasLeadingSlash ? '/' : '';
  const truncated = `${prefix}${firstDir}/.../` + (parentDir ? `${parentDir}/.../` : '') + fileName;

  if (truncated.length <= maxLength) {
    return truncated;
  }

  // Too long even with parent - skip parent dir
  const shortTruncated = `${prefix}${firstDir}/.../` + fileName;
  if (shortTruncated.length <= maxLength) {
    return shortTruncated;
  }

  // Still too long - just show end
  return '...' + path.slice(-(maxLength - 3));
};

// Map tool names to icons and labels
const getToolDisplay = (toolName: string): { icon: typeof Wrench; label: string; inputLabel: string } => {
  const toolMap: Record<string, { icon: typeof Wrench; label: string; inputLabel: string }> = {
    'Write': { icon: FileText, label: 'Write', inputLabel: 'File' },
    'Read': { icon: Search, label: 'Read', inputLabel: 'File' },
    'Edit': { icon: Edit3, label: 'Edit', inputLabel: 'File' },
    'Bash': { icon: Terminal, label: 'Bash', inputLabel: 'Command' },
    'WebFetch': { icon: Globe, label: 'Fetch', inputLabel: 'URL' },
    'WebSearch': { icon: Globe, label: 'Search', inputLabel: 'Query' },
    'Glob': { icon: FolderSearch, label: 'Glob', inputLabel: 'Pattern' },
    'Grep': { icon: Search, label: 'Grep', inputLabel: 'Pattern' },
    'LS': { icon: FolderSearch, label: 'List', inputLabel: 'Path' },
    'Task': { icon: Cpu, label: 'Agent', inputLabel: 'Task' },
    'TodoWrite': { icon: CheckSquare, label: 'Todo', inputLabel: 'Tasks' },
    'Git': { icon: GitBranch, label: 'Git', inputLabel: 'Command' },
  };

  return toolMap[toolName] || { icon: Wrench, label: toolName, inputLabel: 'Input' };
};

// Extract description and command/detail for two-line preview
const getInputPreviewTwoLine = (toolName: string, input: unknown): { description: string; detail: string } => {
  if (!input) return { description: '', detail: '' };
  if (typeof input === 'string') return { description: '', detail: input };

  const inputObj = input as Record<string, unknown>;

  switch (toolName) {
    case 'Bash':
      return {
        description: String(inputObj.description || ''),
        detail: String(inputObj.command || ''),
      };
    case 'Read':
    case 'Write':
      return {
        description: '',
        detail: truncatePath(String(inputObj.file_path || ''), 45),
      };
    case 'Edit':
      return {
        description: '',
        detail: truncatePath(String(inputObj.file_path || ''), 45),
      };
    case 'Glob':
      return {
        description: '',
        detail: truncatePath(String(inputObj.pattern || ''), 45),
      };
    case 'Grep':
      return {
        description: '',
        detail: String(inputObj.pattern || ''),
      };
    case 'WebFetch':
      return {
        description: String(inputObj.prompt || ''),
        detail: String(inputObj.url || ''),
      };
    case 'WebSearch':
      return {
        description: '',
        detail: String(inputObj.query || ''),
      };
    case 'Task':
      return {
        description: String(inputObj.description || ''),
        detail: String(inputObj.subagent_type || ''),
      };
    default:
      return { description: '', detail: JSON.stringify(input).substring(0, 100) };
  }
};

// Format full input for expanded view
const formatInput = (toolName: string, input: unknown): { label: string; value: string }[] => {
  if (!input) return [];
  if (typeof input === 'string') return [{ label: 'Input', value: input }];

  const inputObj = input as Record<string, unknown>;
  const result: { label: string; value: string }[] = [];

  switch (toolName) {
    case 'Bash':
      if (inputObj.command) result.push({ label: 'Command', value: String(inputObj.command) });
      if (inputObj.description) result.push({ label: 'Description', value: String(inputObj.description) });
      if (inputObj.timeout) result.push({ label: 'Timeout', value: `${inputObj.timeout}ms` });
      break;
    case 'Read':
      if (inputObj.file_path) result.push({ label: 'File', value: String(inputObj.file_path) });
      if (inputObj.offset) result.push({ label: 'Offset', value: String(inputObj.offset) });
      if (inputObj.limit) result.push({ label: 'Limit', value: String(inputObj.limit) });
      break;
    case 'Write':
      if (inputObj.file_path) result.push({ label: 'File', value: String(inputObj.file_path) });
      if (inputObj.content) result.push({ label: 'Content', value: String(inputObj.content).substring(0, 500) + (String(inputObj.content).length > 500 ? '...' : '') });
      break;
    case 'Edit':
      if (inputObj.file_path) result.push({ label: 'File', value: String(inputObj.file_path) });
      if (inputObj.old_string) result.push({ label: 'Find', value: String(inputObj.old_string) });
      if (inputObj.new_string) result.push({ label: 'Replace', value: String(inputObj.new_string) });
      break;
    case 'Glob':
      if (inputObj.pattern) result.push({ label: 'Pattern', value: String(inputObj.pattern) });
      if (inputObj.path) result.push({ label: 'Path', value: String(inputObj.path) });
      break;
    case 'Grep':
      if (inputObj.pattern) result.push({ label: 'Pattern', value: String(inputObj.pattern) });
      if (inputObj.path) result.push({ label: 'Path', value: String(inputObj.path) });
      if (inputObj.glob) result.push({ label: 'Glob', value: String(inputObj.glob) });
      break;
    case 'WebFetch':
      if (inputObj.url) result.push({ label: 'URL', value: String(inputObj.url) });
      if (inputObj.prompt) result.push({ label: 'Prompt', value: String(inputObj.prompt) });
      break;
    case 'WebSearch':
      if (inputObj.query) result.push({ label: 'Query', value: String(inputObj.query) });
      break;
    case 'Task':
      if (inputObj.description) result.push({ label: 'Description', value: String(inputObj.description) });
      if (inputObj.prompt) result.push({ label: 'Prompt', value: String(inputObj.prompt) });
      if (inputObj.subagent_type) result.push({ label: 'Agent Type', value: String(inputObj.subagent_type) });
      break;
    default:
      result.push({ label: 'Input', value: JSON.stringify(input, null, 2) });
  }

  return result;
};

// Copy button component
const CopyButton = ({ text }: { text: string }) => {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleCopy = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }, [text]);

  const title = status === 'error'
    ? 'Copy requires HTTPS or localhost'
    : status === 'copied'
    ? 'Copied!'
    : 'Copy to clipboard';

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted transition-colors"
      title={title}
    >
      {status === 'copied' ? (
        <Check className="h-3 w-3 text-green-500" />
      ) : status === 'error' ? (
        <XCircle className="h-3 w-3 text-red-400" />
      ) : (
        <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
      )}
    </button>
  );
};

// Status icon component
const StatusIcon = ({ status }: { status: 'started' | 'completed' | 'error' }) => {
  switch (status) {
    case 'started':
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case 'error':
      return <XCircle className="h-4 w-4 text-red-500" />;
  }
};

export function ToolExecutionCard({ execution }: ToolExecutionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { icon: Icon, label } = getToolDisplay(execution.toolName);

  const hasInput = execution.input;
  const hasOutput = execution.result || execution.error;
  const isExpandable = hasInput || hasOutput;
  const isClickable = isExpandable && execution.status !== 'started';

  // Get two-line preview (description + detail)
  const { description, detail } = getInputPreviewTwoLine(execution.toolName, execution.input);
  const formattedInput = formatInput(execution.toolName, execution.input);

  return (
    <div className="flex flex-col gap-0.5 px-3 py-2 bg-muted/30 rounded-lg text-xs border border-border/50 overflow-hidden max-w-full min-w-0">
      {/* Header row - tool icon, label, and status */}
      <div
        className={`flex items-center gap-2 ${isClickable ? 'cursor-pointer hover:opacity-80' : ''}`}
        onClick={() => isClickable && setExpanded(!expanded)}
      >
        <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="font-medium text-foreground">{label}</span>
        {/* Description line - if available */}
        {description && (
          <span className="text-muted-foreground truncate flex-1 text-xs">
            {description}
          </span>
        )}
        {/* Spacer when no description */}
        {!description && <span className="flex-1" />}
        {isExpandable && (
          <>
            {expanded ? (
              <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
            )}
          </>
        )}
        <StatusIcon status={execution.status} />
      </div>
      {/* Detail line - command/path/pattern */}
      {detail && (
        <code className="text-muted-foreground truncate font-mono text-xs pl-6 block overflow-hidden text-ellipsis whitespace-nowrap">
          {detail}
        </code>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="mt-2 space-y-2 pl-6">
          {/* Input details */}
          {formattedInput.length > 0 && (
            <div className="space-y-1">
              {formattedInput.map((item, idx) => (
                <div key={idx} className="flex flex-col gap-0.5">
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wide">{item.label}</span>
                  <pre className="p-2 bg-muted/50 rounded text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all text-foreground font-mono">
                    {item.value}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {/* Output/Result */}
          {execution.result && (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground text-[10px] uppercase tracking-wide">Output</span>
                <CopyButton text={execution.result} />
              </div>
              <pre className="p-2 bg-muted/50 rounded text-xs overflow-auto max-h-60 whitespace-pre-wrap break-all text-foreground font-mono">
                {execution.result}
              </pre>
            </div>
          )}

          {/* Error */}
          {execution.error && (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1">
                <span className="text-red-400 text-[10px] uppercase tracking-wide">Error</span>
                <CopyButton text={execution.error} />
              </div>
              <pre className="p-2 bg-red-500/10 rounded text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all text-red-400 font-mono">
                {execution.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
