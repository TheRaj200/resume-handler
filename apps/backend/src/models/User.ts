import { Schema, model, type InferSchemaType } from "mongoose";

const userSchema = new Schema(
  {
    _id: { type: String, required: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true },
    refreshTokenHash: { type: String, required: false },
  },
  { timestamps: true, versionKey: false },
);

export type UserDocument = InferSchemaType<typeof userSchema>;
export const User = model("User", userSchema);
