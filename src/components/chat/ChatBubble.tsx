import { MarkdownContent } from "@/components/common/MarkdownContent";
import { cn } from "@/lib/utils";

type ChatBubbleProps = {
  content: string;
  role: "user" | "assistant";
};

export function ChatBubble({ content, role }: ChatBubbleProps) {
  const isUser = role === "user";
  const codeBackgroundClass = isUser
    ? "bg-primary-foreground/10"
    : "bg-foreground/10";

  return (
    <article className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-6",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        <MarkdownContent
          codeBackgroundClass={codeBackgroundClass}
          content={content}
        />
      </div>
    </article>
  );
}
