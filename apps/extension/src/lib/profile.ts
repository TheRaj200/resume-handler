import type { Profile, ProfileInput } from "@jobpilot/shared";

export const emptyProfileInput: ProfileInput = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dob: "",
  gender: "",
  headline: "",
  summary: "",
  address: {},
  links: {},
  preferences: {},
};

export function profileToInput(profile?: Profile): ProfileInput {
  return {
    firstName: profile?.firstName ?? "",
    lastName: profile?.lastName ?? "",
    email: profile?.email ?? "",
    phone: profile?.phone ?? "",
    dob: profile?.dob ?? "",
    gender: profile?.gender ?? "",
    headline: profile?.headline ?? "",
    summary: profile?.summary ?? "",
    address: profile?.address ?? {},
    links: profile?.links ?? {},
    preferences: profile?.preferences ?? {},
  };
}

export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function splitComma(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
