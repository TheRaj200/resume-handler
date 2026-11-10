import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { TailoredResume } from "@jobpilot/shared";
import { splitIntoResumeBullets } from "./generator";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT = 1.35;

const INK = rgb(0.08, 0.09, 0.12);
const MUTED = rgb(0.36, 0.39, 0.45);
const ACCENT = rgb(0.29, 0.33, 0.85);

function sanitizeText(text: string): string {
  return text
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2022/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const words = sanitizeText(text).split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    current = "";

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }

    let chunk = "";
    for (const character of word) {
      if (font.widthOfTextAtSize(chunk + character, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = character;
      } else {
        chunk += character;
      }
    }
    current = chunk;
  }

  if (current) lines.push(current);
  return lines;
}

function compactContact(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return value;
  }
}

class ResumeWriter {
  private page: PDFPage;
  private y: number;

  constructor(
    private readonly doc: PDFDocument,
    private readonly font: PDFFont,
    private readonly bold: PDFFont,
    private readonly accent: boolean,
  ) {
    this.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private addPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensureSpace(height: number): void {
    if (this.y - height < MARGIN) this.addPage();
  }

  text(
    value: string,
    options: {
      size?: number;
      bold?: boolean;
      color?: ReturnType<typeof rgb>;
      x?: number;
      maxWidth?: number;
      gapAfter?: number;
    } = {},
  ): void {
    const size = options.size ?? 10;
    const font = options.bold ? this.bold : this.font;
    const x = options.x ?? MARGIN;
    const maxWidth = options.maxWidth ?? CONTENT_WIDTH - (x - MARGIN);
    const lines = wrapText(value, font, size, maxWidth);
    const lineHeight = size * LINE_HEIGHT;

    for (const line of lines) {
      this.ensureSpace(lineHeight);
      this.page.drawText(line, {
        x,
        y: this.y - size,
        size,
        font,
        color: options.color ?? INK,
      });
      this.y -= lineHeight;
    }

    this.y -= options.gapAfter ?? 0;
  }

  heading(title: string): void {
    const size = 10.5;
    this.ensureSpace(size * 2.6);
    this.y -= 4;
    this.page.drawText(sanitizeText(title).toUpperCase(), {
      x: MARGIN,
      y: this.y - size,
      size,
      font: this.bold,
      color: this.accent ? ACCENT : INK,
    });
    this.y -= size * 1.5;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.7,
      color: this.accent ? ACCENT : rgb(0.72, 0.74, 0.78),
    });
    this.y -= 7;
  }

  bullet(text: string): void {
    const size = 9.6;
    const lineHeight = size * LINE_HEIGHT;
    const lines = wrapText(text, this.font, size, CONTENT_WIDTH - 14);

    for (let index = 0; index < lines.length; index += 1) {
      this.ensureSpace(lineHeight);
      if (index === 0) {
        this.page.drawText("-", {
          x: MARGIN,
          y: this.y - size,
          size,
          font: this.font,
          color: MUTED,
        });
      }
      this.page.drawText(lines[index] ?? "", {
        x: MARGIN + 12,
        y: this.y - size,
        size,
        font: this.font,
        color: INK,
      });
      this.y -= lineHeight;
    }
    this.y -= 1.5;
  }

  space(amount: number): void {
    this.y -= amount;
  }
}

export async function generateResumePdf(resume: TailoredResume): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const writer = new ResumeWriter(doc, font, bold, resume.templateId === "modern");

  if (resume.templateId === "modern") {
    // A subtle accent bar keeps the modern template text-based and ATS-safe.
    const page = doc.getPage(0);
    page.drawRectangle({
      x: 0,
      y: PAGE_HEIGHT - 8,
      width: PAGE_WIDTH,
      height: 8,
      color: ACCENT,
    });
  }

  writer.text(resume.contact.name, { size: 21, bold: true, gapAfter: 1 });
  if (resume.targetRole) {
    writer.text(resume.targetRole, {
      size: 10.5,
      bold: true,
      color: resume.templateId === "modern" ? ACCENT : MUTED,
      gapAfter: 2,
    });
  }

  const contact = [
    resume.contact.email,
    resume.contact.phone,
    resume.contact.location,
    resume.contact.linkedin,
    resume.contact.github,
    resume.contact.portfolio,
  ].filter(Boolean).map((value) => compactContact(String(value)));

  if (contact.length > 0) {
    writer.text(contact.join("  |  "), { size: 9, color: MUTED, gapAfter: 4 });
  }

  if (resume.summary) {
    writer.heading("Professional Summary");
    writer.text(resume.summary, { size: 9.6, gapAfter: 4 });
  }

  if (resume.experience.length > 0) {
    writer.heading("Experience");
    for (const experience of resume.experience) {
      writer.text(`${experience.company} - ${experience.designation}`, {
        size: 10.5,
        bold: true,
      });
      const dates = [experience.startDate, experience.endDate ?? "Present"]
        .filter(Boolean)
        .join(" - ");
      if (dates) writer.text(dates, { size: 8.8, color: MUTED, gapAfter: 2 });
      for (const bullet of experience.bullets) writer.bullet(bullet.text);
      writer.space(3);
    }
  }

  if (resume.skills.length > 0) {
    writer.heading("Skills");
    const byCategory = new Map<string, string[]>();
    for (const skill of resume.skills) {
      const category = skill.category || "General";
      const list = byCategory.get(category) ?? [];
      list.push(skill.name);
      byCategory.set(category, list);
    }
    for (const [category, names] of byCategory) {
      writer.text(`${category}: ${names.join(", ")}`, { size: 9.4, gapAfter: 1.5 });
    }
    writer.space(2);
  }

  if (resume.projects.length > 0) {
    writer.heading("Projects");
    for (const project of resume.projects) {
      writer.text(project.name, { size: 10.2, bold: true });
      if (project.technologies.length > 0) {
        writer.text(project.technologies.join(", "), { size: 8.8, color: MUTED });
      }
       for (const description of splitIntoResumeBullets(project.description, 4)) {
         if (description) writer.bullet(description);
       }
      if (project.url) writer.text(project.url, { size: 8.6, color: MUTED });
      writer.space(3);
    }
  }

  if (resume.education.length > 0) {
    writer.heading("Education");
    for (const education of resume.education) {
      const degree = [education.degree, education.field].filter(Boolean).join(", ");
      writer.text(`${education.institution} - ${degree}`, { size: 9.8, bold: true });
      const meta = [education.graduationYear?.toString(), education.grade]
        .filter(Boolean)
        .join("  |  ");
      if (meta) writer.text(meta, { size: 8.8, color: MUTED, gapAfter: 1.5 });
      writer.space(2);
    }
  }

  return doc.save();
}

export function resumeFileName(resume: TailoredResume, company?: string): string {
  const safe = (value: string) =>
    value
      .trim()
      .replace(/[^a-z0-9]+/gi, "_")
      .replace(/^_+|_+$/g, "");

  return (
    [
      safe(resume.contact.name) || "Resume",
      safe(resume.targetRole) || "Role",
      safe(company ?? ""),
      new Date().toISOString().slice(0, 10),
    ]
      .filter(Boolean)
      .join("_") + ".pdf"
  );
}
