import { useEffect, useRef } from "react";

import { ChatBubble } from "@/components/chat/ChatBubble";
import type { ChatMessage } from "@/types/chat";

type MessageListProps = {
  isStreaming: boolean;
  messages: ChatMessage[];
};

export function MessageList({ isStreaming, messages }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldFollowLatestRef = useRef(true);
  const wasStreamingRef = useRef(false);

  useEffect(() => {
    const container = scrollRef.current;
    if (isStreaming && !wasStreamingRef.current) {
      shouldFollowLatestRef.current = true;
    }
    wasStreamingRef.current = isStreaming;

    if (container && shouldFollowLatestRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [isStreaming, messages]);

  function handleScroll(): void {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    shouldFollowLatestRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      64;
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-6 py-8"
      role="log"
      onScroll={handleScroll}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {messages.map((message) => (
          <ChatBubble
            key={message.id}
            content={message.content}
            role={message.role}
          />
        ))}
        <ChatCompletionAnnouncement
          isStreaming={isStreaming}
          messages={messages}
        />
      </div>
    </div>
  );
}

type ChatCompletionAnnouncementProps = {
  isStreaming: boolean;
  messages: ChatMessage[];
};

function ChatCompletionAnnouncement({
  isStreaming,
  messages,
}: ChatCompletionAnnouncementProps) {
  const latestMessage = messages[messages.length - 1];
  const announcement =
    !isStreaming && latestMessage?.role === "assistant"
      ? `AIの応答: ${latestMessage.content}`
      : "";

  return (
    <p aria-atomic="true" aria-live="polite" className="sr-only" role="status">
      {announcement}
    </p>
  );
}
