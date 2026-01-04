# Claude Code WebUI

A powerful web-based interface for Claude Code CLI with rich features for development workflows.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)
![React](https://img.shields.io/badge/React-18.3-blue.svg)

## Features

### Chat Interface
- Real-time streaming responses via WebSocket
- Multi-session management with history
- Image attachments and Gemini image generation
- LaTeX/Math rendering with KaTeX
- Interactive choice prompts
- Token usage and cost tracking
- Todo tracking from Claude's TodoWrite tool

### File Management
- File Tree Browser with lazy loading and git status
- Monaco Code Editor with syntax highlighting
- Create, edit, delete, and rename files
- Three view modes: Simple, Compact, Detailed

### Git Integration
- Full Git Panel (staging, commits, diffs, history)
- Visual branch management (create, publish, delete)
- Commit history with diff viewer
- AI-powered commit message generation
- Pull/Fetch with remote status (ahead/behind)

### GitHub Integration
- Create new repositories
- Clone repositories (with repo browser)
- Push to GitHub with remote management
- Token-authenticated operations

### Custom Commands
- Built-in commands: `/help`, `/clear`, `/model`, `/status`, `/cost`, `/compact`
- User commands from `~/.claude/commands/*.md`
- Project commands from `{project}/.claude/commands/*.md`
- Autocomplete dropdown when typing `/`

### Project Management
- Project Auto-Discovery from `~/.claude/projects`
- Working directory navigation
- Session starring and filtering
- PTY Reconnect with 30-minute buffer

### Mobile Support
- Progressive Web App (PWA)
- Bottom tab navigation
- Swipe gestures for panel navigation
- Responsive design

### Settings
- Tabbed settings interface
- Theme configuration
- API key management (Gemini, GitHub)
- MCP Server management with connection testing

## Tech Stack

### Backend
- **Express.js** - HTTP server
- **Socket.IO** - Real-time communication
- **SQLite** (better-sqlite3) - Database
- **node-pty** - Claude CLI process management
- **simple-git** - Git operations
- **@octokit/rest** - GitHub API

### Frontend
- **React 18** - UI framework
- **Vite** - Build tool with code splitting
- **Radix UI** - Accessible components
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **TanStack Query** - Data fetching
- **Monaco Editor** - Code editing
- **KaTeX** - Math rendering

### Shared
- **TypeScript** - Type safety across packages

## Installation

### Prerequisites
- Node.js 20+
- pnpm 9+
- Claude Code CLI installed and configured

### Development Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/claude-code-webui.git
cd claude-code-webui

# Install dependencies
pnpm install

# Start development servers
pnpm dev

# Or use the helper script (generates temporary secrets)
./scripts/start-webui.sh
```

- Backend: http://localhost:3006
- Frontend: http://localhost:5173

### Production Build

```bash
# Build all packages
pnpm build

# Start production server
pnpm start
```

### Docker Deployment

```bash
# Build and run with Docker Compose
docker-compose up -d --build
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SESSION_SECRET` | Express session secret | Yes |
| `JWT_SECRET` | JWT signing key | Yes |
| `FRONTEND_URL` | CORS origin (default: http://localhost:5173) | No |
| `PORT` | Backend port (default: 3006) | No |

### Claude CLI Integration

The backend communicates with Claude CLI in `stream-json` mode:

```bash
claude --print --verbose --output-format stream-json --input-format stream-json \
       --include-partial-messages --dangerously-skip-permissions
```

## Project Structure

```
packages/
├── backend/          # Express + Socket.IO server
│   ├── src/
│   │   ├── routes/   # REST API endpoints
│   │   ├── services/ # Business logic
│   │   ├── websocket/# Socket.IO handlers
│   │   └── db/       # SQLite database
├── frontend/         # React + Vite application
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── stores/   # Zustand stores
│   │   ├── services/ # API & Socket clients
│   │   └── hooks/    # Custom React hooks
└── shared/           # Shared TypeScript types
```

## API Endpoints

### Sessions
- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id` - Get session details
- `PATCH /api/sessions/:id/star` - Toggle star

### Files
- `GET /api/files?path=` - List directory contents
- `GET /api/files/content?path=` - Read file content
- `POST /api/files` - Create file
- `PUT /api/files` - Update file
- `DELETE /api/files?path=` - Delete file

### Git
- `GET /api/git/status?path=` - Get git status
- `POST /api/git/stage` - Stage files
- `POST /api/git/commit` - Create commit
- `POST /api/git/pull` - Pull from remote
- `POST /api/git/push` - Push to remote
- `POST /api/git/branch/create` - Create branch
- `POST /api/git/generate-commit-message` - AI commit message

### GitHub
- `GET /api/github/repos` - List user repos
- `POST /api/github/repos` - Create repo
- `POST /api/github/clone` - Clone repo
- `POST /api/github/push` - Push to GitHub

### Commands
- `GET /api/commands` - List available commands
- `POST /api/commands/execute` - Execute command

## WebSocket Events

### Client → Server
- `session:send` - Send message to Claude
- `session:subscribe` - Subscribe to session updates
- `session:interrupt` - Interrupt Claude (Ctrl+C)
- `session:reconnect` - Reconnect with buffer replay

### Server → Client
- `session:output` - Streaming text
- `session:message` - Complete message
- `session:thinking` - Thinking indicator
- `session:tool_use` - Tool usage events
- `session:todos` - Todo list updates
- `session:usage` - Token usage data

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run `pnpm typecheck` and `pnpm lint`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Anthropic](https://anthropic.com) for Claude
- [Claude Code CLI](https://claude.com/claude-code) for the underlying tool
