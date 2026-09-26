// A night's sleep split into the three stages Garmin records, in hours. Pure, so the
// chart and its legend read the same numbers.
import type { DailyRow } from "@/api/queries/useHealth";

export interface SleepNight {
  day: string;
  /** Hours in each stage; null on a night the watch recorded none. */
  deepH: number | null;
  remH: number | null;
  lightH: number | null;
}

const SECONDS_PER_HOUR = 3600;

function hours(seconds: number | null): number | null {
  return seconds === null ? null : seconds / SECONDS_PER_HOUR;
}

export function sleepNights(rows: readonly DailyRow[]): SleepNight[] {
  return rows.map((row) => ({
    day: row.day,
    deepH: hours(row.deep_s),
    remH: hours(row.rem_s),
    lightH: hours(row.light_s),
  }));
}

/** The three stages add up to the night, so a null stage contributes nothing. */
export function nightTotalH(night: SleepNight): number | null {
  const stages = [night.deepH, night.remH, night.lightH].filter(
    (stage): stage is number => stage !== null,
  );
  return stages.length === 0 ? null : stages.reduce((sum, stage) => sum + stage, 0);
}

export function hasSleepStages(nights: readonly SleepNight[]): boolean {
  return nights.some((night) => nightTotalH(night) !== null);
}
