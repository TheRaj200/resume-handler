import { useState, type ChangeEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { MAX_RESUME_BYTES, type Resume } from "@jobpilot/shared";
import {
  addResume,
  db,
  deleteResume,
  getResumeBlob,
  setDefaultResume,
} from "../../db";
import { Badge, Button, Card, EmptyState, type BadgeTone } from "../../components/ui";
import { ResumeImportDialog } from "./ResumeImportDialog";

function textStatusBadge(resume: Resume): { label: string; tone: BadgeTone } | null {
  if (resume.textStatus === "extracted") {
    return { label: "Text extracted", tone: "emerald" };
  }
  if (resume.textStatus === "no-text") {
    return { label: "No text (scanned?)", tone: "amber" };
  }
  if (resume.textStatus === "failed") {
    return { label: "Parse failed", tone: "rose" };
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

const uploadLabelClass =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-500 px-3.5 py-2 text-sm font-medium text-white shadow-lg shadow-brand-500/20 transition hover:bg-brand-400";

export function ResumeLibrary() {
  const resumes = useLiveQuery(() => db.resumes.toArray(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState<Resume | null>(null);

  const sorted = [...(resumes ?? [])].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const resume = await addResume(file);
      setImporting(resume);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not upload resume");
    } finally {
      setBusy(false);
    }
  }

  async function handleOpen(fileId: string) {
    const blob = await getResumeBlob(fileId);
    if (!blob) {
      setError("File not found in local storage.");
      return;
    }

    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this resume from local storage?")) return;
    await deleteResume(id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Resume library
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-400">
            PDF / DOC / DOCX · max {formatBytes(MAX_RESUME_BYTES)} · stored locally
          </p>
        </div>
        <label className={uploadLabelClass}>
          {busy ? "Uploading..." : "Upload"}
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            className="hidden"
            onChange={handleUpload}
            disabled={busy}
          />
        </label>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {notice}
        </p>
      ) : null}

      {sorted.length === 0 ? (
        <EmptyState
          title="No resumes yet"
          description="Upload your base resume. Text local browser me extract hoga, phir review karke profile me import kar sakte ho."
          action={
            <label className={uploadLabelClass}>
              {busy ? "Uploading..." : "Upload resume"}
              <input
                type="file"
                accept=".pdf,.doc,.docx"
                className="hidden"
                onChange={handleUpload}
                disabled={busy}
              />
            </label>
          }
        />
      ) : (
        <ul className="space-y-2">
          {sorted.map((resume) => {
            const status = textStatusBadge(resume);
            return (
              <li key={resume.id}>
                <Card className="space-y-2 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-100">
                        {resume.title}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-400">
                        Added {formatDate(resume.createdAt)}
                        {resume.parsedAt ? ` · Imported ${formatDate(resume.parsedAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {resume.isDefault ? <Badge tone="indigo">Default</Badge> : null}
                      {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    <Button variant="secondary" onClick={() => setImporting(resume)}>
                      Import to profile
                    </Button>
                    <Button variant="ghost" onClick={() => void handleOpen(resume.fileId)}>
                      Open
                    </Button>
                    {!resume.isDefault ? (
                      <Button
                        variant="ghost"
                        onClick={() => void setDefaultResume(resume.id)}
                      >
                        Set default
                      </Button>
                    ) : null}
                    <Button variant="ghost" onClick={() => void handleDelete(resume.id)}>
                      Delete
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <p className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] leading-relaxed text-slate-400">
        Text extraction PDF.js / mammoth se browser me hoti hai — file kisi server par nahi
        jaati. Import approve karne se pehle har section review hota hai.
      </p>

      {importing ? (
        <ResumeImportDialog
          resume={importing}
          onClose={() => setImporting(null)}
          onImported={(message) => {
            setNotice(message);
            setError(null);
          }}
        />
      ) : null}
    </div>
  );
}
