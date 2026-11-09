import type { ActivityGap } from "@/api/adapters";
import { gapNote } from "@/features/activity/gapNote";
import type { ActivityKind } from "@/lib/activityKind";

/** One line per recording gap under the map: what was missed, and what is only a guess. */
export function GapNotes({ gaps, kind }: { gaps: readonly ActivityGap[]; kind: ActivityKind }) {
  if (gaps.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {gaps.map((gap, i) => {
        const note = gapNote(gap, kind);
        return (
          <li key={i} className="text-ink-secondary flex items-start gap-3 text-sm">
            <span
              className="border-ink-secondary mt-2 w-6 shrink-0 border-t-2 border-dashed"
              aria-hidden
            />
            <span>
              <span className="text-foreground font-medium">{note.heading}.</span> {note.detail}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
