import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const extensionPath = resolve("apps/extension/dist");
if (!existsSync(join(extensionPath, "manifest.json"))) {
  throw new Error("Extension build missing. Run: npm run build:extension");
}
const profileDir = mkdtempSync(join(tmpdir(), "jobpilot-smoke-"));
const resumePath = join(profileDir, "smoke-resume.pdf");
const screenshotDir = resolve("docs/screenshots");
mkdirSync(screenshotDir, { recursive: true });

const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const executablePath = edgeCandidates.find((candidate) => existsSync(candidate));

function deriveExtensionId(path) {
  const hash = createHash("sha256").update(path).digest("hex").slice(0, 32);
  return hash
    .split("")
    .map((character) => String.fromCharCode(97 + Number.parseInt(character, 16)))
    .join("");
}

function launch() {
  return chromium.launchPersistentContext(profileDir, {
    ...(executablePath ? { executablePath } : { channel: "msedge" }),
    headless: false,
    viewport: { width: 420, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });
}

writeFileSync(
  resumePath,
  Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  ),
);

let context = await launch();
let extensionId = "";

try {
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 20_000 });
  }

  extensionId = new URL(serviceWorker.url()).host || deriveExtensionId(extensionPath);
  console.log(`[smoke] extension loaded: ${extensionId}`);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForSelector("text=JobPilot AI", { timeout: 15_000 });
  console.log("[smoke] side panel rendered");

  await page.getByRole("button", { name: "My Info" }).click();
  await page.waitForSelector("text=Personal details");
  console.log("[smoke] profile editor rendered");

  await page.getByPlaceholder("Raj").fill("Smoke");
  await page.getByPlaceholder("Sharma").fill("Test");
  await page.getByPlaceholder("you@example.com").fill("smoke@example.com");
  await page.getByPlaceholder("+91 98765 43210").fill("9999999999");
  await page.getByRole("button", { name: "Save personal details" }).click();
  await page.waitForSelector("text=Saved", { timeout: 10_000 });
  await page.screenshot({
    path: join(screenshotDir, "phase1-profile.png"),
    fullPage: true,
  });
  console.log("[smoke] profile saved to IndexedDB");

  await page.getByRole("button", { name: "Experience" }).click();
  await page.getByRole("button", { name: "Add experience" }).click();
  await page.getByPlaceholder("Acme Corp").fill("Acme Corp");
  await page.getByPlaceholder("Software Engineer").fill("Software Engineer");
  await page.locator('input[type="month"]').first().fill("2024-01");
  await page.getByPlaceholder(/Built REST APIs/).fill("Built REST APIs");
  await page.getByRole("button", { name: "Save experience" }).click();
  await page.waitForSelector("text=Software Engineer");
  console.log("[smoke] experience saved");

  await page.getByRole("button", { name: "Skills" }).click();
  await page.getByPlaceholder("React").fill("React");
  await page.getByRole("button", { name: "Add skill" }).click();
  await page.waitForSelector("text=React");
  console.log("[smoke] skill saved");

  await page.getByRole("button", { name: "Custom" }).click();
  await page.getByRole("button", { name: "Add field" }).click();
  await page.getByPlaceholder("Visa status").fill("Visa status");
  await page.getByRole("button", { name: "Save field" }).click();
  await page.waitForSelector("text=Visa status");
  console.log("[smoke] custom field saved");

  await page.getByRole("button", { name: "Resumes" }).click();
  await page.waitForSelector("text=Resume library");
  await page.locator('input[type="file"]').first().setInputFiles(resumePath);
  await page.waitForSelector("text=smoke-resume", { timeout: 10_000 });
  await page.waitForSelector("text=Default", { timeout: 10_000 });
  await page.screenshot({
    path: join(screenshotDir, "phase1-resumes.png"),
    fullPage: true,
  });
  console.log("[smoke] resume uploaded to IndexedDB");

  await context.close();
  console.log("[smoke] browser closed; restarting with same profile");

  context = await launch();
  const restartedPage = await context.newPage();
  await restartedPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await restartedPage.getByRole("button", { name: "My Info" }).click();
  await restartedPage.waitForSelector("text=Personal details");
  assert.equal(await restartedPage.getByPlaceholder("Raj").inputValue(), "Smoke");
  assert.equal(
    await restartedPage.getByPlaceholder("you@example.com").inputValue(),
    "smoke@example.com",
  );
  console.log("[smoke] profile persisted after browser restart");

  await restartedPage.getByRole("button", { name: "Experience" }).click();
  await restartedPage.waitForSelector("text=Software Engineer");
  await restartedPage.getByRole("button", { name: "Skills" }).click();
  await restartedPage.waitForSelector("text=React");
  await restartedPage.getByRole("button", { name: "Custom" }).click();
  await restartedPage.waitForSelector("text=Visa status");
  console.log("[smoke] experience, skill and custom field persisted");

  await restartedPage.getByRole("button", { name: "Settings" }).click();
  await restartedPage.waitForSelector("text=Autofill preferences");
  await restartedPage.getByRole("button", { name: "Save autofill preferences" }).click();
  await restartedPage.waitForSelector("text=Saved");
  const backupDownloadPromise = restartedPage.waitForEvent("download");
  await restartedPage.getByRole("button", { name: "Export all data" }).click();
  const backupDownload = await backupDownloadPromise;
  assert.ok(backupDownload.suggestedFilename().endsWith(".json"));
  await restartedPage.getByRole("button", { name: "Test connection" }).click();
  await restartedPage.waitForSelector("text=Vault locked hai", { timeout: 5_000 });
  console.log("[smoke] settings preferences, backup export and connection error verified");

  await restartedPage.getByRole("button", { name: "Resumes" }).click();
  await restartedPage.waitForSelector("text=smoke-resume", { timeout: 10_000 });
  console.log("[smoke] resume persisted after browser restart");

  console.log("[smoke] PASS");
} finally {
  await context.close();
  rmSync(profileDir, { recursive: true, force: true });
}
