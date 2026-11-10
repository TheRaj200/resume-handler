/**
 * MV3 service worker.
 *
 * Keep this file thin: message routing, tab/frame orchestration and permissions.
 * Long-running AI calls belong in the side panel (SW is terminated when idle).
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => undefined);
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
