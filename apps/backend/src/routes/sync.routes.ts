import { Router } from "express";
import { syncController } from "../controllers/sync.controller";

export const syncRouter = Router();

syncRouter.post("/push", syncController.push);
syncRouter.get("/pull", syncController.pull);
