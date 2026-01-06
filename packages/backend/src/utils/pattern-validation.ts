/**
 * Pattern Validation Utilities
 *
 * Validates permission pattern syntax for Claude Code settings.
 *
 * Pattern format:
 * - Bash: Use :* for prefix matching (e.g., "Bash(git:*)")
 * - File tools (Read, Write, Edit, Glob): Use glob patterns (e.g., "Read(/src/**)")
 */

// Tools that operate on files and should use glob patterns
const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob'];

// Tools that use prefix matching with :*
const PREFIX_TOOLS = ['Bash'];

/**
 * Pattern validation error details
 */
export interface PatternValidationError {
  pattern: string;
  toolName: string;
  message: string;
  suggestion: string;
}

/**
 * Validate pattern syntax and return error if invalid.
 * Returns null if the pattern is valid.
 */
export function validatePatternSyntax(pattern: string): PatternValidationError | null {
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
      pattern,
      toolName: patternTool,
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
        pattern,
        toolName: patternTool,
        message: `Use ":*" for prefix matching, not just "*".`,
        suggestion: `${patternTool}(${basePattern}:*)`,
      };
    }
  }

  return null;
}
