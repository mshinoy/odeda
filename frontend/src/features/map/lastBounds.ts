// Where the heatmap last showed, remembered in this browser, so the next visit can open
// the map there at once and draw the heatmap on it when the data arrives, instead of
// waiting for the data to know where to look. A convenience only: when it is missing,
// unreadable or the browser refuses storage, the map waits for the data as before.
import type { MapBounds } from "@/map/types";

const STORAGE_KEY = "ga.map.lastBounds";

export function readLastBounds(storage: Storage | undefined = safeStorage()): MapBounds | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? parseBounds(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function rememberBounds(bounds: MapBounds, storage: Storage | undefined = safeStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(bounds));
  } catch {
    // Private mode or a full quota: the next visit simply waits for the data.
  }
}

/** A stored value back into bounds, or null for anything that is not a sane box. */
export function parseBounds(value: unknown): MapBounds | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [sw, ne] = value as unknown[];
  if (!isPoint(sw) || !isPoint(ne)) return null;
  if (sw[0] > ne[0] || sw[1] > ne[1]) return null;
  return [sw, ne];
}

function isPoint(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((n) => typeof n === "number" && Number.isFinite(n)) &&
    Math.abs(value[0] as number) <= 180 &&
    Math.abs(value[1] as number) <= 90
  );
}

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
