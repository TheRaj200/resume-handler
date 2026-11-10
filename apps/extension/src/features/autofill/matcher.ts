import {
  AUTOFILL_AUTO_THRESHOLD,
  AUTOFILL_REVIEW_THRESHOLD,
  type CustomField,
  type CustomFieldValueData,
  type DetectedField,
  type Education,
  type Experience,
  type FieldMapping,
  type FieldMatch,
  type FieldMatchSource,
  type FieldValue,
  type Profile,
  type Skill,
} from "@jobpilot/shared";

export interface ProfileFact {
  key: string;
  label: string;
  value: string;
  sensitive?: boolean;
}

export interface UnmatchedField {
  field: DetectedField;
  suggestedKey?: string;
  reason: string;
}

export interface BlockedField {
  field: DetectedField;
  reason: string;
}

export interface MatchResult {
  matches: FieldMatch[];
  unmatched: UnmatchedField[];
  blocked: BlockedField[];
}

interface FieldDefinition {
  key: string;
  label: string;
  synonyms: string[];
  nameTokens?: string[];
  autocomplete?: string[];
  priority: number;
  custom?: boolean;
  sensitive?: boolean;
}

const AUTOCOMPLETE_MAP: Record<string, string> = {
  "given-name": "personal.firstName",
  "family-name": "personal.lastName",
  name: "personal.fullName",
  email: "personal.email",
  tel: "personal.phone",
  "tel-national": "personal.phone",
  bday: "personal.dob",
  sex: "personal.gender",
  "address-line1": "address.line1",
  "street-address": "address.line1",
  "address-line2": "address.line2",
  "address-level2": "address.city",
  "address-level1": "address.state",
  "postal-code": "address.zip",
  country: "address.country",
  "country-name": "address.country",
  organization: "current.company",
  "organization-title": "current.title",
  url: "links.portfolio",
};

const FIELD_DEFINITIONS: FieldDefinition[] = [
  {
    key: "personal.firstName",
    label: "First name",
    synonyms: ["first name", "given name", "forename", "first"],
    nameTokens: ["firstname", "first_name", "fname", "givenname"],
    autocomplete: ["given-name"],
    priority: 10,
  },
  {
    key: "personal.lastName",
    label: "Last name",
    synonyms: ["last name", "surname", "family name", "last"],
    nameTokens: ["lastname", "last_name", "lname", "surname", "familyname"],
    autocomplete: ["family-name"],
    priority: 10,
  },
  {
    key: "personal.fullName",
    label: "Full name",
    synonyms: ["full name", "your name", "applicant name", "name"],
    nameTokens: ["fullname", "full_name", "name", "applicantname"],
    autocomplete: ["name"],
    priority: 5,
  },
  {
    key: "personal.email",
    label: "Email",
    synonyms: ["email", "email address", "e-mail", "e mail", "mail id", "work email", "contact email"],
    nameTokens: ["email", "emailaddress", "email_address", "mail"],
    autocomplete: ["email"],
    priority: 10,
  },
  {
    key: "personal.phone",
    label: "Phone",
    synonyms: [
      "phone",
      "phone number",
      "mobile",
      "mobile number",
      "contact number",
      "cell",
      "cell phone",
      "whatsapp",
      "telephone",
      "contact no",
    ],
    nameTokens: [
      "phone",
      "phonenumber",
      "phone_number",
      "mobile",
      "mobilenumber",
      "contactnumber",
      "tel",
      "telephone",
    ],
    autocomplete: ["tel", "tel-national"],
    priority: 10,
  },
  {
    key: "personal.dob",
    label: "Date of birth",
    synonyms: ["date of birth", "dob", "birth date", "birthday"],
    nameTokens: ["dob", "dateofbirth", "birthdate", "birthday"],
    autocomplete: ["bday"],
    priority: 10,
  },
  {
    key: "personal.gender",
    label: "Gender",
    synonyms: ["gender", "sex"],
    nameTokens: ["gender", "sex"],
    autocomplete: ["sex"],
    priority: 8,
  },
  {
    key: "address.line1",
    label: "Address line 1",
    synonyms: [
      "address",
      "street address",
      "address line 1",
      "current address",
      "mailing address",
      "residential address",
    ],
    nameTokens: ["address", "address1", "addressline1", "street", "streetaddress"],
    autocomplete: ["address-line1", "street-address"],
    priority: 8,
  },
  {
    key: "address.line2",
    label: "Address line 2",
    synonyms: ["address line 2", "apartment", "suite", "unit", "building", "floor"],
    nameTokens: ["address2", "addressline2", "apartment", "suite", "unit"],
    autocomplete: ["address-line2"],
    priority: 7,
  },
  {
    key: "address.city",
    label: "City",
    synonyms: ["city", "town", "city name", "current city"],
    nameTokens: ["city", "town"],
    autocomplete: ["address-level2"],
    priority: 8,
  },
  {
    key: "address.state",
    label: "State",
    synonyms: ["state", "province", "region", "state name"],
    nameTokens: ["state", "province", "region"],
    autocomplete: ["address-level1"],
    priority: 8,
  },
  {
    key: "address.zip",
    label: "ZIP / PIN",
    synonyms: ["zip", "zip code", "postal code", "postcode", "pin code", "pincode", "pin"],
    nameTokens: ["zip", "zipcode", "postalcode", "pincode", "pin"],
    autocomplete: ["postal-code"],
    priority: 8,
  },
  {
    key: "address.country",
    label: "Country",
    synonyms: ["country", "nation", "country name"],
    nameTokens: ["country", "nation"],
    autocomplete: ["country", "country-name"],
    priority: 8,
  },
  {
    key: "links.linkedin",
    label: "LinkedIn",
    synonyms: ["linkedin", "linkedin profile", "linkedin url", "linkedin link"],
    nameTokens: ["linkedin"],
    priority: 9,
  },
  {
    key: "links.github",
    label: "GitHub",
    synonyms: ["github", "github profile", "github url", "github link"],
    nameTokens: ["github"],
    priority: 9,
  },
  {
    key: "links.portfolio",
    label: "Portfolio",
    synonyms: ["portfolio", "website", "personal website", "portfolio url", "blog", "web site"],
    nameTokens: ["portfolio", "website", "url", "blog"],
    autocomplete: ["url"],
    priority: 7,
  },
  {
    key: "links.twitter",
    label: "Twitter / X",
    synonyms: ["twitter", "twitter handle", "twitter profile", "x handle", "x profile"],
    nameTokens: ["twitter", "x"],
    priority: 7,
  },
  {
    key: "professional.headline",
    label: "Headline",
    synonyms: ["headline", "professional title", "profile summary", "summary"],
    nameTokens: ["headline", "professionaltitle", "summary"],
    priority: 8,
  },
  {
    key: "professional.summary",
    label: "Professional summary",
    synonyms: ["professional summary", "about you", "about me", "bio", "summary"],
    nameTokens: ["summary", "about", "bio", "profile", "description"],
    priority: 7,
  },
  {
    key: "current.company",
    label: "Current company",
    synonyms: [
      "current company",
      "current employer",
      "employer",
      "company name",
      "organization",
      "organisation",
      "company",
    ],
    nameTokens: ["company", "companyname", "employer", "organization", "organisation", "currentcompany"],
    autocomplete: ["organization"],
    priority: 9,
  },
  {
    key: "current.title",
    label: "Current designation",
    synonyms: [
      "current designation",
      "current role",
      "current position",
      "current job title",
      "job title",
      "designation",
      "title",
    ],
    nameTokens: [
      "currentdesignation",
      "currentrole",
      "currentposition",
      "currentjobtitle",
      "jobtitle",
      "designation",
      "title",
    ],
    autocomplete: ["organization-title"],
    priority: 9,
  },
  {
    key: "education.institution",
    label: "Institution",
    synonyms: ["college", "university", "school", "institution", "college name", "university name"],
    nameTokens: ["college", "university", "school", "institution"],
    priority: 8,
  },
  {
    key: "education.degree",
    label: "Degree",
    synonyms: ["degree", "qualification", "highest qualification", "course"],
    nameTokens: ["degree", "qualification", "course"],
    priority: 7,
  },
  {
    key: "education.field",
    label: "Field of study",
    synonyms: ["field of study", "major", "specialization", "stream", "branch"],
    nameTokens: ["fieldofstudy", "major", "specialization", "stream", "branch"],
    priority: 7,
  },
  {
    key: "education.graduationYear",
    label: "Graduation year",
    synonyms: [
      "graduation year",
      "passing year",
      "year of graduation",
      "year of passing",
      "graduation",
    ],
    nameTokens: ["graduationyear", "passingyear", "yearofgraduation", "yearofpassing"],
    priority: 8,
  },
  {
    key: "preferences.expectedCtc",
    label: "Expected CTC",
    synonyms: [
      "expected ctc",
      "expected salary",
      "expected compensation",
      "salary expectation",
      "expected package",
      "annual salary",
    ],
    nameTokens: ["expectedctc", "expectedsalary", "expectedcompensation", "salaryexpectation", "expectedpackage"],
    priority: 9,
  },
  {
    key: "preferences.noticePeriodDays",
    label: "Notice period",
    synonyms: ["notice period", "notice period days", "notice", "availability to join", "joining time"],
    nameTokens: ["noticeperiod", "noticeperioddays", "notice", "availability"],
    priority: 8,
  },
  {
    key: "preferences.locations",
    label: "Preferred location",
    synonyms: [
      "preferred location",
      "preferred locations",
      "location preference",
      "preferred city",
      "preferred work location",
    ],
    nameTokens: ["preferredlocation", "preferredlocations", "locationpreference", "preferredcity"],
    priority: 7,
  },
  {
    key: "preferences.currency",
    label: "Currency",
    synonyms: ["currency", "salary currency"],
    nameTokens: ["currency"],
    priority: 6,
  },
  {
    key: "skills",
    label: "Skills",
    synonyms: ["skills", "key skills", "technical skills", "core skills", "skill set"],
    nameTokens: ["skills", "keyskills", "technicalskills", "skillset"],
    priority: 8,
  },
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value: string): string {
  return normalize(value).replace(/\s+/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  return new RegExp(`(^|\\s)${escapeRegExp(phrase)}(?=\\s|$)`).test(text);
}

function tokenSet(value: string): Set<string> {
  const stopwords = new Set([
    "your",
    "the",
    "please",
    "enter",
    "select",
    "field",
    "value",
    "applicant",
    "candidate",
  ]);
  return new Set(
    normalize(value)
      .split(" ")
      .filter((token) => token.length > 0 && !stopwords.has(token)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

export function fingerprintField(field: DetectedField): string {
  const source = [
    normalize(field.label),
    compact(field.name ?? ""),
    field.inputType,
    (field.autocomplete ?? "").toLowerCase(),
  ].join("|");

  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function customValueToString(value: CustomFieldValueData): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function latestExperience(experiences: Experience[]): Experience | undefined {
  return [...experiences].sort((a, b) => {
    if ((a.current ?? false) !== (b.current ?? false)) return a.current ? -1 : 1;
    return (b.startDate ?? "").localeCompare(a.startDate ?? "");
  })[0];
}

function latestEducation(educations: Education[]): Education | undefined {
  return [...educations].sort(
    (a, b) => (b.graduationYear ?? 0) - (a.graduationYear ?? 0),
  )[0];
}

export interface BuildProfileFactsInput {
  profile?: Profile;
  experiences: Experience[];
  educations: Education[];
  skills: Skill[];
  customFields: CustomField[];
  customValues: Array<{ fieldId: string; value: CustomFieldValueData }>;
  defaultResumeTitle?: string;
}

export function buildProfileFacts(input: BuildProfileFactsInput): ProfileFact[] {
  const facts: ProfileFact[] = [];
  const add = (key: string, label: string, value: string | undefined, sensitive = false) => {
    if (value === undefined || value === null || value.trim() === "") return;
    facts.push({ key, label, value: value.trim(), sensitive });
  };

  const { profile, experiences, educations, skills, customFields, customValues } = input;
  const latestExp = latestExperience(experiences);
  const latestEdu = latestEducation(educations);

  add("personal.firstName", "First name", profile?.firstName);
  add("personal.lastName", "Last name", profile?.lastName);
  add(
    "personal.fullName",
    "Full name",
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" "),
  );
  add("personal.email", "Email", profile?.email);
  add("personal.phone", "Phone", profile?.phone);
  add("personal.dob", "Date of birth", profile?.dob);
  add("personal.gender", "Gender", profile?.gender);

  add("address.line1", "Address line 1", profile?.address?.line1);
  add("address.line2", "Address line 2", profile?.address?.line2);
  add("address.city", "City", profile?.address?.city);
  add("address.state", "State", profile?.address?.state);
  add("address.zip", "ZIP / PIN", profile?.address?.zip);
  add("address.country", "Country", profile?.address?.country);

  add("links.linkedin", "LinkedIn", profile?.links?.linkedin);
  add("links.github", "GitHub", profile?.links?.github);
  add("links.portfolio", "Portfolio", profile?.links?.portfolio);
  add("links.twitter", "Twitter / X", profile?.links?.twitter);

  add("professional.headline", "Headline", profile?.headline);
  add("professional.summary", "Professional summary", profile?.summary);

  add("current.company", "Current company", latestExp?.company);
  add("current.title", "Current designation", latestExp?.designation);

  add("education.institution", "Institution", latestEdu?.institution);
  add("education.degree", "Degree", latestEdu?.degree);
  add("education.field", "Field of study", latestEdu?.field);
  add("education.graduationYear", "Graduation year", latestEdu?.graduationYear?.toString());

  add(
    "preferences.expectedCtc",
    "Expected CTC",
    profile?.preferences?.expectedCtc?.toString(),
  );
  add(
    "preferences.noticePeriodDays",
    "Notice period",
    profile?.preferences?.noticePeriodDays?.toString(),
  );
  add(
    "preferences.locations",
    "Preferred location",
    profile?.preferences?.locations?.join(", "),
  );
  add("preferences.currency", "Currency", profile?.preferences?.currency);

  add(
    "skills",
    "Skills",
    skills
      .map((skill) => skill.name)
      .filter(Boolean)
      .join(", "),
  );

  for (const field of customFields) {
    const value = customValues.find((entry) => entry.fieldId === field.id)?.value;
    const stringValue = customValueToString(value ?? null);
    if (stringValue.trim()) {
      add(`custom.${field.fieldKey}`, field.label, stringValue, field.isSensitive);
    }
  }

  if (input.defaultResumeTitle) {
    add("resume.file", "Default resume", input.defaultResumeTitle);
  }

  return facts;
}

function customDefinitions(fields: CustomField[]): FieldDefinition[] {
  return fields.map((field) => ({
    key: `custom.${field.fieldKey}`,
    label: field.label,
    synonyms: [field.label, field.fieldKey],
    nameTokens: [compact(field.fieldKey), compact(field.label)],
    priority: 11,
    custom: true,
    sensitive: field.isSensitive,
  }));
}

interface Candidate {
  key: string;
  confidence: number;
  source: FieldMatchSource;
  sensitive: boolean;
}

function scoreDefinition(
  field: DetectedField,
  definition: FieldDefinition,
  factsByKey: Map<string, ProfileFact>,
  reviewThreshold = AUTOFILL_REVIEW_THRESHOLD,
): Candidate | null {
  const fact = factsByKey.get(definition.key);
  if (!fact) return null;

  const label = normalize(field.label);
  const placeholder = normalize(field.placeholder ?? "");
  const name = compact(field.name ?? "");
  const id = compact(field.id ?? "");
  const autocompleteTokens = (field.autocomplete ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);

  const autocompleteKey = definition.autocomplete
    ?.map((token) => token.toLowerCase())
    .find((token) => autocompleteTokens.includes(token));
  if (autocompleteKey) {
    return {
      key: definition.key,
      confidence: 0.99,
      source: "autocomplete",
      sensitive: fact.sensitive ?? definition.sensitive ?? false,
    };
  }

  if (
    definition.nameTokens?.some(
      (token) => token === name || (id && token === id),
    )
  ) {
    return {
      key: definition.key,
      confidence: 0.95,
      source: "name",
      sensitive: fact.sensitive ?? definition.sensitive ?? false,
    };
  }

  const phrases = [definition.label, ...definition.synonyms].map(normalize).filter(Boolean);

  if (phrases.some((phrase) => phrase === label)) {
    return {
      key: definition.key,
      confidence: 0.92,
      source: definition.custom ? "custom" : "label",
      sensitive: fact.sensitive ?? definition.sensitive ?? false,
    };
  }

  if (phrases.some((phrase) => phrase === placeholder)) {
    return {
      key: definition.key,
      confidence: 0.9,
      source: definition.custom ? "custom" : "label",
      sensitive: fact.sensitive ?? definition.sensitive ?? false,
    };
  }

  let containsBest = 0;
  for (const phrase of phrases) {
    if (!phrase) continue;
    if (containsPhrase(label, phrase) || containsPhrase(placeholder, phrase)) {
      const score = 0.85 + 0.05 * (phrase.length / Math.max(label.length, phrase.length, 1));
      containsBest = Math.max(containsBest, Math.min(0.89, score));
    }
  }
  if (containsBest > 0) {
    return {
      key: definition.key,
      confidence: containsBest,
      source: "synonym",
      sensitive: fact.sensitive ?? definition.sensitive ?? false,
    };
  }

  const fieldTokens = tokenSet(field.label);
  let fuzzyBest = 0;
  for (const phrase of phrases) {
    const score = jaccard(fieldTokens, tokenSet(phrase));
    // Fuzzy matching is deliberately conservative. Exact/synonym matching
    // handles known variants; a weak single-token overlap must not map a
    // generic field such as "Address" to "Email Address".
    if (score > 0.5) {
      fuzzyBest = Math.max(fuzzyBest, 0.6 + 0.24 * score);
    }
  }
  if (fuzzyBest >= reviewThreshold) {
    return {
      key: definition.key,
      confidence: Math.min(0.84, fuzzyBest),
      source: "fuzzy",
      sensitive: fact.sensitive ?? definition.sensitive ?? false,
    };
  }

  return null;
}

function blockedReason(field: DetectedField): string | null {
  const haystack = normalize(
    [field.label, field.name ?? "", field.placeholder ?? "", field.id ?? ""].join(" "),
  );

  if (["password", "hidden", "search", "submit", "button", "reset", "image"].includes(field.inputType)) {
    return "Unsupported input type";
  }
  if (/(captcha|recaptcha|terms|privacy|consent|agree|accept)/.test(haystack)) {
    return "Consent, CAPTCHA or legal fields are never filled";
  }
  return null;
}

export function resolveValue(field: DetectedField, fact: ProfileFact): FieldValue {
  if (field.inputType === "checkbox") {
    const value = fact.value.toLowerCase();
    return value === "true" || value === "yes" || value === "1";
  }

  if (field.inputType === "select" || field.inputType === "radio") {
    const options = field.options ?? [];
    const target = normalize(fact.value);
    const exact = options.find((option) => normalize(option) === target);
    if (exact) return exact;
    const partial = options.find(
      (option) => normalize(option).includes(target) || target.includes(normalize(option)),
    );
    if (partial) return partial;
    return fact.value;
  }

  if (field.inputType === "date") {
    return fact.value;
  }

  return fact.value;
}

export function matchFields(
  fields: DetectedField[],
  facts: ProfileFact[],
  mappings: FieldMapping[],
  customFields: CustomField[] = [],
  options: { autoThreshold?: number; reviewThreshold?: number } = {},
): MatchResult {
  const autoThreshold = options.autoThreshold ?? AUTOFILL_AUTO_THRESHOLD;
  const reviewThreshold = options.reviewThreshold ?? AUTOFILL_REVIEW_THRESHOLD;
  const factsByKey = new Map(facts.map((fact) => [fact.key, fact]));
  const definitions = [...FIELD_DEFINITIONS, ...customDefinitions(customFields)];
  const matches: FieldMatch[] = [];
  const unmatched: UnmatchedField[] = [];
  const blocked: BlockedField[] = [];
  const definitionPriority = new Map(definitions.map((item) => [item.key, item.priority]));

  for (const field of fields) {
    const blockedReasonText = blockedReason(field);
    if (blockedReasonText) {
      blocked.push({ field, reason: blockedReasonText });
      continue;
    }

    if (field.inputType === "file") {
      const resumeFact = factsByKey.get("resume.file");
      if (!resumeFact) {
        blocked.push({ field, reason: "No default resume available" });
        continue;
      }
      matches.push({
        field,
        profileKey: resumeFact.key,
        value: resumeFact.value,
        confidence: 0.95,
        requiresReview: false,
        sensitive: false,
        source: "manual",
      });
      continue;
    }

    const fingerprint = fingerprintField(field);
    const storedMapping = mappings.find(
      (mapping) => mapping.confirmedByUser && mapping.fingerprint === fingerprint,
    );

    const candidates: Candidate[] = [];

    if (storedMapping && factsByKey.has(storedMapping.profileKey)) {
      const fact = factsByKey.get(storedMapping.profileKey)!;
      candidates.push({
        key: fact.key,
        confidence: 0.95,
        source: "stored",
        sensitive: fact.sensitive ?? false,
      });
    }

    for (const definition of definitions) {
      const candidate = scoreDefinition(field, definition, factsByKey, reviewThreshold);
      if (candidate) candidates.push(candidate);
    }

    const priorityFor = (key: string) =>
      key === storedMapping?.profileKey ? 12 : definitionPriority.get(key) ?? 0;

    candidates.sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return priorityFor(b.key) - priorityFor(a.key);
    });

    const best = candidates[0] ?? null;

    if (!best) {
      unmatched.push({ field, reason: "No profile match" });
      continue;
    }

    const fact = factsByKey.get(best.key)!;
    const value = resolveValue(field, fact);
    if (value === null || value === undefined || value === "") {
      unmatched.push({ field, suggestedKey: best.key, reason: "Profile value is empty" });
      continue;
    }

    const confidence = Math.min(best.confidence, field.confidenceCap ?? 1);
    matches.push({
      field,
      profileKey: best.key,
      value,
      confidence,
      requiresReview: confidence < autoThreshold || best.sensitive,
      sensitive: best.sensitive,
      source: best.source,
    });
  }

  return { matches, unmatched, blocked };
}
