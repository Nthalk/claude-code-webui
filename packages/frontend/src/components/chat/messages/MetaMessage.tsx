import { Loader, CheckCircle, PlayCircle, RotateCcw, Terminal } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { MessageContent } from '../MessageContent';
import type { Message } from '@claude-code-webui/shared';

interface MetaMessageProps {
  message: Message;
}

export function MetaMessage({ message }: MetaMessageProps) {
  return (
    <div key={message.id}>
      <div className="flex items-center gap-4 py-4 px-4 animate-fade-in">
        <div className="flex-1 h-px bg-border" />
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {message.metaType === 'compact' && message.metaData && (
            <>
              {(message.metaData as any).isActive ? (
                <>
                  <Loader className="h-3 w-3 text-blue-500 animate-spin" />
                  <span className="text-blue-500">Compacting conversation...</span>
                </>
              ) : (
                <>
                  <CheckCircle className="h-3 w-3 text-blue-500" />
                  <span>
                    Compacted from {((message.metaData as any).startContext || 0).toLocaleString()} to{' '}
                    {((message.metaData as any).endContext || 0).toLocaleString()} tokens
                    {(message.metaData as any).duration && (
                      <> ({((message.metaData as any).duration / 1000).toFixed(1)}s)</>
                    )}
                  </span>
                </>
              )}
            </>
          )}
          {message.metaType === 'resume' && (
            <>
              <PlayCircle className="h-3 w-3 text-green-500" />
              <span className="text-green-500">Conversation resumed</span>
            </>
          )}
          {message.metaType === 'restart' && (
            <>
              <RotateCcw className="h-3 w-3 text-orange-500" />
              <span className="text-orange-500">Session restarted</span>
            </>
          )}
          {message.metaType === 'command_output' && (
            <>
              <Terminal className="h-3 w-3 text-blue-500" />
              <span className="text-blue-500">Command Output</span>
            </>
          )}
        </div>
        <div className="flex-1 h-px bg-border" />
      </div>
      {/* Command output content */}
      {message.metaType === 'command_output' && message.metaData && (
        <div className="mt-2 px-4 pb-4 w-full">
          <Card className="p-4 bg-muted/50">
            <MessageContent
              content={(message.metaData as any).output}
              role="system"
              className="text-sm"
            />
          </Card>
        </div>
      )}
    </div>
  );
}