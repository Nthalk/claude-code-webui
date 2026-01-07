# Claude Code WebUI

A powerful web-based interface for Claude Code CLI with real-time collaboration, enhanced development workflows, and comprehensive project management.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18.3-blue.svg)](https://react.dev/)
[![Docker Hub](https://img.shields.io/docker/v/valentin2177/claude-code-webui?label=Docker%20Hub&logo=docker)](https://hub.docker.com/r/valentin2177/claude-code-webui)

# Screenshots

## Desktop:

<img width="1874" height="856" alt="Bildschirmfoto_20260104_140400" src="https://github.com/user-attachments/assets/f7ebf624-39df-44ad-b0bc-9d685ea43f49" />
<img width="1874" height="859" alt="Bildschirmfoto_20260104_140428" src="https://github.com/user-attachments/assets/b58f2808-4899-4884-9083-be48a31ef473" />
<img width="1863" height="860" alt="Bildschirmfoto_20260104_140510" src="https://github.com/user-attachments/assets/bb334cd5-de76-47bd-b0de-0f6c5e9cdbf9" />

## Mobile:

<img width="487" height="737" alt="Bildschirmfoto_20260104_141306" src="https://github.com/user-attachments/assets/91829fc9-af83-461b-bd4e-11271e28033e" />
<img width="476" height="738" alt="Bildschirmfoto_20260104_141321" src="https://github.com/user-attachments/assets/f5897703-c0e9-48ff-9150-d4018c715553" />
<img width="476" height="738" alt="Bildschirmfoto_20260104_141404" src="https://github.com/user-attachments/assets/ddc26671-8e94-4f96-b307-56969f180801" />
<img width="476" height="738" alt="Bildschirmfoto_20260104_141424" src="https://github.com/user-attachments/assets/6b3331c8-4ecc-428d-a749-5fff0c9613c4" />


## Features

### Chat Interface
- **Real-time Streaming**: WebSocket-based streaming responses with partial message support
- **Multi-Session Management**: Create, switch, and manage multiple chat sessions with persistent history
- **Rich Media Support**:
  - Image attachments with drag-and-drop
  - Gemini image generation integration
  - LaTeX/Math rendering with KaTeX
  - Syntax-highlighted code blocks
- **Interactive Elements**:
  - User approval dialogs for permissions and actions
  - Interactive choice prompts with multi-select support
  - Plan approval workflow with content preview
  - Commit approval with git status preview
- **Token Management**: Real-time token usage tracking with cost calculations and depletion warnings
- **Todo Tracking**: Persistent todo lists from Claude's TodoWrite tool with progress indicators

### Enhanced Tool Rendering
- **Specialized Tool Viewers**:
  - BashToolRenderer: Terminal-style output with ANSI color support
  - ReadToolRenderer: Syntax-highlighted file viewing
  - EditToolDiff: Visual diff viewer for file edits
  - GrepToolRenderer: Search results with file grouping
  - WebSearchToolRenderer: Formatted search results with links
  - ExploreRenderer: Codebase exploration results
  - PlanRenderer: Interactive plan approval interface
- **Collapsible Tool Output**: Manage screen space with expandable tool results

### File Management
- **Advanced File Tree**:
  - Lazy loading for performance
  - Git status indicators (modified, untracked, ignored)
  - Dotfile visibility toggle
  - Smart auto-expand for search results
  - Context menu operations (create, rename, delete)
- **Monaco Code Editor**:
  - Full VS Code editing experience
  - Multi-file tabs with unsaved changes tracking
  - Syntax highlighting for 50+ languages
  - Find/Replace functionality
  - Code folding and minimap

### Git Integration
- **Comprehensive Git Panel**:
  - Visual staging/unstaging with checkbox interface
  - Commit creation with message templates
  - Diff viewer with syntax highlighting
  - Branch management (create, switch, publish, delete)
  - Remote operations (pull, push, fetch)
  - Commit history browser with diff viewing
- **AI-Powered Features**:
  - Generate commit messages from staged changes
  - Smart commit suggestions based on diff analysis
- **GitHub Integration**:
  - Create repositories with visibility options
  - Clone with repository browser
  - Push to GitHub with authentication
  - Token-based secure operations

### Project Management
- **Project Discovery**:
  - Auto-discovery from `~/.claude/projects`
  - Working directory persistence
  - Project-specific sessions and history
- **Session Management**:
  - Star/unstar sessions for quick access
  - Session filtering and search
  - Auto-reconnect with 30-minute buffer replay
  - Token usage tracking per session
- **Single-Session Workflow**: Streamlined UI for focused development

### Command System
- **Built-in Commands**:
  - `/help` - Show available commands
  - `/clear` - Clear chat history
  - `/model` - Switch between Claude models
  - `/status` - Show session status
  - `/cost` - Display token usage and costs
  - `/compact` - Toggle compact message view
- **Custom Commands**:
  - User commands from `~/.claude/commands/*.md`
  - Project commands from `{project}/.claude/commands/*.md`
  - Autocomplete dropdown with descriptions
  - Command chaining support

### Mobile Support
- **Progressive Web App (PWA)**:
  - Installable on mobile devices
  - Offline capability with service worker
  - App-like experience
- **Mobile-Optimized UI**:
  - Bottom tab navigation
  - Swipe gestures with edge glow feedback
  - Responsive layouts
  - Touch-optimized controls
  - Keyboard handling improvements

### Settings & Configuration
- **Tabbed Settings Interface**:
  - General settings (theme, font size, etc.)
  - API key management (Gemini, GitHub)
  - MCP Server configuration with testing
  - Model preferences and usage limits
- **Persistent Preferences**: All settings saved to database

### Advanced Features
- **MCP (Model Context Protocol) Integration**:
  - Custom MCP server for WebUI tools
  - Permission prompts via UI instead of terminal
  - User question handling with web dialogs
  - Plan and commit approval workflows
- **Hook System**:
  - Pre-tool-use hooks for intercepting commands
  - Custom tool redirection
  - Enhanced security with permission management
- **Queue System**:
  - Priority-based action queue (permissions > questions > plans > commits)
  - Prevents UI conflicts with sequential processing
  - Timeout handling for unresponsive actions

## Tech Stack

### Backend
- **Express.js** - HTTP server with session management
- **Socket.IO** - Real-time bidirectional communication
- **SQLite** (better-sqlite3) - Persistent storage for sessions, messages, todos
- **node-pty** - Claude CLI process management with PTY support
- **simple-git** - Git operations and repository management
- **@octokit/rest** - GitHub API integration
- **tsx** - TypeScript execution for MCP server

### Frontend
- **React 18.3** - UI framework with concurrent features
- **Vite** - Fast build tool with HMR and code splitting
- **Radix UI** - Accessible, unstyled UI primitives
- **Tailwind CSS** - Utility-first styling with custom themes
- **Zustand** - Lightweight state management
- **TanStack Query** - Data fetching with caching
- **Monaco Editor** - Full-featured code editor
- **KaTeX** - Fast math rendering
- **react-markdown** - Markdown rendering with plugins
- **Prism.js** - Syntax highlighting

### Shared
- **TypeScript** - Type safety across all packages
- **Zod** - Runtime type validation
- **Stream JSON** - JSONL parsing for Claude communication

## Installation

### Quick Start with Docker Hub (Recommended)

```bash
# Create a directory for docker-compose
mkdir claude-code-webui && cd claude-code-webui

# Download docker-compose file
curl -O https://raw.githubusercontent.com/zwaetschge/claude-code-webui/main/docker-compose.hub.yml

# Create .env file with your secrets
cat > .env << 'EOF'
SESSION_SECRET=your-session-secret-at-least-32-characters-long
JWT_SECRET=your-jwt-secret-at-least-32-characters-long
EOF

# Start the container
docker-compose -f docker-compose.hub.yml up -d
```

Access the WebUI at http://localhost:5174

**Requirements:**
- Docker and Docker Compose
- Claude Code CLI configured on your host (`~/.claude` directory)

### Prerequisites (for development)
- Node.js 20+
- pnpm 9+
- Claude Code CLI installed and configured

### Development Setup

```bash
# Clone the repository
git clone https://github.com/zwaetschge/claude-code-webui.git
cd claude-code-webui

# Install dependencies
pnpm install

# Start development servers
pnpm dev

# Or use the helper script (auto-generates secrets)
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
# Option 1: Pull from Docker Hub
docker-compose -f docker-compose.hub.yml up -d

# Option 2: Build locally
docker-compose up -d --build
```

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SESSION_SECRET` | Express session secret (min 32 chars) | Yes |
| `JWT_SECRET` | JWT signing key (min 32 chars) | Yes |
| `FRONTEND_URL` | CORS origin (default: http://localhost:5173) | No |
| `PORT` | Backend port (default: 3006) | No |
| `NODE_ENV` | Environment (development/production) | No |

### Claude CLI Integration

The WebUI communicates with Claude CLI in `stream-json` mode with enhanced integration through hooks and MCP.

#### Architecture

```
┌─────────────────┐     WebSocket/REST     ┌──────────────────┐
│                 │ ◄─────────────────────► │                  │
│  WebUI Frontend │                         │  Backend Server  │
│    (React)      │                         │   (Express.js)   │
└─────────────────┘                         └──────┬───────────┘
                                                   │
                                                   │ node-pty
                                                   ▼
                                         ┌──────────────────────┐
                                         │  Claude CLI Process  │
                                         │  - stream-json mode  │
                                         │  - hooks enabled     │
                                         │  - MCP server        │
                                         └──────────────────────┘
```

#### Hook System

The WebUI uses pre-tool-use hooks to intercept and enhance Claude's capabilities:

1. **AskUserQuestion → mcp__webui__ask_user**: Redirects terminal prompts to web UI
2. **PermissionPrompt → mcp__webui__permission_prompt**: Visual permission dialogs
3. **ExitPlanMode → mcp__webui__confirm_plan**: Two-step plan approval
4. **Commit → mcp__webui__commit**: Interactive commit approval

See [Claude CLI Workarounds Documentation](docs/CLAUDE_CLI_WORKAROUNDS.md) for details.

## Project Structure

```
claude-code-webui/
├── packages/
│   ├── backend/               # Express + Socket.IO server
│   │   ├── src/
│   │   │   ├── routes/        # REST endpoints
│   │   │   ├── services/      # Business logic
│   │   │   │   ├── claude/    # Claude process management
│   │   │   │   └── pendingActionsQueue.ts
│   │   │   ├── websocket/     # Socket handlers
│   │   │   ├── db/            # SQLite models
│   │   │   └── mcp/           # MCP server implementation
│   ├── frontend/              # React application
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── chat/      # Chat UI components
│   │   │   │   ├── git-panel/ # Git operations
│   │   │   │   └── ui/        # Reusable components
│   │   │   ├── pages/         # Route pages
│   │   │   ├── stores/        # Zustand stores
│   │   │   ├── services/      # API clients
│   │   │   └── hooks/         # Custom hooks
│   └── shared/                # Shared types & utilities
│       └── src/types/         # TypeScript definitions
├── scripts/
│   └── start-webui.sh         # Development helper
├── docker-compose.yml         # Local build config
└── docker-compose.hub.yml     # Docker Hub config
```

## API Documentation

### REST Endpoints

#### Sessions
- `GET /api/sessions` - List all sessions with filters
- `POST /api/sessions` - Create new session
- `GET /api/sessions/:id` - Get session with messages
- `PATCH /api/sessions/:id/star` - Toggle star status
- `DELETE /api/sessions/:id` - Delete session

#### Files
- `GET /api/files?path=` - List directory contents
- `GET /api/files/content?path=` - Read file content
- `POST /api/files` - Create file/directory
- `PUT /api/files` - Update file content
- `DELETE /api/files?path=` - Delete file/directory
- `POST /api/files/rename` - Rename file/directory

#### Git
- `GET /api/git/status?path=` - Repository status
- `POST /api/git/stage` - Stage/unstage files
- `POST /api/git/commit` - Create commit
- `POST /api/git/pull` - Pull from remote
- `POST /api/git/push` - Push to remote
- `GET /api/git/branch?path=` - List branches
- `POST /api/git/branch/create` - Create branch
- `POST /api/git/branch/switch` - Switch branch
- `DELETE /api/git/branch` - Delete branch
- `POST /api/git/generate-commit-message` - AI commit message

#### GitHub
- `GET /api/github/repos` - List user repositories
- `POST /api/github/repos` - Create repository
- `POST /api/github/clone` - Clone repository
- `POST /api/github/push` - Push to GitHub

#### Commands
- `GET /api/commands` - List available commands
- `POST /api/commands/execute` - Execute command

#### Plan & Approval
- `GET /api/plan/latest/:sessionId` - Get latest plan
- `POST /api/user-questions/:id/answer` - Answer question
- `POST /api/permissions/:id/respond` - Respond to permission
- `POST /api/commit/:id/respond` - Respond to commit

### WebSocket Events

#### Client → Server
- `session:send` - Send message to Claude
- `session:subscribe` - Subscribe to session
- `session:interrupt` - Send Ctrl+C
- `session:reconnect` - Reconnect with buffer

#### Server → Client
- `session:output` - Streaming text chunks
- `session:message` - Complete messages
- `session:thinking` - Thinking indicator
- `session:tool_use` - Tool execution events
- `session:todos` - Todo list updates
- `session:usage` - Token usage stats
- `session:pending_permission` - Permission request
- `session:pending_user_question` - User question
- `session:pending_plan_approval` - Plan approval
- `session:pending_commit_approval` - Commit approval

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run checks:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm format:check
   ```
5. Commit your changes
6. Push to your fork
7. Open a Pull Request

## Development Tips

- Use `./scripts/start-webui.sh --restart` to restart backend during development
- Enable debug mode with `localStorage.setItem('debug', 'true')`
- Check WebSocket frames in browser DevTools
- SQLite database is at `packages/backend/data/claude-webui.db`
- MCP server logs available in backend console

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Anthropic](https://anthropic.com) for Claude
- [Claude Code CLI](https://claude.com/claude-code) for the underlying tool
- All contributors who have helped improve this project