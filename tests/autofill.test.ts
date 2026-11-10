import assert from "node:assert/strict";
import type { CustomField, DetectedField, FieldMapping, Profile } from "@jobpilot/shared";
import {
  buildProfileFacts,
  fingerprintField,
  matchFields,
} from "../apps/extension/src/features/autofill/matcher";

function field(partial: Partial<DetectedField>): DetectedField {
  return {
    elementId: partial.elementId ?? `field-${Math.random().toString(36).slice(2)}`,
    domPath: "input",
    tag: partial.tag ?? "input",
    inputType: partial.inputType ?? "text",
    label: partial.label ?? "",
    labelSource: partial.labelSource ?? "nearby",
    required: false,
    visible: true,
    disabled: false,
    ...partial,
  };
}

const profile = {
  id: "profile-1",
  userId: "local-user",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  version: 1,
  firstName: "Raj",
  lastName: "Sharma",
  email: "raj@example.com",
  phone: "+91 98765 43210",
  dob: "1998-04-12",
  gender: "Male",
  address: { city: "Mumbai", state: "Maharashtra", country: "India" },
  links: { linkedin: "https://linkedin.com/in/raj" },
  headline: "MERN Stack Developer",
  summary: "2 years experience",
  preferences: { expectedCtc: 1200000, noticePeriodDays: 30, locations: ["Mumbai", "Remote"] },
} as Profile;

const facts = buildProfileFacts({
  profile,
  experiences: [
    {
      id: "exp-1",
      userId: "local-user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      version: 1,
      company: "Acme Corp",
      designation: "Software Engineer",
      description: ["Built APIs"],
      startDate: "2024-01-01",
      current: true,
    },
  ],
  educations: [],
  skills: [{ id: "skill-1", userId: "local-user", createdAt: "", updatedAt: "", version: 1, name: "React" }],
  customFields: [],
  customValues: [],
  defaultResumeTitle: "My Resume",
});

const fields = [
  field({ label: "First Name", name: "firstName", inputType: "text" }),
  field({ label: "Email Address", name: "email", inputType: "email", autocomplete: "email" }),
  field({ label: "Phone Number", name: "phone", inputType: "tel" }),
  field({ label: "Address", name: "address", inputType: "text" }),
  field({ label: "Current Company", name: "company", inputType: "text" }),
  field({ label: "Current Designation", name: "designation", inputType: "text" }),
  field({ label: "Date of Birth", name: "dob", inputType: "date" }),
  field({ label: "Gender", name: "gender", inputType: "select", options: ["Male", "Female", "Other"] }),
  field({ label: "I agree to the terms and conditions", name: "consent", inputType: "checkbox" }),
  field({ label: "Primary reach", name: "primary_reach", inputType: "text" }),
  field({ label: "Resume / CV", name: "resume", inputType: "file" }),
];

const result = matchFields(fields, facts, [], []);

const firstName = result.matches.find((match) => match.profileKey === "personal.firstName");
assert.ok(firstName, "firstName should match");
assert.equal(firstName.field.label, "First Name");
assert.ok(firstName.confidence >= 0.95);

const email = result.matches.find((match) => match.profileKey === "personal.email");
assert.ok(email, "email should match");
assert.equal(email.confidence, 0.99);

const company = result.matches.find((match) => match.profileKey === "current.company");
assert.ok(company, "company should match");
assert.equal(company.value, "Acme Corp");

const dob = result.matches.find((match) => match.profileKey === "personal.dob");
assert.ok(dob, "dob should match");
assert.equal(dob.value, "1998-04-12");

const gender = result.matches.find((match) => match.profileKey === "personal.gender");
assert.ok(gender, "gender should match");
assert.equal(gender.value, "Male");

const consent = result.blocked.find((entry) => entry.field.name === "consent");
assert.ok(consent, "consent checkbox should be blocked");

const unknown = result.unmatched.find((entry) => entry.field.name === "primary_reach");
assert.ok(unknown, "unknown field should be unmatched");

const missingAddress = result.unmatched.find((entry) => entry.field.name === "address");
assert.ok(missingAddress, "missing address must not be fuzzy-matched to email");

const resume = result.matches.find((match) => match.profileKey === "resume.file");
assert.ok(resume, "resume file should match");
assert.equal(resume.value, "My Resume");

// Stored mapping should win for a previously confirmed field.
const storedField = field({ label: "Reach me at", name: "reach", inputType: "text" });
const mapping: FieldMapping = {
  id: "mapping-1",
  userId: "local-user",
  domain: "jobs.example.com",
  fingerprint: fingerprintField(storedField),
  profileKey: "personal.email",
  confidence: 0.95,
  confirmedByUser: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const storedResult = matchFields([storedField], facts, [mapping], []);
assert.equal(storedResult.matches.length, 1);
assert.equal(storedResult.matches[0]?.profileKey, "personal.email");
assert.equal(storedResult.matches[0]?.source, "stored");

// Sensitive custom fields must be marked for review.
const sensitiveField: CustomField = {
  id: "custom-1",
  userId: "local-user",
  createdAt: "",
  updatedAt: "",
  version: 1,
  label: "Visa status",
  fieldKey: "visa_status",
  fieldType: "boolean",
  isSensitive: true,
};
const sensitiveFacts = buildProfileFacts({
  profile,
  experiences: [],
  educations: [],
  skills: [],
  customFields: [sensitiveField],
  customValues: [{ fieldId: "custom-1", value: true }],
});
const sensitiveResult = matchFields(
  [field({ label: "Visa status", name: "visa_status", inputType: "checkbox" })],
  sensitiveFacts,
  [],
  [sensitiveField],
);
assert.equal(sensitiveResult.matches.length, 1);
assert.equal(sensitiveResult.matches[0]?.value, true);
assert.equal(sensitiveResult.matches[0]?.sensitive, true);
assert.equal(sensitiveResult.matches[0]?.requiresReview, true);

console.log("autofill matcher tests: PASS");
