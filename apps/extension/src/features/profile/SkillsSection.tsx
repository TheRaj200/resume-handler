import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { skillInputSchema, type SkillInput } from "@jobpilot/shared";
import { db, deleteSkill, saveSkill } from "../../db";
import { Badge, Button, Card, Field, inputClass } from "../../components/ui";

const emptySkill: SkillInput = {
  name: "",
  category: "",
  proficiency: undefined,
};

const CATEGORIES = ["language", "framework", "database", "tool", "soft"] as const;

export function SkillsSection() {
  const skills = useLiveQuery(() => db.skills.toArray(), []);
  const [form, setForm] = useState<SkillInput>(emptySkill);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sorted = [...(skills ?? [])].sort((a, b) =>
    `${a.category ?? ""}:${a.name}`.localeCompare(`${b.category ?? ""}:${b.name}`),
  );

  function resetForm() {
    setForm(emptySkill);
    setEditingId(null);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = skillInputSchema.safeParse({
      ...form,
      category: form.category || undefined,
      proficiency: form.proficiency || undefined,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid skill");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await saveSkill(parsed.data, editingId ?? undefined);
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save skill");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this skill?")) return;
    await deleteSkill(id);
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Skills
        </h3>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {sorted.length} {sorted.length === 1 ? "skill" : "skills"}
        </p>
      </div>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Skill">
              <input
                className={inputClass}
                value={form.name}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, name: event.target.value }))
                }
                placeholder="React"
              />
            </Field>
            <Field label="Category">
              <select
                className={inputClass}
                value={form.category ?? ""}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    category: event.target.value,
                  }))
                }
              >
                <option value="">Uncategorized</option>
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Proficiency">
            <select
              className={inputClass}
              value={form.proficiency ?? ""}
              onChange={(event) =>
                setForm((previous) => ({
                  ...previous,
                  proficiency: (event.target.value || undefined) as
                    | SkillInput["proficiency"]
                    | undefined,
                }))
              }
            >
              <option value="">Not set</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
              <option value="expert">Expert</option>
            </select>
          </Field>

          {error ? (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            {editingId ? (
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" disabled={busy}>
              {busy ? "Saving..." : editingId ? "Update skill" : "Add skill"}
            </Button>
          </div>
        </form>
      </Card>

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
          No skills yet. Add languages, frameworks, databases and tools.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {sorted.map((skill) => (
            <div
              key={skill.id}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5"
            >
              <div>
                <p className="text-xs font-medium text-slate-700">{skill.name}</p>
                <p className="text-[10px] text-slate-500">
                  {skill.category ?? "uncategorized"}
                  {skill.proficiency ? ` · ${skill.proficiency}` : ""}
                </p>
              </div>
              <button
                className="text-[10px] text-indigo-600 hover:text-indigo-700"
                onClick={() => {
                  setForm({
                    name: skill.name,
                    category: skill.category ?? "",
                    proficiency: skill.proficiency,
                  });
                  setEditingId(skill.id);
                  setError(null);
                }}
              >
                Edit
              </button>
              <button
                className="text-[10px] text-rose-600 hover:text-rose-200"
                onClick={() => void handleDelete(skill.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {sorted.length > 0 ? (
        <Badge tone="slate">Tip: category helps the resume engine group skills.</Badge>
      ) : null}
    </div>
  );
}
