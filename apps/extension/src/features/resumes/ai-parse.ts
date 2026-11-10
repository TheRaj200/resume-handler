import {
  parsedResumeSchema,
  type AISettings,
  type ParsedResume,
  type ParsedResumeExperience,
  type ParsedResumeProject,
  type ParsedResumeSkill,
} from "@jobpilot/shared";
import { callAiJson } from "../../lib/ai-provider";

export const RESUME_PARSE_SYSTEM_PROMPT = `You extract structured facts from a resume.

Rules:
- Only use facts that are explicitly present in the resume text.
- Never invent employers, titles, dates, degrees, skills, projects, metrics or contact details.
- Copy wording as-is where possible; you may fix obvious line-break/spacing noise.
- If a section is absent, return an empty array (or omit the field). Do not guess.
- Dates: keep them as written (e.g. "Jan 2020", "2020", "Present").
- Skills: one skill per item, no sentences. Do not include soft-skill fluff unless listed.
- Return ONLY valid JSON, no markdown, no commentary.

JSON shape:
{
  "contact": {
    "firstName": string?, "lastName": string?, "email": string?, "phone": string?,
    "location": string?, "headline": string?, "linkedin": string?, "github": string?, "portfolio": string?
  },
  "summary": string?,
  "experience": [
    { "company": string, "designation": string, "description": string[],
      "startDate": string?, "endDate": string?, "current": boolean? }
  ],
  "education": [
    { "institution": string, "degree": string, "field": string?,
      "graduationYear": number?, "grade": string? }
  ],
  "skills": [ { "name": string, "category": string? } ],
  "projects": [
    { "name": string, "description": string, "technologies": string[], "url": string? }
  ]
}`;

export function coerceParsedResume(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const input = raw as Record<string, unknown>;

  const contact =
    input.contact && typeof input.contact === "object"
      ? input.contact
      : {};

  const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

  const experience = asArray(input.experience)
    .map((item): ParsedResumeExperience | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const description = asArray(record.description)
        .map((line) => (typeof line === "string" ? line.trim() : ""))
        .filter(Boolean);

      return {
        company: typeof record.company === "string" ? record.company : "",
        designation:
          typeof record.designation === "string"
            ? record.designation
            : typeof record.title === "string"
              ? record.title
              : "",
        description,
        ...(typeof record.startDate === "string"
          ? { startDate: record.startDate }
          : {}),
        ...(typeof record.endDate === "string" ? { endDate: record.endDate } : {}),
        ...(typeof record.current === "boolean" ? { current: record.current } : {}),
      };
    })
    .filter((item): item is ParsedResumeExperience => item !== null);

  const education = asArray(input.education)
    .map((item): Record<string, unknown> | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      return {
        institution:
          typeof record.institution === "string" ? record.institution : "",
        degree: typeof record.degree === "string" ? record.degree : "",
        ...(typeof record.field === "string" ? { field: record.field } : {}),
        ...(typeof record.graduationYear === "number" ||
        typeof record.graduationYear === "string"
          ? { graduationYear: record.graduationYear }
          : {}),
        ...(typeof record.grade === "string" ? { grade: record.grade } : {}),
      };
    })
    .filter((item): item is Record<string, unknown> => item !== null);

  const skills = asArray(input.skills)
    .map((item): ParsedResumeSkill | null => {
      if (typeof item === "string") return { name: item };
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      return {
        name: typeof record.name === "string" ? record.name : "",
        ...(typeof record.category === "string" ? { category: record.category } : {}),
      };
    })
    .filter((item): item is ParsedResumeSkill => item !== null);

  const projects = asArray(input.projects)
    .map((item): ParsedResumeProject | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const technologies = Array.isArray(record.technologies)
        ? record.technologies
            .map((tech) => (typeof tech === "string" ? tech.trim() : ""))
            .filter(Boolean)
        : typeof record.technologies === "string"
          ? record.technologies
              .split(/[,|/]+/)
              .map((tech) => tech.trim())
              .filter(Boolean)
          : [];

      return {
        name: typeof record.name === "string" ? record.name : "",
        description:
          typeof record.description === "string" ? record.description : "",
        technologies,
        ...(typeof record.url === "string" ? { url: record.url } : {}),
      };
    })
    .filter((item): item is ParsedResumeProject => item !== null);

  return {
    contact,
    ...(typeof input.summary === "string" ? { summary: input.summary } : {}),
    experience,
    education,
    skills,
    projects,
  };
}

export interface AiParseResult {
  parsed: ParsedResume;
  warnings: string[];
}

export async function parseResumeWithAi(
  text: string,
  settings: AISettings,
  apiKey: string,
): Promise<AiParseResult> {
  const raw = await callAiJson<unknown>({
    settings,
    apiKey,
    system: RESUME_PARSE_SYSTEM_PROMPT,
    user: `Resume text:\n\n${text}`,
  });

  const coerced = coerceParsedResume(raw);
  const result = parsedResumeSchema.safeParse(coerced);

  if (!result.success) {
    const detail = result.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`AI resume parse schema validation failed — ${detail}`);
  }

  const warnings: string[] = [];
  if (result.data.experience.length === 0 && result.data.education.length === 0) {
    warnings.push("AI ne experience/education nahi nikala — resume text check karo.");
  }

  return { parsed: result.data as ParsedResume, warnings };
}
