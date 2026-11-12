import { ArrowUp } from "lucide-react";
import type { WeatherReading } from "@/api/queries/useActivityWeather";
import { compass } from "@/features/activity/wind";
import { formatKmh, formatTemperature } from "@/lib/format";

/**
 * The wind over the map: an arrow that points the way the wind was blowing, with its
 * strength and the temperature. Not drawn when there was no wind figure to show.
 */
export function WindBadge({ weather }: { weather: WeatherReading }) {
  const { wind_kmh: speed, wind_dir_deg: from, temp_c: temp } = weather;
  if (speed === null || from === null) return null;
  const label = `Wind ${formatKmh(speed, 0)} from the ${compass(from)}`;

  return (
    <div
      role="img"
      aria-label={label}
      title={label}
      className="bg-background/90 text-muted-foreground pointer-events-none absolute right-3 bottom-14 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs tabular-nums shadow-sm backdrop-blur"
    >
      {/* `from` is where it comes from; the arrow points where it goes. */}
      <ArrowUp
        className="text-foreground size-4"
        style={{ transform: `rotate(${(from + 180) % 360}deg)` }}
        aria-hidden
      />
      <span>
        {formatKmh(speed, 0)} {compass(from)}
      </span>
      {temp !== null && <span>{formatTemperature(temp)}</span>}
    </div>
  );
}
