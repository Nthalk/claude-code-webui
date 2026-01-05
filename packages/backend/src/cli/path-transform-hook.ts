#!/usr/bin/env node
/**
 * PreToolUse Hook for Path Transformation
 *
 * Transforms absolute paths to relative paths for file operations
 * when the path is under the working directory.
 *
 * Environment variables:
 * - WEBUI_PROJECT_PATH: The project working directory
 */

import * as readline from 'readline';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Log to stderr so it doesn't interfere with stdout JSON output
function log(message: string): void {
  process.stderr.write(`[PATH-HOOK] ${message}\n`);
}

// Tools that have file paths we want to transform
const FILE_PATH_TOOLS: Record<string, string[]> = {
  Read: ['file_path'],
  Write: ['file_path'],
  Edit: ['file_path'],
  Glob: ['path'],
  Grep: ['path'],
  NotebookEdit: ['notebook_path'],
};

// Types for hook input
interface HookInput {
  hook_event_name: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

interface HookOutput {
  hookSpecificOutput?: {
    hookEventName: string;
    updatedInput?: Record<string, unknown>;
  };
}

// Read all input from stdin
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    let data = '';
    rl.on('line', (line) => {
      data += line;
    });
    rl.on('close', () => {
      resolve(data);
    });
    rl.on('error', reject);

    process.stdin.on('end', () => {
      rl.close();
    });
  });
}

// Transform absolute path to relative if under project directory
function transformPath(absolutePath: string, projectPath: string): string {
  if (!absolutePath || !projectPath) {
    return absolutePath;
  }

  // Normalize paths for comparison
  const normalizedAbsolute = path.normalize(absolutePath);
  const normalizedProject = path.normalize(projectPath);

  // Check if the path is under the project directory
  if (normalizedAbsolute.startsWith(normalizedProject)) {
    const relativePath = path.relative(normalizedProject, normalizedAbsolute);
    // Don't return empty string for the project root itself
    if (relativePath === '') {
      return '.';
    }
    // Ensure we don't go outside with ..
    if (!relativePath.startsWith('..')) {
      log(`Transformed: ${absolutePath} -> ${relativePath}`);
      return relativePath;
    }
  }

  // Return original if not under project or if it would go outside
  return absolutePath;
}

async function main(): Promise<void> {
  const projectPath = process.env.WEBUI_PROJECT_PATH || process.cwd();

  try {
    const stdinData = await readStdin();

    if (!stdinData.trim()) {
      // No input - output empty object to allow
      console.log('{}');
      return;
    }

    let hookInput: HookInput;
    try {
      hookInput = JSON.parse(stdinData) as HookInput;
    } catch {
      // Invalid JSON - output empty object to allow
      console.log('{}');
      return;
    }

    const { tool_name: toolName, tool_input: toolInput } = hookInput;

    // Check if this tool has paths we should transform
    const pathFields = FILE_PATH_TOOLS[toolName];
    if (!pathFields || !toolInput) {
      // Not a file tool or no input - output empty object to allow
      console.log('{}');
      return;
    }

    // Check if any paths need transformation
    let needsUpdate = false;
    const updatedInput = { ...toolInput };

    for (const field of pathFields) {
      const value = toolInput[field];
      if (typeof value === 'string' && path.isAbsolute(value)) {
        const transformed = transformPath(value, projectPath);
        if (transformed !== value) {
          updatedInput[field] = transformed;
          needsUpdate = true;
        }
      }
    }

    if (needsUpdate) {
      const output: HookOutput = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          updatedInput,
        },
      };
      log(`Output: ${JSON.stringify(output)}`);
      console.log(JSON.stringify(output));
    } else {
      // No changes needed - output empty object to allow
      console.log('{}');
    }
  } catch (err) {
    // On any error, output empty object to allow (don't block)
    log(`Error: ${err}`);
    console.log('{}');
  }
}

// Only run main() when executed directly as a script
const currentFile = fileURLToPath(import.meta.url);
const entryPoint = process.argv[1] ? path.resolve(process.argv[1]) : '';
const isMainModule = currentFile === entryPoint;

if (isMainModule) {
  main().catch((err) => {
    process.stderr.write(`[PATH-HOOK] Uncaught error: ${err}\n`);
    console.log('{}');
    process.exit(0);
  });
}
