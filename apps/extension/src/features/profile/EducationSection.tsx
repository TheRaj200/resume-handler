import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  educationInputSchema,
  type EducationInput,
} from "@jobpilot/shared";
import { db, deleteEducation, saveEducation } from "../../db";
import { Button, Card, Field, inputClass, useConfirm } from "../../components/ui";

const emptyEducation: EducationInput = {
  institution: "",
  degree: "",
  field: "",
  graduationYear: undefined,
  grade: "",
};

export function EducationSection() {
  const confirm = useConfirm();
  const educations = useLiveQuery(() => db.educations.toArray(), []);
  const [form, setForm] = useState<EducationInput>(emptyEducation);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = [...(educations ?? [])].sort(
    (a, b) => (b.graduationYear ?? 0) - (a.graduationYear ?? 0),
  );

  function resetForm() {
    setForm(emptyEducation);
    setEditingId(null);
    setShowForm(false);
    setError(null);
  }

  function startEdit(education: (typeof sorted)[number]) {
    setForm({
      institution: education.institution,
      degree: education.degree,
      field: education.field ?? "",
      graduationYear: education.graduationYear,
      grade: education.grade ?? "",
    });
    setEditingId(education.id);
    setShowForm(true);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = educationInputSchema.safeParse({
      ...form,
      field: form.field || undefined,
      graduationYear: form.graduationYear ?? undefined,
      grade: form.grade || undefined,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid education");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await saveEducation(parsed.data, editingId ?? undefined);
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save education");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!(await confirm("Delete education entry?", "This education entry will be removed from your profile."))) return;
    await deleteEducation(id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Education
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {sorted.length} {sorted.length === 1 ? "entry" : "entries"}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
        >
          {showForm ? "Cancel" : "Add education"}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="Institution">
              <input
                className={inputClass}
                value={form.institution}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    institution: event.target.value,
                  }))
                }
                placeholder="University / College"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Degree">
                <input
                  className={inputClass}
                  value={form.degree}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      degree: event.target.value,
                    }))
                  }
                  placeholder="B.Tech"
                />
              </Field>
              <Field label="Field">
                <input
                  className={inputClass}
                  value={form.field ?? ""}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      field: event.target.value,
                    }))
                  }
                  placeholder="Computer Science"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Graduation year">
                <input
                  className={inputClass}
                  type="number"
                  min={1950}
                  max={2100}
                  value={form.graduationYear ?? ""}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      graduationYear:
                        event.target.value === ""
                          ? undefined
                          : Number(event.target.value),
                    }))
                  }
                  placeholder="2024"
                />
              </Field>
              <Field label="Grade / CGPA">
                <input
                  className={inputClass}
                  value={form.grade ?? ""}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      grade: event.target.value,
                    }))
                  }
                  placeholder="8.2 CGPA"
                />
              </Field>
            </div>

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
                {busy ? "Saving..." : editingId ? "Update education" : "Save education"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.04] px-3 py-6 text-center text-xs text-slate-400">
          No education yet. Add your degree to complete the profile.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((education) => (
            <li key={education.id}>
              <Card className="flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-100">
                    {education.degree}
                    {education.field ? ` · ${education.field}` : ""}
                  </p>
                  <p className="truncate text-xs text-slate-400">
                    {education.institution}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-400">
                    {education.graduationYear ?? "—"}
                    {education.grade ? ` · ${education.grade}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" onClick={() => startEdit(education)}>
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={() => void handleDelete(education.id)}>
                    Delete
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
