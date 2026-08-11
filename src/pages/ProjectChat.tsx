import { FolderKanban } from "lucide-react";
import { useParams } from "react-router";

import { FileTree } from "@/components/project/FileTree";
import { useProjectStore } from "@/store/projectStore";

export function ProjectChat() {
  const { projectId } = useParams();
  const project = useProjectStore((state) =>
    state.projects.find((item) => item.id === projectId),
  );

  return (
    <div className="flex h-full overflow-hidden">
      <section className="flex min-w-0 flex-1 flex-col items-center justify-center px-6 text-center">
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
      {projectId ? <FileTree projectId={projectId} /> : null}
    </div>
  );
}
