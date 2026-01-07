# MCP Plan Improvement: Track Last Written File

## Current Problem

The current plan confirmation MCP implementation forces the AI to write the entire plan to a specific file in `/home/nthalk/.claude/plans/`. This is inefficient because:

1. The AI has to write a complete plan document
2. The plan file location is hardcoded
3. The MCP server searches for the most recent .md file in that directory
4. This adds unnecessary overhead to the planning process

## Proposed Solution

Instead of requiring a specific plan file, we should track the last file written by the AI and use that as the plan. This would be more natural and efficient.

### Implementation Approach

1. **Track File Writes in Session**
   - When the AI uses the Write tool, store the file path in the session
   - Keep track of the most recent written file per session
   - This could be stored in the ClaudeProcessManager or session state

2. **Modify confirm_plan MCP Tool**
   - Instead of looking for files in `/home/nthalk/.claude/plans/`
   - Accept an optional `planPath` parameter
   - If no planPath provided, use the last written file from session
   - Read that file and send its content as the plan

3. **Update Plan Route Handler**
   - The `/api/plan/request` endpoint already accepts `planContent` and `planPath`
   - No changes needed here - it's already flexible

4. **Benefits**
   - AI can write plans anywhere (e.g., `docs/plan/my-plan.md`)
   - No need to write to a specific directory
   - More natural workflow - AI writes documentation, then confirms it
   - Reduces cognitive load on the AI

### Example Workflow

**Current (inefficient):**
```
1. AI enters plan mode
2. AI explores codebase
3. AI writes plan to /home/nthalk/.claude/plans/random-name.md
4. AI calls confirm_plan (which searches for most recent .md file)
5. User reviews and approves
```

**Proposed (efficient):**
```
1. AI enters plan mode
2. AI explores codebase
3. AI writes plan to docs/plan/feature-x-plan.md (or any location)
4. AI calls confirm_plan with planPath="docs/plan/feature-x-plan.md"
   OR calls confirm_plan without params (uses last written file)
5. User reviews and approves
```

### Code Changes Required

1. **ClaudeProcessManager.ts**
   - Add `lastWrittenFile: string | null` to session state
   - Update Write tool handler to track written files

2. **webui-server.ts (MCP server)**
   - Modify `handleConfirmPlan` to accept optional planPath
   - If no planPath, get from session's lastWrittenFile
   - Remove hardcoded `/home/nthalk/.claude/plans/` logic

3. **Frontend (optional enhancement)**
   - Show which file is being used as the plan
   - Allow user to see the plan file path

### Migration Path

1. Keep backward compatibility initially
2. If planPath not provided and no lastWrittenFile, fall back to current behavior
3. Eventually deprecate the old approach

This improvement would make the planning workflow more flexible and efficient while maintaining the same user experience.