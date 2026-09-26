import { create } from "zustand";
import { applyTokens, colorTokens, type ColorTokens, type Theme } from "@/design/tokens";

const darkQuery = "(prefers-color-scheme: dark)";

/** What the user asked for. `system` is the default and follows the OS. */
export type ThemePreference = Theme | "system";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"];

const STORAGE_KEY = "ga.theme";

function systemTheme(): Theme {
  return window.matchMedia(darkQuery).matches ? "dark" : "light";
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/** The theme a preference resolves to right now. */
export function resolveTheme(preference: ThemePreference, system: Theme): Theme {
  return preference === "system" ? system : preference;
}

function storedPreference(): ThemePreference {
  // A private-mode browser can throw on localStorage; the OS is a fine fallback.
  try {
    const stored: unknown = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function storePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Not being able to remember the choice does not stop it applying now.
  }
}

interface ThemeState {
  /** What the user chose. */
  preference: ThemePreference;
  /** What is actually on screen, after `system` is resolved. */
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
  /** The OS setting changed; matters only while the preference is `system`. */
  systemChanged: (system: Theme) => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  preference: "system",
  theme: "light",
  setPreference: (preference) => {
    const theme = resolveTheme(preference, systemTheme());
    storePreference(preference);
    applyTokens(theme);
    set({ preference, theme });
  },
  systemChanged: (system) => {
    if (get().preference !== "system") return;
    applyTokens(system);
    set({ theme: system });
  },
}));

/** Applies the stored preference now, and follows the OS while it is `system`. */
export function initTheme(): void {
  const preference = storedPreference();
  const theme = resolveTheme(preference, systemTheme());
  applyTokens(theme);
  useThemeStore.setState({ preference, theme });
  window.matchMedia(darkQuery).addEventListener("change", (event) => {
    useThemeStore.getState().systemChanged(event.matches ? "dark" : "light");
  });
}

export function useTheme(): Theme {
  return useThemeStore((state) => state.theme);
}

export function useThemePreference(): ThemePreference {
  return useThemeStore((state) => state.preference);
}

/** The current theme's colours, for canvas-drawn charts and map layers. */
export function useTokens(): ColorTokens {
  return colorTokens[useTheme()];
}
