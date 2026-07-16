// --- Phase B1: Type B qualification classifier (pure) -----------------------
// Pure, deterministic, READ-ONLY classifier for the FUTURE Type B family
// "Rear Seam + One Strong Side-Seam Model". It answers ONLY: given declared
// Type B evidence, derived source-image facts, and read-only Type A context, is
// this room still a Type A investigation case, insufficient for Type B,
// geometrically incompatible with this Type B family, a Type B evidence
// candidate, or eligible for a future bounded Type B diagnostic.
//
// It NEVER runs a Type B search, constructs a latent coordinate/range/ray/
// envelope, extends a line, infers an off-frame endpoint, intersects lines to
// invent a corner, selects/recommends/auto-loads a result, touches Type A
// behavior, or mutates any input. See type-b-evidence-types.ts for the full
// containment scope. It imports ONLY pure Type B type aliases (no solver, FOV,
// calibration, scene-state, or UI).
//
// Type A exhaustion is ADVISORY CONTEXT ONLY and grants no Type B authority.

import type {
  TypeATypeBContext,
  TypeBDeclaredLineEvidence,
  TypeBEndpointStatus,
  TypeBGeometryFacts,
  TypeBQualificationInput,
} from "./type-b-evidence-types";

// --- Type B support thresholds ----------------------------------------------
// LAB-ONLY, documented, conservative HYPOTHESES local to Type B. They are NOT
// final scientific truth and are intentionally NOT imported from Type A (Type B
// must not silently reuse Type A thresholds).

// Minimum source-pixel span for a rear floor/wall seam to count as usable
// support. Below this the rear seam is too short to anchor the family.
export const TYPE_B_MIN_REAR_SEAM_SPAN_PX = 80;

// Minimum source-pixel span for the one strong side seam to count as usable.
export const TYPE_B_MIN_SIDE_SEAM_SPAN_PX = 80;

// Minimum undirected angular separation (degrees) between the rear and side
// lines. Below this the two lines are treated as near-collinear / degenerate,
// so they cannot describe a distinct rear-vs-side relationship.
export const TYPE_B_MIN_ANGULAR_SEPARATION_DEG = 12;

// Maximum source-pixel distance between the closest declared rear/side endpoints
// for them to be read as a single shared VISIBLE junction. This is an image-
// annotation proximity tolerance, NOT a physical-corner claim.
export const TYPE_B_MAX_SHARED_JUNCTION_DISTANCE_PX = 24;

// --- Output vocabulary ------------------------------------------------------

export type TypeBQualificationStatus =
  | "not_assessed"
  | "type_a_investigation_preferred"
  | "type_b_evidence_insufficient"
  | "type_b_evidence_incompatible"
  | "type_b_evidence_candidate"
  | "type_b_diagnostic_eligible";

export type TypeBQualificationReason =
  | "missing_source_frame"
  | "invalid_source_frame"
  | "missing_rear_seam"
  | "missing_strong_side_seam"
  | "rear_seam_role_unresolved"
  | "side_seam_role_unresolved"
  | "rear_seam_geometry_invalid"
  | "side_seam_geometry_invalid"
  | "rear_seam_support_insufficient"
  | "side_seam_support_insufficient"
  | "rear_side_geometry_degenerate"
  | "rear_side_junction_unresolved"
  | "rear_side_junction_incompatible"
  | "latent_near_corner_not_bounded"
  | "latent_near_corner_unresolved"
  | "crop_or_frame_contact_ambiguous"
  | "material_occlusion_on_required_support"
  | "type_a_support_still_investigable"
  | "type_a_investigation_preferred"
  | "type_a_exhaustion_not_established"
  | "type_b_evidence_present_but_incomplete"
  | "type_b_evidence_family_eligible";

export type TypeBQualificationResult = {
  status: TypeBQualificationStatus;
  reasons: TypeBQualificationReason[];

  advisoryReasons: TypeBQualificationReason[];
  blockingReasons: TypeBQualificationReason[];

  evidenceSummary: {
    rearSeamUsable: boolean | null;
    strongSideSeamUsable: boolean | null;
    rearSideRelationshipUsable: boolean | null;
    latentNearCornerBounded: boolean | null;
    cropInterpretationUsable: boolean | null;
  };

  typeAContext: TypeATypeBContext;
};

// Canonical, stable ordering for reasons (mirrors the union declaration order).
const REASON_ORDER: readonly TypeBQualificationReason[] = [
  "missing_source_frame",
  "invalid_source_frame",
  "missing_rear_seam",
  "missing_strong_side_seam",
  "rear_seam_role_unresolved",
  "side_seam_role_unresolved",
  "rear_seam_geometry_invalid",
  "side_seam_geometry_invalid",
  "rear_seam_support_insufficient",
  "side_seam_support_insufficient",
  "rear_side_geometry_degenerate",
  "rear_side_junction_unresolved",
  "rear_side_junction_incompatible",
  "latent_near_corner_not_bounded",
  "latent_near_corner_unresolved",
  "crop_or_frame_contact_ambiguous",
  "material_occlusion_on_required_support",
  "type_a_support_still_investigable",
  "type_a_investigation_preferred",
  "type_a_exhaustion_not_established",
  "type_b_evidence_present_but_incomplete",
  "type_b_evidence_family_eligible",
];

// Reasons that HARD-block Type B eligibility (drive incompatible/insufficient).
const BLOCKING_REASONS: ReadonlySet<TypeBQualificationReason> = new Set([
  "missing_source_frame",
  "invalid_source_frame",
  "missing_rear_seam",
  "missing_strong_side_seam",
  "rear_seam_role_unresolved",
  "side_seam_role_unresolved",
  "rear_seam_geometry_invalid",
  "side_seam_geometry_invalid",
  "rear_seam_support_insufficient",
  "side_seam_support_insufficient",
  "rear_side_geometry_degenerate",
  "rear_side_junction_incompatible",
  "latent_near_corner_not_bounded",
  "latent_near_corner_unresolved",
  "crop_or_frame_contact_ambiguous",
  "material_occlusion_on_required_support",
]);

// Advisory (non-blocking) context reasons. They can keep a room from becoming
// eligible (e.g. Type A exhaustion not established) without asserting a hard
// incompatibility.
const ADVISORY_REASONS: ReadonlySet<TypeBQualificationReason> = new Set([
  "rear_side_junction_unresolved",
  "type_a_support_still_investigable",
  "type_a_investigation_preferred",
  "type_a_exhaustion_not_established",
  "type_b_evidence_present_but_incomplete",
]);

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

// Endpoint statuses whose declared position is trustworthy enough to positively
// assert that two endpoints do NOT meet (used to distinguish an incompatible
// junction from an unresolved / possibly-latent one).
function isCertainEndpoint(status: TypeBEndpointStatus): boolean {
  return status === "visible" || status === "near_frame";
}

// A required line endpoint that is "unresolved" prevents strong support.
function hasUnresolvedEndpoint(line: TypeBDeclaredLineEvidence): boolean {
  return (
    line.startEndpointStatus === "unresolved" ||
    line.endEndpointStatus === "unresolved"
  );
}

type JunctionState = "present" | "unresolved" | "incompatible";

function classifyJunction(
  facts: TypeBGeometryFacts,
  rear: TypeBDeclaredLineEvidence,
  side: TypeBDeclaredLineEvidence
): JunctionState {
  const dist = facts.sharedJunctionDistanceSourcePx;
  if (dist === null || !Number.isFinite(dist)) return "unresolved";
  if (dist <= TYPE_B_MAX_SHARED_JUNCTION_DISTANCE_PX) return "present";
  // Beyond tolerance: only assert a positive incompatibility when ALL declared
  // endpoints are position-certain. If any endpoint is truncated/occluded/
  // unresolved, the true meeting point may be latent/off-frame, so we stay
  // "unresolved" (candidate) rather than falsely declaring incompatibility.
  const allCertain =
    isCertainEndpoint(rear.startEndpointStatus) &&
    isCertainEndpoint(rear.endEndpointStatus) &&
    isCertainEndpoint(side.startEndpointStatus) &&
    isCertainEndpoint(side.endEndpointStatus);
  return allCertain ? "incompatible" : "unresolved";
}

/**
 * Pure, deterministic Type B qualification classifier. Returns a fresh record on
 * every call and never mutates any input. Never throws for malformed evidence.
 */
export function qualifyTypeBEvidence(
  input: TypeBQualificationInput
): TypeBQualificationResult {
  const typeAContext = input.typeAContext;
  const collected = new Set<TypeBQualificationReason>();

  const add = (reason: TypeBQualificationReason): void => {
    collected.add(reason);
  };

  const emptySummary = (): TypeBQualificationResult["evidenceSummary"] => ({
    rearSeamUsable: null,
    strongSideSeamUsable: null,
    rearSideRelationshipUsable: null,
    latentNearCornerBounded: null,
    cropInterpretationUsable: null,
  });

  const finalize = (
    status: TypeBQualificationStatus,
    evidenceSummary: TypeBQualificationResult["evidenceSummary"]
  ): TypeBQualificationResult => {
    const ordered = REASON_ORDER.filter((r) => collected.has(r));
    const blocking = ordered.filter((r) => BLOCKING_REASONS.has(r));
    const advisory = ordered.filter((r) => ADVISORY_REASONS.has(r));
    return {
      status,
      reasons: ordered,
      advisoryReasons: advisory,
      blockingReasons: blocking,
      evidenceSummary,
      typeAContext,
    };
  };

  // --- 1. not_assessed: genuinely absent core inputs -------------------------
  if (!input.sourceFrame) {
    add("missing_source_frame");
    return finalize("not_assessed", emptySummary());
  }
  if (!input.rearSeam) {
    add("missing_rear_seam");
    return finalize("not_assessed", emptySummary());
  }
  if (!input.strongSideSeam) {
    add("missing_strong_side_seam");
    return finalize("not_assessed", emptySummary());
  }
  if (!input.geometryFacts) {
    // Geometry facts are a required core input for this pure phase; without them
    // there is nothing to assess (not the same as "insufficient evidence").
    add("type_b_evidence_present_but_incomplete");
    return finalize("not_assessed", emptySummary());
  }

  const frame = input.sourceFrame;
  const rear = input.rearSeam;
  const side = input.strongSideSeam;
  const facts = input.geometryFacts;

  // --- Compute all evidence flags (no mutation, no early verdict) ------------
  const invalidFrame =
    !isFinitePositive(frame.width) ||
    !isFinitePositive(frame.height) ||
    facts.validSourceFrame === false;

  const rearRoleOk = rear.role === "rear_floor_wall_seam";
  const sideRoleOk =
    side.role === "side_floor_boundary" || side.role === "side_wall_floor_seam";

  const rearGeomValid = facts.rearSpanSourcePx !== null;
  const sideGeomValid = facts.sideSpanSourcePx !== null;
  const nonFiniteGeometry = facts.finiteDeclaredGeometry === false;

  const rearSpanOk =
    facts.rearSpanSourcePx !== null &&
    facts.rearSpanSourcePx >= TYPE_B_MIN_REAR_SEAM_SPAN_PX;
  const sideSpanOk =
    facts.sideSpanSourcePx !== null &&
    facts.sideSpanSourcePx >= TYPE_B_MIN_SIDE_SEAM_SPAN_PX;

  const rearMaterialOcclusion = rear.occlusionStatus === "material_obstruction";
  const sideMaterialOcclusion = side.occlusionStatus === "material_obstruction";
  const rearOcclusionUnknown = rear.occlusionStatus === "unknown";
  const sideOcclusionUnknown = side.occlusionStatus === "unknown";

  // Relationship geometry.
  const angle = facts.rearSideAngleDeg;
  const angleOk = angle !== null && angle >= TYPE_B_MIN_ANGULAR_SEPARATION_DEG;
  const degenerate =
    facts.rearAndSideNonDegenerate === false ||
    angle === null ||
    angle < TYPE_B_MIN_ANGULAR_SEPARATION_DEG;

  const junctionState = classifyJunction(facts, rear, side);
  const junctionPresent = junctionState === "present";
  const junctionIncompatible = junctionState === "incompatible";

  // Crop / frame-contact interpretation: only frame-truncated REQUIRED endpoints
  // must have an interpretable frame contact. `contacts_frame` is acceptable but
  // is never treated as proof of physical extension off-frame.
  const truncatedEndpointAmbiguous = (
    line: TypeBDeclaredLineEvidence
  ): boolean => {
    const startBad =
      line.startEndpointStatus === "frame_truncated" &&
      (line.startFrameContact === "frame_contact_ambiguous" ||
        line.startFrameContact === "unknown");
    const endBad =
      line.endEndpointStatus === "frame_truncated" &&
      (line.endFrameContact === "frame_contact_ambiguous" ||
        line.endFrameContact === "unknown");
    return startBad || endBad;
  };
  const cropAmbiguous =
    truncatedEndpointAmbiguous(rear) || truncatedEndpointAmbiguous(side);
  const cropInterpretationUsable = !cropAmbiguous;

  // Latent near-corner boundedness.
  const latentUnresolved = input.latentNearCornerCondition === "unresolved";
  const latentNearCornerBounded = !latentUnresolved;

  // Per-line usability (strong support). `frame_truncated` / `occluded` /
  // `near_frame` endpoints do NOT by themselves make a seam unusable — those are
  // near-corner conditions handled via the latent + crop axes. Only `unresolved`
  // endpoints, invalid/short geometry, material occlusion, unknown occlusion, or
  // a bad role remove strong support.
  const rearSeamUsable =
    rearRoleOk &&
    rearGeomValid &&
    rearSpanOk &&
    !rearMaterialOcclusion &&
    !rearOcclusionUnknown &&
    !hasUnresolvedEndpoint(rear);
  const strongSideSeamUsable =
    sideRoleOk &&
    sideGeomValid &&
    sideSpanOk &&
    !sideMaterialOcclusion &&
    !sideOcclusionUnknown &&
    !hasUnresolvedEndpoint(side);

  const rearSideRelationshipUsable =
    facts.rearAndSideNonDegenerate === true && angleOk && junctionPresent;

  const evidenceSummary: TypeBQualificationResult["evidenceSummary"] = {
    rearSeamUsable,
    strongSideSeamUsable,
    rearSideRelationshipUsable,
    latentNearCornerBounded,
    cropInterpretationUsable,
  };

  // --- 2. Type A active-investigation contexts (precedence over B verdicts) --
  // These contexts keep Type A as the active investigation path. Type B must not
  // become eligible. We still report the computed evidence summary for context.
  if (
    typeAContext === "type_a_strong_support" ||
    typeAContext === "type_a_investigation_case" ||
    typeAContext === "type_a_weak_support"
  ) {
    add("type_a_investigation_preferred");
    if (typeAContext === "type_a_strong_support") {
      add("type_a_support_still_investigable");
    }
    return finalize("type_a_investigation_preferred", evidenceSummary);
  }

  // Remaining contexts: `type_a_exhausted_handoff_candidate` or
  // `type_a_not_run_or_unknown`. Neither grants authority on its own.

  // --- 3. type_b_evidence_incompatible ---------------------------------------
  let incompatible = false;
  if (!rearRoleOk) {
    add("rear_seam_role_unresolved");
    incompatible = true;
  }
  if (!sideRoleOk) {
    add("side_seam_role_unresolved");
    incompatible = true;
  }
  // Only assert degeneracy/junction incompatibility once geometry is finite; a
  // non-finite geometry is an insufficiency (handled below), not incompatibility.
  if (!nonFiniteGeometry && rearGeomValid && sideGeomValid) {
    if (degenerate) {
      add("rear_side_geometry_degenerate");
      incompatible = true;
    }
    if (junctionIncompatible) {
      add("rear_side_junction_incompatible");
      incompatible = true;
    }
  }
  if (incompatible) {
    return finalize("type_b_evidence_incompatible", evidenceSummary);
  }

  // --- 4. type_b_evidence_insufficient ---------------------------------------
  let insufficient = false;
  if (invalidFrame) {
    add("invalid_source_frame");
    insufficient = true;
  }
  if (!rearGeomValid) {
    add("rear_seam_geometry_invalid");
    insufficient = true;
  }
  if (!sideGeomValid) {
    add("side_seam_geometry_invalid");
    insufficient = true;
  }
  if (rearGeomValid && !rearSpanOk) {
    add("rear_seam_support_insufficient");
    insufficient = true;
  }
  if (sideGeomValid && !sideSpanOk) {
    add("side_seam_support_insufficient");
    insufficient = true;
  }
  if (rearMaterialOcclusion || sideMaterialOcclusion) {
    add("material_occlusion_on_required_support");
    insufficient = true;
  }
  if (rearOcclusionUnknown || sideOcclusionUnknown) {
    // Unknown occlusion is treated conservatively as advisory-plus-incomplete;
    // it can never contribute strong support.
    add("type_b_evidence_present_but_incomplete");
    insufficient = true;
  }
  if (hasUnresolvedEndpoint(rear)) {
    add("rear_seam_support_insufficient");
    insufficient = true;
  }
  if (hasUnresolvedEndpoint(side)) {
    add("side_seam_support_insufficient");
    insufficient = true;
  }
  if (latentUnresolved) {
    add("latent_near_corner_unresolved");
    insufficient = true;
  }
  if (cropAmbiguous) {
    add("crop_or_frame_contact_ambiguous");
    insufficient = true;
  }
  if (insufficient) {
    return finalize("type_b_evidence_insufficient", evidenceSummary);
  }

  // --- Remaining: both seams usable, geometry non-degenerate, angle adequate,
  // crop interpretable, latent bounded. Only junction presence + Type A
  // exhaustion decide candidate vs eligible. ---------------------------------

  // --- 6. type_b_diagnostic_eligible -----------------------------------------
  const eligible =
    typeAContext === "type_a_exhausted_handoff_candidate" &&
    rearSeamUsable &&
    strongSideSeamUsable &&
    rearSideRelationshipUsable &&
    junctionPresent &&
    latentNearCornerBounded &&
    cropInterpretationUsable;

  if (eligible) {
    add("type_b_evidence_family_eligible");
    return finalize("type_b_diagnostic_eligible", evidenceSummary);
  }

  // --- 5. type_b_evidence_candidate ------------------------------------------
  if (!junctionPresent) {
    add("rear_side_junction_unresolved");
  }
  if (typeAContext !== "type_a_exhausted_handoff_candidate") {
    // Type A exhaustion is not established (e.g. not run / unknown), so eligible
    // is not permitted even when the evidence itself is otherwise sound.
    add("type_a_exhaustion_not_established");
  }
  return finalize("type_b_evidence_candidate", evidenceSummary);
}
