import "server-only";

import { withGeminiUsageAccounting } from "@/lib/vibodeGeminiUsageAccounting";

// --- Phase 2F-F: server-only Gemini call for auto-floor calibration quads ----
// A focused helper for the lab vision floor route. It deliberately does NOT
// reuse vibodeGeminiRoomRead (different prompt, structured schema, and response
// shape — reusing it would mix unrelated room-read label semantics).
//
// It follows the SAME project conventions as vibodeGeminiRoomRead:
// - Gemini REST v1beta generateContent
// - inlineData image bytes
// - responseMimeType: application/json (+ responseSchema here)
// - low temperature
// - wrapped in withGeminiUsageAccounting
//
// It returns the parsed-but-UNTRUSTED raw JSON. All validation/canonicalization
// happens later in the Phase 2F-B mapper; this helper never trusts the output.

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractResponseText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;

  const directText = safeStr(record.text) ?? safeStr(record.outputText);
  if (directText) return directText;

  const candidates = Array.isArray(record.candidates) ? record.candidates : [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as Record<string, unknown>).content;
    if (!content || typeof content !== "object") continue;
    const parts = Array.isArray((content as Record<string, unknown>).parts)
      ? ((content as Record<string, unknown>).parts as unknown[])
      : [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const text = safeStr((part as Record<string, unknown>).text);
      if (text) return text;
    }
  }

  return null;
}

function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fencedMatch?.[1]) {
      return JSON.parse(fencedMatch[1].trim());
    }
    throw new Error("Failed to parse vision floor JSON response.");
  }
}

function extractFinishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const candidates = (payload as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const first = candidates[0];
  if (!first || typeof first !== "object") return null;
  const fr = (first as Record<string, unknown>).finishReason;
  return typeof fr === "string" ? fr : null;
}

/** Strips control chars/newlines, redacts any key= token, and truncates. */
function sanitizeUpstreamMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/key=[^&\s"']+/gi, "key=REDACTED")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 200);
}

/** Pulls Google's `{ error: { status, message } }` shape when present. */
function parseUpstreamError(bodyText: string): {
  upstreamStatus: string | null;
  sanitizedMessage: string | null;
} {
  try {
    const json = JSON.parse(bodyText) as unknown;
    if (json && typeof json === "object" && "error" in json) {
      const err = (json as Record<string, unknown>).error;
      if (err && typeof err === "object") {
        const status = (err as Record<string, unknown>).status;
        const message = (err as Record<string, unknown>).message;
        return {
          upstreamStatus: typeof status === "string" ? status : null,
          sanitizedMessage: sanitizeUpstreamMessage(message),
        };
      }
    }
  } catch {
    // Not JSON; fall through to a sanitized snippet of the raw body.
  }
  return { upstreamStatus: null, sanitizedMessage: sanitizeUpstreamMessage(bodyText) };
}

export type GeminiAutoFloorFailureStage =
  | "gemini_transport"
  | "gemini_non_ok"
  | "response_extraction"
  | "json_parse";

/**
 * Typed, sanitized failure carrying just enough for the route to log derived
 * metadata and choose a safe UI category. Never carries raw bodies, prompts,
 * image data, or keys.
 */
export class GeminiAutoFloorError extends Error {
  readonly code: string;
  readonly stage: GeminiAutoFloorFailureStage;
  readonly httpStatus: number | null;
  readonly upstreamStatus: string | null;
  readonly sanitizedMessage: string | null;

  constructor(args: {
    code: string;
    stage: GeminiAutoFloorFailureStage;
    httpStatus?: number | null;
    upstreamStatus?: string | null;
    sanitizedMessage?: string | null;
    message?: string;
  }) {
    super(args.message ?? args.code);
    this.name = "GeminiAutoFloorError";
    this.code = args.code;
    this.stage = args.stage;
    this.httpStatus = args.httpStatus ?? null;
    this.upstreamStatus = args.upstreamStatus ?? null;
    this.sanitizedMessage = args.sanitizedMessage ?? null;
  }
}

export type GeminiAutoFloorFailureInfo = {
  uiReason: string;
  stage: GeminiAutoFloorFailureStage | "unknown";
  code: string | null;
  httpStatus: number | null;
  upstreamStatus: string | null;
  sanitizedMessage: string | null;
};

/**
 * Maps a (typically GeminiAutoFloorError) failure into a concise, safe UI
 * category plus sanitized log fields. Unknown failures fall back to a generic
 * safe message.
 */
export function classifyGeminiAutoFloorFailure(error: unknown): GeminiAutoFloorFailureInfo {
  if (error instanceof GeminiAutoFloorError) {
    const { code, stage, httpStatus, upstreamStatus, sanitizedMessage } = error;
    let uiReason = "Gemini request failed.";
    if (code === "GEMINI_TIMEOUT") {
      uiReason = "Gemini vision request timed out.";
    } else if (stage === "response_extraction" || stage === "json_parse") {
      uiReason = "Gemini returned an invalid structured response.";
    } else if (typeof httpStatus === "number") {
      if (httpStatus === 400) {
        uiReason = "Gemini rejected the vision request (HTTP 400).";
      } else if (httpStatus === 401 || httpStatus === 403) {
        uiReason = "Gemini authorization or permission failed (HTTP 401/403).";
      } else if (httpStatus === 429) {
        uiReason = "Gemini rate limit or quota was reached (HTTP 429).";
      } else if (httpStatus >= 500 && httpStatus <= 599) {
        uiReason = "Gemini vision service returned an error (HTTP 5xx).";
      }
    }
    return { uiReason, stage, code, httpStatus, upstreamStatus, sanitizedMessage };
  }
  return {
    uiReason: "Gemini request failed.",
    stage: "unknown",
    code: null,
    httpStatus: null,
    upstreamStatus: null,
    sanitizedMessage: null,
  };
}

export type GeminiAutoFloorAccounting = {
  requestId?: string | null;
  route?: string | null;
  userId?: string | null;
};

export type GeminiAutoFloorCallArgs = {
  apiKey: string;
  model: string;
  prompt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  responseSchema: any;
  imageBase64: string;
  mime: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  accounting?: GeminiAutoFloorAccounting;
};

export type GeminiAutoFloorCallResult = {
  /** Parsed but UNTRUSTED raw JSON from the model. */
  raw: unknown;
};

/**
 * Calls Gemini for floor calibration quads and returns the parsed raw JSON.
 * Throws on transport/non-OK/parse failure (with a `code` where possible) so the
 * route can fail closed and accounting records the failure.
 */
export async function callGeminiAutoFloorDetection(
  args: GeminiAutoFloorCallArgs
): Promise<GeminiAutoFloorCallResult> {
  const model = args.model;
  const endpoint = `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(
    args.apiKey
  )}`;

  const parsed = await withGeminiUsageAccounting(
    {
      requestId: args.accounting?.requestId ?? null,
      userId: args.accounting?.userId ?? null,
      provider: "google_gemini",
      model,
      workflowType: "auto-floor-detect",
      actionType: "vision-floor-detect",
      route: args.accounting?.route ?? "/api/admin/3d-room-lab/auto-floor/detect-vision",
      service: "roomprintz-ui",
      imageCount: 1,
      metadata: {
        mime: args.mime,
        modelVersion: model,
        endpointKind: "google_generate_content_v1beta",
        purpose: "auto-floor-vision",
      },
    },
    async (): Promise<unknown> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
      try {
        let res: Response;
        try {
          res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts: [
                    { text: args.prompt },
                    { inlineData: { mimeType: args.mime, data: args.imageBase64 } },
                  ],
                },
              ],
              generationConfig: {
                temperature: args.temperature,
                maxOutputTokens: args.maxOutputTokens,
                responseMimeType: "application/json",
                responseSchema: args.responseSchema,
              },
            }),
          });
        } catch (transportError) {
          if (transportError instanceof DOMException && transportError.name === "AbortError") {
            throw new GeminiAutoFloorError({
              code: "GEMINI_TIMEOUT",
              stage: "gemini_transport",
              message: "Gemini vision floor call timed out.",
            });
          }
          throw new GeminiAutoFloorError({
            code: "TRANSPORT_ERROR",
            stage: "gemini_transport",
            sanitizedMessage: sanitizeUpstreamMessage(
              transportError instanceof Error ? transportError.message : String(transportError)
            ),
            message: "Gemini transport error.",
          });
        }

        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          const { upstreamStatus, sanitizedMessage } = parseUpstreamError(bodyText);
          throw new GeminiAutoFloorError({
            code: `HTTP_${res.status}`,
            stage: "gemini_non_ok",
            httpStatus: res.status,
            upstreamStatus,
            sanitizedMessage,
            message: `Gemini non-OK response (${res.status}).`,
          });
        }

        const envelope = (await res.json().catch(() => ({}))) as unknown;
        const text = extractResponseText(envelope);
        if (!text) {
          const finishReason = extractFinishReason(envelope);
          throw new GeminiAutoFloorError({
            code: "NO_OUTPUT_TEXT",
            stage: "response_extraction",
            sanitizedMessage: finishReason ? `finishReason=${finishReason}` : null,
            message: "Gemini returned no usable output text.",
          });
        }

        try {
          return parseJsonFromText(text);
        } catch {
          throw new GeminiAutoFloorError({
            code: "PARSE_ERROR",
            stage: "json_parse",
            message: "Gemini returned non-JSON output.",
          });
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  );

  return { raw: parsed };
}
