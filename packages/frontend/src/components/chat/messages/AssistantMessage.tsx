import { Card } from '@/components/ui/card';
import { MessageContent } from '../MessageContent';
import { InteractiveOptions, detectOptions, isChoicePrompt } from '../InteractiveOptions';
import { cn } from '@/lib/utils';
import { socketService } from '@/services/socket';
import type { Message } from '@claude-code-webui/shared';
import type { Session } from '@claude-code-webui/shared';

interface AssistantMessageProps {
  message: Message;
  sessionId: string;
  isTimestampVisible: boolean;
  onTimestampClick: (messageId: string | null) => void;
  sessionStatus?: Session['status'];
}

// Format timestamp iMessage-style: relative for recent, time for same day, date+time for older
function formatMessageTimestamp(timestamp: string | number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);

  // Within the last minute: show seconds ago
  if (diffSeconds < 60) {
    return diffSeconds <= 1 ? 'just now' : `${diffSeconds}s ago`;
  }

  // Within the last hour: show minutes ago
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  // Same day: show time only
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (isToday) {
    return timeStr;
  }

  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return `Yesterday, ${timeStr}`;
  }

  // Same year: show month and day with time
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + timeStr;
  }

  // Different year: show full date with time
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) + ', ' + timeStr;
}

export function AssistantMessage({
  message,
  sessionId,
  isTimestampVisible,
  onTimestampClick,
  sessionStatus = 'stopped'
}: AssistantMessageProps) {
  return (
    <div
      key={message.id}
      className={cn('flex flex-col animate-fade-in w-full items-start')}
    >
      {/* Timestamp - shown when message is clicked */}
      <div
        className={cn(
          'text-xs text-muted-foreground/70 mb-1 transition-all duration-200',
          isTimestampVisible ? 'opacity-100 h-auto' : 'opacity-0 h-0 overflow-hidden'
        )}
      >
        {formatMessageTimestamp(message.createdAt)}
      </div>
      <div className="flex w-full justify-start">
        <Card
          className={cn(
            'p-2 md:p-3 cursor-pointer max-w-[calc(100vw-2rem)] md:max-w-none overflow-hidden',
            'bg-card rounded-bl-sm'
          )}
          onClick={() => onTimestampClick(isTimestampVisible ? null : message.id)}
        >
          <MessageContent
            content={message.content}
            role="assistant"
          />
          {/* Interactive options for assistant messages with choices */}
          {isChoicePrompt(message.content) && (() => {
            const options = detectOptions(message.content);
            return options ? (
              <InteractiveOptions
                options={options}
                onSelect={(selected) => {
                  if (sessionId) {
                    socketService.sendMessage(sessionId, selected);
                  }
                }}
                disabled={sessionStatus !== 'running'}
              />
            ) : null;
          })()}
        </Card>
      </div>
    </div>
  );
}