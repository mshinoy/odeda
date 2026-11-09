import { InfoPopover } from "@/components/InfoPopover";
import { taperRows, type Taper } from "@/features/today/taper";

/**
 * The plan's taper as written, in a popup: the last weeks against the biggest one, and
 * where the plan leaves form on race morning. It asks whether the taper is well made,
 * not whether the training reaches it.
 */
export function TaperCheck({ taper }: { taper: Taper }) {
  const rows = taperRows(taper);
  return (
    <InfoPopover title="Taper check" trigger={{ kind: "link", label: "Taper check" }}>
      <p>The plan as written, whatever has been run so far.</p>
      <ul className="flex flex-col gap-2 py-1">
        {rows.map((row) => (
          <li key={row.label} className="grid grid-cols-[8.5rem_1fr_4rem] items-center gap-3">
            <span className={row.raceWeek ? "text-foreground font-medium" : undefined}>
              {row.label}
            </span>
            <span className="bg-muted h-2 overflow-hidden rounded-full">
              <span
                className="bg-kind-run block h-full rounded-full"
                style={{ width: `${row.pct}%` }}
              />
            </span>
            <span className="text-right tabular-nums">{row.km}</span>
          </li>
        ))}
      </ul>
      <p>
        The biggest week is {taper.peak_km.toFixed(0)} km. Race week leaves out the race itself.
      </p>
      <p>
        <span className="text-foreground font-medium">Race morning, as planned: </span>
        {taper.verdict.text}
      </p>
    </InfoPopover>
  );
}
