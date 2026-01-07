#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env file if present (supports KEY=value format)
load_env() {
  local env_file="$1"
  if [[ -f "$env_file" ]]; then
    echo "Loading $env_file..."
    while IFS= read -r line || [[ -n "$line" ]]; do
      # Skip comments and empty lines
      [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
      # Export valid KEY=value pairs
      if [[ "$line" =~ ^[a-zA-Z_][a-zA-Z0-9_]*= ]]; then
        export "$line"
      fi
    done < "$env_file"
  fi
}

# Load root .env files (later files override earlier)
load_env "${ROOT_DIR}/.env"
load_env "${ROOT_DIR}/.env.local"

# Parse arguments (env vars override defaults, CLI args override env vars)
HOST="${HOST:-localhost}"
UI_PORT="${UI_PORT:-5173}"
PORT="${PORT:-3006}"
RESTART_MODE=false
SDK_MODE=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --host)
      HOST="$2"
      shift 2
      ;;
    --host=*)
      HOST="${1#*=}"
      shift
      ;;
    --ui-port)
      UI_PORT="$2"
      shift 2
      ;;
    --ui-port=*)
      UI_PORT="${1#*=}"
      shift
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    --port=*)
      PORT="${1#*=}"
      shift
      ;;
    --restart)
      RESTART_MODE=true
      shift
      ;;
    --sdk)
      SDK_MODE=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--host <host>] [--ui-port <port>] [--port <port>] [--restart] [--sdk]" >&2
      exit 1
      ;;
  esac
done

# Set SDK mode if requested
if [[ "$SDK_MODE" == "true" ]]; then
  export CLAUDE_MANAGER_TYPE=sdk
  echo "SDK mode enabled (using Claude Agent SDK instead of CLI)"
fi

LOG_DIR="${ROOT_DIR}/.logs"
PID_DIR="${ROOT_DIR}/.pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

# Handle restart mode
if [[ "$RESTART_MODE" == "true" ]]; then
  SCRIPT_PID_FILE="${PID_DIR}/start-webui.pid"
  if [[ -f "$SCRIPT_PID_FILE" ]]; then
    SCRIPT_PID=$(cat "$SCRIPT_PID_FILE")
    if kill -0 "$SCRIPT_PID" 2>/dev/null; then
      # Run typecheck first
      echo "Running typecheck..."
      cd "$ROOT_DIR"
      PNPM_BIN="$(command -v pnpm || true)"
      if [[ -z "$PNPM_BIN" && -x "${ROOT_DIR}/node_modules/.bin/pnpm" ]]; then
        PNPM_BIN="${ROOT_DIR}/node_modules/.bin/pnpm"
      fi
      if ! "$PNPM_BIN" typecheck; then
        echo "Typecheck failed, aborting restart" >&2
        exit 1
      fi
      echo ""
      echo "Typecheck passed. Sending restart signal to running instance (PID $SCRIPT_PID)..."
      kill -USR1 "$SCRIPT_PID"

      # Wait for backend to come up (tail logs while waiting)
      echo "Waiting for backend to start (up to 15s)..."
      echo "--- Backend logs ---"

      # Tail logs in background
      tail -f "${LOG_DIR}/backend.log" 2>/dev/null &
      TAIL_PID=$!

      # Wait for port to be listening (backend started)
      wait_count=0
      while [[ $wait_count -lt 30 ]]; do
        if lsof -i ":$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
          # Port is listening, wait a bit more for full startup
          sleep 1
          echo ""
          echo "--- Backend started successfully on port $PORT ---"
          kill "$TAIL_PID" 2>/dev/null || true
          exit 0
        fi
        sleep 0.5
        ((wait_count++)) || true
      done

      # Timeout
      kill "$TAIL_PID" 2>/dev/null || true
      echo ""
      echo "Warning: Backend may not have started within 15s (port $PORT not listening)" >&2
      exit 1
    else
      echo "No running instance found (stale PID file)" >&2
      exit 1
    fi
  else
    echo "No running instance found" >&2
    exit 1
  fi
fi

# Write our own PID for restart functionality
echo $$ > "${PID_DIR}/start-webui.pid"

# Kill existing processes if running
kill_if_running() {
  local pid_file="$1"
  local name="$2"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping existing $name (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      # Force kill if still running
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$pid_file"
  fi
}

kill_if_running "${PID_DIR}/backend.pid" "backend"
kill_if_running "${PID_DIR}/frontend.pid" "frontend"

PNPM_BIN="$(command -v pnpm || true)"
if [[ -z "$PNPM_BIN" && -x "${ROOT_DIR}/node_modules/.bin/pnpm" ]]; then
  PNPM_BIN="${ROOT_DIR}/node_modules/.bin/pnpm"
fi

if [[ -z "$PNPM_BIN" ]]; then
  echo "pnpm not found. Install it or run: npm install -D pnpm" >&2
  exit 1
fi

if [[ ! -d "${ROOT_DIR}/node_modules" ]]; then
  echo "Installing workspace dependencies..."
  "$PNPM_BIN" install
fi

generate_secret() {
  python - <<'PY'
import secrets
print(secrets.token_hex(16))
PY
}

if [[ -z "${SESSION_SECRET:-}" ]]; then
  SESSION_SECRET="$(generate_secret)"
  export SESSION_SECRET
  echo "SESSION_SECRET not set; generated a temporary one for this session."
fi

if [[ -z "${JWT_SECRET:-}" ]]; then
  JWT_SECRET="$(generate_secret)"
  export JWT_SECRET
  echo "JWT_SECRET not set; generated a temporary one for this session."
fi

export FRONTEND_URL="${FRONTEND_URL:-http://${HOST}:${UI_PORT}}"

echo "Starting backend on port ${PORT}..."
PORT="$PORT" "$PNPM_BIN" -C packages/backend run dev > "${LOG_DIR}/backend.log" 2>&1 &
BACKEND_PID=$!
echo "$BACKEND_PID" > "${PID_DIR}/backend.pid"

echo "Starting frontend on ${HOST}:${UI_PORT}..."
BACKEND_PORT="$PORT" VITE_PORT="$UI_PORT" VITE_HOST="$HOST" "$PNPM_BIN" -C packages/frontend run dev > "${LOG_DIR}/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "$FRONTEND_PID" > "${PID_DIR}/frontend.pid"

SDK_INFO=""
if [[ "$SDK_MODE" == "true" ]]; then
  SDK_INFO=" [SDK MODE]"
fi

cat <<EOF
WebUI started.${SDK_INFO}
- Backend:  http://localhost:${PORT} (PID $BACKEND_PID)
- Frontend: http://${HOST}:${UI_PORT} (PID $FRONTEND_PID)

Open: http://${HOST}:${UI_PORT}

To restart backend:
  - From another terminal: $0 --restart
  - Or send signal: kill -USR1 $$

Tailing logs (Ctrl+C to stop)...
EOF

# Tail both logs, exit when either process dies
tail -f "${LOG_DIR}/backend.log" "${LOG_DIR}/frontend.log" &
TAIL_PID=$!

# Wait for a process to terminate
wait_for_process_exit() {
  local pid="$1"
  local timeout="${2:-10}"
  local count=0
  while kill -0 "$pid" 2>/dev/null && [[ $count -lt $timeout ]]; do
    sleep 0.5
    ((count++)) || true
  done
  # Return success if process is gone
  ! kill -0 "$pid" 2>/dev/null
}

# Wait for port to be free
wait_for_port_free() {
  local port="$1"
  local timeout="${2:-10}"
  local count=0
  while lsof -i ":$port" -sTCP:LISTEN >/dev/null 2>&1 && [[ $count -lt $timeout ]]; do
    sleep 0.5
    ((count++)) || true
  done
  # Return success if port is free
  ! lsof -i ":$port" -sTCP:LISTEN >/dev/null 2>&1
}

# Kill process and all its children
kill_process_tree() {
  local pid="$1"
  local signal="${2:-TERM}"

  # Kill children first (if we can find them)
  pkill -"$signal" -P "$pid" 2>/dev/null || true

  # Kill the process itself
  kill -"$signal" "$pid" 2>/dev/null || true
}

# Restart backend function
restart_backend() {
  echo ""
  echo "Restarting backend..."

  # Kill existing backend and its children (tsx watch spawns child processes)
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill_process_tree "$BACKEND_PID" TERM

    # Wait for process to exit gracefully
    if ! wait_for_process_exit "$BACKEND_PID" 10; then
      echo "Backend didn't stop gracefully, force killing..."
      kill_process_tree "$BACKEND_PID" 9
      wait_for_process_exit "$BACKEND_PID" 5
    fi
  fi

  # Also kill anything still listening on the port
  local port_pid
  port_pid=$(lsof -ti ":$PORT" -sTCP:LISTEN 2>/dev/null || true)
  if [[ -n "$port_pid" ]]; then
    echo "Killing process still holding port $PORT (PID $port_pid)..."
    kill -9 $port_pid 2>/dev/null || true
  fi

  # Wait for port to be free
  if ! wait_for_port_free "$PORT" 20; then
    echo "Error: Port $PORT still in use after waiting" >&2
    return 1
  fi

  # Start backend again
  echo "Starting backend on port ${PORT}..."
  PORT="$PORT" "$PNPM_BIN" -C packages/backend run dev > "${LOG_DIR}/backend.log" 2>&1 &
  BACKEND_PID=$!
  echo "$BACKEND_PID" > "${PID_DIR}/backend.pid"
  echo "Backend restarted (PID $BACKEND_PID)"
}

# Cleanup on exit
cleanup() {
  echo ""
  echo "Shutting down..."
  kill "$TAIL_PID" 2>/dev/null || true
  kill "$BACKEND_PID" 2>/dev/null || true
  kill "$FRONTEND_PID" 2>/dev/null || true
  rm -f "${PID_DIR}/backend.pid" "${PID_DIR}/frontend.pid" "${PID_DIR}/start-webui.pid"
  exit 0
}

trap cleanup SIGINT SIGTERM
trap restart_backend SIGUSR1

# Wait for processes, exit if either dies
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

cleanup
