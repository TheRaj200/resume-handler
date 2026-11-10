import { randomUUID } from "node:crypto";
import type { ApplicationInput, ApplicationStatus } from "@jobpilot/shared";
import {
  applicationRepository,
  type ApplicationData,
  type ApplicationEventData,
  type ApplicationFilter,
  type ApplicationRepository,
} from "../repositories/application.repository";
import type { ApplicationDocument } from "../models/Application";

export function normalizeJobUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    const trackingKeys = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
      "refId",
      "trackingId",
    ];
    for (const key of trackingKeys) {
      url.searchParams.delete(key);
    }
    const cleanSearch = url.searchParams.toString();
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname}${cleanSearch ? `?${cleanSearch}` : ""}`.toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export class ApplicationService {
  constructor(private readonly repo: ApplicationRepository = applicationRepository) {}

  async listApplications(userId: string, filter?: ApplicationFilter): Promise<ApplicationDocument[]> {
    return this.repo.findAll(userId, filter);
  }

  async getApplicationById(id: string, userId: string): Promise<ApplicationDocument> {
    const app = await this.repo.findById(id, userId);
    if (!app) {
      throw new Error("Application not found");
    }
    return app;
  }

  async createApplication(userId: string, input: ApplicationInput): Promise<ApplicationDocument> {
    const normalizedUrl = input.normalizedUrl || normalizeJobUrl(input.jobUrl);

    // Duplicate check by normalized URL
    if (normalizedUrl) {
      const existing = await this.repo.findByNormalizedUrl(userId, normalizedUrl);
      if (existing) {
        throw new Error(`Application already exists for this URL with status: ${existing.status}`);
      }
    }

    const status = input.status || "DRAFT";
    const now = new Date();
    const appliedAt = status === "APPLIED" ? (input.appliedAt ? new Date(input.appliedAt) : now) : undefined;

    const newApp: ApplicationData = {
      _id: randomUUID(),
      userId,
      company: input.company.trim(),
      jobTitle: input.jobTitle.trim(),
      jobUrl: input.jobUrl?.trim() || undefined,
      normalizedUrl,
      jdSnapshot: input.jdSnapshot,
      status,
      appliedAt,
      source: input.source,
      notes: input.notes,
      resumeVersionId: input.resumeVersionId,
      version: 1,
      events: [
        {
          status,
          note: input.notes?.trim() || "Application created",
          at: now,
        },
      ],
    };

    return this.repo.create(newApp);
  }

  async updateStatus(
    id: string,
    userId: string,
    nextStatus: ApplicationStatus,
    note?: string,
  ): Promise<ApplicationDocument> {
    const existing = await this.getApplicationById(id, userId);
    const now = new Date();

    const events: ApplicationEventData[] = (existing.events || []).map((e) => ({
      status: e.status,
      note: e.note ?? undefined,
      at: e.at,
    }));
    events.push({
      status: nextStatus,
      note: note?.trim() || `Status updated to ${nextStatus}`,
      at: now,
    });

    const updateData: ApplicationData = {
      status: nextStatus,
      events,
      version: (existing.version || 1) + 1,
    };

    if (nextStatus === "APPLIED" && !existing.appliedAt) {
      updateData.appliedAt = now;
    }

    const updated = await this.repo.update(id, userId, updateData);
    if (!updated) {
      throw new Error("Failed to update application status");
    }
    return updated;
  }

  async updateApplication(
    id: string,
    userId: string,
    input: Partial<ApplicationInput>,
  ): Promise<ApplicationDocument> {
    const existing = await this.getApplicationById(id, userId);

    const updateData: ApplicationData = {
      version: (existing.version || 1) + 1,
    };

    if (input.company) updateData.company = input.company.trim();
    if (input.jobTitle) updateData.jobTitle = input.jobTitle.trim();
    if (input.jobUrl !== undefined) {
      updateData.jobUrl = input.jobUrl?.trim() || undefined;
      updateData.normalizedUrl = normalizeJobUrl(input.jobUrl);
    }
    if (input.jdSnapshot !== undefined) updateData.jdSnapshot = input.jdSnapshot;
    if (input.notes !== undefined) updateData.notes = input.notes;
    if (input.resumeVersionId !== undefined) updateData.resumeVersionId = input.resumeVersionId;
    if (input.source !== undefined) updateData.source = input.source;

    const updated = await this.repo.update(id, userId, updateData);
    if (!updated) {
      throw new Error("Failed to update application");
    }
    return updated;
  }

  async deleteApplication(id: string, userId: string): Promise<void> {
    const deleted = await this.repo.softDelete(id, userId);
    if (!deleted) {
      throw new Error("Application not found or already deleted");
    }
  }

  async exportToCsv(userId: string): Promise<string> {
    const applications = await this.repo.findAll(userId);
    const headers = [
      "Company",
      "Job Title",
      "Status",
      "Applied At",
      "Job URL",
      "Resume Version ID",
      "Source",
      "Notes",
    ];

    const escapeCsv = (val?: string | null | Date) => {
      if (!val) return '""';
      const str = val instanceof Date ? val.toISOString() : String(val);
      const clean = str.replace(/"/g, '""');
      return `"${clean}"`;
    };

    const rows = applications.map((app) => [
      escapeCsv(app.company),
      escapeCsv(app.jobTitle),
      escapeCsv(app.status),
      escapeCsv(app.appliedAt),
      escapeCsv(app.jobUrl),
      escapeCsv(app.resumeVersionId),
      escapeCsv(app.source),
      escapeCsv(app.notes),
    ]);

    return [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");
  }
}

export const applicationService = new ApplicationService();
