import { Card } from '@/components/ui/card';
import { MessageContent } from '../MessageContent';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/authStore';
import type { Message, MessageImage } from '@claude-code-webui/shared';

interface UserMessageProps {
  message: Message;
  sessionId: string;
  isTimestampVisible: boolean;
  onTimestampClick: (messageId: string | null) => void;
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

export function UserMessage({ message, sessionId, isTimestampVisible, onTimestampClick }: UserMessageProps) {
  return (
    <div
      key={message.id}
      className={cn('flex flex-col animate-fade-in w-full items-end')}
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
      <div className="flex w-full justify-end">
        <Card
          className={cn(
            'p-2 md:p-3 cursor-pointer select-none max-w-[calc(100vw-2rem)] md:max-w-none overflow-hidden',
            'bg-primary text-primary-foreground rounded-br-sm border-primary',
            message.isPending && 'opacity-70'
          )}
          onClick={() => onTimestampClick(isTimestampVisible ? null : message.id)}
        >
          {/* Image thumbnails for user messages */}
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {message.images.map((img: MessageImage, imgIndex: number) => {
                const token = useAuthStore.getState().token || '';
                const imageUrl = `/api/sessions/${sessionId}/images/${img.filename}?token=${encodeURIComponent(token)}`;
                return (
                  <img
                    key={imgIndex}
                    src={imageUrl}
                    alt={`Attachment ${imgIndex + 1}`}
                    className="max-h-32 max-w-48 rounded-lg border border-primary-foreground/20 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.open(imageUrl, '_blank');
                    }}
                  />
                );
              })}
            </div>
          )}
          <MessageContent
            content={message.content}
            role="user"
          />
        </Card>
        {/* iMessage-style tail for user messages */}
        <div className="flex-shrink-0 self-end mb-1" style={{ marginLeft: '-1px' }}>
          <svg viewBox="0 0 8 13" className="w-2 h-3 text-primary fill-current">
            <path d="M8 0 L0 0 L0 13 C0 13 0 6 8 0" />
          </svg>
        </div>
      </div>
    </div>
  );
}