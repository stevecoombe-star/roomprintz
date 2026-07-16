// --- Phase B3A: Type B evaluator contract unit tests ------------------------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST Type B
// evaluator CONTRACT. B3A is a pure vocabulary phase: these tests exercise the
// two pure helpers (canonical junction tolerance + exact basis-staleness
// comparison), pin the required schema/family/formula identifiers, and use
// compile-valid fixtures to prove the frozen snapshot + exact one-latent tuple
// can be declared from copied evidence with no live-state references. There is
// no solver, tuple generation, FOV scan, UI, preview, load, Apply, or
// calibration mutation anywhere in the contract module or these tests.

import assert from "node:assert/strict";
import test from "node:test";

import * as contract from "./type-b-evaluator-contract";
import {
  TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MAX_PX,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MIN_PX,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_RATIO,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
  TYPE_B_PLAUSIBILITY_CHECK_IDS,
  TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
  TYPE_B_PROVISIONAL_MIN_LATENT_DEPTH_PRODUCT,
  TYPE_B_PROVISIONAL_MIN_WORLD_TRIANGLE_ANGLE_DEG,
  compareTypeBEvidenceSnapshotBasis,
  isTypeBLatentDepthProductConditioned,
  makeTypeBLatentDepthEquivalenceClassKey,
  makeTypeBPoseProbeEquivalenceKey,
  resolveTypeBEvaluatorJunctionTolerancePx,
  resolveTypeBLatentDepthProduct,
  type TypeBDeclaredEndpointRole,
  type TypeBDiagnosticRecord,
  type TypeBDiagnosticRefusalReason,
  type TypeBDiagnosticTuple,
  type TypeBEndpointRoleCaptureRefusalReason,
  type TypeBEvidenceSnapshot,
  type TypeBEvidenceSnapshotBasis,
  type TypeBFrozenEndpointRoleMap,
  type TypeBLatentDepthEquivalenceClass,
  type TypeBPlausibilityCheckId,
  type TypeBPlausibilityObservation,
  type TypeBPoseHypothesis,
  type TypeBPoseProbeEquivalence,
} from "./type-b-evaluator-contract";

// --- Fixtures ---------------------------------------------------------------

function basis(
  overrides: Partial<TypeBEvidenceSnapshotBasis> = {}
): TypeBEvidenceSnapshotBasis {
  return {
    sourceImageIdentity: "room-a.jpg",
    sourceFrameKey: "1000x1000",
    sourceFrame: { width: 1000, height: 1000 },
    candidateIdentity: "cand-1",
    floorPolygonKey: "0.100000,0.900000;0.900000,0.900000",
    ...overrides,
  };
}

// A representative frozen snapshot declared from ONLY: B1-eligible context, one
// latent side condition, one evaluator family, copied source/basis evidence, and
// canonical frozen junction evidence. No live React/UI references anywhere.
function snapshotFixture(): TypeBEvidenceSnapshot {
  return {
    schema: TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    evidenceFamily: "rear_seam_plus_strong_side_seam",
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    basis: basis(),
    rearSeam: {
      role: "rear_floor_wall_seam",
      startNorm: { x: 0.2, y: 0.8 },
      endNorm: { x: 0.6, y: 0.8 },
      startEndpointStatus: "visible",
      endEndpointStatus: "visible",
      startFrameContact: "no_frame_contact",
      endFrameContact: "no_frame_contact",
      occlusionStatus: "none_observed",
      notes: "rear seam",
    },
    strongSideSeam: {
      role: "side_wall_floor_seam",
      startNorm: { x: 0.2, y: 0.8 },
      endNorm: { x: 0.15, y: 0.35 },
      startEndpointStatus: "visible",
      endEndpointStatus: "frame_truncated",
      startFrameContact: "no_frame_contact",
      endFrameContact: "contacts_frame",
      occlusionStatus: "none_observed",
    },
    latentNearCornerCondition: "frame_truncated",
    floorAssumptions: {
      worldWidth: 1,
      authorizedAspectRatios: [0.8, 1.0, 1.3],
    },
    typeAContext: "type_a_exhausted_handoff_candidate",
    b1Qualification: {
      status: "type_b_diagnostic_eligible",
      blockingReasons: [],
      advisoryReasons: [],
      evidenceSummary: {
        rearSeamUsable: true,
        strongSideSeamUsable: true,
        rearSideRelationshipUsable: true,
        latentNearCornerBounded: true,
        cropInterpretationUsable: true,
      },
    },
    junction: {
      distanceSourcePx: 0,
      toleranceFormulaId: TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
      resolvedToleranceSourcePx: 20,
      established: true,
    },
    endpointRoles: {
      resolutionRuleId: TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
      junctionRearEndpoint: "start",
      junctionSideEndpoint: "start",
    },
    capturedAtIso: "2026-07-01T00:00:00.000Z",
  };
}

// --- 1-4. Canonical junction tolerance --------------------------------------

test("1: canonical tolerance resolves to 8 px at the lower clamp", () => {
  // 0.02 * 100 = 2, clamped up to the 8 px floor.
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 100, height: 100 }),
    8
  );
});

test("2: canonical tolerance resolves to 20 px for a 1000 x 1000 frame", () => {
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 1000, height: 1000 }),
    20
  );
  // Uses min(width, height): a wide frame still resolves off the shorter side.
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 4000, height: 1000 }),
    20
  );
});

test("3: canonical tolerance resolves to 24 px at the upper clamp", () => {
  // 0.02 * 2000 = 40, clamped down to the 24 px ceiling.
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 2000, height: 2000 }),
    24
  );
});

test("4: invalid / missing / non-finite / non-positive frames return null", () => {
  assert.equal(resolveTypeBEvaluatorJunctionTolerancePx(null), null);
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({
      width: Number.NaN,
      height: 1000,
    }),
    null
  );
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({
      width: 1000,
      height: Number.POSITIVE_INFINITY,
    }),
    null
  );
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 0, height: 1000 }),
    null
  );
  assert.equal(
    resolveTypeBEvaluatorJunctionTolerancePx({ width: 1000, height: -5 }),
    null
  );
});

// --- 5-11. Snapshot-basis staleness comparison ------------------------------

test("5: basis comparison reports fresh for exact equality", () => {
  const result = compareTypeBEvidenceSnapshotBasis(basis(), basis());
  assert.equal(result.kind, "fresh");
  assert.deepEqual(result.staleFields, []);
});

test("6: source-image mismatch reports only source_image_identity", () => {
  const result = compareTypeBEvidenceSnapshotBasis(
    basis(),
    basis({ sourceImageIdentity: "room-b.jpg" })
  );
  assert.equal(result.kind, "stale");
  assert.equal(
    result.kind === "stale" ? result.reason : null,
    "evidence_snapshot_stale"
  );
  assert.deepEqual(result.staleFields, ["source_image_identity"]);
});

test("7: source-frame mismatch reports only source_frame", () => {
  const result = compareTypeBEvidenceSnapshotBasis(
    basis(),
    basis({ sourceFrameKey: "800x600" })
  );
  assert.equal(result.kind, "stale");
  assert.deepEqual(result.staleFields, ["source_frame"]);
});

test("8: candidate mismatch reports only candidate_identity", () => {
  const result = compareTypeBEvidenceSnapshotBasis(
    basis(),
    basis({ candidateIdentity: "cand-2" })
  );
  assert.equal(result.kind, "stale");
  assert.deepEqual(result.staleFields, ["candidate_identity"]);
});

test("9: polygon mismatch reports only floor_polygon", () => {
  const result = compareTypeBEvidenceSnapshotBasis(
    basis(),
    basis({ floorPolygonKey: "different" })
  );
  assert.equal(result.kind, "stale");
  assert.deepEqual(result.staleFields, ["floor_polygon"]);
});

test("10: multiple mismatches return in stable declared order", () => {
  const result = compareTypeBEvidenceSnapshotBasis(
    basis(),
    basis({
      floorPolygonKey: "different",
      sourceImageIdentity: "room-b.jpg",
      candidateIdentity: "cand-2",
      sourceFrameKey: "800x600",
    })
  );
  assert.equal(result.kind, "stale");
  assert.deepEqual(result.staleFields, [
    "source_image_identity",
    "source_frame",
    "candidate_identity",
    "floor_polygon",
  ]);
});

test("11: basis comparison does not mutate either input", () => {
  const a = basis();
  const b = basis({ candidateIdentity: "cand-2" });
  const aSnapshot = structuredClone(a);
  const bSnapshot = structuredClone(b);
  compareTypeBEvidenceSnapshotBasis(a, b);
  assert.deepEqual(a, aSnapshot);
  assert.deepEqual(b, bSnapshot);
});

// --- 12. Required identifiers -----------------------------------------------

test("12: required identifiers equal the exact agreed values", () => {
  assert.equal(
    TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    "vibode-type-b-evidence-snapshot/v1"
  );
  assert.equal(TYPE_B_EVALUATOR_FAMILY, "rear_points_side_line_one_latent");
  assert.equal(
    TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
    "min_dim_ratio_clamped/v0"
  );
  assert.equal(TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_RATIO, 0.02);
  assert.equal(TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MIN_PX, 8);
  assert.equal(TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MAX_PX, 24);
});

// --- 13. Representative snapshot fixture ------------------------------------

test("13: a representative Type B snapshot fixture is declarable + self-consistent", () => {
  const snapshot = snapshotFixture();
  // Both family identifiers are present and distinct concepts.
  assert.equal(snapshot.evidenceFamily, "rear_seam_plus_strong_side_seam");
  assert.equal(snapshot.evaluatorFamily, "rear_points_side_line_one_latent");
  assert.notEqual(snapshot.evidenceFamily, snapshot.evaluatorFamily);
  // One authorized latent side condition; hard exhausted-handoff precondition.
  assert.equal(snapshot.latentNearCornerCondition, "frame_truncated");
  assert.equal(snapshot.typeAContext, "type_a_exhausted_handoff_candidate");
  // B1 fingerprint carries eligibility with no blocking reasons.
  assert.equal(snapshot.b1Qualification.status, "type_b_diagnostic_eligible");
  assert.deepEqual(snapshot.b1Qualification.blockingReasons, []);
  // Frozen junction stores the resolved tolerance beside the formula identity.
  assert.equal(
    snapshot.junction.toleranceFormulaId,
    TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA
  );
  assert.equal(snapshot.junction.established, true);
  assert.equal(
    snapshot.junction.resolvedToleranceSourcePx,
    resolveTypeBEvaluatorJunctionTolerancePx(snapshot.basis.sourceFrame)
  );
  // The captured basis is fresh against itself.
  assert.equal(
    compareTypeBEvidenceSnapshotBasis(snapshot.basis, snapshot.basis).kind,
    "fresh"
  );
  // B3D-R: the frozen endpoint-role map is present and reproducible.
  assert.equal(
    snapshot.endpointRoles.resolutionRuleId,
    TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE
  );
  assert.equal(snapshot.endpointRoles.junctionRearEndpoint, "start");
  assert.equal(snapshot.endpointRoles.junctionSideEndpoint, "start");
});

// --- 14. Representative exact tuple -----------------------------------------

test("14: a representative exact tuple contains only the four authorized fields", () => {
  const tuple: TypeBDiagnosticTuple = {
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    latentSideExtent: 0.6,
    floorAspectRatio: 1.0,
    fovProbeDeg: 55,
  };
  assert.deepEqual(Object.keys(tuple).sort(), [
    "evaluatorFamily",
    "floorAspectRatio",
    "fovProbeDeg",
    "latentSideExtent",
  ]);
  // The aspect must later be one of the snapshot's authorized ratios (contract
  // intent; not enforced by B3A). This asserts the fixture is consistent.
  assert.ok(
    snapshotFixture().floorAssumptions.authorizedAspectRatios.includes(
      tuple.floorAspectRatio
    )
  );
});

// --- 15. No solver / React / UI / calibration runtime surface ---------------

test("15: the contract module's runtime surface is only pure constants + helpers", () => {
  // Types are erased at runtime; the ONLY runtime exports are the identifier /
  // constant values and the pure helpers (B3A + the B3B-R additions). Any
  // accidental solver / React / UI / calibration runtime import would surface as
  // an extra export here.
  const runtimeKeys = Object.keys(contract).sort();
  assert.deepEqual(runtimeKeys, [
    "TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE",
    "TYPE_B_EVALUATOR_FAMILY",
    "TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA",
    "TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MAX_PX",
    "TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_MIN_PX",
    "TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_RATIO",
    "TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA",
    "TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA",
    "TYPE_B_PLAUSIBILITY_CHECK_IDS",
    "TYPE_B_POSE_COMPARISON_REFERENCE_FRAME",
    "TYPE_B_PROVISIONAL_MIN_LATENT_DEPTH_PRODUCT",
    "TYPE_B_PROVISIONAL_MIN_WORLD_TRIANGLE_ANGLE_DEG",
    "compareTypeBEvidenceSnapshotBasis",
    "isTypeBLatentDepthProductConditioned",
    "makeTypeBLatentDepthEquivalenceClassKey",
    "makeTypeBPoseProbeEquivalenceKey",
    "resolveTypeBEvaluatorJunctionTolerancePx",
    "resolveTypeBLatentDepthProduct",
  ]);
  assert.equal(typeof resolveTypeBEvaluatorJunctionTolerancePx, "function");
  assert.equal(typeof compareTypeBEvidenceSnapshotBasis, "function");
  assert.equal(typeof resolveTypeBLatentDepthProduct, "function");
  assert.equal(typeof isTypeBLatentDepthProductConditioned, "function");
  assert.equal(typeof makeTypeBLatentDepthEquivalenceClassKey, "function");
  assert.equal(typeof makeTypeBPoseProbeEquivalenceKey, "function");
});

// --- B3B-R: latent-depth product identifiability contract -------------------

test("B3B-R 1: latent-depth product formula identifier is exact", () => {
  assert.equal(
    TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
    "latent_side_extent_times_floor_aspect_ratio/v0"
  );
});

test("B3B-R 2: junction-anchored reference-frame identifier is exact", () => {
  assert.equal(TYPE_B_POSE_COMPARISON_REFERENCE_FRAME, "junction_anchored/v0");
});

test("B3B-R 3: provisional world-triangle angle constant is 12", () => {
  assert.equal(TYPE_B_PROVISIONAL_MIN_WORLD_TRIANGLE_ANGLE_DEG, 12);
});

test("B3B-R 4: provisional product threshold equals tan(12 deg)", () => {
  const expected = Math.tan((12 * Math.PI) / 180);
  assert.ok(
    Math.abs(TYPE_B_PROVISIONAL_MIN_LATENT_DEPTH_PRODUCT - expected) < 1e-12
  );
});

test("B3B-R 5: valid product derivation returns exact product + formula id", () => {
  const product = resolveTypeBLatentDepthProduct(0.5, 1.5);
  assert.ok(product !== null);
  assert.equal(product.formulaId, TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA);
  assert.equal(product.value, 0.75);
});

test("B3B-R 6: constant-product member pairs derive equal product values", () => {
  const a = resolveTypeBLatentDepthProduct(0.5, 1.5);
  const b = resolveTypeBLatentDepthProduct(0.75, 1.0);
  assert.ok(a !== null && b !== null);
  assert.equal(a.value, 0.75);
  assert.equal(b.value, 0.75);
  assert.equal(a.value, b.value);
});

test("B3B-R 7: non-finite, zero, negative, and >1 extent inputs return null", () => {
  assert.equal(resolveTypeBLatentDepthProduct(Number.NaN, 1.0), null);
  assert.equal(
    resolveTypeBLatentDepthProduct(0.5, Number.POSITIVE_INFINITY),
    null
  );
  assert.equal(resolveTypeBLatentDepthProduct(0, 1.0), null);
  assert.equal(resolveTypeBLatentDepthProduct(-0.2, 1.0), null);
  assert.equal(resolveTypeBLatentDepthProduct(1.0001, 1.0), null);
  // floorAspectRatio must be strictly positive.
  assert.equal(resolveTypeBLatentDepthProduct(0.5, 0), null);
  assert.equal(resolveTypeBLatentDepthProduct(0.5, -1.0), null);
  // Upper extent bound is inclusive of exactly 1.
  const atOne = resolveTypeBLatentDepthProduct(1, 0.8);
  assert.ok(atOne !== null);
  assert.equal(atOne.value, 0.8);
});

test("B3B-R 8: product conditioning accepts the threshold and above", () => {
  const atThreshold = {
    formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
    value: TYPE_B_PROVISIONAL_MIN_LATENT_DEPTH_PRODUCT,
  } as const;
  assert.equal(isTypeBLatentDepthProductConditioned(atThreshold), true);
  const above = resolveTypeBLatentDepthProduct(0.75, 1.0); // 0.75 >> tan(12)
  assert.ok(above !== null);
  assert.equal(isTypeBLatentDepthProductConditioned(above), true);
});

test("B3B-R 9: product conditioning rejects below-threshold, null, non-finite", () => {
  const below = {
    formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
    value: TYPE_B_PROVISIONAL_MIN_LATENT_DEPTH_PRODUCT - 1e-6,
  } as const;
  assert.equal(isTypeBLatentDepthProductConditioned(below), false);
  assert.equal(isTypeBLatentDepthProductConditioned(null), false);
  assert.equal(
    isTypeBLatentDepthProductConditioned({
      formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
      value: Number.NaN,
    }),
    false
  );
});

test("B3B-R 10: equivalence-class key helper is deterministic + null-guarded", () => {
  const a = makeTypeBLatentDepthEquivalenceClassKey("p=0.750000");
  const b = makeTypeBLatentDepthEquivalenceClassKey("p=0.750000");
  assert.equal(a, b);
  assert.ok(typeof a === "string" && a.length > 0);
  // Namespaced under the product formula (not fuzzy).
  assert.ok(a.startsWith(`${TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA}#`));
  // Invalid identities return null.
  assert.equal(makeTypeBLatentDepthEquivalenceClassKey(""), null);
  assert.equal(makeTypeBLatentDepthEquivalenceClassKey("   "), null);
});

test("B3B-R 11: pose-probe key helper is deterministic for exact class + FOV", () => {
  const classKey = makeTypeBLatentDepthEquivalenceClassKey("p=0.750000");
  assert.ok(classKey !== null);
  const a = makeTypeBPoseProbeEquivalenceKey(classKey, 55);
  const b = makeTypeBPoseProbeEquivalenceKey(classKey, 55);
  assert.equal(a, b);
  assert.ok(typeof a === "string" && a.length > 0);
  // Different FOV probes yield different keys.
  assert.notEqual(a, makeTypeBPoseProbeEquivalenceKey(classKey, 56));
});

test("B3B-R 12: invalid class / FOV input returns null", () => {
  assert.equal(makeTypeBPoseProbeEquivalenceKey("", 55), null);
  assert.equal(makeTypeBPoseProbeEquivalenceKey("   ", 55), null);
  assert.equal(makeTypeBPoseProbeEquivalenceKey("class", Number.NaN), null);
  assert.equal(
    makeTypeBPoseProbeEquivalenceKey("class", Number.POSITIVE_INFINITY),
    null
  );
});

test("B3B-R 13: no key helper performs fuzzy near-equality grouping", () => {
  // Near-equal but distinct explicit identities must NOT collapse to one key.
  const near1 = makeTypeBLatentDepthEquivalenceClassKey("0.75");
  const near2 = makeTypeBLatentDepthEquivalenceClassKey("0.7500000001");
  assert.notEqual(near1, near2);
  // Near-equal but distinct exact FOV probes must NOT collapse to one key.
  const classKey = makeTypeBLatentDepthEquivalenceClassKey("p=0.750000");
  assert.ok(classKey !== null);
  assert.notEqual(
    makeTypeBPoseProbeEquivalenceKey(classKey, 55),
    makeTypeBPoseProbeEquivalenceKey(classKey, 55.0000001)
  );
});

test("B3B-R 14: a future diagnostic record requires both equivalence fields", () => {
  const product = resolveTypeBLatentDepthProduct(0.5, 1.5);
  assert.ok(product !== null);
  const classKey = makeTypeBLatentDepthEquivalenceClassKey("p=0.750000");
  assert.ok(classKey !== null);
  const latentDepthEquivalence: TypeBLatentDepthEquivalenceClass = {
    formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
    latentDepthProduct: product,
    equivalenceClassKey: classKey,
    poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
  };
  const probeKey = makeTypeBPoseProbeEquivalenceKey(classKey, 55);
  assert.ok(probeKey !== null);
  const poseProbeEquivalence: TypeBPoseProbeEquivalence = {
    latentDepthEquivalenceClassKey: classKey,
    fovProbeDeg: 55,
    poseProbeEquivalenceKey: probeKey,
  };
  const record: TypeBDiagnosticRecord = {
    snapshotSchema: TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    evidenceFamily: "rear_seam_plus_strong_side_seam",
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    tuple: {
      evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
      latentSideExtent: 0.5,
      floorAspectRatio: 1.5,
      fovProbeDeg: 55,
    },
    latentDepthEquivalence,
    poseProbeEquivalence,
    poseStageResult: { kind: "pose_hypotheses", hypotheses: [] },
    constructionObservations: [],
    probeClassification: "not_evaluated",
    fovCorridors: null,
    refusalReasons: [],
  };
  // Both equivalence groupings are present and internally consistent.
  assert.equal(record.latentDepthEquivalence.latentDepthProduct.value, 0.75);
  assert.equal(
    record.latentDepthEquivalence.poseComparisonReferenceFrame,
    "junction_anchored/v0"
  );
  assert.equal(
    record.poseProbeEquivalence.latentDepthEquivalenceClassKey,
    record.latentDepthEquivalence.equivalenceClassKey
  );
  assert.equal(record.poseProbeEquivalence.fovProbeDeg, 55);
});

test("B3B-R 15: TypeBDiagnosticTuple still has exactly its four runtime keys", () => {
  const tuple: TypeBDiagnosticTuple = {
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    latentSideExtent: 0.5,
    floorAspectRatio: 1.5,
    fovProbeDeg: 55,
  };
  assert.deepEqual(Object.keys(tuple).sort(), [
    "evaluatorFamily",
    "floorAspectRatio",
    "fovProbeDeg",
    "latentSideExtent",
  ]);
});

// --- B3D-R: contract amendment ---------------------------------------------

test("B3D-R 1: endpoint-role resolution rule identifier is exact", () => {
  assert.equal(
    TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
    "closest_declared_endpoint_pair_non_tied/v0"
  );
});

test("B3D-R 2: a frozen endpoint-role map is declarable + preserves roles", () => {
  const roles: TypeBFrozenEndpointRoleMap = {
    resolutionRuleId: TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
    junctionRearEndpoint: "start",
    junctionSideEndpoint: "end",
  };
  assert.equal(roles.resolutionRuleId, TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE);
  assert.equal(roles.junctionRearEndpoint, "start");
  assert.equal(roles.junctionSideEndpoint, "end");
  // The snapshot fixture carries the map and it is fresh against itself.
  const snapshot = snapshotFixture();
  assert.equal(
    snapshot.endpointRoles.resolutionRuleId,
    TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE
  );
});

test("B3D-R 3: endpoint-role values allow only start / end", () => {
  const values: TypeBDeclaredEndpointRole[] = ["start", "end"];
  assert.deepEqual(values.sort(), ["end", "start"]);
  // Every allowed role is usable in both junction positions.
  for (const role of values) {
    const roles: TypeBFrozenEndpointRoleMap = {
      resolutionRuleId: TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
      junctionRearEndpoint: role,
      junctionSideEndpoint: role,
    };
    assert.ok(
      roles.junctionRearEndpoint === "start" ||
        roles.junctionRearEndpoint === "end"
    );
  }
});

test("B3D-R 4: capture-refusal vocabulary is exact + exhaustive", () => {
  // An exhaustive mapping over the union: adding/removing a literal would fail
  // the compile-time exhaustiveness of this record's key set.
  const documented: Record<TypeBEndpointRoleCaptureRefusalReason, true> = {
    junction_endpoint_pair_tied: true,
    junction_endpoint_not_position_certain: true,
    non_junction_rear_endpoint_not_position_certain: true,
    side_terminus_not_latent: true,
  };
  assert.deepEqual(Object.keys(documented).sort(), [
    "junction_endpoint_not_position_certain",
    "junction_endpoint_pair_tied",
    "non_junction_rear_endpoint_not_position_certain",
    "side_terminus_not_latent",
  ]);
});

test("B3D-R 5: a pose hypothesis requires the junction-anchored frame", () => {
  const hypothesis: TypeBPoseHypothesis = {
    hypothesisIndex: 0,
    poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
    cameraPositionWorld: { x: 0.45, y: 1.3, z: 1.6 },
    worldToCameraRotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    constructionObservations: [],
    plausibility: [],
  };
  assert.equal(
    hypothesis.poseComparisonReferenceFrame,
    "junction_anchored/v0"
  );
  // hypothesisIndex is an enumeration index, not a rank.
  assert.equal(hypothesis.hypothesisIndex, 0);
});

test("B3D-R 6: plausibility registry values are exact", () => {
  assert.deepEqual(TYPE_B_PLAUSIBILITY_CHECK_IDS, {
    rotationNumericalHealth: "rotation_numerical_health/v0",
    imageRayConditioning: "image_ray_conditioning/v0",
    cameraAboveFloor: "camera_above_floor/v0",
    cameraNearSideOfRearSeam: "camera_near_side_of_rear_seam/v0",
    rootSeparation: "root_separation/v0",
  });
});

test("B3D-R 7: a plausibility observation accepts every registry check id", () => {
  const ids: TypeBPlausibilityCheckId[] = Object.values(
    TYPE_B_PLAUSIBILITY_CHECK_IDS
  );
  const observations: TypeBPlausibilityObservation[] = ids.map((checkId) => ({
    checkId,
    state: "not_evaluated",
  }));
  assert.equal(observations.length, 5);
  for (const observation of observations) {
    assert.ok(
      Object.values(TYPE_B_PLAUSIBILITY_CHECK_IDS).includes(observation.checkId)
    );
    assert.equal(observation.state, "not_evaluated");
  }
});

test("B3D-R 8: the two new diagnostic refusal literals are available", () => {
  const refusals: TypeBDiagnosticRefusalReason[] = [
    "invalid_tuple_generation_linkage",
    "fov_topology_unresolved",
  ];
  assert.deepEqual(refusals, [
    "invalid_tuple_generation_linkage",
    "fov_topology_unresolved",
  ]);
  // The existing corridor/run-scope multiplicity literal is still available and
  // is NOT replaced by a new branch-association literal.
  const multiplicity: TypeBDiagnosticRefusalReason =
    "pose_multiplicity_unresolved";
  assert.equal(multiplicity, "pose_multiplicity_unresolved");
});
