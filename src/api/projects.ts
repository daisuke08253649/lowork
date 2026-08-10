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
