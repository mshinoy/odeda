import { Input } from "@/components/ui/input";

interface DateRangeFieldsProps {
  /** YYYY-MM-DD, or null for no bound. */
  start: string | null;
  end: string | null;
  onChange: (range: { start: string | null; end: string | null }) => void;
}

/** From and to, both inclusive. Clearing a field removes that bound. */
export function DateRangeFields({ start, end, onChange }: DateRangeFieldsProps) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="date"
        aria-label="From"
        value={start ?? ""}
        max={end ?? undefined}
        onChange={(event) => onChange({ start: event.target.value || null, end })}
        className="w-auto"
      />
      <span className="text-muted-foreground" aria-hidden>
        →
      </span>
      <Input
        type="date"
        aria-label="To"
        value={end ?? ""}
        min={start ?? undefined}
        onChange={(event) => onChange({ start, end: event.target.value || null })}
        className="w-auto"
      />
    </div>
  );
}
