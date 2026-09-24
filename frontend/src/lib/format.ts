// The only place numbers become strings. Inputs are base units as the API sends them:
// metres, seconds, metres per second. Missing or non-numeric values render as MISSING.
import type { ActivityKind } from "@/lib/activityKind";

export const MISSING = "–";

type MaybeNumber = number | null | undefined;

// Pinned locale: the app is English and metric regardless of the machine it runs on.
const LOCALE = "en-US";

const integer = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const fixedDigitsCache = new Map<number, Intl.NumberFormat>();

function fixedDigits(digits: number): Intl.NumberFormat {
  let formatter = fixedDigitsCache.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    fixedDigitsCache.set(digits, formatter);
  }
  return formatter;
}

function isNumber(value: MaybeNumber): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------- distance, time

export function formatDistance(metres: MaybeNumber): string {
  if (!isNumber(metres)) return MISSING;
  // Decide the unit on the rounded value, so 999.6 m becomes "1.0 km", not "1,000 m".
  if (Math.abs(Math.round(metres)) < 1000) return `${integer.format(metres)} m`;

  const km = roundTo(metres / 1000, 1);
  return Math.abs(km) >= 100 ? `${integer.format(km)} km` : `${oneDecimal.format(km)} km`;
}

/** "46:10" under an hour, "1:02:05" from an hour up. */
export function formatDuration(seconds: MaybeNumber): string {
  if (!isNumber(seconds)) return MISSING;
  const sign = seconds < 0 ? "-" : "";
  const total = Math.round(Math.abs(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (hours === 0) return `${sign}${minutes}:${pad2(secs)}`;
  return `${sign}${hours}:${pad2(minutes)}:${pad2(secs)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** m:ss, rounded to the whole second first so 359.6 s is "6:00", never "5:60". */
function minutesSeconds(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${pad2(total % 60)}`;
}

// ---------------------------------------------------------------- pace, speed

// Below these speeds the athlete is standing still (or floating), and pace is meaningless.
const MIN_MOVING_SPEED_MPS = 0.5;
// Slow drills in the pool run well under 0.5 m/s, so swimming gets a lower floor.
const MIN_SWIMMING_SPEED_MPS = 0.2;

export function formatPace(secondsPerKm: MaybeNumber): string {
  if (!isNumber(secondsPerKm) || secondsPerKm <= 0) return MISSING;
  return `${minutesSeconds(secondsPerKm)} /km`;
}

/** A pace's m:ss without its unit, for axis ticks that carry the unit once: "5:12". */
export function formatPaceClock(seconds: MaybeNumber): string {
  if (!isNumber(seconds) || seconds <= 0) return MISSING;
  return minutesSeconds(seconds);
}

/** The speed itself while moving, or null when too slow to count as moving. */
export function movingSpeed(mps: MaybeNumber): number | null {
  if (!isNumber(mps) || mps <= MIN_MOVING_SPEED_MPS) return null;
  return mps;
}

/** Seconds per km, or null when too slow to count as moving. */
export function paceFromSpeed(mps: MaybeNumber): number | null {
  const moving = movingSpeed(mps);
  return moving === null ? null : 1000 / moving;
}

export function formatSpeed(mps: MaybeNumber, digits = 1): string {
  if (!isNumber(mps)) return MISSING;
  return `${fixedDigits(digits).format(mps * 3.6)} km/h`;
}

export function formatSwimPace(mps: MaybeNumber): string {
  if (!isNumber(mps) || mps <= MIN_SWIMMING_SPEED_MPS) return MISSING;
  return `${minutesSeconds(100 / mps)} /100m`;
}

/** Speed in the unit each sport thinks in: pace on foot, km/h on a bike, /100m in water. */
export function formatSportSpeed(mps: MaybeNumber, kind: ActivityKind): string {
  switch (kind) {
    case "run":
    case "walk":
      return formatPace(paceFromSpeed(mps));
    case "swim":
      return formatSwimPace(mps);
    case "ride":
    case "strength":
    case "other":
      return formatSpeed(mps);
  }
}

// ---------------------------------------------------------------- body, terrain, ratios

/** A unitless count or score, rounded: "139", "1,145". */
export function formatInteger(value: MaybeNumber): string {
  if (!isNumber(value)) return MISSING;
  return integer.format(value);
}

export function formatHeartRate(bpm: MaybeNumber): string {
  if (!isNumber(bpm)) return MISSING;
  return `${integer.format(bpm)} bpm`;
}

export function formatElevation(metres: MaybeNumber): string {
  if (!isNumber(metres)) return MISSING;
  return `${integer.format(metres)} m`;
}

/** Takes a value already in percent, as the API sends `*_pct` fields: 12.5 → "12.5%". */
export function formatPercent(pct: MaybeNumber, digits = 0): string {
  if (!isNumber(pct)) return MISSING;
  return `${fixedDigits(digits).format(pct)}%`;
}

/** Direction and size of a change in percent: "▲ 4%", "▼ 3%", "0%". Whether it is good is not decided here. */
export function formatDelta(pct: MaybeNumber, digits = 0): string {
  if (!isNumber(pct)) return MISSING;
  const rounded = roundTo(pct, digits);
  // Also catches -0 and values that round to zero, which should not carry an arrow.
  if (rounded === 0) return `${fixedDigits(digits).format(0)}%`;

  const arrow = rounded > 0 ? "▲" : "▼";
  return `${arrow} ${fixedDigits(digits).format(Math.abs(rounded))}%`;
}

// ---------------------------------------------------------------- dates

// All date formatters run in UTC over a "wall clock" Date (see parseWallClock), so a
// YYYY-MM-DD day or an activity's local start time never shifts with the viewer's zone.
const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
const dateYearFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const timeFormat = new Intl.DateTimeFormat(LOCALE, {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const weekdayFormat = new Intl.DateTimeFormat(LOCALE, { timeZone: "UTC", weekday: "short" });

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/;

/**
 * A Date whose UTC fields hold the wall-clock time to display.
 * "2026-09-22" and "2026-09-22T07:15:00" (no offset: the API's local times) are taken as
 * written. Strings with Z or an offset are real instants, shown in the viewer's zone.
 */
function parseWallClock(iso: string): Date | null {
  const match = WALL_CLOCK.exec(iso.trim());
  if (match) {
    const [, y, mo, d, h, mi, s] = match;
    const date = new Date(
      Date.UTC(
        Number(y),
        Number(mo) - 1,
        Number(d),
        Number(h ?? 0),
        Number(mi ?? 0),
        Number(s ?? 0),
      ),
    );
    // Date.UTC rolls "2026-02-30" over into March; reject it instead.
    const valid = date.getUTCMonth() === Number(mo) - 1 && date.getUTCDate() === Number(d);
    return valid ? date : null;
  }

  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  return new Date(
    Date.UTC(
      instant.getFullYear(),
      instant.getMonth(),
      instant.getDate(),
      instant.getHours(),
      instant.getMinutes(),
      instant.getSeconds(),
    ),
  );
}

function dayLabel(date: Date, today: Date): string {
  const sameYear = date.getUTCFullYear() === today.getFullYear();
  return (sameYear ? dateFormat : dateYearFormat).format(date);
}

/** "Sep 22", or "Sep 22, 2025" outside the current year. */
export function formatDate(iso: string | null | undefined, today: Date = new Date()): string {
  const date = iso ? parseWallClock(iso) : null;
  if (!date) return MISSING;
  return dayLabel(date, today);
}

/** "Sep 22, 07:15", or "Sep 22, 2025, 07:15" outside the current year. */
export function formatDateTime(iso: string | null | undefined, today: Date = new Date()): string {
  const date = iso ? parseWallClock(iso) : null;
  if (!date) return MISSING;
  return `${dayLabel(date, today)}, ${timeFormat.format(date)}`;
}

/** "Tue". */
export function formatWeekday(iso: string | null | undefined): string {
  const date = iso ? parseWallClock(iso) : null;
  if (!date) return MISSING;
  return weekdayFormat.format(date);
}

// ---------------------------------------------------------------- plain numbers

/** "86.1" — a unitless value with fixed decimals. */
export function formatDecimal(value: MaybeNumber, digits = 1): string {
  if (!isNumber(value)) return MISSING;
  return fixedDigits(digits).format(value);
}

/** "+3.2" / "−4.9" (a true minus sign), for values whose sign is the point, like form. */
export function formatSigned(value: MaybeNumber, digits = 1): string {
  if (!isNumber(value)) return MISSING;
  const rounded = roundTo(value, digits);
  if (rounded === 0) return fixedDigits(digits).format(0);
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${fixedDigits(digits).format(Math.abs(rounded))}`;
}

/** "1 day" / "115 days". */
export function formatDays(days: MaybeNumber): string {
  if (!isNumber(days)) return MISSING;
  const n = Math.round(days);
  return `${integer.format(n)} ${Math.abs(n) === 1 ? "day" : "days"}`;
}

// ---------------------------------------------------------------- relative time

/**
 * "just now", "12 min ago", "3 h ago", "2 d ago". Server timestamps without an offset are
 * the server's local wall clock, which this app assumes is the viewer's too.
 */
export function formatAgo(iso: string | null | undefined, now: Date = new Date()): string {
  const then = iso ? parseWallClock(iso) : null;
  if (!then) return MISSING;
  const nowWall = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  );
  const minutes = Math.floor((nowWall - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${integer.format(Math.floor(hours / 24))} d ago`;
}
