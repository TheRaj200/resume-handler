/**
 * Open JobPilot as a real floating, draggable, resizable desktop window.
 * Uses chrome.windows.create (type: "popup") which gives an OS-level window
 * that can be moved and resized freely.
 */
export async function openFloatingWindow(): Promise<void> {
  const url = chrome.runtime.getURL("float.html");
  await chrome.windows.create({
    url,
    type: "popup",
    width: 540,
    height: 680,
    focused: true,
  });
}
