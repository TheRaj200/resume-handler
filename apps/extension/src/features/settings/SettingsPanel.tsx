import { useEffect, useState, type FormEvent } from "react";
import {
  AI_PROVIDERS,
  AI_PROVIDER_LABELS,
  STORAGE_KEYS,
  aiSettingsSchema,
  type AISettings,
} from "@jobpilot/shared";
import { Badge, Button, Card, Field, inputClass } from "../../components/ui";
import {
  hasProviderPermission,
  requestProviderPermission,
  testProviderConnection,
} from "../../lib/ai-provider";
import {
  DEFAULT_AUTOFILL_PREFERENCES,
  getAutofillPreferences,
  saveAutofillPreferences,
  type AutofillPreferences,
} from "../../lib/autofill-preferences";
import { deleteAllLocalData, exportAllLocalData } from "../../db";
import {
  deleteStoredApiKey,
  getUnlockedApiKey,
  hasStoredApiKey,
  lockVault,
  saveApiKey,
  unlockVault,
} from "../../lib/crypto-vault";

const DEFAULT_SETTINGS: AISettings = {
  provider: "gemini",
  model: "gemini-2.5-flash",
  baseUrl: "",
  temperature: 0.4,
  maxOutputTokens: 4096,
};

export function SettingsPanel() {
  const [settings, setSettings] = useState<AISettings>(DEFAULT_SETTINGS);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [vaultState, setVaultState] = useState<"empty" | "locked" | "unlocked">("empty");
  const [vaultBusy, setVaultBusy] = useState(false);
  const [endpointGranted, setEndpointGranted] = useState<boolean | null>(null);
  const [endpointBusy, setEndpointBusy] = useState(false);
  const [connectionState, setConnectionState] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [autofillPreferences, setAutofillPreferences] = useState<AutofillPreferences>(
    DEFAULT_AUTOFILL_PREFERENCES,
  );
  const [preferencesStatus, setPreferencesStatus] = useState<"idle" | "saved">("idle");
  const [dataBusy, setDataBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
      if (cancelled) return;
      const parsed = aiSettingsSchema.safeParse(stored[STORAGE_KEYS.settings]);
      if (parsed.success) setSettings(parsed.data);
      const preferences = await getAutofillPreferences();
      if (!cancelled) setAutofillPreferences(preferences);
      const storedKey = await hasStoredApiKey();
      if (!cancelled) setVaultState(getUnlockedApiKey() ? "unlocked" : storedKey ? "locked" : "empty");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = aiSettingsSchema.safeParse(settings);

    if (!parsed.success) {
      setStatus("error");
      setError(parsed.error.issues[0]?.message ?? "Invalid settings");
      return;
    }

    setStatus("saving");
    setError(null);

    try {
      await chrome.storage.local.set({
        [STORAGE_KEYS.settings]: parsed.data,
      });
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not save settings");
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const granted = await hasProviderPermission(settings);
      if (!cancelled) setEndpointGranted(granted);
    })();

    return () => {
      cancelled = true;
    };
  }, [settings.provider, settings.baseUrl]);

  async function handleGrantEndpoint() {
    setEndpointBusy(true);
    setError(null);
    try {
      const granted = await requestProviderPermission(settings);
      setEndpointGranted(granted);
      if (!granted) setError("Endpoint permission grant nahi hui.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not request permission");
    } finally {
      setEndpointBusy(false);
    }
  }

  async function handleConnectionTest() {
    setConnectionState("testing");
    setConnectionMessage(null);
    setError(null);
    try {
      const parsed = aiSettingsSchema.safeParse(settings);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid settings");
      const key = getUnlockedApiKey();
      if (!key) throw new Error("Vault locked hai. Pehle API key unlock karo.");
      if (!(await hasProviderPermission(parsed.data))) {
        throw new Error("Endpoint permission missing. Pehle Grant access karo.");
      }
      await testProviderConnection(parsed.data, key);
      setConnectionState("success");
      setConnectionMessage("Connection successful — provider reachable hai.");
    } catch (cause) {
      setConnectionState("error");
      setConnectionMessage(cause instanceof Error ? cause.message : "Connection test failed");
    }
  }

  async function handleSavePreferences() {
    if (autofillPreferences.reviewThreshold >= autofillPreferences.autoThreshold) {
      setError("Review threshold auto threshold se kam hona chahiye.");
      return;
    }
    await saveAutofillPreferences(autofillPreferences);
    setPreferencesStatus("saved");
    window.setTimeout(() => setPreferencesStatus("idle"), 1800);
  }

  async function handleExportAll() {
    setDataBusy(true);
    setError(null);
    try {
      const json = await exportAllLocalData();
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `JobPilot_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Data export failed");
    } finally {
      setDataBusy(false);
    }
  }

  async function handleDeleteAll() {
    if (!window.confirm("Delete ALL local profile, resume and application data? This cannot be undone.")) return;
    setDataBusy(true);
    setError(null);
    try {
      await deleteAllLocalData();
      await deleteStoredApiKey();
      setApiKey("");
      setPassphrase("");
      setVaultState("empty");
      setConnectionState("idle");
      setConnectionMessage(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete local data");
    } finally {
      setDataBusy(false);
    }
  }

  const isCompatibleProvider = settings.provider === "openai-compatible";

  async function handleVaultSave() {
    setVaultBusy(true);
    setError(null);
    try {
      await saveApiKey(passphrase, apiKey);
      setApiKey("");
      setPassphrase("");
      setVaultState("unlocked");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save API key");
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleUnlock() {
    setVaultBusy(true);
    setError(null);
    try {
      await unlockVault(passphrase);
      setPassphrase("");
      setVaultState("unlocked");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not unlock vault");
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleVaultLock() {
    setVaultBusy(true);
    setError(null);
    try {
      await lockVault();
      setVaultState("locked");
    } finally {
      setVaultBusy(false);
    }
  }

  async function handleVaultDelete() {
    setVaultBusy(true);
    setError(null);
    try {
      await deleteStoredApiKey();
      setApiKey("");
      setPassphrase("");
      setVaultState("empty");
    } finally {
      setVaultBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">AI Provider</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            BYOK — key sirf tumhare browser me rahegi, backend ko kabhi nahi jayegi.
          </p>
        </div>
        {status === "saved" ? <Badge tone="emerald">Saved</Badge> : null}
        {status === "error" ? <Badge tone="rose">Error</Badge> : null}
      </div>

      <Card className="space-y-3">
        <Field label="Provider">
          <select
            className={inputClass}
            value={settings.provider}
            onChange={(event) =>
              setSettings((previous) => ({
                ...previous,
                provider: event.target.value as AISettings["provider"],
              }))
            }
          >
            {AI_PROVIDERS.map((provider) => (
              <option key={provider} value={provider}>
                {AI_PROVIDER_LABELS[provider]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Model" hint="Provider ke docs se exact model id daalo.">
          <input
            className={inputClass}
            value={settings.model}
            onChange={(event) =>
              setSettings((previous) => ({ ...previous, model: event.target.value }))
            }
            placeholder="gemini-2.5-flash"
          />
        </Field>

        {isCompatibleProvider ? (
          <Field label="Base URL" hint="OpenAI-compatible endpoint, e.g. https://api.example.com/v1">
            <input
              className={inputClass}
              value={settings.baseUrl ?? ""}
              onChange={(event) =>
                setSettings((previous) => ({ ...previous, baseUrl: event.target.value }))
              }
              placeholder="https://api.example.com/v1"
            />
          </Field>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Temperature">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={settings.temperature}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  temperature: Number(event.target.value),
                }))
              }
            />
          </Field>
          <Field label="Max output tokens">
            <input
              className={inputClass}
              type="number"
              min={256}
              max={32768}
              step={256}
              value={settings.maxOutputTokens}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  maxOutputTokens: Number(event.target.value),
                }))
              }
            />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
          <div>
            <p className="text-xs font-medium text-slate-300">API endpoint access</p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              Direct browser-to-provider calls ke liye host permission.
            </p>
          </div>
          {endpointGranted === null ? (
            <Badge tone="slate">Checking...</Badge>
          ) : endpointGranted ? (
            <Badge tone="emerald">Granted</Badge>
          ) : (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleGrantEndpoint()}
              disabled={endpointBusy}
            >
              {endpointBusy ? "Requesting..." : "Grant access"}
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
          <div>
            <p className="text-xs font-medium text-slate-300">Connection test</p>
            <p className="mt-0.5 text-[10px] text-slate-500">
              API key se provider ka models endpoint check karega.
            </p>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleConnectionTest()}
            disabled={connectionState === "testing"}
          >
            {connectionState === "testing" ? "Testing..." : "Test connection"}
          </Button>
        </div>
        {connectionMessage ? (
          <p className={`rounded-xl border px-3 py-2 text-[11px] ${connectionState === "success" ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200" : "border-rose-400/20 bg-rose-500/10 text-rose-300"}`}>
            {connectionMessage}
          </p>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Autofill preferences</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">Scan/fill behavior customize karo.</p>
          </div>
          {preferencesStatus === "saved" ? <Badge tone="emerald">Saved</Badge> : null}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Auto-fill threshold" hint="Is score ke upar review nahi maangega.">
            <input
              className={inputClass}
              type="number"
              min={0.5}
              max={1}
              step={0.05}
              value={autofillPreferences.autoThreshold}
              onChange={(event) => setAutofillPreferences((previous) => ({ ...previous, autoThreshold: Number(event.target.value) }))}
            />
          </Field>
          <Field label="Review threshold" hint="Is score ke neeche field select nahi hogi.">
            <input
              className={inputClass}
              type="number"
              min={0.3}
              max={0.95}
              step={0.05}
              value={autofillPreferences.reviewThreshold}
              onChange={(event) => setAutofillPreferences((previous) => ({ ...previous, reviewThreshold: Number(event.target.value) }))}
            />
          </Field>
        </div>
        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
          Highlight matched fields
          <input
            type="checkbox"
            className="accent-indigo-500"
            checked={autofillPreferences.highlightMatches}
            onChange={(event) => setAutofillPreferences((previous) => ({ ...previous, highlightMatches: event.target.checked }))}
          />
        </label>
        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
          AI-assisted matching
          <input
            type="checkbox"
            className="accent-indigo-500"
            checked={autofillPreferences.aiMatching}
            onChange={(event) => setAutofillPreferences((previous) => ({ ...previous, aiMatching: event.target.checked }))}
          />
        </label>
        <p className="text-[10px] text-slate-500">AI matching opt-in setting save hoti hai; current matcher deterministic/local hai.</p>
        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={() => void handleSavePreferences()}>
            Save autofill preferences
          </Button>
        </div>
      </Card>

      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">API Key Vault</h3>
          <Badge
            tone={
              vaultState === "unlocked" ? "emerald" : vaultState === "locked" ? "amber" : "slate"
            }
          >
            {vaultState === "unlocked"
              ? "Unlocked"
              : vaultState === "locked"
                ? "Locked"
                : "Not set"}
          </Badge>
        </div>

        {vaultState === "locked" ? (
          <Field label="Vault passphrase" hint="Passphrase kabhi store nahi hoti.">
            <input
              className={inputClass}
              type="password"
              autoComplete="off"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              placeholder="••••••••"
            />
          </Field>
        ) : (
          <>
            <Field
              label="API key"
              hint="AES-GCM 256 + PBKDF2-SHA256 (600k). Key browser se bahar nahi jati."
            >
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="••••••••••••"
              />
            </Field>
            <Field
              label="Vault passphrase"
              hint="Minimum 10 characters. Ye passphrase store nahi hoti."
            >
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder="••••••••"
              />
            </Field>
          </>
        )}

        <div className="flex flex-wrap gap-2">
          {vaultState === "locked" ? (
            <Button
              type="button"
              onClick={() => void handleUnlock()}
              disabled={vaultBusy || passphrase.length === 0}
            >
              {vaultBusy ? "Unlocking..." : "Unlock vault"}
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void handleVaultSave()}
              disabled={vaultBusy || apiKey.trim().length === 0 || passphrase.length < 10}
            >
              {vaultBusy
                ? "Saving..."
                : vaultState === "unlocked"
                  ? "Replace encrypted key"
                  : "Save encrypted key"}
            </Button>
          )}

          {vaultState === "unlocked" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleVaultLock()}
              disabled={vaultBusy}
            >
              Lock now
            </Button>
          ) : null}

          {vaultState !== "empty" ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleVaultDelete()}
              disabled={vaultBusy}
            >
              Delete key
            </Button>
          ) : null}
        </div>

        <p className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200/80">
          Security note: key IndexedDB, logs ya backend me kabhi nahi jati. Sirf encrypted
          ciphertext chrome.storage.local me rehta hai; unlocked key memory me rehti hai aur 15
          minute inactivity ke baad auto-lock ho jati hai.
        </p>
      </Card>

      <Card className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Data control & privacy</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
            Profile, resumes, generated versions and applications browser ke IndexedDB me rehte hain.
            AI calls direct provider ko jaati hain; backend ko API key nahi milti. Cloud sync abhi disabled hai.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => void handleExportAll()} disabled={dataBusy}>
            Export all data
          </Button>
          <Button type="button" variant="danger" onClick={() => void handleDeleteAll()} disabled={dataBusy}>
            Delete all local data
          </Button>
        </div>
      </Card>

      {error ? (
        <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving..." : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
