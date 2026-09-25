import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { compareBlockedReason, compareHref } from "@/features/compare/compareSelection";
import { formatInteger } from "@/lib/format";

interface CompareBarProps {
  /** The ticked activities, in the order they were ticked. */
  selected: readonly string[];
  onClear: () => void;
}

/** Appears once something is ticked; says what is missing until a comparison is possible. */
export function CompareBar({ selected, onClear }: CompareBarProps) {
  if (selected.length === 0) return null;
  const blocked = compareBlockedReason(selected.length);

  return (
    <div className="bg-muted/60 flex items-center gap-3 rounded-lg px-3 py-2 text-sm">
      <span className="tabular-nums">{formatInteger(selected.length)} selected</span>
      {blocked && <span className="text-muted-foreground">{blocked}</span>}
      <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
        Clear
      </Button>
      {blocked ? (
        <Button size="sm" disabled>
          Compare
        </Button>
      ) : (
        <Button size="sm" asChild>
          <Link to={compareHref(selected)}>Compare</Link>
        </Button>
      )}
    </div>
  );
}
