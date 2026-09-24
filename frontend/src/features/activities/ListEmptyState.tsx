import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";

interface ListEmptyStateProps {
  /** Whether any filter (the default date range included) could be hiding activities. */
  filtered: boolean;
  onClear: () => void;
}

export function ListEmptyState({ filtered, onClear }: ListEmptyStateProps) {
  if (!filtered) return <EmptyState message="No activities yet. Run a sync to pull them in." />;
  return (
    <EmptyState
      message="No activities match these filters."
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      }
    />
  );
}
