// The Edit dialog's form, as pure functions: values as the inputs hold them, what is
// wrong with them, and the PATCH that saves them. Only changed fields are sent, each
// with its real type, so a save never rewrites a field the user did not touch.
import type { EditableField, EditableValue } from "@/api/adapters";
import type { ActivityEditPatch } from "@/api/queries/useEditActivity";
import { activityTypeLabel } from "@/lib/activityKind";
import { formatDecimal } from "@/lib/format";

/** What each input holds: text for text, selects and numbers (so typing "1" of "10" works), a boolean for switches. */
export type FormValue = string | boolean;
export type FormValues = Record<string, FormValue>;

export function toFormValues(
  fields: readonly EditableField[],
  values: Record<string, EditableValue>,
): FormValues {
  const form: FormValues = {};
  for (const field of fields) {
    const value = values[field.name] ?? null;
    form[field.name] =
      field.editor === "bool" ? value === true : value === null ? "" : String(value);
  }
  return form;
}

/** Why a field's value can't be saved, or null when it can. An empty number clears it. */
export function fieldError(field: EditableField, value: FormValue): string | null {
  if (field.editor !== "number" || typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return "Not a number";
  if (field.type === "int" && !Number.isInteger(n)) return "Whole numbers only";
  const outside = (field.min !== null && n < field.min) || (field.max !== null && n > field.max);
  if (outside) return rangeText(field);
  return null;
}

function rangeText({ min, max }: EditableField): string {
  if (min !== null && max !== null) return `${formatDecimal(min, 0)} to ${formatDecimal(max, 0)}`;
  if (min !== null) return `At least ${formatDecimal(min, 0)}`;
  return `At most ${formatDecimal(max, 0)}`;
}

export function hasErrors(fields: readonly EditableField[], form: FormValues): boolean {
  return fields.some((field) => fieldError(field, form[field.name] ?? "") !== null);
}

/**
 * The value to send, in the field's type. Empty text or an empty number is null,
 * which reverts the field: Garmin's value comes back, or nothing for a user-only one.
 */
function toPatchValue(field: EditableField, value: FormValue): string | number | boolean | null {
  if (typeof value === "boolean") return value;
  const text = field.editor === "text" || field.editor === "textarea" ? value.trim() : value;
  if (text.trim() === "") return null;
  return field.editor === "number" ? Number(text) : text;
}

/** Text is compared trimmed, so a stray space is not an edit. */
function unchanged(field: EditableField, before: FormValue, after: FormValue): boolean {
  if (typeof before === "string" && typeof after === "string" && field.editor !== "select") {
    return before.trim() === after.trim();
  }
  return before === after;
}

/** Only the fields that changed, each in its own type. Empty when nothing did. */
export function editPatch(
  fields: readonly EditableField[],
  initial: FormValues,
  current: FormValues,
): ActivityEditPatch {
  const patch: ActivityEditPatch = {};
  for (const field of fields) {
    const before = initial[field.name] ?? "";
    const after = current[field.name] ?? "";
    if (!unchanged(field, before, after)) patch[field.name] = toPatchValue(field, after);
  }
  return patch;
}

/**
 * A select's options: the registry's, plus the activity's own value when the registry
 * doesn't list it (Garmin's vocabulary is open). Otherwise the select would show the
 * first option and a save would quietly retype the activity.
 */
export function selectOptions(field: EditableField, initial: FormValue): string[] {
  if (typeof initial !== "string" || initial === "" || field.choices.includes(initial)) {
    return field.choices;
  }
  return [initial, ...field.choices];
}

/** How a select option reads: activity types by their label, anything else as sent. */
export function optionLabel(field: EditableField, value: string): string {
  return field.name === "activity_type" ? activityTypeLabel(value) : value;
}
