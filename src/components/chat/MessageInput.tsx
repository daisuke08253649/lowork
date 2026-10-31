import type { FormEvent, KeyboardEvent, ReactNode } from "react";
import { SendHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type MessageInputProps = {
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  // 入力欄の枠内左下に並べる操作（モデル選択・実行モード切替など）
  toolbar?: ReactNode;
  value: string;
};

export function MessageInput({
  disabled = false,
  onChange,
  onSubmit,
  toolbar,
  value,
}: MessageInputProps) {
  const canSubmit = !disabled && value.trim().length > 0;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (canSubmit) {
      onSubmit();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.nativeEvent.isComposing) {
      return;
    }

    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      if (canSubmit) {
        onSubmit();
      }
    }
  }

  return (
    <form
      className="rounded-xl border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
      onSubmit={submit}
    >
      <Textarea
        aria-label="メッセージ"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder="メッセージを入力...（Enterで改行、Shift+Enterで送信）"
        className="max-h-[40vh] min-h-24 resize-none overflow-y-auto border-0 bg-transparent px-3 pt-3 focus-visible:ring-0 disabled:bg-transparent dark:bg-transparent dark:disabled:bg-transparent"
        value={value}
      />
      <div className="flex items-end justify-between gap-2 px-2 pb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {toolbar}
        </div>
        <Button
          aria-label="送信"
          disabled={!canSubmit}
          size="icon"
          type="submit"
        >
          <SendHorizontal aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
