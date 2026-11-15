import { describe, expect, it, vi } from "vitest";
import { probeOf } from "@/map/probe";

function fakeMap(initial: { tiles: boolean; style: boolean } = { tiles: true, style: true }) {
  const listeners = new Set<() => void>();
  const state = { ...initial };
  return {
    listeners,
    state,
    triggerRepaint: vi.fn(),
    areTilesLoaded: () => state.tiles,
    isStyleLoaded: () => state.style,
    on: vi.fn((_type: "render", listener: () => void) => listeners.add(listener)),
    off: vi.fn((_type: "render", listener: () => void) => listeners.delete(listener)),
    render() {
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("probeOf", () => {
  it("resolves on the first render whose tiles are all in, after asking for a repaint", async () => {
    const map = fakeMap();
    let done = false;
    const waiting = probeOf(map)
      .whenIdle()
      .then(() => (done = true));
    expect(map.triggerRepaint).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(done).toBe(false);
    map.render();
    await waiting;
    expect(done).toBe(true);
    expect(map.listeners.size).toBe(0);
  });

  it("keeps waiting through renders while tiles or the style are still loading", async () => {
    const map = fakeMap({ tiles: false, style: true });
    let done = false;
    const waiting = probeOf(map)
      .whenIdle()
      .then(() => (done = true));
    map.render();
    map.render();
    await Promise.resolve();
    expect(done).toBe(false);
    map.state.tiles = true;
    map.state.style = false;
    map.render();
    await Promise.resolve();
    expect(done).toBe(false);
    map.state.style = true;
    map.render();
    await waiting;
    expect(done).toBe(true);
  });

  it("gives up after the timeout, so a stuck tile cannot hang an export", async () => {
    vi.useFakeTimers();
    const map = fakeMap({ tiles: false, style: true });
    const waiting = probeOf(map).whenIdle(500);
    vi.advanceTimersByTime(500);
    await waiting;
    expect(map.listeners.size).toBe(0);
    vi.useRealTimers();
  });

  it("says whether the tiles were already in on the first draw, and how many draws it took", async () => {
    const ready = fakeMap();
    const first = probeOf(ready).whenIdle();
    ready.render();
    expect(await first).toEqual({ renders: 1, readyFirst: true, timedOut: false });

    const slow = fakeMap({ tiles: false, style: true });
    const second = probeOf(slow).whenIdle();
    slow.render();
    slow.render();
    slow.state.tiles = true;
    slow.render();
    expect(await second).toEqual({ renders: 3, readyFirst: false, timedOut: false });
  });

  it("reports a timeout as one", async () => {
    vi.useFakeTimers();
    const map = fakeMap({ tiles: false, style: true });
    const waiting = probeOf(map).whenIdle(300);
    vi.advanceTimersByTime(300);
    expect((await waiting).timedOut).toBe(true);
    vi.useRealTimers();
  });
});
