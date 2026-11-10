import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AUTOFILL_AUTO_THRESHOLD,
  AUTOFILL_REVIEW_THRESHOLD,
  STORAGE_KEYS,
  aiSettingsSchema,
  type DetectedField,
  type ExtensionMessage,
  type FieldMatch,
  type FieldMatchSource,
  type FieldValue,
  type FillPlan,
  type Application,
  type FillResult,
  type FormScanResult,
  type PageContext,
  type ResumeAttachment,
} from "@jobpilot/shared";
import {
  db,
  findDuplicateApplication,
  getFieldMappings,
  getFormMemoryKey,
  getRememberedFormAnswers,
  getProfile,
  getResumeBlob,
  rememberFormAnswers,
  saveCustomField,
  saveCustomFieldValue,
  saveApplication,
  saveFieldMapping,
  updateApplicationStatus,
} from "../../db";
import {
  fillForm,
  getActiveTab,
  getPageContext,
  isInjectableUrl,
  requestPagePermission,
  scanForm,
  extractJd,
  undoFill,
} from "../../lib/content-script";
import { callAiJson } from "../../lib/ai-provider";
import { getUnlockedApiKey, restoreVaultSession } from "../../lib/crypto-vault";
import {
  buildProfileFacts,
  fingerprintField,
  matchFields,
  resolveValue,
  type ProfileFact,
} from "./matcher";
import { Badge, Button, Card, EmptyState, type BadgeTone } from "../../components/ui";

interface PlanRow {
  id: string;
  field: DetectedField;
  profileKey: string;
  value: FieldValue;
  confidence: number;
  requiresReview: boolean;
  sensitive: boolean;
  source?: FieldMatchSource;
  selected: boolean;
  reason?: string;
}

function formatValue(value: FieldValue): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function confidenceBadge(row: PlanRow): { label: string; tone: BadgeTone } {
  if (row.confidence >= AUTOFILL_AUTO_THRESHOLD) return { label: "Auto", tone: "emerald" };
  if (row.confidence >= AUTOFILL_REVIEW_THRESHOLD) return { label: "Review", tone: "amber" };
  if (row.confidence > 0) return { label: "Low", tone: "rose" };
  return { label: "Unmatched", tone: "slate" };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function extensionFromMime(mime: string): string {
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("wordprocessingml") || mime.includes("docx")) return ".docx";
  if (mime.includes("msword") || mime.includes("doc")) return ".doc";
  return "";
}

function rowLabel(rows: PlanRow[], elementId: string): string {
  return rows.find((row) => row.id === elementId)?.field.label ?? elementId;
}

export function AutofillWorkflow() {
  const resumes = useLiveQuery(() => db.resumes.toArray(), []);
  const defaultResume = resumes?.find((resume) => resume.isDefault) ?? resumes?.[0];

  const [rows, setRows] = useState<PlanRow[]>([]);
  const [blocked, setBlocked] = useState<
    Array<{ field: DetectedField; reason: string }>
  >([]);
  const [facts, setFacts] = useState<ProfileFact[]>([]);
  const [scanResult, setScanResult] = useState<FormScanResult | null>(null);
  const [domain, setDomain] = useState("");
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [filling, setFilling] = useState(false);
  const [report, setReport] = useState<FillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formChanged, setFormChanged] = useState(false);
  const [rememberMappings, setRememberMappings] = useState(true);
  const [attachResume, setAttachResume] = useState(true);
  const [undoStatus, setUndoStatus] = useState<"idle" | "undoing" | "undone">("idle");
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [duplicateApp, setDuplicateApp] = useState<Application | null>(null);
  const [trackedAppId, setTrackedAppId] = useState<string | null>(null);
  const [isMarkedApplied, setIsMarkedApplied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [learning, setLearning] = useState(false);
  const [learnMessage, setLearnMessage] = useState<string | null>(null);
  const [autofillPreferences, setAutofillPreferences] = useState({
    autoThreshold: AUTOFILL_AUTO_THRESHOLD,
    reviewThreshold: AUTOFILL_REVIEW_THRESHOLD,
    highlightMatches: true,
    aiMatching: false,
  });

  useEffect(() => {
    void import("../../lib/autofill-preferences").then(({ getAutofillPreferences }) => {
      void getAutofillPreferences().then(setAutofillPreferences);
    });
  }, []);

  useEffect(() => {
    function handleMessage(message: ExtensionMessage) {
      if (message.type === "FORM_CHANGED") {
        setFormChanged(true);
        if (message.data.fields?.length) {
          void getActiveTab().then((tab) => {
            if (!tab?.url) return;
            const hostname = new URL(tab.url).hostname;
            return rememberFormAnswers(hostname, tab.url!, message.data.fields ?? []);
          });
        }
      }
    }

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  async function handleScan() {
    setScanning(true);
    setError(null);
    setReport(null);
    setFormChanged(false);
    setUndoStatus("idle");

    try {
      const tab = await getActiveTab();
      if (!tab?.id) throw new Error("No active tab found.");
      if (!tab.url || !isInjectableUrl(tab.url)) {
        throw new Error("This page does not allow injection.");
      }
      if (!(await requestPagePermission(tab.url))) {
        throw new Error("Page permission required. Allow access to this site and scan again.");
      }

      const result = await scanForm(tab.id);
      if (!result) throw new Error("Could not scan this page.");
      const targetDomain = new URL(tab.url).hostname;
      await rememberFormAnswers(targetDomain, tab.url, result.fields);
      const rememberedAnswers = await getRememberedFormAnswers(targetDomain);
      const rememberedByKey = new Map(rememberedAnswers.map((answer) => [answer.key, answer]));

      const [context, jobDescription] = await Promise.all([
        getPageContext(tab.id),
        extractJd(tab.id),
      ]);
      setPageContext(context);
      await chrome.storage.session.set({
        [STORAGE_KEYS.resumeJobContext]: {
          jdText: jobDescription?.trim() ?? "",
          targetRole: context?.jobTitle ?? "",
          targetCompany: context?.company ?? "",
          url: tab.url,
          domain: targetDomain,
          capturedAt: new Date().toISOString(),
        },
      });

      const dup = await findDuplicateApplication(tab.url, context?.company, context?.jobTitle);
      setDuplicateApp(dup ?? null);

      const [profile, experiences, educations, skills, customFields, customValues] =
        await Promise.all([
          getProfile(),
          db.experiences.toArray(),
          db.educations.toArray(),
          db.skills.toArray(),
          db.customFields.toArray(),
          db.customFieldValues.toArray(),
        ]);

      const profileFacts = buildProfileFacts({
        profile,
        experiences,
        educations,
        skills,
        customFields,
        customValues,
        defaultResumeTitle: defaultResume?.title,
      });

       const mappings = await getFieldMappings(targetDomain);
      const matchResult = matchFields(result.fields, profileFacts, mappings, customFields, {
        autoThreshold: autofillPreferences.autoThreshold,
        reviewThreshold: autofillPreferences.reviewThreshold,
      });

      const matchedRows: PlanRow[] = matchResult.matches.map((match) => ({
        id: match.field.elementId,
        field: match.field,
        profileKey: match.profileKey,
        value: match.value,
        confidence: match.confidence,
        requiresReview: match.requiresReview,
        sensitive: match.sensitive ?? false,
        source: match.source,
        selected:
          !match.sensitive &&
          match.confidence >= autofillPreferences.reviewThreshold &&
          !(match.profileKey === "resume.file" && !attachResume),
      }));

       const unmatchedRows: PlanRow[] = matchResult.unmatched.map((entry) => {
         const remembered = rememberedByKey.get(getFormMemoryKey(entry.field));
         return {
           id: entry.field.elementId,
           field: entry.field,
           profileKey: remembered ? `memory.${remembered.key}` : "",
           value: remembered?.value ?? null,
           confidence: remembered ? 0.88 : 0,
           requiresReview: Boolean(remembered),
           sensitive: false,
           selected: Boolean(remembered),
           source: remembered ? "stored" : undefined,
           reason: remembered ? "Remembered answer — review before filling." : entry.reason,
         };
       });

      setRows([...matchedRows, ...unmatchedRows]);
      setBlocked(matchResult.blocked);
      setFacts(profileFacts);
      setScanResult(result);
      setDomain(targetDomain);
      setActiveTabId(tab.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  function updateRow(rowId: string, patch: Partial<PlanRow>) {
    setRows((previous) =>
      previous.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  }

  function handleProfileKeyChange(rowId: string, profileKey: string) {
    const row = rows.find((item) => item.id === rowId);
    if (!row) return;

    if (!profileKey) {
      updateRow(rowId, {
        profileKey: "",
        value: null,
        confidence: 0,
        requiresReview: true,
        selected: false,
        source: undefined,
        reason: "Choose a profile field",
      });
      return;
    }

    const fact = facts.find((item) => item.key === profileKey);
    if (!fact) {
      updateRow(rowId, {
        profileKey: "",
        value: null,
        confidence: 0,
        requiresReview: true,
        selected: false,
        source: undefined,
        reason: "Profile field not found",
      });
      return;
    }

    const value = resolveValue(row.field, fact);
    if (value === null || value === undefined || value === "") {
      updateRow(rowId, {
        profileKey,
        value: null,
        confidence: 0,
        requiresReview: true,
        selected: false,
        sensitive: fact.sensitive ?? false,
        source: "manual",
        reason: "Profile value is empty",
      });
      return;
    }

    updateRow(rowId, {
      profileKey,
      value,
      confidence: 0.95,
      requiresReview: false,
      sensitive: fact.sensitive ?? false,
      selected: true,
      source: "manual",
      reason: undefined,
    });
  }

  function handleToggle(rowId: string) {
    const row = rows.find((item) => item.id === rowId);
    if (!row || !row.profileKey || row.value === null) return;
    updateRow(rowId, { selected: !row.selected });
  }

  async function handleFill(rowsToFill = rows) {
    const selectedRows = rowsToFill.filter(
      (row) =>
        row.selected &&
        row.profileKey &&
        row.value !== null &&
        !(row.profileKey === "resume.file" && !attachResume) &&
        !(row.field.inputType === "file" && row.profileKey !== "resume.file"),
    );

    if (selectedRows.length === 0) {
      setError("Select at least one field to fill.");
      return;
    }

    setFilling(true);
    setError(null);

    try {
      let resumeAttachment: ResumeAttachment | undefined;

      if (attachResume && defaultResume && selectedRows.some((row) => row.profileKey === "resume.file")) {
        const blob = await getResumeBlob(defaultResume.fileId);
        if (!blob) throw new Error("Default resume file is missing from local storage.");
        resumeAttachment = {
          name: `${defaultResume.title}${extensionFromMime(blob.type)}`,
          mimeType: blob.type || "application/octet-stream",
          base64: await blobToBase64(blob),
        };
      }

      const matches: FieldMatch[] = selectedRows.map((row) => ({
        field: row.field,
        profileKey: row.profileKey,
        value: row.value,
        confidence: row.confidence,
        requiresReview: row.requiresReview,
        sensitive: row.sensitive,
        source: row.source === "manual" ? "manual" : row.source,
      }));

      const plan: FillPlan = {
        sessionId: crypto.randomUUID(),
        matches,
        resumeAttachment,
        highlight: autofillPreferences.highlightMatches,
      };

      const result = await fillForm(activeTabId!, plan);
      if (!result) throw new Error("Fill request failed. Try scanning again.");

      setReport(result);
      setFormChanged(false);
      setUndoStatus("idle");

      // Auto-track as DRAFT application
      try {
        const tab = await getActiveTab();
        const draft = await saveApplication(
          {
            company: pageContext?.company || domain || "Unknown Company",
            jobTitle: pageContext?.jobTitle || "Job Application",
            jobUrl: tab?.url,
            status: "DRAFT",
            notes: `Autofilled ${selectedRows.length} fields on ${new Date().toLocaleDateString()}`,
          },
          duplicateApp?.status === "DRAFT" ? duplicateApp.id : undefined,
        );
        setTrackedAppId(draft.id);
        setIsMarkedApplied(false);
      } catch (trackError) {
        console.warn("Could not record draft application:", trackError);
      }

      if (rememberMappings) {
        for (const row of selectedRows) {
          if (!row.profileKey || row.profileKey === "resume.file") continue;
          await saveFieldMapping({
            domain,
            fingerprint: fingerprintField(row.field),
            profileKey: row.profileKey,
            confidence: row.confidence,
            confirmedByUser: true,
          });
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Fill failed");
    } finally {
      setFilling(false);
    }
  }

  async function handleGenerateAnswers(autoFill = false) {
    if (!scanResult || activeTabId === null) return;
    setGenerating(true);
    setError(null);
    try {
      await restoreVaultSession();
      const apiKey = getUnlockedApiKey();
      if (!apiKey) throw new Error("Settings mein API key unlock karo, phir Generate & fill try karo.");
      const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
      const parsedSettings = aiSettingsSchema.safeParse(stored[STORAGE_KEYS.settings]);
      if (!parsedSettings.success) throw new Error("Settings mein AI provider configure karo.");

      const jobDescription = (await extractJd(activeTabId))?.slice(0, 14_000) ?? "";
      const targetRows = rows.filter(
        (row) => !row.profileKey || row.field.tag === "textarea" || row.field.inputType === "text",
      );
      if (targetRows.length === 0) throw new Error("Generate karne ke liye koi text/unmatched field nahi mila.");

      const answerResponse = await callAiJson<{ answers?: Record<string, string | null> }>({
        settings: parsedSettings.data,
        apiKey,
        system: [
          "You generate job application answers from verified candidate facts.",
          "Return only JSON in the shape {\"answers\": {\"elementId\": string|null}}.",
          "Never invent employers, dates, degrees, metrics, tools, achievements, salary, visa status, or experience.",
          "Use natural concise professional language; it must sound like the candidate, not like an AI.",
          "If the facts do not support an answer, return null.",
        ].join(" "),
        user: JSON.stringify({
          jobDescription,
          candidateFacts: facts.map((fact) => ({ key: fact.key, label: fact.label, value: fact.value })),
          fields: targetRows.map((row) => ({
            elementId: row.id,
            label: row.field.label,
            type: row.field.inputType,
            placeholder: row.field.placeholder,
            options: row.field.options,
          })),
        }),
      });

      const answers = answerResponse.answers ?? {};
      const generatedRows: PlanRow[] = rows.map((row) => {
        const answer = answers[row.id];
        if (typeof answer !== "string" || !answer.trim()) return row;
        return {
          ...row,
          profileKey: `ai.generated.${row.id}`,
          value: answer.trim(),
          confidence: 0.8,
          requiresReview: true,
          selected: true,
          source: "ai" as const,
          reason: "AI-generated from your saved facts; review before filling.",
        };
      });
      setRows(generatedRows);
      if (autoFill) await handleFill(generatedRows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "AI generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleLearnCurrentAnswers() {
    if (!scanResult) return;
    const candidates = rows.filter(
      (row) => !row.profileKey && row.field.currentValue?.trim() && row.field.inputType !== "file",
    );
    if (candidates.length === 0) {
      setLearnMessage("Koi naya unmatched answer nahi mila. Pehle form fill karke Rescan karo.");
      return;
    }
    setLearning(true);
    setLearnMessage(null);
    try {
      for (const row of candidates) {
        const safeDomain = domain.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
        const safeLabel = row.field.label.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
        const fieldKey = `learned.${safeDomain || "site"}.${safeLabel || row.id}`.slice(0, 100);
        const existing = await db.customFields.where("fieldKey").equals(fieldKey).first();
        const field = await saveCustomField(existing ? {
          label: row.field.label,
          fieldKey,
          fieldType: "text",
          isSensitive: false,
          required: false,
        } : {
          label: `${row.field.label} (${domain})`,
          fieldKey,
          fieldType: "text",
          isSensitive: false,
          required: false,
        }, existing?.id);
        await saveCustomFieldValue(field.id, row.field.currentValue?.trim() ?? "");
      }
      setLearnMessage(`${candidates.length} new answer(s) saved. Next scan mein mapping available hogi.`);
    } catch (cause) {
      setLearnMessage(cause instanceof Error ? cause.message : "Could not remember answers");
    } finally {
      setLearning(false);
    }
  }

  async function handleUndo() {
    if (!report || activeTabId === null) return;
    setUndoStatus("undoing");
    const undone = await undoFill(activeTabId, report.sessionId);
    if (undone) {
      setReport(null);
      setUndoStatus("undone");
    } else {
      setUndoStatus("idle");
      setError("Could not undo this fill session.");
    }
  }

  const selectedCount = rows.filter(
    (row) =>
      row.selected &&
      row.profileKey &&
      row.value !== null &&
      !(row.profileKey === "resume.file" && !attachResume) &&
      !(row.field.inputType === "file" && row.profileKey !== "resume.file"),
  ).length;
  const matchedCount = rows.filter((row) => row.profileKey).length;
  const reviewCount = rows.filter(
    (row) =>
      row.selected &&
      (row.requiresReview || row.confidence < autofillPreferences.autoThreshold),
  ).length;
  const unmatchedCount = rows.filter((row) => !row.profileKey).length;
  const crossOriginOrigins = scanResult?.crossOriginIframeOrigins ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Autofill
          </h3>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Sirf aapke profile data se fill hota hai. Submit kabhi automatic nahi hota.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void handleScan()} disabled={scanning}>
          {scanning ? "Scanning..." : scanResult ? "Rescan" : "Scan page"}
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </p>
      ) : null}

      {formChanged ? (
        <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
          Form change detect hua hai. Latest fields ke liye Rescan karo.
        </p>
      ) : null}

      {!scanResult ? (
        <EmptyState
          title="No form scanned"
          description="Job application page pe Scan karo. Extension fields detect karke profile se map karega."
          action={
            <Button onClick={() => void handleScan()} disabled={scanning}>
              {scanning ? "Scanning..." : "Scan page"}
            </Button>
          }
        />
      ) : (
        <>
          {duplicateApp ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 space-y-1">
              <p className="font-semibold flex items-center gap-1.5">
                <span>⚠️</span> Duplicate Application Detected
              </p>
              <p className="text-[11px] text-amber-300/80">
                You have an existing application for <strong>{duplicateApp.company}</strong> ({duplicateApp.jobTitle}) with status <strong className="text-white">{duplicateApp.status}</strong>.
              </p>
            </div>
          ) : null}

          <Card className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <Badge tone="indigo">{scanResult.fields.length} fields</Badge>
              <Badge tone="emerald">{matchedCount} matched</Badge>
              <Badge tone="amber">{selectedCount} selected</Badge>
              <Badge tone="slate">{unmatchedCount} unmatched</Badge>
              <Badge tone="rose">{blocked.length} blocked</Badge>
            </div>

            <div className="flex flex-wrap gap-3 pt-1">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <input
                  type="checkbox"
                  checked={rememberMappings}
                  onChange={(event) => setRememberMappings(event.target.checked)}
                  className="h-3.5 w-3.5 accent-indigo-500"
                />
                Remember mappings for {domain}
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <input
                  type="checkbox"
                  checked={attachResume && Boolean(defaultResume)}
                  onChange={(event) => setAttachResume(event.target.checked)}
                  disabled={!defaultResume}
                  className="h-3.5 w-3.5 accent-indigo-500"
                />
                Attach default resume
                {defaultResume ? ` (${defaultResume.title})` : " (not set)"}
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
              <Button
                type="button"
                variant="secondary"
                   onClick={() => void handleGenerateAnswers(true)}
                disabled={generating || filling}
              >
                {generating ? "Generating..." : "Generate natural answers"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => void handleLearnCurrentAnswers()}
                disabled={learning || generating}
              >
                {learning ? "Saving..." : "Remember new answers"}
              </Button>
              <span className="text-[10px] text-slate-500">
                Manual answers ko Rescan ke baad save karein
              </span>
            </div>
            {learnMessage ? (
              <p className="rounded-xl border border-indigo-400/20 bg-brand-500/10 px-3 py-2 text-[11px] text-indigo-700">
                {learnMessage}
              </p>
            ) : null}

            {crossOriginOrigins.length > 0 ? (
              <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700">
                Cross-origin iframe detected ({crossOriginOrigins.length}). Uske andar ke fields
                scan nahi hue. Full cross-origin iframe support Phase 2.5 me aayega.
              </p>
            ) : null}

            {scanResult.possibleClosedShadowRoots ? (
              <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700">
                Possible closed shadow DOM detected. Uske andar ke fields support nahi hain.
              </p>
            ) : null}
          </Card>

          {rows.length === 0 ? (
            <EmptyState
              title="Koi fillable field nahi mila"
              description="Is page pe visible form fields nahi mile. Form load hone ke baad Rescan try karo."
            />
          ) : (
            <div className="space-y-2">
              {rows.map((row) => {
                const badge = confidenceBadge(row);
                const isFile = row.profileKey === "resume.file";
                const isFileField = row.field.inputType === "file";
                return (
                  <Card key={row.id} className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 h-3.5 w-3.5 accent-indigo-500"
                          checked={row.selected}
                          disabled={!row.profileKey || row.value === null}
                          onChange={() => handleToggle(row.id)}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-700">
                            {row.field.label}
                          </p>
                          <p className="truncate text-[10px] text-slate-500">
                            {row.field.domPath}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {row.sensitive ? <Badge tone="amber">Sensitive</Badge> : null}
                        {row.source === "stored" ? <Badge tone="indigo">Saved</Badge> : null}
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <select
                        className="w-44 shrink-0 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] text-slate-700 outline-none focus:border-indigo-400/60"
                        value={row.profileKey}
                        disabled={isFileField}
                        onChange={(event) => handleProfileKeyChange(row.id, event.target.value)}
                      >
                        <option value="">
                          {row.profileKey ? "Skip" : "Choose profile field..."}
                        </option>
                        {facts.map((fact) => (
                          <option key={fact.key} value={fact.key}>
                            {fact.label}
                          </option>
                        ))}
                      </select>
                      <span className="truncate text-[11px] text-slate-400">
                        {isFile ? "Default resume attach hogi" : formatValue(row.value)}
                      </span>
                    </div>

                    {row.reason ? (
                      <p className="text-[10px] text-amber-300/80">{row.reason}</p>
                    ) : null}
                  </Card>
                );
              })}
            </div>
          )}

          {blocked.length > 0 ? (
            <Card className="space-y-1 p-3">
              <p className="text-[11px] font-semibold text-slate-500">Not fillable</p>
              <ul className="space-y-1 text-[10px] text-slate-500">
                {blocked.map((entry) => (
                  <li key={entry.field.elementId}>
                    {entry.field.label} — {entry.reason}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <div className="flex items-center justify-between">
            <p className="text-[11px] text-slate-500">
              {reviewCount > 0
                ? `${reviewCount} fields review ke saath fill honge.`
                : "High-confidence mappings auto-fill honge."}
            </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="secondary"
                  onClick={() => void handleGenerateAnswers()}
                  disabled={generating || filling}
                >
                  {generating ? "Generating..." : "Generate & fill"}
                </Button>
                <Button onClick={() => void handleFill()} disabled={selectedCount === 0 || filling || generating}>
                  {filling ? "Filling..." : `Fill selected (${selectedCount})`}
                </Button>
              </div>
          </div>

          {report ? (
            <Card className="space-y-2 p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-700">Fill report</p>
                <Button
                  variant="secondary"
                  onClick={() => void handleUndo()}
                  disabled={undoStatus === "undoing"}
                >
                  {undoStatus === "undoing" ? "Undoing..." : "Undo fill"}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 text-[10px]">
                <Badge tone="emerald">Filled {report.filled.length}</Badge>
                <Badge tone="amber">Review {report.needsReview.length}</Badge>
                <Badge tone="rose">Failed {report.failed.length}</Badge>
                <Badge tone="slate">Skipped {report.skipped.length}</Badge>
              </div>
              {report.filled.length > 0 ? (
                <p className="text-[10px] text-slate-400">
                  Filled: {report.filled.map((id) => rowLabel(rows, id)).join(", ")}
                </p>
              ) : null}
              {report.failed.length > 0 ? (
                <p className="text-[10px] text-rose-600">
                  Failed: {report.failed.map((id) => rowLabel(rows, id)).join(", ")}
                </p>
              ) : null}

              {trackedAppId ? (
                <div className="mt-2 flex items-center justify-between rounded-xl border border-indigo-500/20 bg-brand-500/10 p-2.5">
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-medium text-slate-700">Tracked in Applications</p>
                    <p className="text-[10px] text-slate-400">
                      {isMarkedApplied
                        ? "Status: APPLIED"
                        : "Saved as DRAFT. Mark Applied after submitting."}
                    </p>
                  </div>
                  <Button
                    variant={isMarkedApplied ? "secondary" : "primary"}
                    className="shrink-0 text-xs py-1 px-3"
                    disabled={isMarkedApplied}
                    onClick={async () => {
                      if (trackedAppId) {
                        await updateApplicationStatus(
                          trackedAppId,
                          "APPLIED",
                          "Submitted on portal after autofill",
                        );
                        setIsMarkedApplied(true);
                      }
                    }}
                  >
                    {isMarkedApplied ? "✓ Applied" : "Mark as Applied"}
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}

          {undoStatus === "undone" ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-600">
              Fill undo ho gaya. Fields original values pe wapas aa gaye.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
