import { useMemo } from "react";
import type { components } from "@/api/schema";
import { metricColor } from "@/design/scales";
import { useTokens } from "@/design/theme";
import { dayHourCells, formatHour, HOURS_PER_DAY } from "@/features/trends/dayHour";

type Patterns = components["schemas"]["Patterns"];

/** Every sixth hour gets a label; 24 of them would not fit. */
const LABELLED_HOURS = [0, 6, 12, 18];

// One track per hour, so a row of cells and the row of labels under it line up.
const hourColumns = "grid grid-cols-[repeat(24,minmax(0,1fr))] gap-px";

/** When you actually train: one cell per weekday and hour, strongest where you always do. */
export function DayHourGrid({ patterns }: { patterns: Patterns }) {
  const tokens = useTokens();
  const cells = useMemo(() => dayHourCells(patterns), [patterns]);
  const dayNames = patterns.day_of_week.map((day) => day.name);

  return (
    <div className="grid grid-cols-[2.5rem_1fr] items-center gap-x-2 gap-y-px">
      {dayNames.map((name, day) => (
        <DayRow
          key={name}
          name={name}
          cells={cells.slice(day * HOURS_PER_DAY, (day + 1) * HOURS_PER_DAY)}
          emptyColor={tokens.surfaceMuted}
          colorOf={(intensity) => metricColor(tokens, intensity)}
        />
      ))}

      <span />
      <div className={hourColumns}>
        {Array.from({ length: HOURS_PER_DAY }, (_, hour) => (
          <span key={hour} className="text-muted-foreground pt-1 text-xs whitespace-nowrap">
            {LABELLED_HOURS.includes(hour) ? formatHour(hour) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

interface DayRowProps {
  name: string;
  cells: readonly { hour: number; count: number; intensity: number; title: string }[];
  emptyColor: string;
  colorOf: (intensity: number) => string;
}

function DayRow({ name, cells, emptyColor, colorOf }: DayRowProps) {
  return (
    <>
      <span className="text-muted-foreground text-xs">{name}</span>
      <div className={hourColumns}>
        {cells.map((cell) => (
          <div
            key={cell.hour}
            title={cell.title}
            className="h-4 rounded-[2px]"
            style={{
              backgroundColor: cell.count === 0 ? emptyColor : colorOf(cell.intensity),
            }}
          />
        ))}
      </div>
    </>
  );
}
