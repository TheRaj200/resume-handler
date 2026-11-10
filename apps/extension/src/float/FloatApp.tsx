import { useEffect, useState } from "react";
import { STORAGE_KEYS } from "@jobpilot/shared";
import { Badge } from "../components/ui";
import { AutofillWorkflow } from "../features/autofill/AutofillWorkflow";
import { ProfileEditor } from "../features/profile/ProfileEditor";
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

export function FloatApp() {
  const [active, setActive] = useState<TabId>("dashboard");

  useEffect(() => {
    void (async () => {
      const settings = await getSyncSettings();
      if (settings.enabled) {
        try {
          await syncNow();
        } catch (error) {
          console.warn("[sync] float window sync skipped:", error);
        }
      }
      const stored = await chrome.storage.session.get(STORAGE_KEYS.openTab);
      const pending = stored[STORAGE_KEYS.openTab];
      if (typeof pending === "string" && isTabId(pending)) setActive(pending);
      await chrome.storage.session.remove(STORAGE_KEYS.openTab);
    })();
  }, []);

  return (
    <div className="flex h-screen flex-col bg-gradient-to-br from-indigo-50/80 via-slate-50 to-emerald-50/60">
      {/* Colored app bar */}
      <header className="shrink-0 bg-gradient-to-r from-brand-600 via-brand-500 to-violet-500 px-5 py-3 text-white shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/20 text-sm font-bold backdrop-blur">
              J
            </div>
            <div>
              <p className="text-sm font-semibold tracking-tight">JobPilot AI</p>
              <p className="text-[11px] text-white/80">Floating workspace · one profile, tailored resumes</p>
            </div>
          </div>
          <Badge tone="indigo" >
            <span className="text-white">Floating window</span>
          </Badge>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left navigation */}
        <nav className="w-44 shrink-0 border-r border-slate-200 bg-white/70 px-2 py-3 backdrop-blur">
          {TABS.map((tab) => {
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12px] font-medium transition ${
                  isActive
                    ? "bg-brand-500 text-white shadow-sm shadow-brand-500/30"
                    : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
          <div className="mt-4 border-t border-slate-200 pt-3">
            <p className="px-3 text-[10px] uppercase tracking-wide text-slate-400">Local · BYOK</p>
          </div>
        </nav>

        {/* Content */}
        <main className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {active === "dashboard" ? <FloatDashboard onNavigate={(tab) => setActive(tab)} /> : null}
          {active === "profile" ? <ProfileEditor /> : null}
          {active === "resumes" ? <ResumeLibrary /> : null}
          {active === "studio" ? <ResumeStudio /> : null}
          {active === "applications" ? <ApplicationsManager /> : null}
          {active === "settings" ? <SettingsPanel /> : null}
        </main>
      </div>
    </div>
  );
}

function FloatDashboard({ onNavigate }: { onNavigate: (tab: TabId) => void }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-brand-200/60 bg-gradient-to-br from-white to-indigo-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Autofill</p>
          <p className="mt-1 text-sm text-slate-600">Job forms bho aapke profile se automatically fill hote hain.</p>
        </div>
        <div className="rounded-2xl border border-emerald-200/60 bg-gradient-to-br from-white to-emerald-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Resume Studio</p>
          <p className="mt-1 text-sm text-slate-600">JD-tailored, fact-locked one-page resumes.</p>
        </div>
      </div>

      {<AutofillWorkflow />}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onNavigate("profile")}
          className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-brand-500/30 hover:bg-brand-600"
        >
          Edit profile
        </button>
        <button
          onClick={() => onNavigate("studio")}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Open Resume Studio
        </button>
      </div>
    </div>
  );
}
