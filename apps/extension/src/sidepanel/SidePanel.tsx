import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  STATUS_LABELS,
  STORAGE_KEYS,
  type ApplicationStatus,
  type PageContext,
} from "@jobpilot/shared";
import { countApplications, countResumes, db, getProfile } from "../db";
import { extractJd, getActiveTab, getPageContext, isInjectableUrl } from "../lib/content-script";
import { openFloatingWindow } from "../lib/floating-window";
import { Badge, Button, Card, EmptyState, type BadgeTone } from "../components/ui";
import { AutofillWorkflow } from "../features/autofill/AutofillWorkflow";
import { ProfileEditor } from "../features/profile/ProfileEditor";
import { useProfileCompleteness } from "../features/profile/useProfileCompleteness";
import { ResumeLibrary } from "../features/resumes/ResumeLibrary";
import { ResumeStudio } from "../features/resume-studio/ResumeStudio";
import { ApplicationsManager } from "../features/applications/ApplicationsManager";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { getSyncSettings, syncNow } from "../lib/sync-client";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "profile", label: "My Info" },
  { id: "resumes", label: "Resumes" },
  { id: "studio", label: "Studio" },
  { id: "applications", label: "Apps" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

function statusTone(status: ApplicationStatus): BadgeTone {
  switch (status) {
    case "OFFER":
      return "emerald";
    case "REJECTED":
      return "rose";
    case "INTERVIEW":
    case "SCREENING":
      return "amber";
    case "APPLIED":
      return "indigo";
    default:
      return "slate";
  }
}

/** Minimal HTML5 drag-to-reorder for a flat list of draggable sections. */
function useDragReorder<T>(items: T[], onChange: (next: T[]) => void) {
  const [dragging, setDragging] = useState<number | null>(null);

  function onDragStart(index: number) {
    setDragging(index);
  }

  function onDragOver(event: DragEvent, index: number) {
    event.preventDefault();
    if (dragging === null || dragging === index) return;
    const next = [...items];
    const [moved] = next.splice(dragging, 1);
    next.splice(index, 0, moved!);
    onChange(next);
    setDragging(index);
  }

  function onDragEnd() {
    setDragging(null);
  }

  return { dragging, onDragStart, onDragOver, onDragEnd };
}

function DragHandle({ onDragStart }: { onDragStart: () => void }) {
  return (
    <span
      role="button"
      aria-label="Drag to reorder"
      className="drag-handle icon-press hidden h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-500 sm:grid"
      draggable
      onDragStart={onDragStart}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <circle cx="5" cy="4" r="1.4" />
        <circle cx="11" cy="4" r="1.4" />
        <circle cx="5" cy="8" r="1.4" />
        <circle cx="11" cy="8" r="1.4" />
        <circle cx="5" cy="12" r="1.4" />
        <circle cx="11" cy="12" r="1.4" />
      </svg>
    </span>
  );
}

interface Section {
  id: string;
  render: (dragProps: {
    onDragStart: () => void;
    onDragOver: (event: DragEvent) => void;
    onDragEnd: () => void;
    dragging: boolean;
  }) => ReactNode;
}

function ChecklistItem({
  done,
  label,
  onAction,
}: {
  done: boolean;
  label: string;
  onAction: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-2">
        <span
          className={`grid h-4 w-4 place-items-center rounded-full border text-[10px] ${
            done
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-slate-300 text-slate-400"
          }`}
        >
          {done ? "✓" : ""}
        </span>
        <span className={done ? "text-slate-400" : "text-slate-500"}>{label}</span>
      </span>
      {!done ? (
        <button
          className="text-[10px] font-medium text-brand-600 hover:text-brand-700"
          onClick={onAction}
        >
          Add
        </button>
      ) : null}
    </li>
  );
}

function Dashboard({ onNavigate }: { onNavigate: (tab: TabId) => void }) {
  const applicationCount = useLiveQuery(() => countApplications(), [], 0);
  const resumeCount = useLiveQuery(() => countResumes(), [], 0);
  const profile = useLiveQuery(() => getProfile(), []);
  const experienceCount = useLiveQuery(() => db.experiences.count(), [], 0);
  const skillCount = useLiveQuery(() => db.skills.count(), [], 0);
  const completeness = useProfileCompleteness();

  const [context, setContext] = useState<PageContext | null>(null);

  async function buildResumeForJob(): Promise<void> {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url || !isInjectableUrl(tab.url)) {
      onNavigate("studio");
      return;
    }
    const [jdText, pageContext] = await Promise.all([
      extractJd(tab.id).catch(() => null),
      getPageContext(tab.id).catch(() => null),
    ]);
    const stored = await chrome.storage.session.get(STORAGE_KEYS.resumeJobContext);
    const previous = stored[STORAGE_KEYS.resumeJobContext] as Record<string, unknown> | undefined;
    await chrome.storage.session.set({
      [STORAGE_KEYS.resumeJobContext]: {
        ...previous,
        jdText: jdText?.trim() || previous?.jdText || "",
        targetRole: pageContext?.jobTitle || context?.jobTitle || previous?.targetRole || "",
        targetCompany: pageContext?.company || context?.company || previous?.targetCompany || "",
        url: tab.url,
        domain: new URL(tab.url).hostname,
        autoGenerate: true,
        capturedAt: new Date().toISOString(),
      },
    });
    onNavigate("studio");
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const tab = await getActiveTab();
      if (!tab?.id || !isInjectableUrl(tab.url) || cancelled) return;
      const pageContext = await getPageContext(tab.id);
      if (!cancelled) setContext(pageContext);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const [order, setOrder] = useState<string[]>(["page", "autofill", "stats", "checklist", "phase2"]);
  const { dragging, onDragStart, onDragOver, onDragEnd } = useDragReorder(order, setOrder);

  const sections: Record<string, Section["render"]> = {
    page: () => (
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Current page</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-800">
              {context?.jobTitle ?? context?.title ?? "No job page detected"}
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {context?.company ?? context?.domain ?? "Open a job portal to begin"}
            </p>
          </div>
          {context?.hasJobPosting ? (
            <Badge tone="emerald">JD detected</Badge>
          ) : (
            <Badge>No JD</Badge>
          )}
        </div>
        <Button className="mt-3 w-full" onClick={() => void buildResumeForJob()}>
          {context?.hasJobPosting ? "Build resume for this job" : "Open resume builder"}
        </Button>
      </Card>
    ),
    autofill: () => <AutofillWorkflow />,
    stats: () => (
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Applications", value: applicationCount },
          { label: "Resumes", value: resumeCount },
          { label: "Profile", value: `${completeness}%` },
        ].map((stat) => (
          <Card key={stat.label} className="p-3 text-center">
            <p className="text-lg font-semibold text-slate-800">{stat.value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">{stat.label}</p>
          </Card>
        ))}
      </div>
    ),
    checklist: () => (
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Setup checklist
          </h3>
          <span className="text-xs font-semibold text-brand-600">{completeness}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-brand-500 transition-all"
            style={{ width: `${completeness}%` }}
          />
        </div>
        <ul className="mt-3 space-y-2 text-xs">
          <ChecklistItem
            done={Boolean(profile?.firstName && profile?.email)}
            label="Personal details"
            onAction={() => onNavigate("profile")}
          />
          <ChecklistItem
            done={experienceCount > 0}
            label="Work experience"
            onAction={() => onNavigate("profile")}
          />
          <ChecklistItem
            done={skillCount > 0}
            label="Skills"
            onAction={() => onNavigate("profile")}
          />
          <ChecklistItem
            done={resumeCount > 0}
            label="Resume uploaded"
            onAction={() => onNavigate("resumes")}
          />
        </ul>
      </Card>
    ),
    phase2: () => (
      <Card className="p-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Phase 2 status
        </h3>
        <ul className="mt-3 space-y-2 text-xs text-slate-500">
          <li className="flex items-center justify-between">
            <span>Form scanner</span>
            <Badge tone="emerald">Advanced</Badge>
          </li>
          <li className="flex items-center justify-between">
            <span>Autofill engine</span>
            <Badge tone="emerald">Ready</Badge>
          </li>
          <li className="flex items-center justify-between">
            <span>Same-origin iframe</span>
            <Badge tone="emerald">Ready</Badge>
          </li>
          <li className="flex items-center justify-between">
            <span>Cross-origin iframe</span>
            <Badge tone="amber">Phase 2.5</Badge>
          </li>
          <li className="flex items-center justify-between">
            <span>AI resume studio</span>
            <Badge tone="emerald">Ready</Badge>
          </li>
          <li className="flex items-center justify-between">
            <span>Application tracker</span>
            <Badge tone="emerald">Ready</Badge>
          </li>
        </ul>
      </Card>
    ),
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-end">
        <span className="text-[10px] text-slate-400">Drag cards to reorder</span>
      </div>
      <div className="space-y-4">
        {order.map((id) => {
          const render = sections[id];
          if (!render) return null;
          const index = order.indexOf(id);
          return (
            <div
              key={id}
              className={`group relative ${dragging === index ? "drag-over rounded-xl" : ""}`}
              onDragOver={(event) => onDragOver(event, index)}
              onDragEnd={onDragEnd}
            >
              <div className="absolute -left-1 top-3 z-10">
                <DragHandle onDragStart={() => onDragStart(index)} />
              </div>
              {render({ onDragStart: () => onDragStart(index), onDragOver: () => {}, onDragEnd, dragging: dragging === index })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SidePanel() {
  const [active, setActive] = useState<TabId>("dashboard");

  useEffect(() => {
    void (async () => {
      const settings = await getSyncSettings();
      if (!settings.enabled) return;
      try {
        await syncNow();
      } catch (error) {
        console.warn("[sync] background sync skipped:", error);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await chrome.storage.session.get(STORAGE_KEYS.openTab);
      const pending = stored[STORAGE_KEYS.openTab];
      if (!cancelled && typeof pending === "string" && isTabId(pending)) {
        setActive(pending);
      }
      await chrome.storage.session.remove(STORAGE_KEYS.openTab);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleStorageChange(
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) {
      if (areaName !== "session") return;
      const next = changes[STORAGE_KEYS.openTab]?.newValue;
      if (typeof next === "string" && isTabId(next)) setActive(next);
    }

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-transparent">
      <div className="mx-3 mt-3 mb-3 flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-white to-indigo-50/50 shadow-[0_8px_40px_rgba(23,28,48,0.10)]">
        <header className="shrink-0 border-b border-slate-200 bg-gradient-to-b from-white to-slate-50">
          <div className="flex items-center justify-between px-4 pt-3">
            <div className="flex items-center gap-2.5">
              <div className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white shadow-sm shadow-brand-500/30">
                J
              </div>
              <div>
                <p className="text-sm font-semibold tracking-tight text-slate-800">JobPilot AI</p>
                <p className="text-[10px] text-slate-400">One profile · Tailored resumes</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => void openFloatingWindow()}
                title="Open as floating window"
                className="icon-press grid h-7 w-7 place-items-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-brand-600"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="3" width="12" height="9" rx="1.5" />
                  <path d="M2 6h12" />
                </svg>
              </button>
              <Badge tone="indigo">v0.1</Badge>
            </div>
          </div>

          <nav className="mt-2.5 flex gap-1 overflow-x-auto px-2 pb-2">
            {TABS.map((tab) => {
              const isActive = active === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActive(tab.id)}
                  className={`relative shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-medium transition ${
                    isActive
                      ? "bg-brand-50 text-brand-700"
                      : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  }`}
                >
                  {tab.label}
                  {isActive ? (
                    <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-500" />
                  ) : null}
                </button>
              );
            })}
          </nav>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-4">
          {active === "dashboard" ? <Dashboard onNavigate={(tab) => setActive(tab)} /> : null}
          {active === "profile" ? <ProfileEditor /> : null}
          {active === "resumes" ? <ResumeLibrary /> : null}
          {active === "studio" ? <ResumeStudio /> : null}
          {active === "applications" ? <ApplicationsManager /> : null}
          {active === "settings" ? <SettingsPanel /> : null}
        </main>

        <footer className="shrink-0 border-t border-slate-200 px-4 py-2 text-center text-[10px] text-slate-400">
          Data stays in your browser · BYOK
        </footer>
      </div>
    </div>
  );
}
