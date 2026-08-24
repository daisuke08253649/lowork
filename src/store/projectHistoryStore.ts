import { create } from "zustand";

type ProjectHistoryState = {
  refreshToken: number;
  refreshProjectHistory: () => void;
};

export const useProjectHistoryStore = create<ProjectHistoryState>()((set) => ({
  refreshToken: 0,
  refreshProjectHistory: () => {
    set((state) => ({ refreshToken: state.refreshToken + 1 }));
  },
}));
