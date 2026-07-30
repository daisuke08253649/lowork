import { useEffect, useRef } from "react";

import { ChatBubble } from "@/components/chat/ChatBubble";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type MessageListProps = {
  messages: ChatMessage[];
};

export function MessageList({ messages }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-y-auto px-6 py-8"
      role="log"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {messages.map((message) => (
          <ChatBubble
            key={message.id}
            content={message.content}
            role={message.role}
          />
        ))}
      </div>
    </div>
  );
}
