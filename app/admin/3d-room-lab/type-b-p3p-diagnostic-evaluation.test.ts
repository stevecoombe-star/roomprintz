// --- Phase B3D-1: Pure All-Root Grunert P3P Diagnostic Evaluator tests -------
// Pure unit tests (node:test) for the LAB-ONLY, DIAGNOSTIC-FIRST Type B P3P
// diagnostic EVALUATOR. Fixtures are deterministic synthetic source-frame
// evidence generated from KNOWN junction-anchored camera poses (no random
// initialization, no live state) and are kept local to this file.
//
// There is NO DLT / homography, four-corner reconstruction, virtual
// quadrilateral, generic optimizer, sign-change-only root finding, FOV topology
// validation, corridor formation, branch association, crop test, UI, preview,
// load, Apply, calibration mutation, persistence, routing, or ranking anywhere.

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
import {
  evaluateTypeBP3pDiagnosticRun,
  solveTypeBRealQuarticRoots,
} from "./type-b-p3p-diagnostic-evaluation";
import {
  generateTypeBBoundedDiagnosticTuples,
  type TypeBTupleGenerationCoverage,
  type TypeBTupleGenerationResult,
} from "./type-b-tuple-generation";

// --- Deterministic synthetic-evidence generators ---------------------------

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

// World->camera rotation (CV frame: x-right, y-down, z-forward) from a lookAt.
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

// Project a world point into source pixels via the SAME CV / FOV convention the
// evaluator uses (square pixels, principal point at frame center). Returns the
// depth so a test can confirm cheirality of the synthetic pose.
function projectWorld(
  R: number[],
  camera: V3,
  point: V3,
  fovDeg: number
): { px: Px; depth: number } {
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
    px: { x: fx * (camPoint.x / camPoint.z) + cx, y: fy * (camPoint.y / camPoint.z) + cy },
    depth: camPoint.z,
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
  // Status overrides to exercise per-probe preflight refusals.
  readonly junctionRearStatus?: TypeBEndpointStatus;
  readonly nonJunctionRearStatus?: TypeBEndpointStatus;
  readonly sideTerminusStatus?: TypeBEndpointStatus;
  // Force coincident junction/non-junction rear image points (ray degeneracy).
  readonly coincidentRearPoints?: boolean;
  // Malformed source frame (per-probe unsupported-constraint-set path).
  readonly sourceFrameWidth?: number;
  readonly sourceFrameHeight?: number;
  readonly sourceImageIdentity?: string;
};

// Builds a frozen snapshot whose declared image evidence is the deterministic
// projection of the junction-anchored world points (J, R, S) through a known
// pose. Endpoint roles default to rear "start" / side "start".
function buildSyntheticSnapshot(opts: SnapshotOptions): TypeBEvidenceSnapshot {
  const worldWidth = opts.worldWidth ?? 1;
  const fovDeg = opts.fovDeg ?? 60;
  const junctionRearRole = opts.junctionRearRole ?? "start";
  const junctionSideRole = opts.junctionSideRole ?? "start";
  const latentCondition = opts.latentCondition ?? "frame_truncated";
  const width = opts.sourceFrameWidth ?? FRAME;
  const height = opts.sourceFrameHeight ?? FRAME;

  const worldJ: V3 = { x: 0, y: 0, z: 0 };
  const worldR: V3 = { x: worldWidth, y: 0, z: 0 };
  const worldS: V3 = { x: 0, y: 0, z: opts.product * worldWidth };
  const R = lookAtRotation(opts.camera, {
    x: opts.targetX ?? worldWidth / 2,
    y: 0,
    z: (opts.product * worldWidth) / 2,
  });

  const pJ = projectWorld(R, opts.camera, worldJ, fovDeg).px;
  const pR = opts.coincidentRearPoints
    ? pJ
    : projectWorld(R, opts.camera, worldR, fovDeg).px;
  const pS = projectWorld(R, opts.camera, worldS, fovDeg).px;

  const toNorm = (px: Px) => ({ x: px.x / FRAME, y: px.y / FRAME });

  // Rear seam: junction endpoint carries pJ, non-junction endpoint carries pR.
  const rearStartNorm = junctionRearRole === "start" ? toNorm(pJ) : toNorm(pR);
  const rearEndNorm = junctionRearRole === "start" ? toNorm(pR) : toNorm(pJ);
  const junctionRearStatus = opts.junctionRearStatus ?? "visible";
  const nonJunctionRearStatus = opts.nonJunctionRearStatus ?? "visible";
  const rearStartStatus =
    junctionRearRole === "start" ? junctionRearStatus : nonJunctionRearStatus;
  const rearEndStatus =
    junctionRearRole === "start" ? nonJunctionRearStatus : junctionRearStatus;

  // Side seam: junction endpoint carries pJ, terminus endpoint carries pS.
  const sideStartNorm = junctionSideRole === "start" ? toNorm(pJ) : toNorm(pS);
  const sideEndNorm = junctionSideRole === "start" ? toNorm(pS) : toNorm(pJ);
  const sideTerminusStatus = opts.sideTerminusStatus ?? latentCondition;
  const sideStartStatus =
    junctionSideRole === "start" ? "visible" : sideTerminusStatus;
  const sideEndStatus =
    junctionSideRole === "start" ? sideTerminusStatus : "visible";

  return {
    schema: TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
    evidenceFamily: "rear_seam_plus_strong_side_seam",
    evaluatorFamily: TYPE_B_EVALUATOR_FAMILY,
    basis: {
      sourceImageIdentity: opts.sourceImageIdentity ?? "synthetic-room.jpg",
      sourceFrameKey: `${width}x${height}`,
      sourceFrame: { width, height },
      candidateIdentity: "cand-synthetic",
      floorPolygonKey: "poly-synthetic",
    },
    rearSeam: {
      role: "rear_floor_wall_seam",
      startNorm: rearStartNorm,
      endNorm: rearEndNorm,
      startEndpointStatus: rearStartStatus,
      endEndpointStatus: rearEndStatus,
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
      startFrameContact: "no_frame_contact",
      endFrameContact:
        latentCondition === "frame_truncated" ? "contacts_frame" : "no_frame_contact",
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

// Deep forbidden-token guard (mirrors the B3C / B3D-R contract tests): NO key in
// the emitted record may express ranking, score, confidence, selection, etc.
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

function determinant3(m: readonly number[]): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

function generateAndEvaluate(
  snapshot: TypeBEvidenceSnapshot,
  coverage: TypeBTupleGenerationCoverage
) {
  const tupleGeneration = generateTypeBBoundedDiagnosticTuples(snapshot, coverage);
  const run = evaluateTypeBP3pDiagnosticRun(snapshot, tupleGeneration);
  return { tupleGeneration, run };
}

// A shared valid single-probe primary case (near-side, above-floor camera).
const PRIMARY_PRODUCT = 0.75;
const PRIMARY_CAMERA: V3 = { x: 0.4, y: 1.4, z: 2.2 };
const PRIMARY_FOV = 60;

// A shared multi-root / far-side-ghost case (two positive-distance roots).
const MULTI_PRODUCT = 0.3;
const MULTI_CAMERA: V3 = { x: -2, y: 0.2, z: -3 };
const MULTI_FOV = 60;

// --- 1. Tangential / repeated real root is included (no sign-change blindness)

test("1: a quartic with a repeated/tangential real root includes that root", () => {
  // (x - 1)^2 (x^2 + 1) = x^4 - 2x^3 + 2x^2 - 2x + 1. The real root x = 1 is a
  // tangential (even-multiplicity) touch point: a sign-change scan would miss
  // it, an analytic all-root path must not.
  const roots = solveTypeBRealQuarticRoots([1, -2, 2, -2, 1]);
  assert.equal(roots.length, 1);
  assert.ok(Math.abs(roots[0] - 1) < 1e-9, `expected root ~1, got ${roots[0]}`);

  // (x - 1)^2 (x - 2)(x - 3) = x^4 - 7x^3 + 17x^2 - 17x + 6: double root 1 kept
  // once, plus 2 and 3.
  const triple = solveTypeBRealQuarticRoots([1, -7, 17, -17, 6]);
  assert.equal(triple.length, 3);
  assert.ok(Math.abs(triple[0] - 1) < 1e-9);
  assert.ok(Math.abs(triple[1] - 2) < 1e-9);
  assert.ok(Math.abs(triple[2] - 3) < 1e-9);
});

// --- 2. Honest reduced-degree handling --------------------------------------

test("2: the quartic helper handles reduced degree (cubic/quadratic/linear/constant)", () => {
  // Cubic: (x - 1)(x - 2)(x - 3) with a4 = 0.
  const cubic = solveTypeBRealQuarticRoots([0, 1, -6, 11, -6]);
  assert.equal(cubic.length, 3);
  assert.ok(Math.abs(cubic[0] - 1) < 1e-9);
  assert.ok(Math.abs(cubic[2] - 3) < 1e-9);

  // Quadratic: x^2 - 3x + 2 with a4 = a3 = 0.
  const quad = solveTypeBRealQuarticRoots([0, 0, 1, -3, 2]);
  assert.deepEqual(
    quad.map((r) => Math.round(r)),
    [1, 2]
  );

  // Linear: 2x - 4 with a4 = a3 = a2 = 0.
  const linear = solveTypeBRealQuarticRoots([0, 0, 0, 2, -4]);
  assert.equal(linear.length, 1);
  assert.ok(Math.abs(linear[0] - 2) < 1e-12);

  // Non-zero constant: no finite real roots.
  assert.deepEqual(solveTypeBRealQuarticRoots([0, 0, 0, 0, 5]), []);
  // All-zero: no finite real roots (not infinitely many).
  assert.deepEqual(solveTypeBRealQuarticRoots([0, 0, 0, 0, 0]), []);
});

// --- 3. Deterministic, ascending, finite, numeric-only dedup ----------------

test("3: quartic real roots are deterministic, ascending, finite, numeric-dedup only", () => {
  // x^4 - 5x^2 + 4 -> {-2, -1, 1, 2}.
  const first = solveTypeBRealQuarticRoots([1, 0, -5, 0, 4]);
  const second = solveTypeBRealQuarticRoots([1, 0, -5, 0, 4]);
  assert.deepEqual(first, second);
  for (let i = 1; i < first.length; i += 1) {
    assert.ok(first[i] > first[i - 1], "roots must be strictly ascending");
  }
  assert.ok(first.every((r) => Number.isFinite(r)));
  assert.deepEqual(
    first.map((r) => Math.round(r)),
    [-2, -1, 1, 2]
  );

  // Malformed / non-finite coefficients never throw and yield [].
  assert.deepEqual(solveTypeBRealQuarticRoots([Number.NaN, 1, 2, 3, 4]), []);
  assert.deepEqual(
    solveTypeBRealQuarticRoots([1, Number.POSITIVE_INFINITY, 2, 3, 4]),
    []
  );

  // A double root collapses to one entry (numeric identity), never rounded away.
  const doubleRoot = solveTypeBRealQuarticRoots([1, -4, 5, -4, 4]); // (x-2)^2(x^2+1)
  assert.equal(doubleRoot.length, 1);
  assert.ok(Math.abs(doubleRoot[0] - 2) < 1e-9);
});

// --- 4. Synthetic valid P3P recovers a known generated pose -----------------

test("4: a synthetic valid P3P case returns a hypothesis matching the known pose", () => {
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
  });
  const { tupleGeneration, run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  assert.equal(tupleGeneration.status, "generated");
  assert.equal(run.poseProbeResults.length, 1);
  const result = run.poseProbeResults[0];
  assert.equal(result.poseStageResult.kind, "pose_hypotheses");
  if (result.poseStageResult.kind !== "pose_hypotheses") return;

  const match = result.poseStageResult.hypotheses.find(
    (h) =>
      Math.abs(h.cameraPositionWorld.x - PRIMARY_CAMERA.x) < 1e-6 &&
      Math.abs(h.cameraPositionWorld.y - PRIMARY_CAMERA.y) < 1e-6 &&
      Math.abs(h.cameraPositionWorld.z - PRIMARY_CAMERA.z) < 1e-6
  );
  assert.ok(match, "a hypothesis must match the known junction-anchored pose");
  assert.equal(match!.poseComparisonReferenceFrame, "junction_anchored/v0");
  // Construction residuals are numerically satisfied (construction-satisfying).
  for (const obs of match!.constructionObservations) {
    assert.equal(obs.interpretation, "construction_satisfying");
    assert.ok(obs.residualPx !== null && obs.residualPx < 1e-4);
  }
  // The known near-side, above-floor camera passes both position observations.
  const above = match!.plausibility.find(
    (p) => p.checkId === "camera_above_floor/v0"
  );
  const nearSide = match!.plausibility.find(
    (p) => p.checkId === "camera_near_side_of_rear_seam/v0"
  );
  assert.equal(above?.state, "passed");
  assert.equal(nearSide?.state, "passed");
  // Census monotonicity holds on the finite evaluation path.
  const c = result.rootCensus;
  assert.ok(c.deduplicatedRootCount <= c.positiveDistanceRootCount);
  assert.ok(c.positiveDistanceRootCount <= c.realRootCount);
  assert.ok(c.realRootCount <= c.algebraicCandidateCount);
});

// --- 5. Every hypothesis is well-formed and unranked ------------------------

test("5: all returned hypotheses carry stable indices, frame, rotation, and observations", () => {
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
  });
  const { run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  const result = run.poseProbeResults[0];
  assert.equal(result.poseStageResult.kind, "pose_hypotheses");
  if (result.poseStageResult.kind !== "pose_hypotheses") return;
  const hypotheses = result.poseStageResult.hypotheses;
  assert.ok(hypotheses.length >= 1);

  const expectedPlausibilityIds = [
    "rotation_numerical_health/v0",
    "image_ray_conditioning/v0",
    "camera_above_floor/v0",
    "camera_near_side_of_rear_seam/v0",
    "root_separation/v0",
  ];
  const expectedConstructionKinds = [
    "junction_rear_point",
    "non_junction_rear_point",
    "side_terminus_point",
    "side_chord_alignment",
  ];

  hypotheses.forEach((h, index) => {
    // Stable 0-based enumeration only.
    assert.equal(h.hypothesisIndex, index);
    assert.equal(h.poseComparisonReferenceFrame, "junction_anchored/v0");
    // Proper finite rotation (det ~ +1).
    assert.ok(h.worldToCameraRotation.every((v) => Number.isFinite(v)));
    assert.ok(Math.abs(determinant3(h.worldToCameraRotation) - 1) < 1e-6);
    // Construction observations: exactly the four kinds, all satisfying.
    assert.deepEqual(
      h.constructionObservations.map((o) => o.kind),
      expectedConstructionKinds
    );
    for (const o of h.constructionObservations) {
      assert.equal(o.interpretation, "construction_satisfying");
    }
    // The five exact B3D-R plausibility observations, in registry order.
    assert.deepEqual(
      h.plausibility.map((p) => p.checkId),
      expectedPlausibilityIds
    );
    assert.equal(
      h.plausibility.find((p) => p.checkId === "root_separation/v0")?.state,
      "not_evaluated"
    );
    // No score / rank / confidence / recommendation / selected field anywhere.
    assert.ok(!("score" in h));
    assert.ok(!("rank" in h));
    assert.ok(!("confidence" in h));
    assert.ok(!("selected" in h));
  });
  assertNoForbiddenKeys(hypotheses);
});

// --- 6. A known multi-root configuration returns multiple unranked poses ----

test("6: a known multi-root configuration returns multiple unranked hypotheses", () => {
  const snapshot = buildSyntheticSnapshot({
    product: MULTI_PRODUCT,
    camera: MULTI_CAMERA,
    targetX: 0,
    fovDeg: MULTI_FOV,
  });
  const { run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.3", value: MULTI_PRODUCT }], [MULTI_FOV])
  );
  const result = run.poseProbeResults[0];
  assert.equal(result.poseStageResult.kind, "pose_hypotheses");
  if (result.poseStageResult.kind !== "pose_hypotheses") return;
  const hypotheses = result.poseStageResult.hypotheses;
  assert.ok(hypotheses.length >= 2, "expected multiple surviving roots");
  // Indices are exactly the enumeration order; a higher index implies nothing.
  assert.deepEqual(
    hypotheses.map((h) => h.hypothesisIndex),
    hypotheses.map((_, i) => i)
  );
  assertNoForbiddenKeys(run);
});

// --- 7. A far-side ghost root SURVIVES (never filtered) ---------------------

test("7: a far-side ghost root survives and reports camera_near_side_of_rear_seam failed", () => {
  const snapshot = buildSyntheticSnapshot({
    product: MULTI_PRODUCT,
    camera: MULTI_CAMERA,
    targetX: 0,
    fovDeg: MULTI_FOV,
  });
  const { run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.3", value: MULTI_PRODUCT }], [MULTI_FOV])
  );
  const result = run.poseProbeResults[0];
  assert.equal(result.poseStageResult.kind, "pose_hypotheses");
  if (result.poseStageResult.kind !== "pose_hypotheses") return;
  const ghost = result.poseStageResult.hypotheses.find(
    (h) => h.cameraPositionWorld.z < 0
  );
  assert.ok(ghost, "the far-side ghost root must survive as a hypothesis");
  const nearSide = ghost!.plausibility.find(
    (p) => p.checkId === "camera_near_side_of_rear_seam/v0"
  );
  assert.equal(nearSide?.state, "failed");
  // Cheirality kept it: its reconstructed distances were all positive.
  assert.ok(result.rootCensus.positiveDistanceRootCount >= 2);
});

// --- 8. One class, two members, two FOV probes: no doubled pose evidence ----

test("8: two aspect members x two FOV probes -> 2 pose-probe evals, 4 member links", () => {
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    authorizedAspectRatios: [1.0, 1.3],
  });
  const { tupleGeneration, run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [30, 60])
  );
  assert.equal(tupleGeneration.status, "generated");
  // Exactly one pose-probe evaluation per unique key (2 FOV probes -> 2).
  assert.equal(run.poseProbeResults.length, 2);
  const keys = run.poseProbeResults.map(
    (r) => r.poseProbeEquivalence.poseProbeEquivalenceKey
  );
  assert.equal(new Set(keys).size, 2);
  // Exactly one member compatibility link per member x exact FOV tuple (4).
  assert.equal(run.memberCompatibilityRecords.length, 4);
  // Every member link references a shared pose-probe key (never holds a pose).
  for (const link of run.memberCompatibilityRecords) {
    assert.ok(keys.includes(link.poseProbeEquivalenceKey));
    assert.ok(!("pose" in link));
    assert.ok(!("hypothesisIndex" in link));
  }
});

// --- 9. Pose-probe uses the class product DIRECTLY --------------------------

test("9: pose-probe output uses the exact class product, not a recomputed member product", () => {
  const aspect = 1.3;
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    authorizedAspectRatios: [aspect],
  });
  const { run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  const result = run.poseProbeResults[0];
  // The exact class primary product is read DIRECTLY from the equivalence class.
  assert.equal(result.latentDepthProduct.value, PRIMARY_PRODUCT);
  assert.equal(
    result.latentDepthProduct.value,
    result.latentDepthEquivalence.latentDepthProduct.value
  );
  // It is not derived from the member scalars. The single authorized member here
  // has extent = product / aspect; even if a recomputation happened to agree at
  // this value, the emitted product is the class value verbatim.
  const member = run.memberCompatibilityRecords[0];
  assert.equal(member.floorAspectRatio, aspect);
  assert.equal(result.latentDepthProduct.value, PRIMARY_PRODUCT);
  assert.equal(result.latentDepthProduct.formulaId, TYPE_B_LATENT_DEPTH_PRODUCT_FORMULA);
});

// --- 10. A B3C refused run is echoed with zero solves -----------------------

test("10: a B3C refused run is echoed verbatim with zero solves and no repair", () => {
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
  });
  // No FOV probes -> B3C run-level refusal (status "refused").
  const tupleGeneration = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [])
  );
  assert.equal(tupleGeneration.status, "refused");
  const run = evaluateTypeBP3pDiagnosticRun(snapshot, tupleGeneration);
  assert.deepEqual(run.tupleGeneration, tupleGeneration);
  assert.deepEqual(run.poseProbeResults, []);
  assert.deepEqual(run.memberCompatibilityRecords, []);
  assert.deepEqual(run.branchCorridors, []);
  assert.equal(run.fovTopology, null);
  // Upstream refusal is not a B3D linkage failure, so run-level reasons stay [].
  assert.deepEqual(run.refusalReasons, []);
});

// --- 11. Malformed B3C linkage -> single run-level refusal, zero solves -----

test("11: malformed B3C linkage produces one linkage refusal and zero solves", () => {
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
  });
  const tupleGeneration = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  assert.equal(tupleGeneration.status, "generated");
  // Break a tuple's evaluator family (check 8) on a deep clone.
  const broken = structuredClone(tupleGeneration) as TypeBTupleGenerationResult;
  const firstClass = broken.productClasses[0];
  if (firstClass.status === "generated") {
    (firstClass.members[0].tuples[0].tuple as { evaluatorFamily: string }).evaluatorFamily =
      "some_other_family";
  }
  const run = evaluateTypeBP3pDiagnosticRun(snapshot, broken);
  assert.deepEqual(run.refusalReasons, ["invalid_tuple_generation_linkage"]);
  assert.deepEqual(run.poseProbeResults, []);
  assert.deepEqual(run.memberCompatibilityRecords, []);
  assert.deepEqual(run.branchCorridors, []);
  assert.equal(run.fovTopology, null);
  // The B3C result is echoed unchanged.
  assert.deepEqual(run.tupleGeneration, broken);
});

// --- 12. Empty pose-probe keys -> linkage refusal, zero solves --------------

test("12: an empty pose-probe key produces a linkage refusal and zero solves", () => {
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
  });
  const tupleGeneration = generateTypeBBoundedDiagnosticTuples(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  const broken = structuredClone(tupleGeneration) as TypeBTupleGenerationResult;
  const firstClass = broken.productClasses[0];
  if (firstClass.status === "generated") {
    (firstClass.members[0].tuples[0].poseProbeEquivalence as {
      poseProbeEquivalenceKey: string;
    }).poseProbeEquivalenceKey = "";
  }
  const run = evaluateTypeBP3pDiagnosticRun(snapshot, broken);
  assert.deepEqual(run.refusalReasons, ["invalid_tuple_generation_linkage"]);
  assert.deepEqual(run.poseProbeResults, []);
});

// --- 13. Snapshot-basis mismatch -> linkage refusal, zero solves ------------

test("13: a snapshot-basis mismatch produces a linkage refusal and zero solves", () => {
  const snapshotA = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    sourceImageIdentity: "room-a.jpg",
  });
  const tupleGeneration = generateTypeBBoundedDiagnosticTuples(
    snapshotA,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  // A structurally valid snapshot with a DIFFERENT basis identity.
  const snapshotB = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    sourceImageIdentity: "room-b.jpg",
  });
  const run = evaluateTypeBP3pDiagnosticRun(snapshotB, tupleGeneration);
  assert.deepEqual(run.refusalReasons, ["invalid_tuple_generation_linkage"]);
  assert.deepEqual(run.poseProbeResults, []);
});

// --- 14. Invalid frozen endpoint status -> per-probe unsupported ------------

test("14: an invalid frozen endpoint status yields a per-probe unsupported refusal", () => {
  // Junction rear endpoint is not position-certain: a per-probe evidence issue,
  // never a linkage failure and never a throw.
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    junctionRearStatus: "occluded",
  });
  const { tupleGeneration, run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  assert.equal(tupleGeneration.status, "generated");
  assert.deepEqual(run.refusalReasons, []);
  const result = run.poseProbeResults[0];
  assert.equal(result.poseStageResult.kind, "refusal");
  if (result.poseStageResult.kind === "refusal") {
    assert.equal(
      result.poseStageResult.reason,
      "pose_stage_unsupported_constraint_set"
    );
  }
  assert.deepEqual(result.rootCensus, {
    algebraicCandidateCount: 0,
    realRootCount: 0,
    positiveDistanceRootCount: 0,
    deduplicatedRootCount: 0,
  });
});

// --- 15. Exact image-ray degeneracy -> degenerate configuration -------------

test("15: exact image-ray degeneracy yields a degenerate-configuration refusal", () => {
  // Coincident rear image points -> indistinguishable rays -> true degeneracy.
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    coincidentRearPoints: true,
  });
  const { run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  const result = run.poseProbeResults[0];
  assert.equal(result.poseStageResult.kind, "refusal");
  if (result.poseStageResult.kind === "refusal") {
    assert.equal(
      result.poseStageResult.reason,
      "pose_stage_degenerate_configuration"
    );
  }
});

// --- 16. Malformed source frame -> typed per-probe refusal, never a throw ----

test("16: a malformed source frame produces a typed per-probe refusal, never a throw", () => {
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    sourceFrameWidth: 0,
    sourceFrameHeight: 0,
  });
  const { run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  const result = run.poseProbeResults[0];
  assert.equal(result.poseStageResult.kind, "refusal");
  if (result.poseStageResult.kind === "refusal") {
    assert.equal(
      result.poseStageResult.reason,
      "pose_stage_unsupported_constraint_set"
    );
  }
});

// --- 17. frame_truncated member links remain not_evaluated ------------------

test("17: frame_truncated member links remain not_evaluated (no crop calculation)", () => {
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    latentCondition: "frame_truncated",
    authorizedAspectRatios: [1.0, 1.3],
  });
  const { run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  assert.ok(run.memberCompatibilityRecords.length > 0);
  for (const link of run.memberCompatibilityRecords) {
    assert.equal(link.cropCompatibility, "not_evaluated");
  }
});

// --- 18. occluded member links remain not_applicable ------------------------

test("18: occluded member links remain not_applicable (no occluder geometry)", () => {
  const snapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
    latentCondition: "occluded",
    authorizedAspectRatios: [1.0, 1.3],
  });
  const { run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  );
  assert.ok(run.memberCompatibilityRecords.length > 0);
  for (const link of run.memberCompatibilityRecords) {
    assert.equal(link.cropCompatibility, "not_applicable");
  }
});

// --- 19. Output always has empty branch corridors and null topology ---------

test("19: every output has empty branch corridors and fovTopology null", () => {
  const validSnapshot = buildSyntheticSnapshot({
    product: PRIMARY_PRODUCT,
    camera: PRIMARY_CAMERA,
    fovDeg: PRIMARY_FOV,
  });
  const valid = generateAndEvaluate(
    validSnapshot,
    makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [PRIMARY_FOV])
  ).run;
  assert.deepEqual(valid.branchCorridors, []);
  assert.equal(valid.fovTopology, null);

  const refused = evaluateTypeBP3pDiagnosticRun(
    validSnapshot,
    generateTypeBBoundedDiagnosticTuples(
      validSnapshot,
      makeCoverage([{ identity: "p-0.75", value: PRIMARY_PRODUCT }], [])
    )
  );
  assert.deepEqual(refused.branchCorridors, []);
  assert.equal(refused.fovTopology, null);
});

// --- 20. Deterministic + non-mutating ---------------------------------------

test("20: repeat evaluation is deeply equal and leaves inputs unchanged", () => {
  const snapshot = buildSyntheticSnapshot({
    product: MULTI_PRODUCT,
    camera: MULTI_CAMERA,
    targetX: 0,
    fovDeg: MULTI_FOV,
    authorizedAspectRatios: [1.0, 0.5],
  });
  const coverage = makeCoverage(
    [{ identity: "p-0.3", value: MULTI_PRODUCT }],
    [MULTI_FOV, 45]
  );
  const tupleGeneration = generateTypeBBoundedDiagnosticTuples(snapshot, coverage);

  const snapshotBefore = structuredClone(snapshot);
  const tupleGenerationBefore = structuredClone(tupleGeneration);

  const run1 = evaluateTypeBP3pDiagnosticRun(snapshot, tupleGeneration);
  const run2 = evaluateTypeBP3pDiagnosticRun(snapshot, tupleGeneration);
  assert.deepEqual(run1, run2);

  // Inputs are untouched.
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(tupleGeneration, tupleGenerationBefore);
});

// --- 21. Runtime import surface (no solver / browser / React / Three.js) ----

test("21: the evaluator module imports only committed Type B contract modules", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(
    path.join(here, "type-b-p3p-diagnostic-evaluation.ts"),
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
    assert.ok(
      allowed.has(specifier),
      `disallowed import specifier: ${specifier}`
    );
  }
  // No forbidden module is imported (specifier allowlist is authoritative), and
  // no dynamic require / dynamic import is used. Documentation prose may name a
  // forbidden dependency to state its ABSENCE, so only import specifiers are
  // checked for forbidden tokens.
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
  // No direct browser-global references.
  assert.ok(!/\bwindow\./.test(source), "no window. reference");
  assert.ok(!/\bdocument\./.test(source), "no document. reference");
});

// --- 22. No preview / load / Apply / selection / ranking / confidence field --

test("22: a full run record contains no forbidden selection/ranking/confidence field", () => {
  const snapshot = buildSyntheticSnapshot({
    product: MULTI_PRODUCT,
    camera: MULTI_CAMERA,
    targetX: 0,
    fovDeg: MULTI_FOV,
    authorizedAspectRatios: [1.0, 0.5],
  });
  const { run } = generateAndEvaluate(
    snapshot,
    makeCoverage([{ identity: "p-0.3", value: MULTI_PRODUCT }], [MULTI_FOV])
  );
  assertNoForbiddenKeys(run);
});

