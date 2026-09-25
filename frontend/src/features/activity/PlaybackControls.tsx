import { Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/NativeSelect";
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from "@/features/activity/playback";
import type { Playback } from "@/features/activity/usePlayback";
import { formatDuration } from "@/lib/format";

interface PlaybackControlsProps {
  playback: Playback;
  durationS: number;
}

/** Play/pause, the elapsed time, a scrubber and how fast it replays. */
export function PlaybackControls({ playback, durationS }: PlaybackControlsProps) {
  const { currentS, playing, speed, toggle, setSpeed, scrubTo } = playback;

  return (
    <div className="bg-background/90 flex items-center gap-3 rounded-lg px-2.5 py-1.5 shadow-sm backdrop-blur">
      <Button
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={playing ? "Pause" : "Play"}
        onClick={toggle}
      >
        {playing ? <Pause /> : <Play />}
      </Button>
      <span className="text-muted-foreground w-12 text-xs tabular-nums">
        {formatDuration(currentS)}
      </span>
      <input
        type="range"
        aria-label="Replay position"
        className="accent-foreground w-40"
        min={0}
        max={durationS}
        step={1}
        value={currentS}
        onChange={(event) => scrubTo(Number(event.target.value))}
      />
      <NativeSelect
        aria-label="Replay speed"
        className="h-7 text-xs"
        value={String(speed)}
        onChange={(event) => setSpeed(Number(event.target.value) as PlaybackSpeed)}
      >
        {PLAYBACK_SPEEDS.map((option) => (
          <option key={option} value={option}>
            {option}×
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
