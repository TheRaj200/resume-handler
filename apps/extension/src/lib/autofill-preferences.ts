import {
  AUTOFILL_AUTO_THRESHOLD,
  AUTOFILL_REVIEW_THRESHOLD,
  STORAGE_KEYS,
} from "@jobpilot/shared";

export interface AutofillPreferences {
  autoThreshold: number;
  reviewThreshold: number;
  highlightMatches: boolean;
  aiMatching: boolean;
}

export const DEFAULT_AUTOFILL_PREFERENCES: AutofillPreferences = {
  autoThreshold: AUTOFILL_AUTO_THRESHOLD,
  reviewThreshold: AUTOFILL_REVIEW_THRESHOLD,
  highlightMatches: true,
  aiMatching: false,
};

export async function getAutofillPreferences(): Promise<AutofillPreferences> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.autofillPreferences);
  const value = stored[STORAGE_KEYS.autofillPreferences] as Partial<AutofillPreferences> | undefined;
  const autoThreshold = Number(value?.autoThreshold);
  const reviewThreshold = Number(value?.reviewThreshold);
  return {
    autoThreshold: Number.isFinite(autoThreshold) ? Math.min(1, Math.max(0.5, autoThreshold)) : DEFAULT_AUTOFILL_PREFERENCES.autoThreshold,
    reviewThreshold: Number.isFinite(reviewThreshold) ? Math.min(0.95, Math.max(0.3, reviewThreshold)) : DEFAULT_AUTOFILL_PREFERENCES.reviewThreshold,
    highlightMatches: value?.highlightMatches ?? DEFAULT_AUTOFILL_PREFERENCES.highlightMatches,
    aiMatching: value?.aiMatching ?? DEFAULT_AUTOFILL_PREFERENCES.aiMatching,
  };
}

export async function saveAutofillPreferences(
  preferences: AutofillPreferences,
): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.autofillPreferences]: preferences,
  });
}
