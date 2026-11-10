import mongoose from "mongoose";
import { env } from "../config/env";

export async function connectDatabase(): Promise<void> {
  if (!env.MONGODB_URI) {
    console.warn("[db] MONGODB_URI missing — API will start without a database.");
    return;
  }

  mongoose.set("strictQuery", true);

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
  });

  console.log("[db] MongoDB connected");
}
