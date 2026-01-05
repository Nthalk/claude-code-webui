import { useState, useCallback, useMemo } from 'react';
import {
  Shield,
  ShieldCheck,
  ShieldX,
  ChevronDown,
  ChevronRight,
  FileText,
  Terminal,
  Globe,
  FolderSearch,
  Search,
  Edit3,
  Wrench,
  AlertTriangle,
} from 'lucide-react';
import type { PendingPermission, PermissionAction } from '@claude-code-webui/shared';

// Tools that operate on files and should use glob patterns
const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob'];

// Tools that use prefix matching with :*
const PREFIX_TOOLS = ['Bash'];

// Validate pattern syntax and return error if invalid
interface PatternValidationError {
  message: string;
  suggestion: string;
}

function validatePatternSyntax(pattern: string): PatternValidationError | null {
  // Parse pattern: Tool(content)
  const match = pattern.match(/^(\w+)\((.*)\)$/);
  if (!match) {
    // Simple pattern like "Bash" - valid for any tool
    return null;
  }

  const patternTool = match[1];
  const patternContent = match[2];

  if (!patternTool) {
    return null;
  }

  // Check for :* syntax on file tools (should use glob instead)
  if (FILE_TOOLS.includes(patternTool) && patternContent && patternContent.endsWith(':*')) {
    const basePattern = patternContent.slice(0, -2);
    return {
      message: `The ":*" syntax is only for Bash prefix rules. Use glob patterns like "*" or "**" for file matching.`,
      suggestion: `${patternTool}(${basePattern}**)`,
    };
  }

  // Check for plain * syntax on Bash (should use :* for prefix matching)
  if (PREFIX_TOOLS.includes(patternTool) && patternContent) {
    // Check if using just * without : prefix
    if (patternContent.endsWith('*') && !patternContent.endsWith(':*')) {
      const basePattern = patternContent.slice(0, -1);
      return {
        message: `Use ":*" for prefix matching, not just "*".`,
        suggestion: `${patternTool}(${basePattern}:*)`,
      };
    }
  }

  return null;
}

interface PermissionApprovalDialogProps {
  permission: PendingPermission;
  onRespond: (action: PermissionAction, pattern?: string) => void;
}

// Get icon for tool name
function getToolIcon(toolName: string) {
  const iconMap: Record<string, typeof Wrench> = {
    Bash: Terminal,
    Read: Search,
    Write: FileText,
    Edit: Edit3,
    Glob: FolderSearch,
    Grep: Search,
    WebFetch: Globe,
    WebSearch: Globe,
  };
  return iconMap[toolName] || Wrench;
}

// Extract command or file path for display
function getToolPreview(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const inputObj = input as Record<string, unknown>;

  switch (toolName) {
    case 'Bash':
      return String(inputObj.command || '');
    case 'Read':
    case 'Write':
    case 'Edit':
      return String(inputObj.file_path || '');
    case 'Glob':
    case 'Grep':
      return String(inputObj.pattern || '');
    case 'WebFetch':
      return String(inputObj.url || '');
    case 'WebSearch':
      return String(inputObj.query || '');
    default:
      return JSON.stringify(input).substring(0, 100);
  }
}

// Convert glob pattern to regex for file matching
function globToRegex(glob: string): RegExp {
  let regex = glob
    // Escape special regex chars except * and ?
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // ** matches any path (including /)
    .replace(/\*\*/g, '.*')
    // * matches anything except / (but not if preceded by another *)
    .replace(/(?<!\.)(\*)(?!\*)/g, '[^/]*')
    // ? matches single char
    .replace(/\?/g, '.');

  return new RegExp(`^${regex}$`);
}

// Test if a pattern matches a given test string
function testPattern(pattern: string, testString: string): boolean {
  // Extract the pattern content (between parentheses)
  const match = pattern.match(/^(\w+)\((.*)\)$/);
  if (!match) return false;

  const patternTool = match[1];
  const patternContent = match[2];

  if (!patternTool) return false;
  if (!patternContent && patternContent !== '') return true; // Empty content matches all
  if (patternContent === '') return true;

  // For Bash and other prefix tools, use :* prefix matching
  if (PREFIX_TOOLS.includes(patternTool) && patternContent.endsWith(':*')) {
    const prefix = patternContent.slice(0, -2);
    if (!prefix) return true;
    return testString.startsWith(prefix);
  }

  // For file tools, use glob matching
  if (FILE_TOOLS.includes(patternTool)) {
    if (patternContent.includes('*') || patternContent.includes('?')) {
      const regex = globToRegex(patternContent);
      return regex.test(testString);
    }
    // Exact match fallback
    return testString === patternContent;
  }

  // Default: prefix matching with :*
  if (patternContent.endsWith(':*')) {
    const prefix = patternContent.slice(0, -2);
    if (!prefix) return true;
    return testString.startsWith(prefix);
  }

  // Exact match
  return testString === patternContent;
}

export function PermissionApprovalDialog({ permission, onRespond }: PermissionApprovalDialogProps) {
  const [showPatternEditor, setShowPatternEditor] = useState(false);
  const [pattern, setPattern] = useState(permission.suggestedPattern);
  const [testValue, setTestValue] = useState(getToolPreview(permission.toolName, permission.toolInput));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const Icon = getToolIcon(permission.toolName);
  const preview = getToolPreview(permission.toolName, permission.toolInput);
  const testResult = testPattern(pattern, testValue);
  const validationError = useMemo(() => validatePatternSyntax(pattern), [pattern]);

  // Get help text based on tool type
  const helpText = useMemo(() => {
    if (FILE_TOOLS.includes(permission.toolName)) {
      return (
        <>
          Use glob patterns: <code>*</code> matches any filename, <code>**</code> matches any path
          (e.g., <code>/src/**</code> matches all files in src)
        </>
      );
    }
    return (
      <>
        Use <code>:*</code> suffix for prefix matching (e.g., <code>git:*</code> matches all git
        commands)
      </>
    );
  }, [permission.toolName]);

  const handleRespond = useCallback(
    async (action: PermissionAction) => {
      setIsSubmitting(true);
      try {
        // For allow_project and allow_global, include the pattern
        if (action === 'allow_project' || action === 'allow_global') {
          await onRespond(action, pattern);
        } else {
          await onRespond(action);
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [onRespond, pattern]
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background border border-border rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 rounded-lg">
            <Shield className="h-6 w-6 text-amber-500" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">Permission Required</h2>
            <p className="text-sm text-muted-foreground">
              Claude wants to use the {permission.toolName} tool
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Tool info */}
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Icon className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{permission.toolName}</span>
            </div>
            {preview && (
              <code className="block text-sm bg-muted/50 p-2 rounded font-mono break-all">
                {preview.length > 200 ? preview.substring(0, 200) + '...' : preview}
              </code>
            )}
            {permission.description && permission.description !== `${permission.toolName} tool` && (
              <p className="text-sm text-muted-foreground mt-2">{permission.description}</p>
            )}
          </div>

          {/* Pattern editor (collapsible) */}
          <div className="border border-border rounded-lg">
            <button
              className="w-full p-3 flex items-center gap-2 text-sm font-medium hover:bg-muted/30 transition-colors"
              onClick={() => setShowPatternEditor(!showPatternEditor)}
            >
              {showPatternEditor ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              Edit Permission Pattern
            </button>

            {showPatternEditor && (
              <div className="p-3 pt-0 space-y-3 border-t border-border">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Pattern</label>
                  <input
                    type="text"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    className={`w-full p-2 bg-muted/30 border rounded text-sm font-mono ${
                      validationError ? 'border-amber-500' : 'border-border'
                    }`}
                    placeholder={
                      FILE_TOOLS.includes(permission.toolName)
                        ? 'e.g., Read(/src/**)'
                        : 'e.g., Bash(git checkout:*)'
                    }
                  />
                  <p className="text-xs text-muted-foreground mt-1">{helpText}</p>

                  {validationError && (
                    <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded">
                      <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                        <div>
                          <p>{validationError.message}</p>
                          <button
                            type="button"
                            className="mt-1 text-amber-700 dark:text-amber-300 underline hover:no-underline"
                            onClick={() => setPattern(validationError.suggestion)}
                          >
                            Use suggested: <code>{validationError.suggestion}</code>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Test Pattern</label>
                  <input
                    type="text"
                    value={testValue}
                    onChange={(e) => setTestValue(e.target.value)}
                    className="w-full p-2 bg-muted/30 border border-border rounded text-sm font-mono"
                    placeholder="Enter a value to test"
                  />
                  <div
                    className={`mt-1 text-xs flex items-center gap-1 ${testResult ? 'text-green-500' : 'text-red-500'}`}
                  >
                    {testResult ? (
                      <>
                        <ShieldCheck className="h-3 w-3" />
                        Pattern matches
                      </>
                    ) : (
                      <>
                        <ShieldX className="h-3 w-3" />
                        Pattern does not match
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-border space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleRespond('allow_once')}
              disabled={isSubmitting}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
            >
              <ShieldCheck className="h-4 w-4" />
              Allow Once
            </button>
            <button
              onClick={() => handleRespond('deny')}
              disabled={isSubmitting}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors"
            >
              <ShieldX className="h-4 w-4" />
              Deny
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleRespond('allow_project')}
              disabled={isSubmitting}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors text-sm"
            >
              <ShieldCheck className="h-4 w-4" />
              Allow for Project
            </button>
            <button
              onClick={() => handleRespond('allow_global')}
              disabled={isSubmitting}
              className="flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium disabled:opacity-50 transition-colors text-sm"
            >
              <ShieldCheck className="h-4 w-4" />
              Allow Globally
            </button>
          </div>
          <p className="text-xs text-center text-muted-foreground">
            Project saves to <code>.claude/settings.local.json</code>, Global saves to{' '}
            <code>~/.claude/settings.json</code>
          </p>
        </div>
      </div>
    </div>
  );
}
