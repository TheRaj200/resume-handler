import type { FillPlan, FillResult, FormScanResult, PageContext } from "./types";

export type ExtensionMessage =
  | { type: "PING" }
  | { type: "GET_PAGE_CONTEXT" }
  | { type: "SCAN_FORM"; options?: { includeIframes?: boolean } }
  | { type: "FILL_FORM"; plan: FillPlan }
  | { type: "UNDO_FILL"; sessionId: string }
  | { type: "RESCAN_FORM" }
  | { type: "EXTRACT_JD" }
  | { type: "HIGHLIGHT_FIELDS"; elementIds: string[] }
  | { type: "FORM_CHANGED"; data: { fieldCount: number } };

export interface MessageError {
  code: string;
  message: string;
}

export interface MessageResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: MessageError;
}

export type PageContextResponse = MessageResponse<PageContext>;
export type ScanFormResponse = MessageResponse<FormScanResult>;
export type FillFormResponse = MessageResponse<FillResult>;
