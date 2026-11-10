import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { env } from "./config/env";
import { connectDatabase } from "./db/connect";
import { healthRouter } from "./routes/health";
import { applicationRouter } from "./routes/application.routes";
import { authRouter } from "./routes/auth.routes";
import { requireAuth } from "./middleware/auth";
import { syncRouter } from "./routes/sync.routes";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
  }),
);
app.use(express.json({ limit: "2mb" }));

app.use("/api/v1", healthRouter);
app.use("/api/v1/auth", authRouter);
app.use("/api/v1/applications", requireAuth, applicationRouter);
app.use("/api/v1/sync", requireAuth, syncRouter);

app.use((_request, response) => {
  response.status(404).json({
    ok: false,
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error("[api] unhandled error", error);
  response.status(500).json({
    ok: false,
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  });
};

app.use(errorHandler);

async function main(): Promise<void> {
  await connectDatabase();

  app.listen(env.PORT, () => {
    console.log(`[api] listening on http://localhost:${env.PORT}`);
  });
}

void main().catch((error) => {
  console.error("[api] failed to start", error);
  process.exit(1);
});
