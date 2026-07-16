// --- Phase B1: Type B Evidence Schema (pure types) --------------------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY foundation for a FUTURE Type B
// diagnostic family:
//
//   "Rear Seam + One Strong Side-Seam Model"
//   with an evidence-first LATENT near-corner representation.
//
// ABSOLUTE SCOPE (Phase B1): this module and everything that consumes it define
// PURE TYPES ONLY. Nothing here (or in the facts helper / qualifier) may:
//   - modify Type A support classification or broad-search behavior;
//   - import or invoke camera-pose solver / FOV scan code;
//   - alter candidate selection / floor polygon / dimensions / FOV / calibration
//     / readiness / Apply;
//   - add routing, automatic Type B switching, persistence, API routes,
//     production integration, telemetry, or UI;
//   - infer off-frame endpoint coordinates;
//   - create any "best", recommended, selected, or auto-loaded Type B result.
//
// Type A exhaustion is ADVISORY CONTEXT ONLY. It grants no Type B authority.
//
// This module has NO imports: it is a self-contained pure type surface.

// The only Type B evidence family this phase recognizes.
export type TypeBEvidenceFamily = "rear_seam_plus_strong_side_seam";

// Operator-declared structural role of a single declared line of evidence. Roles
// are DECLARED, never inferred, by the classifier.
export type TypeBStructuralLineRole =
  | "rear_floor_wall_seam"
  | "side_floor_boundary"
  | "side_wall_floor_seam"
  | "unresolved";

// Observed status of one endpoint of a declared line. `near_frame` is advisory
// only; `frame_truncated` may remain usable when the visible span is sufficient;
// `occluded`/`unresolved` are conservative negatives for strong support.
export type TypeBEndpointStatus =
  | "visible"
  | "near_frame"
  | "frame_truncated"
  | "occluded"
  | "unresolved";

// Whether an endpoint is observed to contact the source-image frame edge.
// `contacts_frame` is NEVER treated as proof of physical extension off-frame.
export type TypeBFrameContactStatus =
  | "no_frame_contact"
  | "contacts_frame"
  | "frame_contact_ambiguous"
  | "unknown";

// Occlusion observed along a declared line. `material_obstruction` on a required
// seam is blocking; `unknown` is treated conservatively (never strong support).
export type TypeBOcclusionStatus =
  | "none_observed"
  | "partial_obstruction"
  | "material_obstruction"
  | "unknown";

// Declared condition of the (future) latent near-corner. This phase ONLY
// classifies whether the declared condition COULD support a future bounded
// representation. It never creates a latent coordinate, range, ray, or envelope.
export type TypeBLatentNearCornerCondition =
  | "not_needed_visible"
  | "frame_truncated"
  | "occluded"
  | "unresolved";

// Read-only Type A context handed in by the caller. This is ADVISORY context
// only; `type_a_exhausted_handoff_candidate` never by itself creates Type B
// eligibility.
export type TypeATypeBContext =
  | "type_a_not_run_or_unknown"
  | "type_a_strong_support"
  | "type_a_weak_support"
  | "type_a_exhausted_handoff_candidate"
  | "type_a_investigation_case";

// Minimal lab-local normalized 2D point. Source-image-normalized coordinates in
// [0,1] are expected, but the type does not enforce a range. Kept local so this
// module has no cross-module import coupling.
export type TypeBVec2 = {
  x: number;
  y: number;
};

// A single operator-declared line of Type B evidence. `operatorDeclared` is a
// literal `true` to make explicit that every line is a human declaration, never
// an inferred artifact.
export type TypeBDeclaredLineEvidence = {
  role: TypeBStructuralLineRole;
  startNorm: TypeBVec2;
  endNorm: TypeBVec2;
  startEndpointStatus: TypeBEndpointStatus;
  endEndpointStatus: TypeBEndpointStatus;
  startFrameContact: TypeBFrameContactStatus;
  endFrameContact: TypeBFrameContactStatus;
  occlusionStatus: TypeBOcclusionStatus;
  operatorDeclared: true;
  notes?: string;
};

// The source (intrinsic) image frame that all Type B geometry facts are measured
// against. This is source-image geometry only, never a live container crop.
export type TypeBSourceFrame = {
  width: number;
  height: number;
};

// Pure, source-image-only geometry facts derived from declared evidence. Every
// field is `null` when it cannot be computed from finite, valid inputs. No field
// here is ever inferred off-frame or extended beyond declared endpoints.
export type TypeBGeometryFacts = {
  rearSpanSourcePx: number | null;
  sideSpanSourcePx: number | null;
  rearToSideSpanRatio: number | null;

  rearSideAngleDeg: number | null;
  rearAndSideNonDegenerate: boolean | null;

  rearStartDistanceToFramePx: number | null;
  rearEndDistanceToFramePx: number | null;
  sideStartDistanceToFramePx: number | null;
  sideEndDistanceToFramePx: number | null;

  // Distance (source px) between the CLOSEST declared rear/side endpoints. Never
  // an intersection or an off-frame extrapolation.
  sharedJunctionDistanceSourcePx: number | null;
  // True only when the closest declared endpoints are within the explicit
  // annotation-proximity tolerance; a declared-endpoint fact, not a room corner.
  sharedJunctionPresent: boolean | null;

  validSourceFrame: boolean;
  finiteDeclaredGeometry: boolean;
};

// Full explicit input contract for the qualifier. Everything is caller-supplied
// and treated as immutable. The qualifier reads NO live / UI / scene state.
export type TypeBQualificationInput = {
  family: "rear_seam_plus_strong_side_seam";

  sourceFrame: TypeBSourceFrame | null;

  rearSeam: TypeBDeclaredLineEvidence | null;
  strongSideSeam: TypeBDeclaredLineEvidence | null;

  latentNearCornerCondition: TypeBLatentNearCornerCondition;

  typeAContext: TypeATypeBContext;

  geometryFacts: TypeBGeometryFacts | null;
};
