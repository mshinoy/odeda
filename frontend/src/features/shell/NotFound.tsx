import { Link } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";

/**
 * The catch-all route. It used to say "not built yet", which was true while the
 * views were arriving one at a time; they have all arrived, so an unknown path is
 * now just a wrong address.
 */
export function NotFound() {
  return (
    <EmptyState
      message="There is nothing at this address."
      action={
        <Link to="/status" className="text-foreground underline underline-offset-4">
          Status
        </Link>
      }
    />
  );
}
