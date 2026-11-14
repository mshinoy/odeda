import { Pause, Play, Satellite } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/NativeSelect";
import { Toggle } from "@/components/ui/toggle";
import { CAMERA_LABELS, CAMERA_MODES, type CameraMode } from "@/features/activity/flyover";
import { PLAYBACK_SPEEDS, type PlaybackSpeed } from "@/features/activity/playback";
import type { Playback } from "@/features/activity/usePlayback";
import { formatDuration } from "@/lib/format";

interface PlaybackControlsProps {
  playback: Playback;
  durationS: number;
  cameraMode: CameraMode;
  onCameraMode: (mode: CameraMode) => void;
  /** Satellite imagery needs Mapbox; without it the toggle is not offered. */
  satellite: boolean | null;
  onSatellite: (on: boolean) => void;
}

/**
 * Play/pause, the elapsed time, a scrubber, how fast it replays, and the camera: the
 * flat map, or a chase camera or drone orbit flown along the replay.
 */
export function PlaybackControls({
  playback,
  durationS,
  cameraMode,
  onCameraMode,
  satellite,
  onSatellite,
}: PlaybackControlsProps) {
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
      <NativeSelect
        aria-label="Camera"
        className="h-7 text-xs"
        value={cameraMode}
        onChange={(event) => onCameraMode(event.target.value as CameraMode)}
      >
        {CAMERA_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {CAMERA_LABELS[mode]}
          </option>
        ))}
      </NativeSelect>
      {satellite !== null && (
        <Toggle
          size="sm"
          aria-label="Satellite imagery"
          pressed={satellite}
          onPressedChange={onSatellite}
        >
          <Satellite />
        </Toggle>
      )}
    </div>
  );
}
