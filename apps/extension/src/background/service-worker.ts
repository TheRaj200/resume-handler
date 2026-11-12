/**
 * MV3 service worker.
 *
 * Keep this file thin: message routing, tab/frame orchestration and permissions.
 * Long-running AI calls belong in the side panel (SW is terminated when idle).
 */

import { getSyncSettings, syncNow } from "../lib/sync-client";
import { STORAGE_KEYS } from "@jobpilot/shared";

let floatingWindowId: number | undefined;

async function openFloatingWindow(): Promise<void> {
  if (floatingWindowId !== undefined) {
    try {
      await chrome.windows.update(floatingWindowId, { focused: true });
      return;
    } catch {
      floatingWindowId = undefined;
    }
  }

  const window = await chrome.windows.create({
    url: chrome.runtime.getURL("float.html"),
    type: "popup",
    width: 540,
    height: 680,
    focused: true,
  });
  if (window?.id !== undefined) floatingWindowId = window.id;
}

const SYNC_ALARM = "jobpilot-cloud-sync";

async function scheduleSyncAlarm(): Promise<void> {
  await chrome.alarms.create(SYNC_ALARM, { delayInMinutes: 5, periodInMinutes: 5 });
}

async function runBackgroundSync(): Promise<void> {
  const settings = await getSyncSettings();
  if (!settings.enabled) return;
  try {
    await syncNow();
  } catch (error) {
    console.warn("[sync] periodic sync skipped:", error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void scheduleSyncAlarm();
});

chrome.action.onClicked.addListener((sourceTab) => {
  if (sourceTab.id && sourceTab.url && /^https?:/i.test(sourceTab.url)) {
    void chrome.storage.session.set({ [STORAGE_KEYS.floatingSourceTabId]: sourceTab.id });
  }
  void openFloatingWindow().catch((error) => {
    console.warn("[window] could not open floating JobPilot window:", error);
  });
});

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === floatingWindowId) floatingWindowId = undefined;
});

chrome.runtime.onStartup.addListener(() => {
  void scheduleSyncAlarm();
  void runBackgroundSync();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void runBackgroundSync();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message as { type: unknown }).type === "PING"
  ) {
    sendResponse({ ok: true, data: { pong: true } });
  }
});
