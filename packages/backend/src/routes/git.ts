import { Router } from 'express';
import simpleGit, { SimpleGit } from 'simple-git';
import path from 'path';
import { requireAuth } from '../middleware/auth';
import { AppError, asyncHandler } from '../middleware/errorHandler';
import { config } from '../config';
import type { GitStatus, GitBranch, GitCommit } from '@claude-code-webui/shared';

const router = Router();

// Validate path
function validatePath(filePath: string): string {
  const resolvedPath = path.resolve(filePath);
  const isAllowed = config.allowedBasePaths.some((base) => resolvedPath.startsWith(base));

  if (!isAllowed) {
    throw new AppError('Path not allowed', 403, 'FORBIDDEN_PATH');
  }

  return resolvedPath;
}

// Get git instance for path
function getGit(repoPath: string): SimpleGit {
  const resolvedPath = validatePath(repoPath);
  return simpleGit(resolvedPath);
}

// Get git status
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const repoPath = req.query.path as string;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const status = await git.status();

    const gitStatus: GitStatus = {
      branch: status.current || 'HEAD',
      isClean: status.isClean(),
      staged: status.staged,
      unstaged: status.modified,
      untracked: status.not_added,
    };

    res.json({ success: true, data: gitStatus });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
}));

// Get branches
router.get('/branches', requireAuth, asyncHandler(async (req, res) => {
  const repoPath = req.query.path as string;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const branchSummary = await git.branch(['-a']);

    const branches: GitBranch[] = Object.entries(branchSummary.branches).map(([name, info]) => ({
      name,
      isCurrent: info.current,
      isRemote: name.startsWith('remotes/'),
    }));

    res.json({ success: true, data: branches });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
}));

// Get commit log
router.get('/log', requireAuth, asyncHandler(async (req, res) => {
  const repoPath = req.query.path as string;
  const limit = parseInt(req.query.limit as string) || 10;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const log = await git.log({ maxCount: limit });

    const commits: GitCommit[] = log.all.map((commit) => ({
      hash: commit.hash,
      shortHash: commit.hash.substring(0, 7),
      message: commit.message,
      author: commit.author_name,
      date: commit.date,
    }));

    res.json({ success: true, data: commits });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
}));

// Checkout branch
router.post('/checkout', requireAuth, asyncHandler(async (req, res) => {
  const { path: repoPath, branch } = req.body;

  if (!repoPath || !branch) {
    throw new AppError('Path and branch are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);
    await git.checkout(branch);

    res.json({ success: true, data: { branch } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    if ((err as Error).message.includes('did not match')) {
      throw new AppError('Branch not found', 404, 'BRANCH_NOT_FOUND');
    }
    throw err;
  }
}));

// Get diff
router.get('/diff', requireAuth, asyncHandler(async (req, res) => {
  const repoPath = req.query.path as string;
  const file = req.query.file as string | undefined;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const diff = file ? await git.diff([file]) : await git.diff();

    res.json({ success: true, data: { diff } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
}));

// Get staged diff
router.get('/diff-staged', requireAuth, asyncHandler(async (req, res) => {
  const repoPath = req.query.path as string;
  const file = req.query.file as string | undefined;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);
    const diffArgs = ['--cached'];
    if (file) {
      diffArgs.push(file);
    }
    const diff = await git.diff(diffArgs);

    res.json({ success: true, data: { diff } });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
}));

// Get file diff with details
router.get('/diff-file', requireAuth, asyncHandler(async (req, res) => {
  const repoPath = req.query.path as string;
  const file = req.query.file as string;
  const staged = req.query.staged === 'true';

  if (!repoPath || !file) {
    throw new AppError('Path and file are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);
    const diffArgs = staged ? ['--cached', file] : [file];
    const diff = await git.diff(diffArgs);

    // Parse diff to count additions and deletions
    const lines = diff.split('\n');
    let additions = 0;
    let deletions = 0;

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }

    res.json({
      success: true,
      data: {
        file,
        diff,
        additions,
        deletions,
        staged,
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
}));

// Stage files
router.post('/stage', requireAuth, asyncHandler(async (req, res) => {
  const { path: repoPath, files } = req.body;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    if (files && Array.isArray(files) && files.length > 0) {
      // Stage specific files
      await git.add(files);
    } else {
      // Stage all changes
      await git.add('.');
    }

    // Return updated status
    const status = await git.status();

    res.json({
      success: true,
      data: {
        staged: status.staged,
        unstaged: status.modified,
        untracked: status.not_added,
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
}));

// Unstage files
router.post('/unstage', requireAuth, asyncHandler(async (req, res) => {
  const { path: repoPath, files } = req.body;

  if (!repoPath) {
    throw new AppError('Path is required', 400, 'MISSING_PATH');
  }

  try {
    const git = getGit(repoPath);

    if (files && Array.isArray(files) && files.length > 0) {
      // Unstage specific files
      await git.reset(['HEAD', '--', ...files]);
    } else {
      // Unstage all
      await git.reset(['HEAD']);
    }

    // Return updated status
    const status = await git.status();

    res.json({
      success: true,
      data: {
        staged: status.staged,
        unstaged: status.modified,
        untracked: status.not_added,
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
}));

// Create commit
router.post('/commit', requireAuth, asyncHandler(async (req, res) => {
  const { path: repoPath, message } = req.body;

  if (!repoPath || !message) {
    throw new AppError('Path and message are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);

    // Check if there are staged changes
    const status = await git.status();
    if (status.staged.length === 0) {
      throw new AppError('No changes staged for commit', 400, 'NO_STAGED_CHANGES');
    }

    // Create the commit
    const result = await git.commit(message);

    res.json({
      success: true,
      data: {
        hash: result.commit,
        summary: {
          changes: result.summary.changes,
          insertions: result.summary.insertions,
          deletions: result.summary.deletions,
        },
      },
    });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
}));

// Discard changes to a file
router.post('/discard', requireAuth, asyncHandler(async (req, res) => {
  const { path: repoPath, file } = req.body;

  if (!repoPath || !file) {
    throw new AppError('Path and file are required', 400, 'MISSING_PARAMS');
  }

  try {
    const git = getGit(repoPath);
    await git.checkout(['--', file]);

    res.json({ success: true });
  } catch (err) {
    if ((err as Error).message.includes('not a git repository')) {
      throw new AppError('Not a git repository', 400, 'NOT_GIT_REPO');
    }
    throw err;
  }
}));

export default router;
