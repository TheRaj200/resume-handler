import type {
  FillPlan,
  FillResult,
  FormScanResult,
  MessageResponse,
  PageContext,
  PageContextResponse,
  ScanFormResponse,
} from "@jobpilot/shared";

export function isInjectableUrl(url?: string): boolean {
  return Boolean(url && /^https?:/i.test(url));
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const pendingInjections = new Map<number, Promise<void>>();

/**
 * Content script is injected on demand (activeTab) instead of declaring
 * broad host permissions in the manifest.
 */
export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "PING" });
    return;
  } catch {
    // Not injected yet — inject below.
  }

  if (pendingInjections.has(tabId)) {
    return pendingInjections.get(tabId);
  }

  const promise = (async () => {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
    } finally {
      pendingInjections.delete(tabId);
    }
  })();

  pendingInjections.set(tabId, promise);
  return promise;
}

export async function getPageContext(tabId: number): Promise<PageContext | null> {
  try {
    await ensureContentScript(tabId);
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "GET_PAGE_CONTEXT",
    })) as PageContextResponse;
    return response.ok ? (response.data ?? null) : null;
  } catch {
    return null;
  }
}

export async function scanForm(tabId: number): Promise<FormScanResult | null> {
  try {
    await ensureContentScript(tabId);
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "SCAN_FORM",
    })) as ScanFormResponse;
    return response.ok ? (response.data ?? null) : null;
  } catch {
    return null;
  }
}

export async function extractJd(tabId: number): Promise<string | null> {
  try {
    await ensureContentScript(tabId);
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "EXTRACT_JD",
    })) as MessageResponse<{ text: string }>;
    return response.ok ? (response.data?.text ?? null) : null;
  } catch {
    return null;
  }
}

export async function fillForm(
  tabId: number,
  plan: FillPlan,
): Promise<FillResult | null> {
  try {
    await ensureContentScript(tabId);
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "FILL_FORM",
      plan,
    })) as MessageResponse<FillResult>;
    return response.ok ? (response.data ?? null) : null;
  } catch {
    return null;
  }
}

export async function undoFill(tabId: number, sessionId: string): Promise<boolean> {
  try {
    await ensureContentScript(tabId);
    const response = (await chrome.tabs.sendMessage(tabId, {
      type: "UNDO_FILL",
      sessionId,
    })) as MessageResponse<{ undone: boolean }>;
    return response.ok && response.data?.undone === true;
  } catch {
    return false;
  }
}
