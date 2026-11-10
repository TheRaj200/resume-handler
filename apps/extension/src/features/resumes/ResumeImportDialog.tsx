import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  STORAGE_KEYS,
  aiSettingsSchema,
  type AISettings,
  type ParsedResume,
  type Resume,
  type ResumeExtraction,
} from "@jobpilot/shared";
import {
  db,
  defaultResumeImportSelection,
  getResumeFile,
  importParsedResume,
  updateResumeMetadata,
  type ResumeImportSelection,
} from "../../db";
import { hasProviderPermission } from "../../lib/ai-provider";
import { getUnlockedApiKey, restoreVaultSession } from "../../lib/crypto-vault";
import { Badge, Button, Field, inputClass } from "../../components/ui";
import { extractResumeText, inferResumeExtension, looksLikeScannedPdf, truncateForParsing } from "./extract";
import { parseResumeLocally } from "./parser";
import { parseResumeWithAi } from "./ai-parse";

const DEFAULT_SETTINGS: AISettings = {
  provider: "gemini",
  model: "gemini-2.5-flash",
  baseUrl: "",
  temperature: 0.4,
  maxOutputTokens: 4096,
};

const PREVIEW_CHARS = 6000;

function key(...parts: Array<string | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function SectionCard({
  title,
  hint,
  checked,
  onToggle,
  children,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onToggle: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-xl border border-white/10 bg-white/[0.04] p-3">
      <div className="flex items-start justify-between gap-2">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5 accent-brand-500"
            checked={checked}
            onChange={(event) => onToggle(event.target.checked)}
          />
          <span>
            <span className="block text-xs font-semibold text-slate-200">{title}</span>
            <span className="block text-[11px] text-slate-400">{hint}</span>
          </span>
        </label>
      </div>
      <div className={checked ? "space-y-2" : "space-y-2 opacity-40"}>{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-white/10 px-2.5 py-2 text-[11px] text-slate-400">
      {children}
    </p>
  );
}

export function ResumeImportDialog({
  resume,
  onClose,
  onImported,
}: {
  resume: Resume;
  onClose: () => void;
  onImported: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"extracting" | "ready" | "error">("extracting");
  const [extraction, setExtraction] = useState<ResumeExtraction | null>(null);
  const [parsed, setParsed] = useState<ParsedResume | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [selection, setSelection] = useState<ResumeImportSelection>(
    defaultResumeImportSelection,
  );
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showText, setShowText] = useState(false);
  const [newSkill, setNewSkill] = useState("");

  const existing = useLiveQuery(async () => {
    const [experiences, educations, skills, projects] = await Promise.all([
      db.experiences.toArray(),
      db.educations.toArray(),
      db.skills.toArray(),
      db.projects.toArray(),
    ]);
    return { experiences, educations, skills, projects };
  }, []);

  const duplicateKeys = useMemo(
    () => ({
      experience: new Set(
        (existing?.experiences ?? []).map((item) => key(item.company, item.designation)),
      ),
      education: new Set(
        (existing?.educations ?? []).map((item) => key(item.institution, item.degree)),
      ),
      skills: new Set((existing?.skills ?? []).map((item) => key(item.name))),
      projects: new Set((existing?.projects ?? []).map((item) => key(item.name))),
    }),
    [existing],
  );

  async function runExtraction() {
    setPhase("extracting");
    setError(null);
    setNotice(null);

    try {
      const record = await getResumeFile(resume.fileId);
      if (!record?.blob) {
        throw new Error("File local storage me nahi mili. Dobara upload karo.");
      }

      const file = new File(
        [record.blob],
        record.fileName ??
          `${resume.title}.${inferResumeExtension(record.fileName, record.mimeType)}`,
        { type: record.mimeType },
      );

      const result = await extractResumeText(file);
      const local = parseResumeLocally(result.text);
      const nextWarnings = [...result.warnings, ...local.warnings];
      const status =
        !result.text.trim() || looksLikeScannedPdf(result.text, result.pageCount)
          ? "no-text"
          : "extracted";

      setExtraction(result);
      setParsed(local.parsed);
      setWarnings(nextWarnings);
      setPhase("ready");

      await updateResumeMetadata(resume.id, {
        textStatus: status,
        extractedChars: result.text.length,
      });
    } catch (cause) {
      setPhase("error");
      setError(cause instanceof Error ? cause.message : "Resume text extract nahi hua.");
    }
  }

  useEffect(() => {
    void runExtraction();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume.id]);

  function toggleSection(section: keyof ResumeImportSelection, value: boolean) {
    setSelection((previous) => ({ ...previous, [section]: value }));
  }

  function updateContact(field: keyof ParsedResume["contact"], value: string) {
    setParsed((previous) =>
      previous
        ? {
            ...previous,
            contact: { ...previous.contact, [field]: value },
          }
        : previous,
    );
  }

  function removeExperience(index: number) {
    setParsed((previous) =>
      previous
        ? { ...previous, experience: previous.experience.filter((_, i) => i !== index) }
        : previous,
    );
  }

  function removeEducation(index: number) {
    setParsed((previous) =>
      previous
        ? { ...previous, education: previous.education.filter((_, i) => i !== index) }
        : previous,
    );
  }

  function removeSkill(index: number) {
    setParsed((previous) =>
      previous
        ? { ...previous, skills: previous.skills.filter((_, i) => i !== index) }
        : previous,
    );
  }

  function removeProject(index: number) {
    setParsed((previous) =>
      previous
        ? { ...previous, projects: previous.projects.filter((_, i) => i !== index) }
        : previous,
    );
  }

  function addSkill() {
    const name = newSkill.trim();
    if (!name || !parsed) return;
    setParsed({
      ...parsed,
      skills: [...parsed.skills, { name }],
    });
    setNewSkill("");
  }

  async function handleAiParse() {
    if (!extraction) return;
    setAiBusy(true);
    setNotice(null);
    setError(null);

    try {
      await restoreVaultSession();
      const apiKey = getUnlockedApiKey();
      if (!apiKey) {
        throw new Error("AI vault locked hai. Settings → API Key Vault me unlock karo.");
      }

      const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
      const parsedSettings = aiSettingsSchema.safeParse(stored[STORAGE_KEYS.settings]);
      const settings = parsedSettings.success ? parsedSettings.data : DEFAULT_SETTINGS;

      if (!(await hasProviderPermission(settings))) {
        throw new Error("AI endpoint permission missing. Settings me endpoint access grant karo.");
      }

      const { text, truncated } = truncateForParsing(extraction.text);
      if (!text.trim()) throw new Error("Pehle text extract hone do.");

      const result = await parseResumeWithAi(text, settings, apiKey);
      setParsed(result.parsed);
      setWarnings(result.warnings);
      setNotice(
        truncated
          ? "AI parse applied (text 60k characters tak truncate hua). Review karke import karo."
          : "AI parse applied — review karke import karo.",
      );
    } catch (cause) {
      setNotice(
        `AI parse fail hua, local parse hi rakha. ${
          cause instanceof Error ? cause.message : ""
        }`.trim(),
      );
    } finally {
      setAiBusy(false);
    }
  }

  async function handleImport() {
    if (!parsed) return;
    setSaving(true);
    setError(null);

    try {
      if (mode === "replace") {
        const confirmed = window.confirm(
          "Replace mode selected sections ke existing profile data ko delete karega. Continue?",
        );
        if (!confirmed) {
          setSaving(false);
          return;
        }
      }

      const result = await importParsedResume(parsed, { mode, include: selection });

      await updateResumeMetadata(resume.id, {
        parsedAt: new Date().toISOString(),
        textStatus:
          extraction && extraction.text.trim() ? "extracted" : "no-text",
        extractedChars: extraction?.text.length ?? 0,
      });

      const parts = [
        `${result.experience.added} experience`,
        `${result.education.added} education`,
        `${result.skills.added} skills`,
        `${result.projects.added} projects`,
      ];

      onImported(
        `Profile import ho gaya — ${parts.join(", ")} added${
          result.profileUpdated ? ", contact/summary updated" : ""
        }.`,
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Import failed.");
    } finally {
      setSaving(false);
    }
  }

  const hasText = Boolean(extraction?.text.trim());
  const totalSelected =
    (selection.contact ? 1 : 0) +
    (selection.summary ? 1 : 0) +
    (selection.experience ? (parsed?.experience.length ?? 0) : 0) +
    (selection.education ? (parsed?.education.length ?? 0) : 0) +
    (selection.skills ? (parsed?.skills.length ?? 0) : 0) +
    (selection.projects ? (parsed?.projects.length ?? 0) : 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-100">
              Import resume → profile
            </h3>
            <p className="mt-0.5 truncate text-[11px] text-slate-400">
              {resume.title} · parsed text review karo, phir approve karo
            </p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          {phase === "extracting" ? (
            <div className="space-y-2 py-8 text-center">
              <p className="text-sm text-slate-400">Resume text nikal raha hoon…</p>
              <p className="text-[11px] text-slate-400">
                PDF.js / mammoth local browser me hi chalte hain — file upload nahi hoti.
              </p>
            </div>
          ) : null}

          {phase === "error" ? (
            <div className="space-y-3 py-6 text-center">
              <p className="text-sm text-rose-600">{error}</p>
              <div className="flex justify-center gap-2">
                <Button variant="secondary" onClick={() => void runExtraction()}>
                  Retry
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
          ) : null}

          {phase === "ready" && parsed ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
                <div className="text-[11px] text-slate-400">
                  {extraction
                    ? `${extraction.text.length.toLocaleString()} characters${
                        extraction.pageCount ? ` · ${extraction.pageCount} page(s)` : ""
                      }`
                    : "No text"}
                  {extraction?.kind ? ` · ${extraction.kind.toUpperCase()}` : ""}
                </div>
                <div className="flex gap-1">
                  <Button
                    variant="secondary"
                    disabled={!hasText || aiBusy}
                    onClick={() => void handleAiParse()}
                  >
                    {aiBusy ? "AI parsing…" : "AI se parse karo"}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!hasText}
                    onClick={() => setShowText((value) => !value)}
                  >
                    {showText ? "Hide text" : "Show text"}
                  </Button>
                </div>
              </div>

              {!hasText ? (
                <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700">
                  Is file se text nahi mila. Scanned/image-based PDF ho sakta hai — text-based
                  PDF ya DOCX upload karo, ya profile manually bharo.
                </p>
              ) : null}

              {warnings.length > 0 ? (
                <ul className="space-y-1 rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700">
                  {warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>• {warning}</li>
                  ))}
                </ul>
              ) : null}

              {notice ? (
                <p className="rounded-xl border border-brand-400/20 bg-brand-500/10 px-3 py-2 text-[11px] text-brand-200">
                  {notice}
                </p>
              ) : null}

              {error ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">
                  {error}
                </p>
              ) : null}

              {showText ? (
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-slate-950/70 p-3 text-[10px] leading-relaxed text-slate-300">
                  {extraction?.text.slice(0, PREVIEW_CHARS)}
                  {(extraction?.text.length ?? 0) > PREVIEW_CHARS
                    ? "\n\n… preview truncated"
                    : ""}
                </pre>
              ) : null}

              <SectionCard
                title="Contact & links"
                hint={
                  existing
                    ? "Merge mode sirf empty fields bharta hai; replace mode overwrite karta hai."
                    : "Name, email, phone, location, links"
                }
                checked={selection.contact}
                onToggle={(value) => toggleSection("contact", value)}
              >
                <div className="grid grid-cols-2 gap-2">
                  <Field label="First name">
                    <input
                      className={inputClass}
                      value={parsed.contact.firstName ?? ""}
                      onChange={(event) => updateContact("firstName", event.target.value)}
                    />
                  </Field>
                  <Field label="Last name">
                    <input
                      className={inputClass}
                      value={parsed.contact.lastName ?? ""}
                      onChange={(event) => updateContact("lastName", event.target.value)}
                    />
                  </Field>
                  <Field label="Email">
                    <input
                      className={inputClass}
                      value={parsed.contact.email ?? ""}
                      onChange={(event) => updateContact("email", event.target.value)}
                    />
                  </Field>
                  <Field label="Phone">
                    <input
                      className={inputClass}
                      value={parsed.contact.phone ?? ""}
                      onChange={(event) => updateContact("phone", event.target.value)}
                    />
                  </Field>
                  <Field label="Headline">
                    <input
                      className={inputClass}
                      value={parsed.contact.headline ?? ""}
                      onChange={(event) => updateContact("headline", event.target.value)}
                    />
                  </Field>
                  <Field label="Location">
                    <input
                      className={inputClass}
                      value={parsed.contact.location ?? ""}
                      onChange={(event) => updateContact("location", event.target.value)}
                    />
                  </Field>
                  <Field label="LinkedIn">
                    <input
                      className={inputClass}
                      value={parsed.contact.linkedin ?? ""}
                      onChange={(event) => updateContact("linkedin", event.target.value)}
                    />
                  </Field>
                  <Field label="GitHub">
                    <input
                      className={inputClass}
                      value={parsed.contact.github ?? ""}
                      onChange={(event) => updateContact("github", event.target.value)}
                    />
                  </Field>
                  <Field label="Portfolio">
                    <input
                      className={inputClass}
                      value={parsed.contact.portfolio ?? ""}
                      onChange={(event) => updateContact("portfolio", event.target.value)}
                    />
                  </Field>
                </div>
              </SectionCard>

              <SectionCard
                title="Summary"
                hint="Resume ka summary/objective text"
                checked={selection.summary}
                onToggle={(value) => toggleSection("summary", value)}
              >
                {parsed.summary ? (
                  <textarea
                    className={inputClass}
                    rows={3}
                    value={parsed.summary}
                    onChange={(event) =>
                      setParsed({ ...parsed, summary: event.target.value })
                    }
                  />
                ) : (
                  <EmptyLine>Summary nahi mila.</EmptyLine>
                )}
              </SectionCard>

              <SectionCard
                title={`Experience (${parsed.experience.length})`}
                hint={
                  existing
                    ? `Existing: ${existing.experiences.length} · duplicates skip honge`
                    : "Company, role, dates, bullets"
                }
                checked={selection.experience}
                onToggle={(value) => toggleSection("experience", value)}
              >
                {parsed.experience.length === 0 ? (
                  <EmptyLine>Experience entries nahi mile.</EmptyLine>
                ) : (
                  parsed.experience.map((item, index) => {
                    const duplicate = duplicateKeys.experience.has(
                      key(item.company, item.designation),
                    );
                    return (
                      <div
                        key={`${item.company}-${item.designation}-${index}`}
                        className="space-y-1 rounded-lg border border-white/10 bg-white/[0.06] p-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-slate-200">
                              {item.designation || "Unknown role"}
                            </p>
                            <p className="truncate text-[11px] text-slate-400">
                              {item.company || "Unknown company"}
                              {item.startDate || item.endDate
                                ? ` · ${item.startDate ?? "?"} – ${item.endDate ?? "?"}`
                                : ""}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            {duplicate ? <Badge tone="amber">Duplicate</Badge> : null}
                            <Button variant="ghost" onClick={() => removeExperience(index)}>
                              ✕
                            </Button>
                          </div>
                        </div>
                        {item.description.length > 0 ? (
                          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-400">
                            {item.description.slice(0, 4).map((bullet, bulletIndex) => (
                              <li key={`${bullet}-${bulletIndex}`} className="line-clamp-2">
                                {bullet}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </SectionCard>

              <SectionCard
                title={`Education (${parsed.education.length})`}
                hint={
                  existing
                    ? `Existing: ${existing.educations.length} · duplicates skip honge`
                    : "Institution, degree, year"
                }
                checked={selection.education}
                onToggle={(value) => toggleSection("education", value)}
              >
                {parsed.education.length === 0 ? (
                  <EmptyLine>Education entries nahi mile.</EmptyLine>
                ) : (
                  parsed.education.map((item, index) => {
                    const duplicate = duplicateKeys.education.has(
                      key(item.institution, item.degree),
                    );
                    return (
                      <div
                        key={`${item.institution}-${item.degree}-${index}`}
                        className="flex items-start justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.06] p-2.5"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-200">
                            {item.degree || "Unknown degree"}
                          </p>
                          <p className="truncate text-[11px] text-slate-400">
                            {item.institution || "Unknown institution"}
                            {item.graduationYear ? ` · ${item.graduationYear}` : ""}
                            {item.grade ? ` · ${item.grade}` : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {duplicate ? <Badge tone="amber">Duplicate</Badge> : null}
                          <Button variant="ghost" onClick={() => removeEducation(index)}>
                            ✕
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </SectionCard>

              <SectionCard
                title={`Skills (${parsed.skills.length})`}
                hint={
                  existing
                    ? `Existing: ${existing.skills.length} · duplicates skip honge`
                    : "Comma-separated skills from the resume"
                }
                checked={selection.skills}
                onToggle={(value) => toggleSection("skills", value)}
              >
                {parsed.skills.length === 0 ? (
                  <EmptyLine>Skills nahi mile.</EmptyLine>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {parsed.skills.map((item, index) => {
                      const duplicate = duplicateKeys.skills.has(key(item.name));
                      return (
                        <span
                          key={`${item.name}-${index}`}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                            duplicate
                              ? "border-amber-400/20 bg-amber-500/10 text-amber-700"
                              : "border-white/10 bg-white/[0.08] text-slate-400"
                          }`}
                        >
                          {item.name}
                          <button
                            type="button"
                            className="text-slate-400 hover:text-rose-600"
                            onClick={() => removeSkill(index)}
                            aria-label={`Remove ${item.name}`}
                          >
                            ✕
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    className={inputClass}
                    placeholder="Add a skill manually"
                    value={newSkill}
                    onChange={(event) => setNewSkill(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addSkill();
                      }
                    }}
                  />
                  <Button variant="secondary" onClick={addSkill} disabled={!newSkill.trim()}>
                    Add
                  </Button>
                </div>
              </SectionCard>

              <SectionCard
                title={`Projects (${parsed.projects.length})`}
                hint={
                  existing
                    ? `Existing: ${existing.projects.length} · duplicates skip honge`
                    : "Project name, description, tech"
                }
                checked={selection.projects}
                onToggle={(value) => toggleSection("projects", value)}
              >
                {parsed.projects.length === 0 ? (
                  <EmptyLine>Projects nahi mile.</EmptyLine>
                ) : (
                  parsed.projects.map((item, index) => {
                    const duplicate = duplicateKeys.projects.has(key(item.name));
                    return (
                      <div
                        key={`${item.name}-${index}`}
                        className="space-y-1 rounded-lg border border-white/10 bg-white/[0.06] p-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-slate-200">
                              {item.name}
                            </p>
                            {item.technologies.length > 0 ? (
                              <p className="truncate text-[11px] text-slate-400">
                                {item.technologies.join(", ")}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-1">
                            {duplicate ? <Badge tone="amber">Duplicate</Badge> : null}
                            <Button variant="ghost" onClick={() => removeProject(index)}>
                              ✕
                            </Button>
                          </div>
                        </div>
                        {item.description ? (
                          <p className="line-clamp-2 text-[11px] text-slate-400">
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </SectionCard>

              <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-rose-500"
                  checked={mode === "replace"}
                  onChange={(event) =>
                    setMode(event.target.checked ? "replace" : "merge")
                  }
                />
                <span>
                  <span className="block text-[11px] font-medium text-slate-400">
                    Replace existing data (destructive)
                  </span>
                  <span className="block text-[11px] text-slate-400">
                    Unchecked = merge: sirf naye items add honge aur empty profile fields bharenge.
                  </span>
                </span>
              </label>
            </>
          ) : null}
        </div>

        {phase === "ready" && parsed ? (
          <div className="flex items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
            <p className="text-[11px] text-slate-400">
              {totalSelected} item(s) selected · approve ke baad hi profile update hoga
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleImport()}
                disabled={saving || !hasText || totalSelected === 0}
              >
                {saving ? "Importing…" : "Approve & import"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
