import { Check } from "lucide-react";
import { Link } from "react-router-dom";
import type { SetupStatus } from "@/api/queries/useBasics";
import { firstRunSteps } from "@/features/today/firstRun";

/** What a new install needs, in order, with a way into Settings for each step. */
export function FirstRunCard({ setup }: { setup: SetupStatus }) {
  const steps = firstRunSteps(setup);
  return (
    <section className="bg-card shadow-card flex flex-col gap-4 rounded-2xl border p-7">
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Welcome. Let’s get your data in.</h2>
        <p className="text-muted-foreground text-sm">
          Nothing has been read yet. Three steps, all in Settings; this card goes away by itself
          when the first activity arrives.
        </p>
      </header>
      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step.key} className="flex items-start gap-3">
            <span
              aria-hidden
              className={
                "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border text-xs " +
                (step.done ? "bg-foreground text-background" : "text-muted-foreground")
              }
            >
              {step.done ? <Check className="size-3.5" /> : index + 1}
            </span>
            <div className="flex flex-col">
              <span className={step.done ? "text-muted-foreground line-through" : "font-medium"}>
                {step.title}
              </span>
              <span className="text-muted-foreground text-sm">{step.detail}</span>
            </div>
          </li>
        ))}
      </ol>
      <div>
        <Link
          to="/settings"
          className="bg-primary text-primary-foreground inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
        >
          Open Settings
        </Link>
      </div>
    </section>
  );
}
