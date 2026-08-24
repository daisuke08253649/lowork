import { create } from "zustand";

type OllamaStatusState = {
  isAvailable: boolean | null;
  recoveryToken: number;
  setAvailability: (isAvailable: boolean) => void;
};

export const useOllamaStatusStore = create<OllamaStatusState>()((set) => ({
  isAvailable: null,
  recoveryToken: 0,
  setAvailability: (isAvailable) => {
    set((state) => ({
      isAvailable,
      recoveryToken:
        state.isAvailable === false && isAvailable
          ? state.recoveryToken + 1
          : state.recoveryToken,
    }));
  },
}));
