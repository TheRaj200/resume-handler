import type {
  FillPlan,
  FillResult,
  FormScanResult,
  MessageResponse,
  PageContext,
  PageContextResponse,
  ScanFormResponse,
} from "@jobpilot/shared";
import { STORAGE_KEYS } from "@jobpilot/shared";

export function isInjectableUrl(url?: string): boolean {
  return Boolean(url && /^https?:/i.test(url));
}

export async function requestPagePermission(url?: string): Promise<boolean> {
  if (!isInjectableUrl(url)) return false;
  const pageUrl = new URL(url as string);
  const origin = `${pageUrl.protocol}//${pageUrl.host}/*`;
  try {
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

export async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.url && isInjectableUrl(tab.url)) return tab;

  // A floating JobPilot window becomes the focused window. In that case the
  // active tab is float.html, so fall back to the page from which it opened.
  const stored = await chrome.storage.session.get(STORAGE_KEYS.floatingSourceTabId);
  const sourceTabId = stored[STORAGE_KEYS.floatingSourceTabId];
  if (typeof sourceTabId === "number") {
    try {
      const sourceTab = await chrome.tabs.get(sourceTabId);
      if (sourceTab.url && isInjectableUrl(sourceTab.url)) return sourceTab;
    } catch {
      await chrome.storage.session.remove(STORAGE_KEYS.floatingSourceTabId);
    }
  }

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
