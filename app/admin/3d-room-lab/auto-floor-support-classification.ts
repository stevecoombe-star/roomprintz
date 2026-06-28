import type { QuadSolvabilityResult } from "./quad-solvability";
import {
  AUTO_FLOOR_CORNER_LABELS,
  type AutoFloorCornerLabel,
  type AutoFloorSupportClass,
  type AutoFloorSupportClassification,
  type AutoFloorSupportClassificationInput,
  type AutoFloorSupportPoint,
  type AutoFloorUnderSupportTarget,
} from "./auto-floor-support-types";

// --- Phase 2O-A: Pure, read-only support classifier -------------------------
// Diagnostic-only. Consumes ONLY existing read-only evidence (candidate quad,
// existing geometry score band, Phase 2N QuadSolvabilityResult including its
// shared Apply evaluation, and frame-edge proximity derived purely from
// normalized coordinates).
//
// HARD GUARANTEES (see Phase 2O-A scope):
// - No React, DOM, fetch, image IO, server-only imports, setters, or mutation.
// - Never moves a corner, never generates a geometry trial, never defines a
//   search corridor. Every result has corridorAvailable === false.
// - Residual patterns are treated as NUMERICAL solver suspicion only — never as
//   proof of cropping, occlusion, or a false floor-wall seam.
// - Derived display geometry (dashed suggestion lines, homography/camera grids)
//   is NOT consulted; it would be circular evidence.

// Normalized frame-edge proximity margin (fraction of the frame dimension).
// Pure geometry only: a contact means a corner is near the image frame, NOT
// that the physical floor/wall is truncated there.
const DEFAULT_FRAME_EDGE_MARGIN = 0.01;

// A corner's CV reprojection residual must exceed this absolute pixel floor
// before it can contribute to an under-support suspicion (avoids flagging
// sub-pixel numerical noise on clean candidates).
const RESIDUAL_SUSPICION_MIN_PX = 3;

// How decisively the worst residual (or the rear pair) must exceed the next
// tier before we call the pattern "dominant" / "defensible".
const RESIDUAL_DOMINANCE_RATIO = 2;

const EPSILON = 1e-9;

function roundPx(value: number): number {
  return Number(value.toFixed(2));
}

function isFinitePoint(point: AutoFloorSupportPoint | undefined | null): point is AutoFloorSupportPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * Reports which candidate corners lie within the normalized frame-edge margin.
 * PURE GEOMETRY ONLY — this is proximity to the image frame, never a claim that
 * the physical floor/wall is cropped, occluded, or truncated.
 */
function computeFrameEdgeContacts(
  quad: ReadonlyArray<AutoFloorSupportPoint> | null,
  margin: number
): AutoFloorCornerLabel[] {
  const contacts: AutoFloorCornerLabel[] = [];
  if (!Array.isArray(quad) || quad.length !== 4) return contacts;
  const low = margin;
  const high = 1 - margin;
  for (let i = 0; i < 4; i += 1) {
    const point = quad[i];
    if (!isFinitePoint(point)) continue;
    if (point.x <= low || point.x >= high || point.y <= low || point.y >= high) {
      contacts.push(AUTO_FLOOR_CORNER_LABELS[i]);
    }
  }
  return contacts;
}

type ResidualUnderSupport = {
  target: Exclude<AutoFloorUnderSupportTarget, null>;
  detail: string;
};

/**
 * Detects a DOMINANT per-corner CV reprojection-residual pattern in the
 * existing Phase 2N solvability result. Returns a single-corner target when one
 * corner clearly dominates, or a neutral paired-corner target (carrying the
 * actual detected labels) when exactly the NL and NR corners jointly dominate
 * the other pair. Returns null otherwise.
 *
 * This is a read-only numerical observation; it does NOT prove visual falsehood,
 * a physical seam, cropping, occlusion, or a movable edge, and never yields a
 * search corridor. The "NL,NR" pair is reported as the detected canonical
 * image-space corners only — it establishes no seam truth or adjustment
 * authority (the labels retain their usual near/far image-space meaning).
 */
function detectResidualUnderSupport(
  solvability: QuadSolvabilityResult
): ResidualUnderSupport | null {
  const perCorner = solvability.cv.perCornerResidualPx;
  if (!Array.isArray(perCorner) || perCorner.length !== 4) return null;

  const values: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const value = perCorner[i];
    if (value === null || !Number.isFinite(value)) return null;
    values.push(value);
  }

  // Indices sorted by residual, descending. Stable ordering for determinism.
  const order = [0, 1, 2, 3].sort((a, b) => {
    if (values[b] !== values[a]) return values[b] - values[a];
    return a - b;
  });
  const [i0, i1, i2] = order;
  const v0 = values[i0];
  const v1 = values[i1];
  const v2 = values[i2];

  // All residuals are small: no under-support suspicion.
  if (v0 < RESIDUAL_SUSPICION_MIN_PX) return null;

  // Single dominant corner: worst clearly exceeds the next-worst.
  if (v0 >= RESIDUAL_DOMINANCE_RATIO * Math.max(v1, EPSILON)) {
    const corner = AUTO_FLOOR_CORNER_LABELS[i0];
    return {
      target: { kind: "corner", corner },
      detail: `worst CV reprojection corner ${corner} (${roundPx(v0)} px) dominates the next corner (${roundPx(v1)} px)`,
    };
  }

  // Paired-corner pattern: the two highest residuals are exactly NL and NR, and
  // the pair clearly exceeds the remaining pair. Only reported when defensible.
  // Neutral: this names the detected pair only and makes NO rear/near claim.
  const topTwoAreNearPair = (i0 === 0 || i0 === 1) && (i1 === 0 || i1 === 1);
  if (topTwoAreNearPair && v1 >= RESIDUAL_DOMINANCE_RATIO * Math.max(v2, EPSILON)) {
    return {
      target: { kind: "corner_pair", corners: ["NL", "NR"] },
      detail: `NL (${roundPx(values[0])} px) and NR (${roundPx(values[1])} px) CV reprojection residuals jointly dominate the other corner pair`,
    };
  }

  return null;
}

function buildClassification(
  supportClass: AutoFloorSupportClass,
  underSupportTarget: AutoFloorUnderSupportTarget,
  frameEdgeContacts: AutoFloorCornerLabel[],
  reasons: string[]
): AutoFloorSupportClassification {
  return {
    supportClass,
    // Structural invariant for Phase 2O-A — never derived, never relaxed.
    corridorAvailable: false,
    underSupportTarget,
    frameEdgeContacts,
    reasons,
  };
}

/**
 * Classifies an assisted floor candidate's support, diagnostic-only.
 * Deterministic and side-effect free.
 */
export function classifyAutoFloorSupport(
  input: AutoFloorSupportClassificationInput
): AutoFloorSupportClassification {
  const margin =
    typeof input.frameEdgeMargin === "number" &&
    Number.isFinite(input.frameEdgeMargin) &&
    input.frameEdgeMargin >= 0 &&
    input.frameEdgeMargin < 0.5
      ? input.frameEdgeMargin
      : DEFAULT_FRAME_EDGE_MARGIN;

  const frameEdgeContacts = computeFrameEdgeContacts(input.quadNorm, margin);
  const frameEdgeReason =
    frameEdgeContacts.length > 0
      ? `Frame-edge contact (geometry only, NOT truncation/occlusion truth): ${frameEdgeContacts.join(", ")}.`
      : "No candidate corner lies within the frame-edge proximity margin (geometry only).";

  // --- Gate 1: geometry must exist and be non-invalid ------------------------
  const band = input.geometryScore?.scoreBand ?? null;
  if (band === null || band === "invalid") {
    const reasons = [
      band === null
        ? "Geometry score is unavailable; cannot classify support beyond insufficient visual evidence."
        : "Candidate geometry is invalid under the existing geometry score; it cannot be directly supported.",
      "Any future V2/V3 search corridor would require physical floor-wall seam evidence, which does not exist in this codebase.",
      frameEdgeReason,
    ];
    return buildClassification("insufficient_visual_evidence", null, frameEdgeContacts, reasons);
  }

  const solverEvidenceAvailable = !!input.solvability && input.solvability.poseAvailable;

  // --- Gate 2: residual-based under-support (solver suspicion only) ----------
  const underSupport =
    solverEvidenceAvailable && input.solvability
      ? detectResidualUnderSupport(input.solvability)
      : null;
  if (underSupport) {
    const reasons = [
      `Solver-based under-support suspicion (numerical paired-corner/corner residual pattern only): ${underSupport.detail}.`,
      "This paired-corner residual pattern is numerical solver evidence only. It is not proof of a physical floor-wall seam, cropping, occlusion, or a movable edge.",
      "The reported labels identify the affected canonical image-space corners; they do not establish seam truth or adjustment authority.",
      "No independent physical floor-wall seam evidence exists, so no corrective search corridor can be defined (corridorAvailable = false).",
      frameEdgeReason,
    ];
    return buildClassification(
      "under_support_suspected",
      underSupport.target,
      frameEdgeContacts,
      reasons
    );
  }

  // --- Gate 3: directly supported (diagnostic eligibility only) --------------
  const credible = band === "high" || band === "medium";
  if (solverEvidenceAvailable && credible) {
    const reasons = ["Candidate is directly usable under current geometry and solver evidence."];
    const applyEvaluation = input.solvability?.applyEvaluation;
    if (applyEvaluation) {
      reasons.push(
        applyEvaluation.available
          ? "Shared Apply gate reports the candidate is Apply-safe at the current FOV (diagnostic context only)."
          : `Shared Apply gate currently blocks Apply (${applyEvaluation.reason}); direct usability here is a geometry/solver observation, not an Apply guarantee.`
      );
    }
    reasons.push("Diagnostic only: this does NOT prove a physical floor-wall seam exists.");
    reasons.push(frameEdgeReason);
    return buildClassification("directly_supported", null, frameEdgeContacts, reasons);
  }

  // --- Gate 4: conservative fallback -----------------------------------------
  const reasons: string[] = [];
  if (!solverEvidenceAvailable) {
    reasons.push(
      "Solver/camera-pose evidence is unavailable for this candidate; direct support cannot be confirmed."
    );
  }
  if (!credible) {
    reasons.push(
      `Candidate geometry score band is "${band}"; not visually credible enough to declare direct support.`
    );
  }
  reasons.push(
    "Insufficient visual evidence: any V2/V3 corridor would require physical seam, crop, or occlusion evidence that is not present."
  );
  reasons.push(frameEdgeReason);
  return buildClassification("insufficient_visual_evidence", null, frameEdgeContacts, reasons);
}
