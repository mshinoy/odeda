import { useParams } from "react-router-dom";
import { useActivity } from "@/api/queries/useActivity";
import { EmptyState } from "@/components/EmptyState";
import { ActivityHeader } from "@/features/activity/ActivityHeader";
import { ActivityPageSkeleton } from "@/features/activity/ActivityPageSkeleton";
import { EditActivityDialog } from "@/features/activity/edit/EditActivityDialog";
import { EnduranceActivity } from "@/features/activity/EnduranceActivity";
import { GymActivity } from "@/features/activity/gym/GymActivity";
import { isGymSession } from "@/features/activity/gym/gymSession";

export function ActivityPage() {
  const { id = "" } = useParams();
  const { activity, isPending, error } = useActivity(id);

  if (isPending) return <ActivityPageSkeleton />;
  if (error) return <EmptyState message={error.message} />;
  if (!activity) return <EmptyState message="Activity not found." />;

  return (
    <div className="flex flex-col gap-8">
      <ActivityHeader
        summary={activity.summary}
        edits={activity.edits}
        gear={activity.gear}
        route={activity.route}
        actions={<EditActivityDialog activityId={activity.summary.id} />}
      />
      {isGymSession(activity.summary) ? (
        <GymActivity activity={activity} />
      ) : (
        <EnduranceActivity activity={activity} />
      )}
    </div>
  );
}
