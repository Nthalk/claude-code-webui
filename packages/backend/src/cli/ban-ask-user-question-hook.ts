#!/usr/bin/env node
/**
 * PreToolUse Hook to Ban AskUserQuestion
 *
 * This hook denies the AskUserQuestion tool and instructs Claude
 * to use the mcp__webui__ask_user MCP tool instead.
 *
 * Input (stdin JSON from Claude Code hook):
 * {
 *   "hook_event_name": "PreToolUse",
 *   "tool_name": "AskUserQuestion",
 *   "tool_input": { ... },
 *   ...
 * }
 *
 * Output (stdout JSON):
 * {
 *   "hookSpecificOutput": {
 *     "hookEventName": "PreToolUse",
 *     "permissionDecision": "deny",
 *     "permissionDecisionReason": "..."
 *   }
 * }
 */

import * as readline from 'readline';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Log to stderr so it doesn't interfere with stdout JSON output
function log(message: string): void {
  process.stderr.write(`[BAN-ASK-USER] ${message}\n`);
}

interface HookInput {
  hook_event_name: string;
  tool_name: string;
  tool_input: unknown;
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

// Output the deny decision
function outputDeny(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  log(`Denying with reason: ${reason}`);
  console.log(JSON.stringify(output));
}

async function main(): Promise<void> {
  try {
    const stdinData = await readStdin();

    if (!stdinData.trim()) {
      // No input - output empty object to allow (shouldn't happen)
      console.log('{}');
      return;
    }

    let hookInput: HookInput;
    try {
      hookInput = JSON.parse(stdinData) as HookInput;
    } catch {
      // Invalid JSON - allow (shouldn't happen)
      console.log('{}');
      return;
    }

    const { tool_name: toolName } = hookInput;

    // Only handle AskUserQuestion
    if (toolName === 'AskUserQuestion') {
      outputDeny(
        'AskUserQuestion is not available in WebUI mode. Use the mcp__webui__ask_user tool instead to ask the user questions. It has the same interface.'
      );
      return;
    }

    // For any other tool (shouldn't happen due to matcher), allow
    console.log('{}');
  } catch (err) {
    // On any error, allow (don't block unrelated tools)
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
    process.stderr.write(`[BAN-ASK-USER] Uncaught error: ${err}\n`);
    console.log('{}');
    process.exit(0);
  });
}
