import { FolderKanban, Plus, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { getProjectErrorMessage } from "@/api/projects";
import { ProjectCard } from "@/components/project/ProjectCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useProject } from "@/hooks/useProject";
import type { Project } from "@/types/project";

export function ProjectList() {
  const navigate = useNavigate();
  const {
    activeProjectId,
    createProject,
    isProjectsLoading,
    loadProjects,
    projects,
    removeProject,
    selectProject,
  } = useProject();
  const [error, setError] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    void loadProjects(true)
      .then(() => {
        setError(null);
      })
      .catch((loadError: unknown) => {
        setError(
          getProjectErrorMessage(
            loadError,
            "プロジェクト一覧の取得に失敗しました",
          ),
        );
      });
  }, [loadProjects]);

  async function handleCreate(): Promise<void> {
    setError(null);
    setIsCreating(true);
    try {
      const project = await createProject();
      if (project) {
        navigate(`/projects/${project.id}`);
      }
    } catch (createError) {
      setError(
        getProjectErrorMessage(createError, "プロジェクトの作成に失敗しました"),
      );
    } finally {
      setIsCreating(false);
    }
  }

  function handleSelect(project: Project): void {
    selectProject(project.id);
    navigate(`/projects/${project.id}`);
  }

  async function handleDelete(): Promise<void> {
    if (!projectToDelete) {
      return;
    }

    setError(null);
    setIsDeleting(true);
    try {
      await removeProject(projectToDelete.id);
    } catch (deleteError) {
      setError(
        getProjectErrorMessage(deleteError, "プロジェクトの削除に失敗しました"),
      );

      try {
        await loadProjects(true);
      } catch {
        // 削除失敗の原因を優先して表示する。
      }
    } finally {
      setIsDeleting(false);
      setProjectToDelete(null);
    }
  }

  return (
    <section className="min-h-full px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              プロジェクト一覧
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              フォルダを選択して、ローカルのファイルを扱うプロジェクトを作成します。
            </p>
          </div>
          <Button disabled={isCreating} onClick={() => void handleCreate()}>
            <Plus aria-hidden="true" />
            {isCreating ? "選択中..." : "新規"}
          </Button>
        </div>

        {error && (
          <Alert className="mt-6" variant="destructive">
            <TriangleAlert aria-hidden="true" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {isProjectsLoading && projects.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">読み込み中...</p>
        ) : null}

        {!isProjectsLoading && !error && projects.length === 0 ? (
          <Card className="mt-8">
            <CardContent className="flex flex-col items-center py-12 text-center">
              <FolderKanban
                className="size-10 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="mt-4 font-medium">プロジェクトはまだありません</p>
              <p className="mt-1 text-sm text-muted-foreground">
                「新規」からプロジェクトフォルダを選択してください。
              </p>
            </CardContent>
          </Card>
        ) : null}

        {projects.length > 0 ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                isActive={activeProjectId === project.id}
                project={project}
                onDelete={setProjectToDelete}
                onSelect={handleSelect}
              />
            ))}
          </div>
        ) : null}
      </div>

      <AlertDialog
        open={projectToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) {
            setProjectToDelete(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>プロジェクトを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              {projectToDelete?.name}
              を一覧から削除します。この操作は元に戻せません。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              render={<Button variant="outline" />}
              disabled={isDeleting}
            >
              キャンセル
            </AlertDialogCancel>
            <Button
              disabled={isDeleting}
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              {isDeleting ? "削除中..." : "削除する"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
