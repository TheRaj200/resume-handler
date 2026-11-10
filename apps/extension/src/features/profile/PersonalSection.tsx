import { useEffect, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { profileInputSchema, type ProfileInput } from "@jobpilot/shared";
import { getProfile, saveProfile } from "../../db";
import { emptyProfileInput, profileToInput } from "../../lib/profile";
import { Badge, Button, Card, Field, inputClass } from "../../components/ui";

type TextField = "firstName" | "lastName" | "email" | "phone" | "dob" | "gender";

export function PersonalSection() {
  const profile = useLiveQuery(() => getProfile(), []);
  const [form, setForm] = useState<ProfileInput>(emptyProfileInput);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) setForm(profileToInput(profile));
  }, [profile]);

  function update(field: TextField, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
  }

  function updateAddress(
    field: keyof NonNullable<ProfileInput["address"]>,
    value: string,
  ) {
    setForm((previous) => ({
      ...previous,
      address: { ...(previous.address ?? {}), [field]: value },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const existing = await getProfile();
    const base = profileToInput(existing);

    const parsed = profileInputSchema.safeParse({
      ...base,
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      phone: form.phone,
      dob: form.dob,
      gender: form.gender,
      address: form.address,
    });

    if (!parsed.success) {
      setStatus("error");
      setError(parsed.error.issues[0]?.message ?? "Invalid personal details");
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

  const address = form.address ?? {};

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Personal details
          </h3>
          {status === "saved" ? <Badge tone="emerald">Saved</Badge> : null}
          {status === "error" ? <Badge tone="rose">Error</Badge> : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="First name">
            <input
              className={inputClass}
              value={form.firstName ?? ""}
              onChange={(event) => update("firstName", event.target.value)}
              placeholder="Raj"
              autoComplete="given-name"
            />
          </Field>
          <Field label="Last name">
            <input
              className={inputClass}
              value={form.lastName ?? ""}
              onChange={(event) => update("lastName", event.target.value)}
              placeholder="Sharma"
              autoComplete="family-name"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              value={form.email ?? ""}
              onChange={(event) => update("email", event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </Field>
          <Field label="Phone">
            <input
              className={inputClass}
              type="tel"
              value={form.phone ?? ""}
              onChange={(event) => update("phone", event.target.value)}
              placeholder="+91 98765 43210"
              autoComplete="tel"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date of birth">
            <input
              className={inputClass}
              type="date"
              value={form.dob ?? ""}
              onChange={(event) => update("dob", event.target.value)}
            />
          </Field>
          <Field label="Gender">
            <select
              className={inputClass}
              value={form.gender ?? ""}
              onChange={(event) => update("gender", event.target.value)}
            >
              <option value="">Prefer not to say</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Non-binary">Non-binary</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
          Address
        </h3>

        <Field label="Address line 1">
          <input
            className={inputClass}
            value={address.line1 ?? ""}
            onChange={(event) => updateAddress("line1", event.target.value)}
            placeholder="Flat / street"
            autoComplete="address-line1"
          />
        </Field>
        <Field label="Address line 2">
          <input
            className={inputClass}
            value={address.line2 ?? ""}
            onChange={(event) => updateAddress("line2", event.target.value)}
            placeholder="Area / landmark"
            autoComplete="address-line2"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="City">
            <input
              className={inputClass}
              value={address.city ?? ""}
              onChange={(event) => updateAddress("city", event.target.value)}
              placeholder="Mumbai"
              autoComplete="address-level2"
            />
          </Field>
          <Field label="State">
            <input
              className={inputClass}
              value={address.state ?? ""}
              onChange={(event) => updateAddress("state", event.target.value)}
              placeholder="Maharashtra"
              autoComplete="address-level1"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="ZIP / PIN">
            <input
              className={inputClass}
              value={address.zip ?? ""}
              onChange={(event) => updateAddress("zip", event.target.value)}
              placeholder="400001"
              autoComplete="postal-code"
            />
          </Field>
          <Field label="Country">
            <input
              className={inputClass}
              value={address.country ?? ""}
              onChange={(event) => updateAddress("country", event.target.value)}
              placeholder="India"
              autoComplete="country-name"
            />
          </Field>
        </div>
      </Card>

      {error ? (
        <p className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={status === "saving"}>
          {status === "saving" ? "Saving..." : "Save personal details"}
        </Button>
      </div>
    </form>
  );
}
