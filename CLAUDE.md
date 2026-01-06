# Claude Code Web UI

## Rules

- **STAY IN PROJECT ROOT**: NEVER change directories unnecessarily. You should be able to run any command from the project root.
- Keep it short and high signal, don't waste time agreeing or complementing me, focus on the task at hand! (no "Good!", "You are right!")
- Do not agree with me without checking first - when I say something surprising, verify it before agreeing!
- Continue batch operations until done unless asking for input

## Project Behavior Guidelines

### Code Style
- Use TypeScript strictly - no `any` types
- Prefer functional components with hooks
- Keep components focused and composable
- Use Tailwind classes, avoid inline styles
- Follow existing patterns in codebase

### Development Practices
- Always run `pnpm typecheck` before considering done
- Test changes with `scripts/start-webui.sh` running (it might be running, and it has a `--restart` flag, but should auto reload on changes)
- Preserve existing functionality when refactoring
- Keep commits focused on single concerns
- Use descriptive variable/function names
- Use conventional commit messages

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
pnpm typecheck    # Check types (does both frontend and backend)
pnpm build        # Production build

# Restart backend (when using scripts/start-webui.sh)
scripts/start-webui.sh --restart  # From another terminal
```

### Backend Restart
When running with `scripts/start-webui.sh`, you can restart just the backend server without affecting the frontend. This is useful when:
- Making backend code changes that need a reload
- Backend crashes and needs recovery
- Clearing in-memory state while keeping UI sessions intact
- UI sessions RELOAD on backend restart
