import { z } from "zod";
import {
  AI_PROVIDERS,
  APPLICATION_STATUSES,
  FIELD_TYPES,
  WORK_MODES,
} from "./constants";

const optionalUrl = z.union([z.url(), z.literal("")]).optional();
const optionalEmail = z.union([z.email(), z.literal("")]).optional();

export const applicationStatusSchema = z.enum(APPLICATION_STATUSES);
export const fieldTypeSchema = z.enum(FIELD_TYPES);
export const workModeSchema = z.enum(WORK_MODES);
export const aiProviderSchema = z.enum(AI_PROVIDERS);

export const addressSchema = z.object({
  line1: z.string().max(200).optional(),
  line2: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(100).optional(),
  zip: z.string().max(20).optional(),
  country: z.string().max(100).optional(),
});

export const linksSchema = z.object({
  linkedin: optionalUrl,
  github: optionalUrl,
  portfolio: optionalUrl,
  twitter: optionalUrl,
});

export const jobPreferencesSchema = z.object({
  locations: z.array(z.string().max(100)).max(20).optional(),
  workMode: workModeSchema.optional(),
  expectedCtc: z.number().nonnegative().optional(),
  currency: z.string().max(10).optional(),
  noticePeriodDays: z.number().int().nonnegative().max(365).optional(),
});

export const profileInputSchema = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  email: optionalEmail,
  phone: z.string().trim().max(30).optional(),
  dob: z.string().max(30).optional(),
  gender: z.string().max(50).optional(),
  headline: z.string().max(200).optional(),
  summary: z.string().max(2000).optional(),
  address: addressSchema.optional(),
  links: linksSchema.optional(),
  preferences: jobPreferencesSchema.optional(),
});

export const experienceInputSchema = z.object({
  company: z.string().trim().min(1).max(200),
  designation: z.string().trim().min(1).max(200),
  description: z.array(z.string().max(1000)).max(20).default([]),
  startDate: z.string().max(30).optional(),
  endDate: z.string().max(30).optional(),
  current: z.boolean().optional(),
  order: z.number().int().optional(),
});

export const educationInputSchema = z.object({
  institution: z.string().trim().min(1).max(200),
  degree: z.string().trim().min(1).max(200),
  field: z.string().max(200).optional(),
  graduationYear: z.number().int().min(1950).max(2100).optional(),
  grade: z.string().max(50).optional(),
  order: z.number().int().optional(),
});

export const skillInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.string().max(100).optional(),
  proficiency: z.enum(["beginner", "intermediate", "advanced", "expert"]).optional(),
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(2000).default(""),
  technologies: z.array(z.string().max(100)).max(30).default([]),
  url: optionalUrl,
  order: z.number().int().optional(),
});

export const customFieldInputSchema = z.object({
  label: z.string().trim().min(1).max(100),
  fieldKey: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z][a-zA-Z0-9_.-]*$/, "Use letters, numbers, _, . or -"),
  fieldType: fieldTypeSchema,
  options: z.array(z.string().max(100)).max(50).optional(),
  isSensitive: z.boolean().default(false),
  required: z.boolean().default(false),
});

export const applicationInputSchema = z.object({
  company: z.string().trim().min(1).max(200),
  jobTitle: z.string().trim().min(1).max(200),
  jobUrl: optionalUrl,
  normalizedUrl: z.string().max(1000).optional(),
  jdSnapshot: z.string().max(50000).optional(),
  status: applicationStatusSchema.default("DRAFT"),
  appliedAt: z.string().max(40).optional(),
  source: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
  resumeVersionId: z.string().max(64).optional(),
});

export const resumeBulletSchema = z.object({
  text: z.string().min(1).max(1000),
  sourceFactIds: z.array(z.string()).default([]),
  origin: z.enum(["ai", "user"]),
});

export const tailoredResumeSchema = z.object({
  id: z.string().min(1),
  applicationId: z.string().optional(),
  templateId: z.enum(["ats-classic", "modern"]),
  targetRole: z.string().min(1).max(200),
  summary: z.string().max(2000),
  contact: z.object({
    name: z.string().min(1),
    email: z.string(),
    phone: z.string(),
    location: z.string().optional(),
    linkedin: optionalUrl,
    github: optionalUrl,
    portfolio: optionalUrl,
  }),
  experience: z.array(
    z.object({
      company: z.string().min(1),
      designation: z.string().min(1),
      startDate: z.string(),
      endDate: z.string().optional(),
      bullets: z.array(resumeBulletSchema),
    }),
  ),
  education: z.array(
    z.object({
      institution: z.string().min(1),
      degree: z.string().min(1),
      field: z.string().optional(),
      graduationYear: z.number().int().optional(),
      grade: z.string().optional(),
    }),
  ),
  skills: z.array(
    z.object({
      name: z.string().min(1),
      category: z.string(),
      sourceFactIds: z.array(z.string()).default([]),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string(),
      technologies: z.array(z.string()),
      url: optionalUrl,
      sourceFactIds: z.array(z.string()).default([]),
    }),
  ),
  certifications: z
    .array(
      z.object({
        name: z.string().min(1),
        issuer: z.string().optional(),
        year: z.number().int().optional(),
      }),
    )
    .optional(),
  meta: z.object({
    generatedAt: z.string(),
    provider: z.string(),
    model: z.string(),
    jdHash: z.string(),
    factLockPassed: z.boolean(),
  }),
});

const parsedYearSchema = z.union([
  z.number().int().min(1950).max(2100),
  z
    .string()
    .trim()
    .regex(/^(19|20)\d{2}$/)
    .transform((value) => Number(value)),
]);

export const parsedResumeContactSchema = z.object({
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  email: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(40).optional(),
  location: z.string().trim().max(200).optional(),
  headline: z.string().trim().max(200).optional(),
  linkedin: z.string().trim().max(500).optional(),
  github: z.string().trim().max(500).optional(),
  portfolio: z.string().trim().max(500).optional(),
});

export const parsedResumeExperienceSchema = z.object({
  company: z.string().trim().max(200).default(""),
  designation: z.string().trim().max(200).default(""),
  description: z.array(z.string().trim().max(1000)).max(30).default([]),
  startDate: z.string().trim().max(30).optional(),
  endDate: z.string().trim().max(30).optional(),
  current: z.boolean().optional(),
});

export const parsedResumeEducationSchema = z.object({
  institution: z.string().trim().max(200).default(""),
  degree: z.string().trim().max(200).default(""),
  field: z.string().trim().max(200).optional(),
  graduationYear: parsedYearSchema.optional(),
  grade: z.string().trim().max(50).optional(),
});

export const parsedResumeSkillSchema = z.object({
  name: z.string().trim().max(100),
  category: z.string().trim().max(100).optional(),
});

export const parsedResumeProjectSchema = z.object({
  name: z.string().trim().max(200).default(""),
  description: z.string().trim().max(2000).default(""),
  technologies: z.array(z.string().trim().max(100)).max(30).default([]),
  url: z.string().trim().max(500).optional(),
});

export const parsedResumeSchema = z.object({
  contact: parsedResumeContactSchema.default({}),
  summary: z.string().trim().max(4000).optional(),
  experience: z.array(parsedResumeExperienceSchema).max(30).default([]),
  education: z.array(parsedResumeEducationSchema).max(20).default([]),
  skills: z.array(parsedResumeSkillSchema).max(200).default([]),
  projects: z.array(parsedResumeProjectSchema).max(30).default([]),
});

export const aiSettingsSchema = z.object({
  provider: aiProviderSchema,
  model: z.string().min(1).max(200),
  baseUrl: optionalUrl,
  temperature: z.number().min(0).max(2).default(0.4),
  maxOutputTokens: z.number().int().min(256).max(32768).default(4096),
});

export type ProfileInput = z.infer<typeof profileInputSchema>;
export type ExperienceInput = z.infer<typeof experienceInputSchema>;
export type EducationInput = z.infer<typeof educationInputSchema>;
export type SkillInput = z.infer<typeof skillInputSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;
export type CustomFieldInput = z.infer<typeof customFieldInputSchema>;
export type ApplicationInput = z.infer<typeof applicationInputSchema>;
export type AISettings = z.infer<typeof aiSettingsSchema>;
export type TailoredResumeInput = z.infer<typeof tailoredResumeSchema>;
export type ParsedResumeInput = z.infer<typeof parsedResumeSchema>;
