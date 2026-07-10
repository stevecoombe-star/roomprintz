import "server-only";

import { createHash } from "node:crypto";

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

/** Safe, high-level shape facts for debug logging only (no raw content). */
export type GeminiResponseDiagnostics = {
  finishReason: string | null;
  topLevelKeys: string[];
  candidateCount: number | null;
  contentPartCount: number | null;
  hasTextPart: boolean;
  hadThoughtPart: boolean;
  usedDirectTextField: boolean;
  extractedTextLength: number;
};

/**
 * Extracts model output text and high-level diagnostics.
 *
 * Phase 2F-F4: Gemini 3.x models emit "thinking" parts (`thought: true`) whose
 * `text` is prose reasoning, not the structured answer. The previous extractor
 * returned the FIRST text part, which could be a thought part → JSON.parse
 * failure. We now SKIP thought parts and CONCATENATE all remaining text parts of
 * the first candidate (the API's intended way to reassemble multi-part text).
 */
function extractModelText(payload: unknown): {
  text: string | null;
  diagnostics: GeminiResponseDiagnostics;
} {
  const diagnostics: GeminiResponseDiagnostics = {
    finishReason: null,
    topLevelKeys: [],
    candidateCount: null,
    contentPartCount: null,
    hasTextPart: false,
    hadThoughtPart: false,
    usedDirectTextField: false,
    extractedTextLength: 0,
  };

  if (!payload || typeof payload !== "object") {
    return { text: null, diagnostics };
  }
  const record = payload as Record<string, unknown>;
  diagnostics.topLevelKeys = Object.keys(record).slice(0, 20);

  const directText = safeStr(record.text) ?? safeStr(record.outputText);

  const candidates = Array.isArray(record.candidates) ? (record.candidates as unknown[]) : null;
  diagnostics.candidateCount = candidates ? candidates.length : null;

  let collected = "";
  const first = candidates && candidates.length > 0 ? candidates[0] : null;
  if (first && typeof first === "object") {
    const firstRecord = first as Record<string, unknown>;
    diagnostics.finishReason =
      typeof firstRecord.finishReason === "string" ? firstRecord.finishReason : null;
    const content = firstRecord.content;
    if (content && typeof content === "object") {
      const parts = Array.isArray((content as Record<string, unknown>).parts)
        ? ((content as Record<string, unknown>).parts as unknown[])
        : [];
      diagnostics.contentPartCount = parts.length;
      for (const part of parts) {
        if (!part || typeof part !== "object") continue;
        if ((part as Record<string, unknown>).thought === true) {
          diagnostics.hadThoughtPart = true;
          continue;
        }
        const t = (part as Record<string, unknown>).text;
        if (typeof t === "string" && t.length > 0) {
          collected += t;
        }
      }
    }
  }

  let text: string | null = null;
  if (collected.trim().length > 0) {
    text = collected;
    diagnostics.hasTextPart = true;
  } else if (directText) {
    text = directText;
    diagnostics.usedDirectTextField = true;
  }

  diagnostics.extractedTextLength = text ? text.length : 0;
  return { text, diagnostics };
}

/** Whitespace-collapsed, key-redacted, hard-truncated excerpt for debug logs. */
function sanitizeExcerpt(value: string, max: number): string {
  return value
    .replace(/key=[^&\s"']+/gi, "key=REDACTED")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
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
  // GER-W3C.0: the enabled raw-response capture hook refused before any parsing
  // occurred. Only reachable when a capture hook is supplied (default-off callers
  // never see this stage).
  | "raw_response_capture"
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
  // Debug-only extras. These are never logged unless AUTO_FLOOR_VISION_DEBUG_LOG
  // is on (the route enforces that gate). debugExcerpt is pre-sanitized.
  readonly diagnostics: GeminiResponseDiagnostics | null;
  readonly debugExcerpt: string | null;
  // GER-W3C.0: a stable, safe refusal reason forwarded verbatim from the capture
  // hook. It never carries raw response text or a digest hex — the hook contract
  // only ever returns a short stable reason token.
  readonly captureReason: string | null;

  constructor(args: {
    code: string;
    stage: GeminiAutoFloorFailureStage;
    httpStatus?: number | null;
    upstreamStatus?: string | null;
    sanitizedMessage?: string | null;
    diagnostics?: GeminiResponseDiagnostics | null;
    debugExcerpt?: string | null;
    captureReason?: string | null;
    message?: string;
  }) {
    super(args.message ?? args.code);
    this.name = "GeminiAutoFloorError";
    this.code = args.code;
    this.stage = args.stage;
    this.httpStatus = args.httpStatus ?? null;
    this.upstreamStatus = args.upstreamStatus ?? null;
    this.sanitizedMessage = args.sanitizedMessage ?? null;
    this.diagnostics = args.diagnostics ?? null;
    this.debugExcerpt = args.debugExcerpt ?? null;
    this.captureReason = args.captureReason ?? null;
  }
}

export type GeminiAutoFloorFailureInfo = {
  uiReason: string;
  stage: GeminiAutoFloorFailureStage | "unknown";
  code: string | null;
  httpStatus: number | null;
  upstreamStatus: string | null;
  sanitizedMessage: string | null;
  diagnostics: GeminiResponseDiagnostics | null;
  debugExcerpt: string | null;
};

/**
 * Maps a (typically GeminiAutoFloorError) failure into a concise, safe UI
 * category plus sanitized log fields. Unknown failures fall back to a generic
 * safe message.
 */
export function classifyGeminiAutoFloorFailure(error: unknown): GeminiAutoFloorFailureInfo {
  if (error instanceof GeminiAutoFloorError) {
    const { code, stage, httpStatus, upstreamStatus, sanitizedMessage, diagnostics, debugExcerpt } =
      error;
    let uiReason = "Gemini request failed.";
    if (code === "GEMINI_TIMEOUT") {
      uiReason = "Gemini vision request timed out.";
    } else if (code === "RESPONSE_TRUNCATED") {
      uiReason = "Gemini response was truncated before valid JSON.";
    } else if (stage === "raw_response_capture") {
      uiReason = "Gemini response could not be recorded before processing.";
    } else if (stage === "response_extraction") {
      uiReason = "Gemini returned no usable content.";
    } else if (stage === "json_parse") {
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
    return {
      uiReason,
      stage,
      code,
      httpStatus,
      upstreamStatus,
      sanitizedMessage,
      diagnostics,
      debugExcerpt,
    };
  }
  return {
    uiReason: "Gemini request failed.",
    stage: "unknown",
    code: null,
    httpStatus: null,
    upstreamStatus: null,
    sanitizedMessage: null,
    diagnostics: null,
    debugExcerpt: null,
  };
}

export type GeminiAutoFloorAccounting = {
  requestId?: string | null;
  route?: string | null;
  userId?: string | null;
  // GER-W3B.1: optional, additive, default-off provider attempt id pass-through.
  // No caller is required to provide it and none is minted here; a future
  // route-integration slice supplies a grammar-safe attemptId via the W3B.0
  // resolver. When absent, the accounting context is byte-identical to before.
  attemptId?: string;
};

/**
 * The accounting context accepted by {@link withGeminiUsageAccounting}. Derived
 * from the accounting module so the auto-floor boundary never re-declares that
 * shape.
 */
type GeminiAutoFloorAccountingContext = Parameters<typeof withGeminiUsageAccounting>[0];

/**
 * GER-W3B.1 — Pure builder for the auto-floor `withGeminiUsageAccounting`
 * context. Behavior-preserving by construction: it mirrors the previous inline
 * object exactly and only carries `attemptId` through when the caller provides a
 * string. No attemptId is minted, defaulted, or sanitized here, and `requestId`
 * is never reused as `attemptId`.
 */
export function buildAutoFloorGeminiAccountingContext(args: {
  model: string;
  mime: string;
  accounting?: GeminiAutoFloorAccounting;
}): GeminiAutoFloorAccountingContext {
  const { model, mime, accounting } = args;
  const base: GeminiAutoFloorAccountingContext = {
    requestId: accounting?.requestId ?? null,
    userId: accounting?.userId ?? null,
    provider: "google_gemini",
    model,
    workflowType: "auto-floor-detect",
    actionType: "vision-floor-detect",
    route: accounting?.route ?? "/api/admin/3d-room-lab/auto-floor/detect-vision",
    service: "roomprintz-ui",
    imageCount: 1,
    metadata: {
      mime,
      modelVersion: model,
      endpointKind: "google_generate_content_v1beta",
      purpose: "auto-floor-vision",
    },
  };
  // Additive, default-off: only carry attemptId when explicitly present.
  if (typeof accounting?.attemptId === "string") {
    return { ...base, attemptId: accounting.attemptId };
  }
  return base;
}

/**
 * GER-W3C.0 — Raw provider-response capture, taken over the EXACT HTTP response
 * body bytes read via `arrayBuffer()`.
 *
 * `rawResponseBytesSha256Hex` is SHA-256 over those exact bytes
 * (`raw-provider-response-text/v1`). It is deliberately NOT over `Response.text()`,
 * parsed JSON, `JSON.stringify(parsed)`, pretty JSON, model candidate text, or
 * any adapter output. `rawResponseText` is the UTF-8 decode of the same bytes,
 * provided only for a future receipt builder — it is never logged or returned to
 * callers by this module. `byteLength` is the exact captured byte count.
 */
export type GeminiProviderResponseCapture = {
  rawResponseBytesSha256Hex: string;
  rawResponseText: string;
  byteLength: number;
  httpStatus: number;
};

/**
 * The hook's decision. A refusal carries only a short, stable reason token — it
 * must never echo raw response text or a digest hex.
 */
export type GeminiProviderResponseCaptureDecision =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Optional provider-boundary capture hook. When supplied (enabled), it is invoked
 * exactly once after the exact response bytes are read and digested, and BEFORE
 * `JSON.parse` / `extractModelText` / `parseJsonFromText`. When absent (default),
 * no capture occurs and the legacy `res.json()` path is preserved byte-for-byte.
 */
export type GeminiProviderResponseCaptureHook = (
  capture: GeminiProviderResponseCapture
) => Promise<GeminiProviderResponseCaptureDecision>;

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
  thinkingLevel?: "minimal";
  timeoutMs: number;
  accounting?: GeminiAutoFloorAccounting;
  // GER-W3C.0: optional, additive, default-off raw-provider-response capture hook.
  // When omitted the success path is byte-identical to before this slice.
  onProviderResponseCaptured?: GeminiProviderResponseCaptureHook;
};

export type GeminiAutoFloorResponseMeta = {
  finishReason: string | null;
  candidatesTokenCount: number | null;
  thoughtsTokenCount: number | null;
};

export type GeminiAutoFloorCallResult = {
  /** Parsed but UNTRUSTED raw JSON from the model. */
  raw: unknown;
  meta: GeminiAutoFloorResponseMeta;
};

function isGemini35FlashModel(model: string): boolean {
  return /(?:^|\/)gemini-3\.5-flash$/i.test(model.trim());
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractResponseMeta(
  envelope: unknown,
  diagnostics: GeminiResponseDiagnostics
): GeminiAutoFloorResponseMeta {
  if (!envelope || typeof envelope !== "object") {
    return {
      finishReason: diagnostics.finishReason,
      candidatesTokenCount: null,
      thoughtsTokenCount: null,
    };
  }
  const usageMetadata = (envelope as Record<string, unknown>).usageMetadata;
  if (!usageMetadata || typeof usageMetadata !== "object") {
    return {
      finishReason: diagnostics.finishReason,
      candidatesTokenCount: null,
      thoughtsTokenCount: null,
    };
  }
  const usage = usageMetadata as Record<string, unknown>;
  return {
    finishReason: diagnostics.finishReason,
    candidatesTokenCount:
      asFiniteNumber(usage.candidatesTokenCount) ?? asFiniteNumber(usage.outputTokenCount),
    thoughtsTokenCount: asFiniteNumber(usage.thoughtsTokenCount),
  };
}

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

  const result = await withGeminiUsageAccounting(
    buildAutoFloorGeminiAccountingContext({
      model,
      mime: args.mime,
      accounting: args.accounting,
    }),
    async (): Promise<GeminiAutoFloorCallResult> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
      try {
        let res: Response;
        try {
          const generationConfig: Record<string, unknown> = {
            temperature: args.temperature,
            maxOutputTokens: args.maxOutputTokens,
            responseMimeType: "application/json",
            responseSchema: args.responseSchema,
          };
          if (args.thinkingLevel === "minimal" && isGemini35FlashModel(args.model)) {
            generationConfig.thinkingConfig = { thinkingLevel: "minimal" };
          }

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
              generationConfig,
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

        // GER-W3C.0 — Default-off preservation vs. enabled raw-byte capture.
        //
        // Disabled (no hook): the legacy `res.json()` path is preserved exactly,
        // including its `.catch(() => ({}))` masking of malformed 2xx bodies. No
        // bytes are captured, no digest is computed, no hook is called.
        //
        // Enabled (hook present): the body is read exactly once via
        // `arrayBuffer()`, SHA-256 is computed over those exact bytes, the bytes
        // are UTF-8 decoded for the existing parse pipeline, and the hook runs
        // after capture but before ANY parsing. If the hook refuses, we abort
        // before parsing with a typed safe error. If the honest UTF-8/JSON parse
        // of a 2xx body fails, we fail closed with a typed json_parse error rather
        // than silently masking it as `{}` (the documented, enabled-mode-only
        // diagnostic difference allowed by W3C-R). Raw text is never logged and is
        // never returned to callers except via the hook.
        let envelope: unknown;
        if (args.onProviderResponseCaptured) {
          // Read the body exactly once and digest the EXACT bytes via a
          // Uint8Array view over the raw arrayBuffer, so no reserialized/parsed
          // form is ever the digest basis.
          const rawBytes = new Uint8Array(await res.arrayBuffer());
          const rawResponseBytesSha256Hex = createHash("sha256")
            .update(rawBytes)
            .digest("hex");
          const rawResponseText = new TextDecoder("utf-8").decode(rawBytes);
          const decision = await args.onProviderResponseCaptured({
            rawResponseBytesSha256Hex,
            rawResponseText,
            byteLength: rawBytes.byteLength,
            httpStatus: res.status,
          });
          if (!decision.ok) {
            throw new GeminiAutoFloorError({
              code: "RAW_RESPONSE_CAPTURE_REFUSED",
              stage: "raw_response_capture",
              httpStatus: res.status,
              captureReason: decision.reason,
              message: "Raw response capture was refused before parsing.",
            });
          }
          try {
            envelope = JSON.parse(rawResponseText);
          } catch {
            throw new GeminiAutoFloorError({
              code: "ENVELOPE_PARSE_ERROR",
              stage: "json_parse",
              httpStatus: res.status,
              message: "Gemini returned a non-JSON response body.",
            });
          }
        } else {
          envelope = (await res.json().catch(() => ({}))) as unknown;
        }
        const { text, diagnostics } = extractModelText(envelope);
        if (!text) {
          throw new GeminiAutoFloorError({
            code: "NO_OUTPUT_TEXT",
            stage: "response_extraction",
            sanitizedMessage: diagnostics.finishReason
              ? `finishReason=${diagnostics.finishReason}`
              : null,
            diagnostics,
            message: "Gemini returned no usable output text.",
          });
        }

        try {
          return {
            raw: parseJsonFromText(text),
            meta: extractResponseMeta(envelope, diagnostics),
          };
        } catch {
          const truncated = diagnostics.finishReason === "MAX_TOKENS";
          throw new GeminiAutoFloorError({
            code: truncated ? "RESPONSE_TRUNCATED" : "PARSE_ERROR",
            stage: "json_parse",
            sanitizedMessage: diagnostics.finishReason
              ? `finishReason=${diagnostics.finishReason}`
              : null,
            diagnostics,
            debugExcerpt: sanitizeExcerpt(text, 800),
            message: "Gemini returned non-JSON output.",
          });
        }
      } finally {
        clearTimeout(timeout);
      }
    }
  );

  return result;
}
