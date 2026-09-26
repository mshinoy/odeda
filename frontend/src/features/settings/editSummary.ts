import type { OverridesSummary } from "@/api/queries/useSettings";

export interface EditCount {
  /** The registry name, or `exercise` for the relabels, which have no one field. */
  key: string;
  label: string;
  n: number;
}

/**
 * The edits by field, labelled from the registry the same response carries, with the
 * exercise relabels added as one row.
 *
 * Relabels are keyed `exercise:<index>` in the `overrides` table, so counting them
 * per field would be a list of index noise; the backend already sums them.
 */
export function toEditCounts(summary: OverridesSummary): EditCount[] {
  const labels = new Map(summary.fields.map((field) => [field.name, field.label]));
  const rows: EditCount[] = summary.by_field.map((row) => ({
    key: row.field,
    label: labels.get(row.field) ?? row.field,
    n: row.n,
  }));

  if (summary.exercise_relabels > 0) {
    rows.push({
      key: "exercise",
      label: "Exercise relabels",
      n: summary.exercise_relabels,
    });
  }
  // The backend sorts `by_field` by count; the relabels have to find their place.
  return rows.sort((a, b) => b.n - a.n);
}
