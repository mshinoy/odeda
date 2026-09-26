import type { GearCollection } from "@/api/adapters";
import { useActivityTypes } from "@/api/queries/useActivityTypes";
import { useClearGearDefault, useSetGearDefault } from "@/api/queries/useGear";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/NativeSelect";
import { sortGear } from "@/features/gear/gearView";

/**
 * The gear a newly-synced activity of a type gets, so history stays complete without
 * anyone remembering to tag it. One rule per type and kind: choosing new default
 * shoes for runs replaces the old default shoes and leaves the strap alone.
 */
export function DefaultsPanel({ collection }: { collection: GearCollection }) {
  const types = useActivityTypes();
  const setDefault = useSetGearDefault();
  const clearDefault = useClearGearDefault();

  const choices = sortGear(collection.gear);
  const pending = setDefault.isPending || clearDefault.isPending;
  const error = setDefault.error ?? clearDefault.error;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-muted-foreground text-xs">Default gear</h2>

      <div className="flex max-w-lg flex-col gap-2">
        {collection.defaults.map((rule) => (
          <div
            key={`${rule.activityType}-${rule.gearId}`}
            className="flex items-center gap-3 text-sm"
          >
            <span className="w-32 shrink-0">{rule.activityType}</span>
            <span className="grow">{rule.name}</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                clearDefault.mutate({ activityType: rule.activityType, gearId: rule.gearId })
              }
            >
              Clear
            </Button>
          </div>
        ))}
        {collection.defaults.length === 0 && (
          <p className="text-muted-foreground text-sm">No default gear yet.</p>
        )}
      </div>

      <AddDefault
        types={types.data ?? []}
        choices={choices}
        disabled={pending || choices.length === 0}
        onAdd={(activityType, gearId) => setDefault.mutate({ activityType, gearId })}
      />

      {error && <p className="text-delta-bad text-sm">{error.message}</p>}
    </section>
  );
}

interface AddDefaultProps {
  types: readonly string[];
  choices: readonly { id: number; name: string; kind: string }[];
  disabled: boolean;
  onAdd: (activityType: string, gearId: number) => void;
}

/**
 * Uncontrolled on purpose: the two selects are read on submit and nothing else
 * depends on them, so holding them in state would buy a re-render per keystroke.
 */
function AddDefault({ types, choices, disabled, onAdd }: AddDefaultProps) {
  return (
    <form
      className="flex max-w-lg flex-wrap items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const type = form.elements.namedItem("default-type");
        const gear = form.elements.namedItem("default-gear");
        if (!(type instanceof HTMLSelectElement) || !(gear instanceof HTMLSelectElement)) return;
        if (type.value === "" || gear.value === "") return;
        onAdd(type.value, Number(gear.value));
      }}
    >
      <NativeSelect name="default-type" aria-label="Activity type" defaultValue="">
        <option value="" disabled>
          Activity type
        </option>
        {types.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect name="default-gear" aria-label="Gear" defaultValue="">
        <option value="" disabled>
          Gear
        </option>
        {choices.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </NativeSelect>
      <Button type="submit" variant="outline" size="sm" disabled={disabled}>
        Add
      </Button>
    </form>
  );
}
