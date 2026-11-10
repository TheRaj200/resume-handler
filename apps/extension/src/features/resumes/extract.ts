import mammoth from "mammoth";
import type { ResumeExtraction } from "@jobpilot/shared";

/** Below this many extracted characters we treat a PDF as scanned/image-only. */
export const MIN_EXTRACTED_CHARS = 80;

/** Cap text sent to the parser/AI so a huge file cannot blow the prompt budget. */
export const MAX_EXTRACTED_CHARS = 60_000;

export function fileExtension(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function inferResumeExtension(fileName?: string, mimeType?: string): string {
  const fromName = fileName ? fileExtension(fileName) : "";
  if (fromName === "pdf" || fromName === "docx" || fromName === "doc") {
    return fromName;
  }
  if (mimeType?.includes("pdf")) return "pdf";
  if (mimeType?.includes("wordprocessingml")) return "docx";
  if (mimeType?.includes("msword")) return "doc";
  return "pdf";
}

export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Pure helper so the scanned-PDF rule is unit-testable. */
export function looksLikeScannedPdf(text: string, pageCount?: number): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < MIN_EXTRACTED_CHARS) return true;
  if (pageCount && pageCount > 0 && compact.length / pageCount < 20) return true;
  return false;
}

async function extractPdfText(file: File): Promise<ResumeExtraction> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  });
  const document = await loadingTask.promise;

  try {
    const pages: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = "";

      for (const item of content.items) {
        if (!("str" in item)) continue;
        pageText += item.str;
        pageText += item.hasEOL ? "\n" : " ";
      }

      pages.push(pageText);
    }

    const text = normalizeExtractedText(pages.join("\n\n"));
    const warnings: string[] = [];

    if (looksLikeScannedPdf(text, document.numPages)) {
      warnings.push(
        "Is PDF se text nahi mila — ye scanned/image-based lagta hai. Text-based PDF ya DOCX upload karo.",
      );
    }

    return {
      kind: "pdf",
      text,
      pageCount: document.numPages,
      warnings,
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function extractDocxText(file: File): Promise<ResumeExtraction> {
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  const text = normalizeExtractedText(result.value);
  const warnings = result.messages
    .filter((message) => message.type === "error")
    .map((message) => message.message);

  if (!text) {
    warnings.push("DOCX me koi readable text nahi mila.");
  }

  return { kind: "docx", text, warnings };
}

export async function extractResumeText(file: File): Promise<ResumeExtraction> {
  const extension = fileExtension(file.name);

  if (extension === "pdf" || file.type === "application/pdf") {
    return extractPdfText(file);
  }

  if (
    extension === "docx" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return extractDocxText(file);
  }

  if (extension === "doc" || file.type === "application/msword") {
    throw new Error(
      "Legacy .doc files se text nahi nikal sakte. File ko DOCX ya PDF me save karke upload karo.",
    );
  }

  throw new Error("Only PDF and DOCX files can be parsed. Use PDF or DOCX for import.");
}

/** Short, human-readable preview for the review screen. */
export function extractionSummary(extraction: ResumeExtraction): string {
  const chars = extraction.text.length;
  const pages = extraction.pageCount ? ` · ${extraction.pageCount} page(s)` : "";
  return `${chars.toLocaleString()} characters${pages}`;
}

export function truncateForParsing(text: string): {
  text: string;
  truncated: boolean;
} {
  if (text.length <= MAX_EXTRACTED_CHARS) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, MAX_EXTRACTED_CHARS), truncated: true };
}
