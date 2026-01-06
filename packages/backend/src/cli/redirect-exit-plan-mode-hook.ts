#!/usr/bin/env node
/**
 * Redirect ExitPlanMode to MCP confirm_plan tool
 *
 * This PreToolUse hook intercepts ExitPlanMode and implements a two-step approval process:
 *
 * 1. First attempt: Denies and instructs Claude to use mcp__webui__confirm_plan
 * 2. After approval: Checks for temp file and allows ExitPlanMode
 *
 * This avoids the 5-second PreToolUse timeout limitation by immediately responding
 * with a deny decision, then handling the actual approval through the MCP tool
 * which has no timeout constraints.
 *
 * Cross-process communication is handled via temp files since the hook and MCP
 * server run in separate processes.
 */

import * as readline from 'readline';
import * as fs from 'fs';

interface HookInput {
  hook_event_name: string;
  tool_name: string;
  tool_input: unknown;
  session_id?: string;
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

// Output the deny decision with redirect message
function outputDeny(reason: string): void {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
  console.log(JSON.stringify(output));
}

// Simple logging to stderr
function log(message: string): void {
  process.stderr.write(`[redirect-exit-plan-mode-hook] ${message}\n`);
}

async function main(): Promise<void> {
  try {
    const stdinData = await readStdin();

    if (!stdinData.trim()) {
      // No input - allow by default
      console.log('{}');
      return;
    }

    let hookInput: HookInput;
    try {
      hookInput = JSON.parse(stdinData);
    } catch (err) {
      log(`Failed to parse input: ${err}`);
      console.log('{}');
      return;
    }

    const { tool_name: toolName } = hookInput;

    // Only handle ExitPlanMode
    if (toolName === 'ExitPlanMode') {
      log('Intercepting ExitPlanMode - redirecting to MCP confirm_plan');

      // Check if we have a stored approval for this session via temp file
      // (temp file is written by MCP server, which runs in a different process)
      const sessionId = process.env.WEBUI_SESSION_ID;
      if (sessionId) {
        const approvalFile = `/tmp/claude-plan-approved-${sessionId}`;
        try {
          await fs.promises.access(approvalFile);
          // Approval file exists - allow exit and clean up
          log('Plan already approved for this session - allowing exit');
          await fs.promises.unlink(approvalFile);
          log(`Deleted approval file: ${approvalFile}`);
          console.log('{}');
          return;
        } catch {
          // File doesn't exist - need approval
          log('No approval file found - redirecting to confirm_plan');
        }
      }

      // Redirect to MCP tool
      outputDeny(
        'Plan approval required before exiting plan mode. Please use the mcp__webui__confirm_plan tool to request user approval for your plan. Once approved, you can call ExitPlanMode again.'
      );
      return;
    }

    // Allow all other tools
    console.log('{}');
  } catch (err) {
    log(`Error: ${err}`);
    console.log('{}');
    process.exit(1);
  }
}

main().catch((err) => {
  log(`Uncaught error: ${err}`);
  console.log('{}');
  process.exit(1);
});