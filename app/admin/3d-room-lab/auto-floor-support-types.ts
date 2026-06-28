import type { AutoFloorCandidateGeometryScore } from "./auto-floor-scoring";
import type { QuadSolvabilityResult } from "./quad-solvability";

// --- Phase 2O-A: Read-only support-classification types ---------------------
// Pure type vocabulary for a DIAGNOSTIC-ONLY support classifier. Nothing here
// (or in the classifier) may enable a geometry search, define a search
// corridor, or treat derived display geometry (dashed suggestion lines,
// homography grids, camera-pose grids) as physical floor-wall seam evidence.
//
// Governing rule (Phase 2O):
//   Physical visible floor-wall seam first. Detected guide geometry second.
//   Solver result third.
//
// The codebase has NO independent, persisted physical floor-wall seam evidence,
// so V2 (single-corner) and V3 (coupled rear-edge) corridors cannot be defined.
// This module therefore hard-codes `corridorAvailable` to the literal `false`.

export type AutoFloorCornerLabel = "NL" | "NR" | "FR" | "FL";

// Canonical corner order matches orderFloorCorners(...) and the existing
// CALIBRATION_CORNER_LABELS in ThreeRoomLab.tsx: [nearLeft, nearRight,
// farRight, farLeft]. Index i in a candidate quad maps to label i here.
export const AUTO_FLOOR_CORNER_LABELS: readonly AutoFloorCornerLabel[] = [
  "NL",
  "NR",
  "FR",
  "FL",
] as const;

export type AutoFloorSupportClass =
  | "directly_supported"
  | "under_support_suspected"
  | "insufficient_visual_evidence";

export type AutoFloorUnderSupportTarget =
  | { kind: "corner"; corner: AutoFloorCornerLabel }
  // Neutral, assumption-free paired-corner pattern. Carries the ACTUAL detected
  // canonical image-space corner labels. It asserts NO physical floor-wall seam,
  // rear-edge, or adjustment-authority claim and never implies a movable edge or
  // a search corridor — it is a numerical residual observation. (The labels keep
  // their usual near/far image-space meaning; this structure simply does not act
  // on it.)
  | { kind: "corner_pair"; corners: AutoFloorCornerLabel[] }
  | null;

export type AutoFloorSupportClassification = {
  supportClass: AutoFloorSupportClass;
  // Phase 2O-A invariant: this diagnostic NEVER enables a geometry search. No
  // physical floor-wall seam evidence exists, so a corridor can never be
  // defined. Intentionally a literal `false` to make that structural.
  corridorAvailable: false;
  // Diagnostic suspicion target only; never a thing to move. Null when no
  // dominant residual under-support pattern is present.
  underSupportTarget: AutoFloorUnderSupportTarget;
  // Corners whose normalized coordinates lie within the frame-edge proximity
  // margin. PURE GEOMETRY ONLY — never interpreted as truncation/occlusion.
  frameEdgeContacts: AutoFloorCornerLabel[];
  // Ordered, human-readable, conservative explanation of the decision.
  reasons: string[];
};

export type AutoFloorSupportPoint = { x: number; y: number };

export type AutoFloorSupportClassificationInput = {
  // Candidate quad in canonical [NL, NR, FR, FL] order (normalized [0,1]).
  quadNorm: ReadonlyArray<AutoFloorSupportPoint> | null;
  // Existing geometry score (source of truth for visual credibility band).
  geometryScore: AutoFloorCandidateGeometryScore | null;
  // Existing Phase 2N solvability result (pose availability, per-corner CV
  // residuals, shared Apply evaluation). Read-only; never recomputed here.
  solvability: QuadSolvabilityResult | null;
  // Optional normalized [0, 0.5) margin for frame-edge CONTACT reporting only.
  frameEdgeMargin?: number;
};
