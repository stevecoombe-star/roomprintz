import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import {
  getAutoFloorVisionAllowedImageHosts,
  getAutoFloorVisionApiKey,
  getAutoFloorVisionGeminiTimeoutMs,
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  getAutoFloorVisionModel,
  getEmptyRoomAssistResultAllowedHosts,
  isAutoFloorVisionAllowLocalhostHttp,
  isAutoFloorVisionEnabled,
  isEmptyRoomAssistEnabled,
} from "@/lib/vibodeAutoFloorVisionConfig";
import { getRequestIdFromHeaders } from "@/lib/vibodeGeminiUsageAccounting";
import { fetchRoomImageSafely, inspectImageMetadata, type ImageMetaResult } from "@/lib/vibodeAutoFloorImageFetch";
import {
  probeStructuralPreservation,
  type StructuralPreservationBand,
} from "@/lib/vibodeAutoFloorImageProbe";
import { detectFloorFromVerifiedBytes, type DetectFloorOutcome } from "@/lib/vibodeAutoFloorVisionDetect";
import { getOrGenerateEmptyRoomImage, type EmptyRoomCacheStatus } from "@/lib/vibodeEmptyRoomAssist";
import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import { compareSourceNormalizedQuads, polygonArea, type QuadAgreementResult } from "@/app/admin/3d-room-lab/auto-floor-quad-agreement";
import {
  decideEmptyPrimaryPolicy,
  type EmptyPrimaryProvenance,
  type SurfacedSource,
  type ConfidenceCeiling,
} from "@/app/admin/3d-room-lab/auto-floor-empty-primary-policy";
import { scoreAutoFloorCandidateGeometry } from "@/app/admin/3d-room-lab/auto-floor-scoring";
import {
  containerNormToSourceNorm,
  normToPixels,
  sourceNormToContainerNorm,
} from "@/app/admin/3d-room-lab/image-space";
import type { AutoFloorCalibrationCandidate, AutoFloorDetectionResult } from "@/app/admin/3d-room-lab/auto-floor-detection";
import {
  DEFAULT_FOV_SCAN_MAX_DEG,
  DEFAULT_FOV_SCAN_MIN_DEG,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  scanCameraPoseOverFov,
  solvePlaneHomography,
  type FovScanResult,
  type Vec2,
} from "@/app/admin/3d-room-lab/perspective-solve";

// --- Phase 2H-D/2H-E: lab-only Empty-Room-PRIMARY dual-detection route -------
// POST /api/admin/3d-room-lab/empty-room-assist/run
//
// Hard gates (fail closed): authenticated admin + EMPTY_ROOM_ASSIST_ENABLED +
// AUTO_FLOOR_VISION_ENABLED + Gemini key. NO token charge, NO vibode_room_assets,
// NO lineage, NO active-version mutation, NO DB writes.
//
// Policy (2H-D):
//   * The EMPTY-ROOM quad is the PRIMARY surfaced candidate when compatibility
//     passes AND the empty quad is self-valid + its camera pose decomposes.
//   * The ORIGINAL detector is DIAGNOSTIC ONLY — disagreement never vetoes.
//   * A sharp static-region structural-preservation heuristic is DOWNGRADE-ONLY.
//   * No auto-apply, no production integration, no persistence/mutation.
//
// Phase 2H-E — NBP aspect-tolerant compatibility:
//   * Compatibility is now tiered: exact_grid_compatible, aspect_compatible_
//     rescaled, incompatible. NBP often emits near-standard but non-exact grids
//     (e.g. 1264x848 ≈ 1.4906 for nominal 3:2 = 1.5000). When the relative
//     aspect-ratio error is within a narrow, documented tolerance, the empty
//     quad is transferred in NORMALIZED source coordinates and re-expressed via
//     the ORIGINAL image-space path for display (no pixel-space stretching).
//   * Aspect-rescaled transfer is NOT geometry-preservation proof: it can never
//     reach empty_primary_verified and its confidence is capped at review/medium.

export const runtime = "nodejs";

const ASSIST_ROUTE = "/api/admin/3d-room-lab/empty-room-assist/run";
const MAX_CANDIDATES = 3;
const DEFAULT_FLOOR_RECT = { widthMeters: 4, depthMeters: 4 };
const EMPTY_ROOM_GEN_TIMEOUT_MS = 60000;

// --- Phase 2H-E: NBP-tolerant compatibility threshold ------------------------
// Relative aspect-ratio error = |emptyAspect - originalAspect| / originalAspect,
// where aspect = width / height (both orientation === 1).
//
// Rationale: NBP empty-room generation commonly returns near-standard but
// non-exact output grids. Observed: original 960x640 (aspect 1.5000) ->
// NBP empty 1264x848 (aspect ≈ 1.4906), a relative error of ≈ 0.63%. That
// closely preserves camera framing, so a normalized-coordinate transfer is
// reasonable. This tolerance is deliberately NARROW: it admits the observed
// ~0.63% case with margin but rejects materially different crops/aspects
// (e.g. 3:2 vs 4:3 ≈ 11.1%, 3:2 vs 16:9 ≈ 18.5%). Lab-tunable.
const NBP_ASPECT_RELATIVE_ERROR_TOLERANCE = 0.015; // 1.5%

type EmptyRoomAssistStatus = "completed" | "generated" | "unavailable" | "blocked" | "failed";
type DetectionStatusLabel = "ok" | "needs_review" | "failed" | "skipped";
type CompatibilityTier = "exact_grid_compatible" | "aspect_compatible_rescaled" | "incompatible";
type TransferMode = "exact_grid" | "aspect_rescaled" | "none";

type CompatibilityClassification = {
  tier: CompatibilityTier;
  transferMode: TransferMode;
  reason: string | null;
  originalAspect: number | null;
  emptyAspect: number | null;
  relativeAspectError: number | null;
};

type CoordinateCompatibilitySummary = {
  ok: boolean;
  tier: CompatibilityTier;
  transferMode: TransferMode;
  reason: string | null;
  originalSize: { width: number; height: number } | null;
  emptySize: { width: number; height: number } | null;
  originalOrientation: number | null;
  emptyOrientation: number | null;
  originalAspect: number | null;
  emptyAspect: number | null;
  relativeAspectError: number | null;
};

type EmptyQuadSelfValidity = {
  band: string | null;
  cameraPoseOk: boolean;
  cameraPoseConfidence: "high" | "low" | null;
  // Phase 2H-F: FOV-scan diagnostics (best valid FOV + how many FOVs passed).
  cameraPoseBestFovDeg: number | null;
  cameraPoseValidFovCount: number;
  cameraPoseValidFovRange: [number, number] | null;
  cameraPoseReason: string | null;
} | null;

type StructuralPreservationSummary = {
  ok: boolean;
  score: number | null;
  band: StructuralPreservationBand;
  regionsUsed: string[];
  excludedRegions: string[];
  heuristic: true;
  reason: string | null;
  note: string;
} | null;

type AssistResponse = {
  assist: {
    enabled: true;
    requestId: string;
    durationMs: number;
    generateOnly: boolean;
    emptyRoomAssistStatus: EmptyRoomAssistStatus;
    emptyRoomCacheStatus: EmptyRoomCacheStatus;
    attestedOriginalBasisFingerprint: string | null;
    attestedEmptyBasisFingerprint: string | null;
    coordinateCompatibility: CoordinateCompatibilitySummary;
    originalDetectionStatus: DetectionStatusLabel;
    emptyDetectionStatus: DetectionStatusLabel;
    // Phase 2H-H: concise, SAFE root cause when emptyDetectionStatus === "failed".
    // Derived solely from sanitized detector/mapper categories. null otherwise.
    emptyDetectionFailureReason: string | null;
    // Empty-quad self-validity + camera diagnostics (drives empty promotion).
    emptyQuadSelfValidity: EmptyQuadSelfValidity;
    // Downgrade-only structural-preservation heuristic (never a gate).
    structuralPreservation: StructuralPreservationSummary;
    // Diagnostic-only quad agreement between empty + original.
    agreement: QuadAgreementResult | null;
    poseCompatSummary: {
      originalSelectedConfidence: string | null;
      originalSelectedScore: number | null;
      emptySelectedConfidence: string | null;
      emptySelectedScore: number | null;
      bothGeometryConfident: boolean;
    } | null;
    // Phase 2H-J: read-only candidate extent / opening-ambiguity diagnostics.
    // Derived from the EMPTY detection's candidate set. NEVER changes selection,
    // scoring, or policy — diagnostic-only, to answer whether a correct maximal
    // candidate is present even when a smaller one is surfaced.
    extentDiagnostics: ExtentDiagnostics;
    // Phase 2H-JF: read-only multi-candidate same-plane FOV-consensus diagnostics.
    // Observation-only — never affects selection/scoring/confidence/camera gates.
    multiCandidateConsensus: MultiCandidateConsensus;
    recommendationProvenance: EmptyPrimaryProvenance;
    surfacedSource: SurfacedSource;
    confidenceCeiling: ConfidenceCeiling;
    // Phase 2H-G: advisory only. True when a valid camera pose was found. Does
    // NOT activate or relax any calibrated-camera gate.
    calibratedCameraEligible: boolean;
    policyReasons: string[];
    failureReason: string | null;
  };
  // The candidate the lab should preview/score/Apply (empty-primary by policy).
  // For aspect_compatible_rescaled this is the normalized-rescaled quad
  // expressed in the ORIGINAL image-space. null when nothing is surfaced.
  surfacedResult: AutoFloorDetectionResult | null;
  // Dual-detection diagnostics (preserved for benchmarking). Never auto-applied.
  // originalResult is in original image-space; emptyResult is in the EMPTY
  // image's own intrinsic space.
  originalResult: AutoFloorDetectionResult | null;
  emptyResult: AutoFloorDetectionResult | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function round4(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? value : Number(value.toFixed(4));
}

function parseSize(value: unknown): { width: number; height: number } | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.width) || !isFiniteNumber(value.height)) return null;
  if (value.width <= 0 || value.height <= 0) return null;
  return { width: value.width, height: value.height };
}

function parseFloorRect(value: unknown): { widthMeters: number; depthMeters: number } {
  if (!isRecord(value)) return DEFAULT_FLOOR_RECT;
  if (!isFiniteNumber(value.widthMeters) || !isFiniteNumber(value.depthMeters)) return DEFAULT_FLOOR_RECT;
  if (value.widthMeters <= 0 || value.depthMeters <= 0) return DEFAULT_FLOOR_RECT;
  return { widthMeters: value.widthMeters, depthMeters: value.depthMeters };
}

// Phase 2H-E: explicit compatibility tiers (replaces the binary exact gate).
function classifyCompatibility(
  original: { width: number; height: number; orientation: number },
  emptyMeta: ImageMetaResult
): CompatibilityClassification {
  const originalAspect = original.height > 0 ? original.width / original.height : null;
  if (!emptyMeta.ok) {
    return {
      tier: "incompatible",
      transferMode: "none",
      reason: "Empty-room image could not be decoded.",
      originalAspect: round4(originalAspect),
      emptyAspect: null,
      relativeAspectError: null,
    };
  }
  const emptyAspect = emptyMeta.height > 0 ? emptyMeta.width / emptyMeta.height : null;
  const relativeAspectError =
    originalAspect !== null && emptyAspect !== null && originalAspect > 0
      ? Math.abs(emptyAspect - originalAspect) / originalAspect
      : null;

  if (original.orientation !== 1 || emptyMeta.orientation !== 1) {
    return {
      tier: "incompatible",
      transferMode: "none",
      reason: "Image orientation is not supported for calibration transfer.",
      originalAspect: round4(originalAspect),
      emptyAspect: round4(emptyAspect),
      relativeAspectError: round4(relativeAspectError),
    };
  }
  if (emptyMeta.width === original.width && emptyMeta.height === original.height) {
    return {
      tier: "exact_grid_compatible",
      transferMode: "exact_grid",
      reason: null,
      originalAspect: round4(originalAspect),
      emptyAspect: round4(emptyAspect),
      relativeAspectError: round4(relativeAspectError),
    };
  }
  if (relativeAspectError !== null && relativeAspectError <= NBP_ASPECT_RELATIVE_ERROR_TOLERANCE) {
    return {
      tier: "aspect_compatible_rescaled",
      transferMode: "aspect_rescaled",
      reason: null,
      originalAspect: round4(originalAspect),
      emptyAspect: round4(emptyAspect),
      relativeAspectError: round4(relativeAspectError),
    };
  }
  return {
    tier: "incompatible",
    transferMode: "none",
    reason:
      relativeAspectError === null
        ? "Empty-room image metadata is invalid for transfer."
        : `Empty-room aspect ratio diverges too far for transfer (relative error ${(relativeAspectError * 100).toFixed(2)}% > ${(NBP_ASPECT_RELATIVE_ERROR_TOLERANCE * 100).toFixed(2)}%).`,
    originalAspect: round4(originalAspect),
    emptyAspect: round4(emptyAspect),
    relativeAspectError: round4(relativeAspectError),
  };
}

// Maps a detection outcome into a concrete result so failed Gemini calls are
// labeled "failed" (not "skipped") and carry a safe failure reason.
function outcomeToResult(outcome: DetectFloorOutcome): AutoFloorDetectionResult {
  if (outcome.ok) return outcome.result;
  if (outcome.failureKind === "mapping") return outcome.result;
  return {
    status: "failed",
    candidates: [],
    selectedCandidateId: null,
    notes: [],
    failureReasons: [outcome.info.uiReason],
  };
}

// Phase 2H-H: derive a concise, SAFE failure reason from a detection outcome.
// Only uses already-sanitized categories produced by the shared detector
// (Gemini failure classifier `uiReason`) and the mapper/validator
// (`failureReasons`, e.g. "No valid vision candidates after validation.",
// "All vision candidates scored as geometrically invalid.", "coordinate grossly
// out of range", "Gemini response was truncated…"). NEVER returns raw model
// output, prompts, URLs, bytes, keys, or upstream bodies.
function deriveDetectionFailureReason(outcome: DetectFloorOutcome): string | null {
  if (outcome.ok) {
    if (outcome.result.status === "failed") {
      return outcome.result.failureReasons[0] ?? "No usable floor candidate was produced.";
    }
    return null;
  }
  if (outcome.failureKind === "gemini") {
    // uiReason is the sanitized UI category from classifyGeminiAutoFloorFailure.
    return outcome.info.uiReason;
  }
  // mapping: use a fixed safe category (never echo the raw mapper error text).
  return "Vision response could not be processed (mapping/validation failure).";
}

function detectionStatusLabel(result: AutoFloorDetectionResult | null): DetectionStatusLabel {
  if (!result) return "skipped";
  if (result.status === "failed") return "failed";
  if (result.status === "needs_review") return "needs_review";
  if (result.status === "ok") return "ok";
  return "needs_review";
}

function selectedCandidate(result: AutoFloorDetectionResult | null) {
  if (!result) return null;
  return result.candidates.find((c) => c.id === result.selectedCandidateId) ?? null;
}

// Phase 2H-J: read-only candidate extent / opening-ambiguity diagnostics.
type ExtentDiagnostics = {
  emptyCandidateCount: number;
  originalCandidateCount: number;
  selectedCandidateRank: number | null;
  selectedCandidateIntent: string | null;
  selectedCandidateArea: number | null;
  largestValidCandidateArea: number | null;
  selectedVsLargestAreaRatio: number | null;
  openingAmbiguityFlag: boolean;
  retryOccurred: boolean;
  retryReason: string | null;
};

const EMPTY_EXTENT_DIAGNOSTICS: ExtentDiagnostics = {
  emptyCandidateCount: 0,
  originalCandidateCount: 0,
  selectedCandidateRank: null,
  selectedCandidateIntent: null,
  selectedCandidateArea: null,
  largestValidCandidateArea: null,
  selectedVsLargestAreaRatio: null,
  openingAmbiguityFlag: false,
  retryOccurred: false,
  retryReason: null,
};

// Two distinct valid candidates count as "materially different" extents when the
// smaller covers under this fraction of the larger (i.e. > ~20% area spread).
const OPENING_AMBIGUITY_AREA_RATIO = 0.8;

// A candidate is geometry-VALID when the mapper did not tag it invalid. This
// reuses the mapper's existing decision (no re-scoring, no policy change).
function isGeometryValidCandidate(candidate: AutoFloorCalibrationCandidate): boolean {
  return !candidate.risks.includes("geometry-score-invalid");
}

// Pure, read-only diagnostics computed over the EMPTY detection's candidate set
// (uniform intrinsic-empty normalized space). Does NOT influence selection,
// scoring, transfer, or policy — it only observes what was returned.
function computeExtentDiagnostics(
  emptyResult: AutoFloorDetectionResult | null,
  originalResult: AutoFloorDetectionResult | null
): ExtentDiagnostics {
  const emptyCandidates = emptyResult?.candidates ?? [];
  const selectedId = emptyResult?.selectedCandidateId ?? null;
  const selectedIndex = selectedId ? emptyCandidates.findIndex((c) => c.id === selectedId) : -1;
  const selected = selectedIndex >= 0 ? emptyCandidates[selectedIndex] : null;

  const validAreas = emptyCandidates
    .filter(isGeometryValidCandidate)
    .map((c) => polygonArea(c.quadNorm))
    .filter((a) => Number.isFinite(a) && a > 0);

  const largestValidCandidateArea = validAreas.length > 0 ? Math.max(...validAreas) : null;
  const selectedCandidateArea = selected ? polygonArea(selected.quadNorm) : null;
  const selectedVsLargestAreaRatio =
    selectedCandidateArea !== null && largestValidCandidateArea !== null && largestValidCandidateArea > 0
      ? selectedCandidateArea / largestValidCandidateArea
      : null;

  let openingAmbiguityFlag = false;
  if (validAreas.length >= 2) {
    const minA = Math.min(...validAreas);
    const maxA = Math.max(...validAreas);
    openingAmbiguityFlag = maxA > 0 && minA / maxA < OPENING_AMBIGUITY_AREA_RATIO;
  }

  return {
    emptyCandidateCount: emptyCandidates.length,
    originalCandidateCount: originalResult?.candidates.length ?? 0,
    selectedCandidateRank: selectedIndex >= 0 ? selectedIndex : null,
    selectedCandidateIntent: selected ? safeStr(selected.intent ?? null) : null,
    selectedCandidateArea: round4(selectedCandidateArea),
    largestValidCandidateArea: round4(largestValidCandidateArea),
    selectedVsLargestAreaRatio: round4(selectedVsLargestAreaRatio),
    openingAmbiguityFlag,
    retryOccurred: false,
    retryReason: null,
  };
}

// Phase 2H-E: re-express an EMPTY-image-space detection result in the ORIGINAL
// image-space using NORMALIZED source coordinates only. For each candidate, the
// container-normalized quad (empty cover-crop) is taken back to the empty
// intrinsic-source-normalized quad (the model's native space), reinterpreted AS
// original source-normalized (valid because aspects match within tolerance),
// then projected through the ORIGINAL object-cover path for display. No
// pixel-space stretching; no claim of exact pixel-grid equivalence.
function transferResultToOriginalContainerSpace(
  result: AutoFloorDetectionResult,
  emptySize: { width: number; height: number },
  originalSize: { width: number; height: number },
  frameSize: { width: number; height: number }
): AutoFloorDetectionResult {
  const candidates: AutoFloorCalibrationCandidate[] = [];
  for (const candidate of result.candidates) {
    const remapped: Vec2[] = [];
    let ok = true;
    for (const point of candidate.quadNorm) {
      const emptySourceNorm = containerNormToSourceNorm(point, emptySize, frameSize);
      if (!emptySourceNorm) {
        ok = false;
        break;
      }
      const originalContainerNorm = sourceNormToContainerNorm(emptySourceNorm, originalSize, frameSize);
      if (!originalContainerNorm) {
        ok = false;
        break;
      }
      remapped.push({ x: originalContainerNorm.x, y: originalContainerNorm.y });
    }
    if (!ok || remapped.length !== 4) continue;
    candidates.push({
      ...candidate,
      quadNorm: [remapped[0], remapped[1], remapped[2], remapped[3]],
      notes: [...candidate.notes, "Aspect-tolerant rescaled transfer into original normalized image-space."],
    });
  }
  const selectedStillPresent = candidates.some((c) => c.id === result.selectedCandidateId);
  return {
    ...result,
    candidates,
    selectedCandidateId: selectedStillPresent ? result.selectedCandidateId : candidates[0]?.id ?? null,
  };
}

// Converts the selected candidate's ordered container-normalized quad back into
// intrinsic-source-normalized space (the comparison space). `intrinsicSize` is
// the source size that produced the result's container coordinates (original
// size for the original/transferred result; empty size for the raw empty
// result). Under aspect tolerance both source-normalized quads are comparable.
function selectedQuadInSourceSpace(
  result: AutoFloorDetectionResult | null,
  intrinsicSize: { width: number; height: number },
  frameSize: { width: number; height: number }
): Vec2[] | null {
  const sel = selectedCandidate(result);
  if (!sel) return null;
  const out: Vec2[] = [];
  for (const point of sel.quadNorm) {
    const s = containerNormToSourceNorm(point, intrinsicSize, frameSize);
    if (!s) return null;
    out.push({ x: s.x, y: s.y });
  }
  return out.length === 4 ? out : null;
}

type CameraDiagnostics = {
  ok: boolean;
  confidence: "high" | "low" | null;
  bestFovDeg: number | null;
  validFovCount: number;
  validFovRange: [number, number] | null;
  reason: string | null;
};

// Empty-quad camera diagnostics: confirm the empty quad admits a physically
// plausible camera. Phase 2H-F — this now uses the SAME canonical FOV scan the
// lab calibration path uses (20°–90°), instead of a single fixed 60° probe.
//
// This is NOT a relaxed gate: every scanned FOV still runs the full
// decomposeHomographyToCameraPose validity checks (cheirality / reprojection /
// scale / orthonormality). The gate passes only when at least one plausible
// scanned FOV yields a valid pose. Low best-confidence still only downgrades.
function computeCameraDiagnostics(
  candidate: AutoFloorCalibrationCandidate,
  frameSize: { width: number; height: number },
  floorRect: { widthMeters: number; depthMeters: number }
): CameraDiagnostics {
  const blocked = (reason: string): CameraDiagnostics => ({
    ok: false,
    confidence: null,
    bestFovDeg: null,
    validFovCount: 0,
    validFovRange: null,
    reason,
  });

  const px: Vec2[] = [];
  for (const point of candidate.quadNorm) {
    const pixels = normToPixels(point, frameSize);
    if (!pixels) return blocked("Could not convert ordered corners from normalized to frame pixels.");
    px.push(pixels);
  }
  const rect = getFloorRectCorners({ widthMeters: floorRect.widthMeters, depthMeters: floorRect.depthMeters });
  if (!rect.ok) return blocked(`Floor rect assumption invalid: ${rect.reason}`);
  const target = rect.value.asArray.map((p) => floorVec3ToPlane2D(p));
  const homography = solvePlaneHomography(px, target);
  if (!homography.ok) return blocked(`Homography solve failed: ${homography.reason}`);

  const scan = scanCameraPoseOverFov(homography.value, frameSize, {
    floorPlanePoints2D: target,
    imagePointsPx: px,
  });
  if (!scan.ok) {
    return blocked(
      `No plausible FOV in ${DEFAULT_FOV_SCAN_MIN_DEG}-${DEFAULT_FOV_SCAN_MAX_DEG}° yielded a valid camera pose` +
        (scan.firstFailureReason ? ` (e.g. ${scan.firstFailureReason})` : ".")
    );
  }
  return {
    ok: true,
    confidence: scan.bestConfidence,
    bestFovDeg: scan.bestFovDeg,
    validFovCount: scan.validCount,
    validFovRange: scan.validFovRange,
    reason: null,
  };
}

// --- Phase 2H-JF: multi-candidate same-plane FOV-consensus DIAGNOSTICS --------
// Observation-only. Runs the EXISTING canonical FOV scan independently for each
// already-geometry-valid candidate and derives whether the candidates are
// jointly consistent with one camera viewing one floor plane. Nothing here
// changes selection, scoring, confidence, calibrated-camera eligibility, Apply,
// or any gate — it only reports derived diagnostics.
//
// Anchor-independent rationale: each candidate's homography is fit to the SAME
// assumed floor rect, so world camera position/height and the homography matrix
// are anchored per-quad and are NOT comparable across disjoint bays. Vertical
// FOV is a camera intrinsic independent of where a patch sits on the plane, so
// overlap between candidates' VALID FOV ranges is the only safe joint signal.
// We deliberately do NOT use homography similarity, camera position/height
// similarity, IoU, or corner-distance agreement here.

type SamePlaneConsensusStatus =
  | "not_applicable"
  | "insufficient_candidates"
  | "no_joint_pose_validity"
  | "fov_ranges_overlap"
  | "fov_ranges_disjoint"
  | "inconclusive";

type CandidatePoseScan = {
  rank: number;
  intent: string | null;
  geometryBand: "high" | "medium" | "low";
  hasClampedCorner: boolean;
  // The mapper records `corner-out-of-frame-clamped` as a single boolean-style
  // risk tag, so an exact clamped-corner count is NOT derivable: 0 when not
  // clamped, null (unknown) when clamped.
  clampedCornerCount: number | null;
  poseScanOk: boolean;
  bestFovDeg: number | null;
  bestConfidence: "high" | "low" | null;
  validFovRange: [number, number] | null;
  validFovCount: number;
  bestAvgReprojPx: number | null;
  bestMaxReprojPx: number | null;
  failureReason: string | null;
};

type MultiCandidateConsensus = {
  eligibleCandidateCount: number;
  poseValidCandidateCount: number;
  samePlaneConsensusStatus: SamePlaneConsensusStatus;
  consensusCandidateIndexes: number[];
  bestFovSpreadDeg: number | null;
  sharedFovRange: [number, number] | null;
  hasClampedCandidateInConsensus: boolean;
  // Advisory ONLY: which candidate a FUTURE policy would prefer as anchor. Does
  // NOT change the selected/surfaced candidate in this phase.
  advisoryPreferredAnchorIndex: number | null;
  advisoryPreferredAnchorReason: string | null;
  candidates: CandidatePoseScan[];
  note: string | null;
};

const EMPTY_MULTI_CANDIDATE_CONSENSUS: MultiCandidateConsensus = {
  eligibleCandidateCount: 0,
  poseValidCandidateCount: 0,
  samePlaneConsensusStatus: "not_applicable",
  consensusCandidateIndexes: [],
  bestFovSpreadDeg: null,
  sharedFovRange: null,
  hasClampedCandidateInConsensus: false,
  advisoryPreferredAnchorIndex: null,
  advisoryPreferredAnchorReason: null,
  candidates: [],
  note: null,
};

// Intersection of two inclusive [min,max] FOV-degree ranges (null when disjoint).
// No invented threshold: this is a pure set operation over the scan's own ranges.
function intersectRange(
  a: [number, number] | null,
  b: [number, number] | null
): [number, number] | null {
  if (!a || !b) return null;
  const lo = Math.max(a[0], b[0]);
  const hi = Math.min(a[1], b[1]);
  return lo <= hi ? [lo, hi] : null;
}

// Runs the EXISTING FOV scan for one candidate (same solve the selected-candidate
// path uses). Returns the raw scan or a concise solve-failure reason. No gate is
// relaxed — every FOV still runs the full decomposeHomographyToCameraPose checks.
function scanCandidatePoseFull(
  candidate: AutoFloorCalibrationCandidate,
  frameSize: { width: number; height: number },
  floorRect: { widthMeters: number; depthMeters: number }
): { solveOk: boolean; reason: string | null; scan: FovScanResult | null } {
  const px: Vec2[] = [];
  for (const point of candidate.quadNorm) {
    const pixels = normToPixels(point, frameSize);
    if (!pixels) return { solveOk: false, reason: "pixel conversion failed", scan: null };
    px.push(pixels);
  }
  const rect = getFloorRectCorners({ widthMeters: floorRect.widthMeters, depthMeters: floorRect.depthMeters });
  if (!rect.ok) return { solveOk: false, reason: "floor rect invalid", scan: null };
  const target = rect.value.asArray.map((p) => floorVec3ToPlane2D(p));
  const homography = solvePlaneHomography(px, target);
  if (!homography.ok) return { solveOk: false, reason: "homography solve failed", scan: null };
  const scan = scanCameraPoseOverFov(homography.value, frameSize, {
    floorPlanePoints2D: target,
    imagePointsPx: px,
  });
  return { solveOk: true, reason: null, scan };
}

const GEOM_BAND_RANK: Record<"high" | "medium" | "low", number> = { high: 3, medium: 2, low: 1 };

// Advisory anchor ordering (read-only): fully in-frame > stronger geometry band >
// lower avg reproj > lower max reproj > wider valid FOV range > higher pose
// confidence. NEVER applied to selection; explanatory only.
function compareAnchorPreference(a: CandidatePoseScan, b: CandidatePoseScan): number {
  if (a.hasClampedCorner !== b.hasClampedCorner) return a.hasClampedCorner ? 1 : -1;
  if (GEOM_BAND_RANK[a.geometryBand] !== GEOM_BAND_RANK[b.geometryBand]) {
    return GEOM_BAND_RANK[b.geometryBand] - GEOM_BAND_RANK[a.geometryBand];
  }
  const aAvg = a.bestAvgReprojPx ?? Infinity;
  const bAvg = b.bestAvgReprojPx ?? Infinity;
  if (aAvg !== bAvg) return aAvg - bAvg;
  const aMax = a.bestMaxReprojPx ?? Infinity;
  const bMax = b.bestMaxReprojPx ?? Infinity;
  if (aMax !== bMax) return aMax - bMax;
  const aWidth = a.validFovRange ? a.validFovRange[1] - a.validFovRange[0] : -1;
  const bWidth = b.validFovRange ? b.validFovRange[1] - b.validFovRange[0] : -1;
  if (aWidth !== bWidth) return bWidth - aWidth;
  const aConf = a.bestConfidence === "high" ? 1 : 0;
  const bConf = b.bestConfidence === "high" ? 1 : 0;
  return bConf - aConf;
}

function describeAnchor(s: CandidatePoseScan): string {
  const parts = [
    `#${s.rank}`,
    s.hasClampedCorner ? "CLAMPED (inferred)" : "in-frame",
    `geom ${s.geometryBand}`,
  ];
  if (s.bestAvgReprojPx !== null) parts.push(`avgReproj ${s.bestAvgReprojPx}px`);
  if (s.validFovRange) parts.push(`FOV ${s.validFovRange[0]}-${s.validFovRange[1]}°`);
  if (s.bestConfidence) parts.push(`pose ${s.bestConfidence}`);
  return parts.join(", ");
}

// Pure, read-only same-plane consensus over the EMPTY detection's candidate set
// (in the surfaced space, matching the selected-candidate pose scan's space).
function computeMultiCandidateConsensus(
  result: AutoFloorDetectionResult | null,
  frameSize: { width: number; height: number },
  floorRect: { widthMeters: number; depthMeters: number }
): MultiCandidateConsensus {
  const all = result?.candidates ?? [];
  // Entry gate: ONLY already-geometry-valid candidates participate. We never
  // revive or reinterpret candidates the mapper tagged invalid.
  const eligible = all
    .map((candidate, idx) => ({ candidate, idx }))
    .filter(({ candidate }) => !candidate.risks.includes("geometry-score-invalid"));

  if (eligible.length === 0) {
    return { ...EMPTY_MULTI_CANDIDATE_CONSENSUS, note: "No geometry-valid candidates." };
  }

  const scans: CandidatePoseScan[] = eligible.map(({ candidate, idx }) => {
    const hasClamped = candidate.risks.includes("corner-out-of-frame-clamped");
    const band: "high" | "medium" | "low" =
      candidate.confidence === "high" ? "high" : candidate.confidence === "medium" ? "medium" : "low";
    const base = {
      rank: idx,
      intent: safeStr(candidate.intent ?? null),
      geometryBand: band,
      hasClampedCorner: hasClamped,
      clampedCornerCount: hasClamped ? null : 0,
    };
    const r = scanCandidatePoseFull(candidate, frameSize, floorRect);
    if (!r.solveOk || !r.scan) {
      return {
        ...base,
        poseScanOk: false,
        bestFovDeg: null,
        bestConfidence: null,
        validFovRange: null,
        validFovCount: 0,
        bestAvgReprojPx: null,
        bestMaxReprojPx: null,
        failureReason: r.reason ?? "homography/pose solve failed",
      };
    }
    const s = r.scan;
    return {
      ...base,
      poseScanOk: s.ok,
      bestFovDeg: s.bestFovDeg,
      bestConfidence: s.bestConfidence,
      validFovRange: s.validFovRange,
      validFovCount: s.validCount,
      bestAvgReprojPx: round4(s.bestAvgPx),
      bestMaxReprojPx: round4(s.bestMaxPx),
      failureReason: s.ok ? null : s.firstFailureReason ?? "no valid FOV pose",
    };
  });

  const poseValid = scans.filter((s) => s.poseScanOk && s.validFovRange);
  const eligibleCandidateCount = scans.length;
  const poseValidCandidateCount = poseValid.length;

  let status: SamePlaneConsensusStatus;
  let consensusCandidateIndexes: number[] = [];
  let sharedFovRange: [number, number] | null = null;
  let bestFovSpreadDeg: number | null = null;
  let hasClampedCandidateInConsensus = false;
  let advisoryPreferredAnchorIndex: number | null = null;
  let advisoryPreferredAnchorReason: string | null = null;
  let note: string | null = null;

  if (eligibleCandidateCount < 2) {
    status = "insufficient_candidates";
    note = "Fewer than two geometry-valid candidates; consensus is not meaningful.";
  } else if (poseValidCandidateCount < 2) {
    status = "no_joint_pose_validity";
    note = "Fewer than two candidates produced a valid camera pose.";
  } else {
    const ranges = poseValid.map((s) => s.validFovRange!);
    const fullIntersection = ranges.reduce<[number, number] | null>(
      (acc, r) => intersectRange(acc, r),
      ranges[0]
    );
    const bestFovs = poseValid
      .map((s) => s.bestFovDeg)
      .filter((n): n is number => n !== null);
    bestFovSpreadDeg =
      bestFovs.length > 0 ? Number((Math.max(...bestFovs) - Math.min(...bestFovs)).toFixed(2)) : null;

    if (fullIntersection) {
      status = "fov_ranges_overlap";
      sharedFovRange = fullIntersection;
      consensusCandidateIndexes = poseValid.map((s) => s.rank);
    } else {
      const overlapping = poseValid.filter((a) =>
        poseValid.some((b) => b.rank !== a.rank && intersectRange(a.validFovRange, b.validFovRange))
      );
      if (overlapping.length === 0) {
        status = "fov_ranges_disjoint";
        note = "No candidate valid-FOV ranges overlap (not jointly consistent with one camera).";
      } else {
        status = "inconclusive";
        consensusCandidateIndexes = overlapping.map((s) => s.rank);
        note = "Some but not all candidate valid-FOV ranges overlap.";
      }
    }

    // Advisory-only anchor preference among the pose-valid candidates.
    const ranked = [...poseValid].sort(compareAnchorPreference);
    const anchor = ranked[0] ?? null;
    if (anchor) {
      advisoryPreferredAnchorIndex = anchor.rank;
      advisoryPreferredAnchorReason = describeAnchor(anchor);
    }

    const consensusSet = consensusCandidateIndexes.length > 0
      ? consensusCandidateIndexes
      : poseValid.map((s) => s.rank);
    hasClampedCandidateInConsensus = consensusSet.some(
      (idx) => scans.find((s) => s.rank === idx)?.hasClampedCorner ?? false
    );
  }

  return {
    eligibleCandidateCount,
    poseValidCandidateCount,
    samePlaneConsensusStatus: status,
    consensusCandidateIndexes,
    bestFovSpreadDeg,
    sharedFovRange,
    hasClampedCandidateInConsensus,
    advisoryPreferredAnchorIndex,
    advisoryPreferredAnchorReason,
    candidates: scans,
    note,
  };
}

function logAssist(fields: Record<string, unknown>): void {
  console.log("[empty-room-assist]", fields);
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const requestId = getRequestIdFromHeaders(request.headers, "empty-room-assist");

  const baseUnavailable = (
    status: EmptyRoomAssistStatus,
    reason: string,
    cacheStatus: EmptyRoomCacheStatus = "not_used",
    generateOnly = false,
    provenance: EmptyPrimaryProvenance = "manual_required",
    attestedOriginalBasisFingerprint: string | null = null
  ): AssistResponse => ({
    assist: {
      enabled: true,
      requestId,
      durationMs: Date.now() - startedAt,
      generateOnly,
      emptyRoomAssistStatus: status,
      emptyRoomCacheStatus: cacheStatus,
      attestedOriginalBasisFingerprint,
      attestedEmptyBasisFingerprint: null,
      coordinateCompatibility: {
        ok: false,
        tier: "incompatible",
        transferMode: "none",
        reason: null,
        originalSize: null,
        emptySize: null,
        originalOrientation: null,
        emptyOrientation: null,
        originalAspect: null,
        emptyAspect: null,
        relativeAspectError: null,
      },
      originalDetectionStatus: "skipped",
      emptyDetectionStatus: "skipped",
      emptyDetectionFailureReason: null,
      emptyQuadSelfValidity: null,
      structuralPreservation: null,
      agreement: null,
      poseCompatSummary: null,
      extentDiagnostics: EMPTY_EXTENT_DIAGNOSTICS,
      multiCandidateConsensus: EMPTY_MULTI_CANDIDATE_CONSENSUS,
      recommendationProvenance: provenance,
      surfacedSource: null,
      confidenceCeiling: null,
      calibratedCameraEligible: false,
      policyReasons: [reason],
      failureReason: reason,
    },
    surfacedResult: null,
    originalResult: null,
    emptyResult: null,
  });

  if (!isEmptyRoomAssistEnabled()) {
    return NextResponse.json(
      baseUnavailable("unavailable", "Empty-room assist is disabled on the server."),
      { status: 200 }
    );
  }
  if (!isAutoFloorVisionEnabled()) {
    return NextResponse.json(
      baseUnavailable("unavailable", "Vision floor detection is disabled on the server."),
      { status: 200 }
    );
  }
  const apiKey = getAutoFloorVisionApiKey();
  if (!apiKey) {
    return NextResponse.json(
      baseUnavailable("unavailable", "Server is not configured with a Gemini API key."),
      { status: 200 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(baseUnavailable("failed", "Request body was not valid JSON."), { status: 200 });
  }
  const record = isRecord(body) ? body : {};
  const imageUrl = safeStr(record.imageUrl);
  const frameSize = parseSize(record.frameSize);
  const intrinsicSize = parseSize(record.intrinsicSize) ?? parseSize(record.sourceSize);
  const floorRect = parseFloorRect(record.floorRect);
  const generateOnly = record.generateOnly === true;
  const expectedBasisFingerprint = safeStr(record.expectedBasisFingerprint);

  if (!frameSize) {
    return NextResponse.json(baseUnavailable("failed", "Missing or invalid frame size.", "not_used", generateOnly), { status: 200 });
  }
  if (!intrinsicSize) {
    return NextResponse.json(baseUnavailable("failed", "Missing or invalid intrinsic/source image size.", "not_used", generateOnly), {
      status: 200,
    });
  }
  if (!imageUrl) {
    return NextResponse.json(baseUnavailable("failed", "Missing image URL.", "not_used", generateOnly), { status: 200 });
  }
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) {
    return NextResponse.json(
      baseUnavailable("failed", "Inline (data/blob) images are not supported.", "not_used", generateOnly),
      { status: 200 }
    );
  }

  // 1. Fetch + verify the ORIGINAL image (same SSRF/MIME/size + dimension/EXIF
  // standards as direct detection).
  const original = await fetchRoomImageSafely(imageUrl, {
    allowedHosts: getAutoFloorVisionAllowedImageHosts(),
    maxBytes: getAutoFloorVisionImageMaxBytes(),
    timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
    allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
  });
  if (!original.ok) {
    logAssist({ requestId, route: ASSIST_ROUTE, stage: "fetch_original", reason: original.reason });
    return NextResponse.json(baseUnavailable("failed", original.reason, "not_used", generateOnly), { status: 200 });
  }
  const originalMeta = await inspectImageMetadata(original.buffer);
  if (!originalMeta.ok) {
    return NextResponse.json(baseUnavailable("failed", originalMeta.reason, "not_used", generateOnly), { status: 200 });
  }
  if (originalMeta.orientation !== 1) {
    return NextResponse.json(
      baseUnavailable("blocked", "Original image orientation is not supported for calibration.", "not_used", generateOnly),
      { status: 200 }
    );
  }
  if (originalMeta.width !== intrinsicSize.width || originalMeta.height !== intrinsicSize.height) {
    return NextResponse.json(
      baseUnavailable("failed", "Original image dimensions changed before assist could run.", "not_used", generateOnly),
      { status: 200 }
    );
  }
  const originalSize = { width: originalMeta.width, height: originalMeta.height };
  const originalHash = createHash("sha256").update(original.buffer).digest("hex");
  if (expectedBasisFingerprint && expectedBasisFingerprint !== originalHash) {
    return NextResponse.json(
      baseUnavailable(
        "blocked",
        "basis_fingerprint_mismatch",
        "not_used",
        generateOnly,
        "manual_required",
        originalHash
      ),
      { status: 200 }
    );
  }

  // 2. Generate / retrieve the Empty Room image (no charge / no persistence).
  const generation = await getOrGenerateEmptyRoomImage({
    originalHash,
    baseImageUrl: imageUrl,
    resultAllowedHosts: getEmptyRoomAssistResultAllowedHosts(),
    maxBytes: getAutoFloorVisionImageMaxBytes(),
    fetchTimeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
    allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
    generationTimeoutMs: EMPTY_ROOM_GEN_TIMEOUT_MS,
  });

  if (!generation.ok) {
    const status: EmptyRoomAssistStatus = generation.cacheStatus === "unavailable" ? "unavailable" : "failed";
    logAssist({
      requestId,
      route: ASSIST_ROUTE,
      stage: "generate",
      cacheStatus: generation.cacheStatus,
      genStage: generation.stage,
      reason: generation.reason,
    });
    return NextResponse.json(
      baseUnavailable(status, generation.reason, generation.cacheStatus, generateOnly),
      { status: 200 }
    );
  }

  const emptyCacheStatus = generation.cacheStatus;

  // Verify Empty Room decoded dimensions/orientation and classify compatibility.
  const emptyBuffer = Buffer.from(generation.image.base64, "base64");
  const attestedEmptyBasisFingerprint = computeCalibrationImageFingerprint(emptyBuffer);
  const emptyMeta = await inspectImageMetadata(emptyBuffer);
  const compat = classifyCompatibility(
    { width: originalSize.width, height: originalSize.height, orientation: originalMeta.orientation },
    emptyMeta
  );
  const emptySize = emptyMeta.ok ? { width: emptyMeta.width, height: emptyMeta.height } : null;
  const compatibleForTransfer = compat.tier !== "incompatible";
  const aspectTolerantTransfer = compat.tier === "aspect_compatible_rescaled";

  const coordinateCompatibility: CoordinateCompatibilitySummary = {
    ok: compatibleForTransfer,
    tier: compat.tier,
    transferMode: compat.transferMode,
    reason: compat.reason,
    originalSize,
    emptySize,
    originalOrientation: originalMeta.orientation,
    emptyOrientation: emptyMeta.ok ? emptyMeta.orientation : null,
    originalAspect: compat.originalAspect,
    emptyAspect: compat.emptyAspect,
    relativeAspectError: compat.relativeAspectError,
  };

  if (generateOnly) {
    // Warm-the-cache action only: no detection.
    logAssist({
      requestId,
      route: ASSIST_ROUTE,
      stage: "generate_only",
      cacheStatus: emptyCacheStatus,
      durationMs: Date.now() - startedAt,
      emptyDecoded: emptyMeta.ok,
      tier: compat.tier,
      relativeAspectError: compat.relativeAspectError,
    });
    return NextResponse.json(
      {
        assist: {
          enabled: true,
          requestId,
          durationMs: Date.now() - startedAt,
          generateOnly: true,
          emptyRoomAssistStatus: "generated",
          emptyRoomCacheStatus: emptyCacheStatus,
          attestedOriginalBasisFingerprint: originalHash,
          attestedEmptyBasisFingerprint: null,
          coordinateCompatibility,
          originalDetectionStatus: "skipped",
          emptyDetectionStatus: "skipped",
          emptyDetectionFailureReason: null,
          emptyQuadSelfValidity: null,
          structuralPreservation: null,
          agreement: null,
          poseCompatSummary: null,
          extentDiagnostics: EMPTY_EXTENT_DIAGNOSTICS,
          multiCandidateConsensus: EMPTY_MULTI_CANDIDATE_CONSENSUS,
          recommendationProvenance: "manual_required",
          surfacedSource: null,
          confidenceCeiling: null,
          calibratedCameraEligible: false,
          policyReasons: ["Generate-only: empty-room image warmed; detection not run."],
          failureReason: null,
        },
        surfacedResult: null,
        originalResult: null,
        emptyResult: null,
      } satisfies AssistResponse,
      { status: 200 }
    );
  }

  // 3. DUAL detection (preserved for diagnostics/benchmarking). The ORIGINAL is
  // diagnostic-only; the EMPTY is the promotion candidate.
  const originalDetect = await detectFloorFromVerifiedBytes({
    apiKey,
    model: getAutoFloorVisionModel(),
    image: { base64: original.base64, mime: original.mime, byteCount: original.byteCount },
    sourceSize: originalSize,
    frameSize,
    floorRect,
    maxCandidates: MAX_CANDIDATES,
    timeoutMs: getAutoFloorVisionGeminiTimeoutMs(),
    accounting: { requestId, route: ASSIST_ROUTE, userId: adminUser.id ?? null },
  });
  const originalResult: AutoFloorDetectionResult = outcomeToResult(originalDetect);
  const originalStatus = detectionStatusLabel(originalResult);
  const originalSelected = selectedCandidate(originalResult);
  const originalOk = originalStatus === "ok" || originalStatus === "needs_review";

  // Empty detection only when compatible (exact OR aspect-tolerant). The empty
  // detector ALWAYS runs against the EMPTY image's TRUE decoded dimensions, so
  // its output is intrinsic-source-normalized to the empty image.
  let emptyResult: AutoFloorDetectionResult | null = null;
  let emptyDetectionFailureReasonRaw: string | null = null;
  if (compatibleForTransfer && emptySize) {
    const emptyDetect = await detectFloorFromVerifiedBytes({
      apiKey,
      model: getAutoFloorVisionModel(),
      image: { base64: generation.image.base64, mime: generation.image.mime, byteCount: generation.image.byteCount },
      sourceSize: emptySize,
      frameSize,
      floorRect,
      maxCandidates: MAX_CANDIDATES,
      timeoutMs: getAutoFloorVisionGeminiTimeoutMs(),
      accounting: { requestId, route: ASSIST_ROUTE, userId: adminUser.id ?? null },
    });
    emptyResult = outcomeToResult(emptyDetect);
    emptyDetectionFailureReasonRaw = deriveDetectionFailureReason(emptyDetect);
  }
  const emptyStatus: DetectionStatusLabel = compatibleForTransfer ? detectionStatusLabel(emptyResult) : "skipped";
  const emptyOk = emptyStatus === "ok" || emptyStatus === "needs_review";
  // Phase 2H-H: only surface a failure reason when the Empty detection FAILED.
  const emptyDetectionFailureReason: string | null =
    emptyStatus === "failed"
      ? emptyDetectionFailureReasonRaw ?? emptyResult?.failureReasons?.[0] ?? "Empty-room detection failed."
      : null;

  // Surfaced empty candidate, expressed in ORIGINAL image-space:
  //   - exact_grid: empty already shares the original grid -> use as-is.
  //   - aspect_rescaled: transfer the empty quad via normalized coordinates.
  let surfacedEmptyResult: AutoFloorDetectionResult | null = null;
  if (emptyResult && emptySize) {
    surfacedEmptyResult = aspectTolerantTransfer
      ? transferResultToOriginalContainerSpace(emptyResult, emptySize, originalSize, frameSize)
      : emptyResult;
  }
  const surfacedEmptySelected = selectedCandidate(surfacedEmptyResult);

  // 4. Empty-quad self-validity + camera diagnostics (HARD gates for promotion),
  // scored on the SURFACED (original-space) quad.
  let emptyQuadSelfValidity: EmptyQuadSelfValidity = null;
  let emptySelfValidityBand: ReturnType<typeof scoreAutoFloorCandidateGeometry>["scoreBand"] | null = null;
  let emptyCameraPoseOk = false;
  let emptyCameraPoseConfidence: "high" | "low" | null = null;
  let emptyCameraPoseBestFovDeg: number | null = null;
  let emptyCameraPoseValidFovCount = 0;
  let emptyCameraPoseReason: string | null = null;
  if (surfacedEmptySelected) {
    const emptyScore = scoreAutoFloorCandidateGeometry(surfacedEmptySelected, { frameSize, floorRect });
    emptySelfValidityBand = emptyScore.scoreBand;
    const cam = computeCameraDiagnostics(surfacedEmptySelected, frameSize, floorRect);
    emptyCameraPoseOk = cam.ok;
    emptyCameraPoseConfidence = cam.confidence;
    emptyCameraPoseBestFovDeg = cam.bestFovDeg;
    emptyCameraPoseValidFovCount = cam.validFovCount;
    emptyCameraPoseReason = cam.reason;
    emptyQuadSelfValidity = {
      band: emptyScore.scoreBand,
      cameraPoseOk: cam.ok,
      cameraPoseConfidence: cam.confidence,
      cameraPoseBestFovDeg: cam.bestFovDeg,
      cameraPoseValidFovCount: cam.validFovCount,
      cameraPoseValidFovRange: cam.validFovRange,
      cameraPoseReason: cam.reason,
    };
  }

  // 5. Structural-preservation heuristic (DOWNGRADE-ONLY). Runs whenever a
  // transfer is possible. The probe resizes both images to a common grid, so it
  // is valid for aspect-rescaled pairs too. Never gates or promotes.
  let structuralPreservation: StructuralPreservationSummary = null;
  if (compatibleForTransfer) {
    const probe = await probeStructuralPreservation(original.buffer, emptyBuffer);
    structuralPreservation = {
      ok: probe.ok,
      score: probe.score,
      band: probe.band,
      regionsUsed: probe.regionsUsed,
      excludedRegions: probe.excludedRegions,
      heuristic: true,
      reason: probe.reason,
      note: probe.note,
    };
  }

  // 6. Quad agreement (DIAGNOSTIC ONLY). Compared in intrinsic-source space:
  // original via originalSize, empty via its OWN emptySize. Under aspect
  // tolerance both are the same normalized framing.
  let agreement: QuadAgreementResult | null = null;
  if (originalOk && compatibleForTransfer && emptyOk && emptySize) {
    const originalSourceQuad = selectedQuadInSourceSpace(originalResult, originalSize, frameSize);
    const emptySourceQuad = selectedQuadInSourceSpace(emptyResult, emptySize, frameSize);
    agreement = compareSourceNormalizedQuads(originalSourceQuad, emptySourceQuad);
  }

  // 7. Empty-PRIMARY policy decision (pure). Original disagreement never vetoes.
  const policy = decideEmptyPrimaryPolicy({
    coordinateCompatible: compatibleForTransfer,
    aspectTolerantTransfer,
    emptyDetectionUsable: emptyOk && !!surfacedEmptySelected,
    emptyQuadSelfValidityBand: emptySelfValidityBand,
    emptyCameraPoseOk,
    emptyCameraPoseConfidence,
    structuralBand: structuralPreservation?.band ?? "unavailable",
    originalDetectionUsable: originalOk && !!originalSelected,
    agreementBand: agreement?.band ?? null,
  });

  const surfacedResult: AutoFloorDetectionResult | null =
    policy.surfacedSource === "empty"
      ? surfacedEmptyResult
      : policy.surfacedSource === "original"
        ? originalResult
        : null;

  // Map provenance -> coarse assist status for the UI banner.
  let assistStatus: EmptyRoomAssistStatus;
  switch (policy.provenance) {
    case "empty_primary_verified":
    case "empty_primary_review":
      assistStatus = "completed";
      break;
    case "empty_primary_blocked":
      assistStatus = "blocked";
      break;
    case "original_fallback":
    case "manual_required":
    default:
      assistStatus = "failed";
      break;
  }

  const failureReason =
    policy.surfacedSource === null
      ? compat.reason ?? originalResult?.failureReasons?.[0] ?? "No usable floor candidate was produced."
      : !compatibleForTransfer
        ? compat.reason
        : null;

  const surfacedEmptyForSummary = selectedCandidate(surfacedEmptyResult);

  // Phase 2H-J: read-only extent/ambiguity diagnostics over the EMPTY candidate
  // set. Computed AFTER selection; never feeds back into selection/scoring/policy.
  const extentDiagnostics = computeExtentDiagnostics(emptyResult, originalResult);

  // Phase 2H-JF: read-only multi-candidate same-plane FOV-consensus diagnostics
  // over the SURFACED empty candidate set (same space as the selected pose scan).
  // Observation-only; does not influence anything below.
  const multiCandidateConsensus = computeMultiCandidateConsensus(surfacedEmptyResult, frameSize, floorRect);

  const response: AssistResponse = {
    assist: {
      enabled: true,
      requestId,
      durationMs: Date.now() - startedAt,
      generateOnly: false,
      emptyRoomAssistStatus: assistStatus,
      emptyRoomCacheStatus: emptyCacheStatus,
      attestedOriginalBasisFingerprint: originalHash,
      attestedEmptyBasisFingerprint,
      coordinateCompatibility,
      originalDetectionStatus: originalStatus,
      emptyDetectionStatus: emptyStatus,
      emptyDetectionFailureReason,
      emptyQuadSelfValidity,
      structuralPreservation,
      agreement,
      poseCompatSummary:
        originalOk || emptyOk
          ? {
              originalSelectedConfidence: originalSelected?.confidence ?? null,
              originalSelectedScore: originalSelected?.confidenceScore ?? null,
              emptySelectedConfidence: surfacedEmptyForSummary?.confidence ?? null,
              emptySelectedScore: surfacedEmptyForSummary?.confidenceScore ?? null,
              bothGeometryConfident:
                !!originalSelected &&
                originalSelected.confidence !== "low" &&
                !!surfacedEmptyForSummary &&
                surfacedEmptyForSummary.confidence !== "low",
            }
          : null,
      extentDiagnostics,
      multiCandidateConsensus,
      recommendationProvenance: policy.provenance,
      surfacedSource: policy.surfacedSource,
      confidenceCeiling: policy.confidenceCeiling,
      calibratedCameraEligible: policy.calibratedCameraEligible,
      policyReasons: policy.reasons,
      failureReason,
    },
    surfacedResult,
    originalResult,
    emptyResult,
  };

  logAssist({
    requestId,
    route: ASSIST_ROUTE,
    durationMs: response.assist.durationMs,
    cacheStatus: emptyCacheStatus,
    originalHost: original.host,
    tier: compat.tier,
    transferMode: compat.transferMode,
    originalAspect: compat.originalAspect,
    emptyAspect: compat.emptyAspect,
    relativeAspectError: compat.relativeAspectError,
    originalSize,
    emptySize,
    originalDetectionStatus: originalStatus,
    emptyDetectionStatus: emptyStatus,
    emptyDetectionFailureReason,
    emptySelfValidityBand,
    emptyCameraPoseOk,
    emptyCameraPoseConfidence,
    emptyCameraPoseBestFovDeg,
    emptyCameraPoseValidFovCount,
    emptyCameraPoseReason,
    structuralBand: structuralPreservation?.band ?? null,
    structuralScore: structuralPreservation?.score ?? null,
    agreementBand: agreement?.band ?? null,
    iou: agreement?.iou ?? null,
    meanCornerDistance: agreement?.meanCornerDistance ?? null,
    provenance: policy.provenance,
    surfacedSource: policy.surfacedSource,
    confidenceCeiling: policy.confidenceCeiling,
    calibratedCameraEligible: policy.calibratedCameraEligible,
    emptyCandidateCount: extentDiagnostics.emptyCandidateCount,
    originalCandidateCount: extentDiagnostics.originalCandidateCount,
    selectedCandidateRank: extentDiagnostics.selectedCandidateRank,
    selectedCandidateIntent: extentDiagnostics.selectedCandidateIntent,
    selectedVsLargestAreaRatio: extentDiagnostics.selectedVsLargestAreaRatio,
    openingAmbiguityFlag: extentDiagnostics.openingAmbiguityFlag,
    retryOccurred: extentDiagnostics.retryOccurred,
    consensusStatus: multiCandidateConsensus.samePlaneConsensusStatus,
    consensusEligibleCount: multiCandidateConsensus.eligibleCandidateCount,
    consensusPoseValidCount: multiCandidateConsensus.poseValidCandidateCount,
    consensusIndexes: multiCandidateConsensus.consensusCandidateIndexes,
    consensusSharedFovRange: multiCandidateConsensus.sharedFovRange,
    consensusBestFovSpreadDeg: multiCandidateConsensus.bestFovSpreadDeg,
    consensusHasClampedCandidate: multiCandidateConsensus.hasClampedCandidateInConsensus,
    advisoryPreferredAnchorIndex: multiCandidateConsensus.advisoryPreferredAnchorIndex,
    advisoryPreferredAnchorReason: multiCandidateConsensus.advisoryPreferredAnchorReason,
    assistStatus,
  });

  return NextResponse.json(response, { status: 200 });
}
