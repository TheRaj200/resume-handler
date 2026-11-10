import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  STATUS_LABELS,
  STORAGE_KEYS,
  type ApplicationStatus,
  type PageContext,
} from "@jobpilot/shared";
import { countApplications, countResumes, db, getProfile } from "../db";
import { getActiveTab, getPageContext, isInjectableUrl } from "../lib/content-script";
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
              ? "border-emerald-400/40 bg-emerald-500/20 text-emerald-300"
              : "border-white/15 text-slate-600"
          }`}
        >
          {done ? "✓" : ""}
        </span>
        <span className={done ? "text-slate-400" : "text-slate-300"}>{label}</span>
      </span>
      {!done ? (
        <button
          className="text-[10px] text-indigo-300 hover:text-indigo-200"
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

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">
              Current page
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-100">
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

        <Button className="mt-3 w-full" onClick={() => onNavigate("studio")}>
          {context?.hasJobPosting ? "Build resume for this job" : "Open resume builder"}
        </Button>

      </Card>

      <AutofillWorkflow />

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Applications", value: applicationCount },
          { label: "Resumes", value: resumeCount },
          { label: "Profile", value: `${completeness}%` },
        ].map((stat) => (
          <Card key={stat.label} className="p-3">
            <p className="text-lg font-semibold text-slate-100">{stat.value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-500">
              {stat.label}
            </p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Setup checklist
          </h3>
          <span className="text-xs font-semibold text-indigo-300">{completeness}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
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

      <Card>
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Phase 2 status
        </h3>
        <ul className="mt-3 space-y-2 text-xs text-slate-400">
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
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-white/10 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-500 text-xs font-bold text-white">
              J
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight text-slate-100">JobPilot AI</p>
              <p className="text-[10px] text-slate-500">Local-first · BYOK</p>
            </div>
          </div>
          <Badge tone="indigo">v0.1</Badge>
        </div>

        <nav className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActive(tab.id)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
                active === tab.id
                  ? "bg-indigo-500/20 text-indigo-200"
                  : "text-slate-500 hover:bg-white/[0.05] hover:text-slate-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 px-4 py-4">
        {active === "dashboard" ? (
          <Dashboard onNavigate={(tab) => setActive(tab)} />
        ) : null}
        {active === "profile" ? <ProfileEditor /> : null}
        {active === "resumes" ? <ResumeLibrary /> : null}
        {active === "studio" ? <ResumeStudio /> : null}
        {active === "applications" ? <ApplicationsManager /> : null}
        {active === "settings" ? <SettingsPanel /> : null}
      </main>

      <footer className="border-t border-white/10 px-4 py-2 text-center text-[10px] text-slate-600">
        Phase 4 · BYOK · data stays in your browser
      </footer>
    </div>
  );
}
