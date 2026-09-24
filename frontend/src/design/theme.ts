import { create } from "zustand";
import { applyTokens, colorTokens, type ColorTokens, type Theme } from "@/design/tokens";

const darkQuery = "(prefers-color-scheme: dark)";

function systemTheme(): Theme {
  return window.matchMedia(darkQuery).matches ? "dark" : "light";
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useThemeStore = create<ThemeState>()((set) => ({
  theme: systemTheme(),
  setTheme: (theme) => {
    applyTokens(theme);
    set({ theme });
  },
}));

/** Applies the system theme now and follows it when the OS setting changes. */
export function initTheme(): void {
  applyTokens(useThemeStore.getState().theme);
  window.matchMedia(darkQuery).addEventListener("change", () => {
    useThemeStore.getState().setTheme(systemTheme());
  });
}

export function useTheme(): Theme {
  return useThemeStore((state) => state.theme);
}

/** The current theme's colours, for canvas-drawn charts and map layers. */
export function useTokens(): ColorTokens {
  return colorTokens[useTheme()];
}
