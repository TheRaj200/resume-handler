import { SettingsPanel } from "../features/settings/SettingsPanel";
import { Badge } from "../components/ui";

export function Options() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-500 text-base font-bold text-white shadow-lg shadow-indigo-950/50">
            J
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-slate-100">
              JobPilot AI — Settings
            </h1>
            <p className="text-xs text-slate-500">AI provider, key vault and data controls</p>
          </div>
        </div>
        <Badge tone="indigo">v0.1</Badge>
      </header>

      <SettingsPanel />

      <footer className="mt-10 border-t border-white/10 pt-4 text-[11px] leading-relaxed text-slate-600">
        API keys are never sent to the JobPilot backend. They stay in this browser, encrypted
        with a passphrase-derived key (Phase 3). Cloud sync is optional and deferred to Phase 4.
      </footer>
    </div>
  );
}
