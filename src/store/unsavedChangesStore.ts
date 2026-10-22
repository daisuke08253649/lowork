import { create } from "zustand";

// ファイルエディタに未保存の変更があるかを、画面を離れる操作（サイドバーなど）と共有する。
type UnsavedChangesState = {
  hasUnsavedChanges: boolean;
  // 保存中は書き込みを取り消せないため、破棄して移動する操作を確定させない。
  isSaving: boolean;
  setHasUnsavedChanges: (hasUnsavedChanges: boolean) => void;
  setIsSaving: (isSaving: boolean) => void;
};

export const useUnsavedChangesStore = create<UnsavedChangesState>()((set) => ({
  hasUnsavedChanges: false,
  isSaving: false,
  setHasUnsavedChanges: (hasUnsavedChanges) => {
    set({ hasUnsavedChanges });
  },
  setIsSaving: (isSaving) => {
    set({ isSaving });
  },
}));
