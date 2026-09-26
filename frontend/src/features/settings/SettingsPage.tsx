import { AboutPanel } from "@/features/settings/AboutPanel";
import { EditsPanel } from "@/features/settings/EditsPanel";
import { GarminPanel } from "@/features/settings/GarminPanel";
import { SyncPanel } from "@/features/settings/SyncPanel";
import { ThemeToggle } from "@/features/settings/ThemeToggle";

/** Everything that is about the app rather than about a workout. */
export function SettingsPage() {
  return (
    <div className="flex flex-col gap-12">
      <GarminPanel />
      <SyncPanel />
      <EditsPanel />
      <ThemeToggle />
      <AboutPanel />
    </div>
  );
}
