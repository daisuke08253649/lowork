import { open } from "@tauri-apps/plugin-dialog";

import {
  createProject as createProjectRequest,
  deleteProject as deleteProjectRequest,
  getProjects,
} from "@/api/projects";
import { useProjectStore } from "@/store/projectStore";
import type { Project } from "@/types/project";

function getProjectName(folderPath: string): string {
  const normalizedPath = folderPath.replace(/\/+$/, "");
  const pathParts = normalizedPath.split("/");
  return pathParts[pathParts.length - 1] || normalizedPath || folderPath;
}

export async function loadProjects(force = false): Promise<void> {
  const store = useProjectStore.getState();
  if (store.isProjectsLoading || (store.hasLoadedProjects && !force)) {
    return;
  }

  store.setProjectsLoading(true);
  try {
    const projects = await getProjects();
    useProjectStore.getState().setProjects(projects);
  } finally {
    useProjectStore.getState().setProjectsLoading(false);
  }
}

async function selectProjectFolder(): Promise<string | null> {
  const selection = await open({
    directory: true,
    multiple: false,
    title: "プロジェクトフォルダを選択",
  });

  if (!selection || Array.isArray(selection)) {
    return null;
  }

  return selection;
}

export function useProject() {
  const activeProjectId = useProjectStore((state) => state.activeProjectId);
  const isProjectsLoading = useProjectStore((state) => state.isProjectsLoading);
  const projects = useProjectStore((state) => state.projects);

  async function createProject(): Promise<Project | null> {
    const folderPath = await selectProjectFolder();
    if (!folderPath) {
      return null;
    }

    const project = await createProjectRequest({
      name: getProjectName(folderPath),
      folderPath,
    });
    await loadProjects(true);
    useProjectStore.getState().setActiveProjectId(project.id);
    return project;
  }

  async function removeProject(projectId: string): Promise<void> {
    await deleteProjectRequest(projectId);
    const store = useProjectStore.getState();
    if (store.activeProjectId === projectId) {
      store.setActiveProjectId(null);
    }
    await loadProjects(true);
  }

  function selectProject(projectId: string): void {
    useProjectStore.getState().setActiveProjectId(projectId);
  }

  return {
    activeProjectId,
    createProject,
    isProjectsLoading,
    loadProjects,
    projects,
    removeProject,
    selectProject,
  };
}
