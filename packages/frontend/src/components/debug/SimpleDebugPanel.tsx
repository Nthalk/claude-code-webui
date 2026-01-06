import { Bug } from 'lucide-react';

export function SimpleDebugPanel() {
  return (
    <div className="h-full flex flex-col bg-background p-4">
      <div className="flex items-center gap-2 mb-4">
        <Bug className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Debug Panel</h2>
      </div>
      <div className="text-center p-8 border-2 border-dashed border-primary rounded-lg">
        <p className="text-lg">Debug panel is working!</p>
        <p className="text-sm text-muted-foreground mt-2">
          If you can see this, the panel is rendering correctly.
        </p>
      </div>
    </div>
  );
}