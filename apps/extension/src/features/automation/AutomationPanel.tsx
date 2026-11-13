import { useEffect, useRef, useState } from "react";
import { aiSettingsSchema, type AISettings } from "@jobpilot/shared";
import { Badge, Button, Card, Field, Notice, inputClass } from "../../components/ui";
import { callAiJson, hasProviderPermission } from "../../lib/ai-provider";
import { getUnlockedApiKey } from "../../lib/crypto-vault";

type Company = { title: string; url: string; snippet: string; company: string; domain: string };
type Opening = { title: string; url: string; details: string };
type CompanyRecord = {
  careersUrl?: string;
  linkedinUrl?: string;
  openings: Opening[];
  status: "new" | "researched" | "no-openings" | "failed";
  note?: string;
  aiSummary?: string;
};

function linkedInPeopleUrl(linkedinUrl: string): string | undefined {
  try {
    const slug = new URL(linkedinUrl).pathname.split("/").filter(Boolean)[1];
    if (!slug) return undefined;
    return `https://www.linkedin.com/company/${slug}/people/?keywords=${encodeURIComponent("recruiter talent acquisition hiring")}`;
  } catch {
    return undefined;
  }
}

function findLinkedInCompanyUrl(page: ExtractedPage, companyName: string): string | undefined {
  const candidates = page.links.filter((link) => /linkedin\.com\/company\//i.test(link.href));
  if (!candidates.length) return undefined;
  const normalized = companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const matched = candidates.find((link) => {
    const slug = link.href.toLowerCase().split("/company/")[1]?.split(/[/?#]/)[0] ?? "";
    return slug.replace(/[^a-z0-9]/g, "").includes(normalized) || normalized.includes(slug.replace(/[^a-z0-9]/g, ""));
  });
  return (matched ?? candidates[0])?.href;
}

type ExtractedPage = {
  pageTitle: string;
  text: string;
  links: Array<{ text: string; href: string }>;
};

const STORAGE_KEY = "jobpilot.automation.discovery";
const RECORDS_KEY = "jobpilot.automation.records";
const DEFAULT_SETTINGS: AISettings = {
  provider: "gemini",
  model: "gemini-2.5-flash",
  baseUrl: "",
  temperature: 0.2,
  maxOutputTokens: 2048,
};

const CAREERS_PATTERN = /career|careers|jobs|job-openings|join[-_ ]?us|work[-_ ]?with[-_ ]?us|hiring|vacanc|openings|opportunit/i;
const NOISE_PATTERN = /privacy|terms|cookie|login|sign[-_ ]?in|about|contact|blog|press|investor|legal|sitemap|facebook|twitter|instagram|youtube/i;

function companyFromUrl(url: string): { company: string; domain: string } {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const name = (host.split(".")[0] ?? host).replace(/[-_]/g, " ");
    return { company: name.replace(/\b\w/g, (letter) => letter.toUpperCase()), domain: host };
  } catch {
    return { company: "Unknown company", domain: "" };
  }
}

function parsePastedCompanies(text: string): Company[] {
  const seen = new Set<string>();
  const list: Company[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const value = raw.trim();
    if (!value) continue;
    const url = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.includes(".")) continue;
      const details = companyFromUrl(url);
      if (!details.domain || seen.has(details.domain)) continue;
      seen.add(details.domain);
      list.push({ title: details.company, url, snippet: "", ...details });
    } catch {
      continue;
    }
  }
  return list;
}

function absolute(href: string, base: string): string {
  try {
    return new URL(href, base).href;
  } catch {
    return href;
  }
}

function sameSite(url: string, base: string): boolean {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === new URL(base).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
}

export function AutomationPanel() {
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [skills, setSkills] = useState("");
  const [withinDays, setWithinDays] = useState("7");
  const [maxCompanies, setMaxCompanies] = useState("8");
  const [useAi, setUseAi] = useState(true);
  const [pastedUrls, setPastedUrls] = useState("");
  const [pastedOnly, setPastedOnly] = useState(false);

  const [companies, setCompanies] = useState<Company[]>([]);
  const [records, setRecords] = useState<Record<string, CompanyRecord>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [researchTabId, setResearchTabId] = useState<number | null>(null);
  const [currentStep, setCurrentStep] = useState("");

  const cancelled = useRef(false);
  const researchTab = useRef<number | null>(null);

  useEffect(() => {
    void chrome.storage.local.get([STORAGE_KEY, RECORDS_KEY]).then((stored) => {
      const savedCompanies = stored[STORAGE_KEY];
      if (Array.isArray(savedCompanies)) setCompanies(savedCompanies as Company[]);
      const savedRecords = stored[RECORDS_KEY];
      if (savedRecords && typeof savedRecords === "object") setRecords(savedRecords as Record<string, CompanyRecord>);
    });
  }, []);

  async function persistCompanies(next: Company[]) {
    setCompanies(next);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  }

  async function persistRecords(next: Record<string, CompanyRecord>) {
    setRecords(next);
    await chrome.storage.local.set({ [RECORDS_KEY]: next });
  }

  function updateRecord(domain: string, patch: Partial<CompanyRecord>) {
    setRecords((previous) => {
      const base: CompanyRecord = { openings: [], status: "new" };
      const next: Record<string, CompanyRecord> = {
        ...previous,
        [domain]: { ...base, ...previous[domain], ...patch },
      };
      void chrome.storage.local.set({ [RECORDS_KEY]: next });
      return next;
    });
  }

  async function waitForTab(tabId: number, timeoutMs = 20000): Promise<void> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (cancelled.current) return;
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === "complete") return;
      } catch {
        return;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
    }
  }

  async function extractPage(tabId: number): Promise<ExtractedPage> {
    const response = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const clean = (value: string) => value.replace(/\s+/g, " ").trim();
        const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
          .map((anchor) => ({ text: clean(anchor.innerText || anchor.getAttribute("aria-label") || ""), href: anchor.href }))
          .filter((link) => link.href.startsWith("http") && link.text.length > 1)
          .slice(0, 400);
        return {
          pageTitle: document.title,
          text: clean(document.body?.innerText ?? "").slice(0, 20000),
          links,
        };
      },
    });
    return (response[0]?.result ?? { pageTitle: "", text: "", links: [] }) as ExtractedPage;
  }

  function guessCareersUrl(page: ExtractedPage, base: string): string | undefined {
    const candidates = page.links.filter((link) => sameSite(link.href, base) && CAREERS_PATTERN.test(`${link.text} ${link.href}`) && !NOISE_PATTERN.test(link.text));
    const ranked = candidates
      .map((link) => {
        let score = 0;
        if (/careers?$/i.test(link.text)) score += 3;
        if (/\/careers?\/?$/i.test(new URL(link.href).pathname)) score += 4;
        if (/jobs?/i.test(link.href)) score += 2;
        if (/join/i.test(link.text)) score += 1;
        return { link, score };
      })
      .sort((a, b) => b.score - a.score);
    return ranked[0]?.link.href;
  }

  function guessOpenings(page: ExtractedPage, base: string, targetRole: string): Opening[] {
    const roleWords = targetRole.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
    return page.links
      .filter((link) => !NOISE_PATTERN.test(`${link.text} ${link.href}`))
      .filter((link) => link.text.length > 3 && link.text.length < 140)
      .filter((link) => CAREERS_PATTERN.test(`${link.text} ${link.href}`) || roleWords.some((word) => link.text.toLowerCase().includes(word)))
      .filter((link, index, all) => all.findIndex((item) => item.href === link.href) === index)
      .map((link) => ({ title: link.text, url: absolute(link.href, base), details: "" }))
      .slice(0, 20);
  }

  async function loadAi(): Promise<{ settings: AISettings; apiKey: string } | null> {
    const apiKey = getUnlockedApiKey();
    if (!apiKey) return null;
    const stored = await chrome.storage.local.get("jobpilot.settings");
    const parsed = aiSettingsSchema.safeParse(stored["jobpilot.settings"]);
    const settings = parsed.success ? parsed.data : DEFAULT_SETTINGS;
    if (!(await hasProviderPermission(settings))) return null;
    return { settings, apiKey };
  }

  async function aiResearchPage(
    ai: { settings: AISettings; apiKey: string },
    company: Company,
    page: ExtractedPage,
  ): Promise<{ careersUrl?: string; linkedinUrl?: string; openings: Opening[]; summary?: string }> {
    const candidates = page.links.slice(0, 120).map((link) => ({ text: link.text, href: link.href }));
    const result = await callAiJson<{
      careersUrl: string;
      linkedinUrl: string;
      openings: Array<{ title: string; url: string }>;
      summary: string;
    }>({
      settings: ai.settings,
      apiKey: ai.apiKey,
      system:
        "You inspect public company and careers pages. Return JSON only: {careersUrl, linkedinUrl, openings:[{title,url}], summary}. Use only URLs that appear in the provided link list. Never invent jobs or links. Prefer the official LinkedIn company page (linkedin.com/company/...) for linkedinUrl. If the page has no relevant openings, return an empty openings array and say so in summary.",
      user: JSON.stringify({
        company: company.company,
        website: company.url,
        targetRole: role,
        targetLocation: location,
        skills,
        pageTitle: page.pageTitle,
        pageText: page.text.slice(0, 8000),
        links: candidates,
      }),
    });

    const validLinks = new Set(page.links.map((link) => link.href));
    const openings = (result.openings ?? [])
      .filter((opening) => opening.url && validLinks.has(opening.url))
      .map((opening) => ({ title: opening.title, url: opening.url, details: "" }))
      .slice(0, 20);
    const careersUrl =
      result.careersUrl && validLinks.has(result.careersUrl) && sameSite(result.careersUrl, company.url)
        ? result.careersUrl
        : undefined;
    const linkedinUrl =
      result.linkedinUrl && validLinks.has(result.linkedinUrl) && /linkedin\.com\/company\//i.test(result.linkedinUrl)
        ? result.linkedinUrl
        : undefined;
    return { careersUrl, linkedinUrl, openings, summary: result.summary };
  }

  async function researchCompany(ai: { settings: AISettings; apiKey: string } | null, company: Company, index: number, total: number) {
    const tabId = researchTab.current;
    if (!tabId) throw new Error("Research tab is not available.");

    setProgress(`${index + 1} of ${total}`);
    setCurrentStep(`Opening ${company.company}`);
    await chrome.tabs.update(tabId, { url: company.url });
    await waitForTab(tabId);
    if (cancelled.current) return;

    const homePage = await extractPage(tabId);
    let careersUrl = guessCareersUrl(homePage, company.url);
    let linkedinUrl = findLinkedInCompanyUrl(homePage, company.company);
    let openings: Opening[] = [];
    let summary: string | undefined;

    if (ai) {
      setCurrentStep(`AI reviewing ${company.company}`);
      const review = await aiResearchPage(ai, company, homePage);
      careersUrl = review.careersUrl ?? careersUrl;
      linkedinUrl = review.linkedinUrl ?? linkedinUrl;
      openings = review.openings;
      summary = review.summary;
    }

    // Never leave the company's own domain: a pasted URL must only be researched on its own site.
    if (careersUrl && !sameSite(careersUrl, company.url)) careersUrl = undefined;

    if (careersUrl) {
      setCurrentStep(`Checking careers page at ${company.company}`);
      await chrome.tabs.update(tabId, { url: careersUrl });
      await waitForTab(tabId);
      if (cancelled.current) return;
      const careersPage = await extractPage(tabId);
      linkedinUrl = linkedinUrl ?? findLinkedInCompanyUrl(careersPage, company.company);
      const pageOpenings = guessOpenings(careersPage, careersUrl, role);
      openings = openings.length ? openings : pageOpenings;
      if (ai && !openings.length) {
        setCurrentStep(`AI reading jobs at ${company.company}`);
        const review = await aiResearchPage(ai, company, careersPage);
        openings = review.openings;
        linkedinUrl = linkedinUrl ?? review.linkedinUrl;
        summary = summary ?? review.summary;
      }
    }

    updateRecord(company.domain, {
      careersUrl,
      linkedinUrl,
      openings,
      status: openings.length ? "researched" : "no-openings",
      note: careersUrl ? undefined : "No careers page found from the homepage.",
      aiSummary: summary,
    });
  }

  async function startResearch() {
    if (running) return;
    if (!role.trim() && !skills.trim()) {
      setError("Enter a role or skills first.");
      return;
    }
    setError(null);
    setMessage(null);
    cancelled.current = false;

    const googleAccess = await chrome.permissions.request({ origins: ["https://www.google.com/*"] });
    if (!googleAccess) {
      setError("Google access is required to read search results.");
      return;
    }
    const siteAccess = await chrome.permissions.request({ origins: ["https://*/*"] });
    if (!siteAccess) {
      setError("Website access is required to open company career pages automatically.");
      return;
    }

    const ai = useAi ? await loadAi() : null;
    if (useAi && !ai) {
      setMessage("AI key is locked or provider permission is missing. Continuing with on-page detection only.");
    }

    setRunning(true);
    setProgress("Starting");
    try {
      const after = new Date();
      after.setDate(after.getDate() - Number(withinDays));
      const query = [
        `"${role.trim() || skills.trim()}"`,
        location.trim() ? `"${location.trim()}"` : "",
        skills.trim() && role.trim() ? skills.trim() : "",
        "(careers OR jobs OR openings)",
        `after:${after.toISOString().slice(0, 10)}`,
      ].filter(Boolean).join(" ");

      const tab = await chrome.tabs.create({ url: `https://www.google.com/search?q=${encodeURIComponent(query)}`, active: false });
      if (tab.id === undefined) throw new Error("Could not open a research tab.");
      researchTab.current = tab.id;
      setResearchTabId(tab.id);
      await waitForTab(tab.id);
      if (cancelled.current) return;

      setCurrentStep("Reading Google results");
      const googlePage = await extractPage(tab.id);
      const seen = new Set<string>();
      const discovered: Company[] = [];
      const companyLimit = Math.max(1, Math.min(20, Number(maxCompanies) || 8));
      for (const link of googlePage.links) {
        if (!link.href.startsWith("http")) continue;
        if (/google\.|linkedin\.|facebook\.|youtube\.|twitter\.|instagram\.|glassdoor\.|naukri\.|indeed\./i.test(link.href)) continue;
        const details = companyFromUrl(link.href);
        if (!details.domain || seen.has(details.domain)) continue;
        seen.add(details.domain);
        discovered.push({ title: link.text, url: link.href, snippet: "", ...details });
        if (discovered.length >= companyLimit) break;
      }

      if (!discovered.length) throw new Error("No company websites found in the Google results. Try different keywords.");
      await runQueue(ai, discovered);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Research failed.");
    } finally {
      setRunning(false);
      setProgress("");
      setCurrentStep("");
    }
  }

  async function startPastedResearch() {
    if (running) return;
    const list = parsePastedCompanies(pastedUrls);
    if (!list.length) {
      setError("Paste at least one valid company URL, one per line.");
      return;
    }
    setError(null);
    setMessage(null);
    cancelled.current = false;

    const siteAccess = await chrome.permissions.request({ origins: ["https://*/*"] });
    if (!siteAccess) {
      setError("Website access is required to open the pasted company pages automatically.");
      return;
    }

    const ai = useAi ? await loadAi() : null;
    if (useAi && !ai) {
      setMessage("AI key is locked or provider permission is missing. Continuing with on-page detection only.");
    }

    setRunning(true);
    setProgress("Starting");
    try {
      await runQueue(ai, list);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Research failed.");
    } finally {
      setRunning(false);
      setProgress("");
      setCurrentStep("");
    }
  }

  async function runQueue(ai: { settings: AISettings; apiKey: string } | null, list: Company[]) {
    await persistCompanies(list);
    for (let index = 0; index < list.length; index += 1) {
      const company = list[index];
      if (!company || cancelled.current) break;
      try {
        await researchCompany(ai, company, index, list.length);
      } catch (cause) {
        updateRecord(company.domain, {
          openings: [],
          status: "failed",
          note: cause instanceof Error ? cause.message : "Research failed",
        });
      }
    }
    setMessage(cancelled.current ? "Research stopped." : `Research complete for ${list.length} companies.`);
  }

  function stopResearch() {
    cancelled.current = true;
    setCurrentStep("Stopping…");
  }

  async function focusResearchTab() {
    if (researchTabId === null) return;
    try {
      const tab = await chrome.tabs.get(researchTabId);
      if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(researchTabId, { active: true });
    } catch {
      setMessage("Research tab is closed. Run research again.");
    }
  }

  async function clearResults() {
    await chrome.storage.local.remove([STORAGE_KEY, RECORDS_KEY]);
    setCompanies([]);
    setRecords({});
    setMessage("Saved discovery results cleared.");
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Automation</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-100">Company research</h1>
        <p className="mt-1 max-w-xl text-xs leading-relaxed text-slate-400">
          JobPilot searches Google, opens each company site in one background tab, finds the careers page, and collects public openings into a single list.
        </p>
      </div>

      <Card className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Role or job title">
            <input className={inputClass} value={role} onChange={(event) => setRole(event.target.value)} placeholder="e.g. Full Stack Developer" />
          </Field>
          <Field label="Location">
            <input className={inputClass} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Indore" />
          </Field>
          <Field label="Skills or keywords">
            <input className={inputClass} value={skills} onChange={(event) => setSkills(event.target.value)} placeholder="e.g. React, Node.js" />
          </Field>
          <Field label="Published within">
            <select className={inputClass} value={withinDays} onChange={(event) => setWithinDays(event.target.value)}>
              <option value="1">1 day</option>
              <option value="3">3 days</option>
              <option value="7">1 week</option>
              <option value="14">2 weeks</option>
            </select>
          </Field>
          <Field label="Companies to check" hint="Manual number between 1 and 20.">
            <input
              type="number"
              min={1}
              max={20}
              className={inputClass}
              value={maxCompanies}
              onChange={(event) => setMaxCompanies(event.target.value)}
              disabled={pastedOnly}
            />
          </Field>
          <Field label="AI assist" hint="Uses your unlocked AI key to identify careers pages and relevant jobs.">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={useAi} onChange={(event) => setUseAi(event.target.checked)} className="h-3.5 w-3.5 accent-brand-500" />
              Use AI while researching
            </label>
          </Field>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
          <input
            id="pasted-only"
            type="checkbox"
            checked={pastedOnly}
            onChange={(event) => setPastedOnly(event.target.checked)}
            className="h-3.5 w-3.5 accent-brand-500"
          />
          <label htmlFor="pasted-only" className="text-[11px] text-slate-300">
            Only research my pasted URLs — no Google discovery, no other websites.
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-3">
          {pastedOnly ? (
            <Button onClick={() => void startPastedResearch()} disabled={running || !pastedUrls.trim()}>Start research</Button>
          ) : (
            <Button onClick={() => void startResearch()} disabled={running}>Start research</Button>
          )}
          {running ? <Button variant="secondary" onClick={stopResearch}>Stop</Button> : null}
          {researchTabId !== null ? <Button variant="ghost" onClick={() => void focusResearchTab()}>Show browser</Button> : null}
          {companies.length ? <Button variant="ghost" onClick={() => void clearResults()} disabled={running}>Clear saved</Button> : null}
        </div>

        {running ? (
          <div className="rounded-xl border border-brand-400/20 bg-brand-400/[0.06] px-3 py-2 text-[11px] text-brand-100/80">
            <div className="flex items-center justify-between gap-2">
              <span>{currentStep || "Working…"}</span>
              <span className="text-brand-200">{progress}</span>
            </div>
          </div>
        ) : null}
        {message ? <p className="text-[11px] text-slate-400">{message}</p> : null}
        {error ? <p className="text-[11px] text-rose-300">{error}</p> : null}
      </Card>

      <Card className={`space-y-3 ${pastedOnly ? "border-brand-400/30 bg-brand-400/[0.05]" : ""}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-slate-200">Company URL list</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              One URL per line. Each site is checked on its own domain only: open the site, find its careers page, then read the jobs listed there.
            </p>
          </div>
          {pastedOnly ? <Badge tone="indigo">In use</Badge> : null}
        </div>
        <textarea
          className={`${inputClass} min-h-[96px] resize-y font-mono text-[11px] leading-relaxed`}
          value={pastedUrls}
          onChange={(event) => setPastedUrls(event.target.value)}
          placeholder={"https://company-one.com\nhttps://company-two.com\ncompany-three.com"}
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-2">
          {pastedOnly ? null : (
            <Button variant="secondary" onClick={() => void startPastedResearch()} disabled={running || !pastedUrls.trim()}>
              Research pasted URLs
            </Button>
          )}
          {pastedUrls.trim() ? (
            <span className="text-[10px] text-slate-500">{parsePastedCompanies(pastedUrls).length} unique sites detected</span>
          ) : (
            <span className="text-[10px] text-slate-500">Nothing pasted yet</span>
          )}
        </div>
      </Card>

      <Notice title="Safe browser automation" tone="info">
        One background tab is reused for every site. JobPilot never logs in, applies, messages people, or bypasses verification. If a site shows a challenge, stop and continue manually.
      </Notice>

      {companies.length ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-slate-200">Companies</p>
            <span className="text-[10px] text-slate-500">{companies.length} found</span>
          </div>
          {companies.map((company) => {
            const record = records[company.domain];
            const status = record?.status ?? "new";
            const badge = status === "researched"
              ? { tone: "emerald" as const, label: `${record?.openings.length ?? 0} openings` }
              : status === "no-openings"
                ? { tone: "slate" as const, label: "No openings" }
                : status === "failed"
                  ? { tone: "rose" as const, label: "Failed" }
                  : { tone: "amber" as const, label: "Not checked" };

            return (
              <Card key={company.domain} className="space-y-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-100">{company.company}</p>
                    <p className="mt-0.5 truncate text-[11px] text-slate-500">{company.domain}</p>
                  </div>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </div>

                {record?.aiSummary ? <p className="text-[11px] leading-relaxed text-slate-400">{record.aiSummary}</p> : null}
                {record?.note ? <p className="text-[11px] leading-relaxed text-amber-200/70">{record.note}</p> : null}

                {record?.openings.length ? (
                  <div className="space-y-1 border-t border-white/[0.07] pt-2">
                    {record.openings.slice(0, 6).map((opening) => (
                      <a key={opening.url} href={opening.url} target="_blank" rel="noreferrer" className="block truncate text-[11px] text-slate-300 hover:text-brand-200">
                        {opening.title}
                      </a>
                    ))}
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2 border-t border-white/[0.07] pt-2">
                  <a className="text-[11px] font-medium text-brand-300 hover:text-brand-200" href={record?.careersUrl ?? company.url} target="_blank" rel="noreferrer">Open careers page</a>
                  {record?.linkedinUrl ? (
                    <>
                      <a className="text-[11px] font-medium text-brand-300 hover:text-brand-200" href={record.linkedinUrl} target="_blank" rel="noreferrer">Company LinkedIn</a>
                      <a className="text-[11px] font-medium text-brand-300 hover:text-brand-200" href={linkedInPeopleUrl(record.linkedinUrl) ?? record.linkedinUrl} target="_blank" rel="noreferrer">HR at {company.company}</a>
                    </>
                  ) : (
                    <a className="text-[11px] font-medium text-brand-300 hover:text-brand-200" href={`https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(company.company)}`} target="_blank" rel="noreferrer">Find company on LinkedIn</a>
                  )}
                  <a className="text-[11px] font-medium text-brand-300 hover:text-brand-200" href={`https://www.google.com/search?q=${encodeURIComponent(`${company.company} ${role} careers`)}`} target="_blank" rel="noreferrer">Search again</a>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed">
          <p className="text-sm font-medium text-slate-200">No research yet</p>
          <p className="mt-1 text-xs text-slate-400">Enter a role and location, then choose Start research.</p>
        </Card>
      )}
    </div>
  );
}
