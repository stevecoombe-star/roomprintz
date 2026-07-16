// --- Phase B2: Type B evidence-review state helper (pure) --------------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY support for the Type B Operator Evidence
// Panel. This module owns the SMALL pure state machine that backs the panel:
//   - the local review state shape;
//   - lifecycle transitions (empty / begin / clear);
//   - geometry-context identity + invalidation (clear when the room geometry
//     basis changes);
//   - the read-only Type A -> Type B context mapping;
//   - safe normalization of typed coordinate input;
//   - declared-only overlay geometry (declared endpoints ONLY, never extended).
//
// ABSOLUTE SCOPE: nothing here runs a Type B (or Type A) solver / FOV / search /
// preview / load / Apply, mutates a candidate / floor polygon / dimensions /
// FOV / calibration / readiness, performs routing / mode switching, persists,
// or infers an off-frame corner / extends a line. It only shapes ephemeral
// review state and defers ALL qualification to the committed pure B1 modules.
//
// It imports ONLY pure type aliases (Type B B1 types + Type A qualification type
// literals for the context mapping). No React, no scene-state, no solver.

import type {
  SupportQualificationBroadSearchViability,
  SupportQualificationClassification,
} from "./manual-floor-support-qualification-types";
import type {
  TypeATypeBContext,
  TypeBDeclaredLineEvidence,
  TypeBLatentNearCornerCondition,
  TypeBStructuralLineRole,
  TypeBVec2,
} from "./type-b-evidence-types";

export const TYPE_B_REVIEW_FAMILY = "rear_seam_plus_strong_side_seam" as const;

// Local, ephemeral Type B review state. All geometry is normalized SOURCE-space.
// `begun` makes the lifecycle explicit (an operator has opened a review shell)
// so invalidation only fires for an active review. The four *Identity/*Key
// fields capture the geometry BASIS the review was declared against; when the
// live basis diverges the review is cleared (see reconcileTypeBReviewGeometry).
export type TypeBEvidenceReviewState = {
  family: typeof TYPE_B_REVIEW_FAMILY;
  begun: boolean;

  sourceImageIdentity: string | null;
  sourceFrameKey: string | null;
  candidateIdentity: string | null;
  floorPolygonKey: string | null;

  rearSeam: TypeBDeclaredLineEvidence | null;
  strongSideSeam: TypeBDeclaredLineEvidence | null;
  latentNearCornerCondition: TypeBLatentNearCornerCondition;
};

// The room-geometry basis identity. A change in ANY field invalidates an active
// review. Type A context and display-only frame size are intentionally NOT here.
export type TypeBReviewGeometryContext = {
  sourceImageIdentity: string | null;
  sourceFrameKey: string | null;
  candidateIdentity: string | null;
  floorPolygonKey: string | null;
};

export function createEmptyTypeBReviewState(): TypeBEvidenceReviewState {
  return {
    family: TYPE_B_REVIEW_FAMILY,
    begun: false,
    sourceImageIdentity: null,
    sourceFrameKey: null,
    candidateIdentity: null,
    floorPolygonKey: null,
    rearSeam: null,
    strongSideSeam: null,
    // Default latent condition is the most conservative value; it never by
    // itself authorizes Type B (see B1 classifier).
    latentNearCornerCondition: "unresolved",
  };
}

// Begin a review SHELL bound to the current geometry basis. It creates NO points
// and infers NO geometry: rear/side seams stay null and the latent condition
// stays "unresolved". Declarations are only ever created by explicit operator
// edits afterwards.
export function beginTypeBReview(
  context: TypeBReviewGeometryContext
): TypeBEvidenceReviewState {
  const empty = createEmptyTypeBReviewState();
  return {
    ...empty,
    begun: true,
    sourceImageIdentity: context.sourceImageIdentity,
    sourceFrameKey: context.sourceFrameKey,
    candidateIdentity: context.candidateIdentity,
    floorPolygonKey: context.floorPolygonKey,
  };
}

// A review is "active" once begun or once any declaration exists.
export function isTypeBReviewActive(state: TypeBEvidenceReviewState): boolean {
  return (
    state.begun ||
    state.rearSeam !== null ||
    state.strongSideSeam !== null ||
    state.latentNearCornerCondition !== "unresolved"
  );
}

// Whether the review declared points are complete enough to bother showing an
// overlay (any declared seam with finite endpoints). Never asserts validity.
export function typeBReviewHasDeclaredGeometry(
  state: TypeBEvidenceReviewState
): boolean {
  return (
    lineHasFiniteEndpoints(state.rearSeam) ||
    lineHasFiniteEndpoints(state.strongSideSeam)
  );
}

function keyForFrame(
  size: { width: number; height: number } | null | undefined
): string | null {
  if (!size) return null;
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return null;
  return `${size.width}x${size.height}`;
}

function keyForPolygon(
  polygon: ReadonlyArray<{ x: number; y: number }> | null | undefined
): string | null {
  if (!polygon || polygon.length === 0) return null;
  return polygon
    .map((p) =>
      Number.isFinite(p.x) && Number.isFinite(p.y)
        ? `${p.x.toFixed(6)},${p.y.toFixed(6)}`
        : "x"
    )
    .join(";");
}

// Build the geometry-basis identity from live lab inputs. Pure and stable: the
// same inputs always produce the same keys, so an unchanged basis never clears.
export function computeTypeBReviewGeometryContext(input: {
  loadedImageUrl: string | null;
  intrinsicSize: { width: number; height: number } | null;
  candidateId: string | null;
  floorPolygon: ReadonlyArray<{ x: number; y: number }> | null;
}): TypeBReviewGeometryContext {
  return {
    sourceImageIdentity: input.loadedImageUrl ?? null,
    sourceFrameKey: keyForFrame(input.intrinsicSize),
    candidateIdentity: input.candidateId ?? null,
    floorPolygonKey: keyForPolygon(input.floorPolygon),
  };
}

export function typeBReviewGeometryContextMatches(
  state: TypeBEvidenceReviewState,
  context: TypeBReviewGeometryContext
): boolean {
  return (
    state.sourceImageIdentity === context.sourceImageIdentity &&
    state.sourceFrameKey === context.sourceFrameKey &&
    state.candidateIdentity === context.candidateIdentity &&
    state.floorPolygonKey === context.floorPolygonKey
  );
}

export type TypeBReviewReconcileResult = {
  next: TypeBEvidenceReviewState;
  cleared: boolean;
};

// Invalidation gate. If the review is active and the live geometry basis differs
// from the basis it was declared against, the review is CLEARED (declarations
// dropped). Otherwise the state is returned UNCHANGED (same reference), so this
// is safe to call every render without causing update loops. It NEVER touches
// anything outside the review state.
export function reconcileTypeBReviewGeometry(
  state: TypeBEvidenceReviewState,
  context: TypeBReviewGeometryContext
): TypeBReviewReconcileResult {
  if (!isTypeBReviewActive(state)) {
    return { next: state, cleared: false };
  }
  if (typeBReviewGeometryContextMatches(state, context)) {
    return { next: state, cleared: false };
  }
  return { next: createEmptyTypeBReviewState(), cleared: true };
}

// Read-only mapping from the committed Type A support classification + broad-
// search viability into the B1 `TypeATypeBContext`. This DESCRIBES Type A; it
// does not alter or reinterpret Type A state, and grants no Type B authority.
export function mapTypeATypeBContext(
  classification: SupportQualificationClassification,
  viability: SupportQualificationBroadSearchViability
): TypeATypeBContext {
  switch (classification) {
    case "type_a_strong_support":
      // Strong support with no usable basin under current coverage is still a
      // Type A investigation case (Type A remains the active path).
      return viability === "broad_search_no_usable_basin_current_coverage"
        ? "type_a_investigation_case"
        : "type_a_strong_support";
    case "type_a_weak_support":
      return "type_a_weak_support";
    case "type_a_exhausted_type_b_candidate":
      return "type_a_exhausted_handoff_candidate";
    case "qualification_not_run":
    case "insufficient_support_or_unknown":
    default:
      return "type_a_not_run_or_unknown";
  }
}

// Clamp a raw typed value to a safe normalized [0,1] component. Returns null for
// non-finite input so invalid typing is never silently converted into evidence.
export function sanitizeNormComponent(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

function defaultDeclaredLine(
  role: TypeBStructuralLineRole
): TypeBDeclaredLineEvidence {
  return {
    role,
    startNorm: { x: 0, y: 0 },
    endNorm: { x: 0, y: 0 },
    // Conservative defaults so a freshly-created, partially-declared seam
    // classifies as incomplete until the operator sets real statuses.
    startEndpointStatus: "unresolved",
    endEndpointStatus: "unresolved",
    startFrameContact: "unknown",
    endFrameContact: "unknown",
    occlusionStatus: "unknown",
    operatorDeclared: true,
  };
}

// Apply an explicit operator patch to a declared line, creating the line from
// conservative defaults on first edit. For the rear seam `fixedRole` pins the
// role; for the side seam the caller passes the operator-declared role through
// the patch. Never infers a role from geometry.
export function applyDeclaredLinePatch(
  current: TypeBDeclaredLineEvidence | null,
  fixedRole: TypeBStructuralLineRole | null,
  patch: Partial<TypeBDeclaredLineEvidence>
): TypeBDeclaredLineEvidence {
  const base = current ?? defaultDeclaredLine(fixedRole ?? "unresolved");
  const next: TypeBDeclaredLineEvidence = {
    ...base,
    ...patch,
    startNorm: patch.startNorm ? { ...patch.startNorm } : { ...base.startNorm },
    endNorm: patch.endNorm ? { ...patch.endNorm } : { ...base.endNorm },
    operatorDeclared: true,
  };
  if (fixedRole !== null) {
    next.role = fixedRole;
  }
  return next;
}

function isFiniteVec2(point: TypeBVec2 | null | undefined): point is TypeBVec2 {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function lineHasFiniteEndpoints(
  line: TypeBDeclaredLineEvidence | null
): line is TypeBDeclaredLineEvidence {
  return !!line && isFiniteVec2(line.startNorm) && isFiniteVec2(line.endNorm);
}

// --- Declared-only overlay geometry ----------------------------------------
// These builders return ONLY exactly-declared endpoints. They never extend a
// segment, never intersect the two lines, and never synthesize an off-frame
// corner or a quadrilateral.

export type TypeBOverlaySegment = {
  role: "rear" | "side";
  start: TypeBVec2;
  end: TypeBVec2;
};

export function buildTypeBDeclaredSegments(
  rearSeam: TypeBDeclaredLineEvidence | null,
  strongSideSeam: TypeBDeclaredLineEvidence | null
): TypeBOverlaySegment[] {
  const segments: TypeBOverlaySegment[] = [];
  if (lineHasFiniteEndpoints(rearSeam)) {
    segments.push({
      role: "rear",
      start: { x: rearSeam.startNorm.x, y: rearSeam.startNorm.y },
      end: { x: rearSeam.endNorm.x, y: rearSeam.endNorm.y },
    });
  }
  if (lineHasFiniteEndpoints(strongSideSeam)) {
    segments.push({
      role: "side",
      start: { x: strongSideSeam.startNorm.x, y: strongSideSeam.startNorm.y },
      end: { x: strongSideSeam.endNorm.x, y: strongSideSeam.endNorm.y },
    });
  }
  return segments;
}

// The closest pair of DECLARED endpoints between the two seams, for a proximity
// marker. Returns null if either seam is missing/non-finite. Both returned
// points are among the declared endpoints; nothing is invented.
export function findTypeBSharedJunctionEndpoints(
  rearSeam: TypeBDeclaredLineEvidence | null,
  strongSideSeam: TypeBDeclaredLineEvidence | null
): { a: TypeBVec2; b: TypeBVec2 } | null {
  if (!lineHasFiniteEndpoints(rearSeam) || !lineHasFiniteEndpoints(strongSideSeam)) {
    return null;
  }
  const rearEndpoints = [rearSeam.startNorm, rearSeam.endNorm];
  const sideEndpoints = [strongSideSeam.startNorm, strongSideSeam.endNorm];
  let best: { a: TypeBVec2; b: TypeBVec2 } | null = null;
  let bestDist = Infinity;
  for (const a of rearEndpoints) {
    for (const b of sideEndpoints) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < bestDist) {
        bestDist = d;
        best = { a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
      }
    }
  }
  return best;
}
