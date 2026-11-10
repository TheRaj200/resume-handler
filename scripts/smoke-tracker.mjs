import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const extensionPath = resolve("apps/extension/dist");
if (!existsSync(join(extensionPath, "manifest.json"))) {
  throw new Error("Extension build missing. Run: npm run build:extension");
}

const profileDir = mkdtempSync(join(tmpdir(), "jobpilot-tracker-"));
const screenshotDir = resolve("docs/screenshots");
mkdirSync(screenshotDir, { recursive: true });

const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = edgeCandidates.find((candidate) => existsSync(candidate));

const context = await chromium.launchPersistentContext(profileDir, {
  ...(executablePath ? { executablePath } : { channel: "msedge" }),
  headless: false,
  viewport: { width: 460, height: 1000 },
  acceptDownloads: true,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    "--no-first-run",
    "--no-default-browser-check",
  ],
});

try {
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 20_000 });
  }
  const extensionId = new URL(serviceWorker.url()).host;
  console.log(`[smoke] extension loaded: ${extensionId}`);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForSelector("text=JobPilot AI");

  // Navigate to Apps tab
  await page.getByRole("button", { name: "Apps" }).click();
  await page.waitForSelector("text=+ Add Application");
  console.log("[smoke] tracker tab opened");

  // Add manual application
  await page.getByRole("button", { name: "+ Add Application" }).click();
  await page.waitForSelector("text=Add Job Application");
  await page.getByPlaceholder("e.g. Google, Microsoft, Startup").fill("Google");
  await page.getByPlaceholder("e.g. Full Stack Developer").fill("Staff Software Engineer");
  await page.getByPlaceholder("https://...").fill("https://careers.google.com/jobs/123");
  await page.getByPlaceholder("Optional notes...").fill("Found via LinkedIn, high priority");
  await page.getByRole("button", { name: "Save" }).click();

  await page.waitForSelector("text=Google");
  await page.waitForSelector("text=Staff Software Engineer");
  console.log("[smoke] application created");

  // Change status to APPLIED
  await page.locator('select[aria-label="Change status"]').selectOption("APPLIED");
  await page.waitForSelector("text=Update Status: Google");
  await page.getByPlaceholder("e.g. Received email for technical interview, completed task...").fill("Applied on official career portal");
  await page.getByRole("button", { name: "Confirm Update" }).click();

  await page.waitForSelector("text=Applied: ");
  console.log("[smoke] application status updated to APPLIED");

  // View details and timeline
  await page.getByRole("button", { name: "View Details & History" }).click();
  await page.waitForSelector("text=Timeline History:");
  await page.waitForSelector("text=Applied on official career portal");
  console.log("[smoke] timeline history verified");

  // Test CSV export download
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith(".csv"));
  console.log(`[smoke] CSV exported: ${download.suggestedFilename()}`);

  // Test XLSX export download and ZIP container signature.
  const xlsxDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export XLSX" }).click();
  const xlsxDownload = await xlsxDownloadPromise;
  assert.ok(xlsxDownload.suggestedFilename().endsWith(".xlsx"));
  const xlsxPath = await xlsxDownload.path();
  assert.ok(xlsxPath, "XLSX download path missing");
  const xlsx = readFileSync(xlsxPath);
  assert.equal(xlsx.subarray(0, 2).toString(), "PK");
  console.log(`[smoke] XLSX exported: ${xlsxDownload.suggestedFilename()}`);

  await page.screenshot({
    path: join(screenshotDir, "phase4-tracker.png"),
    fullPage: true,
  });

  console.log("[smoke] TRACKER PASS");
} finally {
  await context.close();
  rmSync(profileDir, { recursive: true, force: true });
}
