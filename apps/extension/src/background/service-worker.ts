/**
 * MV3 service worker.
 *
 * Keep this file thin: message routing, tab/frame orchestration and permissions.
 * Long-running AI calls belong in the side panel (SW is terminated when idle).
 */

import { getSyncSettings, syncNow } from "../lib/sync-client";

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
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => undefined);
  void scheduleSyncAlarm();
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
