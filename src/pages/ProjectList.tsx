import { FolderKanban } from "lucide-react";

export function ProjectList() {
  return (
    <section className="flex min-h-full flex-col items-center justify-center px-6 text-center">
      <FolderKanban className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">プロジェクト</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        プロジェクトの作成と選択は、次の実装で利用できるようになります。
      </p>
    </section>
  );
}
