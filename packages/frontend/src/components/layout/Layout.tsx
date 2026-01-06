import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar, type RightPanelTab } from './Sidebar';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useSessionStore } from '@/stores/sessionStore';

export function Layout() {
  const location = useLocation();
  const { rightPanelTab, setRightPanelTab, todos, setMobileView, mobileMenuOpen, setMobileMenuOpen } = useSessionStore();

  // Check if we're on a session page
  const isSessionPage = location.pathname.startsWith('/session/');
  const sessionId = isSessionPage ? location.pathname.split('/session/')[1] : null;

  // Get pending task count for current session
  const currentTodos = sessionId ? (todos[sessionId] || []) : [];
  const pendingTaskCount = currentTodos.filter(t => t.status !== 'completed').length;

  // Close mobile menu on navigation
  const handleNavigation = () => {
    setMobileMenuOpen(false);
  };

  const handleRightPanelTabChange = (tab: RightPanelTab) => {
    setRightPanelTab(tab);
    // Sync mobile view when changing panel tab
    if (tab === 'files') setMobileView('files');
    else if (tab === 'git') setMobileView('git');
    else if (tab === 'debug') setMobileView('debug');
    else setMobileView('chat'); // If closing panel, go back to chat
    // Close mobile menu after selection
    setMobileMenuOpen(false);
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
