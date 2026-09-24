import { Link } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";

/** Placeholder for nav items whose view has not been built yet. */
export function NotBuiltYet() {
  return (
    <EmptyState
      message="Not built yet."
      action={
        <Link to="/activities" className="text-foreground underline underline-offset-4">
          Activities
        </Link>
      }
    />
  );
}
