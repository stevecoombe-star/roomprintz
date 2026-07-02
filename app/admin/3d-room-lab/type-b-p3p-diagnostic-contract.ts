// --- Phase B3D-R: Type B P3P Diagnostic Contract (pure types) ---------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY vocabulary for the FUTURE Type B P3P
// diagnostic pipeline built on the committed evidence family
//
//   "rear_seam_plus_strong_side_seam"  (evidence family)
//
// interpreted by the bounded, one-latent evaluator family
//
//   "rear_points_side_line_one_latent" (evaluator family).
//
// This module defines the PURE CONTRACT TYPES + version constants that let the
// later phases speak a shared, exact, versioned, immutable-by-contract language
// BEFORE any of them exist:
//   - B3D-1 — all-root Grunert P3P enumerator;
//   - B3D-2 — branch-aware FOV association and corridors;
//   - B3D-3 — optional frame-truncation compatibility.
//
// ABSOLUTE SCOPE (Phase B3D-R). Nothing here (now or by consuming this module)
// may implement or perform any of:
//   - Grunert P3P, quartic solving, numerical root finding, homography / DLT;
//   - pose evaluation, FOV probe execution, FOV topology validation;
//   - branch matching, corridor construction, crop compatibility;
//   - endpoint-role inference from live or frozen lines, snapshot capture;
//   - UI, preview, controlled load, Apply, calibration mutation;
//   - candidate / polygon / dimension / FOV / readiness mutation;
//   - persistence, API, routing, production integration, Type A routing.
//
// No type, field, or literal may express ranking, score, confidence, winner,
// recommendation, selected state, best root, best FOV, or calibration authority.
//
// It imports ONLY pure TYPE aliases from the committed B3A / B3B-R / B3C
// modules. Its RUNTIME surface is exactly the three schema version constants
// below. It has NO solver, React, browser, Three.js, calibration, Type A,
// scene-state, persistence, telemetry, or routing imports.

import type {
  TypeBCropCompatibilityState,
  TypeBDiagnosticRefusalReason,
  TypeBEvidenceSnapshotBasis,
  TypeBLatentDepthEquivalenceClass,
  TypeBLatentDepthProduct,
  TypeBPoseProbeEquivalence,
  TypeBPoseStageResult,
  TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
} from "./type-b-evaluator-contract";
import type { TypeBTupleGenerationResult } from "./type-b-tuple-generation";

// --- 1. Required schema constants (the only runtime exports) ----------------

// Versioned identity for the FUTURE P3P diagnostic run record. The `/v0` suffix
// makes a future shape change an explicit new identifier, never a silent
// redefinition.
export const TYPE_B_P3P_DIAGNOSTIC_SCHEMA =
  "vibode-type-b-p3p-diagnostic/v0" as const;

// Versioned identity for the FUTURE explicit FOV-probe topology declaration.
export const TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA =
  "vibode-type-b-fov-probe-topology/v0" as const;

// Versioned identity for the FUTURE parallel branch-aware FOV corridor shape.
// This is SEPARATE from the committed Type A-shaped TypeBFovCorridors, which
// B3D-R does NOT alter.
export const TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA =
  "vibode-type-b-branch-fov-corridor/v0" as const;

// --- 2. Explicit FOV topology declaration -----------------------------------
// Neutral FUTURE-ONLY topology contract. Documented facts (B3D-R validates,
// sorts, inserts, and infers NOTHING):
//   - caller order in B3C is NOT corridor topology (B3C preserves exact caller
//     order and never sorts / interpolates / inserts probes);
//   - non-monotonic or sparse B3C coverage remains VALID for future per-probe
//     P3P evaluation; topology is required ONLY for future branch-corridor
//     formation;
//   - the declared `orderedProbesDeg` must, when LATER validated by B3D-2, equal
//     the B3C probe multiset exactly (`===`, no rounding / bucketing);
//   - `stepDeg` must, when LATER validated, be finite and > 0;
//   - gaps split corridors;
//   - B3D-R does NOT validate the declaration or build any intervals.
export type TypeBFovProbeTopologyDeclaration = {
  readonly schema: typeof TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA;

  // Explicit ascending lattice declaration for future corridor formation. Stored
  // exactly as supplied; B3D-R does not validate, sort, insert, or infer probes.
  readonly orderedProbesDeg: readonly number[];

  // Explicit lattice spacing for future adjacency. Must be finite and > 0 when
  // later validated (not validated here).
  readonly stepDeg: number;
};

// --- 3. Root census + per-probe diagnostic record ---------------------------

// FUTURE-ONLY count facts about the roots enumerated at one pose probe. These
// are INDEPENDENT counts (each answers a different question), never a score or a
// selection signal. B3D-R creates NO census.
export type TypeBP3pRootCensus = {
  // Algebraic candidates before rigid / cheirality filtering (e.g. real quartic
  // roots as algebraic candidates for the P3P system).
  readonly algebraicCandidateCount: number;
  // Real roots among the algebraic candidates.
  readonly realRootCount: number;
  // Roots whose reconstructed P3P distances are all positive (cheirality-valid).
  readonly positiveDistanceRootCount: number;
  // Retained roots after near-coincident deduplication.
  readonly deduplicatedRootCount: number;
};

// FUTURE-ONLY per-pose-probe diagnostic record. Exactly ONE per unique
// `poseProbeEquivalenceKey`; it is SHARED pose evidence for every same-class
// aspect member (common pose geometry, NOT corroboration). No field implies a
// score, confidence, preference, best root, or selected pose. B3D-R creates NO
// records.
export type TypeBPoseProbeDiagnosticRecord = {
  readonly poseProbeEquivalence: TypeBPoseProbeEquivalence;
  readonly latentDepthEquivalence: TypeBLatentDepthEquivalenceClass;

  // Exact primary product value from the equivalence class. FUTURE B3D-1 must
  // use this value DIRECTLY and must NEVER recompute it from member
  // extent × aspect (IEEE division can differ at the last ulp, which would make
  // "one class, one pose" false).
  readonly latentDepthProduct: TypeBLatentDepthProduct;

  // FUTURE B3D-1 output: ALL roots unranked, or a typed pose-stage refusal.
  readonly poseStageResult: TypeBPoseStageResult;

  readonly rootCensus: TypeBP3pRootCensus;
};

// --- 4. Member compatibility link record ------------------------------------
// FUTURE-ONLY aspect/member compatibility LINK. It references a shared pose
// probe by KEY only and carries crop state only; it CANNOT hold a pose. This is
// the structural no-double-counting guarantee: pose evidence lives ONLY in
// TypeBPoseProbeDiagnosticRecord, so a member link can never be counted as an
// independent pose success. It has NO pose, root, score, branch, corridor, or
// selection field.
export type TypeBMemberCompatibilityRecord = {
  readonly primaryProductClassIdentity: string;
  readonly floorAspectRatio: number;
  readonly latentSideExtent: number;
  readonly cropCompatibility: TypeBCropCompatibilityState;

  // Reference only. Links this member to the shared pose-probe result by key.
  readonly poseProbeEquivalenceKey: string;
};

// --- 5. Parallel branch-corridor vocabulary ---------------------------------
// B3D-R does NOT alter TypeBFovCorridors or TypeBContiguousFovInterval. This is
// NEW, FUTURE-ONLY, versioned, PARALLEL branch vocabulary.

// Association outcome between roots across two adjacent lattice probes. All five
// states are IDENTITY-PRESERVING outcomes, never rankings: an `associated` link
// asserts continuity; the other four record WHY continuity was not asserted.
export type TypeBBranchAssociationState =
  | "associated"
  | "tied_ambiguous"
  | "unmatched_terminated"
  | "unmatched_born"
  | "near_coincident_unresolved";

// Reference to one enumerated root at one pose probe. `hypothesisIndex` is the
// stable enumeration index from TypeBPoseHypothesis, NOT a rank or preference.
export type TypeBBranchPoseProbeRootReference = {
  readonly poseProbeEquivalenceKey: string;
  readonly fovProbeDeg: number;
  readonly hypothesisIndex: number;
};

// One directed association annotation between an origin root and either a
// successor root (`associated`) or none (the non-associated states). `to` is
// null when the state records a non-association (e.g. termination / birth).
export type TypeBBranchAssociationAnnotation = {
  readonly from: TypeBBranchPoseProbeRootReference;
  readonly to: TypeBBranchPoseProbeRootReference | null;
  readonly state: TypeBBranchAssociationState;
};

// One FUTURE branch corridor = a connected component of associated roots across
// the validated lattice. `branchIndex` is a STABLE ENUMERATION LABEL ONLY, never
// a preference, rank, score, or selection. A singleton branch (one probe, one
// root) is allowed. There is intentionally NO confidence field, NO reuse of the
// committed `highConfidence` corridors, and NO selected / best / scored / ranked
// field. B3D-2 populates references + annotations from validated topology;
// B3D-R populates nothing.
export type TypeBBranchFovCorridor = {
  readonly schema: typeof TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA;

  // Stable enumeration only. Never a preference or rank.
  readonly branchIndex: number;

  readonly poseComparisonReferenceFrame: typeof TYPE_B_POSE_COMPARISON_REFERENCE_FRAME;

  // B3D-2 will populate these from validated topology. A singleton branch is
  // allowed (one reference, no association annotations).
  readonly poseProbeRootReferences: readonly TypeBBranchPoseProbeRootReference[];

  readonly associationAnnotations: readonly TypeBBranchAssociationAnnotation[];
};

// --- 6. Future P3P diagnostic run record ------------------------------------
// Neutral FUTURE-ONLY run contract. It has NO status, score, confidence,
// recommendation, selected-pose, best-FOV, preview, load, Apply, or calibration
// field. B3D-R creates NO run records.
export type TypeBP3pDiagnosticRunRecord = {
  readonly schema: typeof TYPE_B_P3P_DIAGNOSTIC_SCHEMA;

  readonly snapshotBasis: TypeBEvidenceSnapshotBasis;

  // Echoes B3C's coverage / refusal facts verbatim. B3D must NOT regenerate,
  // reorder, repair, or reinterpret B3C coverage.
  readonly tupleGeneration: TypeBTupleGenerationResult;

  // One future result per unique poseProbeEquivalenceKey.
  readonly poseProbeResults: readonly TypeBPoseProbeDiagnosticRecord[];

  // Zero or more member-level links. They carry crop state only and can never
  // hold a pose.
  readonly memberCompatibilityRecords: readonly TypeBMemberCompatibilityRecord[];

  // FUTURE B3D-2 branch output. Empty while corridor formation is not assessed
  // or not yet implemented.
  readonly branchCorridors: readonly TypeBBranchFovCorridor[];

  // FUTURE topology declaration. Null means corridor formation was not requested
  // or not assessed; a null topology does NOT invalidate per-probe diagnostics.
  readonly fovTopology: TypeBFovProbeTopologyDeclaration | null;

  // FUTURE run / corridor-level refusal vocabulary only.
  readonly refusalReasons: readonly TypeBDiagnosticRefusalReason[];
};
