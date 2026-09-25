import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { ActivitySummary } from "@/api/adapters";
import { useActivities } from "@/api/queries/useActivities";
import { Button } from "@/components/ui/button";
import { compareHref, MIN_COMPARE, racesAtThisDistance } from "@/features/compare/compareSelection";

// Every race in one fetch: there are a few dozen at most, because a race is a thing
// the owner marks by hand.
const RACE_LIMIT = 1000;

/**
 * "Compare races" on a race's page, opening the compare view on this race and the most
 * recent others of about the same distance. Hidden when there is no other such race —
 * render it only for an activity that is one.
 */
export function CompareRacesLink({ summary }: { summary: ActivitySummary }) {
  const races = useActivities({ race: true, limit: RACE_LIMIT, sort: "day", order: "desc" });

  const comparable = useMemo(
    () => (races.data ? racesAtThisDistance(summary, races.data.rows) : []),
    [races.data, summary],
  );

  if (comparable.length < MIN_COMPARE) return null;

  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={compareHref(comparable.map((race) => race.id))}>Compare races</Link>
    </Button>
  );
}
