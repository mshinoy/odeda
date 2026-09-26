import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { HEALTH_RANGES, rangeLabel, type HealthRange } from "@/features/health/healthRange";

interface RangeToggleProps {
  value: HealthRange;
  onChange: (days: HealthRange) => void;
}

/** How far back every chart on the page looks. One control, above all of them. */
export function RangeToggle({ value, onChange }: RangeToggleProps) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={String(value)}
      aria-label="Time range"
      onValueChange={(next) => {
        const range = HEALTH_RANGES.find((days) => String(days) === next);
        if (range !== undefined) onChange(range);
      }}
    >
      {HEALTH_RANGES.map((days) => (
        <ToggleGroupItem key={days} value={String(days)} className="px-3 text-xs">
          {rangeLabel[days]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
