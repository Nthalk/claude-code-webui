import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../db';
import { AppError } from '../middleware/errorHandler';
import type { McpServer, McpServerType } from '@claude-code-webui/shared';

const router = Router();

const createMcpServerSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['subprocess', 'sse']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().url().optional(),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
});

const updateMcpServerSchema = createMcpServerSchema.partial();

// Helper to parse MCP server from DB
function parseMcpServer(row: Record<string, unknown>): McpServer {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    type: row.type as McpServerType,
    command: row.command as string | null,
    args: row.args ? JSON.parse(row.args as string) : [],
    url: row.url as string | null,
    env: row.env ? JSON.parse(row.env as string) : {},
    enabled: Boolean(row.enabled),
    createdAt: row.created_at as string,
  };
}

// List MCP servers
router.get('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const rows = db
    .prepare(
      `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE user_id = ? ORDER BY name`
    )
    .all(userId) as Record<string, unknown>[];

  const servers = rows.map(parseMcpServer);

  res.json({ success: true, data: servers });
});

// Get MCP server by ID
router.get('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const row = db
    .prepare(
      `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE id = ? AND user_id = ?`
    )
    .get(req.params.id, userId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true, data: parseMcpServer(row) });
});

// Create MCP server
router.post('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = createMcpServerSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const { name, type, command, args, url, env, enabled } = parsed.data;

  // Validate type-specific fields
  if (type === 'subprocess' && !command) {
    throw new AppError('Command is required for subprocess type', 400, 'MISSING_COMMAND');
  }
  if (type === 'sse' && !url) {
    throw new AppError('URL is required for SSE type', 400, 'MISSING_URL');
  }

  const db = getDatabase();
  const serverId = nanoid();

  db.prepare(
    `INSERT INTO mcp_servers (id, user_id, name, type, command, args, url, env, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    serverId,
    userId,
    name,
    type,
    command || null,
    args ? JSON.stringify(args) : null,
    url || null,
    env ? JSON.stringify(env) : null,
    enabled !== false ? 1 : 0
  );

  const row = db
    .prepare(
      `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE id = ?`
    )
    .get(serverId) as Record<string, unknown>;

  res.status(201).json({ success: true, data: parseMcpServer(row) });
});

// Update MCP server
router.put('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateMcpServerSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const existing = db
    .prepare('SELECT id FROM mcp_servers WHERE id = ? AND user_id = ?')
    .get(req.params.id, userId);

  if (!existing) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  const { name, type, command, args, url, env, enabled } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (type !== undefined) {
    updates.push('type = ?');
    values.push(type);
  }
  if (command !== undefined) {
    updates.push('command = ?');
    values.push(command);
  }
  if (args !== undefined) {
    updates.push('args = ?');
    values.push(JSON.stringify(args));
  }
  if (url !== undefined) {
    updates.push('url = ?');
    values.push(url);
  }
  if (env !== undefined) {
    updates.push('env = ?');
    values.push(JSON.stringify(env));
  }
  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE mcp_servers SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  }

  const row = db
    .prepare(
      `SELECT id, user_id, name, type, command, args, url, env, enabled, created_at
       FROM mcp_servers WHERE id = ?`
    )
    .get(req.params.id) as Record<string, unknown>;

  res.json({ success: true, data: parseMcpServer(row) });
});

// Delete MCP server
router.delete('/:id', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  const result = db
    .prepare('DELETE FROM mcp_servers WHERE id = ? AND user_id = ?')
    .run(req.params.id, userId);

  if (result.changes === 0) {
    throw new AppError('MCP server not found', 404, 'NOT_FOUND');
  }

  res.json({ success: true });
});

export default router;
