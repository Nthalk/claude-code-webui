/**
 * Claude Code Hooks Configuration
 *
 * This module provides hook configuration for Claude Code sessions.
 * Hooks are used to:
 * 1. Ban AskUserQuestion and redirect to MCP tool
 */

import path from 'path';
import fsSync from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Find the path to a CLI script, checking both dev and prod locations.
 */
function findCliScript(scriptName: string): string {
  // In dev (tsx): __dirname = packages/backend/src/services/claude
  // CLI scripts are at: packages/backend/src/cli/
  const devPath = path.resolve(__dirname, '../../cli', scriptName);
  if (fsSync.existsSync(devPath)) {
    return devPath;
  }

  // If running from dist, the script is in src (parallel to dist)
  const prodPath = path.resolve(__dirname, '../../../src/cli', scriptName);
  if (fsSync.existsSync(prodPath)) {
    return prodPath;
  }

  // Fallback to dev path (will error at runtime if missing)
  console.warn(`[HOOKS] Could not find ${scriptName}, tried: ${devPath}, ${prodPath}`);
  return devPath;
}

/**
 * Get the path to the ban-ask-user-question hook script.
 */
function getBanAskUserQuestionHookPath(): string {
  return findCliScript('ban-ask-user-question-hook.ts');
}

/**
 * Get the path to the gate-exit-plan-mode hook script.
 */
function getGateExitPlanModeHookPath(): string {
  return findCliScript('gate-exit-plan-mode-hook.ts');
}

/**
 * Generate the hooks settings JSON for Claude Code.
 *
 * This includes:
 * - PreToolUse hook for AskUserQuestion to ban it and redirect to MCP
 * - PreToolUse hook for ExitPlanMode to gate approval until user confirms
 */
export function getHookJson(): string {
  const banAskUserPath = getBanAskUserQuestionHookPath();
  const gateExitPlanPath = getGateExitPlanModeHookPath();

  console.log(`[HOOKS] Using ban-ask-user-question hook: ${banAskUserPath}`);
  console.log(`[HOOKS] Using gate-exit-plan-mode hook: ${gateExitPlanPath}`);

  const settings = {
    hooks: {
      PreToolUse: [
        // Ban AskUserQuestion - must use MCP tool instead
        {
          matcher: 'AskUserQuestion',
          hooks: [
            {
              type: 'command',
              command: `npx tsx ${banAskUserPath}`,
            },
          ],
        },
        // Gate ExitPlanMode - wait for user approval
        {
          matcher: 'ExitPlanMode',
          hooks: [
            {
              type: 'command',
              command: `npx tsx ${gateExitPlanPath}`,
            },
          ],
        },
      ],
    },
  };

  return JSON.stringify(settings);
}
