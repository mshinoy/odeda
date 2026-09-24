import { create } from "zustand";
import { lastNDays, type DateRange } from "@/lib/time";

/** A hovered sample: `index` points into the activity's columnar streams (map and charts share it). */
export interface HoverPoint {
  activityId: string;
  index: number;
}

/** Cross-view UI state only; server data lives in React Query. */
interface UiState {
  selectedActivityIds: string[];
  toggleSelected: (id: string) => void;
  clearSelected: () => void;

  hover: HoverPoint | null;
  setHover: (hover: HoverPoint) => void;
  clearHover: () => void;

  timeRange: DateRange;
  setTimeRange: (range: DateRange) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  selectedActivityIds: [],
  toggleSelected: (id) =>
    set((state) => ({
      selectedActivityIds: state.selectedActivityIds.includes(id)
        ? state.selectedActivityIds.filter((selected) => selected !== id)
        : [...state.selectedActivityIds, id],
    })),
  clearSelected: () => set({ selectedActivityIds: [] }),

  hover: null,
  // Map and charts both write hover on every pointer move; skipping a same-sample write
  // keeps them from re-rendering each other in a loop.
  setHover: (hover) =>
    set((state) =>
      state.hover?.activityId === hover.activityId && state.hover.index === hover.index
        ? state
        : { hover },
    ),
  clearHover: () => set({ hover: null }),

  timeRange: lastNDays(30),
  setTimeRange: (timeRange) => set({ timeRange }),
}));
