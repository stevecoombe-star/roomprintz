import type { AutoFloorCandidateScoreBand } from "./auto-floor-scoring";
import type { QuadAgreementBand } from "./auto-floor-quad-agreement";
import type { StructuralPreservationBand } from "@/lib/vibodeAutoFloorImageProbe";

// --- Phase 2H-D/2H-G: empty-room-PRIMARY calibration policy (pure) -----------
// Decides which detection (empty vs original) is SURFACED for the lab preview,
// and with what provenance/confidence. This module is pure and side-effect free
// so it can be unit-reasoned and benchmarked against fixtures.
//
// Policy pivot from Phase 2H-B (memo Phase 2H-C):
//   * The EMPTY-ROOM floor quad is the PRIMARY surfaced candidate.
//   * The ORIGINAL detector is DIAGNOSTIC ONLY. Disagreement NEVER vetoes empty
//     promotion (the original is contamination-prone — e.g. it may lock onto a
//     coffee-table top). Agreement can only CORROBORATE.
//   * The structural-preservation heuristic is DOWNGRADE-ONLY: it can lower
//     empty_primary_verified -> empty_primary_review, but never approves,
//     promotes, or blocks on its own.
//
// Phase 2H-G — SEPARATE floor-proposal eligibility from calibrated-camera
// eligibility. Surfacing a (review) floor proposal must NOT be stricter than the
// direct-detection workflow, which never required a calibrated camera pose.
//
// HARD gates (fail closed, block surfacing the empty FLOOR PROPOSAL):
//   * coordinate compatibility (tier != incompatible),
//   * empty candidate exists,
//   * empty geometry self-validity (band != invalid).
//
// Camera-pose / FOV-scan success is NO LONGER a hard gate for surfacing. It is a
// CONFIDENCE + CALIBRATED-CAMERA-ELIGIBILITY signal only:
//   * pose ok  -> can raise confidence; sets calibratedCameraEligible = true.
//   * pose fail -> still surface the quad as empty_primary_review at a
//     conservative (low) ceiling, with calibratedCameraEligible = false and a
//     "camera calibration unavailable / needs manual adjustment" diagnostic.
// Structural band, pose confidence, and original agreement only shift confidence.
//
// Note: calibratedCameraEligible is advisory. It does NOT activate or relax any
// calibrated-camera gate; the lab's existing calibrated-camera Apply checks
// remain the sole authority for activating a calibrated camera.

export type EmptyPrimaryProvenance =
  | "empty_primary_verified" // empty surfaced; all gates pass + corroborated/strong structure
  | "empty_primary_review" // empty surfaced; gates pass but a downgrade applied
  | "empty_primary_blocked" // empty existed but failed an empty-specific hard gate; fell back
  | "original_fallback" // empty unusable (never materialized); original surfaced (review-only)
  | "manual_required"; // nothing usable; manual setup required

export type SurfacedSource = "empty" | "original" | null;

export type ConfidenceCeiling = "high" | "medium" | "low" | null;

export type EmptyPrimaryPolicyInput = {
  // HARD gate: empty is coordinate-compatible (exact grid OR aspect-rescaled).
  coordinateCompatible: boolean;
  // Phase 2H-E: when true, the empty quad was transferred via aspect-tolerant
  // normalized rescaling (NOT exact pixel grid). This is NOT proof of geometry
  // preservation, so promotion is capped at review/medium and can never reach
  // empty_primary_verified on its own.
  aspectTolerantTransfer: boolean;
  // Empty detection produced a usable (ok/needs_review) selected candidate.
  emptyDetectionUsable: boolean;
  // Geometry band of the empty selected candidate (null when none).
  emptyQuadSelfValidityBand: AutoFloorCandidateScoreBand | null;
  // Phase 2H-G: camera-pose / FOV-scan success. NO LONGER a hard gate for
  // surfacing; it is a confidence + calibrated-camera-eligibility signal only.
  emptyCameraPoseOk: boolean;
  // Camera-pose numerical confidence (downgrade signal, not a gate).
  emptyCameraPoseConfidence: "high" | "low" | null;
  // Structural-preservation heuristic band (downgrade-only).
  structuralBand: StructuralPreservationBand;
  // Original detection produced a usable selected candidate (diagnostic only).
  originalDetectionUsable: boolean;
  // Agreement between empty and original quads (diagnostic corroboration only).
  agreementBand: QuadAgreementBand | null;
};

export type EmptyPrimaryPolicyResult = {
  provenance: EmptyPrimaryProvenance;
  surfacedSource: SurfacedSource;
  // Advisory ceiling for displayed confidence. Does NOT gate Apply (the existing
  // per-candidate geometry-score gate still governs Apply, unchanged).
  confidenceCeiling: ConfidenceCeiling;
  // True when the empty quad is the surfaced candidate.
  emptyPromoted: boolean;
  // Phase 2H-G: advisory ONLY. True when a valid camera pose was found (some
  // plausible FOV decomposed). Does NOT activate or relax any calibrated-camera
  // gate — the lab's existing calibrated-camera Apply checks remain authoritative.
  calibratedCameraEligible: boolean;
  // Human-readable, ordered explanation of the decision (safe, derived).
  reasons: string[];
};

function emptySelfValid(band: AutoFloorCandidateScoreBand | null): boolean {
  return band !== null && band !== "invalid";
}

const CEILING_RANK: Record<"high" | "medium" | "low", number> = { high: 3, medium: 2, low: 1 };

// Returns the more conservative (lower) of two confidence ceilings.
function lowerCeiling(
  current: "high" | "medium" | "low",
  target: "high" | "medium" | "low"
): "high" | "medium" | "low" {
  return CEILING_RANK[target] < CEILING_RANK[current] ? target : current;
}

/**
 * Decides the surfaced candidate + provenance. Pure: same inputs -> same output.
 */
export function decideEmptyPrimaryPolicy(input: EmptyPrimaryPolicyInput): EmptyPrimaryPolicyResult {
  const reasons: string[] = [];

  const emptyCandidateExists = input.emptyDetectionUsable;
  const selfValid = emptySelfValid(input.emptyQuadSelfValidityBand);

  // --- Empty FLOOR-PROPOSAL eligibility (HARD gates) ------------------------
  // Phase 2H-G: camera pose is NOT part of this gate. A valid floor proposal
  // requires only compatible coordinates, an existing candidate, and non-invalid
  // geometry — matching (not exceeding) the direct-detection workflow.
  const floorProposalEligible = input.coordinateCompatible && emptyCandidateExists && selfValid;

  if (floorProposalEligible) {
    // Empty is surfaced. Start verified, then apply DOWNGRADE-ONLY adjustments.
    let provenance: EmptyPrimaryProvenance = "empty_primary_verified";
    let ceiling: "high" | "medium" | "low" = "high";
    let calibratedCameraEligible = false;
    reasons.push("Empty-room floor proposal surfaced as primary (coordinate-compatible, self-valid geometry).");

    const structuralWeak =
      input.structuralBand === "uncertain" ||
      input.structuralBand === "weak" ||
      input.structuralBand === "unavailable";
    if (structuralWeak) {
      provenance = "empty_primary_review";
      ceiling = lowerCeiling(ceiling, "medium");
      reasons.push(
        `Structural-preservation heuristic is ${input.structuralBand} (downgrade-only): empty surfaced but flagged for review.`
      );
    } else {
      reasons.push(`Structural-preservation heuristic is ${input.structuralBand} (no downgrade).`);
    }

    // Phase 2H-G: camera pose / FOV scan is a confidence + calibrated-camera
    // signal, NOT a surfacing gate.
    if (input.emptyCameraPoseOk) {
      calibratedCameraEligible = true;
      if (input.emptyCameraPoseConfidence === "low") {
        provenance = "empty_primary_review";
        ceiling = lowerCeiling(ceiling, "medium");
        reasons.push("Camera pose solved but numerically weak (low confidence): flagged for review.");
      } else {
        reasons.push("Camera pose solved at a plausible FOV (supports calibrated-camera eligibility).");
      }
    } else {
      // Floor proposal still surfaces; only the calibrated camera is withheld.
      provenance = "empty_primary_review";
      ceiling = lowerCeiling(ceiling, "low");
      calibratedCameraEligible = false;
      reasons.push(
        "Camera calibration unavailable: no plausible FOV (20-90°) produced a valid camera pose. Floor proposal surfaced for manual review/adjustment; calibrated camera NOT activated."
      );
    }

    if (input.emptyQuadSelfValidityBand === "low") {
      provenance = "empty_primary_review";
      ceiling = lowerCeiling(ceiling, "low");
      reasons.push("Empty quad geometry band is low: flagged for review.");
    } else if (input.emptyQuadSelfValidityBand === "medium") {
      ceiling = lowerCeiling(ceiling, "medium");
    }

    // Phase 2H-E: aspect-tolerant transfer is never exact-grid equivalence.
    // It cannot reach verified on its own and its confidence is capped at
    // medium, regardless of how clean the geometry looks. (Structural heuristic
    // and other downgrades may still lower it further below.)
    if (input.aspectTolerantTransfer) {
      if (provenance === "empty_primary_verified") provenance = "empty_primary_review";
      ceiling = lowerCeiling(ceiling, "medium");
      reasons.push(
        "Aspect-tolerant rescaled transfer (not exact pixel grid): capped at review/medium — not geometry-preservation proof."
      );
    }

    // Original detector is diagnostic-only corroboration. It can RAISE trust but
    // disagreement NEVER blocks empty promotion.
    if (!input.originalDetectionUsable) {
      if (provenance === "empty_primary_verified") {
        provenance = "empty_primary_review";
        ceiling = lowerCeiling(ceiling, "medium");
      }
      reasons.push("Original detector produced no usable corroboration (diagnostic only; does not veto empty).");
    } else if (input.agreementBand === "strong_agreement") {
      reasons.push("Original detector corroborates the empty quad (strong agreement).");
    } else if (input.agreementBand === "review_agreement") {
      reasons.push("Original detector partially agrees (diagnostic only; does not veto empty).");
    } else {
      reasons.push(
        `Original detector disagrees (${input.agreementBand ?? "n/a"}); treated as diagnostic only — empty promotion not vetoed.`
      );
    }

    return {
      provenance,
      surfacedSource: "empty",
      confidenceCeiling: ceiling,
      emptyPromoted: true,
      calibratedCameraEligible,
      reasons,
    };
  }

  // --- Empty NOT surfaced ----------------------------------------------------
  // Phase 2H-G: only the floor-proposal HARD gates can land here (coordinate
  // incompatibility, missing candidate, or invalid geometry). Camera-pose
  // failure NEVER reaches this branch — it is handled above as a review surface.
  // Distinguish "blocked" (empty existed but failed a hard gate) from "fallback"
  // (empty never materialized at all).
  const emptyBlockedByGate = emptyCandidateExists && (!input.coordinateCompatible || !selfValid);

  if (!input.coordinateCompatible) reasons.push("Coordinate compatibility failed (empty cannot be surfaced).");
  if (emptyCandidateExists && !selfValid) reasons.push("Empty quad geometry is invalid (empty cannot be surfaced).");
  if (!emptyCandidateExists) reasons.push("Empty detection produced no usable candidate.");

  if (input.originalDetectionUsable) {
    reasons.push("Surfacing the original quad as a REVIEW-ONLY fallback (contamination-prone; not auto-applied).");
    return {
      provenance: emptyBlockedByGate ? "empty_primary_blocked" : "original_fallback",
      surfacedSource: "original",
      confidenceCeiling: "low",
      emptyPromoted: false,
      calibratedCameraEligible: false,
      reasons,
    };
  }

  if (emptyBlockedByGate) {
    reasons.push("Empty was blocked and the original is unusable — manual floor setup required.");
  } else {
    reasons.push("No usable candidate from either image — manual floor setup required.");
  }
  return {
    provenance: "manual_required",
    surfacedSource: null,
    confidenceCeiling: null,
    emptyPromoted: false,
    calibratedCameraEligible: false,
    reasons,
  };
}
