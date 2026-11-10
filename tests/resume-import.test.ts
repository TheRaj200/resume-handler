import assert from "node:assert/strict";
import { parsedResumeSchema } from "@jobpilot/shared";
import {
  looksLikeScannedPdf,
  normalizeExtractedText,
  truncateForParsing,
  MAX_EXTRACTED_CHARS,
} from "../apps/extension/src/features/resumes/extract";
import {
  parseResumeLocally,
  parseSkills,
  splitSections,
} from "../apps/extension/src/features/resumes/parser";
import { coerceParsedResume } from "../apps/extension/src/features/resumes/ai-parse";
import { sourceFromParsedResume } from "../apps/extension/src/features/resume-studio/source-from-parsed";
import {
  buildLocalResume,
  validateFactLock,
} from "../apps/extension/src/features/resume-studio/generator";
import { analyzeJd } from "../apps/extension/src/features/resume-studio/jd";

console.log("Running resume import tests...");

const SAMPLE_RESUME = `RAJ SHARMA
Bengaluru, India
raj.sharma@example.com | +91 98765 43210
linkedin.com/in/rajsharma | github.com/rajsharma

SUMMARY
Full-stack engineer with 6 years of experience building web products.

EXPERIENCE
Senior Software Engineer | Acme Technologies
Jan 2021 - Present
- Built React dashboards used by 10k+ customers.
- Led migration from REST to GraphQL.

Software Engineer | Beta Solutions
Jun 2018 - Dec 2020
- Developed Node.js APIs for payments.
- Wrote automated tests with Vitest.

EDUCATION
B.Tech in Computer Science
National Institute of Technology
2014 - 2018
CGPA: 8.5

SKILLS
Languages: JavaScript, TypeScript, Python
Frameworks: React, Node.js, Express
Tools: Docker, AWS

PROJECTS
JobPilot AI
Chrome extension for job applications.
Tech: React, TypeScript, Dexie
https://github.com/raj/jobpilot`;

// 1. Scanned PDF detection
assert.equal(looksLikeScannedPdf(""), true);
assert.equal(looksLikeScannedPdf("short text"), true);
assert.equal(looksLikeScannedPdf("A".repeat(200)), false);
assert.equal(looksLikeScannedPdf("A".repeat(100), 10), true);
assert.equal(looksLikeScannedPdf("A".repeat(400), 2), false);

// 2. Text normalization
assert.equal(
  normalizeExtractedText("Hello\r\n\r\n\r\nWorld\u0000  "),
  "Hello\n\nWorld",
);

// 3. Truncation
const longText = "x".repeat(MAX_EXTRACTED_CHARS + 100);
assert.equal(truncateForParsing(longText).truncated, true);
assert.equal(truncateForParsing("short").truncated, false);

// 4. Section splitting
const sections = splitSections(SAMPLE_RESUME);
assert.equal(sections.foundHeadings, true);
assert.ok((sections.sections.experience?.length ?? 0) > 0);
assert.ok((sections.sections.education?.length ?? 0) > 0);
assert.ok((sections.sections.skills?.length ?? 0) > 0);

// 5. Local parse of a realistic resume
const { parsed, warnings } = parseResumeLocally(SAMPLE_RESUME);

assert.equal(parsed.contact.firstName, "RAJ");
assert.equal(parsed.contact.lastName, "SHARMA");
assert.equal(parsed.contact.email, "raj.sharma@example.com");
assert.match(parsed.contact.phone ?? "", /98765/);
assert.equal(parsed.contact.linkedin, "linkedin.com/in/rajsharma");
assert.equal(parsed.contact.github, "github.com/rajsharma");

assert.match(parsed.summary ?? "", /Full-stack engineer/);

assert.equal(parsed.experience.length, 2);
const firstJob = parsed.experience[0];
assert.ok(firstJob);
assert.equal(firstJob.company, "Acme Technologies");
assert.equal(firstJob.designation, "Senior Software Engineer");
assert.equal(firstJob.startDate, "Jan 2021");
assert.equal(firstJob.endDate, "Present");
assert.equal(firstJob.current, true);
assert.equal(firstJob.description.length, 2);

const secondJob = parsed.experience[1];
assert.ok(secondJob);
assert.equal(secondJob.company, "Beta Solutions");
assert.equal(secondJob.designation, "Software Engineer");
assert.equal(secondJob.current, undefined);

assert.equal(parsed.education.length, 1);
const education = parsed.education[0];
assert.ok(education);
assert.match(education.institution, /National Institute of Technology/);
assert.match(education.degree, /B\.Tech/);
assert.equal(education.field, "Computer Science");
assert.equal(education.graduationYear, 2018);
assert.equal(education.grade, "8.5");

const skillNames = parsed.skills.map((skill) => skill.name);
assert.ok(skillNames.includes("JavaScript"));
assert.ok(skillNames.includes("React"));
assert.ok(skillNames.includes("Docker"));
assert.equal(
  parsed.skills.find((skill) => skill.name === "JavaScript")?.category,
  "Languages",
);

assert.equal(parsed.projects.length, 1);
const project = parsed.projects[0];
assert.ok(project);
assert.equal(project.name, "JobPilot AI");
assert.ok(project.technologies.includes("React"));
assert.equal(project.url, "https://github.com/raj/jobpilot");

assert.deepEqual(warnings, []);

// 6. Skills parsing dedupes and keeps categories
const skills = parseSkills(["Languages: Java, Python, Java", "Tools: Docker; AWS"]);
assert.equal(skills.filter((skill) => skill.name === "Java").length, 1);
assert.equal(skills.find((skill) => skill.name === "Docker")?.category, "Tools");

// 7. AI payload coercion repairs common shape drift, then Zod validates
const coerced = coerceParsedResume({
  contact: null,
  experience: [
    { company: "Acme", title: "Developer", description: null },
    { company: "", designation: "" },
  ],
  education: [
    { institution: "NIT", degree: "B.Tech", graduationYear: "2020" },
  ],
  skills: ["React", { name: "Node.js", category: "Runtime" }],
  projects: [{ name: "Pilot", technologies: "React, Node" }],
});
const aiParsed = parsedResumeSchema.parse(coerced);
assert.equal(aiParsed.experience[0]?.designation, "Developer");
assert.equal(aiParsed.experience[0]?.description.length, 0);
assert.equal(aiParsed.education[0]?.graduationYear, 2020);
assert.equal(aiParsed.skills[0]?.name, "React");
assert.deepEqual(aiParsed.projects[0]?.technologies, ["React", "Node"]);

// 8. Resume without headings still yields contact info + a warning
const noHeadings = parseResumeLocally(
  "Priya Verma\npriya@example.com\n+91 90000 11111\nSkills: Java, SQL",
);
assert.equal(noHeadings.parsed.contact.firstName, "Priya");
assert.equal(noHeadings.parsed.contact.email, "priya@example.com");
assert.ok(noHeadings.parsed.skills.some((skill) => skill.name === "Java"));
assert.ok(noHeadings.warnings.length > 0);

// 9. Experience entries without blank lines still split on header + date pairs
const noBlankLines = parseResumeLocally(`EXPERIENCE
Senior Engineer | Acme Technologies
Jan 2021 - Present
- Built dashboards.
Software Engineer | Beta Solutions
Jun 2018 - Dec 2020
- Built APIs.`);
assert.equal(noBlankLines.parsed.experience.length, 2);
assert.equal(noBlankLines.parsed.experience[0]?.company, "Acme Technologies");
assert.equal(noBlankLines.parsed.experience[1]?.company, "Beta Solutions");

// 10. Quick-tailor source maps parsed facts and passes fact-lock
const quickSource = sourceFromParsedResume(parsed);
assert.equal(quickSource.profile?.email, "raj.sharma@example.com");
assert.equal(quickSource.experiences.length, 2);
assert.equal(quickSource.skills.length, parsed.skills.length);
assert.equal(quickSource.projects.length, 1);
assert.equal(quickSource.experiences[0]?.id, "quick-tailor-exp-0");

const quickAnalysis = await analyzeJd(
  "Senior Frontend Engineer. Required: React, TypeScript, Node.js, GraphQL.",
  quickSource.skills.map((skill) => skill.name),
);
const quickDraft = buildLocalResume({
  source: quickSource,
  targetRole: "Senior Frontend Engineer",
  templateId: "ats-classic",
  analysis: quickAnalysis,
  provider: "local",
  model: "deterministic",
  jdHash: quickAnalysis.hash,
});
const quickLock = validateFactLock(quickDraft, quickSource);
assert.equal(quickLock.ok, true, quickLock.errors.join(" "));
assert.equal(quickDraft.experience.length, 2);
assert.ok(quickDraft.skills.some((skill) => skill.name === "React"));

console.log("resume import tests: PASS");
