import assert from "node:assert/strict";
import type {
  Education,
  Experience,
  Profile,
  Project,
  Skill,
} from "@jobpilot/shared";
import {
  analyzeJd,
} from "../apps/extension/src/features/resume-studio/jd";
import {
  applyAiSuggestions,
  buildLocalResume,
  experienceBulletFactId,
  validateFactLock,
  validateResumeShape,
  type ResumeSourceData,
} from "../apps/extension/src/features/resume-studio/generator";
import {
  generateResumePdf,
  resumeFileName,
} from "../apps/extension/src/features/resume-studio/pdf";

function base(id: string) {
  return {
    id,
    userId: "local-user",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
  };
}

const profile = {
  ...base("profile"),
  firstName: "Asha",
  lastName: "Verma",
  email: "asha@example.com",
  phone: "+91 98765 43210",
  headline: "Frontend Engineer",
  summary: "Frontend engineer focused on accessible, fast web applications.",
  address: { city: "Bengaluru", country: "India" },
  links: { github: "https://github.com/asha", linkedin: "https://linkedin.com/in/asha" },
} as Profile;

const currentExperience = {
  ...base("exp-current"),
  company: "Acme",
  designation: "Frontend Engineer",
  description: [
    "Built React dashboards with TypeScript for internal operations teams.",
    "Reduced page load time by 40% using code splitting and caching.",
  ],
  startDate: "2023-01-01",
  current: true,
} as Experience;

const olderExperience = {
  ...base("exp-old"),
  company: "Beta Labs",
  designation: "Software Engineer",
  description: ["Developed REST APIs with Node.js and Express."],
  startDate: "2021-01-01",
  endDate: "2022-12-31",
} as Experience;

const skills = [
  { ...base("skill-node"), name: "Node.js", category: "Backend" },
  { ...base("skill-react"), name: "React", category: "Frontend" },
  { ...base("skill-ts"), name: "TypeScript", category: "Language" },
] as Skill[];

const projects = [
  {
    ...base("project-portfolio"),
    name: "Portfolio",
    description: "A React portfolio with server-side rendering.",
    technologies: ["React", "TypeScript"],
    url: "https://example.com",
  },
] as Project[];

const educations = [
  {
    ...base("edu-1"),
    institution: "State University",
    degree: "B.Tech",
    field: "Computer Science",
    graduationYear: 2020,
    grade: "8.6 CGPA",
  },
] as Education[];

const source: ResumeSourceData = {
  profile,
  experiences: [olderExperience, currentExperience],
  educations,
  skills,
  projects,
};

const jd = `
Senior Frontend Developer at Acme.
We are looking for a Senior Frontend Developer with 5+ years of experience.
Required skills: React, TypeScript, Node.js, GraphQL, AWS, Docker, and CI/CD.
You will build accessible React interfaces, work with REST APIs, and improve performance.
Experience with testing using Jest and Playwright is a plus.
`;

const analysis = await analyzeJd(jd, skills.map((skill) => skill.name));

assert.equal(analysis.seniority, "Senior");
assert.equal(analysis.domain, "Frontend");
assert.ok(analysis.requiredSkills.includes("React"));
assert.ok(analysis.requiredSkills.includes("TypeScript"));
assert.ok(analysis.requiredSkills.includes("AWS"));
assert.ok(analysis.missingSkills.includes("AWS"));
assert.ok(analysis.missingSkills.includes("Docker"));
assert.ok(!analysis.missingSkills.includes("React"));
assert.ok(analysis.keywords.length > 0);
assert.equal(analysis.hash.length, 64);

const resume = buildLocalResume({
  source,
  targetRole: "Senior Frontend Developer",
  targetCompany: "Acme",
  templateId: "ats-classic",
  analysis,
  provider: "local",
  model: "deterministic",
  jdHash: analysis.hash,
});

assert.equal(resume.contact.name, "Asha Verma");
assert.equal(resume.contact.email, "asha@example.com");
assert.equal(resume.experience[0]?.company, "Acme");
assert.equal(
  resume.experience[0]?.bullets[0]?.sourceFactIds[0],
  experienceBulletFactId(currentExperience.id, 0),
);
assert.ok(!resume.skills.some((skill) => skill.name === "AWS"));
assert.ok(resume.skills.some((skill) => skill.name === "React"));
assert.equal(resume.projects[0]?.sourceFactIds[0], "project:project-portfolio");

const localFactLock = validateFactLock(resume, source);
assert.equal(localFactLock.ok, true, localFactLock.errors.join(" "));

const localShape = validateResumeShape(resume);
assert.equal(localShape.ok, true, localShape.errors.join(" "));

const aiResume = applyAiSuggestions(
  resume,
  {
    experience: [
      {
        id: currentExperience.id,
        bullets: [
          {
            text: "Built TypeScript React dashboards for internal operations teams.",
            sourceFactIds: [experienceBulletFactId(currentExperience.id, 0)],
          },
          {
            text: "Reduced page load time by 40% with code splitting and caching.",
            sourceFactIds: [experienceBulletFactId(currentExperience.id, 1)],
          },
        ],
      },
    ],
    skillOrder: ["skill-react", "skill-ts", "skill-node"],
  },
  source,
);

assert.equal(aiResume.experience[0]?.bullets[0]?.origin, "ai");
assert.equal(aiResume.skills[0]?.name, "React");
assert.equal(validateFactLock(aiResume, source).ok, true);

assert.throws(
  () =>
    applyAiSuggestions(
      resume,
      {
        experience: [
          {
            id: currentExperience.id,
            bullets: [
              {
                text: "Reduced page load time by 99% using code splitting.",
                sourceFactIds: [experienceBulletFactId(currentExperience.id, 1)],
              },
            ],
          },
        ],
      },
      source,
    ),
  /invented a number/i,
);

assert.throws(
  () =>
    applyAiSuggestions(
      resume,
      {
        experience: [
          {
            id: currentExperience.id,
            bullets: [
              {
                text: "Built a React dashboard.",
                sourceFactIds: ["unknown-fact"],
              },
            ],
          },
        ],
      },
      source,
    ),
  /unknown fact id/i,
);

assert.throws(
  () =>
    applyAiSuggestions(
      resume,
      {
        experience: [
          {
            id: currentExperience.id,
            bullets: [
              {
                text: "Built React dashboards with AWS.",
                sourceFactIds: [experienceBulletFactId(currentExperience.id, 0)],
              },
            ],
          },
        ],
      },
      source,
    ),
  /invented a skill/i,
);

const pdf = await generateResumePdf(resume);
assert.ok(pdf.length > 1000, `PDF too small: ${pdf.length} bytes`);
assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");

const fileName = resumeFileName(resume, "Acme Corp");
assert.match(fileName, /^Asha_Verma_Senior_Frontend_Developer_Acme_Corp_\d{4}-\d{2}-\d{2}\.pdf$/);

console.log("resume studio tests passed");
