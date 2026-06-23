import "server-only";

import {
  callGeminiAutoFloorDetection,
  classifyGeminiAutoFloorFailure,
  type GeminiAutoFloorFailureInfo,
} from "@/lib/vibodeGeminiAutoFloorDetection";
import {
  AUTO_FLOOR_VISION_RESPONSE_SCHEMA,
  DEFAULT_AUTO_FLOOR_VISION_CONFIG,
  buildAutoFloorVisionPrompt,
  mapSourceNormalizedRawVisionResponseToDetectionResult,
} from "@/app/admin/3d-room-lab/auto-floor-vision-provider-scaffold";
import type { AutoFloorDetectionResult } from "@/app/admin/3d-room-lab/auto-floor-detection";

// --- Phase 2H-B: shared verified-bytes floor detection -----------------------
// Single source of truth for "given already-verified image bytes + sizes, run
// Gemini and map to an AutoFloorDetectionResult". Used by BOTH the direct
// detect-vision route and the empty-room-assist route so there is exactly ONE
// Gemini request/parser/mapping implementation.
//
// Coordinate-space contract is UNCHANGED: Gemini returns intrinsic-source-
// normalized coordinates; mapSourceNormalizedRawVisionResponseToDetectionResult
// converts source->container (non-clamping) and defers ALL validation/scoring to
// the Phase 2F-B mapper. Callers own logging.

export type VerifiedImageBytes = {
  base64: string;
  mime: string;
  byteCount: number;
};

export type DetectFloorArgs = {
  apiKey: string;
  model: string;
  image: VerifiedImageBytes;
  // Verified decoded source dimensions (must match the bytes that are sent).
  sourceSize: { width: number; height: number };
  // Live lab container/frame size (object-cover viewport).
  frameSize: { width: number; height: number };
  floorRect: { widthMeters: number; depthMeters: number };
  maxCandidates: number;
  timeoutMs: number;
  accounting: { requestId: string; route: string; userId: string | null };
};

export type GeminiCallMeta = {
  finishReason: string | null;
  candidatesTokenCount: number | null;
  thoughtsTokenCount: number | null;
};

export type DetectFloorOutcome =
  | { ok: true; result: AutoFloorDetectionResult; meta: GeminiCallMeta }
  | { ok: false; failureKind: "gemini"; info: GeminiAutoFloorFailureInfo }
  | { ok: false; failureKind: "mapping"; message: string; result: AutoFloorDetectionResult };

/**
 * Runs Gemini floor detection on already-fetched + verified image bytes and maps
 * the response into the internal AutoFloorDetectionResult. Never throws.
 *
 * The caller is responsible for: SSRF-safe fetch, decoded-dimension/orientation
 * verification (so `sourceSize` truly matches `image`), admin auth, feature
 * flags, and all logging.
 */
export async function detectFloorFromVerifiedBytes(
  args: DetectFloorArgs
): Promise<DetectFloorOutcome> {
  const prompt = buildAutoFloorVisionPrompt({
    frameSize: args.frameSize,
    intrinsicSize: args.sourceSize,
    // Manual polygon hint intentionally omitted (container-space; converting it
    // safely is deferred — avoids coordinate-space corruption / echoing).
    maxCandidates: args.maxCandidates,
  });

  let raw: unknown;
  let meta: GeminiCallMeta = {
    finishReason: null,
    candidatesTokenCount: null,
    thoughtsTokenCount: null,
  };
  try {
    const call = await callGeminiAutoFloorDetection({
      apiKey: args.apiKey,
      model: args.model,
      prompt,
      responseSchema: AUTO_FLOOR_VISION_RESPONSE_SCHEMA,
      imageBase64: args.image.base64,
      mime: args.image.mime,
      temperature: DEFAULT_AUTO_FLOOR_VISION_CONFIG.temperature,
      maxOutputTokens: DEFAULT_AUTO_FLOOR_VISION_CONFIG.maxOutputTokens,
      thinkingLevel: DEFAULT_AUTO_FLOOR_VISION_CONFIG.thinkingLevel,
      timeoutMs: args.timeoutMs,
      accounting: args.accounting,
    });
    raw = call.raw;
    meta = {
      finishReason: call.meta.finishReason,
      candidatesTokenCount: call.meta.candidatesTokenCount,
      thoughtsTokenCount: call.meta.thoughtsTokenCount,
    };
  } catch (error) {
    return { ok: false, failureKind: "gemini", info: classifyGeminiAutoFloorFailure(error) };
  }

  let result: AutoFloorDetectionResult;
  try {
    result = mapSourceNormalizedRawVisionResponseToDetectionResult(raw, {
      sourceSize: args.sourceSize,
      containerSize: args.frameSize,
      floorRect: args.floorRect,
      maxCandidates: args.maxCandidates,
    });
  } catch (error) {
    return {
      ok: false,
      failureKind: "mapping",
      message: error instanceof Error ? error.message : String(error),
      result: {
        status: "failed",
        candidates: [],
        selectedCandidateId: null,
        notes: [],
        failureReasons: ["Failed to process vision response."],
      },
    };
  }

  return { ok: true, result, meta };
}
