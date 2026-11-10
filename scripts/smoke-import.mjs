import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const extensionPath = resolve("apps/extension/dist");
if (!existsSync(join(extensionPath, "manifest.json"))) {
  throw new Error("Extension build missing. Run: npm run build:extension");
}

const profileDir = mkdtempSync(join(tmpdir(), "jobpilot-import-"));
const workDir = mkdtempSync(join(tmpdir(), "jobpilot-import-pdf-"));
const screenshotDir = resolve("docs/screenshots");
mkdirSync(screenshotDir, { recursive: true });

const resumeLines = [
  "RAJ IMPORT",
  "Bengaluru, India",
  "raj.import@example.com | +91 98765 43210",
  "linkedin.com/in/rajimport | github.com/rajimport",
  "",
  "SUMMARY",
  "Full-stack engineer with 5 years of experience building web products.",
  "",
  "EXPERIENCE",
  "Senior Engineer | Acme Technologies",
  "Jan 2021 - Present",
  "- Built React dashboards used by internal teams.",
  "- Led the REST to GraphQL migration.",
  "",
  "Software Engineer | Beta Solutions",
  "Jun 2018 - Dec 2020",
  "- Built Node.js APIs for payments.",
  "",
  "EDUCATION",
  "B.Tech in Computer Science",
  "National Institute of Technology",
  "2014 - 2018",
  "CGPA: 8.5",
  "",
  "SKILLS",
  "Languages: JavaScript, TypeScript, Python",
  "Frameworks: React, Node.js",
  "",
  "PROJECTS",
  "JobPilot AI",
  "Chrome extension for job applications.",
  "Tech: React, TypeScript, Dexie",
];

async function createResumePdf(path) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let y = 800;

  for (const line of resumeLines) {
    if (line) {
      page.drawText(line, { x: 50, y, size: 9, font, color: rgb(0.1, 0.1, 0.1) });
    }
    y -= 13;
  }

  writeFileSync(path, await pdf.save());
}

const resumePath = join(workDir, "raj-import-resume.pdf");
await createResumePdf(resumePath);

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

  await page.getByRole("button", { name: "Resumes" }).click();
  await page.waitForSelector("text=Resume library");

  await page.locator('input[type="file"]').first().setInputFiles(resumePath);
  await page.waitForSelector("text=Import resume → profile", { timeout: 30_000 });
  await page.waitForSelector("text=Contact & links", { timeout: 30_000 });
  console.log("[smoke] PDF text extracted and import review opened");

  const emailValue = await page.getByLabel("Email").inputValue();
  assert.equal(emailValue, "raj.import@example.com");

  const firstNameValue = await page.getByLabel("First name").inputValue();
  assert.equal(firstNameValue, "RAJ");

  await page.waitForSelector("text=Experience (2)", { timeout: 10_000 });
  await page.waitForSelector("text=Education (1)", { timeout: 10_000 });
  await page.waitForSelector("text=Projects (1)", { timeout: 10_000 });
  console.log("[smoke] parsed contact, experience, education and projects");

  await page.getByRole("button", { name: "Approve & import" }).click();
  await page.waitForSelector("text=Profile import ho gaya", { timeout: 15_000 });
  console.log("[smoke] import approved");

  await page.getByRole("button", { name: "My Info" }).click();
  await page.waitForSelector("text=Personal details");

  const savedEmail = await page.getByPlaceholder("you@example.com").inputValue();
  assert.equal(savedEmail, "raj.import@example.com");

  await page.getByRole("button", { name: "Experience" }).click();
  await page.waitForSelector("text=Acme Technologies", { timeout: 10_000 });
  await page.waitForSelector("text=Beta Solutions", { timeout: 10_000 });

  await page.getByRole("button", { name: "Skills" }).click();
  await page.waitForSelector("text=JavaScript", { timeout: 10_000 });
  console.log("[smoke] imported profile facts visible in My Info");

  await page.getByRole("button", { name: "Studio" }).click();
  await page.waitForSelector("text=Resume Studio");
  await page.getByLabel("Tailor source").selectOption("resume");
  await page.getByLabel("Quick resume file").selectOption({ index: 1 });
  await page.getByPlaceholder("Frontend Developer").fill("Frontend Engineer");
  await page
    .getByPlaceholder(/Job description paste karo/)
    .fill(
      "Senior Frontend Engineer. Required: React, TypeScript, Node.js, GraphQL. Build accessible interfaces.",
    );
  await page.getByRole("button", { name: "Analyze JD" }).click();
  await page.waitForSelector("text=Keywords:", { timeout: 15_000 });
  await page.getByRole("button", { name: "Generate draft" }).click();
  await page.waitForSelector("text=Fact-lock passed", { timeout: 20_000 });
  await page.waitForSelector("text=Quick source active", { timeout: 10_000 });
  console.log("[smoke] quick tailor generated from uploaded resume");

  await page.screenshot({
    path: join(screenshotDir, "phase3-resume-import.png"),
    fullPage: true,
  });
  console.log("[smoke] IMPORT PASS");
} finally {
  await context.close();
  rmSync(profileDir, { recursive: true, force: true });
  rmSync(workDir, { recursive: true, force: true });
}
