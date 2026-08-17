import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ExecutionMode, Project } from "@/types/project";

type ProjectState = {
  activeProjectId: string | null;
  executionMode: ExecutionMode;
  hasLoadedProjects: boolean;
  isProjectsLoading: boolean;
  projects: Project[];
  setActiveProjectId: (projectId: string | null) => void;
  setExecutionMode: (mode: ExecutionMode) => void;
  setProjects: (projects: Project[]) => void;
  setProjectsLoading: (isLoading: boolean) => void;
};

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      activeProjectId: null,
      executionMode: "confirm",
      hasLoadedProjects: false,
      isProjectsLoading: false,
      projects: [],
      setActiveProjectId: (activeProjectId) => {
        set({ activeProjectId });
      },
      setExecutionMode: (executionMode) => {
        set({ executionMode });
      },
      setProjects: (projects) => {
        set({ projects, hasLoadedProjects: true });
      },
      setProjectsLoading: (isProjectsLoading) => {
        set({ isProjectsLoading });
      },
    }),
    {
      name: "lowork-project-settings",
      partialize: (state) => ({ executionMode: state.executionMode }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        executionMode:
          toExecutionMode(
            persistedState && typeof persistedState === "object"
              ? (persistedState as { executionMode?: unknown }).executionMode
              : undefined,
          ) ?? currentState.executionMode,
      }),
    },
  ),
);

function toExecutionMode(value: unknown): ExecutionMode | null {
  return value === "confirm" || value === "auto" ? value : null;
}
