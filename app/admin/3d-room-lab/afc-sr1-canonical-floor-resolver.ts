import "server-only";

import { createHash } from "node:crypto";

import {
  detectFloorFromVerifiedBytes,
  type DetectFloorOutcome,
} from "@/lib/vibodeAutoFloorVisionDetect";
import {
  getAutoFloorVisionApiKey,
  getAutoFloorVisionGeminiTimeoutMs,
  getAutoFloorVisionModel,
  isAutoFloorVisionEnabled,
} from "@/lib/vibodeAutoFloorVisionConfig";

import { scoreAutoFloorCandidateGeometry } from "./auto-floor-scoring";
import type { AfcSr1SourcePolygon } from "./research/afc-sr1-semantic-prior";

export const AFC_SR1_CANONICAL_FLOOR_DETECTOR_KIND =
  "empty_room_assist_empty_arm" as const;
export const AFC_SR1_CANONICAL_FLOOR_MAX_CANDIDATES = 3;
export const AFC_SR1_CANONICAL_FLOOR_RECT = Object.freeze({
  widthMeters: 4,
  depthMeters: 4,
});

export type AfcSr1CanonicalFloorResolverFailureReason =
  | "detector_disabled"
  | "detector_not_configured"
  | "provider_transport"
  | "provider_timeout"
  | "invalid_response"
  | "zero_candidates"
  | "all_geometry_invalid"
  | "mapping_failed"
  | "empty_identity_mismatch";

export type AfcSr1CanonicalFloorResolverInput = Readonly<{
  empty: Readonly<{
    bytes: Uint8Array;
    sha256: string;
    byteCount: number;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
  }>;
  attemptId: string;
}>;

export type AfcSr1CanonicalFloorResolverResult =
  | Readonly<{
      status: "selected";
      detectorKind: typeof AFC_SR1_CANONICAL_FLOOR_DETECTOR_KIND;
      polygon: AfcSr1SourcePolygon;
      emptyBasis: Readonly<{
        sha256: string;
        decodedWidth: number;
        decodedHeight: number;
        orientation: 1;
      }>;
      selectedCandidateId: string;
      selectedCandidateIndex: number;
      candidateCount: number;
      geometryScore: number;
      scoreBand: "high" | "medium" | "low";
      model: string;
    }>
  | Readonly<{
      status: "failed";
      reason: AfcSr1CanonicalFloorResolverFailureReason;
    }>;

export type AfcSr1CanonicalFloorResolverDependencies = Readonly<{
  detect?: typeof detectFloorFromVerifiedBytes;
  isEnabled?: () => boolean;
  getApiKey?: () => string | null;
  getModel?: () => string;
  getTimeoutMs?: () => number;
}>;

function sameBytesIdentity(
  empty: AfcSr1CanonicalFloorResolverInput["empty"]
): boolean {
  return empty.bytes.byteLength === empty.byteCount &&
    createHash("sha256").update(empty.bytes).digest("hex") === empty.sha256;
}

function failureFromOutcome(
  outcome: Exclude<DetectFloorOutcome, { ok: true }>
): AfcSr1CanonicalFloorResolverFailureReason {
  if (outcome.failureKind === "mapping") return "mapping_failed";
  if (outcome.info.code === "GEMINI_TIMEOUT") return "provider_timeout";
  if (outcome.info.stage === "json_parse" ||
      outcome.info.stage === "response_extraction" ||
      outcome.info.code === "RESPONSE_TRUNCATED") {
    return "invalid_response";
  }
  return "provider_transport";
}

/**
 * Resolves exactly one canonical source-normalized Floor from the verified
 * EMPTY image. This deliberately wraps the same detector core used by
 * Empty-Room Assist, using an identity EMPTY source/frame geometry.
 */
export async function resolveCanonicalAfcFloorFromEmpty(
  input: AfcSr1CanonicalFloorResolverInput,
  dependencies: AfcSr1CanonicalFloorResolverDependencies = {}
): Promise<AfcSr1CanonicalFloorResolverResult> {
  const enabled = dependencies.isEnabled ?? isAutoFloorVisionEnabled;
  if (!enabled()) return Object.freeze({ status: "failed", reason: "detector_disabled" });
  const apiKey = (dependencies.getApiKey ?? getAutoFloorVisionApiKey)();
  if (!apiKey) return Object.freeze({ status: "failed", reason: "detector_not_configured" });
  const model = (dependencies.getModel ?? getAutoFloorVisionModel)();
  const empty = input.empty;
  if (!sameBytesIdentity(empty) ||
      !Number.isInteger(empty.decodedWidth) || empty.decodedWidth <= 0 ||
      !Number.isInteger(empty.decodedHeight) || empty.decodedHeight <= 0 ||
      empty.orientation !== 1) {
    return Object.freeze({ status: "failed", reason: "empty_identity_mismatch" });
  }

  const sourceSize = Object.freeze({
    width: empty.decodedWidth,
    height: empty.decodedHeight,
  });
  const outcome = await (dependencies.detect ?? detectFloorFromVerifiedBytes)({
    apiKey,
    model,
    image: {
      base64: Buffer.from(empty.bytes).toString("base64"),
      mime: empty.mimeType,
      byteCount: empty.byteCount,
    },
    // Identity frame is mandatory: the detector's container-normalized output
    // remains exact EMPTY source-normalized geometry.
    sourceSize,
    frameSize: sourceSize,
    floorRect: AFC_SR1_CANONICAL_FLOOR_RECT,
    maxCandidates: AFC_SR1_CANONICAL_FLOOR_MAX_CANDIDATES,
    timeoutMs: (dependencies.getTimeoutMs ?? getAutoFloorVisionGeminiTimeoutMs)(),
    accounting: {
      requestId: input.attemptId,
      route: "afc-sr1-live-analyze",
      userId: null,
      attemptId: input.attemptId,
    },
  });
  if (!outcome.ok) {
    return Object.freeze({ status: "failed", reason: failureFromOutcome(outcome) });
  }
  const { result } = outcome;
  if (result.candidates.length === 0) {
    return Object.freeze({ status: "failed", reason: "zero_candidates" });
  }
  const selectedCandidateIndex = result.candidates.findIndex(
    (candidate) => candidate.id === result.selectedCandidateId
  );
  if (selectedCandidateIndex < 0) {
    return Object.freeze({ status: "failed", reason: "all_geometry_invalid" });
  }
  const selected = result.candidates[selectedCandidateIndex];
  const geometry = scoreAutoFloorCandidateGeometry(selected, {
    frameSize: sourceSize,
    floorRect: AFC_SR1_CANONICAL_FLOOR_RECT,
  });
  if (geometry.scoreBand === "invalid") {
    return Object.freeze({ status: "failed", reason: "all_geometry_invalid" });
  }

  return Object.freeze({
    status: "selected",
    detectorKind: AFC_SR1_CANONICAL_FLOOR_DETECTOR_KIND,
    polygon: Object.freeze(
      selected.quadNorm.map((point) => Object.freeze({ x: point.x, y: point.y }))
    ) as unknown as AfcSr1SourcePolygon,
    emptyBasis: Object.freeze({
      sha256: empty.sha256,
      decodedWidth: empty.decodedWidth,
      decodedHeight: empty.decodedHeight,
      orientation: 1,
    }),
    selectedCandidateId: selected.id,
    selectedCandidateIndex,
    candidateCount: result.candidates.length,
    geometryScore: geometry.score,
    scoreBand: geometry.scoreBand,
    model,
  });
}
