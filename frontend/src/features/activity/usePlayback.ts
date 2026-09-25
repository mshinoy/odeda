import { useCallback, useEffect, useState } from "react";
import {
  advance,
  DEFAULT_SPEED,
  resumeFrom,
  type PlaybackSpeed,
} from "@/features/activity/playback";

export interface Playback {
  /** Where playback is, in the activity's `elapsed_s`. */
  currentS: number;
  playing: boolean;
  speed: PlaybackSpeed;
  toggle: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  /** Dragging the scrubber; it pauses, because scrubbing and playing fight each other. */
  scrubTo: (seconds: number) => void;
}

/**
 * Drives the clock behind route playback. It runs on `requestAnimationFrame` rather
 * than an interval, so the trail moves with the display's refresh, and it stops at the
 * end of the activity.
 */
export function usePlayback(durationS: number): Playback {
  const [currentS, setCurrentS] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(DEFAULT_SPEED);

  // Opening another activity rewinds: this component is not remounted for it, so the
  // reset happens here rather than in an effect (React's "adjusting state on a prop
  // change" pattern — an effect would render once with the old activity's position).
  const [playedActivity, setPlayedActivity] = useState(durationS);
  if (playedActivity !== durationS) {
    setPlayedActivity(durationS);
    setCurrentS(0);
    setPlaying(false);
  }

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let previous = performance.now();

    function step(now: number) {
      const frameMs = now - previous;
      previous = now;
      setCurrentS((current) => {
        const next = advance(current, frameMs, speed, durationS);
        if (next >= durationS) setPlaying(false);
        return next;
      });
      frame = requestAnimationFrame(step);
    }

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, durationS]);

  const toggle = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (!wasPlaying) setCurrentS((current) => resumeFrom(current, durationS));
      return !wasPlaying;
    });
  }, [durationS]);

  const scrubTo = useCallback((seconds: number) => {
    setPlaying(false);
    setCurrentS(seconds);
  }, []);

  return { currentS, playing, speed, toggle, setSpeed, scrubTo };
}
