import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CalibrationImageBasis } from "./calibration-image-basis";
import type { StructuralVerticalObservation } from "./projection-coherence-diagnostics";
import { deriveVerticalEvidenceSuggestions } from "./vertical-evidence";
import type { WallPolygon } from "./wall-support-geometry";
import {
  applySyntheticPixelPerturbation,
  buildSyntheticIntrinsicsFromFocal,
  buildSyntheticIntrinsicsFromFov,
  compareRecoveredV2Camera,
  createSyntheticCamera,
  intrinsicPixelsToSourceNormalized,
  projectSyntheticFloorRectangle,
  projectSyntheticWorldPoint,
  projectSyntheticVerticalSegment,
  runProductionV2FloorSolve,
  signedImageVerticalTiltDeg,
} from "./v3-synthetic-camera";
import { buildSyntheticCameraFixtures, syntheticFixtureById, type SyntheticCameraFixture } from "./v3-synthetic-fixtures";

function solveAndCompare(fixture: SyntheticCameraFixture) {
  const solved = runProductionV2FloorSolve({
    floorPixels: fixture.floorEvidencePixels,
    dimensions: fixture.floorDimensions,
    intrinsics: fixture.intrinsics,
  });
  if (!solved.ok) assert.fail(`${fixture.manifest.id}: v2 Floor solve failed: ${solved.reason}`);
  return compareRecoveredV2Camera({
    truth: fixture.truthCamera,
    recovered: solved.decomposition,
    floorPixels: fixture.floorEvidencePixels,
    floorDimensions: fixture.floorDimensions,
    verticals: fixture.verticalEvidence.map((entry) => entry.projected),
  });
}

function diagnostics(fixture: SyntheticCameraFixture): string {
  const result = solveAndCompare(fixture);
  return JSON.stringify({
    fixture: fixture.manifest.id,
    floor: result.floor,
    positionErrorMeters: result.positionErrorMeters,
    forwardDirectionAngularErrorDeg: result.forwardDirectionAngularErrorDeg,
    worldUpDirectionAngularErrorDeg: result.worldUpDirectionAngularErrorDeg,
    signedImageWorldUpDisagreementDeg: result.signedImageWorldUpDisagreementDeg,
    verticalResidualSummary: result.verticalResidualSummary,
    verticals: result.verticals,
  });
}

const TEST_NUMERICAL_TOLERANCE = 1e-6;

test("reference pinhole projector proves simple points, y-down pixels, and cheirality", () => {
  const intrinsics = buildSyntheticIntrinsicsFromFocal({ width: 100, height: 100 }, { fx: 50, fy: 50 });
  const camera = createSyntheticCamera({
    intrinsics,
    position: { x: 0, y: 0, z: 0 },
    lookAt: { x: 0, y: 0, z: 1 },
  });
  const center = projectSyntheticWorldPoint(camera, { x: 0, y: 0, z: 5 });
  const up = projectSyntheticWorldPoint(camera, { x: 0, y: 1, z: 5 });
  const right = projectSyntheticWorldPoint(camera, { x: 1, y: 0, z: 5 });
  const behind = projectSyntheticWorldPoint(camera, { x: 0, y: 0, z: -1 });
  assert.deepEqual(center.ok ? center.pixel : null, { x: 50, y: 50 });
  assert.ok(up.ok && up.pixel.y < 50, "world +Y projects upward because image pixels are y-down");
  assert.ok(right.ok && right.pixel.x < 50, "the +Z-facing camera sees world +X on its image-left");
  assert.deepEqual(behind, { ok: false, reason: "behind_camera" });
  assert.deepEqual(intrinsicPixelsToSourceNormalized({ x: 25, y: 75 }, intrinsics), { x: 0.25, y: 0.75 });
});

test("positive and negative roll use the documented upper-end image-right sign", () => {
  const intrinsics = buildSyntheticIntrinsicsFromFov({ width: 800, height: 600 }, 55);
  const positive = createSyntheticCamera({
    intrinsics, position: { x: 0, y: 1.5, z: 5 }, lookAt: { x: 0, y: 0, z: 0 }, rollDeg: 8,
  });
  const negative = createSyntheticCamera({
    intrinsics, position: { x: 0, y: 1.5, z: 5 }, lookAt: { x: 0, y: 0, z: 0 }, rollDeg: -8,
  });
  const segment = { id: "sign", physicalVerticalId: "back_left" as const, wallKind: "wall_back" as const, lowerWorld: { x: 0, y: 0, z: 0 }, heightMeters: 2 };
  const positiveProjection = projectSyntheticVerticalSegment(positive, segment);
  const negativeProjection = projectSyntheticVerticalSegment(negative, segment);
  assert.ok(signedImageVerticalTiltDeg(positiveProjection.lowerPixel, positiveProjection.upperPixel) > 0);
  assert.ok(signedImageVerticalTiltDeg(negativeProjection.lowerPixel, negativeProjection.upperPixel) < 0);
});

test("fixture reconstruction and canonical fingerprints are deterministic", () => {
  const one = buildSyntheticCameraFixtures();
  const two = buildSyntheticCameraFixtures();
  assert.equal(one.length, 12);
  assert.deepEqual(one.map((fixture) => fixture.fingerprint), two.map((fixture) => fixture.fingerprint));
  assert.deepEqual(one.map((fixture) => fixture.manifest.id), two.map((fixture) => fixture.manifest.id));
  assert.equal(new Set(one.map((fixture) => fixture.manifest.id)).size, one.length);
  assert.ok(one.every((fixture) => fixture.manifest.version === "calibrated-camera/v3-synthetic/v1"));
  assert.ok(one.every((fixture) => fixture.manifest.gates.futureApplyResearch === false));
  assert.deepEqual(
    [...one].reverse().map((fixture) => [fixture.manifest.id, fixture.fingerprint]).sort(),
    [...two].map((fixture) => [fixture.manifest.id, fixture.fingerprint]).sort(),
    "fixture fingerprints remain stable if callers reorder the returned collection"
  );
});

test("exact Floor projection retains the canonical rectangle order", () => {
  const fixture = syntheticFixtureById("v3-synthetic-1-centered-zero-roll");
  const projection = projectSyntheticFloorRectangle(fixture.truthCamera, fixture.floorDimensions);
  assert.deepEqual(projection, fixture.exactFloorPixels);
  assert.ok(projection[0].y > projection[2].y, "near Floor corners appear below far corners in y-down pixels");
});

test("exact world verticals are deterministic and source-normalized after pixel projection", () => {
  const fixture = syntheticFixtureById("v3-synthetic-1-centered-zero-roll");
  for (const record of fixture.verticalEvidence) {
    assert.ok(record.projected.upperPixel.y < record.projected.lowerPixel.y, `${record.projected.id} rises in y-down image pixels`);
    assert.deepEqual(
      record.projected.lowerSourceNormalized,
      intrinsicPixelsToSourceNormalized(record.projected.lowerPixel, fixture.intrinsics)
    );
  }
});

test("Fixtures 1 and 2 recover the exact v2 pose without an asymmetry defect", () => {
  for (const id of ["v3-synthetic-1-centered-zero-roll", "v3-synthetic-2-off-axis-zero-roll"] as const) {
    const fixture = syntheticFixtureById(id);
    const result = solveAndCompare(fixture);
    assert.ok(result.positionErrorMeters < TEST_NUMERICAL_TOLERANCE, `${diagnostics(fixture)}`);
    assert.ok(result.forwardDirectionAngularErrorDeg < TEST_NUMERICAL_TOLERANCE, `${diagnostics(fixture)}`);
    assert.ok(result.worldUpDirectionAngularErrorDeg < TEST_NUMERICAL_TOLERANCE, `${diagnostics(fixture)}`);
    assert.ok(result.floor.maximumPx < TEST_NUMERICAL_TOLERANCE, `${diagnostics(fixture)}`);
    assert.ok((result.verticalResidualSummary.averageAbsoluteDeg ?? Infinity) < TEST_NUMERICAL_TOLERANCE, `${diagnostics(fixture)}`);
  }
});

test("Fixtures 3 and 4 preserve genuine positive and negative roll", () => {
  for (const [id, sign] of [
    ["v3-synthetic-3-positive-roll", 1],
    ["v3-synthetic-4-negative-roll", -1],
  ] as const) {
    const fixture = syntheticFixtureById(id);
    const result = solveAndCompare(fixture);
    assert.ok(result.recoveredOpticalAxisRollDeg * sign > 1, `${diagnostics(fixture)}`);
    assert.ok(Math.abs(result.signedImageWorldUpDisagreementDeg) < TEST_NUMERICAL_TOLERANCE, `${diagnostics(fixture)}`);
    assert.ok((result.verticalResidualSummary.averageAbsoluteDeg ?? Infinity) < TEST_NUMERICAL_TOLERANCE, `${diagnostics(fixture)}`);
  }
});

test("Fixture 5 characterizes abstract second-camera Floor evidence against clean truth verticals", () => {
  const fixture = syntheticFixtureById("v3-synthetic-5-perturbed-floor-clean-verticals");
  const result = solveAndCompare(fixture);
  // Harness regression bands only; never imported by production acceptance logic.
  assert.match(fixture.manifest.description, /abstract incompatible camera-evidence fixture/i);
  assert.match(fixture.manifest.description, /second-camera Floor evidence/i);
  assert.equal(fixture.manifest.evidence.floorOrigin, "second_camera");
  assert.ok(result.floor.maximumPx < 1e-6, diagnostics(fixture));
  assert.ok(result.positionErrorMeters > 0.45 && result.positionErrorMeters < 0.50, diagnostics(fixture));
  assert.ok(result.forwardDirectionAngularErrorDeg > 2.5 && result.forwardDirectionAngularErrorDeg < 2.7, diagnostics(fixture));
  assert.ok(result.worldUpDirectionAngularErrorDeg > 4.2 && result.worldUpDirectionAngularErrorDeg < 4.5, diagnostics(fixture));
  assert.ok(result.signedImageWorldUpDisagreementDeg > 4.4 && result.signedImageWorldUpDisagreementDeg < 4.6, diagnostics(fixture));
  assert.ok((result.verticalResidualSummary.averageAbsoluteDeg ?? 0) > 4.3 && (result.verticalResidualSummary.averageAbsoluteDeg ?? Infinity) < 4.6, diagnostics(fixture));
});

test("Fixture 5b characterizes direct single-camera Floor-corner perturbation and sign reversal", () => {
  const fixture = syntheticFixtureById("v3-synthetic-5b-single-camera-floor-corner-perturbation");
  const result = solveAndCompare(fixture);
  const vectors = fixture.manifest.evidence.floorPixelPerturbationsPx;
  assert.equal(fixture.manifest.evidence.floorOrigin, "truth_camera");
  assert.ok(vectors && vectors.length === 4, "Fixture 5b declares four explicit pixel vectors");
  assert.ok(result.floor.maximumPx < 1e-6, diagnostics(fixture));
  assert.ok(result.worldUpDirectionAngularErrorDeg > 1.3 && result.worldUpDirectionAngularErrorDeg < 1.6, diagnostics(fixture));
  assert.ok(result.signedImageWorldUpDisagreementDeg > 1.4 && result.signedImageWorldUpDisagreementDeg < 1.6, diagnostics(fixture));
  assert.ok((result.verticalResidualSummary.averageAbsoluteDeg ?? 0) > 1.4, diagnostics(fixture));

  // Explicit -1.5 degree counterpart of Fixture 5b's +1.5 degree corner
  // perturbation about the principal point. This reverses the signed
  // perturbation angle while retaining a direct one-camera pixel edit.
  const reversedVectors = [
    { x: 2.2269685747, y: 10.487276666 },
    { x: 4.7396848219, y: -9.7941837248 },
    { x: -0.9634193627, y: -7.9459025582 },
    { x: -1.5258882397, y: 2.7815964462 },
  ];
  const reversed = {
    ...fixture,
    floorEvidencePixels: fixture.exactFloorPixels.map((point, index) =>
      applySyntheticPixelPerturbation(point, reversedVectors[index])
    ),
  };
  const reversedResult = solveAndCompare(reversed);
  assert.ok(reversedResult.floor.maximumPx < 1e-6, diagnostics(reversed));
  assert.ok(reversedResult.signedImageWorldUpDisagreementDeg < -1.4, diagnostics(reversed));
  assert.ok(
    Math.abs(result.signedImageWorldUpDisagreementDeg + reversedResult.signedImageWorldUpDisagreementDeg) < 1e-6,
    "reversing direct Floor-corner perturbations reverses the dominant signed image/world-up disagreement"
  );
});

test("Fixture 6 keeps v2 Floor pose fixed and distinguishes clean from noisy vertical observations", () => {
  const exact = solveAndCompare(syntheticFixtureById("v3-synthetic-2-off-axis-zero-roll"));
  const fixture = syntheticFixtureById("v3-synthetic-6-exact-floor-perturbed-verticals");
  const noisy = solveAndCompare(fixture);
  const residualById = new Map(noisy.verticals.map((vertical) => [vertical.id, vertical.residualDeg]));
  assert.ok(noisy.positionErrorMeters < TEST_NUMERICAL_TOLERANCE, diagnostics(fixture));
  assert.ok(Math.abs(noisy.positionErrorMeters - exact.positionErrorMeters) < TEST_NUMERICAL_TOLERANCE);
  assert.ok(Math.abs(residualById.get("back-left") ?? 0) > 2, diagnostics(fixture));
  assert.ok(Math.abs(residualById.get("front-right") ?? 0) > 1, diagnostics(fixture));
  assert.ok(Math.abs(residualById.get("back-right") ?? Infinity) < TEST_NUMERICAL_TOLERANCE, diagnostics(fixture));
  assert.ok(Math.abs(residualById.get("front-left") ?? Infinity) < TEST_NUMERICAL_TOLERANCE, diagnostics(fixture));
});

test("Fixture 7 retains two deterministic incompatible vertical residual families", () => {
  const fixture = syntheticFixtureById("v3-synthetic-7-bimodal-vertical-families");
  const result = solveAndCompare(fixture);
  const byId = new Map(result.verticals.map((value) => [value.id, value]));
  const offsetFamily = ["back-left", "front-left"].map((id) => byId.get(id)?.residualDeg ?? Number.NaN);
  const cleanFamily = ["back-right", "front-right"].map((id) => byId.get(id)?.residualDeg ?? Number.NaN);
  const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.deepEqual(fixture.verticalEvidence.map((entry) => entry.projected.id), ["back-left", "back-right", "front-left", "front-right"]);
  assert.ok(offsetFamily.every((value) => Math.abs(value) > 3), diagnostics(fixture));
  assert.ok(cleanFamily.every((value) => Math.abs(value) < TEST_NUMERICAL_TOLERANCE), diagnostics(fixture));
  assert.ok(Math.abs(mean(offsetFamily) - mean(cleanFamily)) > 3, diagnostics(fixture));
  assert.deepEqual(solveAndCompare(fixture).verticals, result.verticals, "family residual distributions are repeatable");
});

test("Fixture 9a preserves duplicate records but remains structurally insufficient", () => {
  const fixture = syntheticFixtureById("v3-synthetic-9a-duplicate-only-insufficient");
  assert.equal(fixture.verticalEvidence.length, 2);
  assert.equal(new Set(fixture.verticalEvidence.map((record) => record.observation.physicalVerticalId)).size, 1);
  assert.equal(fixture.verticalEvidence.filter((record) => record.observation.physicalVerticalId === "back_left").length, 2);
  assert.equal(fixture.manifest.expectedFutureV3, "insufficient_vertical_evidence");
});

test("Fixture 9b preserves duplicates and reaches the two-identity structural minimum without a policy verdict", () => {
  const fixture = syntheticFixtureById("v3-synthetic-9b-duplicate-plus-second-identity");
  assert.equal(fixture.verticalEvidence.length, 3);
  assert.equal(new Set(fixture.verticalEvidence.map((record) => record.observation.physicalVerticalId)).size, 2);
  assert.equal(fixture.verticalEvidence.filter((record) => record.observation.physicalVerticalId === "back_left").length, 2);
  assert.ok(fixture.verticalEvidence.some((record) => record.observation.physicalVerticalId === "back_right"));
});

test("Fixture 10 has valid Floor evidence and no vertical authority", () => {
  const fixture = syntheticFixtureById("v3-synthetic-10-missing-vertical-evidence");
  const result = solveAndCompare(fixture);
  assert.equal(fixture.verticalEvidence.length, 0);
  assert.ok(result.floor.maximumPx < TEST_NUMERICAL_TOLERANCE, diagnostics(fixture));
  assert.equal(fixture.manifest.expectedFutureV3, "insufficient_vertical_evidence");
});

const admissionBasis: CalibrationImageBasis = {
  basisId: "v3-synthetic-admission-basis",
  basisFingerprint: "v3-synthetic-admission-fingerprint",
  sourceImageUrl: "https://example.test/synthetic.jpg",
  decodedWidth: 1280,
  decodedHeight: 800,
  encodedOrientation: 1,
  decodedOrientationNormal: true,
  orientationTransform: "identity",
  dimensionSource: "server",
  coordinateSpaceVersion: { decoderId: "synthetic/v1", normalizationPolicyVersion: "synthetic/v1", orientationApplied: false },
  basisKind: "original",
};

function admissionObservation(fixture: SyntheticCameraFixture): StructuralVerticalObservation {
  const record = fixture.verticalEvidence[0];
  return {
    wallKind: record.observation.wallKind,
    sideIndex: 0,
    physicalVerticalId: record.observation.physicalVerticalId,
    sourceNormalizedEndpoints: record.observation.sourceNormalizedEndpoints,
    sourcePixelEndpoints: { lower: record.projected.lowerPixel, upper: record.projected.upperPixel },
    sourcePixelLength: Math.hypot(
      record.projected.upperPixel.x - record.projected.lowerPixel.x,
      record.projected.upperPixel.y - record.projected.lowerPixel.y
    ),
    observedTiltDeg: signedImageVerticalTiltDeg(record.projected.lowerPixel, record.projected.upperPixel),
    lowerWorldPoint: record.projected.lowerWorld,
    predictedWorldUpTiltDeg: null,
    locationMatchedResidualDeg: null,
    reviewState: "manually_confirmed",
    runtimeUsable: true,
    confirmationCurrent: true,
    wallGeometryPolicyVersion: "synthetic/v1",
    inclusion: "included",
    exclusionReason: null,
    frameTouching: false,
    frameCoincident: false,
  };
}

test("Fixture 11 admits only the runtime-usable grazing source", () => {
  const fixture = syntheticFixtureById("v3-synthetic-11-grazing-admission");
  const edge = admissionObservation(fixture);
  const polygon: WallPolygon = [
    { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }, { x: 0.8, y: 0.2 }, { x: 0.2, y: 0.2 },
  ];
  const accepted = deriveVerticalEvidenceSuggestions({
    imageBasis: admissionBasis,
    intrinsicWidth: 1280,
    intrinsicHeight: 800,
    walls: [{ kind: edge.wallKind, polygon, derivationOk: true, runtimeUsable: true }],
    structuralObservations: [edge],
  });
  const refused = deriveVerticalEvidenceSuggestions({
    imageBasis: admissionBasis,
    intrinsicWidth: 1280,
    intrinsicHeight: 800,
    walls: [{ kind: edge.wallKind, polygon, derivationOk: false, runtimeUsable: false }],
    structuralObservations: [edge],
  });
  assert.equal(accepted.length, 1);
  assert.equal(refused.length, 0);
  assert.deepEqual(fixture.admission, { acceptedWall: { derivationOk: true, runtimeUsable: true }, refusedWall: { derivationOk: false, runtimeUsable: false } });
});

test("fixtures are pure test data and do not mutate Floor or evidence inputs", () => {
  const fixture = syntheticFixtureById("v3-synthetic-5-perturbed-floor-clean-verticals");
  const before = JSON.stringify(fixture);
  solveAndCompare(fixture);
  assert.equal(JSON.stringify(fixture), before);
});

test("test-only harness introduces no v3 authority, Apply, restore, or scene-state integration", () => {
  const files = [
    "app/admin/3d-room-lab/v3-synthetic-camera.ts",
    "app/admin/3d-room-lab/v3-synthetic-fixtures.ts",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.equal(source.includes("./calibrated-camera-apply"), false, `${file} must not integrate Apply`);
    assert.equal(source.includes("./calibrated-camera-restore-authority"), false, `${file} must not integrate restore authority`);
    assert.equal(source.includes("./scene-state"), false, `${file} must not integrate scene persistence`);
    assert.equal(source.includes("runV3"), false, `${file} must not introduce a v3 solver`);
  }
});
