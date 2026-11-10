import { Router } from "express";
import { applicationController } from "../controllers/application.controller";

export const applicationRouter = Router();

applicationRouter.get("/", applicationController.list);
applicationRouter.get("/export", applicationController.exportCsv);
applicationRouter.get("/:id", applicationController.getById);
applicationRouter.post("/", applicationController.create);
applicationRouter.patch("/:id/status", applicationController.updateStatus);
applicationRouter.put("/:id", applicationController.update);
applicationRouter.delete("/:id", applicationController.delete);
