// --- Phase B3A: Type B evaluator contract + snapshot types (pure) -----------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY vocabulary for a FUTURE bounded Type B
// diagnostic evaluator built on the committed first Type B evidence family
//
//   "Rear Seam + One Strong Side-Seam Model"  (evidence family)
//
// interpreted by a bounded, one-latent, line-constrained evaluator
//
//   "rear_points_side_line_one_latent"        (evaluator family)
//
// This module defines PURE CONTRACT TYPES + two tiny pure helpers ONLY. It is a
// vocabulary phase: it lets later phases (B3B pose stage, B3C tuple generation,
// B3D diagnostic run, B3E preview, B3F controlled load) speak a shared, exact,
// versioned, immutable-by-contract language BEFORE any of them exist.
//
// ABSOLUTE SCOPE (Phase B3A). Nothing here (now or by consuming this module)
// may implement or perform any of:
//   - a pose solver, a homography-solver adapter, P3P / any minimal-pose math;
//   - importing / calling / wrapping solvePlaneHomography,
//     decomposeHomographyToCameraPose, or ANY current four-corner solver path;
//   - tuple generation, FOV scan execution, corridor generation;
//   - evaluator-eligibility classification, snapshot capture from React state;
//   - UI, preview, load, Apply, calibration mutation;
//   - candidate / floor-polygon / dimension / FOV mutation;
//   - persistence, API, telemetry, routing, production integration.
//
// The current four-point DLT front end CANNOT honestly represent this Type B
// family (two rear points + one side-line + one bounded latent side depth is not
// four corner correspondences). A future NEW minimal pose stage — NOT part of
// B3A — will replace that front end. The downstream concepts that MAY later be
// reused (intrinsics-from-FOV, pose plausibility gates, FOV scan structure,
// contiguous corridor construction) exist here as ABSTRACT contract vocabulary
// only; which specific Type A gates transfer is a B3B question, deliberately
// left undecided here.
//
// No type, field, or literal in this module may express: ranking, winner,
// recommendation, selection, auto-load, auto-apply, a recovered hidden corner,
// an inferred off-frame endpoint, or a virtual quadrilateral.
//
// It imports ONLY pure TYPE aliases from the committed B1 modules (type-only).
// It has NO React, browser, Three.js, solver, FOV-scan, scene-state, API,
// persistence, telemetry, or routing imports and no runtime imports at all.

import type {
  TypeBEndpointStatus,
  TypeBEvidenceFamily,
  TypeBFrameContactStatus,
  TypeBOcclusionStatus,
  TypeBSourceFrame,
  TypeBStructuralLineRole,
} from "./type-b-evidence-types";
import type { TypeBQualificationReason } from "./type-b-qualification";

// --- 1. Required identifiers and constants ----------------------------------

// Versioned schema identity for a frozen Type B evidence snapshot. The `/v0`
// suffix makes future migrations explicit: a later formula/shape change is a new
// schema string, never a silent redefinition of this one.
export const TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA =
  "vibode-type-b-evidence-snapshot/v0" as const;

// The evaluator family: HOW a bounded mathematical evaluator interprets the
// declared evidence (two rear points + one side line + ONE bounded latent side
// depth). Distinct from the evidence family (WHAT the operator declared).
export const TYPE_B_EVALUATOR_FAMILY =
  "rear_points_side_line_one_latent" as const;

// Identity of the canonical evaluator-level shared-junction tolerance formula.
// Stored alongside the RESOLVED pixel value in a snapshot so a record stays
// reproducible even if a later schema version changes the formula.
export const TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA =
  "min_dim_ratio_clamped/v0" as const;

// Canonical evaluator junction tolerance = clamp(ratio * min(w,h), min, max) in
// SOURCE pixels. Frame-relative (annotation error scales with resolution) with
// an absolute clamp. The upper clamp equals the strictest existing B1 concept
// (TYPE_B_MAX_SHARED_JUNCTION_DISTANCE_PX = 24) so the evaluator gate is a
// STRICT SUBSET of B1's — it may be stricter, never looser. These are
// EVALUATOR-LEVEL constants; they do NOT modify or replace the B1 ratio-based
// fact helper or the fixed 24 px B1 classifier threshold.
export const TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_RATIO = 0.02;
export const TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MIN_PX = 8;
export const TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MAX_PX = 24;

// Pure evaluator-level tolerance resolver. Returns the resolved SOURCE-pixel
// tolerance, or null for an absent / non-finite / non-positive source frame.
// This is a contract utility: it never reads live state and never mutates input.
export function resolveTypeBEvaluatorJunctionTolerancePx(
  sourceFrame: TypeBSourceFrame | null
): number | null {
  if (!sourceFrame) return null;
  const { width, height } = sourceFrame;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  const raw =
    TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_RATIO * Math.min(width, height);
  return Math.min(
    Math.max(raw, TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MIN_PX),
    TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MAX_PX
  );
}

// --- 1b. Latent-depth product identifiability contract (B3B-R) --------------
// A read-only B3B feasibility study proved that, at a fixed FOV probe, the
// minimal (P3P) pose geometry of this first evaluator family depends ONLY on the
// PRODUCT of the two authorized tuple scalars:
//
//   p = latentSideExtent × floorAspectRatio
//
// Distinct (latentSideExtent, floorAspectRatio) pairs sharing the same `p`
// produce EQUIVALENT pose geometry in a junction-anchored world frame. Aspect is
// therefore NOT independently pose-identifiable here; it may still matter later
// as a frame-truncation compatibility hypothesis (an occluded side terminus
// provides no crop-based aspect discriminator in v0). This section adds the
// derived vocabulary that lets a FUTURE B3C enumerate the identifiable product
// axis first and treat aspect only as a member-level hypothesis. It implements
// NO P3P, NO pose solver, NO crop check, and NO tuple generation.

// Identity of the derived latent-depth product formula. This is a DERIVED
// evaluator contract, not new observed evidence, so it does NOT bump the
// evidence-snapshot schema. The `/v0` suffix makes a future redefinition an
// explicit new identifier rather than a silent change.
export const TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA =
  "latent_side_extent_times_floor_aspect_ratio/v0" as const;

// Identity of the required cross-tuple pose-comparison reference frame. The
// committed floor rectangle is CENTERED in world coordinates, so a camera's
// world position can appear to shift across aspect values even when the pose
// geometry is equivalent relative to the evidence. A FUTURE branch/stability
// layer must therefore compare poses in a junction-anchored frame. This is a
// documentation-level identity only: B3B-R adds NO pose-comparison logic.
export const TYPE_B_POSE_COMPARISON_REFERENCE_FRAME =
  "junction_anchored/v0" as const;

// Provisional first-family world-triangle conditioning angle (degrees). The
// world triangle's minimum internal angle equals atan(p); requiring it to be at
// least this angle is the provisional conditioning standard, chosen to mirror
// B1's committed image-space angular floor. It is a PROVISIONAL contract value
// for FUTURE B3C tuple-generation refusal semantics, NOT a calibrated final
// threshold.
export const TYPE_B_PROVISIONAL_MIN_WORLD_TRIANGLE_ANGLE_DEG = 12;

// Provisional minimum latent-depth product = tan(min world-triangle angle).
// Because the triangle's minimum internal angle is atan(p), requiring
// p >= tan(angle) is equivalent to requiring that minimum angle. Derived from
// the angle constant above; empirical/calibration-pending like that angle.
export const TYPE_B_PROVISIONAL_MIN_LATENT_DEPTH_PRODUCT = Math.tan(
  (TYPE_B_PROVISIONAL_MIN_WORLD_TRIANGLE_ANGLE_DEG * Math.PI) / 180
);

// The derived identifiable pose axis for the first evaluator family. `value` is
// p = latentSideExtent × floorAspectRatio. It is an ENUMERATED diagnostic
// hypothesis, never a solved output or a recovered physical-room truth.
export type TypeBLatentDepthProduct = {
  readonly formulaId: typeof TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA;
  readonly value: number;
};

// Pure resolver for the latent-depth product. It never generates tuples and does
// NOT validate future authorized-aspect membership. Returns null for a
// non-finite input, a non-positive / >1 `latentSideExtent` (the contract's
// bounded (0, 1] extent interval), or a non-positive `floorAspectRatio`.
// Otherwise it returns the EXACT product (no rounding, no clamping) beside the
// formula identity. It never mutates its inputs.
export function resolveTypeBLatentDepthProduct(
  latentSideExtent: number,
  floorAspectRatio: number
): TypeBLatentDepthProduct | null {
  if (
    !Number.isFinite(latentSideExtent) ||
    !Number.isFinite(floorAspectRatio)
  ) {
    return null;
  }
  if (latentSideExtent <= 0 || latentSideExtent > 1) return null;
  if (floorAspectRatio <= 0) return null;
  return {
    formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
    value: latentSideExtent * floorAspectRatio,
  };
}

// Pure product-conditioning test. Returns true ONLY when the product meets or
// exceeds the provisional floor. A FUTURE B3C phase will use this as a tuple-
// generation refusal condition (a failing product yields no tuple). The
// threshold is provisional and calibration-pending; this helper never mutates
// its input and returns false for null / non-finite / below-threshold values.
export function isTypeBLatentDepthProductConditioned(
  latentDepthProduct: TypeBLatentDepthProduct | null
): boolean {
  if (!latentDepthProduct) return false;
  const value = latentDepthProduct.value;
  if (!Number.isFinite(value)) return false;
  return value >= TYPE_B_PROVISIONAL_MIN_LATENT_DEPTH_PRODUCT;
}

// --- 1c. Latent-depth equivalence-class + pose-probe identity (B3B-R) -------
// FUTURE-ONLY grouping/reporting vocabulary. A FUTURE B3C phase must enumerate
// EXACT primary product values FIRST, build a class from each such value, and
// only then derive aspect/member tuples for that class. B3C must NEVER group
// arbitrary floating-point products with a tolerance; the class key is created
// from an EXPLICITLY supplied primary-class identity, not from fuzzy float
// bucketing. These are the identifiable pose-axis grouping types; the tuple
// stays a member-level hypothesis (see TypeBDiagnosticTuple).

export type TypeBLatentDepthEquivalenceClass = {
  readonly formulaId: typeof TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA;
  readonly latentDepthProduct: TypeBLatentDepthProduct;

  // Stable identifier created from a FUTURE explicitly enumerated primary
  // product value. B3C must not group arbitrary floating-point products with a
  // tolerance.
  readonly equivalenceClassKey: string;

  readonly poseComparisonReferenceFrame: typeof TYPE_B_POSE_COMPARISON_REFERENCE_FRAME;
};

export type TypeBPoseProbeEquivalence = {
  readonly latentDepthEquivalenceClassKey: string;
  readonly fovProbeDeg: number;

  // Identity for branch-aware pose comparison at one exact FOV probe. It is NOT
  // a rank, score, confidence, or selection key.
  readonly poseProbeEquivalenceKey: string;
};

// Deterministic latent-depth equivalence-class key from an EXPLICITLY supplied
// primary product-class identity (e.g. an enumeration token or an exact decimal
// string chosen by B3C). It performs NO fuzzy near-equality grouping: it
// namespaces the caller's exact identity under the product formula. Returns null
// for a non-string / empty / whitespace-only identity.
export function makeTypeBLatentDepthEquivalenceClassKey(
  primaryProductClassKey: string
): string | null {
  if (typeof primaryProductClassKey !== "string") return null;
  const trimmed = primaryProductClassKey.trim();
  if (trimmed.length === 0) return null;
  return `${TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA}#${trimmed}`;
}

// Deterministic per-probe pose-equivalence key from an EXACT class key plus an
// EXACT FOV probe. It performs NO fuzzy float grouping (the FOV is stringified
// exactly, never rounded or bucketed) and NO ranking. Returns null for a
// non-string / empty class key or a non-finite FOV probe.
export function makeTypeBPoseProbeEquivalenceKey(
  latentDepthEquivalenceClassKey: string,
  fovProbeDeg: number
): string | null {
  if (typeof latentDepthEquivalenceClassKey !== "string") return null;
  const trimmed = latentDepthEquivalenceClassKey.trim();
  if (trimmed.length === 0) return null;
  if (!Number.isFinite(fovProbeDeg)) return null;
  return `${trimmed}@fovProbeDeg=${fovProbeDeg}`;
}

// --- 2. Evidence family versus evaluator family -----------------------------
// evidence family  = WHAT the operator declared and observed (committed B1
//                    literal "rear_seam_plus_strong_side_seam").
// evaluator family = HOW a bounded mathematical evaluator interprets that
//                    evidence (this module's "rear_points_side_line_one_latent").
// Both are REQUIRED on a future snapshot and a future diagnostic record: the
// same evidence could feed a different evaluator, and a different evidence family
// could later feed this evaluator, so a record must state both to be reproducible.
export type TypeBEvaluatorFamily = typeof TYPE_B_EVALUATOR_FAMILY;

// --- 3. Frozen evidence snapshot contract -----------------------------------

// Minimal readonly 2D point. A frozen COPY, never a reference to a mutable
// review/UI point (source-image-normalized coordinates expected).
export type TypeBFrozenVec2 = {
  readonly x: number;
  readonly y: number;
};

// A frozen COPY of one operator-declared line of evidence. Every field is a
// copied value; no references to live review state, refs, or memo outputs.
export type TypeBFrozenDeclaredLineEvidence = {
  readonly role: TypeBStructuralLineRole;
  readonly startNorm: TypeBFrozenVec2;
  readonly endNorm: TypeBFrozenVec2;
  readonly startEndpointStatus: TypeBEndpointStatus;
  readonly endEndpointStatus: TypeBEndpointStatus;
  readonly startFrameContact: TypeBFrameContactStatus;
  readonly endFrameContact: TypeBFrameContactStatus;
  readonly occlusionStatus: TypeBOcclusionStatus;
  readonly notes?: string;
};

// The frozen geometry BASIS used for exact stale detection. Copied values only.
export type TypeBEvidenceSnapshotBasis = {
  readonly sourceImageIdentity: string;
  readonly sourceFrameKey: string;
  readonly sourceFrame: Readonly<TypeBSourceFrame>;
  readonly candidateIdentity: string | null;
  readonly floorPolygonKey: string | null;
};

// Fixed CONTRACT-LEVEL floor assumptions only. B3A never computes, infers, or
// validates actual room dimensions; `authorizedAspectRatios` is the pre-approved
// set a future tuple's `floorAspectRatio` must be drawn from.
export type TypeBFrozenFloorAssumptions = {
  readonly worldWidth: number;
  readonly authorizedAspectRatios: readonly number[];
};

// Frozen COPY of the B1 evidence-summary facts (same shape as the B1 classifier
// output, made deeply readonly). Copied, not recomputed, in B3A.
export type TypeBFrozenB1EvidenceSummary = {
  readonly rearSeamUsable: boolean | null;
  readonly strongSideSeamUsable: boolean | null;
  readonly rearSideRelationshipUsable: boolean | null;
  readonly latentNearCornerBounded: boolean | null;
  readonly cropInterpretationUsable: boolean | null;
};

// Frozen B1 qualification fingerprint. Snapshot capture (a FUTURE phase) will
// require B1 eligibility; this encodes that contract WITHOUT calling B1 here:
// status is exactly `type_b_diagnostic_eligible`, blocking reasons are the empty
// tuple, advisory reasons + evidence summary are copied.
export type TypeBFrozenB1QualificationFingerprint = {
  readonly status: "type_b_diagnostic_eligible";
  readonly blockingReasons: readonly [];
  readonly advisoryReasons: readonly TypeBQualificationReason[];
  readonly evidenceSummary: TypeBFrozenB1EvidenceSummary;
};

// Frozen shared-junction evidence. The resolved pixel tolerance is stored beside
// the formula identity so a future record reproduces the exact gate even if the
// formula changes in a later schema version. `established` is a literal true:
// a snapshot is only captured when the junction is visibly established.
export type TypeBFrozenJunctionEvidence = {
  readonly distanceSourcePx: number;
  readonly toleranceFormulaId: typeof TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA;
  readonly resolvedToleranceSourcePx: number;
  readonly established: true;
};

// The versioned, value-oriented, immutable-by-contract Type B evidence snapshot.
// It is the fixed input to every future tuple evaluation and depends on NO
// mutable live B2 review / React state. (Capturing one from live state is a
// FUTURE phase, not B3A.)
export type TypeBEvidenceSnapshot = {
  readonly schema: typeof TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA;

  readonly evidenceFamily: TypeBEvidenceFamily;
  readonly evaluatorFamily: typeof TYPE_B_EVALUATOR_FAMILY;

  readonly basis: TypeBEvidenceSnapshotBasis;

  readonly rearSeam: TypeBFrozenDeclaredLineEvidence;
  readonly strongSideSeam: TypeBFrozenDeclaredLineEvidence;

  // The one authorized latent condition for this first family: the side terminus
  // world depth is unknown. `unresolved` / `not_needed_visible` are excluded by
  // contract (a fully visible terminus is a Type A conversation, not a latent).
  readonly latentNearCornerCondition: "frame_truncated" | "occluded";

  readonly floorAssumptions: TypeBFrozenFloorAssumptions;

  // Hard precondition: only the exhausted-handoff context is carried; no other
  // Type A context authorizes this evaluator family.
  readonly typeAContext: "type_a_exhausted_handoff_candidate";
  readonly b1Qualification: TypeBFrozenB1QualificationFingerprint;

  readonly junction: TypeBFrozenJunctionEvidence;

  readonly capturedAtIso: string;
};

// --- 4. Strict evaluator-eligibility vocabulary -----------------------------
// B3A does NOT implement an eligibility classifier. It defines the vocabulary a
// FUTURE pure eligibility stage will use. Three distinct gates must be kept
// separate downstream:
//   - B1 Type B qualification      (committed: qualifyTypeBEvidence)
//   - B3 evaluator eligibility     (this vocabulary; stricter, family-specific)
//   - future diagnostic-run eligibility (B3 eligibility + explicit operator
//                                        action + a fresh snapshot + coverage)

export type TypeBEvaluatorEligibilityStatus =
  | "not_assessed"
  | "ineligible"
  | "eligible";

// Strict first-family refusal vocabulary. Documented rules a future classifier
// must enforce (NO logic is implemented in B3A):
//   1. Non-junction rear endpoint must be POSITION-CERTAIN: allow `visible` /
//      `near_frame`; refuse `frame_truncated` / `occluded` / `unresolved`
//      (otherwise a second rear latent extent is required).
//   2. Shared rear-side junction endpoints must be POSITION-CERTAIN (`visible` /
//      `near_frame`) AND within the canonical evaluator tolerance.
//   3. The side OUTER terminus must be `frame_truncated` / `occluded` with
//      compatible declared frame-contact / occlusion evidence.
//   4. The SOLE allowed latent is the side terminus world depth.
//   5. Any need for a latent rear extent, free near-corner movement, opposite-
//      side geometry, or another unknown geometric parameter is
//      `second_latent_dimension_required`.
export type TypeBEvaluatorEligibilityRefusal =
  | "type_b_not_qualified"
  | "type_a_context_not_exhausted_handoff"
  | "shared_junction_not_visibly_established"
  | "non_junction_rear_endpoint_not_position_certain"
  | "side_support_insufficient"
  | "side_terminus_not_latent"
  | "second_latent_dimension_required"
  | "latent_extent_not_bounded"
  | "crop_or_occlusion_incompatible";

// --- 5. Exact tuple contract ------------------------------------------------

// Exact one-latent diagnostic tuple for ONE future fixed-FOV probe. Semantic
// constraints (NOT enforced or generated in B3A/B3B-R):
//   - `latentSideExtent` is normalized against the tuple's assumed floor depth;
//     intended interval is (0, 1]; values near zero are potentially degenerate.
//     It is an ENUMERATED bounded candidate only — never a solved output or a
//     recovered physical-room truth.
//   - `floorAspectRatio` must later be one of the frozen snapshot's authorized
//     aspect ratios.
//   - `fovProbeDeg` is the single exact probe for this one diagnostic evaluation.
//   - There is NO side-line tolerance in v0, NO second latent dimension, and NO
//     corner coordinate — a second latent / free near-corner / virtual
//     quadrilateral would turn an exactly determined system into unconstrained
//     geometry invention, which this family forbids.
//
// B3B-R identifiability note (derived from the B3B feasibility study):
//   - `latentSideExtent` and `floorAspectRatio` are NOT independently pose-
//     identifiable in this evaluator family; the minimal (P3P) pose geometry at a
//     fixed FOV depends only on their product p = latentSideExtent ×
//     floorAspectRatio (see TypeBLatentDepthProduct).
//   - A FUTURE B3C phase must enumerate `latentDepthProduct` as the PRIMARY pose
//     axis, then derive member tuples; aspect is only a member-level
//     (frame-truncation) compatibility hypothesis, never independent pose truth.
//   - For a FIXED product and FOV, constant-product members produce equivalent
//     pose geometry and must NEVER be treated as independent pose corroboration.
//   - Product conditioning is assessed on `latentDepthProduct`
//     (isTypeBLatentDepthProductConditioned), NOT on `latentSideExtent` alone.
//   - No second latent dimension is permitted. The tuple keeps exactly its four
//     runtime fields; the equivalence class is a separate grouping/reporting
//     layer and is NOT added to the tuple.
export type TypeBDiagnosticTuple = {
  readonly evaluatorFamily: typeof TYPE_B_EVALUATOR_FAMILY;
  readonly latentSideExtent: number;
  readonly floorAspectRatio: number;
  readonly fovProbeDeg: number;
};

// --- 6. Future pose-stage contract ------------------------------------------
// Abstract contract for the FUTURE minimal pose stage that replaces the current
// four-point DLT front end. NOT implemented in B3A.

// Solver-independent structural pose vocabulary.
export type TypeBVec3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

// Row-major 3x3 rotation. Structural only; B3A asserts nothing about validity.
export type TypeBRotationMatrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number
];

// Per-hypothesis plausibility observation. `checkId` is a free-form identifier
// on purpose: WHICH specific plausibility checks (cheirality, orthonormality,
// handedness, scale-ratio, camera-above-floor, ...) apply — and which existing
// Type A gates transfer — is a B3B decision, deliberately NOT fixed here.
export type TypeBPlausibilityObservation = {
  readonly checkId: string;
  readonly state: TypeBPosePlausibilityState;
};

// One surviving rigid pose solution. UNRANKED by contract: `hypothesisIndex` is
// a stable enumeration index, NOT a score / rank / preference. There is
// intentionally no score, rank, confidence, recommended, selected, winner, or
// camera-FOV-recommendation field, and no recovered-corner field.
export type TypeBPoseHypothesis = {
  readonly hypothesisIndex: number;
  readonly cameraPositionWorld: TypeBVec3;
  readonly worldToCameraRotation: TypeBRotationMatrix3;
  readonly constructionObservations: readonly TypeBConstructionObservation[];
  readonly plausibility: readonly TypeBPlausibilityObservation[];
};

// Pose-stage refusal vocabulary.
export type TypeBPoseStageRefusal =
  | "pose_stage_unsupported_constraint_set"
  | "pose_stage_degenerate_configuration"
  | "pose_stage_no_rigid_solution"
  | "pose_stage_cheirality_failed";

// Pose-stage result. Plural `hypotheses` is intentional: the pose stage must
// eventually return ALL surviving rigid solutions, unranked, or a typed refusal.
// It never chooses among hypotheses.
export type TypeBPoseStageResult =
  | {
      readonly kind: "pose_hypotheses";
      readonly hypotheses: readonly TypeBPoseHypothesis[];
    }
  | {
      readonly kind: "refusal";
      readonly reason: TypeBPoseStageRefusal;
    };

// Abstract future pose-stage signature: (frozen snapshot, exact tuple) -> result.
// The fixed FOV probe travels inside the tuple (`fovProbeDeg`). B3A defines the
// SHAPE only; it provides no implementation.
export type TypeBPoseStage = (
  snapshot: TypeBEvidenceSnapshot,
  tuple: TypeBDiagnosticTuple
) => TypeBPoseStageResult;

// --- 7. Construction-satisfying residual vocabulary -------------------------

// B3B-R clarification of `side_chord_alignment`: for this v0 evaluator family the
// side chord is construction-satisfying and VACUOUS as independent evidence — a
// straight declared chord is mapped onto the image line through the recovered
// junction and terminus projections by construction. The side chord contributes
// only (1) operator identification of the junction and terminus image points and
// (2) a FUTURE frame-truncation continuation compatibility check. It must NOT be
// counted as an additional independent residual or confidence signal. The enum
// literal is retained.
export type TypeBConstructionObservationKind =
  | "junction_rear_point"
  | "non_junction_rear_point"
  | "side_terminus_point"
  | "side_chord_alignment";

// Construction-satisfying observations confirm numerical consistency of an
// EXACTLY DETERMINED tuple. Their small magnitude is NOT confidence-bearing
// evidence: a minimal solver fits these correspondences by construction, so a
// tiny residual must never be read as Type A-style overdetermined agreement.
// The literal `interpretation` field pins that reading into the type itself.
export type TypeBConstructionObservation = {
  readonly kind: TypeBConstructionObservationKind;
  readonly residualPx: number | null;
  readonly interpretation: "construction_satisfying";
};

// Separate plausibility / diagnostic state vocabulary, for later use. Which
// existing Type A validity gates transfer is a B3B question, not decided here.
export type TypeBPosePlausibilityState =
  | "not_evaluated"
  | "passed"
  | "failed"
  | "not_applicable";

// --- 8. Snapshot freshness and stale refusal semantics ----------------------

// Basis fields compared for staleness, in stable DECLARED order.
export type TypeBEvidenceSnapshotStaleField =
  | "source_image_identity"
  | "source_frame"
  | "candidate_identity"
  | "floor_polygon";

export type TypeBEvidenceSnapshotFreshness =
  | {
      readonly kind: "fresh";
      readonly staleFields: readonly [];
    }
  | {
      readonly kind: "stale";
      readonly reason: "evidence_snapshot_stale";
      readonly staleFields: readonly TypeBEvidenceSnapshotStaleField[];
    };

// Pure exact-equality basis comparison. Compares source-image identity, source-
// frame key, candidate identity, and floor-polygon key EXACTLY, reporting every
// mismatch field in stable declared order. It never auto-refreshes, never
// accepts "close enough" values, never reads live state, and never mutates
// either input. This is the contract utility behind a future
// `evidence_snapshot_stale` refusal.
export function compareTypeBEvidenceSnapshotBasis(
  snapshotBasis: TypeBEvidenceSnapshotBasis,
  currentBasis: TypeBEvidenceSnapshotBasis
): TypeBEvidenceSnapshotFreshness {
  const staleFields: TypeBEvidenceSnapshotStaleField[] = [];
  if (snapshotBasis.sourceImageIdentity !== currentBasis.sourceImageIdentity) {
    staleFields.push("source_image_identity");
  }
  if (snapshotBasis.sourceFrameKey !== currentBasis.sourceFrameKey) {
    staleFields.push("source_frame");
  }
  if (snapshotBasis.candidateIdentity !== currentBasis.candidateIdentity) {
    staleFields.push("candidate_identity");
  }
  if (snapshotBasis.floorPolygonKey !== currentBasis.floorPolygonKey) {
    staleFields.push("floor_polygon");
  }
  if (staleFields.length === 0) {
    return { kind: "fresh", staleFields: [] };
  }
  return {
    kind: "stale",
    reason: "evidence_snapshot_stale",
    staleFields,
  };
}

// --- 9. Future diagnostic record and corridor vocabulary --------------------
// Contract types only. B3A creates NO records at runtime.

export type TypeBFovProbeClassification =
  | "not_evaluated"
  | "no_pose"
  | "weak_pose"
  | "valid_pose";

export type TypeBContiguousFovInterval = {
  readonly startFovDeg: number;
  readonly endFovDeg: number;
  readonly probeCount: number;
};

// FUTURE-ONLY crop-compatibility state for the side terminus. It is NOT a score
// or confidence measure and B3B-R implements NO crop test.
//   - `frame_truncated` may LATER produce a one-sided compatibility inequality
//     (project the assumed side-edge continuation and test it against the source-
//     frame boundary), reported as latent compatibility, never a recovered
//     corner.
//   - `occluded` uses `not_applicable` in v0 because B1/B2 record NO occluder-
//     boundary geometry, so no meaningful check exists.
export type TypeBCropCompatibilityState =
  | "not_evaluated"
  | "compatible"
  | "incompatible"
  | "not_applicable";

// `highConfidence` is INHERITED vocabulary from the Type A corridor shape only.
// B3A/B3B-R define NO confidence logic and classify nothing as high confidence.
// B3B-R note: `highConfidence` must remain EMPTY in v0 because Type A's
// confidence-bearing signals (homography column-scale ratio and overdetermined
// reprojection agreement) do NOT transfer to an exactly determined minimal pose.
// A FUTURE B3D branch-aware corridor extension will be versioned SEPARATELY, and
// branch identity must use junction-anchored pose comparison
// (TYPE_B_POSE_COMPARISON_REFERENCE_FRAME). No branch comparison or corridor
// logic is implemented here or shaped into this type.
export type TypeBFovCorridors = {
  readonly valid: readonly TypeBContiguousFovInterval[];
  readonly highConfidence: readonly TypeBContiguousFovInterval[];
};

// Exact future diagnostic record. It carries both family identifiers, the exact
// tuple, the pose-stage result, construction observations, the probe
// classification, corridor vocabulary where applicable, and refusal reasons.
// It has NO ranking, winner, recommendation, selection, preview, load, or Apply
// field by contract.
//
// B3B-R: the record is FUTURE-ONLY (B3A/B3B-R create NO records at runtime) and
// now stores an equivalence GROUPING identity. `latentDepthEquivalence` records
// which identifiable product class the member tuple belongs to, and
// `poseProbeEquivalence` records the per-probe pose-comparison identity. Storing
// them does NOT imply a selected or preferred hypothesis: aspects within one
// product class may differ ONLY in crop-compatibility state, never in pose
// evidence.
export type TypeBDiagnosticRecord = {
  readonly snapshotSchema: typeof TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA;
  readonly evidenceFamily: TypeBEvidenceFamily;
  readonly evaluatorFamily: typeof TYPE_B_EVALUATOR_FAMILY;
  readonly tuple: TypeBDiagnosticTuple;
  readonly latentDepthEquivalence: TypeBLatentDepthEquivalenceClass;
  readonly poseProbeEquivalence: TypeBPoseProbeEquivalence;
  readonly poseStageResult: TypeBPoseStageResult;
  readonly constructionObservations: readonly TypeBConstructionObservation[];
  readonly probeClassification: TypeBFovProbeClassification;
  readonly fovCorridors: TypeBFovCorridors | null;
  readonly refusalReasons: readonly TypeBDiagnosticRefusalReason[];
};

// --- 10. Basin-classification vocabulary ------------------------------------
// Future RUN-LEVEL vocabulary only. An isolated numerical pose is NOT a basin:
// it is classified `isolated_pose_only` (or `isolated_corridor_only`), recorded
// exactly, and never promoted, selected, or treated as a candidate.
export type TypeBBasinClassification =
  | "not_evaluated"
  | "usable_basin"
  | "isolated_pose_only"
  | "isolated_corridor_only"
  | "instability_across_neighboring_tuples"
  | "boundary_dependent_only"
  | "multiple_incompatible_bounded_basins"
  | "no_usable_basin_under_current_coverage";

// Refusal vocabulary attachable to tuple, corridor, or run scope. Composed from
// the eligibility and pose-stage refusals plus snapshot / corridor / basin
// reasons. Union members are disjoint (no duplicate literals): note
// eligibility's `crop_or_occlusion_incompatible` (evidence-level) is distinct
// from the tuple-level `crop_evidence_incompatible` below.
// B3B-R clarifications (existing literals retained; NO new literal added):
//   - `pose_multiplicity_unresolved` is a CORRIDOR/RUN-scope reason, NEVER a
//     per-probe selection signal (the pose stage returns all surviving
//     hypotheses unranked; multiplicity is assessed only at corridor/basin
//     level).
//   - `instability_across_neighboring_tuples` must treat a smooth constant-
//     product ridge as PARAMETER DEGENERACY (aspect is not pose-identifiable),
//     never as corroborating stability evidence.
//   - `crop_evidence_incompatible` applies ONLY where future evidence geometry
//     supports a real check (a `frame_truncated` continuation inequality); for a
//     v0 occluded side terminus crop compatibility is `not_applicable`, not
//     inferred (see TypeBCropCompatibilityState).
export type TypeBDiagnosticRefusalReason =
  | TypeBEvaluatorEligibilityRefusal
  | "evidence_snapshot_stale"
  | "evidence_snapshot_capture_refused"
  | TypeBPoseStageRefusal
  | "no_pose_corridor"
  | "weak_pose_only"
  | "isolated_corridor_only"
  | "isolated_pose_only"
  | "pose_multiplicity_unresolved"
  | "crop_evidence_incompatible"
  | "instability_across_neighboring_tuples"
  | "boundary_dependent_only"
  | "no_usable_basin_under_current_coverage"
  | "multiple_incompatible_bounded_basins";
