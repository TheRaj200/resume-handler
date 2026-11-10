import {
  LOCAL_USER_ID,
  type Education,
  type Experience,
  type ParsedResume,
  type Profile,
  type Project,
  type Skill,
} from "@jobpilot/shared";
import type { ResumeSourceData } from "./generator";

function baseRecord<T extends object>(id: string, extra: T): T & {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  syncStatus: "pending";
} {
  const timestamp = new Date().toISOString();
  return {
    id,
    userId: LOCAL_USER_ID,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    syncStatus: "pending" as const,
    ...extra,
  };
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

function normalizeUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Build a resume source from an imported/parsed resume.
 * Used by Quick-tailor mode so generation can run without touching the profile.
 */
export function sourceFromParsedResume(
  parsed: ParsedResume,
  fallbackProfile?: Profile,
): ResumeSourceData {
  const contact = parsed.contact;
  const location = splitLocation(contact.location);

  const profile = baseRecord("quick-tailor-profile", {
    firstName: contact.firstName ?? fallbackProfile?.firstName,
    lastName: contact.lastName ?? fallbackProfile?.lastName,
    email: contact.email ?? fallbackProfile?.email,
    phone: contact.phone ?? fallbackProfile?.phone,
    headline: contact.headline ?? fallbackProfile?.headline,
    summary: parsed.summary ?? fallbackProfile?.summary,
    address: {
      ...fallbackProfile?.address,
      ...location,
    },
    links: {
      ...fallbackProfile?.links,
      ...(normalizeUrl(contact.linkedin)
        ? { linkedin: normalizeUrl(contact.linkedin) }
        : {}),
      ...(normalizeUrl(contact.github) ? { github: normalizeUrl(contact.github) } : {}),
      ...(normalizeUrl(contact.portfolio)
        ? { portfolio: normalizeUrl(contact.portfolio) }
        : {}),
    },
  }) as Profile;

  const experiences: Experience[] = parsed.experience.map((item, index) =>
    baseRecord(`quick-tailor-exp-${index}`, {
      company: item.company,
      designation: item.designation,
      description: item.description,
      startDate: item.startDate,
      endDate: item.endDate,
      current: item.current,
      order: index,
    }) as Experience,
  );

  const educations: Education[] = parsed.education.map((item, index) =>
    baseRecord(`quick-tailor-edu-${index}`, {
      institution: item.institution,
      degree: item.degree,
      field: item.field,
      graduationYear: item.graduationYear,
      grade: item.grade,
      order: index,
    }) as Education,
  );

  const skills: Skill[] = parsed.skills.map((item, index) =>
    baseRecord(`quick-tailor-skill-${index}`, {
      name: item.name,
      category: item.category,
    }) as Skill,
  );

  const projects: Project[] = parsed.projects.map((item, index) =>
    baseRecord(`quick-tailor-project-${index}`, {
      name: item.name,
      description: item.description,
      technologies: item.technologies,
      url: normalizeUrl(item.url),
      order: index,
    }) as Project,
  );

  return {
    profile,
    experiences,
    educations,
    skills,
    projects,
  };
}
