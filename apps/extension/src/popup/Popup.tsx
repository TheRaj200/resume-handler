import { useEffect, useState } from "react";
import {
  STORAGE_KEYS,
  STATUS_LABELS,
  type Application,
  type ApplicationStatus,
  type PageContext,
} from "@jobpilot/shared";
import { getRecentApplications } from "../db";
import { getActiveTab, getPageContext, isInjectableUrl } from "../lib/content-script";
import { openFloatingWindow } from "../lib/floating-window";
import { Badge, Button, Card, EmptyState, type BadgeTone } from "../components/ui";

type PanelTab = "dashboard" | "profile" | "resumes" | "applications" | "settings";

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

export function Popup() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  const [context, setContext] = useState<PageContext | null>(null);
  const [recent, setRecent] = useState<Application[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const active = await getActiveTab();
      if (cancelled) return;

      setTab(active ?? null);
      setRecent(await getRecentApplications(5));

      if (active?.id && isInjectableUrl(active.url)) {
        const pageContext = await getPageContext(active.id);
        if (!cancelled) setContext(pageContext);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function openPanel(target: PanelTab) {
    if (!tab?.id) {
      setError("No active tab found.");
      return;
    }

    try {
      await chrome.storage.session.set({ [STORAGE_KEYS.openTab]: target });
      await chrome.sidePanel.open({ tabId: tab.id });
      window.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open side panel");
    }
  }

  const heading = context?.jobTitle ?? tab?.title ?? "No job page detected";
  const subheading = context?.company ?? context?.domain ?? tab?.url ?? "";

  return (
    <div className="flex min-h-[520px] flex-col p-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-[12px] bg-gradient-to-br from-brand-400 to-brand-600 text-sm font-bold text-white shadow-sm shadow-brand-500/30">
            J
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-slate-800">JobPilot AI</p>
            <p className="text-[11px] text-slate-400">One profile · Tailored resumes</p>
          </div>
        </div>
        <Badge tone="indigo">v0.1</Badge>
      </header>

      <div className="mt-4">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.14em] text-slate-400">Current page</p>
              <p className="mt-1 truncate text-sm font-semibold text-slate-800">{heading}</p>
              <p className="mt-0.5 truncate text-xs text-slate-500">{subheading}</p>
            </div>
            {context?.hasJobPosting ? (
              <Badge tone="emerald">JD detected</Badge>
            ) : (
              <Badge>No JD</Badge>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-3 space-y-2">
        <Button className="w-full" onClick={() => void openPanel("dashboard")}>
          Fill & autofill form
        </Button>
        <div className="grid grid-cols-3 gap-2">
          <Button size="sm" variant="secondary" onClick={() => void openPanel("dashboard")}>
            Resume
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void openPanel("profile")}>
            My Info
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void openPanel("applications")}>
            Tracker
          </Button>
        </div>
        <Button variant="secondary" className="w-full" onClick={() => void openFloatingWindow()}>
          Open floating window
        </Button>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Recent applications
          </h2>
          <button
            className="text-[11px] font-medium text-brand-600 hover:text-brand-700"
            onClick={() => void openPanel("applications")}
          >
            View all
          </button>
        </div>

        {recent.length === 0 ? (
          <EmptyState
            title="No applications yet"
            description="Form fill karne ke baad draft yahan dikhega. Applied tabhi hoga jab tum confirm karoge."
          />
        ) : (
          <ul className="space-y-2">
            {recent.slice(0, 3).map((application) => (
              <li
                key={application.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-slate-700">{application.jobTitle}</p>
                  <p className="truncate text-[11px] text-slate-500">{application.company}</p>
                </div>
                <Badge tone={statusTone(application.status)}>
                  {STATUS_LABELS[application.status]}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-600">
          {error}
        </p>
      ) : null}

      <footer className="mt-auto pt-4 text-center text-[10px] text-slate-400">
        Local-first · BYOK · private
      </footer>
    </div>
  );
}
