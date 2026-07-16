import assert from "node:assert/strict";
import test from "node:test";
import type { CalibrationImageBasis } from "./calibration-image-basis";
import { evaluateSupportUsability } from "./support-model";

function makeBasis(overrides: Partial<CalibrationImageBasis> = {}): CalibrationImageBasis {
  return {
    basisId: "basis-1",
    basisFingerprint: "fingerprint-1",
    sourceImageUrl: "https://example.test/room.jpg",
    decodedWidth: 1600,
    decodedHeight: 900,
    encodedOrientation: 1,
    decodedOrientationNormal: true,
    orientationTransform: "identity",
    dimensionSource: "server",
    coordinateSpaceVersion: {
      decoderId: "sharp-metadata/v1",
      normalizationPolicyVersion: "orientation-normal/v1",
      orientationApplied: false,
    },
    basisKind: "original",
    ...overrides,
  };
}

function makeInput() {
  const basis = makeBasis();
  return {
    reviewStatus: "manually_confirmed" as const,
    geometryValid: true,
    currentImageBasis: basis,
    supportImageBasis: basis,
    activeCameraSnapshot: { imageBasis: basis, frameSize: { width: 1000, height: 800 } },
    currentFrameSize: { width: 1000, height: 800 },
    cameraSnapshotStale: false,
  };
}

test("confirmed support with compatible camera and basis is usable", () => {
  assert.deepEqual(evaluateSupportUsability(makeInput()), {
    usable: true,
    blockingReasons: [],
    firstBlockingReason: null,
  });
});

test("camera absence blocks runtime without changing reviewed input", () => {
  const input = { ...makeInput(), activeCameraSnapshot: null };
  const result = evaluateSupportUsability(input);
  assert.equal(input.reviewStatus, "manually_confirmed");
  assert.deepEqual(result.blockingReasons, ["no_active_calibrated_camera"]);
});

test("unconfirmed support remains blocked with a valid active camera", () => {
  const result = evaluateSupportUsability({ ...makeInput(), reviewStatus: "needs_review" });
  assert.deepEqual(result.blockingReasons, ["support_not_confirmed"]);
});

test("invalid support geometry blocks use", () => {
  const result = evaluateSupportUsability({ ...makeInput(), geometryValid: false });
  assert.deepEqual(result.blockingReasons, ["invalid_support_geometry"]);
});

test("incompatible support basis blocks use", () => {
  const result = evaluateSupportUsability({
    ...makeInput(),
    supportImageBasis: makeBasis({ basisFingerprint: "different" }),
  });
  assert.deepEqual(result.blockingReasons, ["image_basis_mismatch"]);
});

test("stale snapshot and incompatible frame are reported explicitly", () => {
  const result = evaluateSupportUsability({
    ...makeInput(),
    cameraSnapshotStale: true,
    currentFrameSize: { width: 900, height: 800 },
  });
  assert.deepEqual(result.blockingReasons, ["camera_snapshot_stale", "frame_size_mismatch"]);
});

test("multiple support blockers use stable gate ordering", () => {
  const result = evaluateSupportUsability({
    ...makeInput(),
    reviewStatus: "suggested",
    geometryValid: false,
    currentImageBasis: null,
    supportImageBasis: null,
    activeCameraSnapshot: null,
    currentFrameSize: null,
    cameraSnapshotStale: true,
  });
  assert.deepEqual(result.blockingReasons, [
    "no_active_calibrated_camera",
    "image_basis_unqualified",
    "invalid_support_geometry",
    "support_not_confirmed",
  ]);
  assert.equal(result.firstBlockingReason, "no_active_calibrated_camera");
});
