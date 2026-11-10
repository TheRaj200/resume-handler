import Dexie, { type Table } from "dexie";
import { zipSync, strToU8 } from "fflate";
import {
  DB_NAME,
  DEFAULT_PROFILE_ID,
  LOCAL_USER_ID,
  MAX_RESUME_BYTES,
  type Application,
  type ApplicationEvent,
  type ApplicationInput,
  type ApplicationStatus,
  type CustomField,
  type CustomFieldInput,
  type CustomFieldValue,
  type CustomFieldValueData,
  type Education,
  type EducationInput,
  type Experience,
  type ExperienceInput,
  type FieldMapping,
  type ParsedResume,
  type Profile,
  type ProfileInput,
  type Project,
  type ProjectInput,
  type Resume,
  type ResumeFile,
  type ResumeSourceSnapshot,
  type ResumeVersion,
  type Skill,
  type SkillInput,
  type TailoredResume,
} from "@jobpilot/shared";
import { profileToInput } from "../lib/profile";

export interface LocalResumeFile extends ResumeFile {
  blob?: Blob;
}

export interface ApplicationEventRecord {
  id: string;
  applicationId: string;
  status: ApplicationStatus;
  note?: string;
  createdAt: string;
}

export interface SyncQueueItem {
  id: string;
  entity: string;
  entityId: string;
  op: "upsert" | "delete";
  updatedAt: string;
  baseVersion?: number;
  record?: unknown;
}

export interface ConflictRecord {
  id: string;
  entity: string;
  entityId: string;
  local: unknown;
  remote: unknown;
  createdAt: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

/**
 * Local-first database. IndexedDB via Dexie.
 * Secrets (API keys) never go here — they live in chrome.storage.local, encrypted.
 */
export class JobPilotDB extends Dexie {
  profile!: Table<Profile, string>;
  experiences!: Table<Experience, string>;
  educations!: Table<Education, string>;
  skills!: Table<Skill, string>;
  projects!: Table<Project, string>;
  customFields!: Table<CustomField, string>;
  customFieldValues!: Table<CustomFieldValue, string>;
  resumes!: Table<Resume, string>;
  files!: Table<LocalResumeFile, string>;
  resumeVersions!: Table<ResumeVersion, string>;
  applications!: Table<Application, string>;
  applicationEvents!: Table<ApplicationEventRecord, string>;
  fieldMappings!: Table<FieldMapping, string>;
  settings!: Table<SettingRecord, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  conflicts!: Table<ConflictRecord, string>;

  constructor() {
    super(DB_NAME);

    this.version(1).stores({
      profile: "id, updatedAt",
      experiences: "id, company, startDate, updatedAt",
      educations: "id, institution, graduationYear, updatedAt",
      skills: "id, name, category, updatedAt",
      projects: "id, name, updatedAt",
      customFields: "id, &fieldKey, updatedAt",
      customFieldValues: "id, fieldId, updatedAt",
      resumes: "id, title, updatedAt",
      files: "id, mimeType, updatedAt",
      resumeVersions: "id, resumeId, applicationId, createdAt",
      applications: "id, company, status, appliedAt, normalizedUrl, updatedAt",
      applicationEvents: "id, applicationId, createdAt",
      fieldMappings: "id, domain, fingerprint",
      settings: "key",
      syncQueue: "id, entity, updatedAt",
      conflicts: "id, entity, createdAt",
    });

    // v2 adds the sync stores for users who already installed an earlier build.
    // Keep the existing stores in the schema so Dexie upgrades the database
    // without deleting any local profile, resume, or application data.
    this.version(2).stores({
      profile: "id, updatedAt",
      experiences: "id, company, startDate, updatedAt",
      educations: "id, institution, graduationYear, updatedAt",
      skills: "id, name, category, updatedAt",
      projects: "id, name, updatedAt",
      customFields: "id, &fieldKey, updatedAt",
      customFieldValues: "id, fieldId, updatedAt",
      resumes: "id, title, updatedAt",
      files: "id, mimeType, updatedAt",
      resumeVersions: "id, resumeId, applicationId, createdAt",
      applications: "id, company, status, appliedAt, normalizedUrl, updatedAt",
      applicationEvents: "id, applicationId, createdAt",
      fieldMappings: "id, domain, fingerprint",
      settings: "key",
      syncQueue: "id, entity, updatedAt",
      conflicts: "id, entity, createdAt",
    });
  }
}

export const db = new JobPilotDB();

function now(): string {
  return new Date().toISOString();
}

export async function enqueueSync(
  entity: string,
  entityId: string,
  op: "upsert" | "delete",
  record?: unknown,
  baseVersion?: number,
): Promise<void> {
  const item: SyncQueueItem = {
    id: `${entity}:${entityId}`,
    entity,
    entityId,
    op,
    updatedAt: now(),
    baseVersion,
    record,
  };
  await db.syncQueue.put(item);
}

export async function resolveSyncConflict(
  conflictId: string,
  choice: "local" | "remote",
): Promise<void> {
  const conflict = await db.conflicts.get(conflictId);
  if (!conflict) return;
  const selected = (choice === "local" ? conflict.local : conflict.remote) as Record<string, unknown>;
  const id = String(selected.id ?? selected._id ?? conflict.entityId);
  if (conflict.entity === "application") {
    await db.applications.put({
      ...selected,
      id,
      userId: LOCAL_USER_ID,
      syncStatus: choice === "local" ? "pending" : "synced",
    } as Application);
    if (choice === "local") {
      await enqueueSync("application", id, "upsert", selected);
    }
  } else if (conflict.entity === "profile") {
    await db.profile.put({ ...selected, id, userId: LOCAL_USER_ID, syncStatus: choice === "local" ? "pending" : "synced" } as Profile);
    if (choice === "local") await enqueueSync("profile", id, "upsert", selected);
  } else if (conflict.entity === "resumeVersion") {
    await db.resumeVersions.put({ ...selected, id, userId: LOCAL_USER_ID, syncStatus: choice === "local" ? "pending" : "synced" } as ResumeVersion);
    if (choice === "local") await enqueueSync("resumeVersion", id, "upsert", selected);
  }
  await db.conflicts.delete(conflictId);
}

export async function getProfile(): Promise<Profile | undefined> {
  return db.profile.get(DEFAULT_PROFILE_ID);
}

export async function saveProfile(input: ProfileInput): Promise<Profile> {
  const existing = await db.profile.get(DEFAULT_PROFILE_ID);
  const timestamp = now();

  const record: Profile = {
    ...(existing ?? {}),
    ...input,
    id: DEFAULT_PROFILE_ID,
    userId: LOCAL_USER_ID,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: (existing?.version ?? 0) + 1,
    syncStatus: "pending",
  };

  await db.profile.put(record);
  await enqueueSync("profile", record.id, "upsert", record, existing?.version);
  return record;
}

export async function getRecentApplications(limit = 5): Promise<Application[]> {
  const all = await db.applications.orderBy("updatedAt").reverse().toArray();
  return all.filter((app) => !app.deletedAt).slice(0, limit);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export async function exportAllLocalData(): Promise<string> {
  const [profile, experiences, educations, skills, projects, customFields, customFieldValues, resumes, files, resumeVersions, applications, applicationEvents, fieldMappings, settings] = await Promise.all([
    db.profile.toArray(),
    db.experiences.toArray(),
    db.educations.toArray(),
    db.skills.toArray(),
    db.projects.toArray(),
    db.customFields.toArray(),
    db.customFieldValues.toArray(),
    db.resumes.toArray(),
    db.files.toArray(),
    db.resumeVersions.toArray(),
    db.applications.toArray(),
    db.applicationEvents.toArray(),
    db.fieldMappings.toArray(),
    db.settings.toArray(),
  ]);
  const exportedFiles = await Promise.all(
    files.map(async (file) => ({
      ...file,
      blob: file.blob ? await blobToDataUrl(file.blob) : undefined,
    })),
  );

  return JSON.stringify(
    {
      format: "jobpilot-local-export",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        profile,
        experiences,
        educations,
        skills,
        projects,
        customFields,
        customFieldValues,
        resumes,
        files: exportedFiles,
        resumeVersions,
        applications,
        applicationEvents,
        fieldMappings,
        settings,
      },
    },
    null,
    2,
  );
}

export async function deleteAllLocalData(): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}

export async function countApplications(): Promise<number> {
  const all = await db.applications.toArray();
  return all.filter((app) => !app.deletedAt).length;
}

export async function countResumes(): Promise<number> {
  return db.resumes.count();
}

function newId(): string {
  return crypto.randomUUID();
}

/* ------------------------------------------------------------------ */
/* Profile sections                                                    */
/* ------------------------------------------------------------------ */

export async function saveExperience(
  input: ExperienceInput,
  id?: string,
): Promise<Experience> {
  const existing = id ? await db.experiences.get(id) : undefined;
  const timestamp = now();

  const record: Experience = {
    ...(existing ?? {}),
    ...input,
    id: id ?? newId(),
    userId: LOCAL_USER_ID,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: (existing?.version ?? 0) + 1,
    syncStatus: "pending",
  };

  await db.experiences.put(record);
  return record;
}

export async function deleteExperience(id: string): Promise<void> {
  await db.experiences.delete(id);
}

export async function saveEducation(
  input: EducationInput,
  id?: string,
): Promise<Education> {
  const existing = id ? await db.educations.get(id) : undefined;
  const timestamp = now();

  const record: Education = {
    ...(existing ?? {}),
    ...input,
    id: id ?? newId(),
    userId: LOCAL_USER_ID,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: (existing?.version ?? 0) + 1,
    syncStatus: "pending",
  };

  await db.educations.put(record);
  return record;
}

export async function deleteEducation(id: string): Promise<void> {
  await db.educations.delete(id);
}

export async function saveSkill(input: SkillInput, id?: string): Promise<Skill> {
  const existing = id ? await db.skills.get(id) : undefined;
  const timestamp = now();

  const record: Skill = {
    ...(existing ?? {}),
    ...input,
    id: id ?? newId(),
    userId: LOCAL_USER_ID,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: (existing?.version ?? 0) + 1,
    syncStatus: "pending",
  };

  await db.skills.put(record);
  return record;
}

export async function deleteSkill(id: string): Promise<void> {
  await db.skills.delete(id);
}

export async function saveProject(
  input: ProjectInput,
  id?: string,
): Promise<Project> {
  const existing = id ? await db.projects.get(id) : undefined;
  const timestamp = now();

  const record: Project = {
    ...(existing ?? {}),
    ...input,
    id: id ?? newId(),
    userId: LOCAL_USER_ID,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: (existing?.version ?? 0) + 1,
    syncStatus: "pending",
  };

  await db.projects.put(record);
  return record;
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}

/* ------------------------------------------------------------------ */
/* Custom fields                                                       */
/* ------------------------------------------------------------------ */

export async function saveCustomField(
  input: CustomFieldInput,
  id?: string,
): Promise<CustomField> {
  const existing = id ? await db.customFields.get(id) : undefined;
  const timestamp = now();

  const record: CustomField = {
    ...(existing ?? {}),
    ...input,
    id: id ?? newId(),
    userId: LOCAL_USER_ID,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: (existing?.version ?? 0) + 1,
    syncStatus: "pending",
  };

  await db.customFields.put(record);
  return record;
}

export async function deleteCustomField(id: string): Promise<void> {
  await db.transaction("rw", db.customFields, db.customFieldValues, async () => {
    await db.customFieldValues.where("fieldId").equals(id).delete();
    await db.customFields.delete(id);
  });
}

export async function saveCustomFieldValue(
  fieldId: string,
  value: CustomFieldValueData,
): Promise<void> {
  const existing = await db.customFieldValues
    .where("fieldId")
    .equals(fieldId)
    .first();
  const timestamp = now();

  const record: CustomFieldValue = {
    ...(existing ?? {}),
    id: existing?.id ?? newId(),
    fieldId,
    userId: LOCAL_USER_ID,
    value,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: (existing?.version ?? 0) + 1,
    syncStatus: "pending",
  };

  await db.customFieldValues.put(record);
}

/* ------------------------------------------------------------------ */
/* Resume library                                                      */
/* ------------------------------------------------------------------ */

const ALLOWED_RESUME_EXTENSIONS = [".pdf", ".doc", ".docx"];

function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

export async function addResume(file: File, title?: string): Promise<Resume> {
  const extension = fileExtension(file.name);
  if (!ALLOWED_RESUME_EXTENSIONS.includes(extension)) {
    throw new Error("Only PDF, DOC or DOCX files are supported.");
  }
  if (file.size > MAX_RESUME_BYTES) {
    throw new Error("Resume must be 5 MB or smaller.");
  }

  const timestamp = now();
  const fileId = newId();
  const resumeId = newId();
  const existingCount = await db.resumes.count();

  const fileRecord: LocalResumeFile = {
    id: fileId,
    userId: LOCAL_USER_ID,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
    fileName: file.name,
    blob: file,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    syncStatus: "pending",
  };

  const resume: Resume = {
    id: resumeId,
    userId: LOCAL_USER_ID,
    title: title?.trim() || file.name.replace(/\.[^.]+$/, ""),
    fileId,
    isDefault: existingCount === 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    syncStatus: "pending",
  };

  await db.transaction("rw", db.files, db.resumes, async () => {
    await db.files.put(fileRecord);
    await db.resumes.put(resume);
  });

  return resume;
}

export async function setDefaultResume(id: string): Promise<void> {
  const timestamp = now();

  await db.transaction("rw", db.resumes, async () => {
    await db.resumes.toCollection().modify({ isDefault: false, updatedAt: timestamp });
    await db.resumes.update(id, { isDefault: true, updatedAt: timestamp });
  });
}

export async function deleteResume(id: string): Promise<void> {
  const resume = await db.resumes.get(id);
  if (!resume) return;

  await db.transaction("rw", db.resumes, db.files, async () => {
    await db.resumes.delete(id);
    await db.files.delete(resume.fileId);

    if (resume.isDefault) {
      const next = await db.resumes.orderBy("updatedAt").first();
      if (next) {
        await db.resumes.update(next.id, { isDefault: true, updatedAt: now() });
      }
    }
  });
}

export async function getResumeBlob(fileId: string): Promise<Blob | null> {
  const file = await db.files.get(fileId);
  return file?.blob ?? null;
}

export async function getResumeFile(fileId: string): Promise<LocalResumeFile | undefined> {
  return db.files.get(fileId);
}

export async function updateResumeMetadata(
  id: string,
  patch: Partial<Pick<Resume, "parsedAt" | "textStatus" | "extractedChars">>,
): Promise<void> {
  await db.resumes.update(id, { ...patch, updatedAt: now() });
}

/* ------------------------------------------------------------------ */
/* Resume import (parsed resume → profile facts)                       */
/* ------------------------------------------------------------------ */

export interface ResumeImportSelection {
  contact: boolean;
  summary: boolean;
  experience: boolean;
  education: boolean;
  skills: boolean;
  projects: boolean;
}

export interface ImportParsedResumeOptions {
  mode: "merge" | "replace";
  include: ResumeImportSelection;
}

export interface ImportCounts {
  added: number;
  skipped: number;
}

export interface ImportParsedResumeResult {
  profileUpdated: boolean;
  experience: ImportCounts;
  education: ImportCounts;
  skills: ImportCounts;
  projects: ImportCounts;
}

export const defaultResumeImportSelection: ResumeImportSelection = {
  contact: true,
  summary: true,
  experience: true,
  education: true,
  skills: true,
  projects: true,
};

function dedupeKey(...parts: Array<string | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function splitLocation(location?: string): { city?: string; country?: string } {
  if (!location) return {};
  const parts = location
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { city: parts[0] };
  return { city: parts[0], country: parts[parts.length - 1] };
}

function buildImportedProfileInput(
  parsed: ParsedResume,
  existing: Profile | undefined,
  options: ImportParsedResumeOptions,
): { input: ProfileInput; changed: boolean } {
  const current = profileToInput(existing);
  const next: ProfileInput = { ...current, address: { ...current.address }, links: { ...current.links } };
  let changed = false;

  const setField = (key: keyof ProfileInput, value?: string) => {
    if (!value?.trim()) return;
    if (options.mode === "merge" && current[key]) return;
    if (current[key] === value) return;
    (next[key] as string) = value.trim();
    changed = true;
  };

  if (options.include.contact) {
    setField("firstName", parsed.contact.firstName);
    setField("lastName", parsed.contact.lastName);
    setField("email", parsed.contact.email);
    setField("phone", parsed.contact.phone);
    setField("headline", parsed.contact.headline);

    const location = splitLocation(parsed.contact.location);
    const setAddress = (key: "city" | "country", value?: string) => {
      if (!value?.trim()) return;
      if (options.mode === "merge" && next.address?.[key]) return;
      if (next.address?.[key] === value) return;
      next.address = { ...next.address, [key]: value.trim() };
      changed = true;
    };
    setAddress("city", location.city);
    setAddress("country", location.country);

    const setLink = (key: "linkedin" | "github" | "portfolio", value?: string) => {
      if (!value?.trim()) return;
      if (options.mode === "merge" && next.links?.[key]) return;
      if (next.links?.[key] === value) return;
      next.links = { ...next.links, [key]: value.trim() };
      changed = true;
    };
    setLink("linkedin", parsed.contact.linkedin);
    setLink("github", parsed.contact.github);
    setLink("portfolio", parsed.contact.portfolio);
  }

  if (options.include.summary) {
    setField("summary", parsed.summary);
  }

  return { input: next, changed };
}

export async function importParsedResume(
  parsed: ParsedResume,
  options: ImportParsedResumeOptions,
): Promise<ImportParsedResumeResult> {
  const result: ImportParsedResumeResult = {
    profileUpdated: false,
    experience: { added: 0, skipped: 0 },
    education: { added: 0, skipped: 0 },
    skills: { added: 0, skipped: 0 },
    projects: { added: 0, skipped: 0 },
  };

  await db.transaction(
    "rw",
    [
      db.profile,
      db.experiences,
      db.educations,
      db.skills,
      db.projects,
      db.syncQueue,
    ],
    async () => {
      const existingProfile = await db.profile.get(DEFAULT_PROFILE_ID);
      const { input, changed } = buildImportedProfileInput(
        parsed,
        existingProfile,
        options,
      );

      if (changed) {
        await saveProfile(input);
        result.profileUpdated = true;
      }

      if (options.include.experience) {
        const existing = await db.experiences.toArray();
        const keys = new Set(
          existing.map((item) => dedupeKey(item.company, item.designation)),
        );

        if (options.mode === "replace") {
          await db.experiences.clear();
          keys.clear();
        }

        for (const item of parsed.experience) {
          if (!item.company.trim() || !item.designation.trim()) {
            result.experience.skipped += 1;
            continue;
          }
          const key = dedupeKey(item.company, item.designation);
          if (keys.has(key)) {
            result.experience.skipped += 1;
            continue;
          }
          keys.add(key);
          await saveExperience({
            company: item.company.trim(),
            designation: item.designation.trim(),
            description: item.description,
            startDate: item.startDate,
            endDate: item.endDate,
            current: item.current,
            order: result.experience.added,
          });
          result.experience.added += 1;
        }
      }

      if (options.include.education) {
        const existing = await db.educations.toArray();
        const keys = new Set(
          existing.map((item) => dedupeKey(item.institution, item.degree)),
        );

        if (options.mode === "replace") {
          await db.educations.clear();
          keys.clear();
        }

        for (const item of parsed.education) {
          if (!item.institution.trim() || !item.degree.trim()) {
            result.education.skipped += 1;
            continue;
          }
          const key = dedupeKey(item.institution, item.degree);
          if (keys.has(key)) {
            result.education.skipped += 1;
            continue;
          }
          keys.add(key);
          await saveEducation({
            institution: item.institution.trim(),
            degree: item.degree.trim(),
            field: item.field,
            graduationYear: item.graduationYear,
            grade: item.grade,
            order: result.education.added,
          });
          result.education.added += 1;
        }
      }

      if (options.include.skills) {
        const existing = await db.skills.toArray();
        const keys = new Set(existing.map((item) => dedupeKey(item.name)));

        if (options.mode === "replace") {
          await db.skills.clear();
          keys.clear();
        }

        for (const item of parsed.skills) {
          const name = item.name.trim();
          if (!name) {
            result.skills.skipped += 1;
            continue;
          }
          const key = dedupeKey(name);
          if (keys.has(key)) {
            result.skills.skipped += 1;
            continue;
          }
          keys.add(key);
          await saveSkill({ name, category: item.category });
          result.skills.added += 1;
        }
      }

      if (options.include.projects) {
        const existing = await db.projects.toArray();
        const keys = new Set(existing.map((item) => dedupeKey(item.name)));

        if (options.mode === "replace") {
          await db.projects.clear();
          keys.clear();
        }

        for (const item of parsed.projects) {
          const name = item.name.trim();
          if (!name) {
            result.projects.skipped += 1;
            continue;
          }
          const key = dedupeKey(name);
          if (keys.has(key)) {
            result.projects.skipped += 1;
            continue;
          }
          keys.add(key);
          await saveProject({
            name,
            description: item.description,
            technologies: item.technologies,
            url: item.url,
            order: result.projects.added,
          });
          result.projects.added += 1;
        }
      }
    },
  );

  return result;
}

/* ------------------------------------------------------------------ */
/* Autofill mapping memory                                             */
/* ------------------------------------------------------------------ */

export interface SaveFieldMappingInput {
  domain: string;
  fingerprint: string;
  profileKey: string;
  confidence: number;
  confirmedByUser?: boolean;
}

export async function getFieldMappings(domain: string): Promise<FieldMapping[]> {
  return db.fieldMappings.where("domain").equals(domain).toArray();
}

export async function saveFieldMapping(
  input: SaveFieldMappingInput,
): Promise<FieldMapping> {
  const existing = await db.fieldMappings
    .where("domain")
    .equals(input.domain)
    .filter((mapping) => mapping.fingerprint === input.fingerprint)
    .first();

  const record: FieldMapping = {
    id: existing?.id ?? newId(),
    userId: LOCAL_USER_ID,
    domain: input.domain,
    fingerprint: input.fingerprint,
    profileKey: input.profileKey,
    confidence: input.confidence,
    confirmedByUser: input.confirmedByUser ?? true,
    updatedAt: now(),
  };

  await db.fieldMappings.put(record);
  return record;
}

export async function getDefaultResume(): Promise<Resume | undefined> {
  const resumes = await db.resumes.toArray();
  return resumes.find((resume) => resume.isDefault) ?? resumes[0];
}

/* ------------------------------------------------------------------ */
/* Generated resume versions                                           */
/* ------------------------------------------------------------------ */

export interface SaveResumeVersionInput {
  resumeId?: string;
  applicationId?: string;
  jdSnapshot?: string;
  sourceSnapshot?: ResumeSourceSnapshot;
}

export async function saveResumeVersion(
  content: TailoredResume,
  input: SaveResumeVersionInput = {},
): Promise<ResumeVersion> {
  const resumeId = input.resumeId ?? content.id;
  const existing = await db.resumeVersions.where("resumeId").equals(resumeId).toArray();
  const versionNumber =
    existing.reduce((max, version) => Math.max(max, version.versionNumber), 0) + 1;
  const timestamp = now();

  const record: ResumeVersion = {
    id: newId(),
    userId: LOCAL_USER_ID,
    resumeId,
    applicationId: input.applicationId ?? content.applicationId,
    content,
    sourceSnapshot: input.sourceSnapshot,
    jdSnapshot: input.jdSnapshot,
    jdHash: content.meta.jdHash,
    versionNumber,
    templateId: content.templateId,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    syncStatus: "pending",
  };

  await db.resumeVersions.put(record);
  await enqueueSync("resumeVersion", record.id, "upsert", record, undefined);
  return record;
}

export async function listResumeVersions(limit = 30): Promise<ResumeVersion[]> {
  return db.resumeVersions.orderBy("createdAt").reverse().limit(limit).toArray();
}

export async function getResumeVersion(id: string): Promise<ResumeVersion | undefined> {
  return db.resumeVersions.get(id);
}

export async function linkResumeVersionToApplication(
  applicationId: string,
  resumeVersionId: string,
): Promise<{ application: Application; version: ResumeVersion }> {
  const application = await db.applications.get(applicationId);
  const version = await db.resumeVersions.get(resumeVersionId);
  if (!application) throw new Error("Application not found.");
  if (!version) throw new Error("Resume version not found.");

  const timestamp = now();
  const updatedApplication: Application = {
    ...application,
    resumeVersionId,
    updatedAt: timestamp,
    version: application.version + 1,
    syncStatus: "pending",
  };
  const updatedContent: TailoredResume = {
    ...version.content,
    applicationId,
  };
  const updatedVersion: ResumeVersion = {
    ...version,
    applicationId,
    content: updatedContent,
    updatedAt: timestamp,
    version: version.version + 1,
    syncStatus: "pending",
  };

  await db.transaction("rw", db.applications, db.resumeVersions, async () => {
    await db.applications.put(updatedApplication);
    await db.resumeVersions.put(updatedVersion);
  });

  return { application: updatedApplication, version: updatedVersion };
}

/* ------------------------------------------------------------------ */
/* Application tracker helpers                                         */
/* ------------------------------------------------------------------ */

export function normalizeJobUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    const searchParams = new URLSearchParams(url.search);
    const trackingKeys = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
      "refId",
      "trackingId",
    ];
    for (const key of trackingKeys) {
      searchParams.delete(key);
    }
    const cleanSearch = searchParams.toString();
    const pathname = url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname}${cleanSearch ? `?${cleanSearch}` : ""}`.toLowerCase();
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

export async function findDuplicateApplication(
  jobUrl?: string,
  company?: string,
  jobTitle?: string,
): Promise<Application | undefined> {
  const normalized = normalizeJobUrl(jobUrl);
  if (normalized) {
    const matchByUrl = await db.applications
      .filter((app) => !app.deletedAt && app.normalizedUrl === normalized)
      .first();
    if (matchByUrl) return matchByUrl;
  }

  if (company?.trim()) {
    const companyClean = company.trim().toLowerCase();
    const titleClean = jobTitle?.trim().toLowerCase();
    const matchByCompany = await db.applications
      .filter((app) => {
        if (app.deletedAt) return false;
        const cMatch = app.company.trim().toLowerCase() === companyClean;
        if (!cMatch) return false;
        if (titleClean && app.jobTitle) {
          return app.jobTitle.trim().toLowerCase() === titleClean;
        }
        return true;
      })
      .first();
    if (matchByCompany) return matchByCompany;
  }

  return undefined;
}

export async function saveApplication(
  input: ApplicationInput,
  id?: string,
): Promise<Application> {
  const timestamp = now();
  const existing = id ? await db.applications.get(id) : undefined;
  const normalizedUrl = input.normalizedUrl || normalizeJobUrl(input.jobUrl);

  const status = input.status || existing?.status || "DRAFT";
  const appliedAt =
    input.appliedAt ||
    existing?.appliedAt ||
    (status === "APPLIED" ? timestamp : undefined);

  const events: ApplicationEvent[] = existing?.events ? [...existing.events] : [];
  if (!existing) {
    events.push({
      status,
      note: input.notes?.trim() || "Application created",
      at: timestamp,
    });
  } else if (existing.status !== status) {
    events.push({
      status,
      note: input.notes?.trim() || `Status updated to ${status}`,
      at: timestamp,
    });
  }

  const record: Application = {
    ...(existing ?? {}),
    ...input,
    id: id ?? existing?.id ?? newId(),
    userId: LOCAL_USER_ID,
    company: input.company.trim(),
    jobTitle: input.jobTitle.trim(),
    jobUrl: input.jobUrl?.trim() || undefined,
    normalizedUrl,
    jdSnapshot: input.jdSnapshot || existing?.jdSnapshot,
    status,
    appliedAt,
    source: input.source || existing?.source,
    notes: input.notes !== undefined ? input.notes : existing?.notes,
    resumeVersionId: input.resumeVersionId || existing?.resumeVersionId,
    events,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    version: (existing?.version ?? 0) + 1,
    syncStatus: "pending",
  };

  await db.applications.put(record);
  await enqueueSync("application", record.id, "upsert", record, existing?.version);
  return record;
}

export async function updateApplicationStatus(
  id: string,
  status: ApplicationStatus,
  note?: string,
): Promise<Application | undefined> {
  const app = await db.applications.get(id);
  if (!app) return undefined;

  const timestamp = now();
  const events = [...(app.events || [])];
  events.push({
    status,
    note: note?.trim() || `Status changed to ${status}`,
    at: timestamp,
  });

  const appliedAt =
    app.appliedAt || (status === "APPLIED" ? timestamp : undefined);

  const updated: Application = {
    ...app,
    status,
    appliedAt,
    events,
    updatedAt: timestamp,
    version: app.version + 1,
    syncStatus: "pending",
  };

  await db.applications.put(updated);
  await enqueueSync("application", updated.id, "upsert", updated, app.version);
  return updated;
}

export async function deleteApplication(id: string, soft = true): Promise<void> {
  if (soft) {
    const app = await db.applications.get(id);
    if (!app) return;
    await db.applications.update(id, {
      deletedAt: now(),
      updatedAt: now(),
      version: app.version + 1,
      syncStatus: "pending",
    });
    await enqueueSync("application", id, "delete", undefined, app.version);
  } else {
    await db.applications.delete(id);
  }
}

export async function getApplication(id: string): Promise<Application | undefined> {
  return db.applications.get(id);
}

export async function listApplications(options?: {
  status?: ApplicationStatus;
  search?: string;
  limit?: number;
}): Promise<Application[]> {
  const query = db.applications.toCollection();
  let list = await query.toArray();
  list = list.filter((app) => !app.deletedAt);

  if (options?.status) {
    list = list.filter((app) => app.status === options.status);
  }

  if (options?.search?.trim()) {
    const q = options.search.trim().toLowerCase();
    list = list.filter(
      (app) =>
        app.company.toLowerCase().includes(q) ||
        app.jobTitle.toLowerCase().includes(q) ||
        (app.notes && app.notes.toLowerCase().includes(q)),
    );
  }

  list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  if (options?.limit) {
    list = list.slice(0, options.limit);
  }

  return list;
}

export async function exportApplicationsCsv(): Promise<string> {
  const applications = await listApplications();
  const headers = [
    "Company",
    "Job Title",
    "Status",
    "Applied At",
    "Job URL",
    "Resume Version ID",
    "Source",
    "Notes",
    "Created At",
    "Updated At",
  ];

  const escapeCsv = (val?: string | null) => {
    if (!val) return '""';
    const clean = String(val).replace(/"/g, '""');
    return `"${clean}"`;
  };

  const rows = applications.map((app) => [
    escapeCsv(app.company),
    escapeCsv(app.jobTitle),
    escapeCsv(app.status),
    escapeCsv(app.appliedAt),
    escapeCsv(app.jobUrl),
    escapeCsv(app.resumeVersionId),
    escapeCsv(app.source),
    escapeCsv(app.notes),
    escapeCsv(app.createdAt),
    escapeCsv(app.updatedAt),
  ]);

  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");
}

function xmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function excelColumn(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function worksheetXml(rows: string[][]): string {
  const body = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map(
            (value, columnIndex) =>
              `<c r="${excelColumn(columnIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetData>${body}</sheetData></worksheet>`;
}

/**
 * Creates a minimal standards-compatible XLSX without importing a large or
 * vulnerable spreadsheet parser into the extension. Values are intentionally
 * exported as escaped inline strings; Excel/Sheets display them correctly.
 */
export async function exportApplicationsXlsx(): Promise<Uint8Array> {
  const applications = await listApplications();
  const versions = await db.resumeVersions.toArray();
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const headers = [
    "Company",
    "Job Title",
    "Status",
    "Applied At",
    "Job URL",
    "Resume Version",
    "Resume Role",
    "Source",
    "Notes",
    "Created At",
    "Updated At",
  ];
  const rows = applications.map((app) => {
    const version = app.resumeVersionId ? versionById.get(app.resumeVersionId) : undefined;
    return [
      app.company,
      app.jobTitle,
      app.status,
      app.appliedAt ?? "",
      app.jobUrl ?? "",
      version ? `v${version.versionNumber}` : "",
      version?.content.targetRole ?? "",
      app.source ?? "",
      app.notes ?? "",
      app.createdAt,
      app.updatedAt,
    ];
  });

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Applications" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml([headers, ...rows])),
  };

  return zipSync(files, { level: 6 });
}
