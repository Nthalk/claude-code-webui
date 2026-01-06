# Claude CLI Workarounds Documentation

This document explains the various workarounds implemented in the Claude Code WebUI to address limitations and integration challenges with the Claude CLI.

## Overview

The Claude CLI has certain limitations when running in a web-based environment:
1. Built-in tools like `AskUserQuestion` expect terminal-based interaction
2. Permission prompts are designed for CLI, not web UI
3. Some tools have timeout constraints that don't work well with user interactions
4. Cross-process communication is limited

We've implemented several workarounds using hooks and MCP (Model Context Protocol) to provide a seamless web experience.

## Architecture

```
Claude CLI Process
    ├── PreToolUse Hooks (intercept tool calls)
    │   ├── ban-ask-user-question-hook.ts
    │   ├── redirect-exit-plan-mode-hook.ts
    │   └── gate-exit-plan-mode-hook.ts (deprecated)
    │
    └── MCP Server (webui-server.ts)
        ├── ask_user (replaces AskUserQuestion)
        ├── permission_prompt (handles permissions)
        └── confirm_plan (handles plan approval)
```

## Workarounds

### 1. AskUserQuestion → MCP ask_user

**Problem**: The built-in `AskUserQuestion` tool expects terminal input, which doesn't work in a web environment.

**Solution**:
- `ban-ask-user-question-hook.ts` intercepts all `AskUserQuestion` calls
- Returns an error instructing Claude to use `mcp__webui__ask_user` instead
- The MCP tool communicates with the backend API to show questions in the web UI

**Implementation**:
```typescript
// Hook denies AskUserQuestion
if (toolName === 'AskUserQuestion') {
  outputDeny('Please use mcp__webui__ask_user instead');
}

// Claude then uses MCP tool
mcp__webui__ask_user({ questions: [...] })
```

### 2. Permission Prompts → MCP permission_prompt

**Problem**: Claude's permission system uses a CLI-based prompt that doesn't integrate with web UI.

**Solution**:
- Configured Claude to use `--permission-prompt-tool=mcp__webui__permission_prompt`
- The MCP tool handles permission requests through the web UI
- Supports pattern-based auto-approval from settings files

**Features**:
- Visual permission dialogs in the web UI
- Pattern-based auto-approval (e.g., `Read(**)`, `Bash(git:*)`)
- Persistent approval patterns saved to settings

### 3. ExitPlanMode → MCP confirm_plan (Two-Step Approval)

**Problem**: PreToolUse hooks have a 5-second timeout, which is too short for user approval flows.

**Solution**: Implemented a two-step approval process:
1. `redirect-exit-plan-mode-hook.ts` immediately denies `ExitPlanMode`
2. Instructs Claude to use `mcp__webui__confirm_plan` (no timeout)
3. On approval, writes a temp file as a cross-process flag
4. Subsequent `ExitPlanMode` calls check for the temp file and succeed

**Implementation**:
```typescript
// Step 1: Hook redirects
if (toolName === 'ExitPlanMode') {
  const approvalFile = `/tmp/claude-plan-approved-${sessionId}`;
  try {
    await fs.promises.access(approvalFile);
    // Approved - allow and clean up
    await fs.promises.unlink(approvalFile);
    console.log('{}'); // Allow
  } catch {
    // Not approved - redirect to MCP
    outputDeny('Use mcp__webui__confirm_plan first');
  }
}

// Step 2: MCP tool handles approval
// On approval, writes the temp file
await fs.promises.writeFile(approvalFile, Date.now().toString());
```

### 4. Cross-Process State with Temp Files

**Problem**: The MCP server and hooks run in separate processes and can't share memory.

**Solution**:
- Use filesystem as shared state via temp files
- Example: `/tmp/claude-plan-approved-${sessionId}`
- Files are cleaned up after use to prevent stale state

## Configuration

### Hooks Configuration (`hooks.ts`)

```typescript
export const hooks: HookMatcher[] = [
  {
    matcher: 'AskUserQuestion',
    hooks: [{
      type: 'command',
      command: 'npx tsx ban-ask-user-question-hook.ts',
    }],
  },
  {
    matcher: 'ExitPlanMode',
    hooks: [{
      type: 'command',
      command: 'npx tsx redirect-exit-plan-mode-hook.ts',
    }],
  },
];
```

### Claude Process Configuration

```typescript
// In ClaudeProcessManager.ts
args.push('--hook-config', hooksConfigPath);
args.push('--permission-prompt-tool=mcp__webui__permission_prompt');
args.push('--mcp', `npx tsx ${mcpServerPath}`);
```

## Benefits

1. **Seamless Web Integration**: All user interactions happen in the web UI
2. **No Timeouts**: MCP tools don't have timeout constraints
3. **Better UX**: Visual dialogs, pattern management, approval flows
4. **Persistence**: Settings and patterns persist across sessions
5. **Cross-Process Communication**: Reliable state sharing via filesystem

## Troubleshooting

### Common Issues

1. **"No session ID configured"**: Ensure `WEBUI_SESSION_ID` is set
2. **Approval not persisting**: Check temp file permissions in `/tmp`
3. **Hook not triggering**: Verify hook configuration and file paths
4. **MCP tool not found**: Ensure MCP server is running and configured

### Debug Logging

All components log to stderr:
- Hooks: `[hook-name] message`
- MCP Server: `[WEBUI-MCP] message`

View logs in the terminal where the backend is running.

## Future Improvements

1. **Redis/Database State**: Replace temp files with proper state management
2. **WebSocket Integration**: Real-time updates without polling
3. **More Tool Migrations**: Migrate other CLI tools as needed
4. **Better Error Handling**: More descriptive error messages