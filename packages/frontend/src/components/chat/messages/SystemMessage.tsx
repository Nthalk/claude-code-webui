import { Terminal } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { MessageContent } from '../MessageContent';
import type { Message } from '@claude-code-webui/shared';

interface SystemMessageProps {
  message: Message;
}

export function SystemMessage({ message }: SystemMessageProps) {
  return (
    <div key={message.id} className="flex justify-center animate-fade-in">
      <Card className="bg-muted/50 border-muted max-w-[90%] p-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <Terminal className="w-4 h-4" />
          <span>System</span>
        </div>
        <MessageContent
          content={message.content}
          role="system"
        />
      </Card>
    </div>
  );
}