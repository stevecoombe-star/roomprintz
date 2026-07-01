// --- Phase B2: Type B evidence-review helper unit tests ---------------------
// Pure unit tests (node:test) for the lab-only Type B Operator Evidence Panel
// state helper. These verify lifecycle, invalidation, the read-only Type A
// context mapping, safe coordinate normalization, and declared-only overlay
// geometry. They also confirm facts/qualification flow through the committed B1
// modules unchanged, and that no inference/extension is produced.

import assert from "node:assert/strict";
import test from "node:test";

import { deriveTypeBGeometryFacts } from "./type-b-evidence-facts";
import type {
  TypeBDeclaredLineEvidence,
  TypeBSourceFrame,
} from "./type-b-evidence-types";
import { qualifyTypeBEvidence } from "./type-b-qualification";
import {
  applyDeclaredLinePatch,
  beginTypeBReview,
  buildTypeBDeclaredSegments,
  computeTypeBReviewGeometryContext,
  createEmptyTypeBReviewState,
  findTypeBSharedJunctionEndpoints,
  isTypeBReviewActive,
  mapTypeATypeBContext,
  reconcileTypeBReviewGeometry,
  sanitizeNormComponent,
  TYPE_B_REVIEW_FAMILY,
} from "./type-b-evidence-review";

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
    endEndpointStatus: "visible",
    startFrameContact: "no_frame_contact",
    endFrameContact: "no_frame_contact",
    occlusionStatus: "none_observed",
    operatorDeclared: true,
  };
}

function sideHealthy(): TypeBDeclaredLineEvidence {
  return {
    role: "side_floor_boundary",
    startNorm: { x: 0.2, y: 0.8 },
    endNorm: { x: 0.2, y: 0.4 },
    startEndpointStatus: "visible",
    endEndpointStatus: "visible",
    startFrameContact: "no_frame_contact",
    endFrameContact: "no_frame_contact",
    occlusionStatus: "none_observed",
    operatorDeclared: true,
  };
}

// --- 1. Initial state --------------------------------------------------------

test("1: initial review state has no declared evidence", () => {
  const s = createEmptyTypeBReviewState();
  assert.equal(s.family, TYPE_B_REVIEW_FAMILY);
  assert.equal(s.begun, false);
  assert.equal(s.rearSeam, null);
  assert.equal(s.strongSideSeam, null);
  assert.equal(s.latentNearCornerCondition, "unresolved");
  assert.equal(isTypeBReviewActive(s), false);
});

// --- 2. Begin does not create points or infer geometry ----------------------

test("2: beginning review creates no points and infers no geometry", () => {
  const s = beginTypeBReview(contextA());
  assert.equal(s.begun, true);
  assert.equal(s.rearSeam, null);
  assert.equal(s.strongSideSeam, null);
  assert.equal(s.latentNearCornerCondition, "unresolved");
  assert.equal(s.sourceImageIdentity, "room-a.jpg");
  assert.equal(s.candidateIdentity, "cand-1");
  assert.equal(isTypeBReviewActive(s), true);
});

// --- 3. Rear declaration remains explicit and local -------------------------

test("3: rear declaration is explicit and role-pinned", () => {
  const rear = applyDeclaredLinePatch(null, "rear_floor_wall_seam", {
    startNorm: { x: 0.2, y: 0.8 },
  });
  assert.equal(rear.role, "rear_floor_wall_seam");
  assert.deepEqual(rear.startNorm, { x: 0.2, y: 0.8 });
  assert.equal(rear.operatorDeclared, true);
  // Role stays pinned even if a patch tries to change it.
  const rear2 = applyDeclaredLinePatch(rear, "rear_floor_wall_seam", {
    role: "side_floor_boundary",
  });
  assert.equal(rear2.role, "rear_floor_wall_seam");
});

// --- 4. Side declaration remains explicit and operator-declared -------------

test("4: side declaration keeps the operator-declared role", () => {
  const side = applyDeclaredLinePatch(null, null, {
    role: "side_wall_floor_seam",
    endNorm: { x: 0.2, y: 0.4 },
  });
  assert.equal(side.role, "side_wall_floor_seam");
  assert.deepEqual(side.endNorm, { x: 0.2, y: 0.4 });
  assert.equal(side.operatorDeclared, true);
});

// --- 5 & 6. Facts + qualification flow through the committed B1 modules ------

test("5: facts derive from declarations through the B1 helper", () => {
  const facts = deriveTypeBGeometryFacts({
    sourceFrame: FRAME,
    rearSeam: rearHealthy(),
    strongSideSeam: sideHealthy(),
  });
  assert.ok(Math.abs((facts.rearSpanSourcePx ?? 0) - 400) < 1e-6);
  assert.equal(facts.sharedJunctionPresent, true);
});

test("6: qualification derives through the B1 classifier", () => {
  const facts = deriveTypeBGeometryFacts({
    sourceFrame: FRAME,
    rearSeam: rearHealthy(),
    strongSideSeam: sideHealthy(),
  });
  const result = qualifyTypeBEvidence({
    family: "rear_seam_plus_strong_side_seam",
    sourceFrame: FRAME,
    rearSeam: rearHealthy(),
    strongSideSeam: sideHealthy(),
    latentNearCornerCondition: "not_needed_visible",
    typeAContext: "type_a_exhausted_handoff_candidate",
    geometryFacts: facts,
  });
  assert.equal(result.status, "type_b_diagnostic_eligible");
});

// --- 7. Type A context change re-evaluates without clearing declarations -----

test("7: Type A context change re-evaluates qualification but never clears declarations", () => {
  const state = { ...beginTypeBReview(contextA()), rearSeam: rearHealthy(), strongSideSeam: sideHealthy() };
  // Geometry basis unchanged => reconcile must NOT clear.
  const reconciled = reconcileTypeBReviewGeometry(state, contextA());
  assert.equal(reconciled.cleared, false);
  assert.equal(reconciled.next, state);

  const facts = deriveTypeBGeometryFacts({
    sourceFrame: FRAME,
    rearSeam: state.rearSeam,
    strongSideSeam: state.strongSideSeam,
  });
  const asExhausted = qualifyTypeBEvidence({
    family: "rear_seam_plus_strong_side_seam",
    sourceFrame: FRAME,
    rearSeam: state.rearSeam,
    strongSideSeam: state.strongSideSeam,
    latentNearCornerCondition: "not_needed_visible",
    typeAContext: "type_a_exhausted_handoff_candidate",
    geometryFacts: facts,
  });
  const asStrong = qualifyTypeBEvidence({
    family: "rear_seam_plus_strong_side_seam",
    sourceFrame: FRAME,
    rearSeam: state.rearSeam,
    strongSideSeam: state.strongSideSeam,
    latentNearCornerCondition: "not_needed_visible",
    typeAContext: "type_a_strong_support",
    geometryFacts: facts,
  });
  assert.equal(asExhausted.status, "type_b_diagnostic_eligible");
  assert.equal(asStrong.status, "type_a_investigation_preferred");
  // Declarations untouched by re-qualification.
  assert.deepEqual(state.rearSeam, rearHealthy());
  assert.deepEqual(state.strongSideSeam, sideHealthy());
});

// --- 8-11. Geometry-basis changes clear the review --------------------------

test("8: room image identity change clears the review", () => {
  const state = beginTypeBReview(contextA());
  const changed = computeTypeBReviewGeometryContext({ ...CTX_A, loadedImageUrl: "room-b.jpg" });
  const r = reconcileTypeBReviewGeometry(state, changed);
  assert.equal(r.cleared, true);
  assert.equal(r.next.begun, false);
  assert.equal(r.next.rearSeam, null);
});

test("9: source-frame dimension change clears the review", () => {
  const state = beginTypeBReview(contextA());
  const changed = computeTypeBReviewGeometryContext({ ...CTX_A, intrinsicSize: { width: 1200, height: 1000 } });
  const r = reconcileTypeBReviewGeometry(state, changed);
  assert.equal(r.cleared, true);
});

test("10: candidate change clears the review", () => {
  const state = beginTypeBReview(contextA());
  const changed = computeTypeBReviewGeometryContext({ ...CTX_A, candidateId: "cand-2" });
  const r = reconcileTypeBReviewGeometry(state, changed);
  assert.equal(r.cleared, true);
});

test("11: floor-polygon change clears the review", () => {
  const state = beginTypeBReview(contextA());
  const changed = computeTypeBReviewGeometryContext({
    ...CTX_A,
    floorPolygon: [
      { x: 0.15, y: 0.9 },
      { x: 0.9, y: 0.9 },
      { x: 0.8, y: 0.3 },
      { x: 0.2, y: 0.3 },
    ],
  });
  const r = reconcileTypeBReviewGeometry(state, changed);
  assert.equal(r.cleared, true);
});

// --- 12. Display-only resize does not clear ---------------------------------

test("12: display-only resize (no basis change) does not clear the review", () => {
  const state = { ...beginTypeBReview(contextA()), rearSeam: rearHealthy() };
  // Recomputing the identical geometry context (frame/display size is NOT part
  // of it) leaves the review untouched.
  const r = reconcileTypeBReviewGeometry(state, contextA());
  assert.equal(r.cleared, false);
  assert.equal(r.next, state);
});

// --- 13. Clear resets only the review state ---------------------------------

test("13: clearing returns an empty review state", () => {
  const cleared = createEmptyTypeBReviewState();
  assert.equal(cleared.begun, false);
  assert.equal(cleared.rearSeam, null);
  assert.equal(cleared.strongSideSeam, null);
  assert.equal(cleared.latentNearCornerCondition, "unresolved");
});

// --- Inactive review is never cleared (no-op reconcile) ----------------------

test("inactive review reconcile is a stable no-op", () => {
  const empty = createEmptyTypeBReviewState();
  const r = reconcileTypeBReviewGeometry(empty, computeTypeBReviewGeometryContext({ ...CTX_A, loadedImageUrl: "other.jpg" }));
  assert.equal(r.cleared, false);
  assert.equal(r.next, empty);
});

// --- Type A context mapping (read-only) -------------------------------------

test("Type A context mapping is truthful and read-only", () => {
  assert.equal(
    mapTypeATypeBContext("type_a_strong_support", "broad_search_usable_basin_found"),
    "type_a_strong_support"
  );
  assert.equal(
    mapTypeATypeBContext("type_a_strong_support", "broad_search_no_usable_basin_current_coverage"),
    "type_a_investigation_case"
  );
  assert.equal(
    mapTypeATypeBContext("type_a_weak_support", "broad_search_not_run_or_unknown"),
    "type_a_weak_support"
  );
  assert.equal(
    mapTypeATypeBContext("type_a_exhausted_type_b_candidate", "broad_search_no_usable_basin_current_coverage"),
    "type_a_exhausted_handoff_candidate"
  );
  assert.equal(
    mapTypeATypeBContext("qualification_not_run", "broad_search_not_run_or_unknown"),
    "type_a_not_run_or_unknown"
  );
  assert.equal(
    mapTypeATypeBContext("insufficient_support_or_unknown", "broad_search_not_run_or_unknown"),
    "type_a_not_run_or_unknown"
  );
});

// --- Safe coordinate normalization ------------------------------------------

test("coordinate normalization clamps to [0,1] and rejects non-finite", () => {
  assert.equal(sanitizeNormComponent(0.5), 0.5);
  assert.equal(sanitizeNormComponent(-0.2), 0);
  assert.equal(sanitizeNormComponent(1.7), 1);
  assert.equal(sanitizeNormComponent(Number.NaN), null);
  assert.equal(sanitizeNormComponent(Number.POSITIVE_INFINITY), null);
});

// --- 18 & 19. Overlay geometry is declared-only, no extension/inference ------

test("18: overlay segments are exactly the declared endpoints", () => {
  const rear = rearHealthy();
  const side = sideHealthy();
  const segments = buildTypeBDeclaredSegments(rear, side);
  assert.equal(segments.length, 2);
  const rearSeg = segments.find((s) => s.role === "rear");
  const sideSeg = segments.find((s) => s.role === "side");
  assert.deepEqual(rearSeg?.start, rear.startNorm);
  assert.deepEqual(rearSeg?.end, rear.endNorm);
  assert.deepEqual(sideSeg?.start, side.startNorm);
  assert.deepEqual(sideSeg?.end, side.endNorm);
});

test("19: no inferred off-frame corner or line extension is generated", () => {
  const rear = rearHealthy();
  const side = sideHealthy();
  // Shared-junction marker uses ONLY declared endpoints (never an intersection).
  const junction = findTypeBSharedJunctionEndpoints(rear, side);
  assert.ok(junction);
  const declared = [rear.startNorm, rear.endNorm, side.startNorm, side.endNorm];
  const isDeclared = (p: { x: number; y: number }) =>
    declared.some((d) => d.x === p.x && d.y === p.y);
  assert.ok(isDeclared(junction!.a));
  assert.ok(isDeclared(junction!.b));

  // Missing a seam yields no segments and no junction (nothing invented).
  assert.deepEqual(buildTypeBDeclaredSegments(null, side), [
    { role: "side", start: side.startNorm, end: side.endNorm },
  ]);
  assert.equal(findTypeBSharedJunctionEndpoints(null, side), null);
});

// --- No mutation of inputs ---------------------------------------------------

test("reconcile and patch never mutate their inputs", () => {
  const state = { ...beginTypeBReview(contextA()), rearSeam: rearHealthy() };
  const snapshot = structuredClone(state);
  reconcileTypeBReviewGeometry(state, contextA());
  reconcileTypeBReviewGeometry(state, computeTypeBReviewGeometryContext({ ...CTX_A, candidateId: "cand-x" }));
  assert.deepEqual(state, snapshot);

  const rear = rearHealthy();
  const rearSnapshot = structuredClone(rear);
  applyDeclaredLinePatch(rear, "rear_floor_wall_seam", { startNorm: { x: 0.3, y: 0.3 } });
  assert.deepEqual(rear, rearSnapshot);
});
