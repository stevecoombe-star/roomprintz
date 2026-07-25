import assert from "node:assert/strict";
import test from "node:test";

import {
  solveV3Candidate,
  v3CandidatePose,
  v3CandidateWorldToCamera,
  v3EvaluateExactObjective,
  v3ExpPureSwing,
  v3IsNoOpByInfinityNorm,
  v3IntrinsicCamera,
  v3ProjectIntrinsic,
  v3PseudoHuberDerivative,
  v3RobustInfluence,
  v3ValidatedSemanticFloor,
  v3WrapToMinusPiPlusPi,
  V3_SOLVER_CONFIG,
  V3_SOLVER_CONFIG_VERSION,
  V3_SOLVER_CONTRACT_VERSION,
  type V3ActiveV2Snapshot,
  type V3CandidateObservation,
  type V3Matrix3,
  type V3Theta,
} from "./v3-candidate-solver";
import { runProductionV2FloorSolve } from "./v3-synthetic-camera";
import { buildSyntheticCameraFixtures, syntheticFixtureById, type SyntheticCameraFixture } from "./v3-synthetic-fixtures";

const ZERO: V3Theta = { omegaXRad: 0, omegaZRad: 0, deltaTxM: 0, deltaTyM: 0, deltaTzM: 0 };
const R = Math.PI / 180;

const ROOM_C_SOURCE_FLOOR = [
  { x: 0.042, y: 0.9653019205454482 }, // NL
  { x: 0.5717160898297491, y: 0.6739386656908225 }, // NR
  { x: 0.4119999999999999, y: 0.6180000000000001 }, // FR
  { x: 0.07800000000000003, y: 0.6950000000000001 }, // FL
] as const;

const ROOM_C_SNAPSHOT: V3ActiveV2Snapshot = {
  authorityVersion: "room-c-applied-v2/v1",
  appliedAtIso: "2026-07-24T00:00:00.000Z",
  calibrationVersion: "room-c-fov79/v1",
  solverIdentifier: "room-c-active-v2",
  frameSize: { width: 1118, height: 698 },
  imageBasis: { id: "room-c", fingerprint: "room-c-rebuilt-current", intrinsicWidth: 7360, intrinsicHeight: 4912 },
  verticalFovDeg: 79,
  worldToCameraCv: [
    0.690933160926, 0.004025651341, 0.722907436166,
    0.018145976802, -0.999765997462, -0.011775985908,
    0.722690867978, 0.021254280734, -0.690844530189,
  ],
  position: { x: -2.2055247589696, y: 1.5239039479254053, z: 4.991732874351085 },
  sourceFloorPolygon: ROOM_C_SOURCE_FLOOR,
  floor: { polygonKey: "room-c-floor", worldWidth: 4.8, worldDepth: 4.0 },
};

const ROOM_C_VERTICAL_EVIDENCE: readonly V3CandidateObservation[] = [
  {
    observationId: "room-c-back-left", physicalVerticalId: "back_left",
    sourceNormalizedEndpoints: { lower: { x: 0.07800000000000003, y: 0.6950000000000001 }, upper: { x: 0.07975610439068101, y: 0.22119989357881983 } },
    frozenWorldAnchor: { x: -2.4000000000000017, y: 0, z: -2.0000000000000036 },
    wallPolygonKey: "room-c-back", frozenAnchorDerivationId: "room-c-applied-floor/v1",
  },
  {
    observationId: "room-c-back-right-back", physicalVerticalId: "back_right",
    sourceNormalizedEndpoints: { lower: { x: 0.4119999999999999, y: 0.6180000000000001 }, upper: { x: 0.4103767641129033, y: 0.33614154282591974 } },
    frozenWorldAnchor: { x: 2.3999999999999986, y: 0, z: -2.0000000000000084 },
    wallPolygonKey: "room-c-back", frozenAnchorDerivationId: "room-c-applied-floor/v1",
  },
  {
    observationId: "room-c-back-right-right", physicalVerticalId: "back_right",
    sourceNormalizedEndpoints: { lower: { x: 0.4119999999999999, y: 0.6180000000000001 }, upper: { x: 0.4108667954749104, y: 0.33605238385360725 } },
    frozenWorldAnchor: { x: 2.3999999999999986, y: 0, z: -2.0000000000000084 },
    wallPolygonKey: "room-c-right", frozenAnchorDerivationId: "room-c-applied-floor/v1",
  },
  {
    observationId: "room-c-front-right", physicalVerticalId: "front_right",
    sourceNormalizedEndpoints: { lower: { x: 0.5717160898297491, y: 0.6739386656908225 }, upper: { x: 0.5670537914426524, y: 0.25118877614839996 } },
    frozenWorldAnchor: { x: 2.399999999999997, y: 0, z: 1.9999999999999987 },
    wallPolygonKey: "room-c-right", frozenAnchorDerivationId: "room-c-applied-floor/v1",
  },
].map(observation => ({
  ...observation,
  imageBasisId: ROOM_C_SNAPSHOT.imageBasis.id,
  imageBasisFingerprint: ROOM_C_SNAPSHOT.imageBasis.fingerprint,
  intrinsicWidth: ROOM_C_SNAPSHOT.imageBasis.intrinsicWidth,
  intrinsicHeight: ROOM_C_SNAPSHOT.imageBasis.intrinsicHeight,
  evidenceModelVersion: "vertical-evidence-model/v1",
  suggestionGeneratorVersion: "wall-edge-suggestions/v1",
  operatorDecision: "selected" as const,
  decisionAtIso: "2026-07-22T03:40:27.123Z",
  current: true,
  eligible: true,
}));

function roomCObservations(): V3CandidateObservation[] {
  return ROOM_C_VERTICAL_EVIDENCE.map(observation => structuredClone(observation));
}

function roomCProductionControlFloorRms(): number {
  const corners = [
    { x: -2.4, y: 0, z: 2 }, { x: 2.4, y: 0, z: 2 },
    { x: 2.4, y: 0, z: -2 }, { x: -2.4, y: 0, z: -2 },
  ];
  const { intrinsicWidth: width, intrinsicHeight: height } = ROOM_C_SNAPSHOT.imageBasis;
  const scale = Math.max(ROOM_C_SNAPSHOT.frameSize.width / width, ROOM_C_SNAPSHOT.frameSize.height / height);
  const focal = ROOM_C_SNAPSHOT.frameSize.height / (2 * Math.tan(ROOM_C_SNAPSHOT.verticalFovDeg * R / 2)) / scale;
  const residuals = corners.flatMap((corner, index) => {
    const dx = corner.x - ROOM_C_SNAPSHOT.position.x;
    const dy = corner.y - ROOM_C_SNAPSHOT.position.y;
    const dz = corner.z - ROOM_C_SNAPSHOT.position.z;
    const m = ROOM_C_SNAPSHOT.worldToCameraCv;
    const camera = {
      x: m[0] * dx + m[1] * dy + m[2] * dz,
      y: m[3] * dx + m[4] * dy + m[5] * dz,
      z: m[6] * dx + m[7] * dy + m[8] * dz,
    };
    const observed = ROOM_C_SOURCE_FLOOR[index];
    return [focal * camera.x / camera.z + width / 2 - observed.x * width, focal * camera.y / camera.z + height / 2 - observed.y * height];
  });
  return Math.sqrt(residuals.reduce((sum, residual) => sum + residual * residual, 0) / residuals.length);
}

function matMul(a: V3Matrix3, b: V3Matrix3): V3Matrix3 {
  return [
    a[0]*b[0]+a[1]*b[3]+a[2]*b[6], a[0]*b[1]+a[1]*b[4]+a[2]*b[7], a[0]*b[2]+a[1]*b[5]+a[2]*b[8],
    a[3]*b[0]+a[4]*b[3]+a[5]*b[6], a[3]*b[1]+a[4]*b[4]+a[5]*b[7], a[3]*b[2]+a[4]*b[5]+a[5]*b[8],
    a[6]*b[0]+a[7]*b[3]+a[8]*b[6], a[6]*b[1]+a[7]*b[4]+a[8]*b[7], a[6]*b[2]+a[7]*b[5]+a[8]*b[8],
  ];
}
function transpose(m: V3Matrix3): V3Matrix3 { return [m[0],m[3],m[6],m[1],m[4],m[7],m[2],m[5],m[8]]; }
function maxMatrixError(a: V3Matrix3, b: V3Matrix3): number { return Math.max(...a.map((x, i) => Math.abs(x - b[i]))); }
function quaternion(m: V3Matrix3): readonly [number, number, number, number] {
  const t = m[0] + m[4] + m[8];
  if (t > 0) { const s = 2 * Math.sqrt(t + 1); return [(m[7]-m[5])/s, (m[2]-m[6])/s, (m[3]-m[1])/s, .25*s]; }
  if (m[0] > m[4] && m[0] > m[8]) { const s = 2*Math.sqrt(1+m[0]-m[4]-m[8]); return [.25*s,(m[1]+m[3])/s,(m[2]+m[6])/s,(m[7]-m[5])/s]; }
  if (m[4] > m[8]) { const s = 2*Math.sqrt(1+m[4]-m[0]-m[8]); return [(m[1]+m[3])/s,.25*s,(m[5]+m[7])/s,(m[2]-m[6])/s]; }
  const s = 2*Math.sqrt(1+m[8]-m[0]-m[4]); return [(m[2]+m[6])/s,(m[5]+m[7])/s,.25*s,(m[3]-m[1])/s];
}

function adapt(fixture: SyntheticCameraFixture): { snapshot: V3ActiveV2Snapshot; observations: V3CandidateObservation[] } {
  const solved = runProductionV2FloorSolve({ floorPixels: fixture.floorEvidencePixels, dimensions: fixture.floorDimensions, intrinsics: fixture.intrinsics });
  assert.equal(solved.ok, true, fixture.manifest.id);
  if (!solved.ok) throw new Error("Synthetic v2 solve failed.");
  const r = solved.decomposition.cvProjection.rotationPlaneToCv;
  // Production plane coordinates are [world X, world Z, -world Y].
  const worldToCameraCv: V3Matrix3 = [r[0], -r[2], r[1], r[3], -r[5], r[4], r[6], -r[8], r[7]];
  const snapshot: V3ActiveV2Snapshot = {
    authorityVersion: "synthetic-v2/v1",
    appliedAtIso: "2026-07-20T00:00:00.000Z",
    calibrationVersion: "synthetic-calibration/v1",
    solverIdentifier: "synthetic-v2-floor",
    frameSize: { width: fixture.intrinsics.width, height: fixture.intrinsics.height },
    imageBasis: { id: `${fixture.manifest.id}:basis`, fingerprint: `${fixture.manifest.id}:fingerprint`, intrinsicWidth: fixture.intrinsics.width, intrinsicHeight: fixture.intrinsics.height },
    verticalFovDeg: fixture.intrinsics.verticalFovDeg,
    worldToCameraCv,
    position: solved.decomposition.pose.position,
    sourceFloorPolygon: fixture.floorEvidencePixels.map(point => ({ x: point.x / fixture.intrinsics.width, y: point.y / fixture.intrinsics.height })),
    floor: { polygonKey: `${fixture.manifest.id}:floor`, worldWidth: fixture.floorDimensions.widthMeters, worldDepth: fixture.floorDimensions.depthMeters },
  };
  return {
    snapshot,
    observations: fixture.verticalEvidence.map(({ observation }) => ({
      observationId: observation.observationId,
      physicalVerticalId: observation.physicalVerticalId,
      imageBasisId: observation.imageBasisId,
      imageBasisFingerprint: observation.imageBasisFingerprint,
      intrinsicWidth: observation.intrinsicWidth,
      intrinsicHeight: observation.intrinsicHeight,
      sourceNormalizedEndpoints: observation.sourceNormalizedEndpoints,
      frozenWorldAnchor: observation.frozenWorldAnchor,
      wallPolygonKey: observation.wallPolygonKey,
      frozenAnchorDerivationId: observation.frozenAnchorDerivationId,
      evidenceModelVersion: observation.evidenceModelVersion,
      suggestionGeneratorVersion: observation.suggestionGeneratorVersion,
      operatorDecision: observation.operatorDecision,
      decisionAtIso: observation.decisionAtIso,
      current: true,
      eligible: true,
    })),
  };
}

function truthCorrection(snapshot: V3ActiveV2Snapshot, fixture: SyntheticCameraFixture): V3Theta {
  const truthWorldToCamera = fixture.truthCamera.worldToCamera as V3Matrix3;
  const correction = matMul(transpose(truthWorldToCamera), snapshot.worldToCameraCv);
  const angle = Math.acos(Math.max(-1, Math.min(1, (correction[0] + correction[4] + correction[8] - 1) / 2)));
  const sine = Math.sin(angle);
  const factor = Math.abs(sine) < 1e-14 ? .5 : angle / (2 * sine);
  return {
    omegaXRad: factor * (correction[7] - correction[5]),
    omegaZRad: factor * (correction[3] - correction[1]),
    deltaTxM: fixture.truthCamera.position.x - snapshot.position.x,
    deltaTyM: fixture.truthCamera.position.y - snapshot.position.y,
    deltaTzM: fixture.truthCamera.position.z - snapshot.position.z,
  };
}

function noisyChaseCorrection(snapshot: V3ActiveV2Snapshot, observations: readonly V3CandidateObservation[]): V3Theta {
  const residuals = (theta: V3Theta) => v3EvaluateExactObjective(snapshot, observations, theta).verticalResidualsRad;
  const noisyIndexes = residuals(ZERO).map(Math.abs).flatMap((value, index) => value > .01 ? [index] : []);
  assert.equal(noisyIndexes.length, 2);
  let theta = ZERO;
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const meanResidual = (candidate: V3Theta) => noisyIndexes.reduce((sum, index) => sum + residuals(candidate)[index], 0) / noisyIndexes.length;
    const value = meanResidual(theta);
    if (Math.abs(value) < 1e-12) break;
    const h = 1e-6;
    const dx = (meanResidual({ ...theta, omegaXRad: theta.omegaXRad + h }) - meanResidual({ ...theta, omegaXRad: theta.omegaXRad - h })) / (2 * h);
    const dz = (meanResidual({ ...theta, omegaZRad: theta.omegaZRad + h }) - meanResidual({ ...theta, omegaZRad: theta.omegaZRad - h })) / (2 * h);
    const denominator = dx * dx + dz * dz;
    assert.ok(denominator > 1e-12);
    theta = {
      ...theta,
      omegaXRad: theta.omegaXRad - value * dx / denominator,
      omegaZRad: theta.omegaZRad - value * dz / denominator,
    };
  }
  return theta;
}

test("versions, five-field state, and fixed intrinsic source camera are explicit", () => {
  assert.equal(V3_SOLVER_CONTRACT_VERSION, "calibrated-camera-v3-candidate/v1");
  assert.equal(V3_SOLVER_CONFIG_VERSION, "v3-solver-config/v1");
  assert.deepEqual(Object.keys(ZERO), ["omegaXRad", "omegaZRad", "deltaTxM", "deltaTyM", "deltaTzM"]);
  const { snapshot } = adapt(syntheticFixtureById("v3-synthetic-2-off-axis-zero-roll"));
  const k = v3IntrinsicCamera(snapshot)!;
  assert.equal(k.scale, 1);
  assert.equal(k.fx, snapshot.frameSize.height / (2 * Math.tan(snapshot.verticalFovDeg * R / 2)));
  assert.equal(k.fx, k.fy);
  assert.equal(k.cx, snapshot.imageBasis.intrinsicWidth / 2);
  assert.equal(k.cy, snapshot.imageBasis.intrinsicHeight / 2);
});

test("v2 camera reprojects exact synthetic Floor in source intrinsic pixels", () => {
  const fixture = syntheticFixtureById("v3-synthetic-2-off-axis-zero-roll");
  const { snapshot } = adapt(fixture);
  const corners = [
    { x: -2, y: 0, z: 2 }, { x: 2, y: 0, z: 2 }, { x: 2, y: 0, z: -2 }, { x: -2, y: 0, z: -2 },
  ];
  const projected = corners.map(x => v3ProjectIntrinsic(snapshot, ZERO, x)!);
  const expected = fixture.floorEvidencePixels;
  assert.ok(Math.max(...projected.map((p, i) => Math.hypot(p.x - expected[i].x, p.y - expected[i].y))) < 1e-7);
  assert.ok(projected[0].y > projected[2].y, "intrinsic projection remains y-down");
});

test("Room C preserves applied semantic Floor order despite NR appearing above FL", () => {
  const inputBefore = structuredClone(ROOM_C_SOURCE_FLOOR);
  const semantic = v3ValidatedSemanticFloor(ROOM_C_SOURCE_FLOOR);
  assert.ok(semantic);
  assert.ok(ROOM_C_SOURCE_FLOOR[1].y < ROOM_C_SOURCE_FLOOR[3].y, "NR is above FL in screen space");
  assert.deepEqual(semantic, ROOM_C_SOURCE_FLOOR);
  assert.equal(semantic[0], ROOM_C_SOURCE_FLOOR[0], "NL remains slot 0");
  assert.equal(semantic[1], ROOM_C_SOURCE_FLOOR[1], "NR remains slot 1");
  assert.equal(semantic[2], ROOM_C_SOURCE_FLOOR[2], "FR remains slot 2");
  assert.equal(semantic[3], ROOM_C_SOURCE_FLOOR[3], "FL remains slot 3");
  assert.notDeepEqual(semantic, [ROOM_C_SOURCE_FLOOR[0], ROOM_C_SOURCE_FLOOR[3], ROOM_C_SOURCE_FLOOR[1], ROOM_C_SOURCE_FLOOR[2]]);
  assert.deepEqual(ROOM_C_SOURCE_FLOOR, inputBefore);
});

test("Room C theta-zero Floor RMS uses the independent applied-v2 semantic control", () => {
  const control = roomCProductionControlFloorRms();
  const measured = v3EvaluateExactObjective(ROOM_C_SNAPSHOT, roomCObservations(), ZERO);
  assert.equal(measured.valid, true);
  assert.ok(Math.abs(control - 6.9213) < 0.01, `unexpected production control RMS ${control}`);
  assert.ok((measured.floorRmsPx ?? Infinity) < 20);
  assert.ok((measured.floorRmsPx ?? Infinity) < 100, "must not resemble the 1,614 px correspondence failure");
  assert.ok(Math.abs((measured.floorRmsPx ?? Infinity) - control) < 1e-8);
});

test("Room C Floor slots pair metric corners with the matching semantic source index", () => {
  const semantic = v3ValidatedSemanticFloor(ROOM_C_SOURCE_FLOOR);
  assert.ok(semantic);
  assert.deepEqual(semantic[0], { x: 0.042, y: 0.9653019205454482 }); // metric NL
  assert.deepEqual(semantic[1], { x: 0.5717160898297491, y: 0.6739386656908225 }); // metric NR
  assert.deepEqual(semantic[2], { x: 0.4119999999999999, y: 0.6180000000000001 }); // metric FR
  assert.deepEqual(semantic[3], { x: 0.07800000000000003, y: 0.6950000000000001 }); // metric FL
  assert.notDeepEqual(semantic, [ROOM_C_SOURCE_FLOOR[0], ROOM_C_SOURCE_FLOOR[3], ROOM_C_SOURCE_FLOOR[1], ROOM_C_SOURCE_FLOOR[2]]);
});

test("Room C full solver and vertical-only probe retain truthful Floor correspondence", () => {
  const observations = roomCObservations();
  const snapshotBefore = structuredClone(ROOM_C_SNAPSHOT);
  const observationsBefore = structuredClone(observations);
  const first = solveV3Candidate({ activeV2: ROOM_C_SNAPSHOT, observations });
  const second = solveV3Candidate({ activeV2: ROOM_C_SNAPSHOT, observations });
  assert.deepEqual(first, second);
  assert.deepEqual(ROOM_C_SNAPSHOT, snapshotBefore);
  assert.deepEqual(observations, observationsBefore);
  assert.ok(Math.abs((first.initial.floorRmsPx ?? Infinity) - 6.9213) < 0.01);
  assert.ok((first.final.floorRmsPx ?? Infinity) < 3);
  assert.equal(first.status, "candidate_ready");
  assert.deepEqual(first.activeBounds, []);
  assert.equal(first.optimizer.convergenceReason, "scaled_step");
  assert.equal(first.verticalOnlyProbe.outcome, "interior_converged");
  assert.ok((first.verticalOnlyProbe.floorRmsPx ?? Infinity) < 100, "vertical-only reporting must not resemble the 1,614 px correspondence failure");
  assert.equal(first.crossBlock?.evaluated, true);
  if (!first.crossBlock?.evaluated) throw new Error("Room C vertical-only probe was unavailable.");
  assert.ok(first.crossBlock.verticalMeanAbsAtV2Deg > 1 && first.crossBlock.verticalMeanAbsAtV2Deg < 1.1);
  assert.ok(first.crossBlock.verticalMeanAbsAtProbeDeg < 0.1);
  assert.ok(first.crossBlock.verticalMeanAbsAtProbeDeg < first.crossBlock.verticalMeanAbsAtV2Deg);
  assert.equal(first.fingerprint, second.fingerprint);
});

test("pure swing reconstructs from actual candidate matrices without hidden Y twist", () => {
  const fixtures = ["v3-synthetic-5-perturbed-floor-clean-verticals", "v3-synthetic-5b-single-camera-floor-corner-perturbation"] as const;
  const values = [-.14, -.07, 0, .07, .14];
  for (const id of fixtures) {
    const { snapshot } = adapt(syntheticFixtureById(id));
    for (const omegaXRad of values) for (const omegaZRad of values) {
      const theta = { ...ZERO, omegaXRad, omegaZRad };
      const candidateC2w = transpose(v3CandidateWorldToCamera(snapshot, theta));
      const v2C2w = transpose(snapshot.worldToCameraCv);
      const relative = matMul(candidateC2w, transpose(v2C2w));
      assert.ok(maxMatrixError(relative, v3ExpPureSwing(omegaXRad, omegaZRad)) <= 1e-10);
      assert.ok(Math.abs(quaternion(relative)[1]) <= 1e-12);
    }
  }
});

test("small-angle Rodrigues branch remains a pure world-X/world-Z swing", () => {
  const { snapshot } = adapt(syntheticFixtureById("v3-synthetic-5b-single-camera-floor-corner-perturbation"));
  const values: readonly [number, number][] = [
    [0, 0], [1e-16, 0], [-1e-16, 0], [0, 1e-16], [0, -1e-16],
    [1e-16, -1e-16], [-1e-16, 1e-16], [0.5e-14, -0.5e-14], [1.5e-14, -1.5e-14],
  ];
  for (const [omegaXRad, omegaZRad] of values) {
    const expected: V3Matrix3 = [1, -omegaZRad, 0, omegaZRad, 1, -omegaXRad, 0, omegaXRad, 1];
    const theta = { ...ZERO, omegaXRad, omegaZRad };
    const relative = matMul(transpose(v3CandidateWorldToCamera(snapshot, theta)), snapshot.worldToCameraCv);
    assert.ok(maxMatrixError(relative, v3ExpPureSwing(omegaXRad, omegaZRad)) < 1e-12);
    assert.ok(maxMatrixError(v3ExpPureSwing(omegaXRad, omegaZRad), expected) < 1e-10);
    assert.ok(Math.abs(quaternion(relative)[1]) < 1e-12);
  }
});

test("no-op classification uses strict component infinity norms", () => {
  const omegaTol = V3_SOLVER_CONFIG.noOpOmegaTolRad;
  const translationTol = V3_SOLVER_CONFIG.noOpTranslationTolM;
  assert.equal(v3IsNoOpByInfinityNorm({ ...ZERO, omegaXRad: .75 * omegaTol, omegaZRad: .75 * omegaTol }), true);
  assert.equal(v3IsNoOpByInfinityNorm({ ...ZERO, omegaXRad: omegaTol }), false);
  assert.equal(v3IsNoOpByInfinityNorm({ ...ZERO, deltaTxM: .75 * translationTol, deltaTyM: .75 * translationTol, deltaTzM: .75 * translationTol }), true);
  assert.equal(v3IsNoOpByInfinityNorm({ ...ZERO, deltaTzM: translationTol }), false);
  assert.equal(v3IsNoOpByInfinityNorm({ ...ZERO, omegaXRad: omegaTol, deltaTxM: .5 * translationTol }), false);
  assert.equal(v3IsNoOpByInfinityNorm({ ...ZERO, omegaXRad: .5 * omegaTol, deltaTxM: translationTol }), false);
});

test("intrinsic residuals retain centered object-cover math for unequal aspects", () => {
  const fixture = syntheticFixtureById("v3-synthetic-2-off-axis-zero-roll");
  const { snapshot, observations } = adapt(fixture);
  const unequal: V3ActiveV2Snapshot = { ...snapshot, frameSize: { width: 1500, height: 1000 } };
  const k = v3IntrinsicCamera(unequal)!;
  assert.equal(k.scale, 1.25);
  assert.ok(Math.abs(k.fx - fixture.intrinsics.fx) < 1e-12);
  const objective = v3EvaluateExactObjective(unequal, observations, ZERO);
  assert.equal(objective.valid, true);
  assert.ok((objective.floorRmsPx ?? Infinity) < 1e-7);
  assert.equal(observations[0].sourceNormalizedEndpoints.lower.x * unequal.imageBasis.intrinsicWidth, fixture.verticalEvidence[0].projected.lowerPixel.x);
});

test("vertical residual wrapping preserves observed-minus-predicted sign across pi", () => {
  const epsilon = 1e-8;
  assert.ok(Math.abs(v3WrapToMinusPiPlusPi((Math.PI - epsilon) - (-Math.PI + epsilon)) + 2 * epsilon) < 1e-12);
  assert.ok(Math.abs(v3WrapToMinusPiPlusPi((-Math.PI + epsilon) - (Math.PI - epsilon)) - 2 * epsilon) < 1e-12);
});

test("pseudo-Huber derivative and influence match the exact half-quadratic objective", () => {
  for (const z of [-10, -2, -.1, 0, .1, 2, 10]) {
    const h = 1e-7;
    const cost = (x: number) => 4 * (Math.sqrt(1 + x*x/4) - 1);
    assert.ok(Math.abs((cost(z+h)-cost(z-h))/(2*h) - v3PseudoHuberDerivative(z, 2)) < 1e-7);
    assert.equal(v3RobustInfluence(z, 2), 1 / Math.sqrt(1 + z*z/4));
  }
});

test("candidate results are deterministic, immutable, non-authoritative, and input-order invariant", () => {
  const { snapshot, observations } = adapt(syntheticFixtureById("v3-synthetic-5b-single-camera-floor-corner-perturbation"));
  const frozenSnapshot = structuredClone(snapshot); const frozenObservations = structuredClone(observations);
  const first = solveV3Candidate({ activeV2: snapshot, observations });
  const second = solveV3Candidate({ activeV2: snapshot, observations: [...observations].reverse() });
  assert.deepEqual(first, second);
  assert.deepEqual(snapshot, frozenSnapshot);
  assert.deepEqual(observations, frozenObservations);
  assert.deepEqual(first.safety, { applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true });
  assert.equal(first.contractVersion, V3_SOLVER_CONTRACT_VERSION);
  assert.ok(first.fingerprint.startsWith("v3fnv1a-"));
});

test("fixture controls and evidence statuses are deterministic", () => {
  const byId = new Map(buildSyntheticCameraFixtures().map(fixture => [fixture.manifest.id, fixture]));
  const result = (id: Parameters<typeof syntheticFixtureById>[0]) => {
    const adapted = adapt(byId.get(id)!);
    return solveV3Candidate({ activeV2: adapted.snapshot, observations: adapted.observations });
  };
  for (const id of ["v3-synthetic-1-centered-zero-roll", "v3-synthetic-2-off-axis-zero-roll", "v3-synthetic-3-positive-roll", "v3-synthetic-4-negative-roll"] as const) {
    const value = result(id);
    assert.equal(value.status, "no_op", id);
    assert.ok((value.theta?.omegaXRad ?? Infinity) ** 2 + (value.theta?.omegaZRad ?? Infinity) ** 2 < 1e-8);
  }
  assert.equal(result("v3-synthetic-9a-duplicate-only-insufficient").status, "insufficient_evidence");
  assert.equal(result("v3-synthetic-10-missing-vertical-evidence").status, "insufficient_evidence");
  assert.equal(result("v3-synthetic-11-grazing-admission").status, "insufficient_evidence");
  const bimodal = result("v3-synthetic-7-bimodal-vertical-families");
  assert.equal(bimodal.status, "incompatible_evidence");
  assert.equal(bimodal.candidatePose, null);
  assert.ok(bimodal.exploratory);
});

test("E4 cross-block endpoints classify tension without using the joint optimum", () => {
  const run = (id: Parameters<typeof syntheticFixtureById>[0]) => {
    const { snapshot, observations } = adapt(syntheticFixtureById(id));
    return solveV3Candidate({ activeV2: snapshot, observations });
  };
  const fixture5 = run("v3-synthetic-5-perturbed-floor-clean-verticals");
  assert.equal(fixture5.status, "candidate_ready");
  assert.equal(fixture5.crossBlock?.evaluated, true);
  if (!fixture5.crossBlock?.evaluated) throw new Error("Fixture 5 endpoint diagnostic was unavailable.");
  assert.ok(fixture5.warnings.includes("cross_block_tension"));
  assert.ok(fixture5.warnings.includes("cross_block_unresolved"));
  assert.equal(fixture5.crossBlock.tension, true);
  assert.equal(fixture5.crossBlock.unresolved, true);
  assert.ok(fixture5.crossBlock.probeVerticalImprovementDeg > 4 && fixture5.crossBlock.probeVerticalImprovementDeg < 4.6);
  assert.ok(fixture5.crossBlock.probeFloorCostPx > 35 && fixture5.crossBlock.probeFloorCostPx < 50);
  assert.ok((fixture5.final.meanAbsGroupVerticalDeg ?? Infinity) < fixture5.crossBlock.verticalMeanAbsAtV2Deg);
  assert.ok((fixture5.final.floorRmsPx ?? 0) > 0);

  const fixture5b = run("v3-synthetic-5b-single-camera-floor-corner-perturbation");
  assert.equal(fixture5b.status, "candidate_ready");
  assert.equal(fixture5b.crossBlock?.evaluated, true);
  if (!fixture5b.crossBlock?.evaluated) throw new Error("Fixture 5b endpoint diagnostic was unavailable.");
  assert.ok(fixture5b.warnings.includes("cross_block_tension"));
  assert.ok(!fixture5b.warnings.includes("cross_block_unresolved"));
  assert.equal(fixture5b.crossBlock.tension, true);
  assert.equal(fixture5b.crossBlock.unresolved, false);
  assert.ok(fixture5b.crossBlock.probeVerticalImprovementDeg > 1.3 && fixture5b.crossBlock.probeVerticalImprovementDeg < 1.6);
  assert.ok(fixture5b.crossBlock.probeFloorCostPx > 5 && fixture5b.crossBlock.probeFloorCostPx < 9);
  assert.ok((fixture5b.final.meanAbsGroupVerticalDeg ?? Infinity) < .5);

  for (const id of ["v3-synthetic-1-centered-zero-roll", "v3-synthetic-2-off-axis-zero-roll", "v3-synthetic-3-positive-roll", "v3-synthetic-4-negative-roll"] as const) {
    const value = run(id);
    assert.equal(value.crossBlock?.evaluated, true, id);
    if (!value.crossBlock?.evaluated) throw new Error(`${id} endpoint diagnostic was unavailable.`);
    assert.equal(value.crossBlock.tension, false, id);
    assert.equal(value.crossBlock.unresolved, false, id);
    assert.ok(Math.abs(value.crossBlock.probeVerticalImprovementDeg) < 1e-9, id);
    assert.ok(Math.abs(value.crossBlock.probeFloorCostPx) < 1e-9, id);
    assert.ok(!value.warnings.includes("cross_block_tension"), id);
    assert.ok(!value.warnings.includes("cross_block_unresolved"), id);
  }

  const fixture6 = run("v3-synthetic-6-exact-floor-perturbed-verticals");
  assert.equal(fixture6.crossBlock?.evaluated, true);
  if (!fixture6.crossBlock?.evaluated) throw new Error("Fixture 6 endpoint diagnostic was unavailable.");
  assert.ok(fixture6.warnings.includes("dispersed_residuals"));
  assert.ok(!fixture6.warnings.includes("cross_block_tension"));
  assert.ok(!fixture6.warnings.includes("cross_block_unresolved"));
  assert.ok(fixture6.crossBlock.probeVerticalImprovementDeg < .8);

  const fixture7 = run("v3-synthetic-7-bimodal-vertical-families");
  assert.equal(fixture7.status, "incompatible_evidence");
  assert.deepEqual(fixture7.crossBlock, { evaluated: false, reason: "bimodal_evidence" });
  assert.ok(!fixture7.warnings.includes("cross_block_tension"));
  assert.ok(!fixture7.warnings.includes("cross_block_unresolved"));

  assert.equal(run("v3-synthetic-9a-duplicate-only-insufficient").crossBlock, null);
  assert.equal(run("v3-synthetic-10-missing-vertical-evidence").crossBlock, null);
});

test("all raw duplicate observations retain one physical total vote", () => {
  const { snapshot, observations } = adapt(syntheticFixtureById("v3-synthetic-5b-single-camera-floor-corner-perturbation"));
  const duplicated = [...observations, { ...observations[0], observationId: `${observations[0].observationId}:duplicate` }];
  const a = solveV3Candidate({ activeV2: snapshot, observations });
  const b = solveV3Candidate({ activeV2: snapshot, observations: duplicated });
  assert.deepEqual(a.bimodality?.verdict, b.bimodality?.verdict);
  assert.deepEqual(a.crossBlock, b.crossBlock);
  assert.notEqual(a.fingerprint, b.fingerprint);
  assert.ok(Math.abs((a.theta?.omegaXRad ?? 0) - (b.theta?.omegaXRad ?? 0)) < 1e-9);
  assert.ok(Math.abs((a.theta?.omegaZRad ?? 0) - (b.theta?.omegaZRad ?? 0)) < 1e-9);
});

test("fingerprint changes for snapshot and admitted evidence identity inputs", () => {
  const { snapshot, observations } = adapt(syntheticFixtureById("v3-synthetic-2-off-axis-zero-roll"));
  const base = solveV3Candidate({ activeV2: snapshot, observations }).fingerprint;
  assert.notEqual(solveV3Candidate({ activeV2: { ...snapshot, authorityVersion: "changed" }, observations }).fingerprint, base);
  assert.notEqual(solveV3Candidate({ activeV2: { ...snapshot, floor: { ...snapshot.floor, worldWidth: 4.1 } }, observations }).fingerprint, base);
  assert.notEqual(solveV3Candidate({ activeV2: snapshot, observations: [{ ...observations[0], observationId: "changed" }, ...observations.slice(1)] }).fingerprint, base);
});

test("E1 objective controls pin truth preference and reject noisy vertical chasing", () => {
  const fixture5b = syntheticFixtureById("v3-synthetic-5b-single-camera-floor-corner-perturbation");
  const truthInput = adapt(fixture5b);
  const truthAtV2 = v3EvaluateExactObjective(truthInput.snapshot, truthInput.observations, ZERO);
  const derivedTruth = truthCorrection(truthInput.snapshot, fixture5b);
  const truthAtCorrection = v3EvaluateExactObjective(truthInput.snapshot, truthInput.observations, derivedTruth);
  assert.equal(truthAtV2.valid, true);
  assert.equal(truthAtCorrection.valid, true);
  assert.ok(truthAtCorrection.objective < truthAtV2.objective);
  assert.ok(Math.abs(truthAtV2.objective - 28.8396737049) < 1e-7);
  assert.ok(Math.abs(truthAtCorrection.objective - 26.5822949728) < 1e-7);

  const noisyInput = adapt(syntheticFixtureById("v3-synthetic-6-exact-floor-perturbed-verticals"));
  const noisyAtV2 = v3EvaluateExactObjective(noisyInput.snapshot, noisyInput.observations, ZERO);
  const chase = noisyChaseCorrection(noisyInput.snapshot, noisyInput.observations);
  const noisyAtChase = v3EvaluateExactObjective(noisyInput.snapshot, noisyInput.observations, chase);
  assert.ok(noisyAtV2.objective < noisyAtChase.objective);
  assert.ok(Math.abs(noisyAtV2.objective - 39.5512582071) < 1e-7);
  assert.ok(Math.abs(noisyAtChase.objective - 87.8262151814) < 1e-7);
});

test("exact objective has fixed Floor, priors, and robust vertical acceptance cost", () => {
  const { snapshot, observations } = adapt(syntheticFixtureById("v3-synthetic-6-exact-floor-perturbed-verticals"));
  const v2 = v3EvaluateExactObjective(snapshot, observations, ZERO);
  const moved = v3EvaluateExactObjective(snapshot, observations, { ...ZERO, omegaXRad: .01 });
  assert.equal(v2.valid, true);
  assert.equal(moved.valid, true);
  assert.ok(Number.isFinite(v2.objective) && Number.isFinite(moved.objective));
  assert.equal(v2.robustInfluences.length, observations.length);
});

test("exact objective regression pins Floor, grouping, robust loss, and priors", () => {
  const fixture5 = adapt(syntheticFixtureById("v3-synthetic-5-perturbed-floor-clean-verticals"));
  const result5 = solveV3Candidate({ activeV2: fixture5.snapshot, observations: fixture5.observations });
  const fixture5V2 = v3EvaluateExactObjective(fixture5.snapshot, fixture5.observations, ZERO);
  const fixture5Final = v3EvaluateExactObjective(fixture5.snapshot, fixture5.observations, result5.theta!);
  assert.ok(Math.abs(fixture5V2.objective - 108.8076335773) < 1e-7);
  assert.ok(Math.abs(fixture5Final.objective - 74.3962260243) < 1e-7);

  const fixture5b = adapt(syntheticFixtureById("v3-synthetic-5b-single-camera-floor-corner-perturbation"));
  const result5b = solveV3Candidate({ activeV2: fixture5b.snapshot, observations: fixture5b.observations });
  const fixture5bV2 = v3EvaluateExactObjective(fixture5b.snapshot, fixture5b.observations, ZERO);
  const fixture5bFinal = v3EvaluateExactObjective(fixture5b.snapshot, fixture5b.observations, result5b.theta!);
  assert.ok(Math.abs(fixture5bV2.objective - 28.8396737049) < 1e-7);
  assert.ok(Math.abs(fixture5bFinal.objective - 9.4098937791) < 1e-7);
});

test("candidate display pose and forward azimuth derive solely from Exp(omega)", () => {
  const { snapshot } = adapt(syntheticFixtureById("v3-synthetic-5b-single-camera-floor-corner-perturbation"));
  const theta = { ...ZERO, omegaXRad: .08, omegaZRad: -.06 };
  const candidate = v3CandidatePose(snapshot, theta);
  const v2Forward = transpose(snapshot.worldToCameraCv);
  const forward = { x: v2Forward[2], y: v2Forward[5], z: v2Forward[8] };
  const predicted = (() => {
    const m = v3ExpPureSwing(theta.omegaXRad, theta.omegaZRad);
    return { x: m[0]*forward.x+m[1]*forward.y+m[2]*forward.z, y: m[3]*forward.x+m[4]*forward.y+m[5]*forward.z, z: m[6]*forward.x+m[7]*forward.y+m[8]*forward.z };
  })();
  const actual = { x: candidate.lookAt.x-candidate.position.x, y: candidate.lookAt.y-candidate.position.y, z: candidate.lookAt.z-candidate.position.z };
  assert.ok(Math.hypot(actual.x-predicted.x, actual.y-predicted.y, actual.z-predicted.z) < 1e-12);
});

test("solver source remains isolated from authority, UI, fixtures, and mutable supports", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("./v3-candidate-solver.ts", import.meta.url), "utf8"));
  for (const forbidden of ["calibrated-camera-apply", "calibrated-camera-restore-authority", "scene-state", "v3-synthetic-camera", "v3-synthetic-fixtures", "attachment", "room-envelope", "support-", "react"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("final bound accounting reports only final physical active bounds", () => {
  const fixture = adapt(syntheticFixtureById("v3-synthetic-5-perturbed-floor-clean-verticals"));
  const transient = solveV3Candidate(
    { activeV2: fixture.snapshot, observations: fixture.observations },
    { ...V3_SOLVER_CONFIG, omegaBoundRad: .03, translationBoundM: .053 }
  );
  assert.deepEqual(transient.activeBounds, []);
  assert.notEqual(transient.status, "candidate_bounded");

  const omegaBound = solveV3Candidate(
    { activeV2: fixture.snapshot, observations: fixture.observations },
    { ...V3_SOLVER_CONFIG, omegaBoundRad: .005 }
  );
  assert.equal(omegaBound.status, "candidate_bounded");
  assert.deepEqual(omegaBound.activeBounds, ["omegaXRad:min", "omegaZRad:min"]);

  const translationBound = solveV3Candidate(
    { activeV2: fixture.snapshot, observations: fixture.observations },
    { ...V3_SOLVER_CONFIG, translationBoundM: .01 }
  );
  assert.equal(translationBound.status, "candidate_bounded");
  assert.deepEqual(translationBound.activeBounds, ["deltaTxM:max", "deltaTzM:min"]);

  const fixture7 = adapt(syntheticFixtureById("v3-synthetic-7-bimodal-vertical-families"));
  assert.equal(solveV3Candidate({ activeV2: fixture7.snapshot, observations: fixture7.observations }).verticalOnlyProbe.outcome, "interior_converged");
});



