import { FolderKanban, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { Project } from "@/types/project";

type ProjectCardProps = {
  isActive: boolean;
  onDelete: (project: Project) => void;
  onSelect: (project: Project) => void;
  project: Project;
};

export function ProjectCard({
  isActive,
  onDelete,
  onSelect,
  project,
}: ProjectCardProps) {
  return (
    <Card className={isActive ? "ring-2 ring-primary" : undefined} size="sm">
      <Button
        aria-label={`${project.name}を開く`}
        className="h-auto w-full items-start justify-start rounded-none px-0 py-0 text-left"
        variant="ghost"
        onClick={() => onSelect(project)}
      >
        <CardHeader className="w-full">
          <FolderKanban className="size-5 text-primary" aria-hidden="true" />
          <CardTitle className="mt-3 truncate">{project.name}</CardTitle>
          <CardDescription className="mt-1 truncate" title={project.folderPath}>
            {project.folderPath}
          </CardDescription>
        </CardHeader>
      </Button>
      <CardFooter className="justify-end">
        <Button
          aria-label={`${project.name}を削除`}
          size="sm"
          variant="destructive"
          onClick={() => onDelete(project)}
        >
          <Trash2 aria-hidden="true" />
          削除
        </Button>
      </CardFooter>
    </Card>
  );
}
