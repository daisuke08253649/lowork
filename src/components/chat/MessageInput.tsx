import type { FormEvent, KeyboardEvent } from "react";
import { SendHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type MessageInputProps = {
  disabled?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
};

export function MessageInput({
  disabled = false,
  onChange,
  onSubmit,
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

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSubmit) {
        onSubmit();
      }
    }
  }

  return (
    <form className="flex gap-2" onSubmit={submit}>
      <Textarea
        aria-label="メッセージ"
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder="メッセージを入力..."
        value={value}
      />
      <Button
        aria-label="送信"
        className="h-auto self-stretch"
        disabled={!canSubmit}
        type="submit"
      >
        <SendHorizontal aria-hidden="true" />
      </Button>
    </form>
  );
}
