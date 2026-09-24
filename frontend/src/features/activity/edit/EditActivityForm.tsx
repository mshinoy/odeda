import { useMemo, useState, type FormEvent } from "react";
import { toEditableValues, type EditableField } from "@/api/adapters";
import type { components } from "@/api/schema";
import { useEditActivity } from "@/api/queries/useEditActivity";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import {
  editPatch,
  fieldError,
  hasErrors,
  selectOptions,
  toFormValues,
  type FormValue,
} from "@/features/activity/edit/editForm";
import { FieldControl } from "@/features/activity/edit/FieldControl";

interface EditActivityFormProps {
  row: components["schemas"]["ActivityRow"];
  fields: readonly EditableField[];
  onSaved: () => void;
}

/** The fields and Save. Mounted each time the dialog opens, so it starts from the saved values. */
export function EditActivityForm({ row, fields, onSaved }: EditActivityFormProps) {
  const initial = useMemo(() => toFormValues(fields, toEditableValues(row, fields)), [row, fields]);
  const [form, setForm] = useState(initial);
  const save = useEditActivity(row.activity_id);

  const patch = editPatch(fields, initial, form);
  const canSave = Object.keys(patch).length > 0 && !hasErrors(fields, form) && !save.isPending;

  function setValue(name: string, value: FormValue) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSave) save.mutate(patch, { onSuccess: onSaved });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {fields.map((field) => {
        const value = form[field.name] ?? "";
        return (
          <FieldControl
            key={field.name}
            field={field}
            value={value}
            options={selectOptions(field, initial[field.name] ?? "")}
            error={fieldError(field, value)}
            onChange={(next) => setValue(field.name, next)}
          />
        );
      })}
      <DialogFooter className="items-center">
        {save.error && <p className="text-delta-bad mr-auto text-sm">{save.error.message}</p>}
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={!canSave}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
