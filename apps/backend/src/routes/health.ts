import { Router } from "express";
import mongoose from "mongoose";

export const healthRouter = Router();

healthRouter.get("/health", (_request, response) => {
  const database =
    mongoose.connection.readyState === 1 ? "connected" : "disconnected";

  response.json({
    ok: true,
    data: {
      status: "up",
      database,
      timestamp: new Date().toISOString(),
    },
  });
});
