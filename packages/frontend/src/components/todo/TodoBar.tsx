import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, ChevronDown, ChevronUp } from 'lucide-react';
import type { TodoItem } from '@/stores/sessionStore';
import { cn } from '@/lib/utils';

interface TodoBarProps {
  todos: TodoItem[];
}

export function TodoBar({ todos }: TodoBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Check sidebar collapsed state from localStorage
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-left-collapsed');
    return saved === 'true';
  });

  // Listen for storage changes to sync sidebar state
  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('sidebar-left-collapsed');
      setSidebarCollapsed(saved === 'true');
    };

    window.addEventListener('storage', handleStorageChange);
    // Also listen to custom event for same-window updates
    window.addEventListener('sidebar-collapsed-changed', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('sidebar-collapsed-changed', handleStorageChange);
    };
  }, []);

  // Get the current todo and filter todos
  const currentTodo = todos.find(todo => todo.status === 'in_progress') || todos.find(todo => todo.status === 'pending');
  const incompleteTodos = todos.filter(todo => todo.status !== 'completed');
  const completedTodos = todos.filter(todo => todo.status === 'completed');

  // Hide the bar if there are no todos or all todos are completed
  if (todos.length === 0 || incompleteTodos.length === 0) {
    return null;
  }

  return (
    <>
      {/* Floating bar */}
      <div className={cn(
        "fixed top-0 right-0 z-40 pointer-events-none",
        // On mobile, full width
        "left-0",
        // On desktop, respect sidebar width
        sidebarCollapsed ? "md:left-16" : "md:left-64"
      )}>
        <div
          className={cn(
            "bg-blue-500/90 backdrop-blur-sm text-white px-4 py-2 cursor-pointer pointer-events-auto",
            "transition-all duration-300 shadow-lg",
            "animate-pulse-soft",
            isExpanded && "bg-blue-600/95"
          )}
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="max-w-screen-xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <Circle className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm font-medium truncate">
                {currentTodo?.activeForm || currentTodo?.content || 'Tasks in progress'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 bg-white/20 dark:bg-black/20 rounded-full">
                {incompleteTodos.length}
              </span>
              {isExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </div>
          </div>
        </div>

        {/* Expanded todo list */}
        {isExpanded && (
          <div className={cn(
            "bg-white dark:bg-gray-900 border-b shadow-xl pointer-events-auto",
            "transition-all duration-300"
          )}>
            <div className="max-w-screen-xl mx-auto p-4">
              {/* Active/Pending todos */}
              {incompleteTodos.length > 0 && (
                <div className="space-y-2 mb-4">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Active Tasks
                  </h3>
                  {incompleteTodos.map((todo, idx) => (
                    <div
                      key={`incomplete-${idx}`}
                      className={cn(
                        "flex items-center gap-3 p-2 rounded-lg",
                        todo.status === 'in_progress' && "bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800"
                      )}
                    >
                      <Circle
                        className={cn(
                          "w-4 h-4 flex-shrink-0",
                          todo.status === 'in_progress' && "text-blue-500 animate-pulse"
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{todo.content}</p>
                        {todo.status === 'in_progress' && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">{todo.activeForm}</p>
                        )}
                      </div>
                      {todo.status === 'in_progress' && (
                        <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">
                          In Progress
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Completed todos */}
              {completedTodos.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Completed
                    </h3>
                  </div>
                  {completedTodos.map((todo, idx) => (
                    <div
                      key={`completed-${idx}`}
                      className="flex items-center gap-3 p-2 rounded-lg opacity-60"
                    >
                      <CheckCircle2 className="w-4 h-4 flex-shrink-0 text-green-500" />
                      <p className="text-sm line-through">{todo.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </>
  );
}