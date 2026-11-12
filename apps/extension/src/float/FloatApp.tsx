import { useEffect, useState } from "react";
import { STORAGE_KEYS } from "@jobpilot/shared";
import { AutofillWorkflow } from "../features/autofill/AutofillWorkflow";
import { ProfileEditor } from "../features/profile/ProfileEditor";
import { ResumeLibrary } from "../features/resumes/ResumeLibrary";
import { ResumeStudio } from "../features/resume-studio/ResumeStudio";
import { ApplicationsManager } from "../features/applications/ApplicationsManager";
import { SettingsPanel } from "../features/settings/SettingsPanel";
import { getSyncSettings, syncNow } from "../lib/sync-client";

const TABS = [
  { id: "dashboard", label: "Dashboard", icon: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" },
  { id: "profile", label: "My Info", icon: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" },
  { id: "resumes", label: "Resumes", icon: "M7 3h7l5 5v13H7V3Zm7 0v5h5M10 12h6M10 16h6" },
  { id: "studio", label: "Studio", icon: "M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" },
  { id: "applications", label: "Apps", icon: "M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm3 10h6m-6 4h4M9 7h6" },
  { id: "settings", label: "Settings", icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-2-1.2L14.6 3h-4l-.3 2.6a7.4 7.4 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 2 1.2l.3 2.6h4l.3-2.6a7.4 7.4 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string): value is TabId {
  return TABS.some((tab) => tab.id === value);
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4 shrink-0"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
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
    <div className="flex h-screen overflow-hidden bg-gradient-to-br from-brand-900/60 via-slate-950 to-brand-800/50">
      {/* Compact app rail: branding and navigation share one sidebar. */}
      <aside className="float-sidebar flex w-44 shrink-0 flex-col border-r border-white/10 bg-slate-950/30">
        <header className="float-header shrink-0 border-b border-white/10 px-3.5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white shadow-lg shadow-brand-500/30 ring-1 ring-white/20">
              J
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold tracking-tight text-white">JobPilot AI</p>
              <p className="float-subtitle truncate text-[10px] text-white/50">One profile · tailored resumes</p>
            </div>
          </div>
        </header>

        <nav className="float-nav min-h-0 flex-1 px-2.5 py-3">
          {TABS.map((tab) => {
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActive(tab.id)}
                className={`group mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-brand-500/15 text-brand-200 shadow-[inset_0_0_0_1px_rgba(255,154,0,0.25)]"
                    : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
                }`}
              >
                <span className={`float-nav-short ${isActive ? "text-brand-200" : "text-slate-500 group-hover:text-slate-300"}`}>
                  <NavIcon d={tab.icon} />
                </span>
                <span className="float-nav-label">{tab.label}</span>
                {isActive ? (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-400 shadow-[0_0_8px_rgba(255,154,0,0.8)]" />
                ) : null}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content with premium transitions */}
      <main className="float-content min-h-0 flex-1 overflow-y-auto px-5 py-5" key={active}>
          {active === "dashboard" ? <FloatDashboard onNavigate={(tab) => setActive(tab)} /> : null}
          {active === "profile" ? <ProfileEditor /> : null}
          {active === "resumes" ? <ResumeLibrary /> : null}
          {active === "studio" ? <ResumeStudio /> : null}
          {active === "applications" ? <ApplicationsManager /> : null}
          {active === "settings" ? <SettingsPanel /> : null}
      </main>
    </div>
  );
}

function FloatDashboard({ onNavigate }: { onNavigate: (tab: TabId) => void }) {
  return (
    <div className="space-y-5">
      <AutofillWorkflow />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onNavigate("profile")}
          className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-600 active:scale-[0.98]"
        >
          Edit profile
        </button>
        <button
          onClick={() => onNavigate("studio")}
          className="rounded-xl border border-white/10 bg-white/[0.07] px-4 py-2 text-sm font-medium text-slate-100 transition hover:bg-white/[0.12] active:scale-[0.98]"
        >
          Open Resume Studio
        </button>
      </div>
    </div>
  );
}
