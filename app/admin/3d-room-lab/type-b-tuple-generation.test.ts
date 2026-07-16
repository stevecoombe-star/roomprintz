// --- Phase B3C: Pure Bounded Type B Tuple Generation unit tests -------------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST bounded Type B
// tuple GENERATOR. B3C consumes one frozen snapshot + one caller coverage
// envelope and enumerates the identifiable PRODUCT axis first, then derives
// aspect members and pairs each with exact FOV probes. These tests prove exact
// declared ordering, product-equivalence identity sharing, class-level vs
// coverage-wide refusal, deferred crop/occlusion state, no mutation, exact
// tuple shape, and a solver-free / FOV-scan-free / UI-free / browser-free
// runtime surface. There is NO pose evaluation anywhere.

import assert from "node:assert/strict";
import test from "node:test";

import {
  TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
  TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
  TYPE_B_PROVISIONAL_MIN_LATENT_DEPTH_PRODUCT,
  makeTypeBLatentDepthEquivalenceClassKey,
  makeTypeBPoseProbeEquivalenceKey,
  type TypeBEvidenceSnapshot,
} from "./type-b-evaluator-contract";
import * as generation from "./type-b-tuple-generation";
import {
  TYPE_B_FOV_PROBE_MAX_DEG,
  TYPE_B_FOV_PROBE_MIN_DEG,
  TYPE_B_TUPLE_GENERATION_SCHEMA,
  generateTypeBBoundedDiagnosticTuples,
  type TypeBTupleGenerationCoverage,
} from "./type-b-tuple-generation";

// --- Fixtures ---------------------------------------------------------------

function snapshotFixture(
  overrides: Partial<TypeBEvidenceSnapshot> = {}
): TypeBEvidenceSnapshot {
  return {
    schema: TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    evidenceFamily: "rear_seam_plus_strong_side_seam",
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    basis: {
      sourceImageIdentity: "room-a.jpg",
      sourceFrameKey: "1000x1000",
      sourceFrame: { width: 1000, height: 1000 },
      candidateIdentity: "cand-1",
      floorPolygonKey: "0.100000,0.900000;0.900000,0.900000",
    },
    rearSeam: {
      role: "rear_floor_wall_seam",
      startNorm: { x: 0.2, y: 0.8 },
      endNorm: { x: 0.6, y: 0.8 },
      startEndpointStatus: "visible",
      endEndpointStatus: "visible",
      startFrameContact: "no_frame_contact",
      endFrameContact: "no_frame_contact",
      occlusionStatus: "none_observed",
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
    ...overrides,
  };
}

function productClass(identity: string, value: number) {
  return {
    primaryProductClassIdentity: identity,
    latentDepthProduct: {
      formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
      value,
    },
  } as const;
}

function coverage(
  overrides: Partial<TypeBTupleGenerationCoverage> = {}
): TypeBTupleGenerationCoverage {
  return {
    primaryProductClasses: [productClass("p-0.75", 0.75)],
    fovProbesDeg: [30, 60],
    ...overrides,
  };
}

// --- 1. Deterministic records in declared order -----------------------------

test("1: valid single class + aspects + two probes generate declared-order records", () => {
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage()
  );
  assert.equal(result.schema, TYPE_B_TUPLE_GENERATION_SCHEMA);
  assert.equal(result.status, "generated");
  assert.deepEqual(result.refusalReasons, []);
  assert.equal(result.productClasses.length, 1);

  const [cls] = result.productClasses;
  assert.equal(cls.status, "generated");
  // Members preserve snapshot authorizedAspectRatios order exactly.
  assert.deepEqual(
    cls.members.map((m) => m.floorAspectRatio),
    [0.8, 1.0, 1.3]
  );
  // Every member preserves exact fovProbesDeg order.
  for (const member of cls.members) {
    assert.deepEqual(
      member.tuples.map((t) => t.tuple.fovProbeDeg),
      [30, 60]
    );
  }
  assert.deepEqual(result.summary, {
    requestedPrimaryProductClassCount: 1,
    generatedPrimaryProductClassCount: 1,
    refusedPrimaryProductClassCount: 0,
    generatedAspectMemberCount: 3,
    generatedTupleCount: 6,
  });
});

// --- 2. Exact extent = product / aspect -------------------------------------

test("2: generated extent equals exact product / aspect", () => {
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage()
  );
  const [cls] = result.productClasses;
  for (const member of cls.members) {
    assert.equal(member.latentSideExtent, 0.75 / member.floorAspectRatio);
    for (const record of member.tuples) {
      assert.equal(record.tuple.latentSideExtent, 0.75 / member.floorAspectRatio);
    }
  }
});

// --- 3. Multiple members, one shared latent-depth equivalence identity -------

test("3: one class -> multiple members sharing one latent-depth equivalence", () => {
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage()
  );
  const [cls] = result.productClasses;
  if (cls.status !== "generated") throw new Error("expected a generated class");
  assert.ok(cls.members.length > 1);
  const classKey = cls.latentDepthEquivalence.equivalenceClassKey;
  // Semantic identity is the DETERMINISTIC key from the committed helper, not a
  // shared JavaScript object reference.
  assert.equal(classKey, makeTypeBLatentDepthEquivalenceClassKey("p-0.75"));
  // Every tuple across every member shares the SAME class equivalence identity
  // by deterministic key + deep value equality (never by reference identity).
  for (const member of cls.members) {
    for (const record of member.tuples) {
      assert.equal(record.latentDepthEquivalence.equivalenceClassKey, classKey);
      assert.deepEqual(
        record.latentDepthEquivalence,
        cls.latentDepthEquivalence
      );
    }
  }
});

// --- 4. Same class + same FOV share one pose-probe equivalence ---------------

test("4: same class + same FOV share one pose-probe equivalence across members", () => {
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage()
  );
  const [cls] = result.productClasses;
  if (cls.status !== "generated") throw new Error("expected a generated class");
  const classKey = cls.latentDepthEquivalence.equivalenceClassKey;
  const memberA = cls.members[0];
  const memberB = cls.members[1];
  // At the same probe index (same exact FOV) the pose-probe equivalence identity
  // is shared across DISTINCT aspect members by DETERMINISTIC key + deep value
  // equality (never by reference identity): common pose geometry, not two poses.
  for (let i = 0; i < memberA.tuples.length; i += 1) {
    const fov = memberA.tuples[i].tuple.fovProbeDeg;
    const expectedKey = makeTypeBPoseProbeEquivalenceKey(classKey, fov);
    assert.equal(
      memberA.tuples[i].poseProbeEquivalence.poseProbeEquivalenceKey,
      expectedKey
    );
    assert.equal(
      memberB.tuples[i].poseProbeEquivalence.poseProbeEquivalenceKey,
      expectedKey
    );
    assert.deepEqual(
      memberA.tuples[i].poseProbeEquivalence,
      memberB.tuples[i].poseProbeEquivalence
    );
  }
  // Different FOV probes yield different pose-probe identities.
  assert.notEqual(
    memberA.tuples[0].poseProbeEquivalence.poseProbeEquivalenceKey,
    memberA.tuples[1].poseProbeEquivalence.poseProbeEquivalenceKey
  );
});

// --- 5. Constant-product members are not separate primary classes ------------

test("5: constant-product members are NOT emitted as separate primary classes", () => {
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage()
  );
  // Exactly ONE primary product class though it yields three aspect members.
  assert.equal(result.productClasses.length, 1);
  assert.equal(result.productClasses[0].members.length, 3);
  assert.equal(result.summary.generatedPrimaryProductClassCount, 1);
});

// --- 6. Exact duplicate primary product values refuse the run ---------------

test("6: exact duplicate primary product values refuse (no fuzzy grouping)", () => {
  const dup = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      primaryProductClasses: [
        productClass("p-a", 0.75),
        productClass("p-b", 0.75),
      ],
    })
  );
  assert.equal(dup.status, "refused");
  assert.ok(dup.refusalReasons.includes("duplicate_primary_latent_depth_product"));
  assert.deepEqual(dup.productClasses, []);

  // Near-equal but DISTINCT values are not merged: the run generates.
  const near = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      primaryProductClasses: [
        productClass("p-a", 0.75),
        productClass("p-b", 0.7500000001),
      ],
    })
  );
  assert.equal(near.status, "generated");
  assert.equal(near.productClasses.length, 2);
});

// --- 7. Invalid primary product formula/value -> class-level refusal ---------

test("7: invalid primary product formula/value creates class-level refusal", () => {
  const badFormula = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      primaryProductClasses: [
        {
          primaryProductClassIdentity: "p-bad-formula",
          latentDepthProduct: {
            // Intentionally wrong formula identity (cast for the malformed case).
            formulaId: "not_the_formula/v0",
            value: 0.75,
          },
        } as unknown as ReturnType<typeof productClass>,
      ],
    })
  );
  assert.equal(badFormula.status, "generated");
  assert.equal(badFormula.productClasses.length, 1);
  assert.equal(badFormula.productClasses[0].status, "refused");
  assert.deepEqual(badFormula.productClasses[0].refusalReasons, [
    "invalid_primary_product_class",
  ]);
  assert.equal(badFormula.productClasses[0].latentDepthEquivalence, null);
  assert.deepEqual(badFormula.productClasses[0].members, []);
  assert.equal(badFormula.summary.refusedPrimaryProductClassCount, 1);

  const badValue = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      primaryProductClasses: [
        {
          primaryProductClassIdentity: "p-bad-value",
          latentDepthProduct: {
            formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
            value: Number.NaN,
          },
        },
      ],
    })
  );
  assert.equal(badValue.status, "generated");
  assert.equal(badValue.productClasses[0].status, "refused");
  assert.deepEqual(badValue.productClasses[0].refusalReasons, [
    "invalid_primary_product_class",
  ]);
});

// --- 8. Product below provisional threshold -> class-level refusal -----------

test("8: below-threshold product creates class-level not_conditioned refusal", () => {
  const belowValue = TYPE_B_PROVISIONAL_MIN_LATENT_DEPTH_PRODUCT / 2;
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      primaryProductClasses: [productClass("p-tiny", belowValue)],
    })
  );
  assert.equal(result.status, "generated");
  assert.equal(result.productClasses[0].status, "refused");
  assert.deepEqual(result.productClasses[0].refusalReasons, [
    "latent_depth_product_not_conditioned",
  ]);
  // A below-threshold but otherwise valid class still carries its identity.
  assert.ok(result.productClasses[0].latentDepthEquivalence !== null);
  assert.deepEqual(result.productClasses[0].members, []);
});

// --- 9. Conditioned product, no permitted aspect -> class-level refusal ------

test("9: conditioned product with no permitted aspect refuses at class level", () => {
  // 2.0 / any authorized aspect (<= 1.3) is > 1, so no member is permitted.
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      primaryProductClasses: [productClass("p-too-big", 2.0)],
    })
  );
  assert.equal(result.status, "generated");
  assert.equal(result.productClasses[0].status, "refused");
  assert.deepEqual(result.productClasses[0].refusalReasons, [
    "no_authorized_aspect_member_for_product_class",
  ]);
  assert.deepEqual(result.productClasses[0].members, []);
});

// --- 10. Only 0 < product/aspect <= 1 aspects become members ----------------

test("10: only aspects satisfying 0 < product/aspect <= 1 become members", () => {
  // product 0.9: aspect 0.8 -> 1.125 (>1, excluded); 1.0 -> 0.9; 1.3 -> ~0.692.
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      primaryProductClasses: [productClass("p-0.9", 0.9)],
    })
  );
  const [cls] = result.productClasses;
  assert.equal(cls.status, "generated");
  assert.deepEqual(
    cls.members.map((m) => m.floorAspectRatio),
    [1.0, 1.3]
  );
  for (const member of cls.members) {
    assert.ok(member.latentSideExtent > 0 && member.latentSideExtent <= 1);
  }
});

// --- 11. frame_truncated -> not_evaluated crop state -------------------------

test("11: frame_truncated snapshot yields not_evaluated crop state on all members", () => {
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture({ latentNearCornerCondition: "frame_truncated" }),
    coverage()
  );
  const [cls] = result.productClasses;
  assert.ok(cls.members.length > 0);
  for (const member of cls.members) {
    assert.equal(member.cropCompatibility, "not_evaluated");
  }
});

// --- 12. occluded -> not_applicable crop state ------------------------------

test("12: occluded snapshot yields not_applicable crop state on all members", () => {
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture({ latentNearCornerCondition: "occluded" }),
    coverage()
  );
  const [cls] = result.productClasses;
  assert.ok(cls.members.length > 0);
  for (const member of cls.members) {
    assert.equal(member.cropCompatibility, "not_applicable");
  }
});

// --- 13. Empty / invalid / duplicate authorized aspects refuse the run -------

test("13: empty / invalid / duplicate authorized aspects refuse the run", () => {
  const empty = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture({
      floorAssumptions: { worldWidth: 1, authorizedAspectRatios: [] },
    }),
    coverage()
  );
  assert.equal(empty.status, "refused");
  assert.ok(empty.refusalReasons.includes("no_authorized_aspect_ratios"));

  const invalid = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture({
      floorAssumptions: { worldWidth: 1, authorizedAspectRatios: [0.8, -1] },
    }),
    coverage()
  );
  assert.equal(invalid.status, "refused");
  assert.ok(invalid.refusalReasons.includes("invalid_floor_assumptions"));

  const dup = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture({
      floorAssumptions: { worldWidth: 1, authorizedAspectRatios: [0.8, 0.8] },
    }),
    coverage()
  );
  assert.equal(dup.status, "refused");
  assert.ok(dup.refusalReasons.includes("duplicate_authorized_aspect_ratio"));

  const badWidth = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture({
      floorAssumptions: { worldWidth: 0, authorizedAspectRatios: [0.8, 1.0] },
    }),
    coverage()
  );
  assert.equal(badWidth.status, "refused");
  assert.ok(badWidth.refusalReasons.includes("invalid_floor_assumptions"));
});

// --- 14. Empty / invalid / out-of-range / duplicate FOV coverage refuses -----

test("14: empty / invalid / out-of-range / duplicate FOV coverage refuses", () => {
  const empty = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({ fovProbesDeg: [] })
  );
  assert.equal(empty.status, "refused");
  assert.ok(empty.refusalReasons.includes("no_fov_probes"));

  const nonFinite = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({ fovProbesDeg: [30, Number.POSITIVE_INFINITY] })
  );
  assert.equal(nonFinite.status, "refused");
  assert.ok(nonFinite.refusalReasons.includes("invalid_fov_probe"));

  const belowRange = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({ fovProbesDeg: [TYPE_B_FOV_PROBE_MIN_DEG - 1] })
  );
  assert.equal(belowRange.status, "refused");
  assert.ok(belowRange.refusalReasons.includes("invalid_fov_probe"));

  const aboveRange = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({ fovProbesDeg: [TYPE_B_FOV_PROBE_MAX_DEG + 1] })
  );
  assert.equal(aboveRange.status, "refused");
  assert.ok(aboveRange.refusalReasons.includes("invalid_fov_probe"));

  const dup = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({ fovProbesDeg: [45, 45] })
  );
  assert.equal(dup.status, "refused");
  assert.ok(dup.refusalReasons.includes("duplicate_fov_probe"));

  // Inclusive bounds exactly at 20 and 90 are accepted.
  const inclusive = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      fovProbesDeg: [TYPE_B_FOV_PROBE_MIN_DEG, TYPE_B_FOV_PROBE_MAX_DEG],
    })
  );
  assert.equal(inclusive.status, "generated");
});

// --- 15. Blank / duplicate class identities refuse the run ------------------

test("15: blank / duplicate class identities refuse the run", () => {
  const blank = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      primaryProductClasses: [productClass("   ", 0.75)],
    })
  );
  assert.equal(blank.status, "refused");
  assert.ok(blank.refusalReasons.includes("invalid_primary_product_class"));

  const dup = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      primaryProductClasses: [
        productClass("same", 0.75),
        productClass("same", 0.9),
      ],
    })
  );
  assert.equal(dup.status, "refused");
  assert.ok(
    dup.refusalReasons.includes("duplicate_primary_product_class_identity")
  );

  const none = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({ primaryProductClasses: [] })
  );
  assert.equal(none.status, "refused");
  assert.ok(none.refusalReasons.includes("no_primary_product_classes"));
});

// --- 16. No mutation of snapshot / coverage / nested inputs ------------------

test("16: generation preserves snapshot + coverage inputs without mutation", () => {
  const snapshot = snapshotFixture();
  const cov = coverage({
    primaryProductClasses: [
      productClass("p-0.75", 0.75),
      productClass("p-0.9", 0.9),
    ],
    fovProbesDeg: [30, 60, 90],
  });
  const snapshotClone = structuredClone(snapshot);
  const covClone = structuredClone(cov);
  generateTypeBBoundedDiagnosticTuples(snapshot, cov);
  assert.deepEqual(snapshot, snapshotClone);
  assert.deepEqual(cov, covClone);
});

// --- 17. Tuple has exactly the four authorized fields -----------------------

test("17: no tuple includes fields beyond the four-field tuple contract", () => {
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage()
  );
  for (const cls of result.productClasses) {
    for (const member of cls.members) {
      for (const record of member.tuples) {
        assert.deepEqual(Object.keys(record.tuple).sort(), [
          "evaluatorFamily",
          "floorAspectRatio",
          "fovProbeDeg",
          "latentSideExtent",
        ]);
      }
    }
  }
});

// --- 18. Solver-free / FOV-scan-free / UI-free runtime surface --------------

test("18: module runtime surface is only pure constants + the generator", () => {
  const runtimeKeys = Object.keys(generation).sort();
  assert.deepEqual(runtimeKeys, [
    "TYPE_B_FOV_PROBE_MAX_DEG",
    "TYPE_B_FOV_PROBE_MIN_DEG",
    "TYPE_B_TUPLE_GENERATION_SCHEMA",
    "generateTypeBBoundedDiagnosticTuples",
  ]);
  assert.equal(typeof generateTypeBBoundedDiagnosticTuples, "function");
  assert.equal(TYPE_B_FOV_PROBE_MIN_DEG, 20);
  assert.equal(TYPE_B_FOV_PROBE_MAX_DEG, 90);
  assert.equal(
    TYPE_B_TUPLE_GENERATION_SCHEMA,
    "vibode-type-b-tuple-generation/v0"
  );
});

// --- 19. Repeat invocation is deeply equal ----------------------------------

test("19: repeat invocation with identical inputs is deeply equal", () => {
  const snapshot = snapshotFixture();
  const cov = coverage({
    primaryProductClasses: [
      productClass("p-0.75", 0.75),
      productClass("p-2.0", 2.0),
      productClass("p-tiny", TYPE_B_PROVISIONAL_MIN_LATENT_DEPTH_PRODUCT / 2),
    ],
    fovProbesDeg: [30, 60],
  });
  const a = generateTypeBBoundedDiagnosticTuples(snapshot, cov);
  const b = generateTypeBBoundedDiagnosticTuples(snapshot, cov);
  assert.deepEqual(a, b);
});

// --- 20. No ranking / score / selection / preview / load / Apply fields ------

test("20: no generated result carries ranking/score/selection/preview fields", () => {
  const result = generateTypeBBoundedDiagnosticTuples(
    snapshotFixture(),
    coverage({
      primaryProductClasses: [
        productClass("p-0.75", 0.75),
        productClass("p-0.9", 0.9),
      ],
      fovProbesDeg: [30, 60],
    })
  );

  // NOTE: `pose*` equivalence identities are legitimate B3B-R grouping fields
  // (common pose GEOMETRY, not a pose result), so they are intentionally not
  // forbidden. The forbidden set is exactly the spec's ranking/selection/
  // preview/load/Apply family.
  const forbidden = [
    "rank",
    "ranking",
    "score",
    "confidence",
    "winner",
    "best",
    "selected",
    "selection",
    "recommend",
    "recommendation",
    "preview",
    "load",
    "apply",
  ];

  const seenKeys = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
        seenKeys.add(key.toLowerCase());
        walk((value as Record<string, unknown>)[key]);
      }
    }
  };
  walk(result);

  for (const key of seenKeys) {
    for (const bad of forbidden) {
      assert.ok(
        !key.includes(bad),
        `result key "${key}" must not contain forbidden token "${bad}"`
      );
    }
  }
});

// --- 21-24. Invalid snapshot-contract coverage-wide refusal -----------------

// Assert a malformed snapshot refuses the whole run with invalid_snapshot_contract,
// throws nothing, empties productClasses, and leaves the input snapshot unchanged.
function assertInvalidSnapshotContract(snapshot: TypeBEvidenceSnapshot): void {
  const snapshotClone = structuredClone(snapshot);
  const cov = coverage();
  const covClone = structuredClone(cov);
  const result = generateTypeBBoundedDiagnosticTuples(snapshot, cov);
  assert.equal(result.status, "refused");
  assert.ok(result.refusalReasons.includes("invalid_snapshot_contract"));
  assert.deepEqual(result.productClasses, []);
  // Inputs are not mutated by the refusal path.
  assert.deepEqual(snapshot, snapshotClone);
  assert.deepEqual(cov, covClone);
}

test("21: wrong snapshot schema refuses the run with invalid_snapshot_contract", () => {
  const snapshot = {
    ...snapshotFixture(),
    schema: "vibode-type-b-evidence-snapshot/vX",
  } as unknown as TypeBEvidenceSnapshot;
  assertInvalidSnapshotContract(snapshot);
});

test("22: wrong evidence family refuses the run with invalid_snapshot_contract", () => {
  const snapshot = {
    ...snapshotFixture(),
    evidenceFamily: "some_other_evidence_family",
  } as unknown as TypeBEvidenceSnapshot;
  assertInvalidSnapshotContract(snapshot);
});

test("23: wrong evaluator family refuses the run with invalid_snapshot_contract", () => {
  const snapshot = {
    ...snapshotFixture(),
    evaluatorFamily: "some_other_evaluator_family",
  } as unknown as TypeBEvidenceSnapshot;
  assertInvalidSnapshotContract(snapshot);
});

test("24: invalid latent near-corner condition refuses the run", () => {
  // Anything outside { frame_truncated, occluded } is refused (here the excluded
  // B1 literal `not_needed_visible`).
  const snapshot = {
    ...snapshotFixture(),
    latentNearCornerCondition: "not_needed_visible",
  } as unknown as TypeBEvidenceSnapshot;
  assertInvalidSnapshotContract(snapshot);
});
