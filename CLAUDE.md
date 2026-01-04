# Claude Code Web UI

Web-basierte Benutzeroberfläche für Claude Code CLI.

## Projektstruktur

pnpm-Monorepo mit drei Packages:

```
packages/
  backend/   - Express + Socket.IO Server, SQLite DB, node-pty für Claude CLI
  frontend/  - React 18 + Vite, Radix UI, Tailwind, Zustand
  shared/    - Gemeinsame TypeScript-Typen
```

## Entwicklung

```bash
# Abhängigkeiten installieren
pnpm install

# Dev-Server starten (Backend + Frontend parallel)
pnpm dev

# Oder mit dem Helper-Skript (generiert temporäre Secrets)
./scripts/start-webui.sh
```

Backend: http://localhost:3006
Frontend: http://localhost:5173

## Wichtige Dateien

- `packages/backend/src/services/claude/` - Claude CLI Prozess-Management (stream-json Modus)
- `packages/backend/src/websocket/` - Socket.IO Event-Handler
- `packages/backend/src/routes/` - REST API Endpunkte
- `packages/frontend/src/pages/SessionPage.tsx` - Haupt-Chat-Interface
- `packages/frontend/src/services/socket.ts` - WebSocket-Client

## Claude CLI Integration

Das Backend kommuniziert mit Claude CLI im `stream-json` Modus:

```bash
claude --print --verbose --output-format stream-json --input-format stream-json \
       --include-partial-messages --dangerously-skip-permissions
```

Features:
- **Live-Streaming**: Nachrichten werden in Echtzeit gestreamt (`content_block_delta` Events)
- **Message-Queue**: Nachrichten werden auch während Claudes Arbeit akzeptiert
- **Interrupt**: Ctrl+C Funktionalität via SIGINT

WebSocket Events (Server → Client):
- `session:output` - Streaming-Text (Delta)
- `session:message` - Gespeicherte Nachricht
- `session:thinking` - Denkindikator (isThinking: boolean)
- `session:tool_use` - Tool-Nutzung (started/completed/error)
- `session:status` - Session-Status

## Bildgenerierung mit Gemini

Claude Code kann Bilder mit dem Gemini API (Nano Banana Pro / gemini-3-pro-image-preview) generieren:

```bash
# Generiere ein Bild und sende es an den Chat
npx tsx packages/backend/src/cli/generate-image.ts "Ein Sonnenuntergang über Bergen"
```

Die Session-ID wird automatisch aus der Umgebungsvariable `WEBUI_SESSION_ID` gelesen.
Das generierte Bild wird automatisch im Chat-Interface angezeigt.

## Umgebungsvariablen

| Variable | Beschreibung |
|----------|--------------|
| `SESSION_SECRET` | Express Session Secret |
| `JWT_SECRET` | JWT Signierung |
| `FRONTEND_URL` | CORS Origin (default: http://localhost:5173) |
| `GEMINI_API_KEY` | Google Gemini API Key für Bildgenerierung |
| `WEBUI_SESSION_ID` | Aktuelle Session-ID (automatisch gesetzt) |

## Befehle

```bash
pnpm dev          # Entwicklungsserver
pnpm build        # Produktions-Build
pnpm typecheck    # TypeScript-Prüfung
pnpm lint         # ESLint
pnpm format       # Prettier
```
