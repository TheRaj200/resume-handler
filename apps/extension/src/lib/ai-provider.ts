import type { AISettings } from "@jobpilot/shared";

export interface AiJsonRequest {
  settings: AISettings;
  apiKey: string;
  system: string;
  user: string;
}

function parseJsonResponse(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned);
}

async function readError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return `${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 400)}` : ""}`;
}

export function providerOrigin(settings: AISettings): string {
  if (settings.provider === "gemini") return "https://generativelanguage.googleapis.com";
  if (settings.provider === "openai") return "https://api.openai.com";
  if (settings.provider === "inception") return "https://api.inceptionlabs.ai";

  if (!settings.baseUrl) {
    throw new Error("OpenAI-compatible provider ke liye Base URL chahiye.");
  }

  return new URL(settings.baseUrl).origin;
}

export async function hasProviderPermission(settings: AISettings): Promise<boolean> {
  try {
    const origin = providerOrigin(settings);
    return chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

export async function requestProviderPermission(settings: AISettings): Promise<boolean> {
  const origin = providerOrigin(settings);
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}

export async function callAiJson<T>(request: AiJsonRequest): Promise<T> {
  const { settings, apiKey } = request;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90_000);

  try {
    let endpoint: string;
    let headers: Record<string, string>;
    let body: unknown;

    if (settings.provider === "gemini") {
      const model = settings.model.replace(/^models\//, "");
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      headers = { "content-type": "application/json" };
      body = {
        system_instruction: { parts: [{ text: request.system }] },
        contents: [{ role: "user", parts: [{ text: request.user }] }],
        generationConfig: {
          temperature: settings.temperature,
          maxOutputTokens: settings.maxOutputTokens,
          responseMimeType: "application/json",
        },
      };
    } else {
      const base =
        settings.provider === "openai"
          ? "https://api.openai.com/v1"
          : settings.provider === "inception"
            ? "https://api.inceptionlabs.ai/v1"
            : (settings.baseUrl ?? "").replace(/\/+$/, "");

      if (!base) throw new Error("Base URL is required for OpenAI-compatible providers.");

      endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
      headers = {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      };
      body = {
        model: settings.model,
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        temperature: settings.temperature,
        ...(settings.provider === "inception"
          ? { max_completion_tokens: settings.maxOutputTokens }
          : { max_tokens: settings.maxOutputTokens }),
        ...(settings.provider === "openai" || settings.provider === "inception"
          ? { response_format: { type: "json_object" } }
          : {}),
      };
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`AI provider error: ${await readError(response)}`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    let text = "";

    if (settings.provider === "gemini") {
      const candidates = data.candidates as
        | Array<{ content?: { parts?: Array<{ text?: string }> } }>
        | undefined;
      text =
        candidates?.[0]?.content?.parts
          ?.map((part) => part.text ?? "")
          .join("")
          .trim() ?? "";
    } else {
      const choices = data.choices as
        | Array<{ message?: { content?: string } }>
        | undefined;
      text = choices?.[0]?.message?.content?.trim() ?? "";
    }

    if (!text) throw new Error("AI provider returned an empty response.");
    return parseJsonResponse(text) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("AI request timed out after 90 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function testProviderConnection(
  settings: AISettings,
  apiKey: string,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    let endpoint: string;
    let headers: Record<string, string>;

    if (settings.provider === "gemini") {
      endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      headers = {};
    } else {
      const base =
        settings.provider === "openai"
          ? "https://api.openai.com/v1"
          : settings.provider === "inception"
            ? "https://api.inceptionlabs.ai/v1"
            : (settings.baseUrl ?? "").replace(/\/+$/, "");
      if (!base) throw new Error("Base URL is required for OpenAI-compatible providers.");
      endpoint = `${base}/models`;
      headers = { authorization: `Bearer ${apiKey}` };
    }

    const response = await fetch(endpoint, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("Authentication failed (401/403). API key check karo.");
      }
      if (response.status === 429) {
        throw new Error("Rate limit reached (429). Thodi der baad retry karo.");
      }
      throw new Error(`Provider returned ${response.status} ${response.statusText}.`);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Connection timeout (15 seconds). Endpoint/API availability check karo.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
