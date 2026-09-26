import { useState, type FormEvent } from "react";
import type { GearRecord } from "@/api/adapters";
import { useCreateGear, useDeleteGear, useUpdateGear, type GearWrite } from "@/api/queries/useGear";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/NativeSelect";
import { Switch } from "@/components/ui/switch";

interface GearDialogProps {
  /** The item to edit, or null to create one. */
  item: GearRecord | null;
  kinds: readonly string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Draft {
  kind: string;
  brand: string;
  model: string;
  nickname: string;
  purchaseDate: string;
  /** Kilometres in the form; metres on the wire. */
  initialKm: string;
  retirementKm: string;
  retired: boolean;
  notes: string;
}

function draftOf(item: GearRecord | null, kinds: readonly string[]): Draft {
  return {
    kind: item?.kind ?? kinds[0] ?? "other",
    brand: item?.brand ?? "",
    model: item?.model ?? "",
    nickname: item?.nickname ?? "",
    purchaseDate: item?.purchaseDate ?? "",
    initialKm: item ? kmField(item.initialDistanceM) : "",
    retirementKm: item ? kmField(item.retirementDistanceM) : "",
    retired: item?.retired ?? false,
    notes: item?.notes ?? "",
  };
}

function kmField(metres: number | null): string {
  return metres === null || metres === 0 ? "" : String(metres / 1000);
}

/** A blank field is a cleared value, which is a null on the wire, not a zero. */
function metresOf(km: string): number | null {
  const trimmed = km.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value * 1000 : null;
}

function bodyOf(draft: Draft): GearWrite {
  return {
    kind: draft.kind as GearWrite["kind"],
    brand: draft.brand.trim() || null,
    model: draft.model.trim() || null,
    nickname: draft.nickname.trim() || null,
    purchase_date: draft.purchaseDate.trim() || null,
    // The backend defaults a null to 0; the threshold keeps its "no limit" null.
    initial_distance_m: metresOf(draft.initialKm) ?? 0,
    retirement_distance_m: metresOf(draft.retirementKm),
    retired: draft.retired,
    notes: draft.notes.trim() || null,
  };
}

/** Add or change an item. The old dashboard asked for these in seven `window.prompt`s. */
export function GearDialog({ item, kinds, open, onOpenChange }: GearDialogProps) {
  // Keyed on the item in the parent, so the draft starts from whatever was opened.
  const [draft, setDraft] = useState(() => draftOf(item, kinds));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const create = useCreateGear();
  const update = useUpdateGear(item?.id ?? 0);
  const remove = useDeleteGear(item?.id ?? 0);

  const save = item ? update : create;
  const named =
    draft.nickname.trim() !== "" || draft.brand.trim() !== "" || draft.model.trim() !== "";

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate(bodyOf(draft), { onSuccess: () => onOpenChange(false) });
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? item.name : "Add gear"}</DialogTitle>
          <DialogDescription>
            Shoes, a bike, a strap. Mileage is counted from the activities you put it on.
          </DialogDescription>
        </DialogHeader>

        <form id="gear-form" onSubmit={submit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Kind" htmlFor="gear-kind">
              <NativeSelect
                id="gear-kind"
                className="w-full"
                value={draft.kind}
                onChange={(event) => set("kind", event.target.value)}
              >
                {kinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Nickname" htmlFor="gear-nickname">
              <Input
                id="gear-nickname"
                value={draft.nickname}
                onChange={(event) => set("nickname", event.target.value)}
              />
            </Field>
            <Field label="Brand" htmlFor="gear-brand">
              <Input
                id="gear-brand"
                value={draft.brand}
                onChange={(event) => set("brand", event.target.value)}
              />
            </Field>
            <Field label="Model" htmlFor="gear-model">
              <Input
                id="gear-model"
                value={draft.model}
                onChange={(event) => set("model", event.target.value)}
              />
            </Field>
            <Field label="Bought" htmlFor="gear-bought">
              <Input
                id="gear-bought"
                type="date"
                value={draft.purchaseDate}
                onChange={(event) => set("purchaseDate", event.target.value)}
              />
            </Field>
            <Field label="Already run (km)" htmlFor="gear-initial">
              <Input
                id="gear-initial"
                inputMode="decimal"
                value={draft.initialKm}
                onChange={(event) => set("initialKm", event.target.value)}
              />
            </Field>
            <Field label="Retire at (km)" htmlFor="gear-retirement">
              <Input
                id="gear-retirement"
                inputMode="decimal"
                value={draft.retirementKm}
                onChange={(event) => set("retirementKm", event.target.value)}
              />
            </Field>
            <Field label="Notes" htmlFor="gear-notes">
              <Input
                id="gear-notes"
                value={draft.notes}
                onChange={(event) => set("notes", event.target.value)}
              />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.retired} onCheckedChange={(next) => set("retired", next)} />
            Retired — keeps its history, leaves the selects
          </label>
        </form>

        {save.error && <p className="text-delta-bad text-sm">{save.error.message}</p>}
        {remove.error && <p className="text-delta-bad text-sm">{remove.error.message}</p>}

        {confirmingDelete ? (
          <DialogFooter>
            <p className="text-muted-foreground mr-auto text-sm">
              Delete it and its {item?.activityCount ?? 0} assignments? Retiring keeps them.
            </p>
            <Button variant="ghost" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() => remove.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
            >
              Delete
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter>
            {item && (
              <Button variant="ghost" className="mr-auto" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            )}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="gear-form" disabled={save.isPending || !named}>
              Save
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
