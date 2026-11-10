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

const profileDir = mkdtempSync(join(tmpdir(), "jobpilot-studio-"));
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

  // Seed verified profile facts through the real UI.
  await page.getByRole("button", { name: "My Info" }).click();
  await page.waitForSelector("text=Personal details");
  await page.getByPlaceholder("Raj").fill("Smoke");
  await page.getByPlaceholder("Sharma").fill("Test");
  await page.getByPlaceholder("you@example.com").fill("smoke@example.com");
  await page.getByPlaceholder("+91 98765 43210").fill("9999999999");
  await page.getByRole("button", { name: "Save personal details" }).click();
  await page.waitForSelector("text=Saved");

  await page.getByRole("button", { name: "Experience" }).click();
  await page.getByRole("button", { name: "Add experience" }).click();
  await page.getByPlaceholder("Acme Corp").fill("Acme Corp");
  await page.getByPlaceholder("Software Engineer").fill("Software Engineer");
  await page
    .getByPlaceholder(/Built REST APIs/)
    .fill("Built React dashboards with TypeScript for internal teams.");
  await page.getByRole("button", { name: "Save experience" }).click();
  await page.waitForSelector("text=Software Engineer");

  await page.getByRole("button", { name: "Skills" }).click();
  await page.getByPlaceholder("React").fill("React");
  await page.getByRole("button", { name: "Add skill" }).click();
  await page.waitForSelector("text=React");
  await page.getByPlaceholder("React").fill("TypeScript");
  await page.getByRole("button", { name: "Add skill" }).click();
  await page.waitForSelector("text=TypeScript");

  await page.getByRole("button", { name: "Studio" }).click();
  await page.waitForSelector("text=Resume Studio");

  const aiOptionDisabled = await page
    .locator('select')
    .last()
    .locator('option[value="ai"]')
    .isDisabled();
  assert.equal(aiOptionDisabled, true, "AI mode should be disabled without an unlocked vault");
  console.log("[smoke] AI mode correctly locked without BYOK vault");

  await page.getByPlaceholder("Frontend Developer").fill("Frontend Engineer");
  await page.getByPlaceholder("Acme Corp").fill("Acme Corp");
  await page
    .getByPlaceholder(/Job description paste karo/)
    .fill(
      "Senior Frontend Engineer. Required: React, TypeScript, Node.js, GraphQL, AWS. Build accessible React interfaces and improve performance.",
    );

  await page.getByRole("button", { name: "Analyze JD" }).click();
  await page.waitForSelector("text=Keywords:", { timeout: 15_000 });
  await page.waitForSelector("text=Suggested, not added:");
  console.log("[smoke] JD analyzed with missing-skill suggestions");

  await page.getByRole("button", { name: "Generate draft" }).click();
  await page.waitForSelector("text=Fact-lock passed", { timeout: 20_000 });
  await page.waitForSelector("text=v1", { timeout: 15_000 });
  console.log("[smoke] local fact-locked draft generated and saved as v1");

  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 });
  await page.getByRole("button", { name: "Download PDF" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  assert.ok(downloadPath, "PDF download path missing");
  const pdf = readFileSync(downloadPath);
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(pdf.length > 1000, `PDF too small: ${pdf.length} bytes`);
  assert.match(download.suggestedFilename(), /\.pdf$/);
  console.log(`[smoke] PDF exported: ${download.suggestedFilename()} (${pdf.length} bytes)`);

  await page.getByLabel("Summary").fill(
    "Frontend engineer focused on accessible, fast React applications.",
  );
  await page.getByRole("button", { name: "Save new version" }).click();
  await page.waitForSelector("text=v2", { timeout: 15_000 });
  console.log("[smoke] edited resume saved as v2");

  await page.screenshot({
    path: join(screenshotDir, "phase3-studio.png"),
    fullPage: true,
  });
  console.log("[smoke] STUDIO PASS");
} finally {
  await context.close();
  rmSync(profileDir, { recursive: true, force: true });
}
