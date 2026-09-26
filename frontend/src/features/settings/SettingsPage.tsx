import { GarminPanel } from "@/features/settings/GarminPanel";

/** Everything that is about the app rather than about a workout. */
export function SettingsPage() {
  return (
    <div className="flex flex-col gap-12">
      <GarminPanel />
    </div>
  );
}
