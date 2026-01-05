import { Outlet, Link, useLocation } from 'react-router-dom';
import { Menu, Plus, MessageSquare, FolderTree, GitBranch, Code2, ListTodo, ChevronDown } from 'lucide-react';
import { Sidebar, type RightPanelTab } from './Sidebar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useSessionStore } from '@/stores/sessionStore';
import { cn } from '@/lib/utils';
import type { MobileView } from '@/components/mobile';

// Mobile view items for session pages
const mobileViewItems: { id: MobileView; icon: React.ElementType; label: string }[] = [
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
  { id: 'files', icon: FolderTree, label: 'Files' },
  { id: 'todos', icon: ListTodo, label: 'Tasks' },
  { id: 'git', icon: GitBranch, label: 'Git' },
  { id: 'editor', icon: Code2, label: 'Editor' },
];

export function Layout() {
  const location = useLocation();
  const { rightPanelTab, setRightPanelTab, todos, openFiles, mobileView, setMobileView, mobileMenuOpen, setMobileMenuOpen } = useSessionStore();

  // Check if we're on a session page
  const isSessionPage = location.pathname.startsWith('/session/');
  const sessionId = isSessionPage ? location.pathname.split('/session/')[1] : null;

  // Get pending task count for current session
  const currentTodos = sessionId ? (todos[sessionId] || []) : [];
  const pendingTaskCount = currentTodos.filter(t => t.status !== 'completed').length;

  // Check if there are open files in editor
  const currentOpenFiles = sessionId ? (openFiles[sessionId] || []) : [];
  const hasOpenFiles = currentOpenFiles.length > 0;

  // Get active view item (defaulting to first item which is always 'chat')
  const activeViewItem = mobileViewItems.find(v => v.id === mobileView) ?? mobileViewItems[0]!;
  const ActiveIcon = activeViewItem.icon;

  // Close mobile menu on navigation
  const handleNavigation = () => {
    setMobileMenuOpen(false);
  };

  const handleRightPanelTabChange = (tab: RightPanelTab) => {
    setRightPanelTab(tab);
    // Sync mobile view when changing panel tab
    if (tab === 'files') setMobileView('files');
    else if (tab === 'todos') setMobileView('todos');
    else if (tab === 'git') setMobileView('git');
    else setMobileView('chat'); // If closing panel, go back to chat
    // Close mobile menu after selection
    setMobileMenuOpen(false);
  };

  const handleMobileViewChange = (view: MobileView) => {
    setMobileView(view);
    // Sync right panel tab with mobile view
    if (view === 'files') setRightPanelTab('files');
    else if (view === 'todos') setRightPanelTab('todos');
    else if (view === 'git') setRightPanelTab('git');
  };

  return (
    <div className="flex h-dvh bg-background pattern-bg overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden md:block shrink-0">
        <Sidebar
          rightPanelTab={isSessionPage ? rightPanelTab : undefined}
          onRightPanelTabChange={isSessionPage ? handleRightPanelTabChange : undefined}
          pendingTaskCount={pendingTaskCount}
        />
      </div>

      {/* Mobile Sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="p-0 w-72">
          <Sidebar
            onNavigate={handleNavigation}
            mobile
            rightPanelTab={isSessionPage ? rightPanelTab : undefined}
            onRightPanelTabChange={isSessionPage ? handleRightPanelTabChange : undefined}
            pendingTaskCount={pendingTaskCount}
          />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile Header - temporarily hidden for debugging */}
        <header className="hidden md:hidden flex items-center justify-between h-14 px-4 border-b bg-card/80 backdrop-blur-sm shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
            className="h-9 w-9"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Center: Logo on non-session pages, View Dropdown on session pages */}
          {isSessionPage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 gap-2 px-3">
                  <ActiveIcon className="h-4 w-4" />
                  <span className="font-medium text-sm">{activeViewItem.label}</span>
                  <ChevronDown className="h-3 w-3 opacity-50" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="center" className="w-40">
                {mobileViewItems
                  .filter(item => item.id !== 'editor' || hasOpenFiles)
                  .map((item) => {
                    const Icon = item.icon;
                    const isActive = mobileView === item.id;
                    const badge = item.id === 'todos' && pendingTaskCount > 0 ? pendingTaskCount : null;
                    return (
                      <DropdownMenuItem
                        key={item.id}
                        onClick={() => handleMobileViewChange(item.id)}
                        className={cn(
                          "flex items-center gap-2 cursor-pointer",
                          isActive && "bg-primary/10 text-primary"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span className="flex-1">{item.label}</span>
                        {badge && (
                          <span className="px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-blue-500 text-white">
                            {badge > 9 ? '9+' : badge}
                          </span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Link to="/" className="flex items-center gap-2">
              <img
                src="/claude-logo.png"
                alt="Claude"
                className="h-7 w-7 object-contain"
              />
              <span className="font-semibold text-sm">Claude Code</span>
            </Link>
          )}

          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-9 w-9"
          >
            <Link to="/?new=true">
              <Plus className="h-5 w-5" />
            </Link>
          </Button>
        </header>

        {/* Page Content */}
        <main
          className="flex-1 overflow-hidden pt-2 md:p-6 flex flex-col min-h-0"
          style={{
            paddingLeft: 'max(0.5rem, env(safe-area-inset-left))',
            paddingRight: 'max(0.5rem, env(safe-area-inset-right))',
            paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
          }}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
