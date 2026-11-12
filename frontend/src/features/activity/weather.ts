// How an activity's weather is put into words: the headline on the chip and the rows in
// its popup. Rules of thumb for "humid" and "calm" are the ones a runner uses, not science.
import type { WeatherReading } from "@/api/queries/useActivityWeather";
import { MISSING, formatKmh, formatPercent, formatTemperature } from "@/lib/format";
import { compass } from "@/features/activity/wind";

/** Under this the wind is not worth a word. */
const CALM_KMH = 5;
/** Rain under this is a trace. */
const RAIN_MM = 0.2;

/** How heavy the air feels, from the dew point; null when it is comfortable. */
export function mugginess(dewPointC: number | null): string | null {
  if (dewPointC === null) return null;
  if (dewPointC >= 24) return "oppressive";
  if (dewPointC >= 21) return "very humid";
  if (dewPointC >= 18) return "humid";
  return null;
}

function windPhrase(w: WeatherReading): string | null {
  if (w.wind_kmh === null) return null;
  if (w.wind_kmh < CALM_KMH) return "calm";
  const from = w.wind_dir_deg === null ? "" : ` ${compass(w.wind_dir_deg)}`;
  return `${formatKmh(w.wind_kmh, 0)}${from}`;
}

/** "22°C · humid · 19 km/h NW": what the chip says. */
export function weatherHeadline(w: WeatherReading): string {
  const parts = [
    formatTemperature(w.temp_c),
    mugginess(w.dew_point_c),
    windPhrase(w),
    w.precip_mm !== null && w.precip_mm >= RAIN_MM ? "rain" : null,
  ];
  return parts.filter((p): p is string => p !== null && p !== MISSING).join(" · ");
}

export interface WeatherRow {
  label: string;
  value: string;
}

/** The popup's rows. Only what the reading has. */
export function weatherRows(w: WeatherReading): WeatherRow[] {
  const rows: WeatherRow[] = [];
  if (w.temp_c !== null) {
    const feels =
      w.feels_like_c !== null && Math.abs(w.feels_like_c - w.temp_c) >= 2
        ? `, feels like ${formatTemperature(w.feels_like_c)}`
        : "";
    rows.push({ label: "Temperature", value: `${formatTemperature(w.temp_c)}${feels}` });
  }
  if (w.humidity_pct !== null) {
    const dew = w.dew_point_c === null ? "" : `, dew point ${formatTemperature(w.dew_point_c)}`;
    rows.push({ label: "Humidity", value: `${formatPercent(w.humidity_pct, 0)}${dew}` });
  }
  if (w.wind_kmh !== null) {
    const from = w.wind_dir_deg === null ? "" : ` from the ${compass(w.wind_dir_deg)}`;
    const gusts = w.gust_kmh === null ? "" : `, gusts ${formatKmh(w.gust_kmh, 0)}`;
    rows.push({ label: "Wind", value: `${formatKmh(w.wind_kmh, 0)}${from}${gusts}` });
  }
  if (w.precip_mm !== null) {
    rows.push({
      label: "Rain",
      value: w.precip_mm >= RAIN_MM ? `${w.precip_mm.toFixed(1)} mm` : "none",
    });
  }
  if (w.cloud_pct !== null) {
    rows.push({ label: "Cloud", value: formatPercent(w.cloud_pct, 0) });
  }
  return rows;
}

/** Why the figure is approximate, for the popup's footnote. */
export function weatherSource(w: WeatherReading): string {
  return w.source === "forecast"
    ? "From Open-Meteo's models for the last few days; it is replaced by the final record about a week later."
    : "From Open-Meteo's ERA5 record, on a grid about 25 km across, so it is the area's weather, not a gauge at your door.";
}
