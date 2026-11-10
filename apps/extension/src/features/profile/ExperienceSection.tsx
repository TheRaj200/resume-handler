import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  experienceInputSchema,
  type ExperienceInput,
} from "@jobpilot/shared";
import { db, deleteExperience, saveExperience } from "../../db";
import { splitLines } from "../../lib/profile";
import { Button, Card, Field, inputClass } from "../../components/ui";

const emptyExperience: ExperienceInput = {
  company: "",
  designation: "",
  description: [],
  startDate: "",
  endDate: "",
  current: false,
};

export function ExperienceSection() {
  const experiences = useLiveQuery(() => db.experiences.toArray(), []);
  const [form, setForm] = useState<ExperienceInput>(emptyExperience);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = [...(experiences ?? [])].sort((a, b) =>
    (b.startDate ?? "").localeCompare(a.startDate ?? ""),
  );

  function resetForm() {
    setForm(emptyExperience);
    setEditingId(null);
    setShowForm(false);
    setError(null);
  }

  function startEdit(experience: (typeof sorted)[number]) {
    setForm({
      company: experience.company,
      designation: experience.designation,
      description: experience.description,
      startDate: experience.startDate ?? "",
      endDate: experience.endDate ?? "",
      current: experience.current ?? false,
    });
    setEditingId(experience.id);
    setShowForm(true);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = experienceInputSchema.safeParse({
      ...form,
      startDate: form.startDate || undefined,
      endDate: form.current ? undefined : form.endDate || undefined,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid experience");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await saveExperience(parsed.data, editingId ?? undefined);
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save experience");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this experience?")) return;
    await deleteExperience(id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Work experience
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
          {showForm ? "Cancel" : "Add experience"}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Company">
                <input
                  className={inputClass}
                  value={form.company}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, company: event.target.value }))
                  }
                  placeholder="Acme Corp"
                />
              </Field>
              <Field label="Designation">
                <input
                  className={inputClass}
                  value={form.designation}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      designation: event.target.value,
                    }))
                  }
                  placeholder="Software Engineer"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date">
                <input
                  className={inputClass}
                  type="month"
                  value={form.startDate ?? ""}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      startDate: event.target.value,
                    }))
                  }
                />
              </Field>
              <Field label="End date">
                <input
                  className={inputClass}
                  type="month"
                  value={form.endDate ?? ""}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      endDate: event.target.value,
                    }))
                  }
                  disabled={form.current}
                />
              </Field>
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={form.current ?? false}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    current: event.target.checked,
                  }))
                }
                className="h-4 w-4 rounded border-white/20 bg-slate-900 accent-indigo-500"
              />
              I currently work here
            </label>

            <Field label="Description" hint="One bullet per line">
              <textarea
                className={`${inputClass} min-h-28 resize-y`}
                value={form.description.join("\n")}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    description: splitLines(event.target.value),
                  }))
                }
                placeholder={"Built REST APIs...\nImproved performance by 30%..."}
              />
            </Field>

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
                {busy ? "Saving..." : editingId ? "Update experience" : "Save experience"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.04] px-3 py-6 text-center text-xs text-slate-400">
          No experience yet. Add your first role to power autofill and resumes.
        </p>
      ) : (
        <ul className="space-y-2">
          {sorted.map((experience) => (
            <li key={experience.id}>
              <Card className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {experience.designation}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {experience.company}
                    </p>
                    <p className="mt-1 text-[10px] text-slate-400">
                      {experience.startDate ?? "—"} –{" "}
                      {experience.current ? "Present" : experience.endDate ?? "—"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" onClick={() => startEdit(experience)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void handleDelete(experience.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
                {experience.description.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-4 text-[11px] text-slate-400">
                    {experience.description.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
