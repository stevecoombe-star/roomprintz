// --- Phase B3D-4: Pure Type B Diagnostic Run Assembly tests -----------------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST Type B
// diagnostic-run assembly orchestration. Fixtures are deterministic synthetic
// source-frame evidence generated from KNOWN junction-anchored camera poses (no
// random initialization, no live state) so the REAL committed B3D-1 / B3D-2 /
// B3D-3 leaves run end-to-end. The assembler adds no mathematics or authority;
// these tests verify only orchestration, canonical-run consistency, and strict
// leaf-output preservation.
//
// There is NO DLT / homography, four-corner reconstruction, near-corner
// recovery, ranking, scoring, confidence, selection, UI, preview, load, Apply,
// calibration mutation, persistence, or routing anywhere in the module or these
// tests.

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
  type TypeBDeclaredEndpointRole,
  type TypeBEvidenceSnapshot,
} from "./type-b-evaluator-contract";
import type { TypeBEndpointStatus } from "./type-b-evidence-types";
import { evaluateTypeBP3pDiagnosticRun } from "./type-b-p3p-diagnostic-evaluation";
import {
  TYPE_B_FOV_PROBE_TOPOLOGY_SCHEMA,
  type TypeBFovProbeTopologyDeclaration,
  type TypeBP3pDiagnosticRunRecord,
} from "./type-b-p3p-diagnostic-contract";
import {
  TYPE_B_BRANCH_ASSOCIATION_POLICY_SCHEMA,
  associateTypeBP3pBranchesAndBuildCorridors,
  type TypeBBranchAssociationPolicy,
} from "./type-b-p3p-branch-association";
import { evaluateTypeBFrameTruncationCompatibility } from "./type-b-frame-truncation-compatibility";
import {
  generateTypeBBoundedDiagnosticTuples,
  type TypeBTupleGenerationCoverage,
  type TypeBTupleGenerationResult,
} from "./type-b-tuple-generation";
import * as assemblyModule from "./type-b-diagnostic-run-assembly";
import {
  TYPE_B_DIAGNOSTIC_RUN_ASSEMBLY_SCHEMA,
  assembleTypeBDiagnosticRun,
  type TypeBBranchAssociationAssemblyRequest,
} from "./type-b-diagnostic-run-assembly";

// --- Deterministic synthetic-evidence generators ----------------------------
// These mirror the committed B3D-1 test generators so the real leaves see
// authentic, solvable Type B evidence produced from a known pose.

type V3 = { x: number; y: number; z: number };
type Px = { x: number; y: number };

const FRAME = 1000;

function sub(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}
function cross(a: V3, b: V3): V3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function normalize(a: V3): V3 {
  const l = Math.sqrt(dot(a, a));
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}

function lookAtRotation(camera: V3, target: V3): number[] {
  const forward = normalize(sub(target, camera));
  const worldUp: V3 = { x: 0, y: 1, z: 0 };
  const right = normalize(cross(worldUp, forward));
  const down = cross(forward, right);
  return [
    right.x, right.y, right.z,
    down.x, down.y, down.z,
    forward.x, forward.y, forward.z,
  ];
}

function projectWorld(R: number[], camera: V3, point: V3, fovDeg: number): Px {
  const fovRad = (fovDeg * Math.PI) / 180;
  const fy = FRAME / (2 * Math.tan(fovRad / 2));
  const fx = fy;
  const cx = FRAME / 2;
  const cy = FRAME / 2;
  const rel = sub(point, camera);
  const camPoint = {
    x: R[0] * rel.x + R[1] * rel.y + R[2] * rel.z,
    y: R[3] * rel.x + R[4] * rel.y + R[5] * rel.z,
    z: R[6] * rel.x + R[7] * rel.y + R[8] * rel.z,
  };
  return {
    x: fx * (camPoint.x / camPoint.z) + cx,
    y: fy * (camPoint.y / camPoint.z) + cy,
  };
}

type SnapshotOptions = {
  readonly worldWidth?: number;
  readonly product: number;
  readonly camera: V3;
  readonly targetX?: number;
  readonly fovDeg?: number;
  readonly authorizedAspectRatios?: readonly number[];
  readonly latentCondition?: "frame_truncated" | "occluded";
  readonly junctionRearRole?: TypeBDeclaredEndpointRole;
  readonly junctionSideRole?: TypeBDeclaredEndpointRole;
  readonly sourceImageIdentity?: string;
};

// Builds a frozen snapshot whose declared image evidence is the deterministic
// projection of the junction-anchored world points (J, R, S) through a known
// pose, so the real B3D-1 evaluator recovers at least one hypothesis.
function buildSyntheticSnapshot(opts: SnapshotOptions): TypeBEvidenceSnapshot {
  const worldWidth = opts.worldWidth ?? 1;
  const fovDeg = opts.fovDeg ?? 60;
  const junctionRearRole = opts.junctionRearRole ?? "start";
  const junctionSideRole = opts.junctionSideRole ?? "start";
  const latentCondition = opts.latentCondition ?? "frame_truncated";

  const worldJ: V3 = { x: 0, y: 0, z: 0 };
  const worldR: V3 = { x: worldWidth, y: 0, z: 0 };
  const worldS: V3 = { x: 0, y: 0, z: opts.product * worldWidth };
  const R = lookAtRotation(opts.camera, {
    x: opts.targetX ?? worldWidth / 2,
    y: 0,
    z: (opts.product * worldWidth) / 2,
  });

  const pJ = projectWorld(R, opts.camera, worldJ, fovDeg);
  const pR = projectWorld(R, opts.camera, worldR, fovDeg);
  const pS = projectWorld(R, opts.camera, worldS, fovDeg);
  const toNorm = (px: Px) => ({ x: px.x / FRAME, y: px.y / FRAME });

  const rearStartNorm = junctionRearRole === "start" ? toNorm(pJ) : toNorm(pR);
  const rearEndNorm = junctionRearRole === "start" ? toNorm(pR) : toNorm(pJ);

  const sideStartNorm = junctionSideRole === "start" ? toNorm(pJ) : toNorm(pS);
  const sideEndNorm = junctionSideRole === "start" ? toNorm(pS) : toNorm(pJ);
  const sideTerminusStatus: TypeBEndpointStatus = latentCondition;
  const sideStartStatus: TypeBEndpointStatus =
    junctionSideRole === "start" ? "visible" : sideTerminusStatus;
  const sideEndStatus: TypeBEndpointStatus =
    junctionSideRole === "start" ? sideTerminusStatus : "visible";

  return {
    schema: TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    evidenceFamily: "rear_seam_plus_strong_side_seam",
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    basis: {
      sourceImageIdentity: opts.sourceImageIdentity ?? "synthetic-room.jpg",
      sourceFrameKey: `${FRAME}x${FRAME}`,
      sourceFrame: { width: FRAME, height: FRAME },
      candidateIdentity: "cand-synthetic",
      floorPolygonKey: "poly-synthetic",
    },
    rearSeam: {
      role: "rear_floor_wall_seam",
      startNorm: rearStartNorm,
      endNorm: rearEndNorm,
      startEndpointStatus: "visible",
      endEndpointStatus: "visible",
      startFrameContact: "no_frame_contact",
      endFrameContact: "no_frame_contact",
      occlusionStatus: "none_observed",
    },
    strongSideSeam: {
      role: "side_wall_floor_seam",
      startNorm: sideStartNorm,
      endNorm: sideEndNorm,
      startEndpointStatus: sideStartStatus,
      endEndpointStatus: sideEndStatus,
      startFrameContact:
        junctionSideRole === "start"
          ? "no_frame_contact"
          : latentCondition === "frame_truncated"
            ? "contacts_frame"
            : "no_frame_contact",
      endFrameContact:
        junctionSideRole === "start"
          ? latentCondition === "frame_truncated"
            ? "contacts_frame"
            : "no_frame_contact"
          : "no_frame_contact",
      occlusionStatus: "none_observed",
    },
    latentNearCornerCondition: latentCondition,
    floorAssumptions: {
      worldWidth,
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
      junctionRearEndpoint: junctionRearRole,
      junctionSideEndpoint: junctionSideRole,
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

// A shared valid single-probe primary case (near-side, above-floor camera).
const PRIMARY_PRODUCT = 0.75;
const PRIMARY_CAMERA: V3 = { x: 0.4, y: 1.4, z: 2.2 };
const PRIMARY_FOV = 60;

function primarySnapshot(
  overrides: Partial<SnapshotOptions> = {}
): TypeBEvidenceSnapshot {
  return buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    ...overrides,
  });
}

function primaryTuples(
  snapshot: TypeBEvidenceSnapshot,
  fovProbesDeg: readonly number[] = [PRIMARY_FOV],
  classes: readonly { identity: string; value: number }[] = [
    { identity: "p-0.75", value: PRIMARY_PRODUCT },
  ]
): TypeBTupleGenerationResult {
  return generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage(classes, fovProbesDeg)
  );
}

// Deep walk collecting every object key (lowercased) across the whole result.
function collectKeys(value: unknown, acc: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
    return;
  }
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) {
      acc.add(key.toLowerCase());
      collectKeys((value as Record<string, unknown>)[key], acc);
    }
  }
}

// --- 1. Runtime export surface ----------------------------------------------

test("1: the module exports only its schema constant and the assembly function", () => {
  const runtimeKeys = Object.keys(assemblyModule).sort();
  assert.deepEqual(runtimeKeys, [
    "TYPE_B_DIAGNOSTIC_RUN_ASSEMBLY_SCHEMA",
    "assembleTypeBDiagnosticRun",
  ]);
  assert.equal(
    TYPE_B_DIAGNOSTIC_RUN_ASSEMBLY_SCHEMA,
    "vibode-type-b-diagnostic-run-assembly/v0"
  );
  assert.equal(typeof assembleTypeBDiagnosticRun, "function");
});

// --- 2. No association requested --------------------------------------------

test("2: no-association input runs B3D-1 -> B3D-3 with a null branch association", () => {
  const snapshot = primarySnapshot();
  const tupleGeneration = primaryTuples(snapshot);
  assert.equal(tupleGeneration.status, "generated");

  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: null,
  });

  assert.equal(result.schema, TYPE_B_DIAGNOSTIC_RUN_ASSEMBLY_SCHEMA);
  assert.equal(result.branchAssociation, null);

  // p3pDiagnosticRun is exactly the direct B3D-1 output.
  const directB3d1 = evaluateTypeBP3pDiagnosticRun(snapshot, tupleGeneration);
  assert.deepEqual(result.p3pDiagnosticRun, directB3d1);

  // The B3D-3 result is a single frame-truncation evaluation of the B3D-1 run.
  const directB3d3 = evaluateTypeBFrameTruncationCompatibility(
    snapshot,
    directB3d1
  );
  assert.deepEqual(result.frameTruncationCompatibility, directB3d3);

  // Canonical run equals the B3D-3-echoed run.
  assert.deepEqual(
    result.diagnosticRun,
    result.frameTruncationCompatibility.diagnosticRun
  );

  // The whole envelope equals a manual composition of the two leaves.
  assert.deepEqual(result, {
    schema: TYPE_B_DIAGNOSTIC_RUN_ASSEMBLY_SCHEMA,
    p3pDiagnosticRun: directB3d1,
    branchAssociation: null,
    diagnosticRun: directB3d3.diagnosticRun,
    frameTruncationCompatibility: directB3d3,
  });
});

// --- 3. Association requested (valid) ---------------------------------------

test("3: a valid association request runs B3D-1 -> B3D-2 -> B3D-3 over the associated run", () => {
  const snapshot = primarySnapshot();
  const tupleGeneration = primaryTuples(snapshot);
  const request: TypeBBranchAssociationAssemblyRequest = {
    topology: topology([PRIMARY_FOV], 1),
    policy: VALID_POLICY,
  };

  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: request,
  });

  // B3D-2 was invoked once and its output is preserved directly.
  assert.notEqual(result.branchAssociation, null);
  assert.equal(result.branchAssociation!.status, "associated");

  // The final canonical run carries the B3D-2 topology and corridors.
  assert.deepEqual(result.diagnosticRun.fovTopology, request.topology);
  assert.ok(result.diagnosticRun.branchCorridors.length > 0);

  // B3D-3 was evaluated against the post-association run.
  const b3d1 = evaluateTypeBP3pDiagnosticRun(snapshot, tupleGeneration);
  const b3d2 = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    b3d1,
    request.topology,
    request.policy
  );
  const b3d3 = evaluateTypeBFrameTruncationCompatibility(
    snapshot,
    b3d2.diagnosticRun
  );
  assert.deepEqual(result.p3pDiagnosticRun, b3d1);
  assert.deepEqual(result.branchAssociation, b3d2);
  assert.deepEqual(result.frameTruncationCompatibility, b3d3);
  assert.deepEqual(result.diagnosticRun, b3d3.diagnosticRun);

  // The run supplied to B3D-3 equals the B3D-2 echoed run.
  assert.deepEqual(
    result.branchAssociation!.diagnosticRun,
    b3d2.diagnosticRun
  );
});

// --- 4. B3D-2 topology / corridors survive B3D-3 + assembly unchanged --------

test("4: valid B3D-2 topology and corridors are byte-for-byte unchanged after assembly", () => {
  const snapshot = primarySnapshot();
  const tupleGeneration = primaryTuples(snapshot);
  const request: TypeBBranchAssociationAssemblyRequest = {
    topology: topology([PRIMARY_FOV], 1),
    policy: VALID_POLICY,
  };
  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: request,
  });

  const associatedRun = result.branchAssociation!.diagnosticRun;
  // The canonical run's topology/corridors equal the B3D-2 associated run's.
  assert.deepEqual(result.diagnosticRun.fovTopology, associatedRun.fovTopology);
  assert.deepEqual(
    result.diagnosticRun.branchCorridors,
    associatedRun.branchCorridors
  );
  // ...and equal the originally requested topology exactly.
  assert.deepEqual(result.diagnosticRun.fovTopology, request.topology);
});

// --- 5. Invalid topology -> B3D-2 topology-only non-assessment; B3D-3 assessable

test("5: invalid topology yields a B3D-2 topology-only non-assessment; B3D-3 still evaluates", () => {
  const snapshot = primarySnapshot();
  const tupleGeneration = primaryTuples(snapshot, [PRIMARY_FOV]);
  // A topology whose multiset does not match coverage is topology-unresolved.
  const request: TypeBBranchAssociationAssemblyRequest = {
    topology: topology([PRIMARY_FOV + 1], 1),
    policy: VALID_POLICY,
  };
  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: request,
  });

  assert.equal(result.branchAssociation!.status, "not_assessed");
  assert.deepEqual(result.branchAssociation!.notAssessedReasons, [
    "fov_topology_unresolved",
  ]);
  // The B3D-2 echoed run carries only the topology-only run-level refusal.
  assert.deepEqual(result.branchAssociation!.diagnosticRun.refusalReasons, [
    "fov_topology_unresolved",
  ]);

  // B3D-3 remains compatibility-assessable under the topology-only refusal.
  assert.equal(result.frameTruncationCompatibility.status, "evaluated");
  assert.ok(result.frameTruncationCompatibility.records.length > 0);
  assert.deepEqual(
    result.diagnosticRun,
    result.frameTruncationCompatibility.diagnosticRun
  );
});

// --- 6. Invalid policy -> B3D-2 policy non-assessment; B3D-3 still receives run

test("6: invalid policy yields a B3D-2 policy non-assessment; B3D-3 receives the echoed run", () => {
  const snapshot = primarySnapshot();
  const tupleGeneration = primaryTuples(snapshot, [PRIMARY_FOV]);
  const badPolicy: TypeBBranchAssociationPolicy = {
    ...VALID_POLICY,
    maxNormalizedCameraPositionDelta: -1,
  };
  const request: TypeBBranchAssociationAssemblyRequest = {
    topology: topology([PRIMARY_FOV], 1),
    policy: badPolicy,
  };
  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: request,
  });

  assert.equal(result.branchAssociation!.status, "not_assessed");
  assert.deepEqual(result.branchAssociation!.notAssessedReasons, [
    "invalid_branch_association_policy",
  ]);
  // A policy error adds no topology refusal and generates no corridors.
  assert.deepEqual(result.branchAssociation!.diagnosticRun.refusalReasons, []);
  assert.deepEqual(result.branchAssociation!.diagnosticRun.branchCorridors, []);
  assert.equal(result.branchAssociation!.diagnosticRun.fovTopology, null);

  // B3D-3 still receives (and evaluates) the B3D-2 echoed run.
  assert.equal(result.frameTruncationCompatibility.status, "evaluated");
  assert.deepEqual(
    result.diagnosticRun,
    result.frameTruncationCompatibility.diagnosticRun
  );
});

// --- 7. B3C refusal keeps every requested leaf in the sequence ---------------

test("7: a B3C refusal never throws / repairs / skips leaves when association is requested", () => {
  const snapshot = primarySnapshot();
  // Empty FOV probes -> B3C run-level refusal.
  const tupleGeneration = primaryTuples(snapshot, []);
  assert.equal(tupleGeneration.status, "refused");

  const request: TypeBBranchAssociationAssemblyRequest = {
    topology: topology([PRIMARY_FOV], 1),
    policy: VALID_POLICY,
  };
  let result!: ReturnType<typeof assembleTypeBDiagnosticRun>;
  assert.doesNotThrow(() => {
    result = assembleTypeBDiagnosticRun({
      snapshot,
      tupleGeneration,
      branchAssociation: request,
    });
  });

  // B3D-2 is still invoked (non-null) and preserves its upstream non-assessment.
  assert.notEqual(result.branchAssociation, null);
  assert.equal(result.branchAssociation!.status, "not_assessed");
  assert.deepEqual(result.branchAssociation!.notAssessedReasons, [
    "upstream_diagnostic_run_not_associable",
  ]);

  // B3D-3 is still invoked and preserves its own upstream non-assessment.
  assert.equal(result.frameTruncationCompatibility.status, "not_assessed");
  assert.deepEqual(result.frameTruncationCompatibility.notAssessedReasons, [
    "upstream_diagnostic_run_not_compatibility_assessable",
  ]);

  // p3pDiagnosticRun is the verbatim B3D-1 echo of the refused B3C run.
  assert.deepEqual(
    result.p3pDiagnosticRun,
    evaluateTypeBP3pDiagnosticRun(snapshot, tupleGeneration)
  );
});

// --- 8. B3D-1 malformed tuple-linkage outcome stays atomic through assembly ---

test("8: a B3D-1 tuple-linkage refusal remains atomic; no wrapper repair or partial records", () => {
  const snapshot = primarySnapshot();
  const tupleGeneration = primaryTuples(snapshot, [PRIMARY_FOV]);
  assert.equal(tupleGeneration.status, "generated");
  // Corrupt a tuple's evaluator family -> B3D-1 whole-run linkage refusal.
  const broken = structuredClone(tupleGeneration) as TypeBTupleGenerationResult;
  const firstClass = broken.productClasses[0];
  if (firstClass.status === "generated") {
    (
      firstClass.members[0].tuples[0].tuple as { evaluatorFamily: string }
    ).evaluatorFamily = "some_other_family";
  }

  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration: broken,
    branchAssociation: {
      topology: topology([PRIMARY_FOV], 1),
      policy: VALID_POLICY,
    },
  });

  // The B3D-1 refusal is preserved verbatim, with zero solves.
  assert.deepEqual(result.p3pDiagnosticRun.refusalReasons, [
    "invalid_tuple_generation_linkage",
  ]);
  assert.deepEqual(result.p3pDiagnosticRun.poseProbeResults, []);

  // No leaf invents partial compatibility records.
  assert.deepEqual(result.frameTruncationCompatibility.records, []);
  assert.equal(result.frameTruncationCompatibility.status, "not_assessed");
  // The atomic linkage refusal reason survives to the canonical run unchanged.
  assert.deepEqual(result.diagnosticRun.refusalReasons, [
    "invalid_tuple_generation_linkage",
  ]);
});

// --- 9. Incompatible frame-truncation records do not disturb the run ---------

test("9: frame-truncation incompatible records leave roots, corridors, topology, association intact", () => {
  // A camera whose implied full side-edge endpoint projects strictly interior
  // yields incompatible records without touching the run structure.
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: { x: 0.5, y: 1.2, z: 3.0 },
    fovDeg: PRIMARY_FOV,
  });
  const tupleGeneration = primaryTuples(snapshot, [PRIMARY_FOV]);
  const request: TypeBBranchAssociationAssemblyRequest = {
    topology: topology([PRIMARY_FOV], 1),
    policy: VALID_POLICY,
  };
  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: request,
  });

  // The associated run (pre-B3D-3) and the canonical run agree on everything
  // structural: B3D-3 never mutates the run it is handed.
  const associatedRun = result.branchAssociation!.diagnosticRun;
  assert.deepEqual(
    result.diagnosticRun.poseProbeResults,
    associatedRun.poseProbeResults
  );
  assert.deepEqual(
    result.diagnosticRun.branchCorridors,
    associatedRun.branchCorridors
  );
  assert.deepEqual(result.diagnosticRun.fovTopology, associatedRun.fovTopology);

  // Whatever compatibility states arose, the P3P root census is untouched.
  const before = evaluateTypeBP3pDiagnosticRun(snapshot, tupleGeneration);
  assert.deepEqual(
    result.p3pDiagnosticRun.poseProbeResults,
    before.poseProbeResults
  );
});

// --- 10. occluded -> not_applicable is neutral -------------------------------

test("10: occluded terminus yields not_applicable records without touching roots or corridors", () => {
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    latentCondition: "occluded",
  });
  const tupleGeneration = primaryTuples(snapshot, [PRIMARY_FOV]);
  const request: TypeBBranchAssociationAssemblyRequest = {
    topology: topology([PRIMARY_FOV], 1),
    policy: VALID_POLICY,
  };
  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: request,
  });

  assert.equal(result.frameTruncationCompatibility.status, "evaluated");
  assert.ok(result.frameTruncationCompatibility.records.length > 0);
  for (const record of result.frameTruncationCompatibility.records) {
    assert.equal(record.cropCompatibility, "not_applicable");
  }
  // Roots and corridors are exactly the B3D-2 associated run's.
  const associatedRun = result.branchAssociation!.diagnosticRun;
  assert.deepEqual(
    result.diagnosticRun.poseProbeResults,
    associatedRun.poseProbeResults
  );
  assert.deepEqual(
    result.diagnosticRun.branchCorridors,
    associatedRun.branchCorridors
  );
});

// --- 11. No-association mode creates no topology / corridors / annotations ----

test("11: no-association mode never creates topology, corridors, or annotations", () => {
  const snapshot = primarySnapshot();
  const tupleGeneration = primaryTuples(snapshot, [PRIMARY_FOV]);
  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: null,
  });
  assert.equal(result.branchAssociation, null);
  assert.equal(result.diagnosticRun.fovTopology, null);
  assert.deepEqual(result.diagnosticRun.branchCorridors, []);
});

// --- 12. Run-level refusal reasons preserved exactly; B3D-4 adds none ---------

test("12: existing B3D-1 / B3D-2 run-level refusal reasons are preserved; assembly adds none", () => {
  const snapshot = primarySnapshot();

  // B3D-1 refusal (broken B3C linkage) preserved through no-association mode.
  const tg = primaryTuples(snapshot, [PRIMARY_FOV]);
  const broken = structuredClone(tg) as TypeBTupleGenerationResult;
  const firstClass = broken.productClasses[0];
  if (firstClass.status === "generated") {
    (
      firstClass.members[0].tuples[0].tuple as { evaluatorFamily: string }
    ).evaluatorFamily = "x";
  }
  const noAssoc = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration: broken,
    branchAssociation: null,
  });
  assert.deepEqual(noAssoc.p3pDiagnosticRun.refusalReasons, [
    "invalid_tuple_generation_linkage",
  ]);
  assert.deepEqual(noAssoc.diagnosticRun.refusalReasons, [
    "invalid_tuple_generation_linkage",
  ]);

  // B3D-2 topology-only refusal preserved with no extra assembly reasons.
  const okTg = primaryTuples(snapshot, [PRIMARY_FOV]);
  const topoOnly = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration: okTg,
    branchAssociation: {
      topology: topology([PRIMARY_FOV + 2], 1),
      policy: VALID_POLICY,
    },
  });
  assert.deepEqual(topoOnly.branchAssociation!.diagnosticRun.refusalReasons, [
    "fov_topology_unresolved",
  ]);
  assert.deepEqual(topoOnly.diagnosticRun.refusalReasons, [
    "fov_topology_unresolved",
  ]);
});

// --- 13. Canonical-run deep equality across all sequence shapes --------------

test("13: canonical diagnosticRun deeply equals B3D-3's echoed run in every shape", () => {
  const snapshot = primarySnapshot();
  const okTg = primaryTuples(snapshot, [PRIMARY_FOV]);

  const scenarios: ReturnType<typeof assembleTypeBDiagnosticRun>[] = [
    // No-association success.
    assembleTypeBDiagnosticRun({
      snapshot,
      tupleGeneration: okTg,
      branchAssociation: null,
    }),
    // Successful association.
    assembleTypeBDiagnosticRun({
      snapshot,
      tupleGeneration: okTg,
      branchAssociation: {
        topology: topology([PRIMARY_FOV], 1),
        policy: VALID_POLICY,
      },
    }),
    // Topology-only association non-assessment.
    assembleTypeBDiagnosticRun({
      snapshot,
      tupleGeneration: okTg,
      branchAssociation: {
        topology: topology([PRIMARY_FOV + 3], 1),
        policy: VALID_POLICY,
      },
    }),
    // Upstream (B3C) non-assessment.
    assembleTypeBDiagnosticRun({
      snapshot,
      tupleGeneration: primaryTuples(snapshot, []),
      branchAssociation: {
        topology: topology([PRIMARY_FOV], 1),
        policy: VALID_POLICY,
      },
    }),
  ];

  for (const result of scenarios) {
    assert.deepEqual(
      result.diagnosticRun,
      result.frameTruncationCompatibility.diagnosticRun
    );
  }
});

// --- 14. p3pDiagnosticRun is a pre-association B3D-1 record -------------------

test("14: p3pDiagnosticRun stays the pre-association B3D-1 record, not retroactively changed", () => {
  const snapshot = primarySnapshot();
  const tupleGeneration = primaryTuples(snapshot, [PRIMARY_FOV]);
  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: {
      topology: topology([PRIMARY_FOV], 1),
      policy: VALID_POLICY,
    },
  });

  // It equals the direct B3D-1 output, which carries no topology / corridors.
  const directB3d1 = evaluateTypeBP3pDiagnosticRun(snapshot, tupleGeneration);
  assert.deepEqual(result.p3pDiagnosticRun, directB3d1);
  assert.equal(result.p3pDiagnosticRun.fovTopology, null);
  assert.deepEqual(result.p3pDiagnosticRun.branchCorridors, []);

  // The post-association canonical run differs (it carries topology), proving
  // the pre-association record was not retroactively mutated.
  assert.notEqual(result.diagnosticRun.fovTopology, null);
});

// --- 15. Result ordering inherited unchanged ---------------------------------

test("15: pose-probe, branch, and compatibility-record ordering are inherited unchanged", () => {
  const snapshot = primarySnapshot({ authorizedAspectRatios: [1.0, 1.3] });
  const tupleGeneration = primaryTuples(
    snapshot,
    [PRIMARY_FOV, PRIMARY_FOV + 1],
    [
      { identity: "c1", value: PRIMARY_PRODUCT },
      { identity: "c2", value: 0.5 },
    ]
  );
  assert.equal(tupleGeneration.status, "generated");
  const request: TypeBBranchAssociationAssemblyRequest = {
    topology: topology([PRIMARY_FOV, PRIMARY_FOV + 1], 1),
    policy: VALID_POLICY,
  };
  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: request,
  });

  const b3d1 = evaluateTypeBP3pDiagnosticRun(snapshot, tupleGeneration);
  const b3d2 = associateTypeBP3pBranchesAndBuildCorridors(
    snapshot,
    b3d1,
    request.topology,
    request.policy
  );
  const b3d3 = evaluateTypeBFrameTruncationCompatibility(
    snapshot,
    b3d2.diagnosticRun
  );

  // B3D-1 pose-probe order.
  assert.deepEqual(
    result.p3pDiagnosticRun.poseProbeResults.map(
      (r) => r.poseProbeEquivalence.poseProbeEquivalenceKey
    ),
    b3d1.poseProbeResults.map(
      (r) => r.poseProbeEquivalence.poseProbeEquivalenceKey
    )
  );
  // B3D-2 branch order.
  assert.deepEqual(
    result.diagnosticRun.branchCorridors.map((c) => c.branchIndex),
    b3d2.diagnosticRun.branchCorridors.map((c) => c.branchIndex)
  );
  // B3D-3 compatibility-record order.
  assert.deepEqual(
    result.frameTruncationCompatibility.records,
    b3d3.records
  );
});

// --- 16. Deterministic + non-mutating ----------------------------------------

test("16: repeat invocation is deeply equal and mutates no input", () => {
  const snapshot = primarySnapshot({ authorizedAspectRatios: [1.0, 1.3] });
  const tupleGeneration = primaryTuples(snapshot, [PRIMARY_FOV, PRIMARY_FOV + 1]);
  const request: TypeBBranchAssociationAssemblyRequest = {
    topology: topology([PRIMARY_FOV, PRIMARY_FOV + 1], 1),
    policy: VALID_POLICY,
  };
  const input = { snapshot, tupleGeneration, branchAssociation: request };

  const snapshotBefore = structuredClone(snapshot);
  const tupleGenerationBefore = structuredClone(tupleGeneration);
  const requestBefore = structuredClone(request);

  const first = assembleTypeBDiagnosticRun(input);
  const second = assembleTypeBDiagnosticRun(input);
  assert.deepEqual(first, second);

  // Inputs (including nested topology + policy) are untouched.
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(tupleGeneration, tupleGenerationBefore);
  assert.deepEqual(request, requestBefore);
  assert.deepEqual(request.topology, requestBefore.topology);
  assert.deepEqual(request.policy, requestBefore.policy);
});

// --- 17. Malformed non-null request still invokes B3D-2 ----------------------

test("17: a malformed non-null association request is not silently treated as no request", () => {
  const snapshot = primarySnapshot();
  const tupleGeneration = primaryTuples(snapshot, [PRIMARY_FOV]);
  // A non-null but structurally malformed request: empty topology/policy.
  const malformed = {
    topology: {} as unknown as TypeBFovProbeTopologyDeclaration,
    policy: {} as unknown as TypeBBranchAssociationPolicy,
  };
  let result!: ReturnType<typeof assembleTypeBDiagnosticRun>;
  assert.doesNotThrow(() => {
    result = assembleTypeBDiagnosticRun({
      snapshot,
      tupleGeneration,
      branchAssociation: malformed,
    });
  });

  // B3D-2 was called (non-null result) and its own non-assessment path governs.
  assert.notEqual(result.branchAssociation, null);
  assert.equal(result.branchAssociation!.status, "not_assessed");
  assert.ok(result.branchAssociation!.notAssessedReasons.length > 0);
  // B3D-3 is still called against the B3D-2 echoed run.
  assert.deepEqual(
    result.diagnosticRun,
    result.frameTruncationCompatibility.diagnosticRun
  );
});

// --- 18. Import surface (orchestration-only; no UI / solver / etc.) -----------

test("18: the assembly module imports only committed Type B leaves + contracts", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    path.join(here, "type-b-diagnostic-run-assembly.ts"),
    "utf8"
  );
  const allowed = new Set([
    "./type-b-evaluator-contract",
    "./type-b-p3p-diagnostic-contract",
    "./type-b-p3p-diagnostic-evaluation",
    "./type-b-p3p-branch-association",
    "./type-b-frame-truncation-compatibility",
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
      "type-a",
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

// --- 19. Result carries no ranking / authority field -------------------------

test("19: the result envelope carries no score/confidence/rank/selection/apply field", () => {
  const snapshot = primarySnapshot({ authorizedAspectRatios: [1.0, 1.3] });
  const tupleGeneration = primaryTuples(snapshot, [PRIMARY_FOV, PRIMARY_FOV + 1]);
  const result = assembleTypeBDiagnosticRun({
    snapshot,
    tupleGeneration,
    branchAssociation: {
      topology: topology([PRIMARY_FOV, PRIMARY_FOV + 1], 1),
      policy: VALID_POLICY,
    },
  });
  const keys = new Set<string>();
  collectKeys(result, keys);
  const forbidden = [
    "score",
    "confidence",
    "rank",
    "winner",
    "recommend",
    "selected",
    "selection",
    "preview",
    "load",
    "apply",
    "calibration",
  ];
  for (const key of keys) {
    for (const bad of forbidden) {
      assert.ok(
        !key.includes(bad),
        `result key "${key}" must not contain forbidden token "${bad}"`
      );
    }
  }
});

// --- 20. No leaf algorithm is reimplemented in the assembly module -----------

test("20: the assembly module invokes committed leaves and reimplements none", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    path.join(here, "type-b-diagnostic-run-assembly.ts"),
    "utf8"
  );
  // It invokes each committed public leaf function exactly once.
  for (const leaf of [
    "evaluateTypeBP3pDiagnosticRun(",
    "associateTypeBP3pBranchesAndBuildCorridors(",
    "evaluateTypeBFrameTruncationCompatibility(",
  ]) {
    const occurrences = source.split(leaf).length - 1;
    assert.equal(occurrences, 1, `${leaf} must be invoked exactly once`);
  }
  // It performs no mathematics of its own (no leaf algorithm is duplicated).
  assert.ok(!/\bMath\./.test(source), "assembly must contain no Math. usage");
  // No telltale reimplementations of committed leaf internals.
  for (const token of [
    "solveTypeBRealQuarticRoots",
    "buildGrunertPolynomial",
    "buildBranchCorridors",
    "evaluateFrameTruncatedCompatibility",
    "unionNodes",
    "rotationGeodesicDeg",
  ]) {
    assert.ok(
      !source.includes(token),
      `assembly must not reimplement leaf internal "${token}"`
    );
  }
});
