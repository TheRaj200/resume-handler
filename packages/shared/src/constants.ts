/**
 * Shared constants and literal unions.
 * Keep this file dependency-free so it can be imported from any runtime.
 */

export const APPLICATION_STATUSES = [
  "DRAFT",
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
  "NO_RESPONSE",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const TERMINAL_STATUSES: readonly ApplicationStatus[] = [
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
  "NO_RESPONSE",
];

export const STATUS_LABELS: Record<ApplicationStatus, string> = {
  DRAFT: "Draft",
  APPLIED: "Applied",
  SCREENING: "Screening",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  NO_RESPONSE: "No response",
};

export const FIELD_TYPES = [
  "text",
  "textarea",
  "number",
  "date",
  "boolean",
  "select",
  "multiselect",
  "url",
  "email",
  "phone",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export const WORK_MODES = ["remote", "hybrid", "onsite", "any"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

export const AI_PROVIDERS = ["gemini", "openai", "inception", "openai-compatible"] as const;
export type AIProvider = (typeof AI_PROVIDERS)[number];

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  inception: "Inception Labs (Mercury)",
  "openai-compatible": "OpenAI-compatible",
};

/** Confidence >= this value is auto-filled. */
export const AUTOFILL_AUTO_THRESHOLD = 0.85;

/** Confidence between REVIEW and AUTO is filled but flagged for review. */
export const AUTOFILL_REVIEW_THRESHOLD = 0.6;

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export const DB_NAME = "JobPilotDB";
export const LOCAL_USER_ID = "local-user";
export const DEFAULT_PROFILE_ID = "primary";

export const STORAGE_KEYS = {
  settings: "jobpilot.settings",
  autofillPreferences: "jobpilot.autofill.preferences",
  syncSettings: "jobpilot.sync.settings",
  syncRefreshToken: "jobpilot.sync.refreshToken",
  syncAccessToken: "jobpilot.sync.accessToken",
  syncUser: "jobpilot.sync.user",
  resumeJobContext: "jobpilot.resume.jobContext",
  encryptedApiKey: "jobpilot.apiKey.encrypted",
  keySalt: "jobpilot.apiKey.salt",
  vaultSession: "jobpilot.apiKey.vaultSession",
  onboardingComplete: "jobpilot.onboarding.complete",
  lastSyncAt: "jobpilot.sync.lastAt",
  openTab: "jobpilot.openTab",
} as const;

export const SIDE_PANEL_PATHS = {
  dashboard: "sidepanel.html",
} as const;
