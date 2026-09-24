import { describe, expect, it } from "vitest";
import type { EditableField } from "@/api/adapters";
import {
  editPatch,
  fieldError,
  hasErrors,
  revertLabel,
  selectOptions,
  toFormValues,
} from "@/features/activity/edit/editForm";

function field(overrides: Partial<EditableField> & Pick<EditableField, "name">): EditableField {
  return {
    label: overrides.name,
    type: "text",
    editor: "text",
    choices: [],
    min: null,
    max: null,
    userOnly: false,
    ...overrides,
  };
}

// The registry as `db/fields.py` has it.
const fields: EditableField[] = [
  field({ name: "activity_name" }),
  field({ name: "activity_type", editor: "select", choices: ["running", "cycling", "other"] }),
  field({ name: "notes", editor: "textarea", userOnly: true }),
  field({ name: "rpe", type: "int", editor: "number", min: 1, max: 10, userOnly: true }),
  field({ name: "private", type: "bool", editor: "bool", userOnly: true }),
  field({ name: "excluded_from_stats", type: "bool", editor: "bool", userOnly: true }),
];

const values = {
  activity_name: "Doha Running",
  activity_type: "running",
  notes: null,
  rpe: 6,
  private: false,
  excluded_from_stats: false,
};

const initial = toFormValues(fields, values);

describe("toFormValues", () => {
  it("holds text and numbers as input text, booleans as booleans, missing as empty", () => {
    expect(initial).toEqual({
      activity_name: "Doha Running",
      activity_type: "running",
      notes: "",
      rpe: "6",
      private: false,
      excluded_from_stats: false,
    });
  });
});

describe("editPatch", () => {
  it("is empty when nothing changed", () => {
    expect(editPatch(fields, initial, { ...initial })).toEqual({});
  });

  it("sends only the changed fields, each in its own type", () => {
    const current = { ...initial, rpe: "8", excluded_from_stats: true, notes: " Felt heavy " };
    expect(editPatch(fields, initial, current)).toEqual({
      rpe: 8,
      excluded_from_stats: true,
      notes: "Felt heavy",
    });
  });

  it("does not count a stray space as an edit", () => {
    expect(editPatch(fields, initial, { ...initial, activity_name: "Doha Running " })).toEqual({});
  });

  it("sends null for a cleared field, which reverts it", () => {
    expect(editPatch(fields, initial, { ...initial, rpe: "", activity_name: "  " })).toEqual({
      rpe: null,
      activity_name: null,
    });
  });

  it("sends a new type as the type's string", () => {
    expect(editPatch(fields, initial, { ...initial, activity_type: "cycling" })).toEqual({
      activity_type: "cycling",
    });
  });
});

describe("fieldError", () => {
  const rpe = fields[3];
  if (rpe === undefined) throw new Error("rpe");

  it("accepts a whole number in range, and empty", () => {
    expect(fieldError(rpe, "7")).toBeNull();
    expect(fieldError(rpe, "")).toBeNull();
  });

  it("names what is wrong", () => {
    expect(fieldError(rpe, "abc")).toBe("Not a number");
    expect(fieldError(rpe, "6.5")).toBe("Whole numbers only");
    expect(fieldError(rpe, "11")).toBe("1 to 10");
    expect(fieldError(rpe, "0")).toBe("1 to 10");
  });

  it("only checks numbers", () => {
    expect(fieldError(fields[0] ?? rpe, "anything")).toBeNull();
    expect(hasErrors(fields, { ...initial, rpe: "12" })).toBe(true);
    expect(hasErrors(fields, initial)).toBe(false);
  });
});

describe("selectOptions", () => {
  const type = fields[1];
  if (type === undefined) throw new Error("type");

  it("offers the registry's choices", () => {
    expect(selectOptions(type, "running")).toEqual(["running", "cycling", "other"]);
  });

  it("keeps a value the registry doesn't list, so a save never retypes the activity", () => {
    expect(selectOptions(type, "hiit")).toEqual(["hiit", "running", "cycling", "other"]);
    expect(
      editPatch(
        fields,
        { ...initial, activity_type: "hiit" },
        { ...initial, activity_type: "hiit" },
      ),
    ).toEqual({});
  });
});

describe("revertLabel", () => {
  const [title, type, notes] = fields;
  if (title === undefined || type === undefined || notes === undefined) throw new Error("fields");

  it("names the value Garmin brings back, types by their label", () => {
    expect(revertLabel(title, "Doha Running")).toBe("Garmin: Doha Running");
    expect(revertLabel(type, "running")).toBe("Garmin: Running");
    expect(revertLabel(title, null)).toBe("Garmin: –");
  });

  it("says Clear for a field Garmin never sets", () => {
    expect(revertLabel(notes, null)).toBe("Clear");
  });
});
