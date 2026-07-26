import { MessageCircle } from "lucide-react";

export function NormalChat() {
  return (
    <section className="flex min-h-full flex-col items-center justify-center px-6 text-center">
      <MessageCircle
        className="size-10 text-muted-foreground"
        aria-hidden="true"
      />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        新しいチャット
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        モデルを選択して、メッセージを入力してください。
      </p>
    </section>
  );
}
