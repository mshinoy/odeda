import { activityTypeLabel } from "@/lib/activityKind";
import { cn } from "@/lib/utils";

interface TypeSelectProps {
  /** Every type in the database, most common first (from the API). */
  types: string[];
  value: string | null;
  onChange: (type: string | null) => void;
}

const ALL = "";

// A native select, styled like shadcn's Input: the list is short and flat, and the
// browser's own picker follows the theme (tokens set `color-scheme`).
export function TypeSelect({ types, value, onChange }: TypeSelectProps) {
  // A type from the URL stays selectable even before the list of types has loaded.
  const options = value && !types.includes(value) ? [value, ...types] : types;

  return (
    <select
      aria-label="Type"
      value={value ?? ALL}
      onChange={(event) => onChange(event.target.value || null)}
      className={cn(
        "border-input dark:bg-input/30 h-8 rounded-lg border bg-transparent px-2 text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
      )}
    >
      <option value={ALL}>All types</option>
      {options.map((type) => (
        <option key={type} value={type}>
          {activityTypeLabel(type)}
        </option>
      ))}
    </select>
  );
}
