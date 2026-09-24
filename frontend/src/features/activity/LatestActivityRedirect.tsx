import { Navigate } from "react-router-dom";
import { useActivities } from "@/api/queries/useActivities";
import { EmptyState } from "@/components/EmptyState";
import { ActivityPageSkeleton } from "@/features/activity/ActivityPageSkeleton";

/** Opens the most recent activity, so the app never starts on an empty screen. */
export function LatestActivityRedirect() {
  const { data, isPending, error } = useActivities({ limit: 1, sort: "day", order: "desc" });

  if (isPending) return <ActivityPageSkeleton />;
  if (error) return <EmptyState message={error.message} />;

  const latest = data.rows[0];
  if (!latest) return <EmptyState message="No activities yet. Run a sync to pull them in." />;
  return <Navigate to={`/activities/${latest.id}`} replace />;
}
