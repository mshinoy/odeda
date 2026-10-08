import { LayoutGrid, List } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ListView } from "@/features/activities/listState";

interface ViewToggleProps {
  value: ListView;
  onChange: (view: ListView) => void;
}

/** Cards or the table. */
export function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      aria-label="View"
      onValueChange={(next) => {
        // Radix sends "" when the active item is pressed again; keep the choice.
        if (next === "cards" || next === "table") onChange(next);
      }}
    >
      <ToggleGroupItem value="cards" aria-label="Cards">
        <LayoutGrid aria-hidden />
      </ToggleGroupItem>
      <ToggleGroupItem value="table" aria-label="Table">
        <List aria-hidden />
      </ToggleGroupItem>
    </ToggleGroup>
  );
}
