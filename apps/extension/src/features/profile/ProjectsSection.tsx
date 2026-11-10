import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { projectInputSchema, type ProjectInput } from "@jobpilot/shared";
import { db, deleteProject, saveProject } from "../../db";
import { splitComma } from "../../lib/profile";
import { Button, Card, Field, inputClass } from "../../components/ui";

const emptyProject: ProjectInput = {
  name: "",
  description: "",
  technologies: [],
  url: "",
};

export function ProjectsSection() {
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const [form, setForm] = useState<ProjectInput>(emptyProject);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setForm(emptyProject);
    setEditingId(null);
    setShowForm(false);
    setError(null);
  }

  function startEdit(project: NonNullable<typeof projects>[number]) {
    setForm({
      name: project.name,
      description: project.description,
      technologies: project.technologies,
      url: project.url ?? "",
    });
    setEditingId(project.id);
    setShowForm(true);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = projectInputSchema.safeParse({
      ...form,
      url: form.url || undefined,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid project");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await saveProject(parsed.data, editingId ?? undefined);
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save project");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this project?")) return;
    await deleteProject(id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Projects
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {(projects ?? []).length} {(projects ?? []).length === 1 ? "project" : "projects"}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
        >
          {showForm ? "Cancel" : "Add project"}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field label="Project name">
              <input
                className={inputClass}
                value={form.name}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, name: event.target.value }))
                }
                placeholder="JobPilot AI"
              />
            </Field>

            <Field label="Description">
              <textarea
                className={`${inputClass} min-h-24 resize-y`}
                value={form.description}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    description: event.target.value,
                  }))
                }
                placeholder="What it does, your role, impact..."
              />
            </Field>

            <Field label="Technologies" hint="Comma separated">
              <input
                className={inputClass}
                value={form.technologies.join(", ")}
                onChange={(event) =>
                  setForm((previous) => ({
                    ...previous,
                    technologies: splitComma(event.target.value),
                  }))
                }
                placeholder="React, TypeScript, MongoDB"
              />
            </Field>

            <Field label="URL">
              <input
                className={inputClass}
                value={form.url ?? ""}
                onChange={(event) =>
                  setForm((previous) => ({ ...previous, url: event.target.value }))
                }
                placeholder="https://github.com/..."
              />
            </Field>

            {error ? (
              <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving..." : editingId ? "Update project" : "Save project"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      {(projects ?? []).length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-6 text-center text-xs text-slate-500">
          No projects yet. Add 1–2 strong projects to stand out.
        </p>
      ) : (
        <ul className="space-y-2">
          {(projects ?? []).map((project) => (
            <li key={project.id}>
              <Card className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-100">
                      {project.name}
                    </p>
                    {project.url ? (
                      <p className="truncate text-[10px] text-indigo-300">{project.url}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" onClick={() => startEdit(project)}>
                      Edit
                    </Button>
                    <Button variant="ghost" onClick={() => void handleDelete(project.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-400">
                  {project.description}
                </p>
                {project.technologies.length > 0 ? (
                  <p className="text-[10px] text-slate-500">
                    {project.technologies.join(" · ")}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
