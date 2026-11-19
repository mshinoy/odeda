import { useConfig } from "@/api/queries/useSettings";
import { BasicsPanel, PasswordPanel } from "@/features/settings/BasicsPanel";
import { AboutPanel } from "@/features/settings/AboutPanel";
import { EditsPanel } from "@/features/settings/EditsPanel";
import { FitbitPanel } from "@/features/settings/FitbitPanel";
import { GarminPanel } from "@/features/settings/GarminPanel";
import { PlanPanel } from "@/features/settings/PlanPanel";
import { SyncPanel } from "@/features/settings/SyncPanel";
import { ThemeToggle } from "@/features/settings/ThemeToggle";

/** Everything that is about the app rather than about a workout. */
export function SettingsPage() {
  const { data: config } = useConfig();
  if (config?.demo) return <DemoSettings />;
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-6">
        {/* First, because a new install has to get these right before anything is read. */}
        <BasicsPanel />
        <GarminPanel />
        {/* The second source, beside the first: Garmin brings the training, Fitbit the scale. */}
        <FitbitPanel />
        {/* The third source. It brings no measurements, only what was meant to happen. */}
        <PlanPanel />
      </div>
      <div className="flex flex-col gap-6">
        <SyncPanel />
        <EditsPanel />
        <PasswordPanel />
        <ThemeToggle />
        <AboutPanel />
      </div>
    </div>
  );
}

/** On a read-only demo the cards that connect accounts, sync or change a password have
 * nothing to do, so they are left out and a note says why. What stays is what a visitor
 * can look at: the basics, the plan, the edits list, the theme and the version. */
function DemoSettings() {
  return (
    <div className="flex flex-col gap-6">
      <div role="note" className="bg-muted text-muted-foreground rounded-lg border p-4 text-sm">
        This is a read-only demo with synthetic data, so Settings is for looking at. On your own
        copy this is where you connect Garmin, set your heart rate and password, and subscribe to a
        training calendar.
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          <BasicsPanel />
          <PlanPanel />
        </div>
        <div className="flex flex-col gap-6">
          <EditsPanel />
          <ThemeToggle />
          <AboutPanel />
        </div>
      </div>
    </div>
  );
}
