import { describe, expect, it } from "vitest";
import type { OverridesSummary } from "@/api/queries/useSettings";
import { toEditCounts } from "@/features/settings/editSummary";

function summary(patch: Partial<OverridesSummary> = {}): OverridesSummary {
  return {
    total: 0,
    activities_edited: 0,
    exercise_relabels: 0,
    by_field: [],
    fields: [
      {
        name: "activity_name",
        type: "text",
        label: "Name",
        editor: "text",
        choices: null,
        min: null,
        max: null,
        user_only: false,
        help: "",
      },
    ],
    ...patch,
  };
}

describe("toEditCounts", () => {
  it("labels a field from the registry in the same response", () => {
    const rows = toEditCounts(summary({ total: 3, by_field: [{ field: "activity_name", n: 3 }] }));

    expect(rows).toEqual([{ key: "activity_name", label: "Name", n: 3 }]);
  });

  it("falls back to the raw name for a field the registry has dropped", () => {
    const rows = toEditCounts(summary({ by_field: [{ field: "gone", n: 1 }] }));

    expect(rows[0]?.label).toBe("gone");
  });

  it("adds the relabels as one row, sorted into place by count", () => {
    const rows = toEditCounts(
      summary({
        exercise_relabels: 5,
        by_field: [
          { field: "activity_name", n: 9 },
          { field: "gone", n: 2 },
        ],
      }),
    );

    // The backend sorts by_field by count; the relabels have to find their place.
    expect(rows.map((row) => row.n)).toEqual([9, 5, 2]);
    expect(rows[1]).toEqual({ key: "exercise", label: "Exercise relabels", n: 5 });
  });

  it("leaves the relabel row out when there are none", () => {
    const rows = toEditCounts(summary({ by_field: [{ field: "activity_name", n: 1 }] }));

    expect(rows).toHaveLength(1);
  });
});
