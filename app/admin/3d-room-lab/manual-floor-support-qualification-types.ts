// --- Phase 2O-N: Type A Support Qualification types -------------------------
// Pure schema + literals for a LAB-ONLY, DIAGNOSTIC-ONLY, READ-ONLY Type A
// support-qualification classifier.
//
// ABSOLUTE SCOPE (Phase 2O-N): nothing in this module (or the classifier that
// consumes it) may move a corner, infer/grant movement authority, choose a
// movable corner, infer seam truth, select a seed, rank tuples, run broad
// search / local refinement / solver / FOV scans, mutate candidate / annotation
// / floor polygon / FOV / dimensions / calibration / scene-state, switch modes,
// or apply calibration. This layer READS already-computed evidence and reports
// facts plus a conservative, descriptive classification. It NEVER implements
// Type B and NEVER emits an auto-route / recommended-mode / best-mode signal.
//
// This module imports ONLY harmless pure TYPE aliases. It has NO solver,
// calibration/apply, FOV, snapshot, scene-state, or UI imports.

import type {
  ImageFrameSize,
  ImageIntrinsicSize,
} from "./image-space";
import type { ManualFloorSupportAnnotation } from "./manual-floor-support-types";
import type { TrialQuadNorm } from "./manual-floor-support-trial-types";
import type { CoupledSearchResultSet } from "./manual-floor-support-coupled-search-types";

export const TYPE_A_SUPPORT_QUALIFICATION_SCHEMA =
  "vibode-type-a-support-qualification/v0" as const;

// --- Classification vocabulary ----------------------------------------------
// Descriptive diagnostic states ONLY. There is intentionally NO
// "automatic_type_b", "type_b_required", "switch_to_type_b", "auto_route",
// "recommended mode", or "best mode" value. The strongest assertion this layer
// makes is `type_a_exhausted_type_b_candidate`: a conditional HANDOFF-CANDIDATE
// fact for the operator, never an action.
export type SupportQualificationClassification =
  | "qualification_not_run"
  | "type_a_strong_support"
  | "type_a_weak_support"
  | "type_a_exhausted_type_b_candidate"
  | "insufficient_support_or_unknown";

// --- Threshold policy -------------------------------------------------------
// All thresholds are LAB-ONLY, documented, overridable HYPOTHESES. They are NOT
// final scientific truth. They are carried back verbatim in the classifier
// output (`thresholdsUsed`) so any downstream readout is self-describing.
export type SupportQualificationThresholds = {
  // Absolute source-pixel floor below which a determining seam is treated as a
  // structural (not merely advisory) lack of support — essentially a point that
  // cannot define a usable corridor. Hard structural gate.
  minUsableDeterminingSpanPx: number;
  // Absolute source-pixel span below which the determining seam is an ADVISORY
  // weak-support indicator (fragile but not structurally impossible).
  weakDeterminingSpanPx: number;
  // Determining span as a fraction of the intrinsic image diagonal; below this
  // is an ADVISORY weak-support indicator (resolution-independent).
  weakDeterminingSpanImageDiagonalRatio: number;
  // Near-frame margin as a fraction of the SMALLER intrinsic image dimension.
  // A determining endpoint whose nearest source-frame-edge distance is below
  // `frameEdgeMarginRatio * min(width, height)` source pixels is "near frame".
  frameEdgeMarginRatio: number;
  // Determining-to-movable span ratio below which the side-span imbalance is an
  // ADVISORY weak-support indicator. NEVER a hard gate on its own.
  weakDeterminingToMovableSpanRatio: number;
};

export const DEFAULT_SUPPORT_QUALIFICATION_THRESHOLDS: SupportQualificationThresholds = {
  minUsableDeterminingSpanPx: 24,
  weakDeterminingSpanPx: 120,
  weakDeterminingSpanImageDiagonalRatio: 0.04,
  frameEdgeMarginRatio: 0.015,
  weakDeterminingToMovableSpanRatio: 0.15,
};

// Phase 2O-O-A: SUBSTANTIVE support-geometry concerns only. A near-frame
// endpoint by itself is NOT here — it is an advisory evidence fact (see
// SupportQualificationAdvisoryFact) and never alone weakens support. Frame-edge
// collapse remains substantive because it already requires BOTH a short/weak
// span and a near-frame endpoint.
export type SupportQualificationWeakIndicator =
  | "short_determining_span_absolute"
  | "short_determining_span_image_diagonal"
  | "severe_determining_to_movable_span_imbalance"
  | "determining_seam_frame_edge_collapsed";

// Phase 2O-O-A: NON-ROUTING advisory evidence facts. Reported even when support
// is strong. These never by themselves cause type_a_weak_support or
// type_a_exhausted_type_b_candidate and never change movement authority.
export type SupportQualificationAdvisoryFact = "determining_endpoint_near_frame";

// Phase 2O-O-A: second diagnostic axis — current bounded broad-search viability.
// This is a facts/provenance-driven DESCRIPTION, never a routing action. The
// "no usable basin" value is always conditional on the current broad-search
// coverage/config provenance.
export type SupportQualificationBroadSearchViability =
  | "broad_search_not_run_or_unknown"
  | "broad_search_usable_basin_found"
  | "broad_search_no_usable_basin_current_coverage";

// --- Input contract ---------------------------------------------------------
// Everything is explicit and caller-supplied. The classifier NEVER reads UI /
// live / scene state implicitly and NEVER runs any search or solver. All inputs
// are treated as immutable and are never mutated.
export type QualifyTypeASupportInput = {
  // Operator annotation (evidence declarations). Read-only.
  annotation: ManualFloorSupportAnnotation | null;
  // Candidate quad is CONTEXT ONLY and is never mutated. Optional: the support
  // verdict is driven by seam evidence, not the candidate quad.
  candidateQuadNorm: TrialQuadNorm | null;
  // Intrinsic (true image) size — the frame reference for source-pixel facts.
  intrinsicSize: ImageIntrinsicSize | null;
  // Displayed container/frame size — context only (crop diagnostics), never the
  // sole source of frame-collapse truth.
  frameSize: ImageFrameSize | null;

  // Already-computed broad coupled-search result set (READ-ONLY). The classifier
  // never runs the search or the solver; it only reads stored trial records.
  broadSearch: CoupledSearchResultSet | null;
  // Signature of the evidence the broadSearch was computed FOR.
  broadSearchEvidenceSignature: string | null;
  // Signature of the CURRENT evidence. Exhaustion evidence is honored only when
  // these signatures are both present and equal (search is current, not stale).
  currentEvidenceSignature: string | null;

  // Caller-provided OBSERVED fact: whether any stored coarse tuple currently
  // qualifies to seed local refinement. null means unknown (not computed).
  localSeedEligible: boolean | null;

  // Optional partial threshold overrides (merged over documented defaults).
  thresholds?: Partial<SupportQualificationThresholds>;
};

// --- Output contract --------------------------------------------------------
export type SupportQualificationBroadSearchStateCounts = {
  invalid_geometry: number;
  no_pose: number;
  pose_poor: number;
  high_confidence_not_apply_safe: number;
  apply_safe_diagnostic: number;
};

export type SupportQualificationFacts = {
  intrinsicSize: { width: number; height: number } | null;
  frameSize: { width: number; height: number } | null;
  imageDiagonalSourcePx: number | null;

  movableSideSpanSourcePx: number | null;
  determiningSideSpanSourcePx: number | null;
  rearSeamSpanSourcePx: number | null;

  spanRatioDeterminingToMovable: number | null;

  // [startEndpoint, endEndpoint] of the usable determining seam.
  determiningEndpointMinEdgeDistanceSourcePx: [number, number] | null;
  determiningEndpointNearFrame: [boolean, boolean] | null;
  determiningSeamFrameEdgeCollapsed: boolean | null;

  annotationValid: boolean;
  movableCorner: "NL" | "NR" | null;
  movableSeamId: string | null;
  determiningSeamId: string | null;

  broadSearchRun: boolean;
  broadSearchCurrent: boolean;
  broadSearchComplete: boolean;
  broadSearchTruncated: boolean | null;
  broadSearchTupleCount: number | null;

  broadSearchStateCounts: SupportQualificationBroadSearchStateCounts | null;

  anyTupleHasHighConfidenceCorridor: boolean | null;
  eligibleLocalSeedExists: boolean | null;
};

export type SupportQualificationExhaustion = {
  // True only when the completed, current, bounded broad search shows no usable
  // basin (the "B" condition of the handoff-candidate rule).
  eligible: boolean;
  // Ordered, human-readable identifiers of unmet conditions (empty when eligible).
  missing: string[];
  // Definite no-usable-basin verdict; null when it cannot be determined (search
  // absent / stale / truncated / incomplete / seed-eligibility unknown).
  noUsableBasin: boolean | null;
};

export type SupportQualificationBroadSearchProvenance = {
  evidenceSignature: string | null;
  currentEvidenceSignature: string | null;
  tupleCount: number | null;
  truncated: boolean | null;
  configSummary: {
    tNearSampleCount: number | null;
    aspectRatioCount: number | null;
    maxEvaluations: number | null;
  } | null;
};

export type TypeASupportQualification = {
  schema: typeof TYPE_A_SUPPORT_QUALIFICATION_SCHEMA;

  classification: SupportQualificationClassification;

  // Phase 2O-O-A: second independent axis — current broad-search viability.
  // Reported for every result (independent of the support verdict).
  broadSearchViability: SupportQualificationBroadSearchViability;

  facts: SupportQualificationFacts;

  // SUBSTANTIVE support-geometry concerns only (drive the support verdict).
  weakSupportIndicators: SupportQualificationWeakIndicator[];

  // Phase 2O-O-A: non-routing advisory evidence facts (e.g. endpoint near
  // frame). Present even when support is strong; never a verdict trigger.
  advisoryEvidenceFacts: SupportQualificationAdvisoryFact[];

  exhaustion: SupportQualificationExhaustion | null;

  thresholdsUsed: SupportQualificationThresholds;

  broadSearchProvenance: SupportQualificationBroadSearchProvenance | null;

  reasons: string[];

  provenance: "diagnostic_support_qualification_only";
};
