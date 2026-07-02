// --- Phase B3D-3: Pure Frame-Truncation Compatibility tests -----------------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST Type B
// frame-truncation compatibility layer. Fixtures are LOCAL, minimal,
// B3D-1/B3D-2-compatible diagnostic run records built from hand-chosen
// junction-anchored pose hypotheses (no P3P solve, no random initialization,
// no live state). This layer never invokes P3P or branch association, never
// selects / filters / ranks / removes a root, and never exposes an implied
// near-corner coordinate.
//
// There is NO DLT / homography, four-corner reconstruction, near-corner
// recovery, UI, preview, load, Apply, calibration mutation, persistence,
// routing, or ranking anywhere in the module or these tests.

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
  type TypeBDeclaredEndpointRole,
  type TypeBEvidenceSnapshot,
  type TypeBPoseHypothesis,
  type TypeBPoseStageResult,
  type TypeBRotationMatrix3,
  type TypeBVec3,
} from "./type-b-evaluator-contract";
import type {
  TypeBEndpointStatus,
  TypeBFrameContactStatus,
} from "./type-b-evidence-types";
import {
  TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA,
  TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
  type TypeBFovProbeTopologyDeclaration,
  type TypeBMemberCompatibilityRecord,
  type TypeBP3pDiagnosticRunRecord,
  type TypeBPoseProbeDiagnosticRecord,
} from "./type-b-p3p-diagnostic-contract";
import {
  generateTypeBBoundedDiagnosticTuples,
  type TypeBTupleGenerationCoverage,
  type TypeBTupleGenerationResult,
} from "./type-b-tuple-generation";
import {
  TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA,
  associateTypeBP3pBranchesAndBuildCorridors,
  type TypeBBranchAssociationPolicy,
} from "./type-b-p3p-branch-association";
import * as frameTruncationModule from "./type-b-frame-truncation-compatibility";
import {
  TYPE_B_FRAME_TRUNCATION_COMPATIBILITY_SCHEMA,
  evaluateTypeBFrameTruncationCompatibility,
} from "./type-b-frame-truncation-compatibility";

// --- Fixed projection geometry ----------------------------------------------
// A square frame with a vertical FOV whose focal length is used to place the
// internal implied endpoint deterministically. All controlled tests use
// worldWidth = 1 and aspect = 1, so the internal implied point is N = (0,0,1).

const FRAME = 1000;
const FOV = 60;
const FX = FRAME / (2 * Math.tan((FOV * Math.PI) / 180 / 2));
// Camera C.x that places N exactly on the x = 0 source-frame boundary under the
// identity rotation (camPoint.x = -C.x = -cx/fx -> projX === 0 exactly).
const BOUNDARY_CX = FRAME / 2 / FX;

const IDENTITY: TypeBRotationMatrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// Under identity rotation with t = -C, camPoint = N - C (N = (0,0,1)):
//   interior  -> projX = cx, projY = cy (strict interior) -> incompatible
const CAMERA_INTERIOR: TypeBVec3 = { x: 0, y: 0, z: -1 };
//   outside   -> projX far negative                       -> compatible
const CAMERA_OUTSIDE: TypeBVec3 = { x: 100, y: 0, z: 0 };
//   boundary  -> projX === 0                              -> compatible
const CAMERA_BOUNDARY: TypeBVec3 = { x: BOUNDARY_CX, y: 0, z: 0 };
//   non-positive depth (camPoint.z = -1)                  -> not_evaluated
const CAMERA_NONPOSITIVE_DEPTH: TypeBVec3 = { x: 0, y: 0, z: 2 };

const ZERO_CENSUS = {
  algebraicCandidateCount: 0,
  realRootCount: 0,
  positiveDistanceRootCount: 0,
  deduplicatedRootCount: 0,
} as const;

// --- Local minimal fixtures -------------------------------------------------

type SnapshotOptions = {
  readonly condition?: "frame_truncated" | "occluded";
  readonly terminusStatus?: TypeBEndpointStatus;
  readonly terminusFrameContact?: TypeBFrameContactStatus;
  readonly junctionSideEndpoint?: TypeBDeclaredEndpointRole;
  readonly worldWidth?: number;
  readonly authorizedAspectRatios?: readonly number[];
  readonly sourceImageIdentity?: string;
};

// A structurally valid frozen snapshot. The side terminus is the endpoint
// OPPOSITE `junctionSideEndpoint`; with the default "start" junction the "end"
// endpoint carries the latent status + frame contact.
function buildSnapshot(opts: SnapshotOptions = {}): TypeBEvidenceSnapshot {
  const condition = opts.condition ?? "frame_truncated";
  const junctionSideEndpoint = opts.junctionSideEndpoint ?? "start";
  const terminusStatus: TypeBEndpointStatus = opts.terminusStatus ?? condition;
  const terminusFrameContact: TypeBFrameContactStatus =
    opts.terminusFrameContact ??
    (condition === "frame_truncated" ? "contacts_frame" : "no_frame_contact");

  // Junction endpoint is position-certain; terminus carries the latent status.
  const terminusIsEnd = junctionSideEndpoint === "start";
  const strongSideSeam = {
    role: "side_wall_floor_seam" as const,
    startNorm: { x: 0.2, y: 0.6 },
    endNorm: { x: 0.1, y: 0.95 },
    startEndpointStatus: (terminusIsEnd
      ? "visible"
      : terminusStatus) as TypeBEndpointStatus,
    endEndpointStatus: (terminusIsEnd
      ? terminusStatus
      : "visible") as TypeBEndpointStatus,
    startFrameContact: (terminusIsEnd
      ? "no_frame_contact"
      : terminusFrameContact) as TypeBFrameContactStatus,
    endFrameContact: (terminusIsEnd
      ? terminusFrameContact
      : "no_frame_contact") as TypeBFrameContactStatus,
    occlusionStatus: "none_observed" as const,
  };

  return {
    schema: TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    evidenceFamily: "rear_seam_plus_strong_side_seam",
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    basis: {
      sourceImageIdentity: opts.sourceImageIdentity ?? "room.jpg",
      sourceFrameKey: "1000x1000",
      sourceFrame: { width: FRAME, height: FRAME },
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
    strongSideSeam,
    latentNearCornerCondition: condition,
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
      junctionSideEndpoint,
    },
    capturedAtIso: "2026-07-02T00:00:00.000Z",
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

function hyp(index: number, camera: TypeBVec3): TypeBPoseHypothesis {
  return {
    hypothesisIndex: index,
    poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
    cameraPositionWorld: camera,
    worldToCameraRotation: IDENTITY,
    constructionObservations: [],
    plausibility: [],
  };
}

function poseHyps(
  hypotheses: readonly TypeBPoseHypothesis[]
): TypeBPoseStageResult {
  return { kind: "pose_hypotheses", hypotheses };
}

function refusal(): TypeBPoseStageResult {
  return { kind: "refusal", reason: "pose_stage_no_rigid_solution" };
}

type PoseFn = (
  classIndex: number,
  classKey: string,
  fovProbeDeg: number
) => TypeBPoseStageResult;

// Builds a minimal B3D-1-compatible diagnostic run: one pose-probe record per
// unique generated B3C key (first-seen order), plus one member compatibility
// record per member x tuple (mirroring B3D-1's collection order). This is what
// a real B3D-1 run looks like structurally, so B3D-3 linkage passes.
function buildRun(
  tupleGeneration: TypeBTupleGenerationResult,
  poseFn: PoseFn
): TypeBP3pDiagnosticRunRecord {
  const seen = new Set<string>();
  const poseProbeResults: TypeBPoseProbeDiagnosticRecord[] = [];
  const memberCompatibilityRecords: TypeBMemberCompatibilityRecord[] = [];
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
        if (!seen.has(key)) {
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
        memberCompatibilityRecords.push({
          primaryProductClassIdentity: productClass.primaryProductClassIdentity,
          floorAspectRatio: member.floorAspectRatio,
          latentSideExtent: member.latentSideExtent,
          cropCompatibility: member.cropCompatibility,
          poseProbeEquivalenceKey: key,
        });
      }
    }
  }
  return {
    schema: TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
    snapshotBasis: tupleGeneration.snapshotBasis,
    tupleGeneration,
    poseProbeResults,
    memberCompatibilityRecords,
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

const RECORD_KEYS = [
  "cropCompatibility",
  "floorAspectRatio",
  "hypothesisIndex",
  "latentSideExtent",
  "poseProbeEquivalenceKey",
  "primaryProductClassIdentity",
];

function fovOfKey(key: string): number {
  const marker = "@fovProbeDeg=";
  const idx = key.indexOf(marker);
  return idx >= 0 ? Number(key.slice(idx + marker.length)) : NaN;
}

// --- 1. Runtime export surface ----------------------------------------------

test("1: the module exports only its schema constant and the pure evaluator", () => {
  const runtimeKeys = Object.keys(frameTruncationModule).sort();
  assert.deepEqual(runtimeKeys, [
    "TYPE_B_FRAME_TRUNCATION_COMPATIBILITY_SCHEMA",
    "evaluateTypeBFrameTruncationCompatibility",
  ]);
  assert.equal(
    TYPE_B_FRAME_TRUNCATION_COMPATIBILITY_SCHEMA,
    "vibode-type-b-frame-truncation-compatibility/v0"
  );
  assert.equal(typeof evaluateTypeBFrameTruncationCompatibility, "function");
});

// --- 2. frame_truncated, implied endpoint OUTSIDE frame -> compatible --------

test("2: a frame_truncated root whose implied endpoint projects outside is compatible", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  assert.equal(tg.status, "generated");
  const run = buildRun(tg, () => poseHyps([hyp(0, CAMERA_OUTSIDE)]));
  const result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.equal(result.status, "evaluated");
  assert.deepEqual(result.notAssessedReasons, []);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].cropCompatibility, "compatible");
});

// --- 3. frame_truncated, implied endpoint in strict interior -> incompatible -

test("3: a frame_truncated root whose implied endpoint is strictly interior is incompatible", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, CAMERA_INTERIOR)]));
  const result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.equal(result.status, "evaluated");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].cropCompatibility, "incompatible");
});

// --- 4. implied endpoint exactly on the source-frame boundary -> compatible --

test("4: an implied endpoint exactly on the frame boundary is compatible", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, CAMERA_BOUNDARY)]));
  const result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.equal(result.status, "evaluated");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].cropCompatibility, "compatible");
});

// --- 5. non-positive depth / non-finite projection -> not_evaluated ----------

test("5: a non-positive camera-space depth yields not_evaluated and never throws", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, CAMERA_NONPOSITIVE_DEPTH)]));
  let result!: ReturnType<typeof evaluateTypeBFrameTruncationCompatibility>;
  assert.doesNotThrow(() => {
    result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  });
  assert.equal(result.status, "evaluated");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].cropCompatibility, "not_evaluated");
});

// --- 6. occluded -> not_applicable, no projection ---------------------------

test("6: an occluded terminus yields not_applicable per member x root with no projection", () => {
  const snapshot = buildSnapshot({ condition: "occluded" });
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  assert.equal(tg.status, "generated");
  // Even an interior-projecting pose must remain not_applicable for occluded.
  const run = buildRun(tg, () => poseHyps([hyp(0, CAMERA_INTERIOR)]));
  const result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.equal(result.status, "evaluated");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].cropCompatibility, "not_applicable");
});

// --- 7. one member, two surviving roots -> two records; incompatible kept ----

test("7: one member with two surviving roots yields two records; an incompatible root is retained", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const run = buildRun(tg, () =>
    poseHyps([hyp(0, CAMERA_INTERIOR), hyp(1, CAMERA_OUTSIDE)])
  );
  const result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.equal(result.status, "evaluated");
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].cropCompatibility, "incompatible");
  assert.equal(result.records[1].cropCompatibility, "compatible");
  // The incompatible root is retained in the (echoed) diagnostic run.
  const stage = result.diagnosticRun.poseProbeResults[0].poseStageResult;
  assert.equal(stage.kind, "pose_hypotheses");
  if (stage.kind === "pose_hypotheses") {
    assert.equal(stage.hypotheses.length, 2);
  }
});

// --- 8. two aspect members sharing one pose root -> two coordinate-free records

test("8: two aspect members sharing one pose root yield two records with no pose/coord/branch fields", () => {
  const snapshot = buildSnapshot({ authorizedAspectRatios: [1, 2] });
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  assert.equal(tg.status, "generated");
  const run = buildRun(tg, () => poseHyps([hyp(0, CAMERA_OUTSIDE)]));
  const result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.equal(result.status, "evaluated");
  // Two members share ONE pose-probe key -> two records.
  assert.equal(result.records.length, 2);
  const keys = new Set(result.records.map((r) => r.poseProbeEquivalenceKey));
  assert.equal(keys.size, 1);
  const aspects = result.records.map((r) => r.floorAspectRatio).sort();
  assert.deepEqual(aspects, [1, 2]);
  for (const record of result.records) {
    assert.deepEqual(Object.keys(record).sort(), RECORD_KEYS);
  }
});

// --- 9. B3D-2-associated run input accepted; topology / corridors unchanged ---

test("9: a B3D-2-associated run is accepted and its topology / branch corridors are unchanged", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV, FOV + 1])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, CAMERA_OUTSIDE)]));
  const associated = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([FOV, FOV + 1], 1),
    VALID_POLICY
  );
  assert.equal(associated.status, "associated");
  assert.ok(associated.diagnosticRun.branchCorridors.length > 0);
  assert.notEqual(associated.diagnosticRun.fovTopology, null);

  const result = evaluateTypeBFrameTruncationCompatibility(
    snapshot,
    associated.diagnosticRun
  );
  assert.equal(result.status, "evaluated");
  assert.ok(result.records.length > 0);
  // Topology and branch corridors pass through unchanged.
  assert.deepEqual(
    result.diagnosticRun.branchCorridors,
    associated.diagnosticRun.branchCorridors
  );
  assert.deepEqual(
    result.diagnosticRun.fovTopology,
    associated.diagnosticRun.fovTopology
  );
});

// --- 10. B3D-2 topology-not-assessed run (only fov_topology_unresolved) -------

test("10: a topology-not-assessed run carrying only fov_topology_unresolved is still assessable", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV, FOV + 2])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, CAMERA_OUTSIDE)]));
  // An invalid (non-ascending) topology yields exactly fov_topology_unresolved.
  const notAssessed = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    run,
    topology([FOV + 2, FOV], 2),
    VALID_POLICY
  );
  assert.deepEqual(notAssessed.diagnosticRun.refusalReasons, [
    "fov_topology_unresolved",
  ]);

  const result = evaluateTypeBFrameTruncationCompatibility(
    snapshot,
    notAssessed.diagnosticRun
  );
  assert.equal(result.status, "evaluated");
  assert.ok(result.records.length > 0);
});

// --- 11. upstream B3C refusal / non-topology refusal -> upstream not-assessed -

test("11: a B3C refusal or a non-topology run refusal yields an upstream not-assessed result", () => {
  const snapshot = buildSnapshot();

  // Sub-case a: a non-topology run-level refusal.
  const tgOk = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const refusedRun: TypeBP3pDiagnosticRunRecord = {
    ...buildRun(tgOk, () => poseHyps([hyp(0, CAMERA_OUTSIDE)])),
    refusalReasons: ["pose_multiplicity_unresolved"],
  };
  const runLevel = evaluateTypeBFrameTruncationCompatibility(
    snapshot,
    refusedRun
  );
  assert.equal(runLevel.status, "not_assessed");
  assert.deepEqual(runLevel.notAssessedReasons, [
    "upstream_diagnostic_run_not_compatibility_assessable",
  ]);
  assert.deepEqual(runLevel.records, []);
  assert.deepEqual(runLevel.diagnosticRun, refusedRun);

  // Sub-case b: an upstream B3C refusal (no FOV probes).
  const tgRefused = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [])
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
  const upstream = evaluateTypeBFrameTruncationCompatibility(snapshot, echoRun);
  assert.equal(upstream.status, "not_assessed");
  assert.deepEqual(upstream.notAssessedReasons, [
    "upstream_diagnostic_run_not_compatibility_assessable",
  ]);
  assert.deepEqual(upstream.records, []);
  assert.deepEqual(upstream.diagnosticRun, echoRun);
});

// --- 12. snapshot-basis mismatch / malformed member linkage -> linkage refusal

test("12: basis mismatch or malformed member-to-probe linkage yields a linkage not-assessed result", () => {
  const snapshotA = buildSnapshot({ sourceImageIdentity: "room-a.jpg" });
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshotA,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, CAMERA_OUTSIDE)]));

  // Basis mismatch: a structurally valid but different snapshot.
  const snapshotB = buildSnapshot({ sourceImageIdentity: "room-b.jpg" });
  const mismatch = evaluateTypeBFrameTruncationCompatibility(snapshotB, run);
  assert.equal(mismatch.status, "not_assessed");
  assert.deepEqual(mismatch.notAssessedReasons, [
    "invalid_frame_truncation_compatibility_linkage",
  ]);
  assert.deepEqual(mismatch.records, []);
  assert.deepEqual(mismatch.diagnosticRun, run);

  // Malformed member-to-probe linkage: a member points at a nonexistent probe.
  const broken = structuredClone(run) as TypeBP3pDiagnosticRunRecord;
  (broken.memberCompatibilityRecords[0] as {
    poseProbeEquivalenceKey: string;
  }).poseProbeEquivalenceKey = "no-such-key";
  const brokenResult = evaluateTypeBFrameTruncationCompatibility(
    snapshotA,
    broken
  );
  assert.equal(brokenResult.status, "not_assessed");
  assert.deepEqual(brokenResult.notAssessedReasons, [
    "invalid_frame_truncation_compatibility_linkage",
  ]);
  assert.deepEqual(brokenResult.records, []);
});

// --- 13. inconsistent frozen frame-truncation evidence ----------------------

test("13: inconsistent frozen frame-truncation evidence yields invalid_frame_truncation_evidence", () => {
  // frame_truncated condition but the terminus does not contact the frame.
  const noContact = buildSnapshot({ terminusFrameContact: "no_frame_contact" });
  const tg = generateTypeBBoundedDiagnosticTuples(
    noContact,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const run = buildRun(tg, () => poseHyps([hyp(0, CAMERA_OUTSIDE)]));
  const result = evaluateTypeBFrameTruncationCompatibility(noContact, run);
  assert.equal(result.status, "not_assessed");
  assert.deepEqual(result.notAssessedReasons, [
    "invalid_frame_truncation_evidence",
  ]);
  assert.deepEqual(result.records, []);

  // frame_truncated condition but the terminus status is not frame_truncated.
  const wrongStatus = buildSnapshot({ terminusStatus: "visible" });
  const tg2 = generateTypeBBoundedDiagnosticTuples(
    wrongStatus,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const run2 = buildRun(tg2, () => poseHyps([hyp(0, CAMERA_OUTSIDE)]));
  const result2 = evaluateTypeBFrameTruncationCompatibility(wrongStatus, run2);
  assert.deepEqual(result2.notAssessedReasons, [
    "invalid_frame_truncation_evidence",
  ]);
});

// --- 14. per-probe stage refusal yields no record; siblings preserved --------

test("14: a per-probe stage refusal yields no record and does not suppress sibling valid probes", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV, FOV + 1])
  );
  // Probe FOV refuses (no roots); probe FOV+1 has one outside-projecting root.
  const run = buildRun(tg, (_classIndex, _classKey, fov) =>
    fov === FOV ? refusal() : poseHyps([hyp(0, CAMERA_OUTSIDE)])
  );
  const result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.equal(result.status, "evaluated");
  // Only the sibling valid probe contributes a record.
  assert.equal(result.records.length, 1);
  assert.equal(fovOfKey(result.records[0].poseProbeEquivalenceKey), FOV + 1);
  assert.equal(result.records[0].cropCompatibility, "compatible");
});

// --- 15. original B3C member crop state is unchanged ------------------------

test("15: the original B3C member crop state is left unchanged in the echoed run", () => {
  // frame_truncated source member remains not_evaluated.
  const ft = buildSnapshot();
  const tgFt = generateTypeBBoundedDiagnosticTuples(
    ft,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const runFt = buildRun(tgFt, () => poseHyps([hyp(0, CAMERA_INTERIOR)]));
  const ftResult = evaluateTypeBFrameTruncationCompatibility(ft, runFt);
  assert.equal(ftResult.status, "evaluated");
  for (const member of ftResult.diagnosticRun.memberCompatibilityRecords) {
    assert.equal(member.cropCompatibility, "not_evaluated");
  }
  // The B3D-3 record can be incompatible while the source member stays neutral.
  assert.equal(ftResult.records[0].cropCompatibility, "incompatible");

  // occluded source member remains not_applicable.
  const occ = buildSnapshot({ condition: "occluded" });
  const tgOcc = generateTypeBBoundedDiagnosticTuples(
    occ,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const runOcc = buildRun(tgOcc, () => poseHyps([hyp(0, CAMERA_INTERIOR)]));
  const occResult = evaluateTypeBFrameTruncationCompatibility(occ, runOcc);
  for (const member of occResult.diagnosticRun.memberCompatibilityRecords) {
    assert.equal(member.cropCompatibility, "not_applicable");
  }
});

// --- 16. records preserve class -> member -> FOV -> hypothesis ordering -------

test("16: output records preserve generated class -> member -> FOV -> hypothesis order", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage(
      [
        { identity: "c1", value: 0.5 },
        { identity: "c2", value: 0.75 },
      ],
      [FOV, FOV + 1]
    )
  );
  assert.equal(tg.status, "generated");
  // c1 @ FOV gets two roots; every other probe gets one.
  const run = buildRun(tg, (classIndex, _classKey, fov) =>
    classIndex === 0 && fov === FOV
      ? poseHyps([hyp(0, CAMERA_OUTSIDE), hyp(1, CAMERA_INTERIOR)])
      : poseHyps([hyp(0, CAMERA_OUTSIDE)])
  );
  const result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.equal(result.status, "evaluated");
  const sequence = result.records.map(
    (r) =>
      `${r.primaryProductClassIdentity}|${fovOfKey(
        r.poseProbeEquivalenceKey
      )}|${r.hypothesisIndex}`
  );
  assert.deepEqual(sequence, [
    `c1|${FOV}|0`,
    `c1|${FOV}|1`,
    `c1|${FOV + 1}|0`,
    `c2|${FOV}|0`,
    `c2|${FOV + 1}|0`,
  ]);
});

// --- 17. records never include forbidden fields -----------------------------

test("17: output records contain only the coordinate-free contract keys", () => {
  const snapshot = buildSnapshot({ authorizedAspectRatios: [1, 2] });
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  const run = buildRun(tg, () =>
    poseHyps([hyp(0, CAMERA_INTERIOR), hyp(1, CAMERA_OUTSIDE)])
  );
  const result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.ok(result.records.length > 0);
  const forbidden = [
    "camera",
    "world",
    "projected",
    "pixel",
    "corner",
    "branch",
    "rotation",
    "translation",
    "residual",
    "score",
    "confidence",
    "rank",
    "select",
    "preview",
    "load",
    "apply",
  ];
  for (const record of result.records) {
    assert.deepEqual(Object.keys(record).sort(), RECORD_KEYS);
    for (const key of Object.keys(record)) {
      const lower = key.toLowerCase();
      for (const bad of forbidden) {
        assert.ok(
          !lower.includes(bad),
          `record key "${key}" must not contain forbidden token "${bad}"`
        );
      }
      // No nested coordinate/pose objects: every value is a primitive.
      assert.notEqual(
        typeof (record as Record<string, unknown>)[key],
        "object"
      );
    }
  }
});

// --- 18. deterministic + non-mutating ---------------------------------------

test("18: repeat invocation is deeply equal and leaves inputs unchanged", () => {
  const snapshot = buildSnapshot({ authorizedAspectRatios: [1, 2] });
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV, FOV + 1])
  );
  const run = buildRun(tg, () =>
    poseHyps([hyp(0, CAMERA_INTERIOR), hyp(1, CAMERA_OUTSIDE)])
  );
  const snapshotBefore = structuredClone(snapshot);
  const runBefore = structuredClone(run);

  const first = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  const second = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.deepEqual(first, second);

  // Inputs are untouched.
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(run, runBefore);
});

// --- 19. import surface (no solver / branch impl / Type A / UI / browser) ----

test("19: the module imports only committed Type B contract modules", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    path.join(here, "type-b-frame-truncation-compatibility.ts"),
    "utf8"
  );
  const allowed = new Set([
    "./type-b-evaluator-contract",
    "./type-b-p3p-diagnostic-contract",
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
      "p3p-diagnostic-evaluation",
      "branch-association",
      "tuple-generation",
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

// --- 20. no root is selected / filtered / reordered / deleted ---------------

test("20: compatibility outcome never selects, filters, reorders, or deletes a root", () => {
  const snapshot = buildSnapshot();
  const tg = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.5", value: 0.5 }], [FOV])
  );
  // Root 0 incompatible (interior), root 1 compatible (outside).
  const run = buildRun(tg, () =>
    poseHyps([hyp(0, CAMERA_INTERIOR), hyp(1, CAMERA_OUTSIDE)])
  );
  const result = evaluateTypeBFrameTruncationCompatibility(snapshot, run);
  assert.equal(result.status, "evaluated");
  // Both roots survive as records; the incompatible one is not removed.
  assert.equal(result.records.length, 2);
  assert.deepEqual(
    result.records.map((r) => r.hypothesisIndex),
    [0, 1]
  );
  // The echoed run's roots are identical in count and order to the input.
  const inStage = run.poseProbeResults[0].poseStageResult;
  const outStage = result.diagnosticRun.poseProbeResults[0].poseStageResult;
  assert.equal(inStage.kind, "pose_hypotheses");
  assert.equal(outStage.kind, "pose_hypotheses");
  if (inStage.kind === "pose_hypotheses" && outStage.kind === "pose_hypotheses") {
    assert.deepEqual(
      outStage.hypotheses.map((h) => h.hypothesisIndex),
      inStage.hypotheses.map((h) => h.hypothesisIndex)
    );
    assert.equal(outStage.hypotheses.length, inStage.hypotheses.length);
  }
});
