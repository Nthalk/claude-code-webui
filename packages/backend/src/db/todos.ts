import { getDatabase } from './index.js';
import { TodoItem } from '@claude-code-webui/shared';
import { randomUUID } from 'crypto';

export interface DbTodo {
  id: string;
  session_id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  active_form: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * Get all todos for a session
 */
export function getTodosBySessionId(sessionId: string): TodoItem[] {
  const db = getDatabase();
  const todos = db
    .prepare(
      `SELECT content, status, active_form FROM todos
       WHERE session_id = ?
       ORDER BY sort_order ASC`
    )
    .all(sessionId) as Array<{ content: string; status: string; active_form: string | null }>;

  return todos.map((todo) => ({
    content: todo.content,
    status: todo.status as 'pending' | 'in_progress' | 'completed',
    activeForm: todo.active_form || undefined,
  }));
}

/**
 * Replace all todos for a session (used when TodoWrite tool is called)
 */
export function replaceTodos(sessionId: string, todos: TodoItem[]): void {
  const db = getDatabase();

  // Use a transaction to ensure atomicity
  db.transaction(() => {
    // Delete existing todos for this session
    db.prepare('DELETE FROM todos WHERE session_id = ?').run(sessionId);

    // Insert new todos with sort order
    const insertStmt = db.prepare(
      `INSERT INTO todos (id, session_id, content, status, active_form, sort_order, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    );

    todos.forEach((todo, index) => {
      insertStmt.run(
        randomUUID(),
        sessionId,
        todo.content,
        todo.status,
        todo.activeForm || null,
        index
      );
    });
  })();
}

/**
 * Delete all todos for a session
 */
export function deleteTodosBySessionId(sessionId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM todos WHERE session_id = ?').run(sessionId);
}

/**
 * Get count of incomplete todos for a session
 */
export function getIncompleteTodoCount(sessionId: string): number {
  const db = getDatabase();
  const result = db
    .prepare(
      `SELECT COUNT(*) as count FROM todos
       WHERE session_id = ? AND status != 'completed'`
    )
    .get(sessionId) as { count: number };

  return result.count;
}