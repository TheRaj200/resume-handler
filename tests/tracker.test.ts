import assert from "node:assert/strict";
import { normalizeJobUrl } from "../apps/backend/src/services/application.service";
import type { Application, ApplicationEvent, ApplicationInput } from "@jobpilot/shared";

console.log("Running tracker tests...");

// 1. Test normalizeJobUrl
const raw1 = "https://jobs.example.com/careers/software-engineer/?utm_source=linkedin&utm_medium=feed&ref=123";
const norm1 = normalizeJobUrl(raw1);
assert.equal(norm1, "https://jobs.example.com/careers/software-engineer");

const raw2 = "HTTPS://WWW.EXAMPLE.COM/JOB/123/?utm_campaign=winter#section";
const norm2 = normalizeJobUrl(raw2);
assert.equal(norm2, "https://www.example.com/job/123");

assert.equal(normalizeJobUrl(""), undefined);
assert.equal(normalizeJobUrl(undefined), undefined);

// 2. Test in-memory Application simulation matching DB / Service logic
const applications: Application[] = [];

function mockSaveApplication(input: ApplicationInput, id?: string): Application {
  const timestamp = new Date().toISOString();
  const existing = id ? applications.find((a) => a.id === id) : undefined;
  const normalizedUrl = input.normalizedUrl || normalizeJobUrl(input.jobUrl);

  const status = input.status || existing?.status || "DRAFT";
  const appliedAt =
    input.appliedAt ||
    existing?.appliedAt ||
    (status === "APPLIED" ? timestamp : undefined);

  const events: ApplicationEvent[] = existing?.events ? [...existing.events] : [];
  if (!existing) {
    events.push({
      status,
      note: input.notes?.trim() || "Application created",
      at: timestamp,
    });
  } else if (existing.status !== status) {
    events.push({
      status,
      note: input.notes?.trim() || `Status updated to ${status}`,
      at: timestamp,
    });
  }

  const record: Application = {
    ...(existing ?? ({} as Application)),
    ...input,
    id: id ?? existing?.id ?? crypto.randomUUID(),
    userId: "local-user",
    company: input.company.trim(),
    jobTitle: input.jobTitle.trim(),
    jobUrl: input.jobUrl?.trim() || undefined,
    normalizedUrl,
    jdSnapshot: input.jdSnapshot || existing?.jdSnapshot,
    status,
    appliedAt,
    source: input.source || existing?.source,
    notes: input.notes !== undefined ? input.notes : existing?.notes,
    resumeVersionId: input.resumeVersionId || existing?.resumeVersionId,
    events,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: (existing?.version ?? 0) + 1,
    syncStatus: "pending",
  };

  if (existing) {
    const idx = applications.findIndex((a) => a.id === id);
    applications[idx] = record;
  } else {
    applications.push(record);
  }
  return record;
}

function mockFindDuplicate(jobUrl?: string, company?: string, jobTitle?: string): Application | undefined {
  const normalized = normalizeJobUrl(jobUrl);
  if (normalized) {
    const match = applications.find((a) => !a.deletedAt && a.normalizedUrl === normalized);
    if (match) return match;
  }

  if (company?.trim()) {
    const cClean = company.trim().toLowerCase();
    const tClean = jobTitle?.trim().toLowerCase();
    return applications.find((a) => {
      if (a.deletedAt) return false;
      const cMatch = a.company.toLowerCase() === cClean;
      if (!cMatch) return false;
      if (tClean && a.jobTitle) {
        return a.jobTitle.toLowerCase() === tClean;
      }
      return true;
    });
  }

  return undefined;
}

function mockUpdateStatus(id: string, status: Application["status"], note?: string): Application | undefined {
  const app = applications.find((a) => a.id === id);
  if (!app) return undefined;

  const timestamp = new Date().toISOString();
  app.events.push({
    status,
    note: note || `Status changed to ${status}`,
    at: timestamp,
  });

  app.status = status;
  if (status === "APPLIED" && !app.appliedAt) {
    app.appliedAt = timestamp;
  }
  app.updatedAt = timestamp;
  app.version += 1;
  return app;
}

function mockExportCsv(): string {
  const active = applications.filter((a) => !a.deletedAt);
  const headers = ["Company", "Job Title", "Status", "Applied At", "Job URL"];
  const rows = active.map((app) => [
    `"${app.company.replace(/"/g, '""')}"`,
    `"${app.jobTitle.replace(/"/g, '""')}"`,
    `"${app.status}"`,
    `"${app.appliedAt ?? ""}"`,
    `"${app.jobUrl ?? ""}"`,
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

// Test 2: Create application as DRAFT
const app1 = mockSaveApplication({
  company: "Stripe",
  jobTitle: "Staff Frontend Engineer",
  jobUrl: "https://stripe.com/jobs/123?utm_source=hn",
  status: "DRAFT",
});

assert.equal(app1.company, "Stripe");
assert.equal(app1.status, "DRAFT");
assert.equal(app1.appliedAt, undefined);
assert.equal(app1.events.length, 1);
assert.equal(app1.events[0]?.status, "DRAFT");
assert.equal(app1.normalizedUrl, "https://stripe.com/jobs/123");

// Test 3: Duplicate detection by URL
const dupByUrl = mockFindDuplicate("https://stripe.com/jobs/123?utm_medium=twitter");
assert.ok(dupByUrl);
assert.equal(dupByUrl?.id, app1.id);

// Test 4: Duplicate detection by company + title
const dupByCompany = mockFindDuplicate(undefined, "stripe", "staff frontend engineer");
assert.ok(dupByCompany);
assert.equal(dupByCompany?.id, app1.id);

// Test 5: Status transition to APPLIED
const updated = mockUpdateStatus(app1.id, "APPLIED", "Submitted via Stripe careers portal");
assert.ok(updated);
assert.equal(updated?.status, "APPLIED");
assert.ok(updated?.appliedAt);
assert.equal(updated?.events.length, 2);
assert.equal(updated?.events[1]?.status, "APPLIED");
assert.equal(updated?.events[1]?.note, "Submitted via Stripe careers portal");

// Test 6: Status transition to INTERVIEW
const interviewUpdate = mockUpdateStatus(app1.id, "INTERVIEW", "Round 1 technical scheduled");
assert.ok(interviewUpdate);
assert.equal(interviewUpdate?.status, "INTERVIEW");
assert.equal(interviewUpdate?.events.length, 3);
assert.equal(interviewUpdate?.version, 3);

// Test 7: Export CSV
const csv = mockExportCsv();
assert.ok(csv.includes("Company,Job Title,Status"));
assert.ok(csv.includes('"Stripe","Staff Frontend Engineer","INTERVIEW"'));

// Test 8: Soft delete
app1.deletedAt = new Date().toISOString();
const dupAfterDelete = mockFindDuplicate("https://stripe.com/jobs/123");
assert.equal(dupAfterDelete, undefined);

const csvAfterDelete = mockExportCsv();
assert.ok(!csvAfterDelete.includes("Stripe"));

console.log("tracker tests: PASS");
