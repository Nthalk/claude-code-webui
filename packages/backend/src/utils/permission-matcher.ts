/**
 * Permission pattern matching utilities extracted from webui-server.ts
 * to be shared between SDK and non-SDK modes
 */

// Define the interface locally since it's not exported from claude-settings.ts
interface ClaudeSettings {
  permissions?: {
    allow?: string[];
    deny?: string[];
  };
  [key: string]: unknown;
}

// Tools that operate on files and should use glob patterns
const FILE_TOOLS = ['Read', 'Write', 'Edit', 'Glob'];

// Tools that use prefix matching with :*
const PREFIX_TOOLS = ['Bash'];

export interface MatchResult {
  matched: boolean;
  pattern?: string;
  type?: 'allow' | 'deny';
}

export class PermissionMatcher {
  /**
   * Get the value to match against for a given tool
   */
  static getMatchValue(toolName: string, toolInput: unknown): string {
    if (!toolInput || typeof toolInput !== 'object') {
      return '';
    }

    const inputObj = toolInput as Record<string, unknown>;

    switch (toolName) {
      case 'Bash':
        return String(inputObj.command || '');
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'Glob':
        return String(inputObj.file_path || inputObj.pattern || '');
      case 'Grep':
        return String(inputObj.pattern || '');
      case 'WebFetch':
        return String(inputObj.url || '');
      case 'WebSearch':
        return String(inputObj.query || '');
      default:
        return '';
    }
  }

  /**
   * Convert glob pattern to regex for file matching
   */
  static globToRegex(glob: string): RegExp {
    let regex = glob
      // Escape special regex chars except * and ?
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      // ** matches any path (including /)
      .replace(/\*\*/g, '.*')
      // * matches anything except /
      .replace(/(?<!\.)(\*)(?!\*)/g, '[^/]*')
      // ? matches single char
      .replace(/\?/g, '.');

    return new RegExp(`^${regex}$`);
  }

  /**
   * Check if a tool invocation matches a pattern
   */
  static matchesPattern(pattern: string, toolName: string, toolInput: unknown): boolean {
    // Parse pattern: Tool(content)
    const match = pattern.match(/^(\w+)\((.*)\)$/);
    if (!match) {
      // Simple pattern like "Bash" matches all Bash calls
      return pattern === toolName;
    }

    const [, patternTool, patternContent] = match;

    // Tool name must match
    if (patternTool !== toolName) {
      return false;
    }

    // Empty content matches everything for this tool
    if (!patternContent) {
      return true;
    }

    // Get the value to match against
    const matchValue = this.getMatchValue(toolName, toolInput);

    // For Bash and other prefix tools, use :* prefix matching
    if (PREFIX_TOOLS.includes(toolName) && patternContent.endsWith(':*')) {
      const prefix = patternContent.slice(0, -2);
      if (!prefix) {
        return true; // :* alone matches everything
      }
      return matchValue.startsWith(prefix);
    }

    // For file tools, use glob matching
    if (FILE_TOOLS.includes(toolName)) {
      // Check if it contains glob wildcards
      if (patternContent.includes('*') || patternContent.includes('?')) {
        const regex = this.globToRegex(patternContent);
        return regex.test(matchValue);
      }
      // Exact match fallback
      return matchValue === patternContent;
    }

    // Default: prefix matching with :*
    if (patternContent.endsWith(':*')) {
      const prefix = patternContent.slice(0, -2);
      if (!prefix) {
        return true;
      }
      return matchValue.startsWith(prefix);
    }

    // Exact match
    return matchValue === patternContent;
  }

  /**
   * Check if tool is approved/denied by any pattern
   */
  static checkPatterns(
    toolName: string,
    toolInput: unknown,
    allowPatterns: string[],
    denyPatterns: string[]
  ): MatchResult {
    // Check deny patterns first (they take precedence)
    for (const pattern of denyPatterns) {
      if (this.matchesPattern(pattern, toolName, toolInput)) {
        return { matched: true, pattern, type: 'deny' };
      }
    }

    // Then check allow patterns
    for (const pattern of allowPatterns) {
      if (this.matchesPattern(pattern, toolName, toolInput)) {
        return { matched: true, pattern, type: 'allow' };
      }
    }

    return { matched: false };
  }

  /**
   * Load all permission patterns from settings
   */
  static loadPatterns(settings: (ClaudeSettings | null)[]): {
    allow: string[];
    deny: string[];
  } {
    const allow: string[] = [];
    const deny: string[] = [];

    for (const setting of settings) {
      if (setting?.permissions?.allow) {
        allow.push(...setting.permissions.allow);
      }
      if (setting?.permissions?.deny) {
        deny.push(...setting.permissions.deny);
      }
    }

    return { allow, deny };
  }
}