import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { requireAuth } from '../middleware/auth';
import { asyncHandler, AppError } from '../middleware/errorHandler';
import { getDatabase } from '../db';
import { nanoid } from 'nanoid';
import type { Project } from '@claude-code-webui/shared';

const router = Router();

// Path where Claude Code stores its project data
const getClaudeProjectsDir = () => path.join(os.homedir(), '.claude', 'projects');

/**
 * Decode Claude's path encoding format
 * Claude encodes paths by replacing slashes with hyphens
 * e.g., "-Users-name-project" → "/Users/name/project"
 * e.g., "-mnt-data-projects-myapp" → "/mnt/data/projects/myapp"
 */
function decodeClaudePath(encodedPath: string): string {
  // The format is: -path-to-directory (leading hyphen, hyphens as separators)
  // Convert hyphens back to slashes, but be careful about the leading one
  if (!encodedPath.startsWith('-')) {
    // If it doesn't start with hyphen, it might be a different format
    return encodedPath;
  }

  // Replace leading hyphen with slash, then remaining hyphens with slashes
  return encodedPath.replace(/-/g, '/');
}

/**
 * Extract project name from path
 */
function getProjectName(projectPath: string): string {
  return path.basename(projectPath);
}

// Get all projects (from database and discovered)
router.get('/', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as any).userId;
  const db = getDatabase();

  // Get all projects from database
  const dbProjects = db.prepare(`
    SELECT
      p.*,
      COUNT(DISTINCT s.id) as sessionCount,
      SUM(tu.total_tokens) as totalTokens,
      SUM(tu.total_cost_usd) as totalCostUsd
    FROM projects p
    LEFT JOIN sessions s ON s.project_id = p.id
    LEFT JOIN token_usage tu ON tu.session_id = s.id
    WHERE p.user_id = ?
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `).all(userId) as any[];

  // Convert database projects to API format
  const projectsMap = new Map<string, Project>();

  for (const dbProject of dbProjects) {
    const project: Project = {
      id: dbProject.id,
      userId: dbProject.user_id,
      name: dbProject.name,
      path: dbProject.path,
      claudeProjectPath: dbProject.claude_project_path,
      isDiscovered: dbProject.is_discovered === 1,
      createdAt: dbProject.created_at,
      updatedAt: dbProject.updated_at,
      sessionCount: dbProject.sessionCount || 0,
      totalTokens: dbProject.totalTokens || 0,
      totalCostUsd: dbProject.totalCostUsd || 0,
    };
    projectsMap.set(dbProject.path, project);
  }

  // Scan for discovered projects
  const projectsDir = getClaudeProjectsDir();
  try {
    // Check if the projects directory exists
    await fs.access(projectsDir);

    // Read all directories in ~/.claude/projects
    const entries = await fs.readdir(projectsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const claudeProjectPath = path.join(projectsDir, entry.name);
      const decodedPath = decodeClaudePath(entry.name);

      try {
        // Check if the original project path still exists
        await fs.access(decodedPath);

        // Get stats for the project directory
        const stats = await fs.stat(claudeProjectPath);

        // If project doesn't exist in database, add it
        if (!projectsMap.has(decodedPath)) {
          const projectId = nanoid();

          // Insert into database
          db.prepare(`
            INSERT INTO projects (id, user_id, name, path, claude_project_path, is_discovered, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 1, ?, ?)
          `).run(
            projectId,
            userId,
            getProjectName(decodedPath),
            decodedPath,
            claudeProjectPath,
            stats.mtime.toISOString(),
            stats.mtime.toISOString()
          );

          // Add to map
          const project: Project = {
            id: projectId,
            userId,
            name: getProjectName(decodedPath),
            path: decodedPath,
            claudeProjectPath,
            isDiscovered: true,
            createdAt: stats.mtime.toISOString(),
            updatedAt: stats.mtime.toISOString(),
            sessionCount: 0,
            totalTokens: 0,
            totalCostUsd: 0,
          };
          projectsMap.set(decodedPath, project);
        } else {
          // Update existing project with discovered status
          const existingProject = projectsMap.get(decodedPath)!;
          if (!existingProject.isDiscovered) {
            db.prepare(`
              UPDATE projects
              SET is_discovered = 1, claude_project_path = ?, updated_at = CURRENT_TIMESTAMP
              WHERE id = ?
            `).run(claudeProjectPath, existingProject.id);

            existingProject.isDiscovered = true;
            existingProject.claudeProjectPath = claudeProjectPath;
          }
        }
      } catch (err) {
        // Skip directories we can't read or that no longer exist
        console.warn(`Could not read project directory ${entry.name}:`, err);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error('Error scanning projects directory:', err);
    }
  }

  // Convert map to array and sort by updated date
  const projects = Array.from(projectsMap.values()).sort((a, b) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  res.json({ success: true, data: projects });
}));

// Get project with sessions and token usage
router.get('/:projectId', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as any).userId;
  const projectId = req.params.projectId;
  const db = getDatabase();

  // Get project
  const project = db.prepare(`
    SELECT * FROM projects WHERE id = ? AND user_id = ?
  `).get(projectId, userId) as any;

  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  // Get sessions with token usage
  const sessions = db.prepare(`
    SELECT
      s.*,
      tu.input_tokens,
      tu.output_tokens,
      tu.cache_read_tokens,
      tu.cache_creation_tokens,
      tu.total_tokens,
      tu.total_cost_usd
    FROM sessions s
    LEFT JOIN (
      SELECT
        session_id,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cache_read_tokens) as cache_read_tokens,
        SUM(cache_creation_tokens) as cache_creation_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(total_cost_usd) as total_cost_usd
      FROM token_usage
      GROUP BY session_id
    ) tu ON tu.session_id = s.id
    WHERE s.project_id = ?
    ORDER BY s.updated_at DESC
  `).all(projectId) as any[];

  // Calculate totals
  const totalTokens = sessions.reduce((sum, s) => sum + (s.total_tokens || 0), 0);
  const totalCostUsd = sessions.reduce((sum, s) => sum + (s.total_cost_usd || 0), 0);

  // Format response
  const projectData: Project = {
    id: project.id,
    userId: project.user_id,
    name: project.name,
    path: project.path,
    claudeProjectPath: project.claude_project_path,
    isDiscovered: project.is_discovered === 1,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    sessionCount: sessions.length,
    totalTokens,
    totalCostUsd,
    sessions: sessions.map(s => ({
      id: s.id,
      name: s.name,
      status: s.status,
      model: s.model || 'opus',
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      tokenUsage: s.total_tokens ? {
        inputTokens: s.input_tokens || 0,
        outputTokens: s.output_tokens || 0,
        cacheReadTokens: s.cache_read_tokens || 0,
        cacheCreationTokens: s.cache_creation_tokens || 0,
        totalTokens: s.total_tokens || 0,
        totalCostUsd: s.total_cost_usd || 0,
      } : undefined,
    })),
  };

  res.json({ success: true, data: projectData });
}));

// Create or update project
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const userId = (req as any).userId;
  const { name, path: projectPath } = req.body;
  const db = getDatabase();

  if (!name || !projectPath) {
    throw new AppError('Name and path are required', 400, 'MISSING_FIELDS');
  }

  // Check if project already exists
  const existing = db.prepare(`
    SELECT id FROM projects WHERE user_id = ? AND path = ?
  `).get(userId, projectPath) as any;

  if (existing) {
    // Update existing project
    db.prepare(`
      UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(name, existing.id);

    res.json({ success: true, data: { id: existing.id } });
  } else {
    // Create new project
    const projectId = nanoid();

    db.prepare(`
      INSERT INTO projects (id, user_id, name, path, is_discovered, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(projectId, userId, name, projectPath);

    res.json({ success: true, data: { id: projectId } });
  }
}));

export default router;