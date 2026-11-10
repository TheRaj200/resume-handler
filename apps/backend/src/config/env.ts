import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1).optional(),
  CORS_ORIGIN: z.string().default("*"),
  JWT_SECRET: z.string().min(16).optional(),
});

export const env = envSchema.parse(process.env);
