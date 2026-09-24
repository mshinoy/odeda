import type { EditableField } from "@/api/adapters";
import { NativeSelect } from "@/components/NativeSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { optionLabel, type FormValue } from "@/features/activity/edit/editForm";

interface FieldControlProps {
  field: EditableField;
  value: FormValue;
  /** For selects: the options to offer, the activity's own value included. */
  options: readonly string[];
  error: string | null;
  onChange: (value: FormValue) => void;
}

/** One field of the Edit dialog, with the input its registry entry asks for. */
export function FieldControl({ field, value, options, error, onChange }: FieldControlProps) {
  const id = `edit-${field.name}`;

  if (field.editor === "bool") {
    return (
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={id} className="font-normal">
          {field.label}
        </Label>
        <Switch id={id} checked={value === true} onCheckedChange={onChange} />
      </div>
    );
  }

  const text = typeof value === "string" ? value : "";
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="font-normal">
        {field.label}
      </Label>
      {field.editor === "textarea" && (
        <Textarea id={id} rows={3} value={text} onChange={(e) => onChange(e.target.value)} />
      )}
      {field.editor === "select" && (
        <NativeSelect id={id} value={text} onChange={(e) => onChange(e.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {optionLabel(field, option)}
            </option>
          ))}
        </NativeSelect>
      )}
      {field.editor === "number" && (
        <Input
          id={id}
          type="number"
          inputMode={field.type === "int" ? "numeric" : "decimal"}
          step={field.type === "int" ? 1 : "any"}
          min={field.min ?? undefined}
          max={field.max ?? undefined}
          value={text}
          aria-invalid={error !== null}
          onChange={(e) => onChange(e.target.value)}
          className="w-24"
        />
      )}
      {field.editor === "text" && (
        <Input id={id} value={text} onChange={(e) => onChange(e.target.value)} />
      )}
      {error && <p className="text-delta-bad text-xs">{error}</p>}
    </div>
  );
}
