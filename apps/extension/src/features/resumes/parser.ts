import type {
  ParsedResume,
  ParsedResumeEducation,
  ParsedResumeExperience,
  ParsedResumeProject,
  ParsedResumeSkill,
} from "@jobpilot/shared";

type SectionKey =
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "projects"
  | "certifications";

const SECTION_ALIASES: Record<SectionKey, string[]> = {
  summary: [
    "summary",
    "professionalsummary",
    "careersummary",
    "careerobjective",
    "objective",
    "profile",
    "about",
    "aboutme",
    "overview",
  ],
  experience: [
    "experience",
    "workexperience",
    "professionalexperience",
    "employment",
    "employmenthistory",
    "workhistory",
    "careerhistory",
    "relevantexperience",
    "internship",
    "internships",
    "internexperience",
    "internshipexperience",
    "internshipsandexperience",
    "workandinternships",
    "experienceandinternships",
  ],
  education: [
    "education",
    "academics",
    "academicbackground",
    "educationalbackground",
    "qualifications",
    "educationqualifications",
  ],
  skills: [
    "skills",
    "technicalskills",
    "coreskills",
    "keyskills",
    "technologies",
    "techstack",
    "competencies",
    "skillsandtools",
  ],
  projects: ["projects", "personalprojects", "academicprojects", "keyprojects", "selectedprojects", "projectexperience"],
  certifications: [
    "certifications",
    "certificates",
    "licenses",
    "licensesandcertifications",
    "courses",
  ],
};

const STOP_SECTIONS = [
  "awards",
  "achievements",
  "languages",
  "interests",
  "hobbies",
  "volunteer",
  "publications",
  "references",
  "declaration",
  "personal details",
  "personalinformation",
];

const DEGREE_PATTERN =
  /\b(b\.?\s?tech|m\.?\s?tech|b\.?\s?e\.?|m\.?\s?e\.?|b\.?\s?sc|m\.?\s?sc|b\.?\s?com|m\.?\s?com|bca|mca|bba|mba|bachelor|master|ph\.?\s?d|doctorate|diploma|polytechnic|high school|higher secondary|senior secondary|12th|10th|hsc|ssc|intermediate)\b/i;

const INSTITUTION_PATTERN =
  /\b(university|college|institute|school|academy|polytechnic|iit|nit|iiit|bits)\b/i;

const DESIGNATION_PATTERN =
  /\b(engineer|developer|programmer|manager|analyst|designer|consultant|intern|lead|architect|scientist|officer|executive|specialist|associate|director|head|founder|administrator|accountant|recruiter|marketer|tester|qa|devops|sre|cto|ceo)\b/i;

const COMPANY_PATTERN =
  /\b(inc|incorporated|ltd|limited|llc|llp|pvt|private|corp|corporation|company|technologies|technology|solutions|systems|labs|studio|services|bank|group|ventures|consulting)\b/i;

const DATE_RANGE_PATTERN =
  /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*)?((?:19|20)\d{2})\s*(?:-|–|—|to|until|through)\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*)?((?:19|20)\d{2}|present|current|now|ongoing)/i;

const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE_PATTERN = /(\+?\d[\d\s().-]{7,}\d)/;
const URL_PATTERN =
  /(https?:\/\/[^\s<>"')]+|www\.[^\s<>"')]+|(?<![\w@.])(?:[a-z0-9-]+\.)+(?:com|io|dev|org|net|ai|co|me|in|so|app)(?:\/[^\s<>"')]*)?)/i;

function normalizeHeading(line: string): string {
  return line
    .replace(/[^a-zA-Z ]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function headingKey(line: string): SectionKey | "stop" | null {
  const cleaned = line
    .replace(/^[\s#*•\-–—]+/, "")
    .replace(/[\s:•\-–—]+$/, "")
    .trim();

  if (!cleaned || cleaned.length > 48) return null;
  if (/[.!?]$/.test(cleaned)) return null;

  const normalized = normalizeHeading(cleaned);
  if (!normalized) return null;

  for (const [key, aliases] of Object.entries(SECTION_ALIASES) as Array<
    [SectionKey, string[]]
  >) {
    if (aliases.includes(normalized)) return key;
  }

  if (STOP_SECTIONS.includes(normalized)) return "stop";

  return null;
}

interface SectionedText {
  sections: Partial<Record<SectionKey, string[]>>;
  preamble: string[];
  foundHeadings: boolean;
}

export function splitSections(text: string): SectionedText {
  const lines = text.split("\n");
  const sections: Partial<Record<SectionKey, string[]>> = {};
  const preamble: string[] = [];
  let current: SectionKey | "stop" | null = null;
  let foundHeadings = false;

  for (const line of lines) {
    const key = headingKey(line);

    if (key) {
      foundHeadings = true;
      current = key;
      if (key !== "stop" && !sections[key]) sections[key] = [];
      continue;
    }

    if (current === null) {
      preamble.push(line);
    } else if (current !== "stop") {
      sections[current]?.push(line);
    }
  }

  return { sections, preamble, foundHeadings };
}

function cleanLines(lines: string[]): string[] {
  return lines.map((line) => line.trim()).filter(Boolean);
}

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function looksLikeEntryHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 140) return false;
  if (/^[\s•*\-–—\u2022\u25cf\u25aa]/.test(trimmed)) return false;
  if (DATE_RANGE_PATTERN.test(trimmed)) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length > 15) return false;
  return (
    /[|•]/.test(trimmed) ||
    /\s[–—]\s/.test(trimmed) ||
    /\s+at\s+/i.test(trimmed) ||
    DESIGNATION_PATTERN.test(trimmed) ||
    COMPANY_PATTERN.test(trimmed)
  );
}

export function splitBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length) blocks.push(current);

  if (blocks.length > 1) return blocks;

  // No blank lines: start a new entry at a header line that is immediately
  // followed by a date range (e.g. "Engineer | Acme" then "Jan 2020 - Present").
  const cleaned = lines.map((line) => line.trim()).filter(Boolean);
  const starts = new Set<number>();

  for (let index = 1; index < cleaned.length; index += 1) {
    const line = cleaned[index] ?? "";
    const previous = cleaned[index - 1] ?? "";
    if (DATE_RANGE_PATTERN.test(line) && looksLikeEntryHeader(previous)) {
      starts.add(index - 1);
    }
  }

  if (starts.size <= 1) return blocks;

  starts.add(0);
  const ordered = [...starts].sort((a, b) => a - b);
  const fallback: string[][] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const start = ordered[index] ?? 0;
    const end = ordered[index + 1] ?? cleaned.length;
    const slice = cleaned.slice(start, end);
    if (slice.length) fallback.push(slice);
  }

  return fallback;
}

function extractContact(text: string, preamble: string[]): ParsedResume["contact"] {
  const head = preamble.slice(0, 20).join("\n") || text.slice(0, 1200);
  const email = head.match(EMAIL_PATTERN)?.[0];
  const phoneMatch = head.match(PHONE_PATTERN)?.[0];
  const phoneDigits = phoneMatch?.replace(/\D/g, "") ?? "";
  const phone = phoneDigits.length >= 8 ? phoneMatch?.trim() : undefined;

  const urls = [
    ...head.replace(new RegExp(EMAIL_PATTERN.source, "gi"), " ").matchAll(
      new RegExp(URL_PATTERN.source, "gi"),
    ),
  ]
    .map((match) => match[0])
    .filter(Boolean);

  const linkedin = urls.find((url) => /linkedin\.com/i.test(url));
  const github = urls.find((url) => /github\.com/i.test(url));
  const portfolio = urls.find(
    (url) => !/linkedin\.com|github\.com/i.test(url),
  );

  const candidateLines = cleanLines(preamble.length ? preamble : text.split("\n"))
    .slice(0, 8)
    .filter(
      (line) =>
        !EMAIL_PATTERN.test(line) &&
        !URL_PATTERN.test(line) &&
        !headingKey(line) &&
        line.replace(/\D/g, "").length < 8,
    );

  const nameLine = candidateLines.find((line) => {
    const words = line.split(/\s+/).filter(Boolean);
    return (
      words.length >= 1 &&
      words.length <= 5 &&
      /^[A-Za-z][A-Za-z .'-]+$/.test(line) &&
      !DESIGNATION_PATTERN.test(line)
    );
  });

  let firstName: string | undefined;
  let lastName: string | undefined;

  if (nameLine) {
    const parts = nameLine.split(/\s+/).filter(Boolean);
    firstName = parts[0];
    lastName = parts.slice(1).join(" ") || undefined;
  }

  const headline = candidateLines.find(
    (line) =>
      line !== nameLine &&
      line.length <= 120 &&
      DESIGNATION_PATTERN.test(line) &&
      !COMPANY_PATTERN.test(line),
  );

  const location = candidateLines.find((line) => {
    const words = line.split(/\s+/).filter(Boolean);
    return (
      line !== nameLine &&
      line !== headline &&
      words.length <= 5 &&
      /^[A-Za-z][A-Za-z .,'-]+$/.test(line) &&
      line.includes(",") &&
      !DESIGNATION_PATTERN.test(line)
    );
  });

  return {
    ...(firstName ? { firstName } : {}),
    ...(lastName ? { lastName } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {}),
    ...(location ? { location: location.trim() } : {}),
    ...(headline ? { headline: headline.trim() } : {}),
    ...(linkedin ? { linkedin } : {}),
    ...(github ? { github } : {}),
    ...(portfolio ? { portfolio } : {}),
  };
}

function parseDateRange(value: string): {
  startDate?: string;
  endDate?: string;
  current?: boolean;
  matched: string;
} {
  const match = value.match(DATE_RANGE_PATTERN);
  if (!match) return { matched: "" };

  const startMonth = match[1]?.trim();
  const startYear = match[2];
  const endMonth = match[3]?.trim();
  const endRaw = match[4];

  const startDate = [startMonth, startYear].filter(Boolean).join(" ").trim();
  const isCurrent = /present|current|now|ongoing/i.test(endRaw ?? "");
  const endDate = isCurrent
    ? "Present"
    : [endMonth, endRaw].filter(Boolean).join(" ").trim();

  return {
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    current: isCurrent || undefined,
    matched: match[0],
  };
}

function splitHeader(header: string): { company: string; designation: string } {
  const withoutDate = header.replace(DATE_RANGE_PATTERN, "").trim();
  const cleaned = withoutDate.replace(/^[\s•*\-–—|]+|[\s•*\-–—|]+$/g, "");

  const atMatch = cleaned.match(/^(.*?)\s+(?:at|@)\s+(.*)$/i);
  if (atMatch?.[1] && atMatch[2]) {
    return { designation: atMatch[1].trim(), company: atMatch[2].trim() };
  }

  const parts = cleaned
    .split(/\s*[|•]\s*|\s+[–—]\s+|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length >= 2) {
    const first = parts[0] ?? "";
    const second = parts[1] ?? "";

    if (DESIGNATION_PATTERN.test(first) && !DESIGNATION_PATTERN.test(second)) {
      return { designation: first, company: second };
    }
    if (COMPANY_PATTERN.test(first) && DESIGNATION_PATTERN.test(second)) {
      return { company: first, designation: second };
    }
    if (DESIGNATION_PATTERN.test(second)) {
      return { company: first, designation: second };
    }
    return { designation: first, company: second };
  }

  if (parts.length === 1) {
    const commaParts = cleaned.split(/\s*,\s*/).filter(Boolean);
    if (commaParts.length === 2) {
      const first = commaParts[0] ?? "";
      const second = commaParts[1] ?? "";
      if (DESIGNATION_PATTERN.test(first)) {
        return { designation: first, company: second };
      }
      return { company: first, designation: second };
    }
    return { designation: cleaned, company: "" };
  }

  return { company: "", designation: "" };
}

function cleanBullet(line: string): string {
  return line
    .replace(/^[\s•*\-–—\u2022\u25cf\u25aa]+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .trim();
}

function parseExperience(lines: string[]): ParsedResumeExperience[] {
  const blocks = splitBlocks(lines);
  const results: ParsedResumeExperience[] = [];

  for (const block of blocks) {
    if (!block.length) continue;

    const header = block[0] ?? "";
    const date = parseDateRange(header);
    const { company, designation } = splitHeader(header);

    if (!company && !designation) continue;

    const description: string[] = [];

    for (const raw of block.slice(1)) {
      const line = cleanBullet(raw);
      if (!line) continue;
      if (DATE_RANGE_PATTERN.test(line) && line.length < 40) continue;
      if (line.length < 3) continue;
      description.push(line.slice(0, 1000));
    }

    // Some resumes put the date on its own line after the header.
    const nextDate = block[1] ? parseDateRange(block[1]) : { matched: "" };

    results.push({
      company: company || "Unknown company",
      designation: designation || "Unknown role",
      description: description.slice(0, 20),
      ...(date.startDate ? { startDate: date.startDate } : {}),
      ...(date.endDate ? { endDate: date.endDate } : {}),
      ...(date.current ? { current: true } : {}),
      ...(!date.startDate && nextDate.startDate
        ? { startDate: nextDate.startDate }
        : {}),
      ...(!date.endDate && nextDate.endDate ? { endDate: nextDate.endDate } : {}),
      ...(!date.current && nextDate.current ? { current: true } : {}),
    });
  }

  const seen = new Set<string>();
  return results.filter((item) => {
    const key = [item.company, item.designation, item.startDate ?? "", item.endDate ?? "", item.description.join("|")]
      .map(normalizedKey)
      .join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseEducation(lines: string[]): ParsedResumeEducation[] {
  const blocks = splitBlocks(lines);
  const results: ParsedResumeEducation[] = [];

  for (const block of blocks) {
    if (!block.length) continue;

    const joined = block.join(" ");
    const degreeLine =
      block.find((line) => DEGREE_PATTERN.test(line)) ??
      block[0] ??
      "";
    const institutionLine =
      block.find((line) => INSTITUTION_PATTERN.test(line)) ??
      block.find((line) => line !== degreeLine) ??
      "";

    const degree = degreeLine.replace(DATE_RANGE_PATTERN, "").trim();
    const institution = institutionLine.replace(DATE_RANGE_PATTERN, "").trim();

    if (!degree && !institution) continue;

    const yearMatch = [...joined.matchAll(/\b(19|20)\d{2}\b/g)].pop();
    const graduationYear = yearMatch ? Number(yearMatch[0]) : undefined;

    const gradeMatch = joined.match(
      /\b(?:cgpa|gpa|percentage|percent)\s*[:\-]?\s*([\d.]+\s*%?)|(\b[\d.]+\s*%)/i,
    );
    const grade = gradeMatch?.[1] ?? gradeMatch?.[2] ?? undefined;

    const fieldMatch = degree.match(/\bin\s+([A-Za-z &]+)/i);

    results.push({
      institution: institution || "Unknown institution",
      degree: degree || "Unknown degree",
      ...(fieldMatch?.[1] ? { field: fieldMatch[1].trim() } : {}),
      ...(graduationYear ? { graduationYear } : {}),
      ...(grade ? { grade: grade.trim() } : {}),
    });
  }

  const seen = new Set<string>();
  return results.filter((item) => {
    const key = [item.institution, item.degree, item.field ?? "", item.graduationYear ?? ""].map((value) => normalizedKey(String(value))).join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cleanSkill(raw: string): string {
  return raw
    .replace(/^[\s•*\-–—\u2022\u25cf\u25aa]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[.;]+$/, "")
    .trim();
}

export function parseSkills(lines: string[]): ParsedResumeSkill[] {
  const seen = new Set<string>();
  const results: ParsedResumeSkill[] = [];

  for (const rawLine of cleanLines(lines)) {
    const line = rawLine.replace(/^[\s•*\-–—]+/, "").trim();
    if (!line) continue;

    const colonIndex = line.indexOf(":");
    const label =
      colonIndex > 0 && colonIndex <= 30
        ? line.slice(0, colonIndex).trim()
        : undefined;
    const body = colonIndex > 0 ? line.slice(colonIndex + 1) : line;

    const items = body
      .split(/[,|;•·]+|\s{3,}/)
      .map(cleanSkill)
      .filter(Boolean);

    for (const item of items) {
      if (item.length > 60) continue;
      if (item.split(/\s+/).length > 6) continue;

      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        name: item,
        ...(label && label.split(/\s+/).length <= 4 ? { category: label } : {}),
      });

      if (results.length >= 200) return results;
    }
  }

  return results;
}

function parseProjects(lines: string[]): ParsedResumeProject[] {
  const initialBlocks = splitBlocks(lines);
  const blocks = initialBlocks.length > 1 ? initialBlocks : (() => {
    const cleaned = lines.map((line) => line.trim()).filter(Boolean);
    const result: string[][] = [];
    let current: string[] = [];
    let hasMetadata = false;
    for (const line of cleaned) {
      const isBullet = /^[•*\-–—\u2022\u25cf\u25aa]/.test(line);
      const isTech = /^(?:tech(?:nologies)?|stack|tools)\s*[:\-]/i.test(line);
      const isUrl = URL_PATTERN.test(line);
      if (!isBullet && current.length > 0 && hasMetadata && !isTech && !isUrl && line.length <= 100) {
        result.push(current);
        current = [];
        hasMetadata = false;
      }
      current.push(line);
      if (isTech || isUrl) hasMetadata = true;
    }
    if (current.length) result.push(current);
    return result;
  })();
  const results: ParsedResumeProject[] = [];

  for (const block of blocks) {
    if (!block.length) continue;

    const first = cleanBullet(block[0] ?? "").replace(/^project\s*[:\-]\s*/i, "");
    if (!first || first.length > 140) continue;

    const rest = block.slice(1).map(cleanBullet).filter(Boolean);
    const joined = rest.join(" ");

    const techMatch = joined.match(
      /(?:tech(?:nologies)?|stack|tools)\s*[:\-]\s*([^.;]+)/i,
    );
    const technologies = techMatch?.[1]
      ? techMatch[1]
          .split(/[,|/]+/)
          .map((item) => item.trim())
          .filter((item) => item && item.length <= 40)
      : [];

    const url = joined.match(URL_PATTERN)?.[0];

    results.push({
      name: first,
      description: rest.join(" ").slice(0, 2000),
      technologies: technologies.slice(0, 30),
      ...(url ? { url } : {}),
    });
  }

  const seen = new Set<string>();
  return results.filter((item) => {
    const key = normalizedKey(item.name) + "|" + normalizedKey(item.url ?? "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inlineSkills(text: string): ParsedResumeSkill[] {
  const match = text.match(
    /(?:technical\s+)?skills?\s*[:\-]\s*([^\n]{3,400})/i,
  );
  if (!match?.[1]) return [];
  return parseSkills([match[1]]);
}

function collapseSummary(lines: string[]): string | undefined {
  const text = cleanLines(lines).join(" ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.slice(0, 2000);
}

export interface LocalParseResult {
  parsed: ParsedResume;
  warnings: string[];
}

/**
 * Deterministic, local-first resume parser.
 * It only copies text found in the resume — it never invents facts.
 */
export function parseResumeLocally(text: string): LocalParseResult {
  const warnings: string[] = [];
  const { sections, preamble, foundHeadings } = splitSections(text);

  if (!foundHeadings) {
    warnings.push(
      "Clear section headings nahi mile. Contact info parse kiya, baaki sections manually check karo.",
    );
  }

  const experience = parseExperience(sections.experience ?? []);
  if ((sections.experience?.length ?? 0) > 0 && experience.length === 0) {
    warnings.push("Experience section mila par entries parse nahi hui — review me manually add karo.");
  }

  const education = parseEducation(sections.education ?? []);
  if ((sections.education?.length ?? 0) > 0 && education.length === 0) {
    warnings.push("Education section mila par entries parse nahi hui.");
  }

  let skills = parseSkills(sections.skills ?? []);
  if (skills.length === 0) skills = inlineSkills(text);

  const summary =
    collapseSummary(sections.summary ?? []) ??
    (foundHeadings ? undefined : collapseSummary(preamble.slice(1, 8)));

  const parsed: ParsedResume = {
    contact: extractContact(text, preamble),
    ...(summary ? { summary } : {}),
    experience,
    education,
    skills,
    projects: parseProjects(sections.projects ?? []),
  };

  return { parsed, warnings };
}

export function emptyParsedResume(): ParsedResume {
  return {
    contact: {},
    experience: [],
    education: [],
    skills: [],
    projects: [],
  };
}
