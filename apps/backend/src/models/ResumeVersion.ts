import { Schema, model, type InferSchemaType } from "mongoose";

const resumeVersionSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    resumeId: { type: String, required: true, index: true },
    applicationId: { type: String, index: true },
    content: { type: Schema.Types.Mixed, required: true },
    sourceSnapshot: { type: Schema.Types.Mixed },
    jdSnapshot: String,
    jdHash: { type: String, required: true },
    versionNumber: { type: Number, required: true },
    templateId: {
      type: String,
      enum: ["ats-classic", "modern"],
      required: true,
    },
    version: { type: Number, default: 1 },
  },
  { timestamps: true, versionKey: false },
);

resumeVersionSchema.index({ resumeId: 1, versionNumber: -1 });

export type ResumeVersionDocument = InferSchemaType<typeof resumeVersionSchema>;
export const ResumeVersion = model("ResumeVersion", resumeVersionSchema);
