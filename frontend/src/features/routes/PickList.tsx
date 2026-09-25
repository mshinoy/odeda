import { cn } from "@/lib/utils";

export interface PickOption {
  /** Unique within the list; what `selected` holds. */
  id: string;
  label: string;
  /** One line of numbers under the label, e.g. "25 attempts · 5.0 km". */
  detail: string;
}

interface PickListProps {
  options: readonly PickOption[];
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  /** Shown instead of the list when there is nothing to pick. */
  emptyMessage: string;
}

/** A scrollable list of things to tick. Used by the merge and split dialogs. */
export function PickList({ options, selected, onToggle, emptyMessage }: PickListProps) {
  if (options.length === 0) {
    return <p className="text-muted-foreground py-6 text-center text-sm">{emptyMessage}</p>;
  }

  return (
    <div className="max-h-72 overflow-y-auto rounded-md border">
      {options.map((option) => (
        <label
          key={option.id}
          className={cn(
            "hover:bg-muted/60 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm",
            "border-b last:border-b-0",
          )}
        >
          <input
            type="checkbox"
            className="accent-foreground size-4"
            checked={selected.has(option.id)}
            onChange={() => onToggle(option.id)}
          />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          <span className="text-muted-foreground shrink-0 text-xs">{option.detail}</span>
        </label>
      ))}
    </div>
  );
}
