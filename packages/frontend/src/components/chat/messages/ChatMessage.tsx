import { Message, Session } from '@claude-code-webui/shared';
import { MetaMessage } from './MetaMessage';
import { SystemMessage } from './SystemMessage';
import { UserMessage } from './UserMessage';
import { AssistantMessage } from './AssistantMessage';

interface ChatMessageProps {
  message: Message;
  sessionId: string;
  visibleTimestamp: string | null;
  onTimestampClick: (messageId: string | null) => void;
  sessionStatus?: Session['status'];
}

export function ChatMessage({ message, sessionId, visibleTimestamp, onTimestampClick, sessionStatus }: ChatMessageProps) {
  // Handle meta messages (compact/resume/restart/command_output)
  if (message.role === 'meta') {
    return <MetaMessage message={message} />;
  }

  // Handle system messages
  if (message.role === 'system') {
    return <SystemMessage message={message} />;
  }

  // Handle user messages
  if (message.role === 'user') {
    return (
      <UserMessage
        message={message}
        sessionId={sessionId}
        isTimestampVisible={visibleTimestamp === message.id}
        onTimestampClick={onTimestampClick}
      />
    );
  }

  // Handle assistant messages
  return (
    <AssistantMessage
      message={message}
      sessionId={sessionId}
      isTimestampVisible={visibleTimestamp === message.id}
      onTimestampClick={onTimestampClick}
      sessionStatus={sessionStatus}
    />
  );
}