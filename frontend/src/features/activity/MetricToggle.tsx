import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { metricLabel, type MetricDefinition, type MetricKey } from "@/lib/metrics";
import type { ActivityKind } from "@/lib/activityKind";

interface MetricToggleProps {
  options: MetricDefinition[];
  value: MetricKey;
  /** The sport, which decides whether the speed metric reads "Pace" or "Speed". */
  kind: ActivityKind;
  onChange: (key: MetricKey) => void;
  /** Not floating over a map: no backdrop or shadow. */
  plain?: boolean;
}

/** "Colour by" for the route: one word per option. */
export function MetricToggle({ options, value, kind, onChange, plain = false }: MetricToggleProps) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.key === next);
        if (option) onChange(option.key);
      }}
      className={
        plain
          ? "bg-muted rounded-lg p-0.5"
          : "bg-background/90 rounded-lg p-0.5 shadow-sm backdrop-blur"
      }
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.key} value={option.key} className="px-3 text-xs">
          {metricLabel(option, kind)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
