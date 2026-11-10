import type { ApplicationStatus, FieldType, WorkMode } from "./constants";

export type UUID = string;
export type ISODateString = string;

export type SyncStatus = "pending" | "synced" | "conflict";

export interface BaseRecord {
  id: UUID;
  userId: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  version: number;
  deletedAt?: ISODateString | null;
  syncStatus?: SyncStatus;
}

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

export interface Links {
  linkedin?: string;
  github?: string;
  portfolio?: string;
  twitter?: string;
}

export interface JobPreferences {
  locations?: string[];
  workMode?: WorkMode;
  expectedCtc?: number;
  currency?: string;
  noticePeriodDays?: number;
}

export interface Profile extends BaseRecord {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  dob?: string;
  gender?: string;
  headline?: string;
  summary?: string;
  address?: Address;
  links?: Links;
  preferences?: JobPreferences;
}

export interface Experience extends BaseRecord {
  company: string;
  designation: string;
  description: string[];
  startDate?: string;
  endDate?: string;
  current?: boolean;
  order?: number;
}

export interface Education extends BaseRecord {
  institution: string;
  degree: string;
  field?: string;
  graduationYear?: number;
  grade?: string;
  order?: number;
}

export interface Skill extends BaseRecord {
  name: string;
  category?: string;
  proficiency?: "beginner" | "intermediate" | "advanced" | "expert";
}

export interface Project extends BaseRecord {
  name: string;
  description: string;
  technologies: string[];
  url?: string;
  order?: number;
}

export interface CustomField extends BaseRecord {
  label: string;
  fieldKey: string;
  fieldType: FieldType;
  options?: string[];
  isSensitive: boolean;
  required?: boolean;
}

export type CustomFieldValueData = string | number | boolean | string[] | null;

export interface CustomFieldValue extends BaseRecord {
  fieldId: UUID;
  value: CustomFieldValueData;
}

export interface ResumeFile extends BaseRecord {
  mimeType: string;
  size: number;
  fileName?: string;
  checksum?: string;
  storageKey?: string;
}

export interface Resume extends BaseRecord {
  title: string;
  fileId: UUID;
  isDefault: boolean;
  /** When the file text was last extracted and parsed for import. */
  parsedAt?: ISODateString;
  /** Outcome of the last extraction attempt. */
  textStatus?: "extracted" | "no-text" | "unsupported" | "failed";
  /** Number of characters extracted from the file. */
  extractedChars?: number;
}

/* ------------------------------------------------------------------ */
/* Resume import (parse an uploaded resume into profile facts)         */
/* ------------------------------------------------------------------ */

export interface ParsedResumeContact {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  location?: string;
  headline?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
}

export interface ParsedResumeExperience {
  company: string;
  designation: string;
  description: string[];
  startDate?: string;
  endDate?: string;
  current?: boolean;
}

export interface ParsedResumeEducation {
  institution: string;
  degree: string;
  field?: string;
  graduationYear?: number;
  grade?: string;
}

export interface ParsedResumeSkill {
  name: string;
  category?: string;
}

export interface ParsedResumeProject {
  name: string;
  description: string;
  technologies: string[];
  url?: string;
}

export interface ParsedResume {
  contact: ParsedResumeContact;
  summary?: string;
  experience: ParsedResumeExperience[];
  education: ParsedResumeEducation[];
  skills: ParsedResumeSkill[];
  projects: ParsedResumeProject[];
}

export interface ResumeExtraction {
  kind: "pdf" | "docx" | "doc";
  text: string;
  pageCount?: number;
  warnings: string[];
}

export interface ResumeBullet {
  text: string;
  sourceFactIds: string[];
  origin: "ai" | "user";
}

export interface TailoredResumeContact {
  name: string;
  email: string;
  phone: string;
  location?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
}

export interface TailoredResumeExperience {
  company: string;
  designation: string;
  startDate: string;
  endDate?: string;
  bullets: ResumeBullet[];
}

export interface TailoredResumeEducation {
  institution: string;
  degree: string;
  field?: string;
  graduationYear?: number;
  grade?: string;
}

export interface TailoredResumeSkill {
  name: string;
  category: string;
  sourceFactIds: string[];
}

export interface TailoredResumeProject {
  name: string;
  description: string;
  technologies: string[];
  url?: string;
  sourceFactIds: string[];
}

export interface TailoredResumeMeta {
  generatedAt: ISODateString;
  provider: string;
  model: string;
  jdHash: string;
  factLockPassed: boolean;
}

export interface TailoredResume {
  id: UUID;
  applicationId?: UUID;
  templateId: "ats-classic" | "modern";
  targetRole: string;
  summary: string;
  contact: TailoredResumeContact;
  experience: TailoredResumeExperience[];
  education: TailoredResumeEducation[];
  skills: TailoredResumeSkill[];
  projects: TailoredResumeProject[];
  certifications?: Array<{ name: string; issuer?: string; year?: number }>;
  meta: TailoredResumeMeta;
}

export interface ResumeSourceSnapshot {
  profile?: Profile;
  experiences: Experience[];
  educations: Education[];
  skills: Skill[];
  projects: Project[];
}

export interface ResumeVersion extends BaseRecord {
  resumeId: UUID;
  applicationId?: UUID;
  content: TailoredResume;
  /** Facts the version was generated from (profile or an imported resume). */
  sourceSnapshot?: ResumeSourceSnapshot;
  jdSnapshot?: string;
  jdHash: string;
  versionNumber: number;
  templateId: "ats-classic" | "modern";
}

export interface ApplicationEvent {
  status: ApplicationStatus;
  note?: string;
  at: ISODateString;
}

export interface Application extends BaseRecord {
  company: string;
  jobTitle: string;
  jobUrl?: string;
  normalizedUrl?: string;
  jdSnapshot?: string;
  status: ApplicationStatus;
  appliedAt?: string;
  source?: string;
  notes?: string;
  resumeVersionId?: UUID;
  events: ApplicationEvent[];
}

export interface FieldMapping {
  id: UUID;
  userId: UUID;
  domain: string;
  fingerprint: string;
  profileKey: string;
  confidence: number;
  confirmedByUser: boolean;
  updatedAt: ISODateString;
}

/* ------------------------------------------------------------------ */
/* Autofill contracts                                                  */
/* ------------------------------------------------------------------ */

export type LabelSource =
  | "for"
  | "aria"
  | "wrapping"
  | "placeholder"
  | "name"
  | "nearby";

export interface DetectedField {
  elementId: string;
  domPath: string;
  tag: "input" | "select" | "textarea" | "contenteditable";
  inputType: string;
  label: string;
  labelSource: LabelSource;
  placeholder?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  required: boolean;
  visible: boolean;
  disabled: boolean;
  options?: string[];
  currentValue?: string;
  frameId?: number;
  confidenceCap?: number;
}

export type FieldValue = string | number | boolean | string[] | null;

export type FieldMatchSource =
  | "autocomplete"
  | "name"
  | "label"
  | "synonym"
  | "fuzzy"
  | "stored"
  | "manual"
  | "custom"
  | "ai";

export interface FieldMatch {
  field: DetectedField;
  profileKey: string;
  value: FieldValue;
  confidence: number;
  requiresReview: boolean;
  sensitive?: boolean;
  source?: FieldMatchSource;
}

export interface ResumeAttachment {
  name: string;
  mimeType: string;
  base64: string;
}

export interface FillPlan {
  sessionId: string;
  matches: FieldMatch[];
  resumeAttachment?: ResumeAttachment;
  highlight?: boolean;
}

export interface FillResult {
  sessionId: string;
  filled: string[];
  skipped: string[];
  failed: string[];
  needsReview: string[];
}

export interface PageContext {
  url: string;
  domain: string;
  title: string;
  jobTitle?: string;
  company?: string;
  hasJobPosting: boolean;
}

export interface FormScanResult {
  fields: DetectedField[];
  framesScanned: number;
  crossOriginIframes?: number;
  crossOriginIframeOrigins?: string[];
  possibleClosedShadowRoots?: number;
}
