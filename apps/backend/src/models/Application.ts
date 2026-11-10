import { Schema, model, type InferSchemaType } from "mongoose";

export const APPLICATION_STATUSES = [
  "DRAFT",
  "APPLIED",
  "SCREENING",
  "INTERVIEW",
  "OFFER",
  "REJECTED",
  "WITHDRAWN",
  "NO_RESPONSE",
] as const;

const applicationEventSchema = new Schema(
  {
    status: { type: String, enum: APPLICATION_STATUSES, required: true },
    note: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const applicationSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    company: { type: String, required: true },
    jobTitle: { type: String, required: true },
    jobUrl: String,
    normalizedUrl: { type: String, index: true },
    jdSnapshot: String,
    status: {
      type: String,
      enum: APPLICATION_STATUSES,
      default: "DRAFT",
      index: true,
    },
    appliedAt: Date,
    source: String,
    notes: String,
    resumeVersionId: String,
    version: { type: Number, default: 1 },
    deletedAt: { type: Date, default: null },
    events: { type: [applicationEventSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

applicationSchema.index(
  { userId: 1, normalizedUrl: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
applicationSchema.index({ company: "text", jobTitle: "text" });

export type ApplicationDocument = InferSchemaType<typeof applicationSchema>;
export const Application = model("Application", applicationSchema);
