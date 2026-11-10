import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import http from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const sourceExtension = resolve("apps/extension/dist");
if (!existsSync(join(sourceExtension, "manifest.json"))) {
  throw new Error("Extension build missing. Run: npm run build:extension");
}

const profileDir = mkdtempSync(join(tmpdir(), "jobpilot-autofill-"));
const extensionPath = join(profileDir, "extension");
const resumePath = join(profileDir, "smoke-resume.pdf");
const screenshotDir = resolve("docs/screenshots");
cpSync(sourceExtension, extensionPath, { recursive: true });

const manifestPath = join(extensionPath, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.host_permissions = [
  ...(manifest.host_permissions ?? []),
  "http://127.0.0.1/*",
  "http://localhost/*",
];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

writeFileSync(
  resumePath,
  Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
  ),
);

const fixtureHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Autofill Fixture</title></head>
  <body>
    <form id="job-form">
      <p><label>First Name <input name="firstName" /></label></p>
      <p><label>Last Name <input name="lastName" /></label></p>
      <p><label>Email <input name="email" type="email" autocomplete="email" /></label></p>
      <p><label>Phone <input name="phone" type="tel" /></label></p>
      <p><label>Address <input name="address" /></label></p>
      <p><label>Current Company <input name="company" /></label></p>
      <p><label>Current Designation <input name="designation" /></label></p>
      <p><label>Date of Birth <input name="dob" type="date" /></label></p>
      <p><label>Birth Date <input name="birthDate" placeholder="DD/MM/YYYY" /></label></p>
      <p><label>Gender <select name="gender"><option value="">Select</option><option>Male</option><option>Female</option></select></label></p>
      <p><label>Skills <textarea name="skills"></textarea></label></p>
      <p><label>Resume <input type="file" name="resume" /></label></p>
      <p><label><input type="checkbox" name="consent" /> I agree to the terms and conditions</label></p>
      <input type="hidden" name="hiddenField" />
      <input type="password" name="password" />
      <button type="submit">Submit</button>
      <iframe id="frame" src="/frame.html"></iframe>
    </form>
  </body>
</html>`;

const frameHtml = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Iframe Fixture</title></head>
  <body>
    <label>Iframe Email <input name="iframeEmail" /></label>
  </body>
</html>`;

const server = http.createServer((request, response) => {
  if (request.url === "/fixture.html") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(fixtureHtml);
    return;
  }
  if (request.url === "/frame.html") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(frameHtml);
    return;
  }
  response.writeHead(404);
  response.end("not found");
});

await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
const port = server.address().port;
const fixtureUrl = `http://127.0.0.1:${port}/fixture.html`;

const edgeCandidates = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);
const executablePath = edgeCandidates.find((candidate) => existsSync(candidate));

const context = await chromium.launchPersistentContext(profileDir, {
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

function clickButton(page, text) {
  return page.evaluate((label) => {
    const button = [...document.querySelectorAll("button")].find((element) =>
      element.textContent?.includes(label),
    );
    button?.click();
    return Boolean(button);
  }, text);
}

try {
  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker", { timeout: 20_000 });
  }
  const extensionId = new URL(serviceWorker.url()).host;
  console.log(`[smoke] extension loaded: ${extensionId}`);

  const sidepanel = await context.newPage();
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await sidepanel.waitForSelector("text=JobPilot AI");

  // Seed profile data through the real UI.
  await sidepanel.getByRole("button", { name: "My Info" }).click();
  await sidepanel.waitForSelector("text=Personal details");
  await sidepanel.getByPlaceholder("Raj").fill("Smoke");
  await sidepanel.getByPlaceholder("Sharma").fill("Test");
  await sidepanel.getByPlaceholder("you@example.com").fill("smoke@example.com");
  await sidepanel.getByPlaceholder("+91 98765 43210").fill("9999999999");
  await sidepanel.getByLabel("Date of birth").fill("1998-04-12");
  await sidepanel.getByLabel("Gender").selectOption("Male");
  await sidepanel.getByRole("button", { name: "Save personal details" }).click();
  await sidepanel.waitForSelector("text=Saved");

  await sidepanel.getByRole("button", { name: "Experience" }).click();
  await sidepanel.getByRole("button", { name: "Add experience" }).click();
  await sidepanel.getByPlaceholder("Acme Corp").fill("Acme Corp");
  await sidepanel.getByPlaceholder("Software Engineer").fill("Software Engineer");
  await sidepanel.getByRole("button", { name: "Save experience" }).click();
  await sidepanel.waitForSelector("text=Software Engineer");

  await sidepanel.getByRole("button", { name: "Skills" }).click();
  await sidepanel.getByPlaceholder("React").fill("React");
  await sidepanel.getByRole("button", { name: "Add skill" }).click();
  await sidepanel.waitForSelector("text=React");

  await sidepanel.getByRole("button", { name: "Resumes" }).click();
  await sidepanel.waitForSelector("text=Resume library");
  await sidepanel.locator('input[type="file"]').first().setInputFiles(resumePath);
  await sidepanel.waitForSelector("text=smoke-resume");
  await sidepanel.waitForSelector("text=Default");

  await sidepanel.getByRole("button", { name: "Dashboard" }).click();
  await sidepanel.waitForSelector("text=Autofill");

  // Open the fixture and keep it active, then run the side panel in the background.
  const fixture = await context.newPage();
  await fixture.goto(fixtureUrl);
  await fixture.waitForSelector('input[name="firstName"]');
  await fixture.frameLocator("#frame").locator('input[name="iframeEmail"]').waitFor();
  await fixture.bringToFront();

  assert.equal(await clickButton(sidepanel, "Scan page"), true);
  await sidepanel.waitForSelector("text=matched", { timeout: 15_000 });
  console.log("[smoke] form scanned");

  assert.equal(await clickButton(sidepanel, "Fill selected"), true);
  await sidepanel.waitForSelector("text=Fill report", { timeout: 15_000 });
  console.log("[smoke] fill executed");

  assert.equal(await fixture.inputValue('input[name="firstName"]'), "Smoke");
  assert.equal(await fixture.inputValue('input[name="lastName"]'), "Test");
  assert.equal(await fixture.inputValue('input[name="email"]'), "smoke@example.com");
  assert.equal(await fixture.inputValue('input[name="phone"]'), "9999999999");
  assert.equal(await fixture.inputValue('input[name="company"]'), "Acme Corp");
  assert.equal(await fixture.inputValue('input[name="designation"]'), "Software Engineer");
  assert.equal(await fixture.inputValue('input[name="dob"]'), "1998-04-12");
  assert.equal(await fixture.inputValue('input[name="birthDate"]'), "12/04/1998");
  assert.equal(await fixture.inputValue('select[name="gender"]'), "Male");
  assert.equal(await fixture.inputValue('textarea[name="skills"]'), "React");
  assert.equal(
    await fixture.frameLocator("#frame").locator('input[name="iframeEmail"]').inputValue(),
    "smoke@example.com",
  );
  assert.equal(await fixture.isChecked('input[name="consent"]'), false);
  assert.equal(await fixture.inputValue('input[name="password"]'), "");
  assert.equal(
    await fixture.evaluate(() => document.querySelector('input[name="hiddenField"]')?.value ?? ""),
    "",
  );
  assert.equal(
    await fixture.evaluate(() => document.querySelector('input[name="resume"]')?.files?.length ?? 0),
    1,
  );
  assert.equal(fixture.url(), fixtureUrl);
  console.log("[smoke] filled values verified");

  await fixture.screenshot({
    path: join(screenshotDir, "phase2-autofill.png"),
    fullPage: true,
  });

  assert.equal(await clickButton(sidepanel, "Undo fill"), true);
  await sidepanel.waitForSelector("text=Fill undo ho gaya", { timeout: 10_000 });
  assert.equal(await fixture.inputValue('input[name="firstName"]'), "");
  assert.equal(await fixture.inputValue('input[name="email"]'), "");
  assert.equal(await fixture.inputValue('input[name="company"]'), "");
  assert.equal(await fixture.inputValue('input[name="dob"]'), "");
  assert.equal(await fixture.inputValue('input[name="birthDate"]'), "");
  assert.equal(
    await fixture.frameLocator("#frame").locator('input[name="iframeEmail"]').inputValue(),
    "",
  );
  assert.equal(
    await fixture.evaluate(() => document.querySelector('input[name="resume"]')?.files?.length ?? 0),
    0,
  );
  console.log("[smoke] undo verified");

  console.log("[smoke] PASS");
} finally {
  await context.close();
  await new Promise((resolvePromise) => server.close(resolvePromise));
  rmSync(profileDir, { recursive: true, force: true });
}
