import { useMemo, useState, type FormEvent } from "react";
import { toEditableValues, type EditableField, type FieldEdit } from "@/api/adapters";
import type { components } from "@/api/schema";
import { useEditActivity, useRevertAll, useRevertField } from "@/api/queries/useEditActivity";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogFooter } from "@/components/ui/dialog";
import {
  editPatch,
  fieldError,
  hasErrors,
  revertLabel,
  selectOptions,
  toFormValues,
  type FormValue,
} from "@/features/activity/edit/editForm";
import { FieldControl } from "@/features/activity/edit/FieldControl";
import { formatInteger } from "@/lib/format";

type ActivityRow = components["schemas"]["ActivityRow"];

interface EditActivityFormProps {
  row: ActivityRow;
  fields: readonly EditableField[];
  edits: readonly FieldEdit[];
  onSaved: () => void;
}

/** The fields and Save. Mounted each time the dialog opens, so it starts from the saved values. */
export function EditActivityForm({ row, fields, edits, onSaved }: EditActivityFormProps) {
  const initial = useMemo(() => toFormValues(fields, toEditableValues(row, fields)), [row, fields]);
  const [form, setForm] = useState(initial);
  const [confirmRevertAll, setConfirmRevertAll] = useState(false);
  const id = row.activity_id;
  const save = useEditActivity(id);
  const revertField = useRevertField(id);
  const revertAll = useRevertAll(id);
  const busy = save.isPending || revertField.isPending || revertAll.isPending;
  const error = save.error ?? revertField.error ?? revertAll.error;

  const patch = editPatch(fields, initial, form);
  const canSave = Object.keys(patch).length > 0 && !hasErrors(fields, form) && !busy;
  const editsByField = new Map(edits.map((edit) => [edit.field, edit]));

  function setValue(name: string, value: FormValue) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  /** The saved values after a revert, as the inputs hold them. */
  function savedValues(saved: ActivityRow | null) {
    return saved ? toFormValues(fields, toEditableValues(saved, fields)) : initial;
  }

  function revertOne(name: string) {
    revertField.mutate(name, {
      // Other fields keep what is being typed in them.
      onSuccess: (result) => setValue(name, savedValues(result.activity)[name] ?? ""),
    });
  }

  function revertEverything() {
    revertAll.mutate(undefined, {
      onSuccess: (result) => {
        setForm(savedValues(result.activity));
        setConfirmRevertAll(false);
      },
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (canSave) save.mutate(patch, { onSuccess: onSaved });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {fields.map((field) => {
        const value = form[field.name] ?? "";
        const edit = editsByField.get(field.name);
        return (
          <FieldControl
            key={field.name}
            field={field}
            value={value}
            options={selectOptions(field, initial[field.name] ?? "")}
            error={fieldError(field, value)}
            onChange={(next) => setValue(field.name, next)}
            revert={
              edit && {
                label: revertLabel(field, edit.garminValue),
                onRevert: () => revertOne(field.name),
                disabled: busy,
              }
            }
          />
        );
      })}
      <DialogFooter className="items-center">
        {error && <p className="text-delta-bad mr-auto text-sm">{error.message}</p>}
        {!error && edits.length > 0 && !confirmRevertAll && (
          <Button
            type="button"
            variant="ghost"
            className="mr-auto"
            disabled={busy}
            onClick={() => setConfirmRevertAll(true)}
          >
            Revert all
          </Button>
        )}
        {!error && confirmRevertAll && (
          <div className="mr-auto flex items-center gap-2">
            <span className="text-muted-foreground">
              {edits.length === 1
                ? "Revert 1 edit?"
                : `Revert ${formatInteger(edits.length)} edits?`}
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={revertEverything}
            >
              Revert
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmRevertAll(false)}
            >
              Keep
            </Button>
          </div>
        )}
        {!confirmRevertAll && (
          <>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSave}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </>
        )}
      </DialogFooter>
    </form>
  );
}
