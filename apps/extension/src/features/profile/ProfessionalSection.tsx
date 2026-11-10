import { useEffect, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  WORK_MODES,
  profileInputSchema,
  type ProfileInput,
  type WorkMode,
} from "@jobpilot/shared";
import { getProfile, saveProfile } from "../../db";
import {
  emptyProfileInput,
  profileToInput,
  splitComma,
} from "../../lib/profile";
import { Badge, Button, Card, Field, inputClass } from "../../components/ui";

type LinkKey = "linkedin" | "github" | "portfolio" | "twitter";

export function ProfessionalSection() {
  const profile = useLiveQuery(() => getProfile(), []);
  const [form, setForm] = useState<ProfileInput>(emptyProfileInput);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) setForm(profileToInput(profile));
  }, [profile]);

  function update(field: "headline" | "summary", value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  function updateLink(field: LinkKey, value: string) {
    setForm((previous) => ({
      ...previous,
      links: { ...(previous.links ?? {}), [field]: value },
    }));
  }

  function updatePreference(
    field: "locations" | "workMode" | "expectedCtc" | "currency" | "noticePeriodDays",
    value: string | number | string[] | WorkMode | undefined,
  ) {
    setForm((previous) => ({
      ...previous,
      preferences: { ...(previous.preferences ?? {}), [field]: value },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const existing = await getProfile();
    const base = profileToInput(existing);

    const parsed = profileInputSchema.safeParse({
      ...base,
      headline: form.headline,
      summary: form.summary,
      links: form.links,
      preferences: form.preferences,
    });

    if (!parsed.success) {
      setStatus("error");
      setError(parsed.error.issues[0]?.message ?? "Invalid professional details");
      return;
    }

    setStatus("saving");
    setError(null);

    try {
      await saveProfile(parsed.data);
      setStatus("saved");
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Could not save details");
    }
  }

  const links = form.links ?? {};
  const preferences = form.preferences ?? {};

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Professional summary
          </h3>
          {status === "saved" ? <Badge tone="emerald">Saved</Badge> : null}
          {status === "error" ? <Badge tone="rose">Error</Badge> : null}
        </div>

        <Field label="Headline" hint="e.g. MERN Stack Developer · 2 years experience">
          <input
            className={inputClass}
            value={form.headline ?? ""}
            onChange={(event) => update("headline", event.target.value)}
            placeholder="MERN Stack Developer"
          />
        </Field>

        <Field label="Summary">
          <textarea
            className={`${inputClass} min-h-28 resize-y`}
            value={form.summary ?? ""}
            onChange={(event) => update("summary", event.target.value)}
            placeholder="Short professional summary..."
          />
        </Field>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Links
        </h3>

        <Field label="LinkedIn">
          <input
            className={inputClass}
            value={links.linkedin ?? ""}
            onChange={(event) => updateLink("linkedin", event.target.value)}
            placeholder="https://linkedin.com/in/..."
          />
        </Field>
        <Field label="GitHub">
          <input
            className={inputClass}
            value={links.github ?? ""}
            onChange={(event) => updateLink("github", event.target.value)}
            placeholder="https://github.com/..."
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Portfolio">
            <input
              className={inputClass}
              value={links.portfolio ?? ""}
              onChange={(event) => updateLink("portfolio", event.target.value)}
              placeholder="https://..."
            />
          </Field>
          <Field label="Twitter / X">
            <input
              className={inputClass}
              value={links.twitter ?? ""}
              onChange={(event) => updateLink("twitter", event.target.value)}
              placeholder="https://x.com/..."
            />
          </Field>
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Job preferences
        </h3>

        <Field label="Preferred locations" hint="Comma separated">
          <input
            className={inputClass}
            value={preferences.locations?.join(", ") ?? ""}
            onChange={(event) =>
              updatePreference("locations", splitComma(event.target.value))
            }
            placeholder="Mumbai, Pune, Remote"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Work mode">
            <select
              className={inputClass}
              value={preferences.workMode ?? "any"}
              onChange={(event) =>
                updatePreference("workMode", event.target.value as WorkMode)
              }
            >
              {WORK_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notice period (days)">
            <input
              className={inputClass}
              type="number"
              min={0}
              max={365}
              value={preferences.noticePeriodDays ?? ""}
              onChange={(event) =>
                updatePreference(
                  "noticePeriodDays",
                  event.target.value === "" ? undefined : Number(event.target.value),
                )
              }
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Expected CTC">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={preferences.expectedCtc ?? ""}
              onChange={(event) =>
                updatePreference(
                  "expectedCtc",
                  event.target.value === "" ? undefined : Number(event.target.value),
                )
              }
              placeholder="1200000"
            />
          </Field>
          <Field label="Currency">
            <input
              className={inputClass}
              value={preferences.currency ?? ""}
              onChange={(event) => updatePreference("currency", event.target.value)}
              placeholder="INR"
            />
          </Field>
        </div>
      </Card>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving..." : "Save professional details"}
        </Button>
      </div>
    </form>
  );
}
