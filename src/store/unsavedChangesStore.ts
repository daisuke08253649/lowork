import { create } from "zustand";

// ファイルエディタに未保存の変更があるかを、画面を離れる操作（サイドバーなど）と共有する。
type UnsavedChangesState = {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (hasUnsavedChanges: boolean) => void;
};

export const useUnsavedChangesStore = create<UnsavedChangesState>()((set) => ({
  hasUnsavedChanges: false,
  setHasUnsavedChanges: (hasUnsavedChanges) => {
    set({ hasUnsavedChanges });
  },
}));
