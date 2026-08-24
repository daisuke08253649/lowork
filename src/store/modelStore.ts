import { create } from "zustand";
import { persist } from "zustand/middleware";

type ModelState = {
  selectedModel: string | null;
  setSelectedModel: (model: string | null) => void;
};

export const useModelStore = create<ModelState>()(
  persist(
    (set) => ({
      selectedModel: null,
      setSelectedModel: (selectedModel) => {
        set({ selectedModel });
      },
    }),
    {
      name: "lowork-model-settings",
      partialize: (state) => ({ selectedModel: state.selectedModel }),
    },
  ),
);
