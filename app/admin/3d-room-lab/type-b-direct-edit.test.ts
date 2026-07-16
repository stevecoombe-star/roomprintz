// --- Phase B2A: Type B direct-overlay edit helper unit tests ----------------
// Pure unit tests (node:test) for the lab-only Type B direct placement/drag
// helpers. UI pointer wiring lives in ThreeRoomLab.tsx; these tests exercise the
// pure endpoint-patch / sanitization / target-mapping logic that backs it, plus
// confirm edits re-derive facts + qualification through the committed B1 modules
// and never mutate anything outside the targeted declared endpoint.

import assert from "node:assert/strict";
import test from "node:test";

import { deriveTypeBGeometryFacts } from "./type-b-evidence-facts";
import type {
  TypeBDeclaredLineEvidence,
  TypeBSourceFrame,
} from "./type-b-evidence-types";
import { qualifyTypeBEvidence } from "./type-b-qualification";
import {
  beginTypeBReview,
  buildTypeBDeclaredSegments,
  computeTypeBReviewGeometryContext,
  createEmptyTypeBReviewState,
  findTypeBSharedJunctionEndpoints,
  reconcileTypeBReviewGeometry,
  type TypeBEvidenceReviewState,
} from "./type-b-evidence-review";
import {
  patchTypeBReviewEndpoint,
  resolveTypeBPlacementTargetAfterReconcile,
  sanitizeTypeBNormPoint,
  typeBEndpointTargetIsStart,
  typeBEndpointTargetSeam,
  type TypeBPlacementTarget,
} from "./type-b-direct-edit";

const FRAME: TypeBSourceFrame = { width: 1000, height: 1000 };

const CTX_A = {
  loadedImageUrl: "room-a.jpg",
  intrinsicSize: { width: 1000, height: 1000 },
  candidateId: "cand-1",
  floorPolygon: [
    { x: 0.1, y: 0.9 },
    { x: 0.9, y: 0.9 },
    { x: 0.8, y: 0.3 },
    { x: 0.2, y: 0.3 },
  ],
};

function contextA() {
  return computeTypeBReviewGeometryContext(CTX_A);
}

function rearHealthy(): TypeBDeclaredLineEvidence {
  return {
    role: "rear_floor_wall_seam",
    startNorm: { x: 0.2, y: 0.8 },
    endNorm: { x: 0.6, y: 0.8 },
    startEndpointStatus: "visible",
    endEndpointStatus: "frame_truncated",
    startFrameContact: "no_frame_contact",
    endFrameContact: "contacts_frame",
    occlusionStatus: "partial_obstruction",
    operatorDeclared: true,
    notes: "rear note",
  };
}

function sideHealthy(): TypeBDeclaredLineEvidence {
  return {
    role: "side_wall_floor_seam",
    startNorm: { x: 0.2, y: 0.8 },
    endNorm: { x: 0.2, y: 0.4 },
    startEndpointStatus: "visible",
    endEndpointStatus: "visible",
    startFrameContact: "no_frame_contact",
    endFrameContact: "no_frame_contact",
    occlusionStatus: "none_observed",
    operatorDeclared: true,
    notes: "side note",
  };
}

function begunWithSeams(): TypeBEvidenceReviewState {
  return {
    ...beginTypeBReview(contextA()),
    rearSeam: rearHealthy(),
    strongSideSeam: sideHealthy(),
  };
}

// --- Target mapping ---------------------------------------------------------

test("endpoint target maps to the correct seam and endpoint", () => {
  assert.equal(typeBEndpointTargetSeam("rear_start"), "rear");
  assert.equal(typeBEndpointTargetSeam("rear_end"), "rear");
  assert.equal(typeBEndpointTargetSeam("side_start"), "side");
  assert.equal(typeBEndpointTargetSeam("side_end"), "side");
  assert.equal(typeBEndpointTargetIsStart("rear_start"), true);
  assert.equal(typeBEndpointTargetIsStart("side_start"), true);
  assert.equal(typeBEndpointTargetIsStart("rear_end"), false);
  assert.equal(typeBEndpointTargetIsStart("side_end"), false);
});

// --- 7. Coordinates are clamped + non-finite rejected -----------------------

test("sanitizeTypeBNormPoint clamps to [0,1] and rejects non-finite", () => {
  assert.deepEqual(sanitizeTypeBNormPoint({ x: 0.4, y: 0.7 }), { x: 0.4, y: 0.7 });
  assert.deepEqual(sanitizeTypeBNormPoint({ x: -0.5, y: 1.9 }), { x: 0, y: 1 });
  assert.equal(sanitizeTypeBNormPoint({ x: Number.NaN, y: 0.5 }), null);
  assert.equal(sanitizeTypeBNormPoint({ x: 0.5, y: Number.POSITIVE_INFINITY }), null);
  assert.equal(sanitizeTypeBNormPoint(null), null);
});

// --- 1 & 2 & 3. Arming vs placing: only a completed valid click writes -------
// Arming is transient UI state (component-level); the pure helper only writes
// when an actual click supplies a point. These assert the write half.

test("2: a valid placement click writes only the targeted endpoint", () => {
  const state = beginTypeBReview(contextA());
  const { next, changed } = patchTypeBReviewEndpoint(state, "rear_start", { x: 0.3, y: 0.7 });
  assert.equal(changed, true);
  assert.deepEqual(next.rearSeam?.startNorm, { x: 0.3, y: 0.7 });
  // The untouched endpoint stays at the conservative default; nothing inferred.
  assert.deepEqual(next.rearSeam?.endNorm, { x: 0, y: 0 });
  // The side seam is not created.
  assert.equal(next.strongSideSeam, null);
  // Role is pinned; endpoint remains operator-declared.
  assert.equal(next.rearSeam?.role, "rear_floor_wall_seam");
  assert.equal(next.rearSeam?.operatorDeclared, true);
});

// --- 4. Arming/placing a side endpoint never alters the rear seam -----------

test("4: placing a side endpoint does not create or alter the rear seam", () => {
  const state = beginTypeBReview(contextA());
  const { next } = patchTypeBReviewEndpoint(state, "side_end", { x: 0.2, y: 0.4 });
  assert.equal(next.rearSeam, null);
  assert.deepEqual(next.strongSideSeam?.endNorm, { x: 0.2, y: 0.4 });
  // Side role stays operator-declared (defaults to unresolved; never inferred).
  assert.equal(next.strongSideSeam?.role, "unresolved");
});

// --- 5. Dragging updates only that endpoint ---------------------------------

test("5: dragging an endpoint updates only that endpoint's coordinate", () => {
  const state = begunWithSeams();
  const { next } = patchTypeBReviewEndpoint(state, "rear_end", { x: 0.55, y: 0.82 });
  assert.deepEqual(next.rearSeam?.endNorm, { x: 0.55, y: 0.82 });
  // Same seam's OTHER endpoint unchanged.
  assert.deepEqual(next.rearSeam?.startNorm, { x: 0.2, y: 0.8 });
  // The other seam is untouched (same reference).
  assert.equal(next.strongSideSeam, state.strongSideSeam);
});

// --- 6. Dragging preserves all endpoint metadata ----------------------------

test("6: dragging preserves status, frame-contact, occlusion, role, and notes", () => {
  const state = begunWithSeams();
  const before = state.rearSeam!;
  const { next } = patchTypeBReviewEndpoint(state, "rear_start", { x: 0.11, y: 0.77 });
  const after = next.rearSeam!;
  assert.deepEqual(after.startNorm, { x: 0.11, y: 0.77 });
  assert.equal(after.role, before.role);
  assert.equal(after.startEndpointStatus, before.startEndpointStatus);
  assert.equal(after.endEndpointStatus, before.endEndpointStatus);
  assert.equal(after.startFrameContact, before.startFrameContact);
  assert.equal(after.endFrameContact, before.endFrameContact);
  assert.equal(after.occlusionStatus, before.occlusionStatus);
  assert.equal(after.notes, before.notes);
  assert.equal(after.operatorDeclared, true);
});

// --- 7. Placed/dragged coordinates are stored normalized and clamped --------

test("7: placed coordinates are stored normalized + clamped to [0,1]", () => {
  const state = beginTypeBReview(contextA());
  const { next } = patchTypeBReviewEndpoint(state, "side_start", { x: 1.4, y: -0.3 });
  assert.deepEqual(next.strongSideSeam?.startNorm, { x: 1, y: 0 });
});

// --- 8. Invalid/non-finite conversion does not mutate evidence --------------

test("8: a non-finite point is a no-op (same state reference, no mutation)", () => {
  const state = begunWithSeams();
  const result = patchTypeBReviewEndpoint(state, "rear_start", { x: Number.NaN, y: 0.5 });
  assert.equal(result.changed, false);
  assert.equal(result.next, state);
  const nullResult = patchTypeBReviewEndpoint(state, "side_end", null);
  assert.equal(nullResult.changed, false);
  assert.equal(nullResult.next, state);
});

// --- 9. Direct edits re-derive facts + qualification through B1 -------------

test("9: a direct edit re-derives facts and qualification through B1", () => {
  const state = begunWithSeams();
  // Move the rear end to make rear + side share a visible junction endpoint.
  const edited = patchTypeBReviewEndpoint(state, "rear_start", { x: 0.2, y: 0.8 }).next;
  const facts = deriveTypeBGeometryFacts({
    sourceFrame: FRAME,
    rearSeam: edited.rearSeam,
    strongSideSeam: edited.strongSideSeam,
  });
  assert.equal(facts.sharedJunctionPresent, true);
  const q = qualifyTypeBEvidence({
    family: "rear_seam_plus_strong_side_seam",
    sourceFrame: FRAME,
    rearSeam: edited.rearSeam,
    strongSideSeam: edited.strongSideSeam,
    latentNearCornerCondition: "not_needed_visible",
    typeAContext: "type_a_exhausted_handoff_candidate",
    geometryFacts: facts,
  });
  // A well-formed declaration flows through the committed classifier unchanged.
  assert.ok(
    q.status === "type_b_diagnostic_eligible" || q.status === "type_b_evidence_candidate"
  );
});

// --- 10. Edits never touch non-seam review fields ---------------------------

test("10: an endpoint edit preserves all non-targeted review fields", () => {
  const state = begunWithSeams();
  const { next } = patchTypeBReviewEndpoint(state, "rear_end", { x: 0.5, y: 0.5 });
  assert.equal(next.family, state.family);
  assert.equal(next.begun, state.begun);
  assert.equal(next.sourceImageIdentity, state.sourceImageIdentity);
  assert.equal(next.sourceFrameKey, state.sourceFrameKey);
  assert.equal(next.candidateIdentity, state.candidateIdentity);
  assert.equal(next.floorPolygonKey, state.floorPolygonKey);
  assert.equal(next.latentNearCornerCondition, state.latentNearCornerCondition);
});

test("10b: the patch never mutates its input state", () => {
  const state = begunWithSeams();
  const snapshot = structuredClone(state);
  patchTypeBReviewEndpoint(state, "rear_start", { x: 0.9, y: 0.1 });
  patchTypeBReviewEndpoint(state, "side_end", { x: 0.5, y: 0.5 });
  assert.deepEqual(state, snapshot);
});

// --- 11. Clear / invalidation cancels armed placement -----------------------

test("11: a cleared/invalidated review cancels an armed placement target", () => {
  const armed: TypeBPlacementTarget = "rear_start";
  assert.equal(resolveTypeBPlacementTargetAfterReconcile(armed, true), null);
  // An unchanged (non-cleared) review keeps the armed target.
  assert.equal(resolveTypeBPlacementTargetAfterReconcile(armed, false), armed);

  // Integration: a geometry-basis change clears the review (declarations gone),
  // which the component uses to cancel placement.
  const state = begunWithSeams();
  const changed = computeTypeBReviewGeometryContext({ ...CTX_A, candidateId: "cand-2" });
  const r = reconcileTypeBReviewGeometry(state, changed);
  assert.equal(r.cleared, true);
  assert.equal(resolveTypeBPlacementTargetAfterReconcile("side_end", r.cleared), null);
});

// --- 13. No inferred endpoint / extension / corner / quadrilateral ----------

test("13: placed/dragged edits produce only declared segments (no inference)", () => {
  const state = beginTypeBReview(contextA());
  // Place only the rear start; nothing else is inferred/created.
  const afterStart = patchTypeBReviewEndpoint(state, "rear_start", { x: 0.3, y: 0.7 }).next;
  // The rear seam exists with a conservative default other endpoint (declared,
  // not inferred); the side seam remains absent.
  const segments = buildTypeBDeclaredSegments(afterStart.rearSeam, afterStart.strongSideSeam);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].role, "rear");
  // No junction is invented from a single seam.
  assert.equal(
    findTypeBSharedJunctionEndpoints(afterStart.rearSeam, afterStart.strongSideSeam),
    null
  );
});

// --- 14. Interaction is inactive when review has not begun ------------------
// The pure helper has no notion of "begun"; the component gates ALL Type B
// interaction on review.begun. This asserts the empty/not-begun baseline the
// component keys off of.

test("14: an empty (not-begun) review carries no declarations to interact with", () => {
  const empty = createEmptyTypeBReviewState();
  assert.equal(empty.begun, false);
  assert.equal(empty.rearSeam, null);
  assert.equal(empty.strongSideSeam, null);
  assert.equal(buildTypeBDeclaredSegments(empty.rearSeam, empty.strongSideSeam).length, 0);
});
