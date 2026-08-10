import { create } from "zustand";

import type { Project } from "@/types/project";

type ProjectState = {
  activeProjectId: string | null;
  hasLoadedProjects: boolean;
  isProjectsLoading: boolean;
  projects: Project[];
  setActiveProjectId: (projectId: string | null) => void;
  setProjects: (projects: Project[]) => void;
  setProjectsLoading: (isLoading: boolean) => void;
};

export const useProjectStore = create<ProjectState>()((set) => ({
  activeProjectId: null,
  hasLoadedProjects: false,
  isProjectsLoading: false,
  projects: [],
  setActiveProjectId: (activeProjectId) => {
    set({ activeProjectId });
  },
  setProjects: (projects) => {
    set({ projects, hasLoadedProjects: true });
  },
  setProjectsLoading: (isProjectsLoading) => {
    set({ isProjectsLoading });
  },
}));
