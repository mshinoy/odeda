import type { GearItem, RouteOption } from "@/api/adapters";
import { NativeSelect } from "@/components/NativeSelect";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  gearKindLabel,
  gearKinds,
  gearOptionLabel,
  gearOptions,
  routeOptionLabel,
  routeOptions,
  type AssignmentValues,
} from "@/features/activity/edit/assignments";
import type { ActivityKind } from "@/lib/activityKind";

interface AssignmentFieldsProps {
  activityKind: ActivityKind;
  activityType: string;
  /** Every gear item the owner has; undefined while it loads. */
  gear: readonly GearItem[] | undefined;
  /** Every route; undefined while it loads. */
  routes: readonly RouteOption[] | undefined;
  /** The gear on this activity: it sets the selects' starting values. */
  assigned: readonly GearItem[];
  /** The route the activity is on, or null. */
  routeId: number | null;
  /** False for an activity that cannot be on a route (no track and none assigned). */
  showRoute: boolean;
  values: AssignmentValues;
  onChange: (values: AssignmentValues) => void;
}

const NONE = "";

/** The gear and route selects. They save with the dialog, not on change. */
export function AssignmentFields({
  activityKind,
  activityType,
  gear,
  routes,
  assigned,
  routeId,
  showRoute,
  values,
  onChange,
}: AssignmentFieldsProps) {
  if (gear === undefined || (showRoute && routes === undefined)) {
    return <Skeleton className="h-12 w-full" />;
  }

  const kinds = gearKinds(activityKind, gear, assigned);
  const forRoute = showRoute ? routeOptions(routes ?? [], activityType, routeId) : [];

  function setGear(kind: string, value: string) {
    onChange({ ...values, gear: { ...values.gear, [kind]: value } });
  }

  return (
    <>
      {kinds.map((kind) => (
        <Select
          key={kind}
          id={`edit-gear-${kind}`}
          label={gearKindLabel(kind)}
          value={values.gear[kind] ?? NONE}
          onChange={(value) => setGear(kind, value)}
          options={gearOptions(gear, kind, idOf(values.gear[kind])).map((item) => ({
            value: String(item.id),
            label: gearOptionLabel(item),
          }))}
        />
      ))}
      {forRoute.length > 0 && (
        <Select
          id="edit-route"
          label="Route"
          value={values.route}
          onChange={(route) => onChange({ ...values, route })}
          // An activity can be moved between routes but not taken off one, so "None"
          // is offered only while it is on none.
          allowNone={routeId === null}
          options={forRoute.map((route) => ({
            value: String(route.id),
            label: routeOptionLabel(route),
          }))}
        />
      )}
    </>
  );
}

function idOf(value: string | undefined): number | null {
  return value === undefined || value === NONE ? null : Number(value);
}

interface SelectProps {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  /** Whether the select offers "None". Gear always does; a route only when unset. */
  allowNone?: boolean;
}

/** One labelled select. */
function Select({ id, label, value, options, onChange, allowNone = true }: SelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowNone && <option value={NONE}>None</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}
