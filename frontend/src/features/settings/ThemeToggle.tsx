import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  isThemePreference,
  THEME_PREFERENCES,
  useThemePreference,
  useThemeStore,
} from "@/design/theme";

const label: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/** Light, dark, or whatever the OS says. The choice is remembered in this browser. */
export function ThemeToggle() {
  const preference = useThemePreference();
  const setPreference = useThemeStore((state) => state.setPreference);

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-muted-foreground text-xs">Theme</h2>
      <ToggleGroup
        type="single"
        size="sm"
        value={preference}
        aria-label="Theme"
        onValueChange={(next) => {
          // Radix sends "" when the active item is pressed again; keep the choice.
          if (isThemePreference(next)) setPreference(next);
        }}
      >
        {THEME_PREFERENCES.map((option) => (
          <ToggleGroupItem key={option} value={option} className="px-3 text-xs">
            {label[option]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </section>
  );
}
