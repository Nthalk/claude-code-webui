import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'claude-webui.db');

let db: Database.Database;

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(): Database.Database {
  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar_url TEXT,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      api_key_encrypted TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, provider_id)
    );

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      claude_session_id TEXT,
      status TEXT DEFAULT 'stopped',
      last_message TEXT,
      starred INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- User settings table
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme TEXT DEFAULT 'dark',
      default_working_dir TEXT,
      allowed_tools TEXT,
      custom_system_prompt TEXT,
      settings_json TEXT
    );

    -- MCP servers table
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      command TEXT,
      args TEXT,
      url TEXT,
      env TEXT,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- CLI tools table (for orchestrating other AI CLI tools like Codex)
    CREATE TABLE IF NOT EXISTS cli_tools (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      command TEXT NOT NULL,
      description TEXT,
      use_session_cwd INTEGER DEFAULT 1,
      timeout_seconds INTEGER DEFAULT 300,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Claude OAuth tokens table
    CREATE TABLE IF NOT EXISTS claude_tokens (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      expires_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Tool executions table
    CREATE TABLE IF NOT EXISTS tool_executions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      input TEXT,
      result TEXT,
      error TEXT,
      status TEXT NOT NULL DEFAULT 'started',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);
    CREATE INDEX IF NOT EXISTS idx_cli_tools_user_id ON cli_tools(user_id);
    CREATE INDEX IF NOT EXISTS idx_tool_executions_session_id ON tool_executions(session_id);
  `);

  // Migration: Add starred column to existing sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN starred INTEGER DEFAULT 0`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add model column to existing sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN model TEXT DEFAULT 'opus'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add auto-compact columns to user_settings table
  try {
    db.exec(`ALTER TABLE user_settings ADD COLUMN auto_compact_enabled INTEGER DEFAULT 1`);
  } catch {
    // Column already exists, ignore error
  }

  try {
    db.exec(`ALTER TABLE user_settings ADD COLUMN auto_compact_threshold INTEGER DEFAULT 95`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add meta message columns to messages table
  try {
    db.exec(`ALTER TABLE messages ADD COLUMN meta_type TEXT`);
  } catch {
    // Column already exists, ignore error
  }

  try {
    db.exec(`ALTER TABLE messages ADD COLUMN meta_data TEXT`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add session_state column to sessions table
  // Values: 'inactive' (default), 'active' (Claude process running), 'has-pending' (has queued messages)
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN session_state TEXT DEFAULT 'inactive'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add mode column to sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN mode TEXT DEFAULT 'auto-accept'`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Create pending_messages table for storing messages queued while session is inactive
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_pending_messages_session_id ON pending_messages(session_id);
  `);

  // Migration: Create pending_permissions table for storing active permission requests
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_permissions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL UNIQUE,
      tool_name TEXT NOT NULL,
      arguments TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      response_action TEXT,
      response_pattern TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME
    );
    CREATE INDEX IF NOT EXISTS idx_pending_permissions_session_id ON pending_permissions(session_id);
    CREATE INDEX IF NOT EXISTS idx_pending_permissions_request_id ON pending_permissions(request_id);
  `);

  // Migration: Create todos table for storing session todos
  db.exec(`
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed')),
      active_form TEXT,
      sort_order INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_todos_session_id ON todos(session_id);
    CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
  `);

  // Migration: Create projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      claude_project_path TEXT,
      is_discovered INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
  `);

  // Migration: Add project_id to sessions table
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Create token_usage table for tracking session token usage
  db.exec(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      context_window INTEGER,
      context_used_percent REAL,
      total_cost_usd REAL,
      model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_token_usage_session_id ON token_usage(session_id);
  `);
}

export { db };
