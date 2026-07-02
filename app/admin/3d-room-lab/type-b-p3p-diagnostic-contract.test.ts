// --- Phase B3D-R: Type B P3P Diagnostic Contract unit tests -----------------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST Type B P3P
// diagnostic CONTRACT. B3D-R is a pure vocabulary phase: these tests pin the
// three schema constants, prove the future-only topology / root-census /
// pose-probe / member-link / branch-corridor / run-record shapes are declarable
// from copied evidence, and prove NO ranking / score / confidence / selection
// field exists. There is NO P3P solver, quartic solve, root finding, pose
// evaluation, FOV execution, topology validation, branch association, corridor
// construction, crop test, UI, preview, load, Apply, or calibration anywhere.

import assert from "node:assert/strict";
import test from "node:test";

import {
  TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
  TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
  makeTypeBLatentDepthEquivalenceClassKey,
  makeTypeBPoseProbeEquivalenceKey,
  type TypeBEvidenceSnapshot,
  type TypeBLatentDepthEquivalenceClass,
  type TypeBLatentDepthProduct,
  type TypeBPoseProbeEquivalence,
  type TypeBPoseStageResult,
} from "./type-b-evaluator-contract";
import * as diagnostic from "./type-b-p3p-diagnostic-contract";
import {
  TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA,
  TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA,
  TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
  type TypeBBranchAssociationAnnotation,
  type TypeBBranchAssociationState,
  type TypeBBranchFovCorridor,
  type TypeBBranchPoseProbeRootReference,
  type TypeBFovProbeTopologyDeclaration,
  type TypeBMemberCompatibilityRecord,
  type TypeBP3pDiagnosticRunRecord,
  type TypeBP3pRootCensus,
  type TypeBPoseProbeDiagnosticRecord,
} from "./type-b-p3p-diagnostic-contract";
import {
  generateTypeBBoundedDiagnosticTuples,
  type TypeBTupleGenerationCoverage,
} from "./type-b-tuple-generation";

// --- B3C input fixtures (inline; used only to build real B3C output echoes) --

function makeSnapshotFixture(): TypeBEvidenceSnapshot {
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
  };
}

function makeProductClass(identity: string, value: number) {
  return {
    primaryProductClassIdentity: identity,
    latentDepthProduct: {
      formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
      value,
    },
  } as const;
}

function makeCoverage(
  overrides: Partial<TypeBTupleGenerationCoverage> = {}
): TypeBTupleGenerationCoverage {
  return {
    primaryProductClasses: [makeProductClass("p-0.75", 0.75)],
    fovProbesDeg: [30, 60],
    ...overrides,
  };
}

// --- Shared fixtures --------------------------------------------------------

const CLASS_KEY = makeTypeBLatentDepthEquivalenceClassKey("p-0.75");
if (CLASS_KEY === null) throw new Error("class key fixture must be non-null");

const PRODUCT: TypeBLatentDepthProduct = {
  formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
  value: 0.75,
};

const LATENT_DEPTH_EQUIVALENCE: TypeBLatentDepthEquivalenceClass = {
  formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
  latentDepthProduct: PRODUCT,
  equivalenceClassKey: CLASS_KEY,
  poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
};

function poseProbeEquivalence(fovProbeDeg: number): TypeBPoseProbeEquivalence {
  const key = makeTypeBPoseProbeEquivalenceKey(CLASS_KEY as string, fovProbeDeg);
  if (key === null) throw new Error("pose-probe key fixture must be non-null");
  return {
    latentDepthEquivalenceClassKey: CLASS_KEY as string,
    fovProbeDeg,
    poseProbeEquivalenceKey: key,
  };
}

// A deeply-walked forbidden-token guard (mirrors the B3C generation test).
function assertNoForbiddenKeys(value: unknown): void {
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
    "preferred",
  ];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === "object") {
      for (const key of Object.keys(node)) {
        const lower = key.toLowerCase();
        for (const bad of forbidden) {
          assert.ok(
            !lower.includes(bad),
            `key "${key}" must not contain forbidden token "${bad}"`
          );
        }
        walk((node as Record<string, unknown>)[key]);
      }
    }
  };
  walk(value);
}

// --- 1. Schema constants ----------------------------------------------------

test("1: the three B3D schema constants equal their exact values", () => {
  assert.equal(TYPE_B_P3P_DIAGNOSTIC_SCHEMA, "vibode-type-b-p3p-diagnostic/v0");
  assert.equal(
    TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA,
    "vibode-type-b-fov-probe-topology/v0"
  );
  assert.equal(
    TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA,
    "vibode-type-b-branch-fov-corridor/v0"
  );
});

// --- 2. Topology declaration ------------------------------------------------

test("2: topology declaration preserves caller order + step with no normalization", () => {
  // Deliberately non-monotonic + sparse: B3D-R must store it verbatim (it does
  // NOT validate, sort, insert, or infer).
  const topology: TypeBFovProbeTopologyDeclaration = {
    schema: TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA,
    orderedProbesDeg: [24, 20, 22],
    stepDeg: 2,
  };
  assert.deepEqual(topology.orderedProbesDeg, [24, 20, 22]);
  assert.equal(topology.stepDeg, 2);
  assert.equal(topology.schema, TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA);
});

// --- 3. Root census ---------------------------------------------------------

test("3: a root census retains four independent counts", () => {
  const census: TypeBP3pRootCensus = {
    algebraicCandidateCount: 4,
    realRootCount: 3,
    positiveDistanceRootCount: 2,
    deduplicatedRootCount: 2,
  };
  assert.equal(census.algebraicCandidateCount, 4);
  assert.equal(census.realRootCount, 3);
  assert.equal(census.positiveDistanceRootCount, 2);
  assert.equal(census.deduplicatedRootCount, 2);
  // The counts are independent, not derived from one another.
  assert.notEqual(census.algebraicCandidateCount, census.realRootCount);
});

// --- 4. Pose-probe diagnostic record ----------------------------------------

test("4: a pose-probe diagnostic record carries equivalence + exact product + all-root result", () => {
  const poseStageResult: TypeBPoseStageResult = {
    kind: "pose_hypotheses",
    hypotheses: [
      {
        hypothesisIndex: 0,
        poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
        cameraPositionWorld: { x: 0.45, y: 1.3, z: 1.6 },
        worldToCameraRotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        constructionObservations: [],
        plausibility: [],
      },
      {
        hypothesisIndex: 1,
        poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
        cameraPositionWorld: { x: -0.5, y: 1.1, z: -0.8 },
        worldToCameraRotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        constructionObservations: [],
        plausibility: [],
      },
    ],
  };
  const record: TypeBPoseProbeDiagnosticRecord = {
    poseProbeEquivalence: poseProbeEquivalence(50),
    latentDepthEquivalence: LATENT_DEPTH_EQUIVALENCE,
    latentDepthProduct: PRODUCT,
    poseStageResult,
    rootCensus: {
      algebraicCandidateCount: 2,
      realRootCount: 2,
      positiveDistanceRootCount: 2,
      deduplicatedRootCount: 2,
    },
  };
  // Product identity is the EXACT class value (never recomputed).
  assert.equal(record.latentDepthProduct.value, 0.75);
  assert.equal(
    record.latentDepthEquivalence.latentDepthProduct.value,
    record.latentDepthProduct.value
  );
  // All roots are present and unranked (plural hypotheses).
  assert.equal(record.poseStageResult.kind, "pose_hypotheses");
  if (record.poseStageResult.kind === "pose_hypotheses") {
    assert.equal(record.poseStageResult.hypotheses.length, 2);
  }
  assertNoForbiddenKeys(record);
});

test("4b: a pose-probe diagnostic record can carry a typed pose-stage refusal", () => {
  const record: TypeBPoseProbeDiagnosticRecord = {
    poseProbeEquivalence: poseProbeEquivalence(50),
    latentDepthEquivalence: LATENT_DEPTH_EQUIVALENCE,
    latentDepthProduct: PRODUCT,
    poseStageResult: { kind: "refusal", reason: "pose_stage_cheirality_failed" },
    rootCensus: {
      algebraicCandidateCount: 2,
      realRootCount: 2,
      positiveDistanceRootCount: 0,
      deduplicatedRootCount: 0,
    },
  };
  assert.equal(record.poseStageResult.kind, "refusal");
  assertNoForbiddenKeys(record);
});

// --- 5. Member compatibility link record ------------------------------------

test("5: a member link carries crop state + key reference, no pose/root/branch field", () => {
  const link: TypeBMemberCompatibilityRecord = {
    primaryProductClassIdentity: "p-0.75",
    floorAspectRatio: 1.0,
    latentSideExtent: 0.75,
    cropCompatibility: "not_evaluated",
    poseProbeEquivalenceKey: poseProbeEquivalence(50).poseProbeEquivalenceKey,
  };
  assert.deepEqual(Object.keys(link).sort(), [
    "cropCompatibility",
    "floorAspectRatio",
    "latentSideExtent",
    "poseProbeEquivalenceKey",
    "primaryProductClassIdentity",
  ]);
  // Structurally cannot hold a pose / root / branch / rank field.
  assert.ok(!("pose" in link));
  assert.ok(!("hypothesisIndex" in link));
  assert.ok(!("branchIndex" in link));
  assertNoForbiddenKeys(link);
});

// --- 6. Association-state vocabulary ----------------------------------------

test("6: association-state vocabulary is exact + exhaustive", () => {
  const documented: Record<TypeBBranchAssociationState, true> = {
    associated: true,
    tied_ambiguous: true,
    unmatched_terminated: true,
    unmatched_born: true,
    near_coincident_unresolved: true,
  };
  assert.deepEqual(Object.keys(documented).sort(), [
    "associated",
    "near_coincident_unresolved",
    "tied_ambiguous",
    "unmatched_born",
    "unmatched_terminated",
  ]);
});

// --- 7. Branch corridor -----------------------------------------------------

test("7: a branch corridor carries references + annotations, no confidence/rank field", () => {
  const from: TypeBBranchPoseProbeRootReference = {
    poseProbeEquivalenceKey: poseProbeEquivalence(20).poseProbeEquivalenceKey,
    fovProbeDeg: 20,
    hypothesisIndex: 0,
  };
  const to: TypeBBranchPoseProbeRootReference = {
    poseProbeEquivalenceKey: poseProbeEquivalence(22).poseProbeEquivalenceKey,
    fovProbeDeg: 22,
    hypothesisIndex: 0,
  };
  const annotation: TypeBBranchAssociationAnnotation = {
    from,
    to,
    state: "associated",
  };
  const corridor: TypeBBranchFovCorridor = {
    schema: TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA,
    branchIndex: 0,
    poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
    poseProbeRootReferences: [from, to],
    associationAnnotations: [annotation],
  };
  assert.equal(corridor.schema, TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA);
  assert.equal(corridor.poseProbeRootReferences.length, 2);
  assert.equal(corridor.associationAnnotations.length, 1);
  assert.equal(
    corridor.poseComparisonReferenceFrame,
    "junction_anchored/v0"
  );
  // No confidence / highConfidence field exists on the branch corridor.
  assert.ok(!("highConfidence" in corridor));
  assert.ok(!("confidence" in corridor));
  assertNoForbiddenKeys(corridor);
});

test("7b: a branch corridor allows a singleton branch (one reference, no annotations)", () => {
  const only: TypeBBranchPoseProbeRootReference = {
    poseProbeEquivalenceKey: poseProbeEquivalence(50).poseProbeEquivalenceKey,
    fovProbeDeg: 50,
    hypothesisIndex: 0,
  };
  const corridor: TypeBBranchFovCorridor = {
    schema: TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA,
    branchIndex: 3,
    poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
    poseProbeRootReferences: [only],
    associationAnnotations: [],
  };
  assert.equal(corridor.poseProbeRootReferences.length, 1);
  assert.deepEqual(corridor.associationAnnotations, []);
});

// --- 8. Branch index is an enumeration, not a preference --------------------

test("8: branchIndex is a stable enumeration label, not a preference/rank", () => {
  const corridors: TypeBBranchFovCorridor[] = [0, 1, 2].map((branchIndex) => ({
    schema: TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA,
    branchIndex,
    poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
    poseProbeRootReferences: [],
    associationAnnotations: [],
  }));
  // Indices are exactly the enumeration order; a higher index implies nothing.
  assert.deepEqual(
    corridors.map((c) => c.branchIndex),
    [0, 1, 2]
  );
});

// --- 9. Run record can echo B3C refused class facts -------------------------

test("9: a run record echoes B3C refused-class facts without repair", () => {
  // A conditioned run whose single class is below the provisional threshold: the
  // RUN is "generated" but the class is "refused". B3D must echo this verbatim.
  const belowThreshold = 0.05;
  const tupleGeneration = generateTypeBBoundedDiagnosticTuples(
    makeSnapshotFixture(),
    makeCoverage({
      primaryProductClasses: [makeProductClass("p-tiny", belowThreshold)],
    })
  );
  assert.equal(tupleGeneration.status, "generated");
  assert.equal(tupleGeneration.productClasses[0].status, "refused");

  const run: TypeBP3pDiagnosticRunRecord = {
    schema: TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
    snapshotBasis: tupleGeneration.snapshotBasis,
    tupleGeneration,
    poseProbeResults: [],
    memberCompatibilityRecords: [],
    branchCorridors: [],
    fovTopology: null,
    refusalReasons: [],
  };
  // The echoed B3C facts are preserved exactly (no regenerate / reorder / repair).
  assert.deepEqual(run.tupleGeneration, tupleGeneration);
  assert.equal(run.tupleGeneration.productClasses[0].status, "refused");
  assert.deepEqual(run.tupleGeneration.productClasses[0].refusalReasons, [
    "latent_depth_product_not_conditioned",
  ]);
  assertNoForbiddenKeys(run);
});

// --- 10. fovTopology: null alongside per-probe diagnostics ------------------

test("10: fovTopology null is valid alongside per-probe diagnostic records", () => {
  const tupleGeneration = generateTypeBBoundedDiagnosticTuples(
    makeSnapshotFixture(),
    makeCoverage()
  );
  const run: TypeBP3pDiagnosticRunRecord = {
    schema: TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
    snapshotBasis: tupleGeneration.snapshotBasis,
    tupleGeneration,
    poseProbeResults: [
      {
        poseProbeEquivalence: poseProbeEquivalence(30),
        latentDepthEquivalence: LATENT_DEPTH_EQUIVALENCE,
        latentDepthProduct: PRODUCT,
        poseStageResult: { kind: "pose_hypotheses", hypotheses: [] },
        rootCensus: {
          algebraicCandidateCount: 0,
          realRootCount: 0,
          positiveDistanceRootCount: 0,
          deduplicatedRootCount: 0,
        },
      },
    ],
    memberCompatibilityRecords: [],
    branchCorridors: [],
    // Corridor formation not assessed; per-probe diagnostics remain valid.
    fovTopology: null,
    refusalReasons: ["fov_topology_unresolved"],
  };
  assert.equal(run.fovTopology, null);
  assert.equal(run.poseProbeResults.length, 1);
  assert.ok(run.refusalReasons.includes("fov_topology_unresolved"));
  assertNoForbiddenKeys(run);
});

// --- 11. Runtime surface ----------------------------------------------------

test("11: runtime exports are limited to the three schema constants", () => {
  const runtimeKeys = Object.keys(diagnostic).sort();
  assert.deepEqual(runtimeKeys, [
    "TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA",
    "TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA",
    "TYPE_B_P3P_DIAGNOSTIC_SCHEMA",
  ]);
  assert.equal(typeof TYPE_B_P3P_DIAGNOSTIC_SCHEMA, "string");
  assert.equal(typeof TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA, "string");
  assert.equal(typeof TYPE_B_BRANCH_FOV_CORRIDOR_SCHEMA, "string");
});
