import ReactMarkdown from "react-markdown";

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
        <ReactMarkdown
          components={{
            a: ({ children }) => <span>{children}</span>,
            img: () => null,
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ul: ({ children }) => (
              <ul className="mb-2 list-inside list-disc last:mb-0">
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol className="mb-2 list-inside list-decimal last:mb-0">
                {children}
              </ol>
            ),
            pre: ({ children }) => (
              <pre
                className={cn(
                  "mb-2 overflow-x-auto rounded-lg p-3 last:mb-0 [&>code]:rounded-none [&>code]:bg-transparent [&>code]:p-0",
                  codeBackgroundClass,
                )}
              >
                {children}
              </pre>
            ),
            code: ({ children, className }) => (
              <code
                className={cn(
                  "rounded px-1 py-0.5 font-mono text-[0.85em]",
                  codeBackgroundClass,
                  className,
                )}
              >
                {children}
              </code>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </article>
  );
}
