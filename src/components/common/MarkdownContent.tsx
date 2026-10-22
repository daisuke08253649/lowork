import ReactMarkdown from "react-markdown";

import { cn } from "@/lib/utils";

type MarkdownContentProps = {
  codeBackgroundClass: string;
  content: string;
};

// チャット応答やプロジェクトのファイルなど、信頼できないMarkdownを描画する。
// 生のHTMLは描画せず、リンクはテキストに、画像は非表示にして外部への読み込みを防ぐ。
export function MarkdownContent({
  codeBackgroundClass,
  content,
}: MarkdownContentProps) {
  return (
    <ReactMarkdown
      components={{
        a: ({ children }) => <span>{children}</span>,
        img: () => null,
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => (
          <ul className="mb-2 list-inside list-disc last:mb-0">{children}</ul>
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
  );
}
