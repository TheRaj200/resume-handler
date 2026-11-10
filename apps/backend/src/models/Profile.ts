import { Schema, model, type InferSchemaType } from "mongoose";

const addressSchema = new Schema(
  {
    line1: String,
    line2: String,
    city: String,
    state: String,
    zip: String,
    country: String,
  },
  { _id: false },
);

const linksSchema = new Schema(
  {
    linkedin: String,
    github: String,
    portfolio: String,
    twitter: String,
  },
  { _id: false },
);

const preferencesSchema = new Schema(
  {
    locations: [String],
    workMode: {
      type: String,
      enum: ["remote", "hybrid", "onsite", "any"],
    },
    expectedCtc: Number,
    currency: String,
    noticePeriodDays: Number,
  },
  { _id: false },
);

const profileSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, unique: true, index: true },
    firstName: String,
    lastName: String,
    email: String,
    phone: String,
    dob: String,
    gender: String,
    headline: String,
    summary: String,
    address: addressSchema,
    links: linksSchema,
    preferences: preferencesSchema,
    version: { type: Number, default: 1 },
  },
  { timestamps: true, versionKey: false },
);

export type ProfileDocument = InferSchemaType<typeof profileSchema>;
export const Profile = model("Profile", profileSchema);
