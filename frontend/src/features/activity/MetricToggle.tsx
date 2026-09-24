import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { MetricDefinition, MetricKey } from "@/lib/metrics";

interface MetricToggleProps {
  options: MetricDefinition[];
  value: MetricKey;
  onChange: (key: MetricKey) => void;
}

/** "Colour by" for the route: one word per option. */
export function MetricToggle({ options, value, onChange }: MetricToggleProps) {
  return (
    <ToggleGroup
      type="single"
      size="sm"
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.key === next);
        if (option) onChange(option.key);
      }}
      className="bg-background/90 rounded-lg p-0.5 shadow-sm backdrop-blur"
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.key} value={option.key} className="px-3 text-xs">
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
