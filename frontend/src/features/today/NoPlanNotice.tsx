import { Link } from "react-router-dom";

/** Shown in place of the week when no training calendar is connected. */
export function NoPlanNotice() {
  return (
    <section className="bg-card shadow-card flex flex-col items-start gap-2 rounded-2xl border p-6 text-sm">
      <span className="text-muted-foreground">No training plan is connected.</span>
      <Link to="/settings" className="underline underline-offset-4">
        Connect the calendar
      </Link>
    </section>
  );
}
