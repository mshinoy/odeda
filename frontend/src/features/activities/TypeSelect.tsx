import { NativeSelect } from "@/components/NativeSelect";
import { activityTypeLabel } from "@/lib/activityKind";

interface TypeSelectProps {
  /** Every type in the database, most common first (from the API). */
  types: string[];
  value: string | null;
  onChange: (type: string | null) => void;
}

const ALL = "";

export function TypeSelect({ types, value, onChange }: TypeSelectProps) {
  // A type from the URL stays selectable even before the list of types has loaded.
  const options = value && !types.includes(value) ? [value, ...types] : types;

  return (
    <NativeSelect
      aria-label="Type"
      value={value ?? ALL}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <option value={ALL}>All types</option>
      {options.map((type) => (
        <option key={type} value={type}>
          {activityTypeLabel(type)}
        </option>
      ))}
    </NativeSelect>
  );
}
