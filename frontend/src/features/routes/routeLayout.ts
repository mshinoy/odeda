import type { RouteLayout } from "@/api/adapters";

/** What the page calls each shape the clusterer finds. */
export const LAYOUT_LABELS: Readonly<Record<RouteLayout, string>> = {
  loop: "Loop",
  out_and_back: "Out and back",
  one_way: "One way",
};
