import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { KindOption } from "@/features/routes/routeFilter";
import { parseKind } from "@/features/routes/routeFilter";
import type { ActivityKind } from "@/lib/activityKind";

const ALL = "all";

interface RouteKindFilterProps {
  options: readonly KindOption[];
  value: ActivityKind | null;
  onChange: (kind: ActivityKind | null) => void;
  total: number;
}

/**
 * What you did on the route: all of them, or one kind.
 *
 * Each option carries its count, so the five rides are findable without clicking to
 * find out whether there are any. Only kinds with routes are offered.
 */
export function RouteKindFilter({ options, value, onChange, total }: RouteKindFilterProps) {
  // One kind is the whole list; a filter that can only be "all" is noise.
  if (options.length < 2) return null;

  return (
    <ToggleGroup
      type="single"
      size="sm"
      className="flex-wrap justify-start"
      value={value ?? ALL}
      aria-label="Filter routes by kind"
      onValueChange={(next) => {
        // Radix sends "" when the active item is pressed again; that is "all" here
        // rather than "no filter at all", which would blank the list.
        if (next === "" || next === ALL) onChange(null);
        else onChange(parseKind(next));
      }}
    >
      <ToggleGroupItem value={ALL} className="px-3 text-xs">
        All <span className="text-muted-foreground ml-1 tabular-nums">{total}</span>
      </ToggleGroupItem>
      {options.map((option) => (
        <ToggleGroupItem key={option.kind} value={option.kind} className="px-3 text-xs">
          {option.label}
          <span className="text-muted-foreground ml-1 tabular-nums">{option.count}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
