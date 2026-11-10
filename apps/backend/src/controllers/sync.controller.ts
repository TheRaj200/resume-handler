import type { Request, Response } from "express";
import { z } from "zod";
import { applicationInputSchema } from "@jobpilot/shared";
import { applicationRepository } from "../repositories/application.repository";
import { normalizeJobUrl } from "../services/application.service";

const syncChangeSchema = z.object({
  entity: z.literal("application"),
  op: z.enum(["upsert", "delete"]),
  entityId: z.string().min(1).max(100),
  baseVersion: z.number().int().nonnegative().optional(),
  record: z.unknown().optional(),
});

const pushSchema = z.object({ changes: z.array(syncChangeSchema).max(100) });

function getUserId(request: Request): string {
  if (!request.userId) throw new Error("Authenticated user missing.");
  return request.userId;
}

export class SyncController {
  push = async (request: Request, response: Response): Promise<void> => {
    try {
      const input = pushSchema.parse(request.body);
      const owner = getUserId(request);
      const results: Array<Record<string, unknown>> = [];

      for (const change of input.changes) {
        const existing = await applicationRepository.findById(change.entityId, owner);

        if (change.op === "delete") {
          if (existing && (change.baseVersion === undefined || existing.version === change.baseVersion)) {
            await applicationRepository.softDelete(change.entityId, owner);
            results.push({ entityId: change.entityId, status: "applied" });
          } else if (existing) {
            results.push({ entityId: change.entityId, status: "conflict", remote: existing });
          } else {
            results.push({ entityId: change.entityId, status: "applied" });
          }
          continue;
        }

        const parsed = applicationInputSchema.safeParse(change.record);
        if (!parsed.success) {
          results.push({ entityId: change.entityId, status: "rejected", reason: "Invalid application record" });
          continue;
        }
        if (existing && change.baseVersion !== undefined && existing.version !== change.baseVersion) {
          results.push({ entityId: change.entityId, status: "conflict", remote: existing });
          continue;
        }

        const record = parsed.data;
        const data = {
          _id: change.entityId,
          userId: owner,
          company: record.company,
          jobTitle: record.jobTitle,
          jobUrl: record.jobUrl,
          normalizedUrl: record.normalizedUrl ?? normalizeJobUrl(record.jobUrl),
          jdSnapshot: record.jdSnapshot,
          status: record.status,
          appliedAt: record.appliedAt ? new Date(record.appliedAt) : undefined,
          source: record.source,
          notes: record.notes,
          resumeVersionId: record.resumeVersionId,
          version: existing ? existing.version + 1 : 1,
          events: existing?.events?.map((event) => ({
            status: event.status,
            note: event.note ?? undefined,
            at: event.at,
          })) ?? [],
        };

        const saved = existing
          ? await applicationRepository.update(change.entityId, owner, data)
          : await applicationRepository.create(data);
        results.push({ entityId: change.entityId, status: "applied", record: saved });
      }

      response.json({ ok: true, data: { results } });
    } catch (error) {
      response.status(400).json({ ok: false, error: { code: "SYNC_PUSH_FAILED", message: error instanceof Error ? error.message : "Sync push failed" } });
    }
  };

  pull = async (request: Request, response: Response): Promise<void> => {
    try {
      const owner = getUserId(request);
      const sinceValue = typeof request.query.since === "string" ? request.query.since : undefined;
      const since = sinceValue ? new Date(sinceValue) : undefined;
      if (since && Number.isNaN(since.getTime())) {
        response.status(400).json({ ok: false, error: { code: "INVALID_SINCE", message: "since must be an ISO date" } });
        return;
      }
      const records = await applicationRepository.findChangedSince(owner, since);
      response.json({ ok: true, data: { records, serverTime: new Date().toISOString() } });
    } catch (error) {
      response.status(500).json({ ok: false, error: { code: "SYNC_PULL_FAILED", message: error instanceof Error ? error.message : "Sync pull failed" } });
    }
  };
}

export const syncController = new SyncController();
