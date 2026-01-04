import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { getDatabase } from '../db';
import { AppError } from '../middleware/errorHandler';
import type { UserSettings, Theme } from '@claude-code-webui/shared';

const router = Router();

const updateSettingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional(),
  defaultWorkingDir: z.string().nullable().optional(),
  allowedTools: z.array(z.string()).optional(),
  customSystemPrompt: z.string().nullable().optional(),
});

// Get user settings
router.get('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  let settings = db
    .prepare(
      `SELECT user_id as userId, theme, default_working_dir as defaultWorkingDir,
              allowed_tools as allowedTools, custom_system_prompt as customSystemPrompt
       FROM user_settings WHERE user_id = ?`
    )
    .get(userId) as { userId: string; theme: Theme; defaultWorkingDir: string | null; allowedTools: string; customSystemPrompt: string | null } | undefined;

  if (!settings) {
    // Create default settings
    db.prepare(
      `INSERT INTO user_settings (user_id, theme, allowed_tools)
       VALUES (?, 'dark', '["Bash","Read","Write","Edit","Glob","Grep"]')`
    ).run(userId);

    settings = {
      userId,
      theme: 'dark',
      defaultWorkingDir: null,
      allowedTools: '["Bash","Read","Write","Edit","Glob","Grep"]',
      customSystemPrompt: null,
    };
  }

  const userSettings: UserSettings = {
    userId: settings.userId,
    theme: settings.theme,
    defaultWorkingDir: settings.defaultWorkingDir,
    allowedTools: JSON.parse(settings.allowedTools || '[]'),
    customSystemPrompt: settings.customSystemPrompt,
  };

  res.json({ success: true, data: userSettings });
});

// Update user settings
router.put('/', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateSettingsSchema.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError('Invalid input', 400, 'VALIDATION_ERROR');
  }

  const db = getDatabase();
  const { theme, defaultWorkingDir, allowedTools, customSystemPrompt } = parsed.data;

  const updates: string[] = [];
  const values: unknown[] = [];

  if (theme !== undefined) {
    updates.push('theme = ?');
    values.push(theme);
  }
  if (defaultWorkingDir !== undefined) {
    updates.push('default_working_dir = ?');
    values.push(defaultWorkingDir);
  }
  if (allowedTools !== undefined) {
    updates.push('allowed_tools = ?');
    values.push(JSON.stringify(allowedTools));
  }
  if (customSystemPrompt !== undefined) {
    updates.push('custom_system_prompt = ?');
    values.push(customSystemPrompt);
  }

  if (updates.length > 0) {
    values.push(userId);
    db.prepare(`UPDATE user_settings SET ${updates.join(', ')} WHERE user_id = ?`).run(...values);
  }

  // Fetch updated settings
  const settings = db
    .prepare(
      `SELECT user_id as userId, theme, default_working_dir as defaultWorkingDir,
              allowed_tools as allowedTools, custom_system_prompt as customSystemPrompt
       FROM user_settings WHERE user_id = ?`
    )
    .get(userId) as { userId: string; theme: Theme; defaultWorkingDir: string | null; allowedTools: string; customSystemPrompt: string | null };

  const userSettings: UserSettings = {
    userId: settings.userId,
    theme: settings.theme,
    defaultWorkingDir: settings.defaultWorkingDir,
    allowedTools: JSON.parse(settings.allowedTools || '[]'),
    customSystemPrompt: settings.customSystemPrompt,
  };

  res.json({ success: true, data: userSettings });
});

// Update API key
router.put('/api-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { apiKey } = req.body;

  if (!apiKey) {
    throw new AppError('API key is required', 400, 'MISSING_API_KEY');
  }

  // TODO: Encrypt the API key before storing
  // For now, store as-is (in production, use proper encryption)
  const db = getDatabase();
  db.prepare('UPDATE users SET api_key_encrypted = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    apiKey,
    userId
  );

  res.json({ success: true });
});

// Delete API key
router.delete('/api-key', requireAuth, (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const db = getDatabase();

  db.prepare('UPDATE users SET api_key_encrypted = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    userId
  );

  res.json({ success: true });
});

export default router;
