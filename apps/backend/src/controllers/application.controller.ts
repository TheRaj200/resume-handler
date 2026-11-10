import type { Request, Response } from "express";
import {
  applicationInputSchema,
  applicationStatusSchema,
} from "@jobpilot/shared";
import {
  applicationService,
  type ApplicationService,
} from "../services/application.service";

function getUserId(request: Request): string {
  if (!request.userId) throw new Error("Authenticated user missing.");
  return request.userId;
}

function getParamId(request: Request): string | undefined {
  const param = request.params.id;
  if (!param) return undefined;
  return Array.isArray(param) ? param[0] : param;
}

export class ApplicationController {
  constructor(private readonly service: ApplicationService = applicationService) {}

  list = async (request: Request, response: Response): Promise<void> => {
    try {
      const userId = getUserId(request);
      const status = typeof request.query.status === "string" ? request.query.status : undefined;
      const search = typeof request.query.search === "string" ? request.query.search : undefined;

      const data = await this.service.listApplications(userId, { status, search });
      response.json({ ok: true, data });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: {
          code: "LIST_ERROR",
          message: error instanceof Error ? error.message : "Failed to list applications",
        },
      });
    }
  };

  getById = async (request: Request, response: Response): Promise<void> => {
    try {
      const userId = getUserId(request);
      const id = getParamId(request);
      if (!id) {
        response.status(400).json({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "Application ID is required" },
        });
        return;
      }

      const data = await this.service.getApplicationById(id, userId);
      response.json({ ok: true, data });
    } catch (error) {
      response.status(404).json({
        ok: false,
        error: {
          code: "NOT_FOUND",
          message: error instanceof Error ? error.message : "Application not found",
        },
      });
    }
  };

  create = async (request: Request, response: Response): Promise<void> => {
    try {
      const userId = getUserId(request);
      const parsed = applicationInputSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues.map((i) => i.message).join(", "),
          },
        });
        return;
      }

      const data = await this.service.createApplication(userId, parsed.data);
      response.status(201).json({ ok: true, data });
    } catch (error) {
      response.status(400).json({
        ok: false,
        error: {
          code: "CREATE_ERROR",
          message: error instanceof Error ? error.message : "Failed to create application",
        },
      });
    }
  };

  updateStatus = async (request: Request, response: Response): Promise<void> => {
    try {
      const userId = getUserId(request);
      const id = getParamId(request);
      if (!id) {
        response.status(400).json({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "Application ID is required" },
        });
        return;
      }

      const statusParsed = applicationStatusSchema.safeParse(request.body.status);
      if (!statusParsed.success) {
        response.status(400).json({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "Invalid application status" },
        });
        return;
      }

      const note = typeof request.body.note === "string" ? request.body.note : undefined;
      const data = await this.service.updateStatus(id, userId, statusParsed.data, note);
      response.json({ ok: true, data });
    } catch (error) {
      response.status(400).json({
        ok: false,
        error: {
          code: "STATUS_UPDATE_ERROR",
          message: error instanceof Error ? error.message : "Failed to update status",
        },
      });
    }
  };

  update = async (request: Request, response: Response): Promise<void> => {
    try {
      const userId = getUserId(request);
      const id = getParamId(request);
      if (!id) {
        response.status(400).json({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "Application ID is required" },
        });
        return;
      }

      const parsed = applicationInputSchema.partial().safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          ok: false,
          error: {
            code: "VALIDATION_ERROR",
            message: parsed.error.issues.map((i) => i.message).join(", "),
          },
        });
        return;
      }

      const data = await this.service.updateApplication(id, userId, parsed.data);
      response.json({ ok: true, data });
    } catch (error) {
      response.status(400).json({
        ok: false,
        error: {
          code: "UPDATE_ERROR",
          message: error instanceof Error ? error.message : "Failed to update application",
        },
      });
    }
  };

  delete = async (request: Request, response: Response): Promise<void> => {
    try {
      const userId = getUserId(request);
      const id = getParamId(request);
      if (!id) {
        response.status(400).json({
          ok: false,
          error: { code: "VALIDATION_ERROR", message: "Application ID is required" },
        });
        return;
      }

      await this.service.deleteApplication(id, userId);
      response.json({ ok: true, data: { deleted: true } });
    } catch (error) {
      response.status(400).json({
        ok: false,
        error: {
          code: "DELETE_ERROR",
          message: error instanceof Error ? error.message : "Failed to delete application",
        },
      });
    }
  };

  exportCsv = async (request: Request, response: Response): Promise<void> => {
    try {
      const userId = getUserId(request);
      const csv = await this.service.exportToCsv(userId);
      response.setHeader("Content-Type", "text/csv");
      response.setHeader("Content-Disposition", 'attachment; filename="applications.csv"');
      response.send(csv);
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: {
          code: "EXPORT_ERROR",
          message: error instanceof Error ? error.message : "Failed to export applications",
        },
      });
    }
  };
}

export const applicationController = new ApplicationController();
