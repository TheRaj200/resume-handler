import type {
  DetectedField,
  ExtensionMessage,
  FillPlan,
  FillResult,
  FormScanResult,
  LabelSource,
  MessageResponse,
  PageContext,
} from "@jobpilot/shared";

/* ------------------------------------------------------------------ */
/* Module state                                                        */
/* ------------------------------------------------------------------ */

const fieldElements = new Map<string, HTMLElement>();
const radioGroups = new Map<string, HTMLInputElement[]>();
const sessions = new Map<string, { snapshots: Snapshot[] }>();

let fieldCounter = 0;
let observer: MutationObserver | null = null;
let observerTimer: number | undefined;
let lastFieldCount = -1;

interface Snapshot {
  elementId: string;
  element: HTMLElement;
  value: string;
  checked?: boolean;
  textContent?: string;
  radioGroup?: HTMLInputElement[];
  checkedRadio?: HTMLInputElement | null;
  outline?: string;
}

interface ScanState {
  fields: DetectedField[];
  framesScanned: number;
  crossOriginIframes: number;
  crossOriginIframeOrigins: string[];
  possibleClosedShadowRoots: number;
  visitedRoots: Set<Document | ShadowRoot>;
  processedRadios: Set<HTMLInputElement>;
}

/* ------------------------------------------------------------------ */
/* Page context / JD extraction                                        */
/* ------------------------------------------------------------------ */

interface JobPostingLd {
  title?: string;
  company?: string;
  description?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function readJobPosting(): JobPostingLd | null {
  const scripts = Array.from(
    document.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  );

  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }

    const candidates = Array.isArray(parsed) ? parsed : [parsed];

    for (const candidate of candidates) {
      const record = asRecord(candidate);
      if (!record) continue;

      const type = record["@type"];
      const isJobPosting =
        type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
      if (!isJobPosting) continue;

      const organization = asRecord(record["hiringOrganization"]);
      const companyName = organization?.["name"];

      return {
        title: typeof record["title"] === "string" ? record["title"] : undefined,
        company: typeof companyName === "string" ? companyName : undefined,
        description:
          typeof record["description"] === "string" ? record["description"] : undefined,
      };
    }
  }

  return null;
}

function stripHtml(html: string): string {
  const documentFragment = new DOMParser().parseFromString(html, "text/html");
  return documentFragment.body.textContent?.trim() ?? "";
}

function getPageContext(): PageContext {
  const posting = readJobPosting();

  return {
    url: location.href,
    domain: location.hostname,
    title: document.title,
    jobTitle: posting?.title,
    company: posting?.company,
    hasJobPosting: Boolean(posting),
  };
}

function extractJd(): string {
  const posting = readJobPosting();
  if (posting?.description) return stripHtml(posting.description).slice(0, 50_000);

  const main = document.querySelector<HTMLElement>("main") ?? document.body;
  return (main.innerText ?? "").trim().slice(0, 50_000);
}

/* ------------------------------------------------------------------ */
/* Scanner                                                             */
/* ------------------------------------------------------------------ */

function textFromElement(element: Element | null): string {
  return (element?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function findById(root: Document | ShadowRoot, id: string): Element | null {
  return root.querySelector(`[id="${CSS.escape(id)}"]`);
}

function detectLabel(
  element: HTMLElement,
  root: Document | ShadowRoot,
): { label: string; source: LabelSource } {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => textFromElement(findById(root, id)))
      .filter(Boolean);
    if (parts.length > 0) return { label: parts.join(" "), source: "aria" };
  }

  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return { label: ariaLabel, source: "aria" };

  if (
    element.tagName === "INPUT" ||
    element.tagName === "SELECT" ||
    element.tagName === "TEXTAREA"
  ) {
    const formElement = element as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const label = formElement.labels?.[0]?.textContent?.replace(/\s+/g, " ").trim();
    if (label) return { label, source: "for" };
  }

  const wrappingLabel = element.closest("label")?.textContent?.replace(/\s+/g, " ").trim();
  if (wrappingLabel) return { label: wrappingLabel, source: "wrapping" };

  const placeholder = element.getAttribute("placeholder")?.trim();
  if (placeholder) return { label: placeholder, source: "placeholder" };

  const name = element.getAttribute("name")?.trim();
  if (name) return { label: name, source: "name" };

  const previous = element.previousElementSibling;
  if (previous) {
    const nearby = textFromElement(previous);
    if (nearby) return { label: nearby, source: "nearby" };
  }

  return { label: element.id || element.tagName.toLowerCase(), source: "nearby" };
}

function detectGroupLabel(
  radio: HTMLInputElement,
  root: Document | ShadowRoot,
): { label: string; source: LabelSource } {
  const fieldset = radio.closest("fieldset");
  const legend = textFromElement(fieldset?.querySelector("legend") ?? null);
  if (legend) return { label: legend, source: "wrapping" };

  const group = radio.closest('[role="radiogroup"]');
  const groupLabel = group?.getAttribute("aria-label")?.trim();
  if (groupLabel) return { label: groupLabel, source: "aria" };

  return detectLabel(radio, root);
}

function isVisible(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return false;

  const style = view.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function buildDomPath(element: Element): string {
  const parts: string[] = [];
  let current: Element | null = element;

  while (current && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const id = current.id ? `#${current.id}` : "";
    const name = current.getAttribute("name");
    parts.unshift(`${tag}${id}${name ? `[name="${name}"]` : ""}`);
    current = current.parentElement;
  }

  return parts.join(" > ");
}

function addField(
  element: HTMLElement,
  root: Document | ShadowRoot,
  state: ScanState,
  options: {
    tag: DetectedField["tag"];
    inputType: string;
    options?: string[];
    currentValue?: string;
    confidenceCap?: number;
  },
): void {
  if (state.fields.length >= 300) return;

  const elementId = `jp-field-${++fieldCounter}`;
  fieldElements.set(elementId, element);

  const { label, source } = detectLabel(element, root);
  const isFormElement =
    element.tagName === "INPUT" ||
    element.tagName === "SELECT" ||
    element.tagName === "TEXTAREA";

  state.fields.push({
    elementId,
    domPath: buildDomPath(element),
    tag: options.tag,
    inputType: options.inputType,
    label,
    labelSource: source,
    placeholder: element.getAttribute("placeholder") ?? undefined,
    name: element.getAttribute("name") ?? undefined,
    id: element.id || undefined,
    autocomplete: element.getAttribute("autocomplete") ?? undefined,
    required: isFormElement ? (element as HTMLInputElement).required : false,
    visible: isVisible(element),
    disabled: isFormElement ? (element as HTMLInputElement).disabled : false,
    options: options.options,
    currentValue: options.currentValue,
    confidenceCap: options.confidenceCap,
  });
}

function processRadioGroup(
  radio: HTMLInputElement,
  root: Document | ShadowRoot,
  state: ScanState,
): void {
  if (state.processedRadios.has(radio)) return;

  const name = radio.name;
  if (!name) return;

  const group = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  ).filter((candidate) => candidate.name === name && !candidate.disabled);

  if (group.length === 0) return;

  for (const candidate of group) state.processedRadios.add(candidate);

  const elementId = `jp-field-${++fieldCounter}`;
  radioGroups.set(elementId, group);
  fieldElements.set(elementId, group[0]!);

  const { label, source } = detectGroupLabel(radio, root);
  const options = group.map((candidate) => detectLabel(candidate, root).label);

  state.fields.push({
    elementId,
    domPath: buildDomPath(radio),
    tag: "input",
    inputType: "radio",
    label,
    labelSource: source,
    name,
    id: radio.id || undefined,
    autocomplete: radio.getAttribute("autocomplete") ?? undefined,
    required: group.some((candidate) => candidate.required),
    visible: group.some((candidate) => isVisible(candidate)),
    disabled: group.every((candidate) => candidate.disabled),
    options,
    currentValue: group.find((candidate) => candidate.checked)?.value,
    confidenceCap: 0.9,
  });
}

function processElement(
  element: HTMLElement,
  root: Document | ShadowRoot,
  state: ScanState,
): void {
  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    const type = input.type;

    if (type === "radio") {
      processRadioGroup(input, root, state);
      return;
    }

    if (type === "file") {
      if (!input.disabled) {
        addField(element, root, state, {
          tag: "input",
          inputType: "file",
          currentValue: input.files?.[0]?.name,
        });
      }
      return;
    }

    if (
      ["hidden", "password", "search", "submit", "button", "reset", "image"].includes(type)
    ) {
      return;
    }

    if (input.disabled || input.readOnly || !isVisible(element)) return;

    addField(element, root, state, {
      tag: "input",
      inputType: type,
      currentValue: type === "checkbox" ? (input.checked ? "true" : "false") : input.value,
      confidenceCap: type === "checkbox" ? 0.9 : undefined,
    });
    return;
  }

  if (element.tagName === "SELECT") {
    const select = element as HTMLSelectElement;
    if (select.disabled || !isVisible(element)) return;

    addField(element, root, state, {
      tag: "select",
      inputType: "select",
      options: Array.from(select.options)
        .map((option) => option.text.trim())
        .filter(Boolean),
      currentValue: select.value,
    });
    return;
  }

  if (element.tagName === "TEXTAREA") {
    const textarea = element as HTMLTextAreaElement;
    if (textarea.disabled || textarea.readOnly || !isVisible(element)) return;

    addField(element, root, state, {
      tag: "textarea",
      inputType: "textarea",
      currentValue: textarea.value,
    });
    return;
  }

  if (element.isContentEditable && isVisible(element)) {
    addField(element, root, state, {
      tag: "contenteditable",
      inputType: "contenteditable",
      currentValue: element.textContent ?? "",
      confidenceCap: 0.8,
    });
  }
}

function scanRoot(root: Document | ShadowRoot, depth: number, state: ScanState): void {
  if (depth > 3 || state.visitedRoots.has(root) || state.fields.length >= 300) return;
  state.visitedRoots.add(root);

  const allElements = Array.from(root.querySelectorAll<HTMLElement>("*"));

  for (const element of allElements) {
    if (element.shadowRoot) {
      scanRoot(element.shadowRoot, depth, state);
    } else if (element.tagName.includes("-") && element.childElementCount === 0) {
      state.possibleClosedShadowRoots += 1;
    }
  }

  const iframes = Array.from(root.querySelectorAll<HTMLIFrameElement>("iframe"));
  for (const iframe of iframes) {
    let frameDocument: Document | null = null;
    try {
      frameDocument = iframe.contentDocument;
    } catch {
      frameDocument = null;
    }

    if (frameDocument) {
      state.framesScanned += 1;
      scanRoot(frameDocument, depth + 1, state);
    } else {
      state.crossOriginIframes += 1;
      try {
        const origin = new URL(iframe.src, location.href).origin;
        if (!state.crossOriginIframeOrigins.includes(origin)) {
          state.crossOriginIframeOrigins.push(origin);
        }
      } catch {
        // Ignore malformed iframe URLs.
      }
    }
  }

  const fields = Array.from(
    root.querySelectorAll<HTMLElement>("input, select, textarea, [contenteditable='true']"),
  );

  for (const element of fields) {
    processElement(element, root, state);
  }
}

function scanForm(updateLastFieldCount = true): FormScanResult {
  fieldElements.clear();
  radioGroups.clear();
  fieldCounter = 0;

  const state: ScanState = {
    fields: [],
    framesScanned: 1,
    crossOriginIframes: 0,
    crossOriginIframeOrigins: [],
    possibleClosedShadowRoots: 0,
    visitedRoots: new Set(),
    processedRadios: new Set(),
  };

  scanRoot(document, 0, state);

  if (updateLastFieldCount) lastFieldCount = state.fields.length;
  ensureObserver();

  return {
    fields: state.fields,
    framesScanned: state.framesScanned,
    crossOriginIframes: state.crossOriginIframes,
    crossOriginIframeOrigins: state.crossOriginIframeOrigins,
    possibleClosedShadowRoots: state.possibleClosedShadowRoots,
  };
}

/* ------------------------------------------------------------------ */
/* Executor                                                            */
/* ------------------------------------------------------------------ */

function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

function setChecked(element: HTMLInputElement, checked: boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "checked");
  if (descriptor?.set) {
    descriptor.set.call(element, checked);
  } else {
    element.checked = checked;
  }

  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setSelectValue(element: HTMLSelectElement, value: string): void {
  const target = value.toLowerCase();
  const options = Array.from(element.options);

  const option =
    options.find((candidate) => candidate.value.toLowerCase() === target) ??
    options.find((candidate) => candidate.text.trim().toLowerCase() === target) ??
    options.find((candidate) => {
      const text = candidate.text.trim().toLowerCase();
      return text.length > 0 && text.includes(target);
    }) ??
    options.find((candidate) => {
      const text = candidate.text.trim().toLowerCase();
      return text.length > 0 && target.includes(text);
    });

  element.value = option?.value ?? value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

function formatDateValue(element: HTMLInputElement, value: string): string {
  if (element.type === "date") return value;

  const placeholder = (element.getAttribute("placeholder") ?? "").toLowerCase();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;

  const [, year, month, day] = match;
  if (placeholder.includes("dd/mm") || placeholder.includes("dd-mm")) {
    return `${day}/${month}/${year}`;
  }
  if (placeholder.includes("mm/dd") || placeholder.includes("mm-dd")) {
    return `${month}/${day}/${year}`;
  }
  if (placeholder.includes("dd.mm")) {
    return `${day}.${month}.${year}`;
  }
  return value;
}

function attachResume(
  element: HTMLInputElement,
  attachment: { name: string; mimeType: string; base64: string },
): void {
  const binary = atob(attachment.base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const file = new File([bytes], attachment.name, { type: attachment.mimeType });
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(file);
  element.files = dataTransfer.files;
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function verifyValue(
  field: DetectedField,
  element: HTMLElement,
  expected: string | number | boolean | string[],
): boolean {
  const expectedText = Array.isArray(expected) ? expected.join(", ") : String(expected);

  if (field.inputType === "radio") {
    const group = radioGroups.get(field.elementId) ?? [];
    const optionIndex =
      field.options?.findIndex((option) => option.toLowerCase() === expectedText.toLowerCase()) ?? -1;

    return group.some((radio, index) => {
      if (!radio.checked) return false;
      return (
        radio.value.toLowerCase() === expectedText.toLowerCase() ||
        (optionIndex >= 0 && index === optionIndex)
      );
    });
  }

  if (field.inputType === "checkbox") {
    return (element as HTMLInputElement).checked === Boolean(expected);
  }

  if (field.inputType === "file") {
    const files = (element as HTMLInputElement).files;
    return files !== null && files.length > 0;
  }

  if (field.tag === "contenteditable") {
    return (element.textContent ?? "").includes(expectedText);
  }

  if (field.tag === "select") {
    const select = element as HTMLSelectElement;
    const selected = select.options[select.selectedIndex];
    return (
      selected?.value.toLowerCase() === expectedText.toLowerCase() ||
      selected?.text.trim().toLowerCase() === expectedText.toLowerCase()
    );
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(expectedText)) {
    return (element as HTMLInputElement).value.length > 0;
  }

  return (element as HTMLInputElement).value === expectedText;
}

function snapshotElement(field: DetectedField, element: HTMLElement): Snapshot {
  if (field.inputType === "radio") {
    const group = radioGroups.get(field.elementId) ?? [];
    return {
      elementId: field.elementId,
      element: group[0] ?? element,
      value: "",
      radioGroup: group,
      checkedRadio: group.find((radio) => radio.checked) ?? null,
      outline: element.style.outline,
    };
  }

  if (field.tag === "contenteditable") {
    return {
      elementId: field.elementId,
      element,
      value: "",
      textContent: element.textContent ?? "",
      outline: element.style.outline,
    };
  }

  if (element.tagName === "INPUT") {
    const input = element as HTMLInputElement;
    return {
      elementId: field.elementId,
      element,
      value: input.value,
      checked: input.checked,
      outline: element.style.outline,
    };
  }

  if (element.tagName === "SELECT" || element.tagName === "TEXTAREA") {
    const formElement = element as HTMLSelectElement | HTMLTextAreaElement;
    return {
      elementId: field.elementId,
      element,
      value: formElement.value,
      outline: element.style.outline,
    };
  }

  return { elementId: field.elementId, element, value: "", outline: element.style.outline };
}

function executeFillPlan(plan: FillPlan): FillResult {
  const snapshots: Snapshot[] = [];
  const filled: string[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  const needsReview: string[] = [];

  for (const match of plan.matches) {
    const element = fieldElements.get(match.field.elementId);

    if (!element || !element.isConnected) {
      failed.push(match.field.elementId);
      continue;
    }

    if (match.value === null || match.value === undefined || match.value === "") {
      skipped.push(match.field.elementId);
      continue;
    }

    const snapshot = snapshotElement(match.field, element);
    snapshots.push(snapshot);

    try {
      if (match.field.inputType === "radio") {
        const group = radioGroups.get(match.field.elementId) ?? [];
        const target = String(match.value).toLowerCase();
        const optionIndex =
          match.field.options?.findIndex(
            (option) => option.toLowerCase() === target,
          ) ?? -1;
        const radio =
          group.find((candidate) => candidate.value.toLowerCase() === target) ??
          (optionIndex >= 0 ? group[optionIndex] : undefined) ??
          group.find((candidate) => candidate.value.toLowerCase().includes(target));

        if (!radio) throw new Error("No matching radio option");
        setChecked(radio, true);
      } else if (match.field.inputType === "checkbox") {
        const checked =
          typeof match.value === "boolean" ? match.value : String(match.value).toLowerCase() === "true";
        setChecked(element as HTMLInputElement, checked);
      } else if (match.field.inputType === "file") {
        if (!plan.resumeAttachment) throw new Error("No resume attachment");
        attachResume(element as HTMLInputElement, plan.resumeAttachment);
      } else if (match.field.tag === "contenteditable") {
        element.textContent = String(match.value);
        element.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (match.field.tag === "select") {
        setSelectValue(element as HTMLSelectElement, String(match.value));
      } else if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
        const formElement = element as HTMLInputElement | HTMLTextAreaElement;
        const value =
          match.field.inputType === "date" ||
          /^\d{4}-\d{2}-\d{2}$/.test(String(match.value))
            ? formatDateValue(element as HTMLInputElement, String(match.value))
            : String(match.value);
        setNativeValue(formElement, value);
      } else {
        throw new Error("Unsupported field");
      }

      if (!verifyValue(match.field, element, match.value)) {
        failed.push(match.field.elementId);
        continue;
      }

      if (plan.highlight) {
        element.style.outline = "2px solid rgba(99, 102, 241, 0.9)";
      }

      filled.push(match.field.elementId);
      if (match.requiresReview) needsReview.push(match.field.elementId);
    } catch {
      failed.push(match.field.elementId);
    }
  }

  sessions.set(plan.sessionId, { snapshots });

  return {
    sessionId: plan.sessionId,
    filled,
    skipped,
    failed,
    needsReview,
  };
}

function undoFill(sessionId: string): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;

  for (const snapshot of [...session.snapshots].reverse()) {
    if (!snapshot.element.isConnected) continue;

    if (snapshot.radioGroup) {
      for (const radio of snapshot.radioGroup) {
        setChecked(radio, radio === snapshot.checkedRadio);
      }
    } else if (snapshot.textContent !== undefined) {
      snapshot.element.textContent = snapshot.textContent;
      snapshot.element.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (snapshot.element.tagName === "INPUT") {
      const input = snapshot.element as HTMLInputElement;
      if (input.type === "file") {
        input.value = "";
      } else if (input.type === "checkbox") {
        setChecked(input, snapshot.checked ?? false);
      } else {
        setNativeValue(input, snapshot.value);
      }
    } else if (
      snapshot.element.tagName === "SELECT" ||
      snapshot.element.tagName === "TEXTAREA"
    ) {
      setNativeValue(snapshot.element as HTMLSelectElement | HTMLTextAreaElement, snapshot.value);
    }

    if (snapshot.outline !== undefined) {
      snapshot.element.style.outline = snapshot.outline;
    }
  }

  sessions.delete(sessionId);
  return true;
}

/* ------------------------------------------------------------------ */
/* Dynamic form observer                                               */
/* ------------------------------------------------------------------ */

function ensureObserver(): void {
  if (observer) return;

  observer = new MutationObserver(() => {
    if (observerTimer) window.clearTimeout(observerTimer);
    observerTimer = window.setTimeout(() => {
      const previousFieldCount = lastFieldCount;
      const result = scanForm(false);
      if (result.fields.length !== previousFieldCount) {
        lastFieldCount = result.fields.length;
        void chrome.runtime
          .sendMessage({ type: "FORM_CHANGED", data: { fieldCount: result.fields.length } })
          .catch(() => undefined);
      }
    }, 500);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["type", "name", "disabled", "hidden", "style", "class"],
  });
}

/* ------------------------------------------------------------------ */
/* Message routing                                                     */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener(
  (
    message: ExtensionMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: MessageResponse) => void,
  ) => {
    switch (message.type) {
      case "PING":
        sendResponse({ ok: true, data: { pong: true } });
        return false;

      case "GET_PAGE_CONTEXT":
        sendResponse({ ok: true, data: getPageContext() });
        return false;

      case "SCAN_FORM":
      case "RESCAN_FORM":
        sendResponse({ ok: true, data: scanForm() });
        return false;

      case "EXTRACT_JD":
        sendResponse({ ok: true, data: { text: extractJd() } });
        return false;

      case "FILL_FORM":
        try {
          sendResponse({ ok: true, data: executeFillPlan(message.plan) });
        } catch (error) {
          sendResponse({
            ok: false,
            error: {
              code: "FILL_FAILED",
              message: error instanceof Error ? error.message : "Fill failed",
            },
          });
        }
        return false;

      case "UNDO_FILL":
        sendResponse({ ok: true, data: { undone: undoFill(message.sessionId) } });
        return false;

      case "HIGHLIGHT_FIELDS":
        for (const elementId of message.elementIds) {
          const element = fieldElements.get(elementId);
          if (element) element.style.outline = "2px solid rgba(99, 102, 241, 0.9)";
        }
        sendResponse({ ok: true });
        return false;

      default:
        sendResponse({
          ok: false,
          error: { code: "UNKNOWN_MESSAGE", message: "Unknown message type" },
        });
        return false;
    }
  },
);
