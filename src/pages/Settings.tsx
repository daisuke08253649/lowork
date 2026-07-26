import { Settings as SettingsIcon } from "lucide-react";

export function Settings() {
  return (
    <section className="flex min-h-full flex-col items-center justify-center px-6 text-center">
      <SettingsIcon
        className="size-10 text-muted-foreground"
        aria-hidden="true"
      />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">設定</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        モデルのダウンロードと詳細設定は、後続タスクで追加します。
      </p>
    </section>
  );
}
