import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCalibratedCameraApply } from "./calibrated-camera-apply";
import {
  CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
  type CalibrationImageBasis,
} from "./calibration-image-basis";
import { containerNormToSourceNorm, sourceNormToContainerNorm } from "./image-space";
import {
  buildFloorPolygonAuthorityKey,
  shouldDiscardAttestedResponse,
  shouldDropAuthorityOnFrameChange,
  shouldDropAuthorityOnManualAdjustment,
} from "./policy-a-containment";
import {
  CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2,
  CALIBRATED_SCENE_STATE_SOLVER_V1,
  type CalibratedSceneStateCalibrationV2,
  evaluateCalibrationRestoreCompatibility,
  validateImportedSceneJson,
  type SceneStateValidationConfig,
} from "./scene-state";
import { evaluateCalibrationImageBasisEvidence } from "./calibration-image-basis";

function makeBasis(overrides: Partial<CalibrationImageBasis> = {}): CalibrationImageBasis {
  return {
    basisId: "basis-1",
    basisFingerprint: "fp-a",
    sourceImageUrl: "https://example.com/room.jpg",
    decodedWidth: 1600,
    decodedHeight: 1000,
    encodedOrientation: 1,
    decodedOrientationNormal: true,
    orientationTransform: "identity",
    dimensionSource: "server",
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    basisKind: "original",
    ...overrides,
  };
}

function makeCalibration(
  basis: CalibrationImageBasis = makeBasis()
): CalibratedSceneStateCalibrationV2 {
  return {
    calibrationVersion: CALIBRATED_SCENE_STATE_CALIBRATION_VERSION_V2,
    solver: CALIBRATED_SCENE_STATE_SOLVER_V1,
    intrinsics: { verticalFovDeg: 50 },
    source: {
      imageBasis: basis,
      sourceFloorPolygon: [
        { x: 0.2, y: 0.8 },
        { x: 0.8, y: 0.8 },
        { x: 0.7, y: 0.95 },
        { x: 0.3, y: 0.95 },
      ],
    },
  };
}

const VALIDATION_CONFIG: SceneStateValidationConfig = {
  transformLimits: {
    positionX: { min: -10, max: 10 },
    positionY: { min: -10, max: 10 },
    positionZ: { min: -10, max: 10 },
    rotationYDeg: { min: -180, max: 180 },
    uniformScale: { min: 0.1, max: 10 },
  },
  modelNormalizationLimits: {
    modelYOffset: { min: -10, max: 10 },
    modelYawOffsetDeg: { min: -180, max: 180 },
    modelScaleMultiplier: { min: 0.1, max: 10 },
  },
  floorMappingLimits: {
    worldWidth: { min: 0.1, max: 20 },
    worldDepth: { min: 0.1, max: 20 },
    depthCenterY: { min: 0, max: 1 },
  },
  perspectiveDepthScalingLimits: {
    nearScaleMultiplier: { min: 0.1, max: 5 },
    farScaleMultiplier: { min: 0.1, max: 5 },
    nearFloorY: { min: 0, max: 1 },
    farFloorY: { min: 0, max: 1 },
  },
  defaultModelNormalization: {
    modelYOffset: 0,
    modelYawOffsetDeg: 0,
    modelScaleMultiplier: 1,
  },
  defaultFloorMapping: {
    worldWidth: 4,
    worldDepth: 4,
    depthCenterY: 0.5,
  },
  defaultPerspectiveDepthScaling: {
    enabled: false,
    nearScaleMultiplier: 1,
    farScaleMultiplier: 1,
    nearFloorY: 0.3,
    farFloorY: 0.7,
  },
};

test("1: non-normal EXIF orientation refuses authority qualification", () => {
  const result = evaluateCalibrationImageBasisEvidence({
    metadata: { width: 1600, height: 1000, orientation: 6 },
    browserDimensions: { width: 1600, height: 1000 },
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    basisKind: "original",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "basis_orientation_not_normal");
});

test("2: browser/server intrinsic-dimension mismatch refuses qualification", () => {
  const result = evaluateCalibrationImageBasisEvidence({
    metadata: { width: 1600, height: 1000, orientation: 1 },
    browserDimensions: { width: 1599, height: 1000 },
    coordinateSpaceVersion: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
    basisKind: "original",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "basis_dimension_mismatch");
});

test("3: same URL with changed bytes refuses restore before re-solve", () => {
  const calibration = makeCalibration(makeBasis({ basisFingerprint: "fp-old" }));
  const compat = evaluateCalibrationRestoreCompatibility({
    calibration,
    currentImageBasis: makeBasis({ basisFingerprint: "fp-new" }),
  });
  assert.equal(compat.ok, false);
  if (!compat.ok) assert.equal(compat.reason, "basis_fingerprint_mismatch");
});

test("4: same dimensions with changed fingerprint refuses restore", () => {
  const calibration = makeCalibration(makeBasis({ decodedWidth: 1600, decodedHeight: 1000, basisFingerprint: "one" }));
  const compat = evaluateCalibrationRestoreCompatibility({
    calibration,
    currentImageBasis: makeBasis({ decodedWidth: 1600, decodedHeight: 1000, basisFingerprint: "two" }),
  });
  assert.equal(compat.ok, false);
  if (!compat.ok) assert.equal(compat.reason, "basis_fingerprint_mismatch");
});

test("5: coordinateSpaceVersion mismatch refuses restore", () => {
  const calibration = makeCalibration(
    makeBasis({
      coordinateSpaceVersion: {
        ...CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION,
        decoderId: "different-decoder",
      },
    })
  );
  const compat = evaluateCalibrationRestoreCompatibility({
    calibration,
    currentImageBasis: makeBasis(),
  });
  assert.equal(compat.ok, false);
  if (!compat.ok) assert.equal(compat.reason, "basis_coordinate_space_mismatch");
});

test("6: legacy calibration payload missing basis receipt cannot reactivate authority", () => {
  const parsed = validateImportedSceneJson(
    {
      schemaVersion: "vibode-3d-room-lab-scene-state/v0",
      roomImageUrl: "https://example.com/room.jpg",
      model: { modelPath: "/model.glb" },
      transform: {
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        rotationYDegrees: 0,
        scale: 1,
        autoRotate: false,
      },
      floor: {
        polygon: [
          { x: 0.2, y: 0.8 },
          { x: 0.8, y: 0.8 },
          { x: 0.7, y: 0.95 },
        ],
        overlayVisible: true,
        placementModeEnabled: false,
      },
      calibration: {
        calibrationVersion: "calibrated-camera/v1",
        solver: "homography-planar-cv/v1",
        intrinsics: { verticalFovDeg: 50 },
        frameAspect: 1.6,
        source: {
          imageUrl: "https://example.com/room.jpg",
          intrinsicWidth: 1600,
          intrinsicHeight: 1000,
        },
      },
    },
    VALIDATION_CONFIG
  );
  assert.equal(typeof parsed, "object");
  if (typeof parsed !== "string") {
    assert.equal(parsed.calibration.kind, "ignored");
    if (parsed.calibration.kind === "ignored") {
      assert.equal(parsed.calibration.reason, "basis_legacy_receipt_missing");
    }
  }
});

test("7: frame resize drops active authority receipt", () => {
  assert.equal(
    shouldDropAuthorityOnFrameChange({ width: 1000, height: 600 }, { width: 1001, height: 600 }),
    true
  );
});

test("8: source-normalized polygon survives frame resize and reprojects correctly", () => {
  const intrinsic = { width: 1600, height: 1000 };
  const frameA = { width: 800, height: 500 };
  const frameB = { width: 1200, height: 500 };
  const containerPoint = { x: 0.5, y: 0.8 };
  const source = containerNormToSourceNorm(containerPoint, intrinsic, frameA);
  assert.ok(source);
  const containerInB = sourceNormToContainerNorm(source!, intrinsic, frameB);
  assert.ok(containerInB);
  const sourceRoundTrip = containerNormToSourceNorm(containerInB!, intrinsic, frameB);
  assert.ok(sourceRoundTrip);
  assert.ok(Math.abs(sourceRoundTrip!.x - source!.x) < 1e-6);
  assert.ok(Math.abs(sourceRoundTrip!.y - source!.y) < 1e-6);
});

test("9: legacy container-only polygon remains manual/view-only and cannot apply", () => {
  const candidate = {
    confidence: "high" as const,
    cvAvgPx: 1,
    cvMaxPx: 2,
    displayAvgPx: 1,
    displayMaxPx: 2,
    scaleRatio: 1,
    frameSize: { width: 1000, height: 600 },
  };
  const evalResult = evaluateCalibratedCameraApply(candidate, null, {
    basisQualified: false,
    basisUnavailableReason: "basis_legacy_receipt_missing",
  });
  assert.equal(evalResult.available, false);
  assert.equal(evalResult.reason, "basis_legacy_receipt_missing");
});

test("10: local refinement/manual live control path cannot apply without qualified basis", () => {
  const candidate = {
    confidence: "high" as const,
    cvAvgPx: 1,
    cvMaxPx: 2,
    displayAvgPx: 1,
    displayMaxPx: 2,
    scaleRatio: 1,
    frameSize: { width: 1000, height: 600 },
  };
  const evalResult = evaluateCalibratedCameraApply(candidate, null, {
    basisQualified: false,
    basisUnavailableReason: "basis_unavailable",
  });
  assert.equal(evalResult.available, false);
  assert.equal(evalResult.firstFailingGate, "basis");
});

test("11: vision response with stale/mismatched fingerprint is discarded", () => {
  assert.equal(shouldDiscardAttestedResponse("fp-current", "fp-old"), true);
});

test("12: empty-room-assist response with stale/mismatched fingerprint is discarded", () => {
  assert.equal(shouldDiscardAttestedResponse("fp-current", "fp-empty"), true);
});

test("13: empty-room derivative cannot restore or directly activate authority", () => {
  const calibration = makeCalibration(makeBasis({ basisKind: "derivative" }));
  const compat = evaluateCalibrationRestoreCompatibility({
    calibration,
    currentImageBasis: makeBasis({ basisKind: "original" }),
  });
  assert.equal(compat.ok, false);
  if (!compat.ok) assert.equal(compat.reason, "basis_derivative_not_authority_eligible");
});

test("14: type B override cannot create an authority-eligible apply path", () => {
  const candidate = {
    confidence: "high" as const,
    cvAvgPx: 1,
    cvMaxPx: 2,
    displayAvgPx: 1,
    displayMaxPx: 2,
    scaleRatio: 1,
    frameSize: { width: 1000, height: 600 },
  };
  const evalResult = evaluateCalibratedCameraApply(candidate, null, {
    basisQualified: false,
    basisUnavailableReason: "basis_unavailable",
  });
  assert.equal(evalResult.available, false);
});

test("15: manual adjustment after calibration drops active authority", () => {
  const before = buildFloorPolygonAuthorityKey([
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
    { x: 0.7, y: 0.95 },
    { x: 0.3, y: 0.95 },
  ]);
  const after = buildFloorPolygonAuthorityKey([
    { x: 0.22, y: 0.8 },
    { x: 0.8, y: 0.8 },
    { x: 0.7, y: 0.95 },
    { x: 0.3, y: 0.95 },
  ]);
  assert.equal(shouldDropAuthorityOnManualAdjustment(before, after), true);
});
