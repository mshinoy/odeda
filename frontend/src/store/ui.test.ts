import { beforeEach, describe, expect, it } from "vitest";
import { lastNDays } from "@/lib/time";
import { useUiStore } from "@/store/ui";

const initialState = useUiStore.getState();

describe("useUiStore", () => {
  beforeEach(() => useUiStore.setState(initialState, true));

  it("toggles activity selection in click order", () => {
    const { toggleSelected } = useUiStore.getState();
    toggleSelected("a");
    toggleSelected("b");
    expect(useUiStore.getState().selectedActivityIds).toEqual(["a", "b"]);
    toggleSelected("a");
    expect(useUiStore.getState().selectedActivityIds).toEqual(["b"]);
    useUiStore.getState().clearSelected();
    expect(useUiStore.getState().selectedActivityIds).toEqual([]);
  });

  it("sets and clears the hovered sample", () => {
    useUiStore.getState().setHover({ activityId: "a", index: 42 });
    expect(useUiStore.getState().hover).toEqual({ activityId: "a", index: 42 });
    useUiStore.getState().clearHover();
    expect(useUiStore.getState().hover).toBeNull();
  });

  it("defaults the time range to the last 30 days", () => {
    expect(useUiStore.getState().timeRange).toEqual(lastNDays(30));
    useUiStore.getState().setTimeRange({ start: "2026-01-01", end: "2026-01-31" });
    expect(useUiStore.getState().timeRange).toEqual({ start: "2026-01-01", end: "2026-01-31" });
  });
});
