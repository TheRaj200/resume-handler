import { useEffect, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  FIELD_TYPES,
  customFieldInputSchema,
  type CustomField,
  type CustomFieldValueData,
  type FieldType,
} from "@jobpilot/shared";
import {
  db,
  deleteCustomField,
  saveCustomField,
  saveCustomFieldValue,
} from "../../db";
import { splitComma } from "../../lib/profile";
import { Badge, Button, Card, Field, inputClass } from "../../components/ui";

const emptyFieldForm = {
  label: "",
  fieldType: "text" as FieldType,
  options: "",
  isSensitive: false,
};

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const prefixed = /^[a-zA-Z]/.test(slug) ? slug : `f_${slug}`;
  return prefixed.slice(0, 80) || "custom_field";
}

function toDisplay(field: CustomField, value: CustomFieldValueData | undefined): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function CustomFieldControl({
  field,
  value,
  onSave,
}: {
  field: CustomField;
  value: CustomFieldValueData | undefined;
  onSave: (value: CustomFieldValueData) => void;
}) {
  const [local, setLocal] = useState(() => toDisplay(field, value));

  useEffect(() => {
    setLocal(toDisplay(field, value));
  }, [field, value]);

  if (field.fieldType === "boolean") {
    return (
      <label className="flex items-center gap-2 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => onSave(event.target.checked)}
          className="h-4 w-4 rounded border-white/20 bg-slate-900 accent-brand-500"
        />
        Yes
      </label>
    );
  }

  if (field.fieldType === "select") {
    return (
      <select
        className={inputClass}
        value={typeof value === "string" ? value : ""}
        onChange={(event) => onSave(event.target.value)}
      >
        <option value="">Select...</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  if (field.fieldType === "multiselect") {
    return (
      <input
        className={inputClass}
        value={local}
        onChange={(event) => setLocal(event.target.value)}
        onBlur={() => onSave(splitComma(local))}
        placeholder="Comma separated values"
      />
    );
  }

  if (field.fieldType === "textarea") {
    return (
      <textarea
        className={`${inputClass} min-h-20 resize-y`}
        value={local}
        onChange={(event) => setLocal(event.target.value)}
        onBlur={() => onSave(local)}
      />
    );
  }

  const inputType =
    field.fieldType === "number"
      ? "number"
      : field.fieldType === "date"
        ? "date"
        : field.fieldType === "email"
          ? "email"
          : field.fieldType === "url"
            ? "url"
            : field.fieldType === "phone"
              ? "tel"
              : "text";

  return (
    <input
      className={inputClass}
      type={inputType}
      value={local}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={() =>
        onSave(
          field.fieldType === "number"
            ? local.trim() === ""
              ? null
              : Number(local)
            : local,
        )
      }
    />
  );
}

export function CustomFieldsSection() {
  const fields = useLiveQuery(() => db.customFields.toArray(), []);
  const values = useLiveQuery(() => db.customFieldValues.toArray(), []);
  const [form, setForm] = useState(emptyFieldForm);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const valueMap = new Map(
    (values ?? []).map((entry) => [entry.fieldId, entry.value] as const),
  );

  function resetForm() {
    setForm(emptyFieldForm);
    setShowForm(false);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const needsOptions =
      form.fieldType === "select" || form.fieldType === "multiselect";

    const parsed = customFieldInputSchema.safeParse({
      label: form.label,
      fieldKey: slugify(form.label),
      fieldType: form.fieldType,
      options: needsOptions ? splitComma(form.options) : undefined,
      isSensitive: form.isSensitive,
      required: false,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid custom field");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await saveCustomField(parsed.data);
      resetForm();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save field. The generated key may already exist.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteField(id: string) {
    if (!window.confirm("Delete this field and its saved value?")) return;
    await deleteCustomField(id);
  }

  async function handleSaveValue(fieldId: string, value: CustomFieldValueData) {
    try {
      await saveCustomFieldValue(fieldId, value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save value");
    }
  }

  const sorted = [...(fields ?? [])].sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Custom fields
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Portal-specific questions (notice period, visa, portfolio, etc.)
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
        >
          {showForm ? "Cancel" : "Add field"}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="Label">
              <input
                className={inputClass}
                value={form.label}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, label: event.target.value }))
                }
                placeholder="Visa status"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Type">
                <select
                  className={inputClass}
                  value={form.fieldType}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      fieldType: event.target.value as FieldType,
                    }))
                  }
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Sensitive" hint="Never autofill without confirmation">
                <select
                  className={inputClass}
                  value={form.isSensitive ? "yes" : "no"}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      isSensitive: event.target.value === "yes",
                    }))
                  }
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </Field>
            </div>

            {form.fieldType === "select" || form.fieldType === "multiselect" ? (
              <Field label="Options" hint="Comma separated">
                <input
                  className={inputClass}
                  value={form.options}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      options: event.target.value,
                    }))
                  }
                  placeholder="Yes, No, Maybe"
                />
              </Field>
            ) : null}

            {error ? (
              <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving..." : "Save field"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.04] px-3 py-6 text-center text-xs text-slate-400">
          No custom fields yet. Add questions that appear repeatedly on application forms.
        </p>
      ) : (
        <div className="space-y-2">
          {sorted.map((field) => (
            <Card key={field.id} className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-100">{field.label}</p>
                  <p className="mt-0.5 text-[10px] text-slate-400">
                    {field.fieldType}
                    {field.isSensitive ? " · sensitive" : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {field.isSensitive ? <Badge tone="amber">Sensitive</Badge> : null}
                  <Button
                    variant="ghost"
                    onClick={() => void handleDeleteField(field.id)}
                  >
                    Delete
                  </Button>
                </div>
              </div>

              <CustomFieldControl
                field={field}
                value={valueMap.get(field.id)}
                onSave={(value) => void handleSaveValue(field.id, value)}
              />
            </Card>
          ))}
        </div>
      )}

      {!showForm && error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}
