// --- Phase B3D-2: Pure Branch Association + Lattice-Aware FOV Corridor tests -
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST Type B branch
// association layer. Fixtures are LOCAL, minimal, B3D-1-compatible diagnostic
// run records built from hand-chosen junction-anchored pose hypotheses (no P3P
// solve, no random initialization, no live state). This layer never invokes
// P3P, ranks, selects, filters, or recommends anything.
//
// There is NO DLT / homography, four-corner reconstruction, crop test, UI,
// preview, load, Apply, calibration mutation, persistence, routing, or ranking
// anywhere in the module or these tests.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  TYPE_B_ENDPOINT_ROLE_RESOLUTION_RULE,
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVALUATOR_JUNCTION_TOLERANCE_FORMULA,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
  TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
  type TypeBEvidenceSnapshot,
  type TypeBPoseHypothesis,
  type TypeBPoseStageResult,
  type TypeBRotationMatrix3,
  type TypeBVec3,
} from "./type-b-evaluator-contract";
import {
  TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
  TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA,
  type TypeBFovProbeTopologyDeclaration,
  type TypeBP3pDiagnosticRunRecord,
  type TypeBPoseProbeDiagnosticRecord,
} from "./type-b-p3p-diagnostic-contract";
import {
  generateTypeBBoundedDiagnosticTuples,
  type TypeBTupleGenerationCoverage,
  type TypeBTupleGenerationResult,
} from "./type-b-tuple-generation";
import * as branchAssociationModule from "./type-b-p3p-branch-association";
import {
  TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA,
  TYPE_B_BRANCH_ASSOCIATION_SCHEMA,
  associateTypeBP3pBranchesAndBuildCorridors,
  type TypeBBranchAssociationPolicy,
} from "./type-b-p3p-branch-association";

// --- Local minimal fixtures -------------------------------------------------

const ZERO_CENSUS = {
  algebraicCandidateCount: 0,
  realRootCount: 0,
  positiveDistanceRootCount: 0,
  deduplicatedRootCount: 0,
} as const;

type SnapshotOptions = {
  readonly worldWidth?: number;
  readonly sourceImageIdentity?: string;
  readonly authorizedAspectRatios?: readonly number[];
};

// A structurally valid frozen snapshot. Its seam geometry is unused by B3C
// generation and by B3D-2 (which read only families, basis, and worldWidth).
function buildSnapshot(opts: SnapshotOptions = {}): TypeBEvidenceSnapshot {
  return {
    schema: TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    evidenceFamily: "rear_seam_plus_strong_side_seam",
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    basis: {
      sourceImageIdentity: opts.sourceImageIdentity ?? "room.jpg",
      sourceFrameKey: "1000x1000",
      sourceFrame: { width: 1000, height: 1000 },
      candidateIdentity: "cand",
      floorPolygonKey: "poly",
    },
    rearSeam: {
      role: "rear_floor_wall_seam",
      startNorm: { x: 0.2, y: 0.6 },
      endNorm: { x: 0.8, y: 0.6 },
      startEndpointStatus: "visible",
      endEndpointStatus: "visible",
      startFrameContact: "no_frame_contact",
      endFrameContact: "no_frame_contact",
      occlusionStatus: "none_observed",
    },
    strongSideSeam: {
      role: "side_wall_floor_seam",
      startNorm: { x: 0.2, y: 0.6 },
      endNorm: { x: 0.1, y: 0.95 },
      startEndpointStatus: "visible",
      endEndpointStatus: "frame_truncated",
      startFrameContact: "no_frame_contact",
      endFrameContact: "contacts_frame",
      occlusionStatus: "none_observed",
    },
    latentNearCornerCondition: "frame_truncated",
    floorAssumptions: {
      worldWidth: opts.worldWidth ?? 1,
      authorizedAspectRatios: opts.authorizedAspectRatios ?? [1.0],
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

function makeCoverage(
  classes: readonly { identity: string; value: number }[],
  fovProbesDeg: readonly number[]
): TypeBTupleGenerationCoverage {
  return {
    primaryProductClasses: classes.map((c) => ({
      primaryProductClassIdentity: c.identity,
      latentDepthProduct: {
        formulaId: TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA,
        value: c.value,
      },
    })),
    fovProbesDeg,
  };
}

// Row-major world->camera rotation about the world Y axis. The geodesic between
// rotY(a) and rotY(b) is exactly |a - b| degrees, which makes rotation-distance
// expectations exact.
function rotY(deg: number): TypeBRotationMatrix3 {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}

function hyp(
  index: number,
  camera: TypeBVec3,
  rotation: TypeBRotationMatrix3,
  plausibility: TypeBPoseHypothesis["plausibility"] = []
): TypeBPoseHypothesis {
  return {
    hypothesisIndex: index,
    poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
    cameraPositionWorld: camera,
    worldToCameraRotation: rotation,
    constructionObservations: [],
    plausibility,
  };
}

function poseHyps(hypotheses: readonly TypeBPoseHypothesis[]): TypeBPoseStageResult {
  return { kind: "pose_hypotheses", hypotheses };
}

function refusal(): TypeBPoseStageResult {
  return { kind: "refusal", reason: "pose_stage_no_rigid_solution" };
}

// A per-(classIndex, classKey, fovProbeDeg) pose-stage result supplier.
type PoseFn = (
  classIndex: number,
  classKey: string,
  fovProbeDeg: number
) => TypeBPoseStageResult;

// Builds a minimal B3D-1-compatible diagnostic run: one pose-probe record per
// unique generated B3C key (first-seen order), with caller-supplied pose-stage
// results. This mirrors B3D-1's collection so B3D-2 linkage passes.
function buildRun(
  tupleGeneration: TypeBTupleGenerationResult,
  poseFn: PoseFn
): TypeBP3pDiagnosticRunRecord {
  const seen = new Set<string>();
  const poseProbeResults: TypeBPoseProbeDiagnosticRecord[] = [];
  let classIndex = -1;
  for (const productClass of tupleGeneration.productClasses) {
    if (productClass.status !== "generated") continue;
    classIndex += 1;
    const equivalence = productClass.latentDepthEquivalence;
    const product = equivalence.latentDepthProduct;
    const classKey = equivalence.equivalenceClassKey;
    for (const member of productClass.members) {
      for (const tupleRecord of member.tuples) {
        const poseProbeEquivalence = tupleRecord.poseProbeEquivalence;
        const key = poseProbeEquivalence.poseProbeEquivalenceKey;
        if (seen.has(key)) continue;
        seen.add(key);
        poseProbeResults.push({
          poseProbeEquivalence,
          latentDepthEquivalence: equivalence,
          latentDepthProduct: product,
          poseStageResult: poseFn(
            classIndex,
            classKey,
            poseProbeEquivalence.fovProbeDeg
          ),
          rootCensus: ZERO_CENSUS,
        });
      }
    }
  }
  return {
    schema: TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
    snapshotBasis: tupleGeneration.snapshotBasis,
    tupleGeneration,
    poseProbeResults,
    memberCompatibilityRecords: [],
    branchCorridors: [],
    fovTopology: null,
    refusalReasons: [],
  };
}

function topology(
  orderedProbesDeg: readonly number[],
  stepDeg: number
): TypeBFovProbeTopologyDeclaration {
  return { schema: TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA, orderedProbesDeg, stepDeg };
}

const VALID_POLICY: TypeBBranchAssociationPolicy = {
  schema: TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA,
  maxNormalizedCameraPositionDelta: 0.5,
  maxRotationDeltaDeg: 10,
  tieMarginNormalizedCameraPosition: 0.01,
  tieMarginRotationDeg: 0.5,
  nearCoincidentNormalizedCameraPositionDelta: 0.01,
  nearCoincidentRotationDeltaDeg: 0.5,
};

// Deep forbidden-token guard (mirrors the B3C / B3D contract tests).
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

// The class-key portion of a pose-probe equivalence key (`<classKey>@fovProbeDeg=..`).
function classKeyOfRef(key: string): string {
  const idx = key.indexOf("@fovProbeDeg=");
  return idx >= 0 ? key.slice(0, idx) : key;
}

// --- 1. Runtime export surface ----------------------------------------------

test("1: the module exports only its two schema constants and the pure function", () => {
  const runtimeKeys = Object.keys(branchAssociationModule).sort();
  assert.deepEqual(runtimeKeys, [
    "TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA",
    "TYPE_B_BRANCH_ASSOCIATION_SCHEMA",
    "associateTypeBP3pBranchesAndBuildCorridors",
  ]);
  assert.equal(
    TYPE_B_BRANCH_ASSOCIATION_SCHEMA,
    "vibode-type-b-branch-association/v0"
  );
  assert.equal(
    TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA,
    "vibode-type-b-branch-association-policy/v0"
  );
  assert.equal(typeof associateTypeBP3pBranchesAndBuildCorridors, "function");
});

// --- 2. Strict 1-degree lattice, two roots per probe -> two corridors -------

test("2: two roots at each of three strict-lattice probes yield two stable corridors", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21, 22])
  );
  assert.equal(tg.status, "generated");
  const run = buildRun(tg, () =>
    poseHyps([
      hyp(0, { x: 0, y: 1, z: 2 }, rotY(0)),
      hyp(1, { x: 5, y: 1, z: 2 }, rotY(0)),
    ])
  );
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21, 22], 1),
    VALID_POLICY
  );
  assert.equal(result.status, "associated");
  assert.deepEqual(result.notAssessedReasons, []);
  const corridors = result.diagnosticRun.branchCorridors;
  assert.equal(corridors.length, 2);
  // Every corridor is a full 3-probe branch.
  for (const corridor of corridors) {
    assert.equal(corridor.poseProbeRootReferences.length, 3);
  }
  // All six roots appear exactly once across all corridors.
  const allRefs = corridors.flatMap((c) => c.poseProbeRootReferences);
  assert.equal(allRefs.length, 6);
  const refKeys = new Set(
    allRefs.map((r) => `${r.poseProbeEquivalenceKey}#${r.hypothesisIndex}`)
  );
  assert.equal(refKeys.size, 6);
});

// --- 3. Branch index follows class/topology/hypothesis order, not plausibility

test("3: branch index is a stable class/topology/hypothesis enumeration, not plausibility", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21, 22])
  );
  // Hypothesis index 0 (branch A) is given FAILED plausibility, index 1
  // (branch B) PASSED, to prove plausibility never reorders branchIndex.
  const run = buildRun(tg, () =>
    poseHyps([
      hyp(0, { x: 0, y: 1, z: 2 }, rotY(0), [
        { checkId: "camera_above_floor/v0", state: "failed" },
        { checkId: "camera_near_side_of_rear_seam/v0", state: "failed" },
      ]),
      hyp(1, { x: 5, y: 1, z: 2 }, rotY(0), [
        { checkId: "camera_above_floor/v0", state: "passed" },
        { checkId: "camera_near_side_of_rear_seam/v0", state: "passed" },
      ]),
    ])
  );
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21, 22], 1),
    VALID_POLICY
  );
  const corridors = result.diagnosticRun.branchCorridors;
  assert.equal(corridors.length, 2);
  assert.equal(corridors[0].branchIndex, 0);
  assert.equal(corridors[1].branchIndex, 1);
  // branchIndex 0 owns the globally-first node: probe 20, hypothesisIndex 0.
  const first = corridors[0].poseProbeRootReferences[0];
  assert.equal(first.fovProbeDeg, 20);
  assert.equal(first.hypothesisIndex, 0);
  // Every reference in corridor 0 is hypothesisIndex 0 (branch A across probes).
  for (const ref of corridors[0].poseProbeRootReferences) {
    assert.equal(ref.hypothesisIndex, 0);
  }
  for (const ref of corridors[1].poseProbeRootReferences) {
    assert.equal(ref.hypothesisIndex, 1);
  }
});

// --- 4. One product class never associates with another ----------------------

test("4: association never crosses product classes", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage(
      [
        { identity: "p-0.75", value: 0.75 },
        { identity: "p-0.5", value: 0.5 },
      ],
      [20, 21]
    )
  );
  assert.equal(tg.status, "generated");
  // Identical camera poses across BOTH classes; only within-class association
  // is permitted, so the classes must stay in separate corridors.
  const run = buildRun(tg, () => poseHyps([hyp(0, { x: 0, y: 1, z: 2 }, rotY(0))]));
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21], 1),
    VALID_POLICY
  );
  const corridors = result.diagnosticRun.branchCorridors;
  assert.equal(corridors.length, 2);
  for (const corridor of corridors) {
    const classKeys = new Set(
      corridor.poseProbeRootReferences.map((r) =>
        classKeyOfRef(r.poseProbeEquivalenceKey)
      )
    );
    assert.equal(classKeys.size, 1, "a corridor spans exactly one product class");
    for (const annotation of corridor.associationAnnotations) {
      if (annotation.to) {
        assert.equal(
          classKeyOfRef(annotation.from.poseProbeEquivalenceKey),
          classKeyOfRef(annotation.to.poseProbeEquivalenceKey)
        );
      }
    }
  }
  const corridorClassKeys = corridors.map((c) =>
    classKeyOfRef(c.poseProbeRootReferences[0].poseProbeEquivalenceKey)
  );
  assert.equal(new Set(corridorClassKeys).size, 2);
});

// --- 5. Caller order differs from topology order ----------------------------

test("5: a B3C caller-order list is valid against ascending topology; pose order preserved", () => {
  const snapshot = buildSnapshot();
  // Caller order [24, 20, 22]; topology ascending [20, 22, 24], step 2.
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [24, 20, 22])
  );
  assert.equal(tg.status, "generated");
  const run = buildRun(tg, () => poseHyps([hyp(0, { x: 0, y: 1, z: 2 }, rotY(0))]));
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 22, 24], 2),
    VALID_POLICY
  );
  assert.equal(result.status, "associated");
  // Diagnostic-run pose results retain their original B3C caller order.
  assert.deepEqual(
    result.diagnosticRun.poseProbeResults.map(
      (r) => r.poseProbeEquivalence.fovProbeDeg
    ),
    [24, 20, 22]
  );
  // Corridor references follow topology order [20, 22, 24].
  assert.equal(result.diagnosticRun.branchCorridors.length, 1);
  assert.deepEqual(
    result.diagnosticRun.branchCorridors[0].poseProbeRootReferences.map(
      (r) => r.fovProbeDeg
    ),
    [20, 22, 24]
  );
});

// --- 6. A declared gap splits corridors -------------------------------------

test("6: a topology gap splits corridors and no association spans the gap", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21, 23, 24])
  );
  assert.equal(tg.status, "generated");
  const run = buildRun(tg, () => poseHyps([hyp(0, { x: 0, y: 1, z: 2 }, rotY(0))]));
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21, 23, 24], 1),
    VALID_POLICY
  );
  assert.equal(result.status, "associated");
  const corridors = result.diagnosticRun.branchCorridors;
  // {20,21} and {23,24}; the 21->23 gap splits them.
  assert.equal(corridors.length, 2);
  const allAnnotations = corridors.flatMap((c) => c.associationAnnotations);
  for (const annotation of allAnnotations) {
    if (annotation.state === "associated" && annotation.to) {
      const diff = Math.abs(annotation.to.fovProbeDeg - annotation.from.fovProbeDeg);
      assert.equal(diff, 1, "associated edges only span a single 1-degree step");
      assert.ok(
        !(annotation.from.fovProbeDeg === 21 && annotation.to.fovProbeDeg === 23),
        "no association bridges the 21->23 gap"
      );
    }
  }
});

// --- 7. Invalid topology -> not_assessed, one topology refusal, records kept --

test("7: invalid topology yields not_assessed + one fov_topology_unresolved, records preserved", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 22, 24])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, { x: 0, y: 1, z: 2 }, rotY(0))]));

  // Non-ascending order.
  const nonAscending = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([22, 20, 24], 2),
    VALID_POLICY
  );
  assert.equal(nonAscending.status, "not_assessed");
  assert.deepEqual(nonAscending.notAssessedReasons, ["fov_topology_unresolved"]);
  assert.deepEqual(nonAscending.diagnosticRun.refusalReasons, [
    "fov_topology_unresolved",
  ]);
  assert.deepEqual(nonAscending.diagnosticRun.branchCorridors, []);
  assert.equal(nonAscending.diagnosticRun.fovTopology, null);
  assert.deepEqual(
    nonAscending.diagnosticRun.poseProbeResults,
    run.poseProbeResults
  );

  // Multiset mismatch (probe not present in coverage).
  const mismatch = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 22, 26], 2),
    VALID_POLICY
  );
  assert.equal(mismatch.status, "not_assessed");
  assert.deepEqual(mismatch.notAssessedReasons, ["fov_topology_unresolved"]);
  assert.deepEqual(mismatch.diagnosticRun.poseProbeResults, run.poseProbeResults);
});

// --- 8. Invalid policy -> local policy reason, no topology refusal -----------

test("8: invalid policy yields the policy reason and adds no topology refusal", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, { x: 0, y: 1, z: 2 }, rotY(0))]));
  const badPolicy: TypeBBranchAssociationPolicy = {
    ...VALID_POLICY,
    maxNormalizedCameraPositionDelta: -1,
  };
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21], 1),
    badPolicy
  );
  assert.equal(result.status, "not_assessed");
  assert.deepEqual(result.notAssessedReasons, ["invalid_branch_association_policy"]);
  assert.equal(result.policy, null);
  // No topology refusal is (mis)added, and nothing is generated.
  assert.deepEqual(result.diagnosticRun.refusalReasons, []);
  assert.deepEqual(result.diagnosticRun.branchCorridors, []);
  assert.equal(result.diagnosticRun.fovTopology, null);
});

// --- 9. Unmatched termination / birth ---------------------------------------

test("9: a root with no compatible neighbor terminates / is born as a singleton", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21])
  );
  // Probe 20 root is 10 units from the probe 21 root: never compatible.
  const run = buildRun(tg, (_classIndex, _classKey, fov) =>
    fov === 20
      ? poseHyps([hyp(0, { x: 0, y: 1, z: 0 }, rotY(0))])
      : poseHyps([hyp(0, { x: 10, y: 1, z: 0 }, rotY(0))])
  );
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21], 1),
    VALID_POLICY
  );
  const corridors = result.diagnosticRun.branchCorridors;
  assert.equal(corridors.length, 2);
  const states = corridors.flatMap((c) =>
    c.associationAnnotations.map((a) => a.state)
  );
  assert.ok(states.includes("unmatched_terminated"));
  assert.ok(states.includes("unmatched_born"));
  // Each corridor is a singleton and no association was asserted.
  for (const corridor of corridors) {
    assert.equal(corridor.poseProbeRootReferences.length, 1);
    for (const annotation of corridor.associationAnnotations) {
      assert.notEqual(annotation.state, "associated");
    }
  }
});

// --- 10. Two compatible non-dominating candidates -> tied_ambiguous ----------

test("10: two compatible but non-dominating candidates become tied_ambiguous", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21])
  );
  const run = buildRun(tg, (_classIndex, _classKey, fov) =>
    fov === 20
      ? poseHyps([hyp(0, { x: 0, y: 1, z: 0 }, rotY(0))])
      : poseHyps([
          hyp(0, { x: 0.1, y: 1, z: 0 }, rotY(0)),
          hyp(1, { x: -0.1, y: 1, z: 0 }, rotY(0)),
        ])
  );
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21], 1),
    VALID_POLICY
  );
  const corridors = result.diagnosticRun.branchCorridors;
  const allStates = corridors.flatMap((c) =>
    c.associationAnnotations.map((a) => a.state)
  );
  // No arbitrary association is chosen; every outcome is tied_ambiguous.
  assert.ok(!allStates.includes("associated"));
  assert.ok(allStates.every((s) => s === "tied_ambiguous"));
  // The earlier root and both later roots are each recorded as tied.
  assert.equal(allStates.filter((s) => s === "tied_ambiguous").length, 3);
  // All three roots remain as singleton corridors.
  assert.equal(corridors.length, 3);
});

// --- 11. Near-coincident guard suppresses a whole face ----------------------

test("11: a near-coincident sibling pair suppresses all face associations", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21])
  );
  // Probe 20 has two near-coincident siblings (0.005 apart <= 0.01 threshold).
  const run = buildRun(tg, (_classIndex, _classKey, fov) =>
    fov === 20
      ? poseHyps([
          hyp(0, { x: 0, y: 1, z: 0 }, rotY(0)),
          hyp(1, { x: 0.005, y: 1, z: 0 }, rotY(0)),
        ])
      : poseHyps([hyp(0, { x: 0, y: 1, z: 0 }, rotY(0))])
  );
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21], 1),
    VALID_POLICY
  );
  const corridors = result.diagnosticRun.branchCorridors;
  const allStates = corridors.flatMap((c) =>
    c.associationAnnotations.map((a) => a.state)
  );
  assert.ok(!allStates.includes("associated"));
  assert.ok(allStates.every((s) => s === "near_coincident_unresolved"));
  // Every root touching the face records a near-coincident annotation (3 total).
  assert.equal(allStates.length, 3);
  // No root was merged or dropped: three singleton corridors remain.
  assert.equal(corridors.length, 3);
});

// --- 12. A per-probe refusal creates no node; neighbors terminate / are born -

test("12: a per-probe pose-stage refusal creates no node and is not bridged", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21, 22])
  );
  const run = buildRun(tg, (_classIndex, _classKey, fov) =>
    fov === 21 ? refusal() : poseHyps([hyp(0, { x: 0, y: 1, z: 0 }, rotY(0))])
  );
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21, 22], 1),
    VALID_POLICY
  );
  const corridors = result.diagnosticRun.branchCorridors;
  // Only probes 20 and 22 have nodes; probe 21 (refusal) has none.
  const allRefs = corridors.flatMap((c) => c.poseProbeRootReferences);
  assert.equal(allRefs.length, 2);
  assert.ok(allRefs.every((r) => r.fovProbeDeg !== 21));
  // The two neighbors are NOT bridged: two singleton corridors.
  assert.equal(corridors.length, 2);
  const states = corridors.flatMap((c) =>
    c.associationAnnotations.map((a) => a.state)
  );
  assert.ok(states.includes("unmatched_terminated"));
  assert.ok(states.includes("unmatched_born"));
  assert.ok(!states.includes("associated"));
});

// --- 13. Plausibility failures do not prevent association -------------------

test("13: camera-above-floor / near-side failures do not block geometric association", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21])
  );
  const failedPlausibility: TypeBPoseHypothesis["plausibility"] = [
    { checkId: "camera_above_floor/v0", state: "failed" },
    { checkId: "camera_near_side_of_rear_seam/v0", state: "failed" },
  ];
  const run = buildRun(tg, () =>
    poseHyps([hyp(0, { x: 0, y: -3, z: -4 }, rotY(0), failedPlausibility)])
  );
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21], 1),
    VALID_POLICY
  );
  assert.equal(result.status, "associated");
  // Identical geometric pose across the face -> a single associated corridor.
  assert.equal(result.diagnosticRun.branchCorridors.length, 1);
  const states = result.diagnosticRun.branchCorridors[0].associationAnnotations.map(
    (a) => a.state
  );
  assert.ok(states.includes("associated"));
});

// --- 14. Distance metrics use junction-anchored pose + snapshot worldWidth ---

test("14: position distance uses junction-anchored fields normalized by worldWidth", () => {
  const snapshotNarrow = buildSnapshot({ worldWidth: 1 });
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshotNarrow,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21])
  );
  // World-space separation of 10 between the two probe roots.
  const run = buildRun(tg, (_classIndex, _classKey, fov) =>
    fov === 20
      ? poseHyps([hyp(0, { x: 0, y: 1, z: 0 }, rotY(0))])
      : poseHyps([hyp(0, { x: 10, y: 1, z: 0 }, rotY(0))])
  );

  // worldWidth = 1 -> dPos = 10 > 0.5 -> not compatible -> two corridors.
  const narrow = associateTypeBP3pBranchesAndBuildCorridors(
    snapshotNarrow,
    run,
    topology([20, 21], 1),
    VALID_POLICY
  );
  assert.equal(narrow.diagnosticRun.branchCorridors.length, 2);

  // worldWidth = 100 -> dPos = 0.1 <= 0.5 -> compatible -> one corridor.
  const snapshotWide = buildSnapshot({ worldWidth: 100 });
  const wide = associateTypeBP3pBranchesAndBuildCorridors(
    snapshotWide,
    run,
    topology([20, 21], 1),
    VALID_POLICY
  );
  assert.equal(wide.diagnosticRun.branchCorridors.length, 1);
  // Corridors carry the junction-anchored comparison frame.
  for (const corridor of wide.diagnosticRun.branchCorridors) {
    assert.equal(
      corridor.poseComparisonReferenceFrame,
      "junction_anchored/v0"
    );
  }
});

// --- 15. Malformed linkage -> one atomic linkage refusal, zero corridors -----

test("15: snapshot/run mismatch or malformed pose-probe linkage yields one linkage refusal", () => {
  const snapshotA = buildSnapshot({ sourceImageIdentity: "room-a.jpg" });
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshotA,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, { x: 0, y: 1, z: 2 }, rotY(0))]));

  // Basis mismatch: a structurally valid but different snapshot.
  const snapshotB = buildSnapshot({ sourceImageIdentity: "room-b.jpg" });
  const mismatch = associateTypeBP3pBranchesAndBuildCorridors(
    snapshotB,
    run,
    topology([20, 21], 1),
    VALID_POLICY
  );
  assert.equal(mismatch.status, "not_assessed");
  assert.deepEqual(mismatch.notAssessedReasons, ["invalid_diagnostic_run_linkage"]);
  assert.equal(mismatch.policy, null);
  assert.deepEqual(mismatch.diagnosticRun.refusalReasons, [
    "invalid_tuple_generation_linkage",
  ]);
  assert.deepEqual(mismatch.diagnosticRun.branchCorridors, []);
  assert.equal(mismatch.diagnosticRun.fovTopology, null);

  // Corrupt a pose-probe key so it no longer matches the rebuilt key.
  const broken = structuredClone(run) as TypeBP3pDiagnosticRunRecord;
  (broken.poseProbeResults[0].poseProbeEquivalence as {
    poseProbeEquivalenceKey: string;
  }).poseProbeEquivalenceKey = "tampered-key";
  const brokenResult = associateTypeBP3pBranchesAndBuildCorridors(
    snapshotA,
    broken,
    topology([20, 21], 1),
    VALID_POLICY
  );
  assert.deepEqual(brokenResult.notAssessedReasons, [
    "invalid_diagnostic_run_linkage",
  ]);
  assert.deepEqual(brokenResult.diagnosticRun.refusalReasons, [
    "invalid_tuple_generation_linkage",
  ]);
});

// --- 16. Upstream refusal / already-associated -> not associable, no repair --

test("16: an upstream refusal or existing run refusal is preserved as not associable", () => {
  const snapshot = buildSnapshot();

  // Sub-case a: an existing run-level refusal.
  const tgOk = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21])
  );
  const refusedRun: TypeBP3pDiagnosticRunRecord = {
    ...buildRun(tgOk, () => poseHyps([hyp(0, { x: 0, y: 1, z: 2 }, rotY(0))])),
    refusalReasons: ["pose_multiplicity_unresolved"],
  };
  const runLevel = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    refusedRun,
    topology([20, 21], 1),
    VALID_POLICY
  );
  assert.equal(runLevel.status, "not_assessed");
  assert.deepEqual(runLevel.notAssessedReasons, [
    "upstream_diagnostic_run_not_associable",
  ]);
  assert.equal(runLevel.policy, null);
  // No repair: the run is preserved verbatim.
  assert.deepEqual(runLevel.diagnosticRun, refusedRun);

  // Sub-case b: an upstream B3C refusal (no FOV probes).
  const tgRefused = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [])
  );
  assert.equal(tgRefused.status, "refused");
  const echoRun: TypeBP3pDiagnosticRunRecord = {
    schema: TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
    snapshotBasis: tgRefused.snapshotBasis,
    tupleGeneration: tgRefused,
    poseProbeResults: [],
    memberCompatibilityRecords: [],
    branchCorridors: [],
    fovTopology: null,
    refusalReasons: [],
  };
  const upstream = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    echoRun,
    topology([20, 21], 1),
    VALID_POLICY
  );
  assert.deepEqual(upstream.notAssessedReasons, [
    "upstream_diagnostic_run_not_associable",
  ]);
  assert.deepEqual(upstream.diagnosticRun, echoRun);
});

// --- 17. No rank / score / confidence / selection / preview / load / Apply ---

test("17: a full associated result contains no forbidden field", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21, 22])
  );
  const run = buildRun(tg, () =>
    poseHyps([
      hyp(0, { x: 0, y: 1, z: 2 }, rotY(0)),
      hyp(1, { x: 5, y: 1, z: 2 }, rotY(0)),
    ])
  );
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21, 22], 1),
    VALID_POLICY
  );
  assert.equal(result.status, "associated");
  assertNoForbiddenKeys(result);
});

// --- 18. fovTopology null + branch corridors empty on every non-assessment ---

test("18: non-assessed results carry null topology and empty branch corridors", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, { x: 0, y: 1, z: 2 }, rotY(0))]));

  const badPolicy: TypeBBranchAssociationPolicy = {
    ...VALID_POLICY,
    maxRotationDeltaDeg: 400,
  };
  const cases = [
    // Invalid policy.
    associateTypeBP3pBranchesAndBuildCorridors(
      snapshot,
      run,
      topology([20, 21], 1),
      badPolicy
    ),
    // Invalid topology.
    associateTypeBP3pBranchesAndBuildCorridors(
      snapshot,
      run,
      topology([21, 20], 1),
      VALID_POLICY
    ),
    // Linkage mismatch.
    associateTypeBP3pBranchesAndBuildCorridors(
      buildSnapshot({ sourceImageIdentity: "other.jpg" }),
      run,
      topology([20, 21], 1),
      VALID_POLICY
    ),
  ];
  for (const result of cases) {
    assert.equal(result.status, "not_assessed");
    assert.equal(result.diagnosticRun.fovTopology, null);
    assert.deepEqual(result.diagnosticRun.branchCorridors, []);
  }
});

// --- 19. Deterministic + non-mutating ---------------------------------------

test("19: repeat invocation is deeply equal and leaves inputs unchanged", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21, 22])
  );
  const run = buildRun(tg, () =>
    poseHyps([
      hyp(0, { x: 0, y: 1, z: 2 }, rotY(0)),
      hyp(1, { x: 5, y: 1, z: 2 }, rotY(0)),
    ])
  );
  const top = topology([20, 21, 22], 1);

  const snapshotBefore = structuredClone(snapshot);
  const runBefore = structuredClone(run);
  const topBefore = structuredClone(top);
  const policyBefore = structuredClone(VALID_POLICY);

  const first = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    top,
    VALID_POLICY
  );
  const second = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    top,
    VALID_POLICY
  );
  assert.deepEqual(first, second);

  // Inputs are untouched.
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(run, runBefore);
  assert.deepEqual(top, topBefore);
  assert.deepEqual(VALID_POLICY, policyBefore);
});

// --- 20. Associated edges connect adjacent declared lattice probes only ------

test("20: every associated edge connects a single adjacent lattice step", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21, 22])
  );
  const run = buildRun(tg, () =>
    poseHyps([
      hyp(0, { x: 0, y: 1, z: 2 }, rotY(0)),
      hyp(1, { x: 5, y: 1, z: 2 }, rotY(0)),
    ])
  );
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21, 22], 1),
    VALID_POLICY
  );
  const ordered = [20, 21, 22];
  for (const corridor of result.diagnosticRun.branchCorridors) {
    for (const annotation of corridor.associationAnnotations) {
      if (annotation.state !== "associated" || !annotation.to) continue;
      const fromIdx = ordered.indexOf(annotation.from.fovProbeDeg);
      const toIdx = ordered.indexOf(annotation.to.fovProbeDeg);
      assert.ok(fromIdx >= 0 && toIdx >= 0);
      assert.equal(toIdx - fromIdx, 1, "an associated edge is a single lattice step");
    }
  }
});

// --- 21. Every annotation occurs once and is owned by its from-root corridor -

test("21: each annotation occurs exactly once and is owned by its from-root corridor", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: 0.75 }], [20, 21])
  );
  // Probe 20: A stable + B isolated; probe 21: A' (partners A). B terminates.
  const run = buildRun(tg, (_classIndex, _classKey, fov) =>
    fov === 20
      ? poseHyps([
          hyp(0, { x: 0, y: 1, z: 0 }, rotY(0)),
          hyp(1, { x: 9, y: 1, z: 0 }, rotY(0)),
        ])
      : poseHyps([hyp(0, { x: 0, y: 1, z: 0 }, rotY(0))])
  );
  const result = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([20, 21], 1),
    VALID_POLICY
  );
  const corridors = result.diagnosticRun.branchCorridors;

  const signatures: string[] = [];
  for (const corridor of corridors) {
    const memberKeys = new Set(
      corridor.poseProbeRootReferences.map(
        (r) => `${r.poseProbeEquivalenceKey}#${r.hypothesisIndex}`
      )
    );
    for (const annotation of corridor.associationAnnotations) {
      const fromKey = `${annotation.from.poseProbeEquivalenceKey}#${annotation.from.hypothesisIndex}`;
      // Every annotation is owned by the corridor containing its `from` root.
      assert.ok(
        memberKeys.has(fromKey),
        "annotation must be owned by its from-root corridor"
      );
      const toKey = annotation.to
        ? `${annotation.to.poseProbeEquivalenceKey}#${annotation.to.hypothesisIndex}`
        : "null";
      signatures.push(`${fromKey}->${toKey}:${annotation.state}`);
    }
  }
  // No annotation is duplicated across corridors.
  assert.equal(new Set(signatures).size, signatures.length);
  // We expect exactly one associated edge and one terminated annotation.
  assert.ok(signatures.some((s) => s.endsWith(":associated")));
  assert.ok(signatures.some((s) => s.endsWith(":unmatched_terminated")));
});

// --- 22. Import surface (no solver / Type A / UI / browser / React / etc.) ---

test("22: the association module imports only committed Type B contract modules", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    path.join(here, "type-b-p3p-branch-association.ts"),
    "utf8"
  );
  const allowed = new Set([
    "./type-b-evaluator-contract",
    "./type-b-p3p-diagnostic-contract",
    "./type-b-tuple-generation",
  ]);
  const importRegex = /from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  const specifiers: string[] = [];
  while ((match = importRegex.exec(source)) !== null) {
    specifiers.push(match[1]);
  }
  assert.ok(specifiers.length > 0, "the module must have imports");
  for (const specifier of specifiers) {
    assert.ok(allowed.has(specifier), `disallowed import specifier: ${specifier}`);
  }
  for (const specifier of specifiers) {
    for (const forbidden of [
      "react",
      "three",
      "konva",
      "perspective-solve",
      "quad-solvability",
      "calibrated-camera",
      "scene-state",
      "homography",
    ]) {
      assert.ok(
        !specifier.includes(forbidden),
        `disallowed import specifier token: ${specifier}`
      );
    }
  }
  assert.ok(!/\brequire\s*\(/.test(source), "no dynamic require");
  assert.ok(!/\bimport\s*\(/.test(source), "no dynamic import");
  assert.ok(!/\bwindow\./.test(source), "no window. reference");
  assert.ok(!/\bdocument\./.test(source), "no document. reference");
});
