# Claude Code Web UI

## Project Behavior Guidelines

### Code Style
- Use TypeScript strictly - no `any` types
- Prefer functional components with hooks
- Keep components focused and composable
- Use Tailwind classes, avoid inline styles
- Follow existing patterns in codebase

### Development Practices
- Always run `pnpm typecheck` before considering done
- Test changes with `pnpm dev` running
- Preserve existing functionality when refactoring
- Keep commits focused on single concerns
- Use descriptive variable/function names

### Architecture Decisions
- WebSocket for real-time updates, REST for CRUD
- Zustand for global state, React state for local
- SQLite for persistence, no external DB needed
- Stream JSON mode for Claude CLI communication

### Common Tasks
- Adding features: Check existing patterns first
- Debugging: Use browser DevTools + backend logs
- Performance: Profile before optimizing
- UI changes: Test on mobile viewport too

## Documentation Links
- [Radix UI Primitives](https://www.radix-ui.com/primitives)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Socket.IO](https://socket.io/docs/v4/)
- [Zustand](https://docs.pmnd.rs/zustand/getting-started/introduction)
- [Vite](https://vitejs.dev/guide/)

## Quick Reference
```bash
pnpm dev          # Start development
pnpm typecheck    # Check types
pnpm build        # Production build

# Restart backend (when using scripts/start-webui.sh)
scripts/start-webui.sh --restart  # From another terminal
# OR
kill -USR1 <script-pid>           # Using the PID shown at startup
```

### Backend Restart
When running with `scripts/start-webui.sh`, you can restart just the backend server without affecting the frontend. This is useful when:
- Making backend code changes that need a reload
- Backend crashes and needs recovery
- Clearing in-memory state while keeping UI sessions intact

Two ways to restart:
1. **From another terminal**: `scripts/start-webui.sh --restart`
2. **Using signal**: `kill -USR1 <pid>` (PID is shown at startup)

The frontend remains running, preserving user sessions and UI state. The script writes its own PID to `.pids/start-webui.pid` for easy access.