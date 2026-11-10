import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  STORAGE_KEYS,
  aiSettingsSchema,
  type AISettings,
  type ResumeVersion,
  type TailoredResume,
} from "@jobpilot/shared";
import {
  db,
  getProfile,
  getResumeFile,
  listResumeVersions,
  deleteResumeVersion,
  saveResumeVersion,
} from "../../db";
import {
  extractJd,
  getActiveTab,
  getPageContext,
  isInjectableUrl,
} from "../../lib/content-script";
import {
  callAiJson,
  hasProviderPermission,
} from "../../lib/ai-provider";
import { getUnlockedApiKey, restoreVaultSession } from "../../lib/crypto-vault";
import { Badge, Button, Card, EmptyState, Field, inputClass } from "../../components/ui";
import {
  analyzeJd,
  type JdAnalysis,
} from "./jd";
import {
  applyAiSuggestions,
  buildAiPrompt,
  buildLocalResume,
  validateFactLock,
  validateResumeShape,
  splitIntoResumeBullets,
  type AiResumeSuggestions,
  type ResumeSourceData,
} from "./generator";
import { generateResumePdf, resumeFileName } from "./pdf";
import { extractResumeText } from "../resumes/extract";
import { parseResumeLocally } from "../resumes/parser";
import { sourceFromParsedResume } from "./source-from-parsed";

const DEFAULT_SETTINGS: AISettings = {
  provider: "gemini",
  model: "gemini-2.5-flash",
  baseUrl: "",
  temperature: 0.4,
  maxOutputTokens: 4096,
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function compactContact(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return value;
  }
}

function ResumePreview({ resume }: { resume: TailoredResume }) {
  const contact = [
    { label: resume.contact.email, href: resume.contact.email ? `mailto:${resume.contact.email}` : undefined },
    { label: resume.contact.phone },
    { label: resume.contact.location },
    { label: resume.contact.linkedin, href: resume.contact.linkedin },
    { label: resume.contact.github, href: resume.contact.github },
    { label: resume.contact.portfolio, href: resume.contact.portfolio },
  ].filter((item): item is { label: string; href?: string } => Boolean(item.label));

  return (
    <div className="mx-auto min-h-[842px] w-full max-w-[620px] rounded-lg bg-white px-9 py-9 text-slate-900 shadow-xl">
      <h1 className="text-[18px] font-bold leading-tight">{resume.contact.name}</h1>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
        {resume.targetRole}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-1 text-[8px] leading-relaxed text-slate-600">
        {contact.map((item, index) => (
          <span key={`${item.label}-${index}`}>
            {index > 0 ? " | " : ""}
            {item.href ? <a className="text-indigo-700 underline" href={item.href}>{compactContact(item.label)}</a> : compactContact(item.label)}
          </span>
        ))}
      </p>

      {resume.summary ? (
        <section className="mt-3">
          <h2 className="border-b border-slate-300 pb-0.5 text-[9px] font-bold uppercase tracking-wide">
            Professional Summary
          </h2>
          <p className="mt-1 whitespace-pre-wrap text-[8px] leading-relaxed">{resume.summary}</p>
        </section>
      ) : null}

      {resume.experience.length > 0 ? (
        <section className="mt-3">
          <h2 className="border-b border-slate-300 pb-0.5 text-[9px] font-bold uppercase tracking-wide">
            Experience
          </h2>
          {resume.experience.map((experience, index) => (
            <div key={`${experience.company}-${index}`} className="mt-1.5">
              <p className="text-[8.5px] font-bold">
                {experience.company} - {experience.designation}
              </p>
              <p className="text-[7.5px] text-slate-500">
                {[experience.startDate, experience.endDate ?? "Present"].filter(Boolean).join(" - ")}
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {experience.bullets.map((bullet, bulletIndex) => (
                  <li key={bulletIndex} className="flex gap-1 text-[8px] leading-relaxed">
                    <span className="text-slate-500">-</span>
                    <span>{bullet.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {resume.skills.length > 0 ? (
        <section className="mt-3">
          <h2 className="border-b border-slate-300 pb-0.5 text-[9px] font-bold uppercase tracking-wide">
            Skills
          </h2>
          <p className="mt-1 text-[8px] leading-relaxed">
            {resume.skills.map((skill) => skill.name).join(", ")}
          </p>
        </section>
      ) : null}

      {resume.projects.length > 0 ? (
        <section className="mt-3">
          <h2 className="border-b border-slate-300 pb-0.5 text-[9px] font-bold uppercase tracking-wide">
            Projects
          </h2>
          {resume.projects.map((project, index) => (
            <div key={`${project.name}-${index}`} className="mt-1.5">
              <p className="text-[8.5px] font-bold">
                {project.name}{project.url ? <> {" · "}<a className="font-normal text-indigo-700 underline" href={project.url}>Project link</a></> : null}
              </p>
              <p className="text-[7.5px] text-slate-500">{project.technologies.join(", ")}</p>
              <ul className="mt-1 space-y-0.5 text-[8px] leading-relaxed">
                {splitIntoResumeBullets(project.description, 4).map((bullet, bulletIndex) => (
                  <li key={bulletIndex} className="flex gap-1">
                    <span className="text-slate-500">-</span>
                    <span>{bullet}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {resume.education.length > 0 ? (
        <section className="mt-3">
          <h2 className="border-b border-slate-300 pb-0.5 text-[9px] font-bold uppercase tracking-wide">
            Education
          </h2>
          {resume.education.map((education, index) => (
            <div key={`${education.institution}-${index}`} className="mt-1.5">
              <p className="text-[8.5px] font-bold">
                {education.institution} - {education.degree}
                {education.field ? `, ${education.field}` : ""}
              </p>
              <p className="text-[7.5px] text-slate-500">
                {[education.graduationYear?.toString(), education.grade].filter(Boolean).join(" | ")}
              </p>
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}

export function ResumeStudio() {
  const profile = useLiveQuery(() => getProfile(), []);
  const experiences = useLiveQuery(() => db.experiences.toArray(), []);
  const educations = useLiveQuery(() => db.educations.toArray(), []);
  const skills = useLiveQuery(() => db.skills.toArray(), []);
  const projects = useLiveQuery(() => db.projects.toArray(), []);
  const resumes = useLiveQuery(() => db.resumes.toArray(), []);
  const versions = useLiveQuery(() => listResumeVersions(20), []);

  const [jdText, setJdText] = useState("");
  const [targetRole, setTargetRole] = useState("");
  const [targetCompany, setTargetCompany] = useState("");
  const [templateId, setTemplateId] = useState<"ats-classic" | "modern">("ats-classic");
  const [mode, setMode] = useState<"local" | "ai">("local");
  const [tailorFrom, setTailorFrom] = useState<"profile" | "resume">("profile");
  const [quickResumeId, setQuickResumeId] = useState("");
  const [sourceOverride, setSourceOverride] = useState<ResumeSourceData | null>(null);
  const [analysis, setAnalysis] = useState<JdAnalysis | null>(null);
  const [resume, setResume] = useState<TailoredResume | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [aiStatus, setAiStatus] = useState("AI locked");
  const [newSkill, setNewSkill] = useState("");
  const [autoGenerate, setAutoGenerate] = useState(false);

  useEffect(() => {
    void (async () => {
      await restoreVaultSession();
      const key = getUnlockedApiKey();
      const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
      const parsed = aiSettingsSchema.safeParse(stored[STORAGE_KEYS.settings]);
      const settings = parsed.success ? parsed.data : DEFAULT_SETTINGS;
      const permitted = await hasProviderPermission(settings);
      setAiReady(Boolean(key) && permitted);
      setAiStatus(
        !key
          ? "AI locked — Settings me vault unlock karo"
          : !permitted
            ? "AI endpoint permission missing"
            : "AI ready",
      );
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const stored = await chrome.storage.session.get(STORAGE_KEYS.resumeJobContext);
      const pending = stored[STORAGE_KEYS.resumeJobContext] as
        | { jdText?: string; targetRole?: string; targetCompany?: string; autoGenerate?: boolean }
        | undefined;
      if (!pending) return;
      if (pending.jdText?.trim()) setJdText(pending.jdText);
      if (pending.targetRole?.trim()) setTargetRole(pending.targetRole);
      if (pending.targetCompany?.trim()) setTargetCompany(pending.targetCompany);
      if (pending.autoGenerate) {
        await restoreVaultSession();
        setMode(getUnlockedApiKey() ? "ai" : "local");
        setAutoGenerate(true);
      }
      await chrome.storage.session.remove(STORAGE_KEYS.resumeJobContext);
    })();
  }, []);

  useEffect(() => {
    if (tailorFrom !== "resume" || quickResumeId || !resumes?.length) return;
    const preferred = resumes.find((item) => item.isDefault) ?? resumes[0];
    if (preferred) setQuickResumeId(preferred.id);
  }, [tailorFrom, quickResumeId, resumes]);

  const profileSource: ResumeSourceData = {
    profile,
    experiences: experiences ?? [],
    educations: educations ?? [],
    skills: skills ?? [],
    projects: projects ?? [],
  };

  const source = sourceOverride ?? profileSource;

  async function loadSettings(): Promise<AISettings> {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
    const parsed = aiSettingsSchema.safeParse(stored[STORAGE_KEYS.settings]);
    return parsed.success ? parsed.data : DEFAULT_SETTINGS;
  }

  async function handleUsePageJd() {
    setError(null);
    setNotice(null);
    try {
      const tab = await getActiveTab();
      if (!tab?.id || !isInjectableUrl(tab.url)) {
        throw new Error("Active job page nahi mila.");
      }
      const [jd, context] = await Promise.all([extractJd(tab.id), getPageContext(tab.id)]);
      if (!jd?.trim()) throw new Error("Is page se job description nahi mila.");
      setJdText(jd);
      setAnalysis(null);
      if (!targetRole && context?.jobTitle) setTargetRole(context.jobTitle);
      if (!targetCompany && context?.company) setTargetCompany(context.company);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "JD extraction failed");
    }
  }

  async function handleAnalyze() {
    setError(null);
    setNotice(null);
    try {
      if (!jdText.trim()) throw new Error("Pehle job description paste ya extract karo.");
      const nextAnalysis = await analyzeJd(jdText, source.skills.map((skill) => skill.name));
      setAnalysis(nextAnalysis);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "JD analysis failed");
    }
  }

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      if (!targetRole.trim()) throw new Error("Target role daalo, phir draft generate karo.");

      let generationSource = profileSource;

      if (tailorFrom === "resume") {
        if (!quickResumeId) {
          throw new Error("Quick tailor ke liye Resumes tab se ek resume select karo.");
        }

        const selectedResume = resumes?.find((item) => item.id === quickResumeId);
        if (!selectedResume) {
          throw new Error("Selected resume local library me nahi mili.");
        }

        const record = await getResumeFile(selectedResume.fileId);
        if (!record?.blob) {
          throw new Error("Selected resume file local storage me nahi mili.");
        }

        const file = new File(
          [record.blob],
          record.fileName ?? "resume.pdf",
          { type: record.mimeType },
        );
        const extraction = await extractResumeText(file);
        if (!extraction.text.trim()) {
          throw new Error(
            "Selected resume se text nahi mila (scanned PDF?). Text-based PDF/DOCX use karo.",
          );
        }

        const { parsed } = parseResumeLocally(extraction.text);
        const parsedSource = sourceFromParsedResume(parsed, profile);
        if (
          parsedSource.experiences.length === 0 &&
          parsedSource.skills.length === 0 &&
          parsedSource.educations.length === 0 &&
          parsedSource.projects.length === 0
        ) {
          throw new Error(
            "Resume se koi experience/skill/education/project parse nahi hua. Pehle import review se profile update karo.",
          );
        }

        generationSource = parsedSource;
        setSourceOverride(parsedSource);
      } else {
        setSourceOverride(null);
      }

      const nextAnalysis =
        analysis ?? (await analyzeJd(jdText, generationSource.skills.map((skill) => skill.name)));
      const jdHash = nextAnalysis.hash;
      const local = buildLocalResume({
        source: generationSource,
        targetRole,
        targetCompany,
        templateId,
        analysis: nextAnalysis,
        provider: "local",
        model: "deterministic",
        jdHash,
      });

      let next = local;

      if (mode === "ai") {
        const apiKey = getUnlockedApiKey();
        if (!apiKey) {
          throw new Error("AI vault locked hai. Settings → API Key Vault me unlock karo.");
        }

        const settings = await loadSettings();
        if (!(await hasProviderPermission(settings))) {
          throw new Error("AI endpoint permission missing. Settings me endpoint access grant karo.");
        }

        try {
          const prompt = buildAiPrompt(local, generationSource, jdText);
          const suggestions = await callAiJson<AiResumeSuggestions>({
            settings,
            apiKey,
            system: prompt.system,
            user: prompt.user,
          });
          next = applyAiSuggestions(local, suggestions, generationSource);
          next.meta.provider = settings.provider;
          next.meta.model = settings.model;
        } catch (aiError) {
          setNotice(
            `AI tailor fail hua, local fact-locked draft use kiya. ${
              aiError instanceof Error ? aiError.message : ""
            }`,
          );
        }
      }

      const validation = validateFactLock(next, generationSource);
      next.meta.factLockPassed = validation.ok;
      if (!validation.ok) {
        throw new Error(`Fact-lock failed: ${validation.errors.join(" ")}`);
      }

      const shape = validateResumeShape(next);
      if (!shape.ok) {
        throw new Error(`Resume schema validation failed: ${shape.errors.join(" ")}`);
      }

      const saved = await saveResumeVersion(next, {
        resumeId: seriesId ?? undefined,
        jdSnapshot: jdText,
        sourceSnapshot: generationSource,
      });
      setSeriesId(saved.resumeId);
      setResume(next);
      setAnalysis(nextAnalysis);
      setNotice((previous) => previous ?? `Version v${saved.versionNumber} saved.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Resume generation failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!autoGenerate || !jdText.trim() || !targetRole.trim() || profile === undefined || busy) return;
    setAutoGenerate(false);
    void handleGenerate();
  }, [autoGenerate, jdText, targetRole, profile, busy]);

  async function handleSaveVersion() {
    if (!resume) return;
    setBusy(true);
    setError(null);
    try {
      const validation = validateFactLock(resume, source);
      resume.meta.factLockPassed = validation.ok;
      if (!validation.ok) {
        throw new Error(`Fact-lock failed: ${validation.errors.join(" ")}`);
      }

      const shape = validateResumeShape(resume);
      if (!shape.ok) {
        throw new Error(`Resume schema validation failed: ${shape.errors.join(" ")}`);
      }

      const saved = await saveResumeVersion(resume, {
        resumeId: seriesId ?? undefined,
        jdSnapshot: jdText,
        sourceSnapshot: source,
      });
      setSeriesId(saved.resumeId);
      setNotice(`Version v${saved.versionNumber} saved.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save version");
    } finally {
      setBusy(false);
    }
  }

  async function handleDownload() {
    if (!resume) return;
    setBusy(true);
    setError(null);
    try {
      const bytes = await generateResumePdf(resume);
      const blob = new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = resumeFileName(resume, targetCompany);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "PDF export failed");
    } finally {
      setBusy(false);
    }
  }

  function handleLoadVersion(version: ResumeVersion) {
    setResume(version.content);
    setSeriesId(version.resumeId);
    setTargetRole(version.content.targetRole);
    setTemplateId(version.templateId);
    setSourceOverride(version.sourceSnapshot ?? null);
    setTailorFrom(version.sourceSnapshot ? "resume" : "profile");
    if (version.jdSnapshot) setJdText(version.jdSnapshot);
    setNotice(`Version v${version.versionNumber} loaded.`);
  }

  function updateResume(patch: Partial<TailoredResume>) {
    setResume((previous) => (previous ? { ...previous, ...patch } : previous));
  }

  function updateExperience(index: number, patch: Partial<TailoredResume["experience"][number]>) {
    setResume((previous) => {
      if (!previous) return previous;
      const experience = previous.experience.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      );
      return { ...previous, experience };
    });
  }

  function updateBullet(experienceIndex: number, bulletIndex: number, text: string) {
    setResume((previous) => {
      if (!previous) return previous;
      const experience = previous.experience.map((item, itemIndex) => {
        if (itemIndex !== experienceIndex) return item;
        return {
          ...item,
          bullets: item.bullets.map((bullet, index) =>
            index === bulletIndex ? { ...bullet, text } : bullet,
          ),
        };
      });
      return { ...previous, experience };
    });
  }

  function addBullet(experienceIndex: number) {
    setResume((previous) => {
      if (!previous) return previous;
      const experience = previous.experience.map((item, index) =>
        index === experienceIndex
          ? {
              ...item,
              bullets: [
                ...item.bullets,
                { text: "", sourceFactIds: [], origin: "user" as const },
              ],
            }
          : item,
      );
      return { ...previous, experience };
    });
  }

  function removeBullet(experienceIndex: number, bulletIndex: number) {
    setResume((previous) => {
      if (!previous) return previous;
      const experience = previous.experience.map((item, index) =>
        index === experienceIndex
          ? { ...item, bullets: item.bullets.filter((_, i) => i !== bulletIndex) }
          : item,
      );
      return { ...previous, experience };
    });
  }

  function moveExperience(index: number, direction: -1 | 1) {
    setResume((previous) => {
      if (!previous) return previous;
      const next = [...previous.experience];
      const target = index + direction;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...previous, experience: next };
    });
  }

  function moveSkill(index: number, direction: -1 | 1) {
    setResume((previous) => {
      if (!previous) return previous;
      const next = [...previous.skills];
      const target = index + direction;
      if (target < 0 || target >= next.length) return previous;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...previous, skills: next };
    });
  }

  function updateProject(index: number, patch: Partial<TailoredResume["projects"][number]>) {
    setResume((previous) =>
      previous
        ? {
            ...previous,
            projects: previous.projects.map((project, projectIndex) =>
              projectIndex === index ? { ...project, ...patch } : project,
            ),
          }
        : previous,
    );
  }

  async function handleDeleteVersion(version: ResumeVersion) {
    if (!window.confirm(`Delete resume version v${version.versionNumber}?`)) return;
    try {
      await deleteResumeVersion(version.id);
      setNotice(`Version v${version.versionNumber} deleted.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete version");
    }
  }

  function addSkill() {
    const name = newSkill.trim();
    if (!name) return;
    setResume((previous) =>
      previous
        ? {
            ...previous,
            skills: [
              ...previous.skills,
              { name, category: "General", sourceFactIds: [] },
            ],
          }
        : previous,
    );
    setNewSkill("");
  }

  function removeSkill(index: number) {
    setResume((previous) =>
      previous
        ? { ...previous, skills: previous.skills.filter((_, itemIndex) => itemIndex !== index) }
        : previous,
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Resume Studio</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">
            JD-tailored, fact-locked resume. AI sirf verified facts reorder/rephrase karta hai.
          </p>
        </div>
        <Badge tone={aiReady ? "emerald" : "amber"}>{aiStatus}</Badge>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          {notice}
        </p>
      ) : null}

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Job description
          </h3>
          <Button variant="secondary" onClick={() => void handleUsePageJd()}>
            Use page JD
          </Button>
        </div>

        <textarea
          className={`${inputClass} min-h-28 resize-y`}
          value={jdText}
          onChange={(event) => {
            setJdText(event.target.value);
            setAnalysis(null);
          }}
          placeholder="Job description paste karo, ya active job page se extract karo."
        />

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void handleAnalyze()} disabled={busy}>
            Analyze JD
          </Button>
          {analysis ? (
            <Badge tone="indigo">{analysis.wordCount} words</Badge>
          ) : null}
        </div>

        {analysis ? (
          <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="flex flex-wrap gap-1.5">
              {analysis.seniority ? <Badge tone="indigo">{analysis.seniority}</Badge> : null}
              {analysis.domain ? <Badge tone="emerald">{analysis.domain}</Badge> : null}
            </div>
            <p className="text-[11px] text-slate-400">
              <span className="font-semibold text-slate-300">Keywords:</span>{" "}
              {analysis.keywords.slice(0, 12).join(", ")}
            </p>
            <p className="text-[11px] text-slate-400">
              <span className="font-semibold text-slate-300">Matched skills:</span>{" "}
              {analysis.requiredSkills.filter((skill) => !analysis.missingSkills.includes(skill)).join(", ") || "—"}
            </p>
            <p className="text-[11px] text-amber-200">
              <span className="font-semibold">Suggested, not added:</span>{" "}
              {analysis.missingSkills.join(", ") || "—"}
            </p>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target role">
            <input
              className={inputClass}
              value={targetRole}
              onChange={(event) => setTargetRole(event.target.value)}
              placeholder="Frontend Developer"
            />
          </Field>
          <Field label="Company (filename)">
            <input
              className={inputClass}
              value={targetCompany}
              onChange={(event) => setTargetCompany(event.target.value)}
              placeholder="Acme Corp"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Tailor from">
            <select
              aria-label="Tailor source"
              className={inputClass}
              value={tailorFrom}
              onChange={(event) => {
                const value = event.target.value as "profile" | "resume";
                setTailorFrom(value);
                setAnalysis(null);
                setSourceOverride(null);
                if (value === "resume" && !quickResumeId && resumes?.length) {
                  const preferred =
                    resumes.find((item) => item.isDefault) ?? resumes[0];
                  if (preferred) setQuickResumeId(preferred.id);
                }
              }}
            >
              <option value="profile">My profile (Full)</option>
              <option value="resume">Uploaded resume (Quick)</option>
            </select>
          </Field>
          {tailorFrom === "resume" ? (
            <Field label="Resume file">
              <select
                aria-label="Quick resume file"
                className={inputClass}
                value={quickResumeId}
                onChange={(event) => {
                  setQuickResumeId(event.target.value);
                  setAnalysis(null);
                  setSourceOverride(null);
                }}
              >
                <option value="">Select a resume…</option>
                {(resumes ?? []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                    {item.isDefault ? " (default)" : ""}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <div className="flex items-end pb-2 text-[11px] text-slate-500">
              Master Profile facts use honge.
            </div>
          )}
        </div>

        {tailorFrom === "resume" && (resumes?.length ?? 0) === 0 ? (
          <p className="text-[11px] text-amber-200">
            Resumes tab me pehle PDF/DOCX upload karo, phir Quick tailor use karo.
          </p>
        ) : null}

        {sourceOverride ? (
          <p className="text-[11px] text-slate-500">
            <span className="text-emerald-300">Quick source active:</span>{" "}
            {sourceOverride.experiences.length} experience ·{" "}
            {sourceOverride.skills.length} skills · {sourceOverride.projects.length} projects
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Template">
            <select
              className={inputClass}
              value={templateId}
              onChange={(event) =>
                setTemplateId(event.target.value as "ats-classic" | "modern")
              }
            >
              <option value="ats-classic">ATS Classic</option>
              <option value="modern">Modern</option>
            </select>
          </Field>
          <Field label="Generation mode">
            <select
              className={inputClass}
              value={mode}
              onChange={(event) => setMode(event.target.value as "local" | "ai")}
            >
              <option value="local">Local fact-locked draft</option>
              <option value="ai" disabled={!aiReady}>
                AI tailor (BYOK)
              </option>
            </select>
          </Field>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void handleGenerate()} disabled={busy}>
            {busy ? "Generating..." : resume ? "Regenerate draft" : "Generate draft"}
          </Button>
          {resume ? (
            <>
              <Button variant="secondary" onClick={() => void handleSaveVersion()} disabled={busy}>
                Save new version
              </Button>
              <Button variant="secondary" onClick={() => void handleDownload()} disabled={busy}>
                Download PDF
              </Button>
            </>
          ) : null}
        </div>
      </Card>

      {!resume ? (
        <EmptyState
          title="No draft yet"
          description="JD analyze karke draft generate karo. Full mode profile facts use karta hai; Quick mode uploaded resume se facts leta hai. Koi naya skill/company invent nahi hota."
        />
      ) : (
        <>
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Editor
              </h3>
              <Badge tone={resume.meta.factLockPassed ? "emerald" : "rose"}>
                {resume.meta.factLockPassed ? "Fact-lock passed" : "Fact-lock failed"}
              </Badge>
            </div>

            <Field label="Summary">
              <textarea
                className={`${inputClass} min-h-24 resize-y`}
                value={resume.summary}
                onChange={(event) => updateResume({ summary: event.target.value })}
              />
            </Field>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-300">Experience</p>
              {resume.experience.map((experience, experienceIndex) => (
                <div
                  key={`${experience.company}-${experienceIndex}`}
                  className="rounded-xl border border-white/10 bg-white/[0.02] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-slate-200">
                        {experience.company} — {experience.designation}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {[experience.startDate, experience.endDate ?? "Present"]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        onClick={() => moveExperience(experienceIndex, -1)}
                        disabled={experienceIndex === 0}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => moveExperience(experienceIndex, 1)}
                        disabled={experienceIndex === resume.experience.length - 1}
                      >
                        ↓
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2 space-y-2">
                    {experience.bullets.map((bullet, bulletIndex) => (
                      <div key={bulletIndex} className="flex items-start gap-2">
                        <textarea
                          className={`${inputClass} min-h-16 resize-y text-[11px]`}
                          value={bullet.text}
                          onChange={(event) =>
                            updateBullet(experienceIndex, bulletIndex, event.target.value)
                          }
                        />
                        <Button
                          variant="ghost"
                          onClick={() => removeBullet(experienceIndex, bulletIndex)}
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                    <Button variant="ghost" onClick={() => addBullet(experienceIndex)}>
                      + Add bullet
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-300">Skills</p>
              <div className="flex flex-wrap gap-1.5">
                {resume.skills.map((skill, index) => (
                  <span
                    key={`${skill.name}-${index}`}
                    className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 text-[10px] text-slate-300"
                  >
                    {skill.name}
                    <button
                      className="text-slate-500 hover:text-rose-300"
                      onClick={() => removeSkill(index)}
                    >
                      ×
                    </button>
                    <button
                      className="text-slate-500 hover:text-indigo-300"
                      onClick={() => moveSkill(index, -1)}
                      disabled={index === 0}
                    >
                      ↑
                    </button>
                    <button
                      className="text-slate-500 hover:text-indigo-300"
                      onClick={() => moveSkill(index, 1)}
                      disabled={index === resume.skills.length - 1}
                    >
                      ↓
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  className={inputClass}
                  value={newSkill}
                  onChange={(event) => setNewSkill(event.target.value)}
                  placeholder="Add skill (manual)"
                />
                <Button variant="secondary" onClick={addSkill}>
                  Add
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-300">Projects & links</p>
              {resume.projects.map((project, projectIndex) => (
                <div key={`${project.name}-${projectIndex}`} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Field label="Project name">
                      <input className={inputClass} value={project.name} onChange={(event) => updateProject(projectIndex, { name: event.target.value })} />
                    </Field>
                    <Field label="Project URL (clickable in PDF)">
                      <input className={inputClass} type="url" value={project.url ?? ""} placeholder="https://github.com/..." onChange={(event) => updateProject(projectIndex, { url: event.target.value || undefined })} />
                    </Field>
                  </div>
                  <Field label="Technologies (comma separated)">
                    <input className={inputClass} value={project.technologies.join(", ")} onChange={(event) => updateProject(projectIndex, { technologies: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} />
                  </Field>
                  <Field label="Description">
                    <textarea className={`${inputClass} min-h-16 resize-y text-[11px]`} value={project.description} onChange={(event) => updateProject(projectIndex, { description: event.target.value })} />
                  </Field>
                </div>
              ))}
              {resume.projects.length === 0 ? <p className="text-[11px] text-slate-500">No projects in this draft. Add project URLs in Profile → Projects, then regenerate.</p> : null}
            </div>

            <p className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-slate-500">
              AI-generated bullets source fact IDs se locked hote hain. User-added bullets aur
              skills manually tumhari responsibility hain — inhe profile fact ke bina mat add karo.
            </p>
          </Card>

          <Card className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                Live preview
              </h3>
              <Badge tone="slate">{templateId}</Badge>
            </div>
            <ResumePreview resume={{ ...resume, templateId }} />
          </Card>

          <Card className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              Version history
            </h3>
            {!versions || versions.length === 0 ? (
              <p className="text-[11px] text-slate-500">No versions saved yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {versions.map((version) => (
                  <li
                    key={version.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[11px] text-slate-300">
                        v{version.versionNumber} · {version.templateId} · {version.content.targetRole}
                      </p>
                      <p className="text-[10px] text-slate-500">{formatDate(version.createdAt)}</p>
                    </div>
                     <div className="flex shrink-0 gap-1">
                       <Button variant="ghost" onClick={() => handleLoadVersion(version)}>Load</Button>
                       <Button variant="ghost" onClick={() => void handleDeleteVersion(version)}>Delete</Button>
                     </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
