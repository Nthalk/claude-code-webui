#!/usr/bin/env node
/**
 * PreToolUse Hook to Gate ExitPlanMode
 *
 * This hook intercepts the ExitPlanMode tool and waits for user approval
 * before allowing Claude to exit plan mode. It's a long-running process
 * that uses HTTP long-polling to defer the result until the user responds.
 *
 * Input (stdin JSON from Claude Code hook):
 * {
 *   "hook_event_name": "PreToolUse",
 *   "tool_name": "ExitPlanMode",
 *   "tool_input": { ... },
 *   "session_id": "session-uuid",
 *   ...
 * }
 *
 * Output (stdout JSON):
 * - On approval: {} (empty object allows the tool)
 * - On denial: {
 *     "hookSpecificOutput": {
 *       "hookEventName": "PreToolUse",
 *       "permissionDecision": "deny",
 *       "permissionDecisionReason": "..."
 *     }
 *   }
 */

import * as readline from 'readline';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

// Get the backend URL from environment, default to localhost:3001
const BACKEND_URL = process.env.WEBUI_BACKEND_URL || 'http://localhost:3001';

// Log to stderr so it doesn't interfere with stdout JSON output
function log(message: string): void {
  process.stderr.write(`[GATE-EXIT-PLAN] ${message}\n`);
}

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

// Output the allow decision
function outputAllow(): void {
  console.log('{}');
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

    // Only handle ExitPlanMode
    if (toolName === 'ExitPlanMode') {
      // Use the WebUI session ID from environment, not the Claude session ID
      const sessionId = process.env.WEBUI_SESSION_ID;

      if (!sessionId) {
        outputDeny('No WebUI session ID found. Cannot request plan approval.');
        return;
      }

      log(`Intercepting ExitPlanMode for session ${sessionId}`);

      const requestId = uuidv4();

      try {
        // Step 1: Submit approval request to backend
        const submitResponse = await fetch(`${BACKEND_URL}/api/plan/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            requestId,
          }),
        });

        if (!submitResponse.ok) {
          log(`Failed to submit approval request: ${submitResponse.status}`);
          outputDeny('Failed to request plan approval from WebUI.');
          return;
        }

        log(`Approval request ${requestId} submitted, waiting for user response...`);

        // Step 2: Long-poll for response
        const pollResponse = await fetch(
          `${BACKEND_URL}/api/plan/response/${requestId}`,
          {
            method: 'GET',
            // No timeout on fetch - the server handles the timeout
          }
        );

        if (!pollResponse.ok) {
          log(`Failed to get approval response: ${pollResponse.status}`);
          outputDeny('Failed to get plan approval response.');
          return;
        }

        const result = await pollResponse.json() as { approved: boolean; reason?: string; error?: string };

        if (result.approved) {
          log('Exit plan mode approved by user');
          outputAllow();
        } else {
          const reason = result.reason || 'User denied the plan. Please revise based on their feedback.';
          log(`Exit plan mode denied: ${reason}`);
          outputDeny(reason);
        }
      } catch (err) {
        log(`Error during approval process: ${err}`);
        outputDeny('Error communicating with WebUI for plan approval.');
      }

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
    process.stderr.write(`[GATE-EXIT-PLAN] Uncaught error: ${err}\n`);
    console.log('{}');
    process.exit(0);
  });
}