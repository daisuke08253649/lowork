import { create } from "zustand";

export type Theme = "light" | "dark";

type ThemeState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

function getInitialTheme(): Theme {
  return localStorage.getItem("theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem("theme", theme);
}

const initialTheme = getInitialTheme();

applyTheme(initialTheme);

export const useThemeStore = create<ThemeState>()((set) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));
