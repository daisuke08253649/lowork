import axios from "axios";
import { z } from "zod";

import { apiClient } from "@/api/client";
import type { Project } from "@/types/project";

const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  folder_path: z.string(),
  created_at: z.string().datetime(),
});

const apiErrorSchema = z.object({
  detail: z.string(),
});

export type FileTreeNode = {
  children: FileTreeNode[];
  name: string;
  path: string;
  type: "directory" | "file";
};

export type IndexStatus = {
  progress: number;
  status: "indexing" | "done" | "error";
};

const fileTreeNodeSchema: z.ZodType<FileTreeNode> = z.object({
  children: z.lazy(() => z.array(fileTreeNodeSchema)),
  name: z.string(),
  path: z.string(),
  type: z.enum(["directory", "file"]),
});

const indexStatusSchema = z.object({
  progress: z.number().int().min(0).max(100),
  status: z.enum(["indexing", "done", "error"]),
});

export type CreateProjectRequest = {
  folderPath: string;
  name: string;
};

function toProject(project: z.infer<typeof projectSchema>): Project {
  return {
    id: project.id,
    name: project.name,
    folderPath: project.folder_path,
    createdAt: project.created_at,
  };
}

export async function getProjects(): Promise<Project[]> {
  const response = await apiClient.get<unknown>("/projects");
  return z.array(projectSchema).parse(response.data).map(toProject);
}

export async function createProject(
  request: CreateProjectRequest,
): Promise<Project> {
  const response = await apiClient.post<unknown>("/projects", {
    name: request.name,
    folder_path: request.folderPath,
  });
  return toProject(projectSchema.parse(response.data));
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiClient.delete(`/projects/${projectId}`);
}

export async function getProjectFileTree(
  projectId: string,
): Promise<FileTreeNode> {
  const response = await apiClient.get<unknown>(`/projects/${projectId}/files`);
  return fileTreeNodeSchema.parse(response.data);
}

export async function getProjectIndexStatus(
  projectId: string,
): Promise<IndexStatus> {
  const response = await apiClient.get<unknown>(
    `/projects/${projectId}/index-status`,
  );
  return indexStatusSchema.parse(response.data);
}

export function getProjectErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (axios.isAxiosError(error)) {
    const detail = apiErrorSchema.safeParse(error.response?.data);
    if (detail.success) {
      return detail.data.detail;
    }
    if (!error.response) {
      return "サーバーに接続できません";
    }
  }

  return error instanceof Error ? error.message : fallback;
}
