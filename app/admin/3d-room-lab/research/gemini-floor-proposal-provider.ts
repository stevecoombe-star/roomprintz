/**
 * AFC-R3C-B2 — minimal Gemini transport and strict research-envelope extraction.
 *
 * This intentionally mirrors the hardened production REST mechanics without
 * calling its tolerant parser: the research runner must retain every response
 * byte (including non-2xx bodies) and extract exactly one authored text part.
 */
import "server-only";

import { createHash } from "node:crypto";

import { AFC_R3C_GEMINI_FLOOR_PROPOSAL_RESPONSE_SCHEMA, type AfcR3cPromptBuildResult } from "./gemini-floor-proposal-prompt";

export const AFC_R3C_GEMINI_GENERATION_VERSION = "afc-r3c-gemini-generation/v1" as const;
export const AFC_R3C_GEMINI_PROVIDER_ID = "google_gemini" as const;
export const AFC_R3C_ENVELOPE_EXTRACTION_POLICY_VERSION = "afc-r3c-envelope-extraction/exactly-one-candidate-one-text-part/v1" as const;

export type AfcR3cResolvedGenerationConfig = Readonly<{
  contractVersion: typeof AFC_R3C_GEMINI_GENERATION_VERSION;
  temperature: 0.1;
  maxOutputTokens: 4096;
  responseMimeType: "application/json";
  thinkingLevel: "minimal";
  thinkingLevelApplied: boolean;
}>;

export type AfcR3cProviderResponse = Readonly<{
  httpStatus: number;
  envelopeBytes: Buffer;
  providerEnvelopeSha256: string;
  providerEnvelopeByteLength: number;
}>;

export type AfcR3cProviderTransportFailure = Readonly<{
  kind: "timeout" | "transport";
  message: string;
}>;

export type AfcR3cEnvelopeExtraction =
  | Readonly<{
      ok: true;
      modelOutputText: string;
      modelOutputTextSha256: string;
      modelOutputUtf8ByteLength: number;
      finishReason: string | null;
      providerModelVersion: string | null;
      usageMetadata: Record<string, unknown> | null;
    }>
  | Readonly<{ ok: false; reason: string; path: string; finishReason: string | null; providerModelVersion: string | null; usageMetadata: Record<string, unknown> | null }>;

export type AfcR3cProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

const GEMINI_ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

function isGemini35FlashModel(model: string): boolean {
  return /(?:^|\/)gemini-3\.5-flash$/i.test(model.trim());
}

function hash(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeUsageMetadata(value: unknown): Record<string, unknown> | null {
  if (!plain(value)) return null;
  return Object.freeze({ ...value });
}

function envelopeMetadata(envelope: Record<string, unknown>, candidate: Record<string, unknown> | null) {
  return {
    finishReason: candidate && typeof candidate.finishReason === "string" ? candidate.finishReason : null,
    providerModelVersion: typeof envelope.modelVersion === "string" ? envelope.modelVersion : null,
    usageMetadata: safeUsageMetadata(envelope.usageMetadata),
  };
}

export function resolveAfcR3cGenerationConfig(model: string): AfcR3cResolvedGenerationConfig {
  if (typeof model !== "string" || model.trim().length === 0) throw new TypeError("AFC-R3C requires an explicit Gemini model ID.");
  return Object.freeze({
    contractVersion: AFC_R3C_GEMINI_GENERATION_VERSION,
    temperature: 0.1,
    maxOutputTokens: 4096,
    responseMimeType: "application/json",
    thinkingLevel: "minimal",
    thinkingLevelApplied: isGemini35FlashModel(model),
  });
}

export function buildAfcR3cGeminiEndpoint(model: string, apiKey: string): string {
  return `${GEMINI_ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

/**
 * Pure request-body construction for assertions and deterministic transport.
 * Exactly one verified input image is admitted.
 */
export function buildAfcR3cGeminiRequestPayload(args: {
  prompt: AfcR3cPromptBuildResult;
  imageBytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  generationConfig: AfcR3cResolvedGenerationConfig;
}): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {
    temperature: args.generationConfig.temperature,
    maxOutputTokens: args.generationConfig.maxOutputTokens,
    responseMimeType: args.generationConfig.responseMimeType,
    responseSchema: AFC_R3C_GEMINI_FLOOR_PROPOSAL_RESPONSE_SCHEMA,
  };
  if (args.generationConfig.thinkingLevelApplied) generationConfig.thinkingConfig = { thinkingLevel: "minimal" };
  return {
    contents: [{
      role: "user",
      parts: [
        { text: args.prompt.promptText },
        { inlineData: { mimeType: args.mimeType, data: args.imageBytes.toString("base64") } },
      ],
    }],
    generationConfig,
  };
}

/**
 * Read every provider body exactly once as bytes. The caller captures bytes
 * before any envelope parse, whether the HTTP status is successful or not.
 */
export async function callAfcR3cGeminiProvider(args: {
  apiKey: string;
  model: string;
  prompt: AfcR3cPromptBuildResult;
  imageBytes: Buffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  timeoutMs: number;
  fetchImpl?: AfcR3cProviderFetch;
}): Promise<{ ok: true; response: AfcR3cProviderResponse } | { ok: false; failure: AfcR3cProviderTransportFailure }> {
  const generationConfig = resolveAfcR3cGenerationConfig(args.model);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);
  try {
    let response: Response;
    try {
      response = await (args.fetchImpl ?? globalThis.fetch)(
        buildAfcR3cGeminiEndpoint(args.model, args.apiKey),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(buildAfcR3cGeminiRequestPayload({
            prompt: args.prompt,
            imageBytes: args.imageBytes,
            mimeType: args.mimeType,
            generationConfig,
          })),
        }
      );
    } catch (error) {
      const aborted = error instanceof DOMException && error.name === "AbortError";
      return { ok: false, failure: { kind: aborted ? "timeout" : "transport", message: aborted ? "Gemini request timed out." : "Gemini transport failed." } };
    }
    let envelopeBytes: Buffer;
    try {
      envelopeBytes = Buffer.from(await response.arrayBuffer());
    } catch {
      return { ok: false, failure: { kind: "transport", message: "Gemini response body could not be read." } };
    }
    return {
      ok: true,
      response: Object.freeze({
        httpStatus: response.status,
        envelopeBytes,
        providerEnvelopeSha256: hash(envelopeBytes),
        providerEnvelopeByteLength: envelopeBytes.byteLength,
      }),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fail-closed selection: a successful envelope must contain exactly one
 * candidate, with exactly one content part, and that part must be a non-empty
 * string text. No text trimming, concatenation, or Markdown recovery occurs.
 */
export function extractAfcR3cModelOutputText(envelopeBytes: Buffer): AfcR3cEnvelopeExtraction {
  let decoded: unknown;
  try {
    decoded = JSON.parse(envelopeBytes.toString("utf8"));
  } catch {
    return { ok: false, reason: "envelope_invalid_json", path: "$", finishReason: null, providerModelVersion: null, usageMetadata: null };
  }
  if (!plain(decoded)) return { ok: false, reason: "envelope_not_object", path: "$", finishReason: null, providerModelVersion: null, usageMetadata: null };
  const candidates = decoded.candidates;
  if (!Array.isArray(candidates)) {
    const meta = envelopeMetadata(decoded, null);
    return { ok: false, reason: "candidates_missing", path: "$.candidates", ...meta };
  }
  if (candidates.length !== 1) {
    const meta = envelopeMetadata(decoded, null);
    return { ok: false, reason: candidates.length === 0 ? "blocked_or_no_content" : "candidates_ambiguous", path: "$.candidates", ...meta };
  }
  if (!plain(candidates[0])) {
    const meta = envelopeMetadata(decoded, null);
    return { ok: false, reason: "candidate_invalid", path: "$.candidates[0]", ...meta };
  }
  const candidate = candidates[0];
  const meta = envelopeMetadata(decoded, candidate);
  if (!plain(candidate.content) || !Array.isArray(candidate.content.parts)) {
    return { ok: false, reason: "candidate_content_missing", path: "$.candidates[0].content.parts", ...meta };
  }
  if (candidate.content.parts.length !== 1) {
    return { ok: false, reason: candidate.content.parts.length === 0 ? "blocked_or_no_content" : "text_parts_ambiguous", path: "$.candidates[0].content.parts", ...meta };
  }
  const part = candidate.content.parts[0];
  if (!plain(part) || !Object.hasOwn(part, "text")) return { ok: false, reason: "text_part_missing", path: "$.candidates[0].content.parts[0]", ...meta };
  if (Object.keys(part).length !== 1 || Object.keys(part)[0] !== "text") {
    return { ok: false, reason: "text_part_ambiguous", path: "$.candidates[0].content.parts[0]", ...meta };
  }
  if (typeof part.text !== "string") return { ok: false, reason: "text_not_string", path: "$.candidates[0].content.parts[0].text", ...meta };
  // Admission checks whitespace without changing the retained model string.
  if (part.text.length === 0 || part.text.trim().length === 0) {
    return { ok: false, reason: "text_empty", path: "$.candidates[0].content.parts[0].text", ...meta };
  }
  return Object.freeze({
    ok: true,
    modelOutputText: part.text,
    modelOutputTextSha256: hash(part.text),
    modelOutputUtf8ByteLength: Buffer.byteLength(part.text, "utf8"),
    ...meta,
  });
}
