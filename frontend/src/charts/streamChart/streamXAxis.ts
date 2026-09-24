// The shared x-axis of an activity's stream charts: distance when the activity has it,
// elapsed time otherwise. Every chart of one activity gets the same values and extent,
// so their crosshairs line up.
import type { ActivityStreams } from "@/api/adapters";
import { decimalStep, MINUTES_STEPS, stepFrom } from "@/charts/axisScale";
import { formatDistance, formatDuration } from "@/lib/format";

export type StreamXUnit = "km" | "min";

export interface StreamXAxis {
  unit: StreamXUnit;
  /** One x value per stream sample, same length as the streams; never null. */
  values: number[];
  min: number;
  max: number;
  /** Tick spacing in the axis unit. */
  step: number;
  /** Tick labels and the tooltip position: "3.4 km" or "12:30". */
  format: (value: number) => string;
}

const MAX_X_INTERVALS = 5;

export function streamXAxis(streams: ActivityStreams): StreamXAxis {
  return hasDistance(streams) ? distanceAxis(streams) : elapsedAxis(streams);
}

function hasDistance(streams: ActivityStreams): boolean {
  return streams.distanceM.some((metres) => metres !== null && metres > 0);
}

function distanceAxis(streams: ActivityStreams): StreamXAxis {
  const values = forwardFilled(streams.distanceM).map((metres) => metres / 1000);
  const max = largest(values);
  return {
    unit: "km",
    values,
    min: 0,
    max,
    step: decimalStep(max, MAX_X_INTERVALS),
    format: (km) => formatDistance(km * 1000),
  };
}

function elapsedAxis(streams: ActivityStreams): StreamXAxis {
  const values = streams.elapsedS.map((seconds) => seconds / 60);
  const max = largest(values);
  return {
    unit: "min",
    values,
    min: 0,
    max,
    step: stepFrom(MINUTES_STEPS, max, MAX_X_INTERVALS),
    format: (minutes) => formatDuration(minutes * 60),
  };
}

/**
 * Distance is cumulative, so a missing sample is where the previous one was
 * (0 before the first fix). Every sample keeps an x, so hover can place any index.
 */
function forwardFilled(values: readonly (number | null)[]): number[] {
  let previous = 0;
  return values.map((value) => {
    if (value !== null) previous = value;
    return previous;
  });
}

// Falls back to 1 so an axis over a single sample still has a width.
function largest(values: readonly number[]): number {
  const max = values.reduce((largestSoFar, value) => Math.max(largestSoFar, value), 0);
  return max > 0 ? max : 1;
}
