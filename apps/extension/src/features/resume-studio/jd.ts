export interface JdAnalysis {
  keywords: string[];
  requiredSkills: string[];
  missingSkills: string[];
  seniority?: string;
  domain?: string;
  wordCount: number;
  hash: string;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "job",
  "just",
  "like",
  "make",
  "many",
  "may",
  "more",
  "most",
  "must",
  "my",
  "no",
  "not",
  "of",
  "on",
  "or",
  "our",
  "out",
  "over",
  "own",
  "role",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "up",
  "us",
  "use",
  "using",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "will",
  "with",
  "would",
  "you",
  "your",
  "years",
  "year",
  "experience",
  "work",
  "working",
  "team",
  "teams",
  "company",
  "candidate",
  "candidates",
  "applicant",
  "responsibilities",
  "requirements",
  "preferred",
  "required",
  "plus",
  "etc",
  "ability",
  "strong",
  "good",
  "great",
  "well",
  "knowledge",
  "understanding",
  "familiarity",
  "hands",
  "including",
  "include",
  "across",
  "within",
  "also",
  "other",
  "new",
  "well",
]);

const SKILL_ALIASES: Record<string, string[]> = {
  JavaScript: ["javascript", "js"],
  TypeScript: ["typescript", "ts"],
  React: ["react", "react.js", "reactjs"],
  "Next.js": ["next.js", "nextjs", "next js"],
  "Node.js": ["node.js", "nodejs", "node js", "node"],
  Express: ["express", "express.js", "expressjs"],
  "REST APIs": ["rest", "rest api", "restful", "rest apis"],
  GraphQL: ["graphql"],
  MongoDB: ["mongodb", "mongo"],
  PostgreSQL: ["postgresql", "postgres"],
  MySQL: ["mysql"],
  SQL: ["sql"],
  Redis: ["redis"],
  Python: ["python"],
  Django: ["django"],
  Flask: ["flask"],
  Java: ["java"],
  Spring: ["spring", "spring boot"],
  "C#": ["c#", "csharp", ".net", "dotnet"],
  Go: ["golang", "go lang"],
  PHP: ["php"],
  Laravel: ["laravel"],
  AWS: ["aws", "amazon web services"],
  Azure: ["azure"],
  GCP: ["gcp", "google cloud"],
  Docker: ["docker", "containers"],
  Kubernetes: ["kubernetes", "k8s"],
  Terraform: ["terraform"],
  Jenkins: ["jenkins"],
  "CI/CD": ["ci/cd", "cicd", "continuous integration", "continuous delivery"],
  Git: ["git", "github", "gitlab"],
  Linux: ["linux", "unix"],
  HTML: ["html", "html5"],
  CSS: ["css", "css3"],
  Tailwind: ["tailwind", "tailwindcss"],
  Bootstrap: ["bootstrap"],
  Sass: ["sass", "scss"],
  Redux: ["redux", "redux toolkit"],
  "React Native": ["react native"],
  Flutter: ["flutter"],
  "Android": ["android", "kotlin"],
  iOS: ["ios", "swift"],
  "Machine Learning": ["machine learning", "ml"],
  "Deep Learning": ["deep learning"],
  TensorFlow: ["tensorflow"],
  PyTorch: ["pytorch"],
  Pandas: ["pandas"],
  NumPy: ["numpy"],
  "Data Analysis": ["data analysis", "analytics"],
  Tableau: ["tableau"],
  "Power BI": ["power bi", "powerbi"],
  Kafka: ["kafka"],
  RabbitMQ: ["rabbitmq"],
  Microservices: ["microservices", "micro services"],
  "System Design": ["system design", "distributed systems"],
  Agile: ["agile", "scrum", "kanban"],
  Jira: ["jira"],
  Figma: ["figma"],
  SEO: ["seo"],
  "Unit Testing": ["unit testing", "jest", "vitest", "mocha"],
  "Cypress": ["cypress"],
  Playwright: ["playwright"],
  "Selenium": ["selenium"],
};

const SENIORITY_PATTERNS: Array<[string, RegExp]> = [
  ["Intern", /\bintern(ship)?\b/i],
  ["Junior", /\b(junior|jr\.?|entry[- ]level|fresher)\b/i],
  ["Mid-level", /\b(mid[- ]level|intermediate)\b/i],
  ["Senior", /\b(senior|sr\.?)\b/i],
  ["Lead", /\b(lead|team lead|tech lead)\b/i],
  ["Principal", /\bprincipal\b/i],
  ["Manager", /\b(engineering manager|manager|head of)\b/i],
  ["Director", /\bdirector\b/i],
];

const DOMAIN_PATTERNS: Array<[string, RegExp]> = [
  ["Frontend", /\b(frontend|front[- ]end|ui developer|react|angular|vue)\b/i],
  ["Backend", /\b(backend|back[- ]end|api|server[- ]side|microservices)\b/i],
  ["Full Stack", /\b(full[- ]stack|fullstack)\b/i],
  ["Data", /\b(data engineer|data scientist|analytics|machine learning|ml engineer)\b/i],
  ["DevOps", /\b(devops|sre|platform engineer|infrastructure|kubernetes|terraform)\b/i],
  ["Mobile", /\b(mobile|android|ios|react native|flutter)\b/i],
  ["QA", /\b(qa|quality assurance|test automation|sdet)\b/i],
  ["Product", /\b(product manager|product owner|product)\b/i],
  ["Design", /\b(ux|ui designer|product designer|figma)\b/i],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTerm(text: string, term: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, "i").test(text);
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function findSkillsInText(text: string): string[] {
  return Object.entries(SKILL_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => containsTerm(text, alias)))
    .map(([canonical]) => canonical);
}

export function keywordOverlap(text: string, keywords: string[]): number {
  const normalized = text.toLowerCase();
  return keywords.reduce(
    (score, keyword) => (normalized.includes(keyword.toLowerCase()) ? score + 1 : score),
    0,
  );
}

export async function analyzeJd(
  jd: string,
  profileSkills: string[] = [],
): Promise<JdAnalysis> {
  const normalizedProfileSkills = new Set(
    profileSkills.map((skill) => skill.trim().toLowerCase()).filter(Boolean),
  );

  const requiredSkills = findSkillsInText(jd);

  const missingSkills = requiredSkills.filter(
    (skill) => !normalizedProfileSkills.has(skill.toLowerCase()),
  );

  const frequencies = new Map<string, number>();
  for (const token of tokenize(jd)) {
    if (token.length < 3 || STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
    frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  }

  const keywords = [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 18)
    .map(([token]) => token);

  for (const skill of requiredSkills) {
    if (!keywords.includes(skill.toLowerCase())) keywords.push(skill.toLowerCase());
  }

  const seniority = SENIORITY_PATTERNS.find(([, pattern]) => pattern.test(jd))?.[0];
  const domain = DOMAIN_PATTERNS.find(([, pattern]) => pattern.test(jd))?.[0];

  return {
    keywords: [...new Set(keywords)].slice(0, 24),
    requiredSkills,
    missingSkills,
    seniority,
    domain,
    wordCount: tokenize(jd).length,
    hash: await hashText(jd),
  };
}
