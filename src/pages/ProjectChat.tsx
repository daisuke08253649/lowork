import { FolderKanban } from "lucide-react";
import { useParams } from "react-router";

import { useProjectStore } from "@/store/projectStore";

export function ProjectChat() {
  const { projectId } = useParams();
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === projectId),
  );

  return (
    <section className="flex min-h-full flex-col items-center justify-center px-6 text-center">
      <FolderKanban
        className="size-10 text-muted-foreground"
        aria-hidden="true"
      />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {project?.name ?? "プロジェクト"}
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        プロジェクトチャットは、RAGインデックスの実装後に利用できるようになります。
      </p>
    </section>
  );
}
