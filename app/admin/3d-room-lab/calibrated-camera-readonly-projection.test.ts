import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
  type CalibratedReadOnlyProjectionInput,
} from "./calibrated-camera-readonly-projection";
import { projectFloorPointThroughPose } from "./perspective-solve";

const TOLERANCE_PX = 1e-8;
const FLOOR_CORNERS = [
  { x: -2, y: 0, z: 2 },
  { x: 2, y: 0, z: 2 },
  { x: 2, y: 0, z: -2 },
  { x: -2, y: 0, z: -2 },
] as const;

function input(overrides: Partial<CalibratedReadOnlyProjectionInput> = {}): CalibratedReadOnlyProjectionInput {
  return {
    fovDeg: 52,
    pose: {
      position: { x: 0.4, y: 2.2, z: 4.8 },
      lookAt: { x: 0, y: 0, z: -0.6 },
      up: { x: 0, y: 1, z: 0 },
    },
    frameSize: { width: 1280, height: 720 },
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
    ...overrides,
  };
}

function requireCamera(value: ReturnType<typeof buildCalibratedReadOnlyProjectionCamera>): THREE.PerspectiveCamera {
  if (!value.ok) throw new Error(value.reason);
  return value.camera;
}

function projectThreeCamera(camera: THREE.PerspectiveCamera, frameSize: { width: number; height: number }, point: { x: number; y: number; z: number }) {
  const ndc = new THREE.Vector3(point.x, point.y, point.z).project(camera);
  return {
    x: ((ndc.x + 1) / 2) * frameSize.width,
    y: ((1 - ndc.y) / 2) * frameSize.height,
  };
}

function assertPixelsEqual(actual: { x: number; y: number }, expected: { x: number; y: number }, label: string) {
  assert.ok(Math.abs(actual.x - expected.x) <= TOLERANCE_PX, `${label}: x differs by ${Math.abs(actual.x - expected.x)}px`);
  assert.ok(Math.abs(actual.y - expected.y) <= TOLERANCE_PX, `${label}: y differs by ${Math.abs(actual.y - expected.y)}px`);
}

test("constructs a projection-only Three camera from finite accepted snapshot input", () => {
  const value = input();
  const camera = requireCamera(buildCalibratedReadOnlyProjectionCamera(value));

  assert.equal(camera.fov, value.fovDeg);
  assert.equal(camera.aspect, value.frameSize.width / value.frameSize.height);
  assert.equal(camera.near, CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR);
  assert.equal(camera.far, CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR);
  assert.deepEqual(camera.position.toArray(), [value.pose.position.x, value.pose.position.y, value.pose.position.z]);
  assert.deepEqual(camera.up.toArray(), [value.pose.up.x, value.pose.up.y, value.pose.up.z]);

  const expectedForward = new THREE.Vector3(
    value.pose.lookAt.x - value.pose.position.x,
    value.pose.lookAt.y - value.pose.position.y,
    value.pose.lookAt.z - value.pose.position.z
  ).normalize();
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(expectedForward) <= 1e-12);
});

test("does not mutate snapshot input and constructs deterministically", () => {
  const value = input();
  const original = structuredClone(value);
  const first = requireCamera(buildCalibratedReadOnlyProjectionCamera(value));
  const second = requireCamera(buildCalibratedReadOnlyProjectionCamera(value));

  assert.deepEqual(value, original);
  for (const point of FLOOR_CORNERS) {
    assertPixelsEqual(
      projectThreeCamera(first, value.frameSize, point),
      projectThreeCamera(second, value.frameSize, point),
      "repeated construction"
    );
  }
});

test("fails closed for invalid frame, FOV, and near/far inputs", () => {
  const invalidInputs = [
    input({ frameSize: { width: 0, height: 720 } }),
    input({ frameSize: { width: 1280, height: Number.NaN } }),
    input({ fovDeg: Number.POSITIVE_INFINITY }),
    input({ near: 0 }),
    input({ near: 1, far: 1 }),
    input({ near: 2, far: 1 }),
  ];

  for (const invalid of invalidInputs) {
    const result = buildCalibratedReadOnlyProjectionCamera(invalid);
    assert.equal(result.ok, false);
    assert.equal("camera" in result, false);
  }
});

test("fails closed for non-finite pose values without returning a fallback camera", () => {
  const invalidInputs = [
    input({ pose: { ...input().pose, position: { x: Number.NaN, y: 2, z: 4 } } }),
    input({ pose: { ...input().pose, lookAt: { x: 0, y: Number.NEGATIVE_INFINITY, z: 0 } } }),
    input({ pose: { ...input().pose, up: { x: 0, y: Number.NaN, z: 0 } } }),
  ];

  for (const invalid of invalidInputs) {
    const result = buildCalibratedReadOnlyProjectionCamera(invalid);
    assert.equal(result.ok, false);
    assert.equal("camera" in result, false);
  }
});

test("fails closed for degenerate view direction and up vectors", () => {
  const value = input();
  const invalidInputs = [
    input({ pose: { ...value.pose, lookAt: { ...value.pose.position } } }),
    input({ pose: { ...value.pose, up: { x: 0, y: 0, z: 0 } } }),
    input({
      pose: {
        ...value.pose,
        up: {
          x: value.pose.lookAt.x - value.pose.position.x,
          y: value.pose.lookAt.y - value.pose.position.y,
          z: value.pose.lookAt.z - value.pose.position.z,
        },
      },
    }),
  ];

  for (const invalid of invalidInputs) {
    assert.equal(buildCalibratedReadOnlyProjectionCamera(invalid).ok, false);
  }
});

test("matches the Apply-gate display surrogate to within 1e-8 px across camera fixtures", () => {
  const fixtures: CalibratedReadOnlyProjectionInput[] = [
    input(),
    input({ frameSize: { width: 1440, height: 900 } }),
    input({
      pose: {
        position: { x: 1.3, y: 2, z: 5.1 },
        lookAt: { x: -0.7, y: 0.15, z: -0.9 },
        up: { x: 0, y: 1, z: 0 },
      },
    }),
    input({
      pose: {
        position: { x: -0.5, y: 3.8, z: 3.5 },
        lookAt: { x: 0.2, y: 0, z: -0.9 },
        up: { x: 0, y: 1, z: 0 },
      },
    }),
    input({
      pose: {
        position: { x: 0.3, y: 1.7, z: 8.2 },
        lookAt: { x: 0, y: 0, z: -0.8 },
        up: { x: 0, y: 1, z: 0 },
      },
    }),
    input({ fovDeg: 35 }),
    input({ fovDeg: 75 }),
  ];

  for (const [fixtureIndex, fixture] of fixtures.entries()) {
    const camera = requireCamera(buildCalibratedReadOnlyProjectionCamera(fixture));
    for (const [cornerIndex, point] of FLOOR_CORNERS.entries()) {
      const displayProjection = projectFloorPointThroughPose(
        fixture.pose,
        fixture.frameSize,
        { verticalFovDeg: fixture.fovDeg },
        { x: point.x, y: point.z }
      );
      assert.equal(displayProjection.ok, true, `fixture ${fixtureIndex}, corner ${cornerIndex} should be in front`);
      if (!displayProjection.ok) continue;
      assertPixelsEqual(
        projectThreeCamera(camera, fixture.frameSize, point),
        displayProjection.value,
        `fixture ${fixtureIndex}, corner ${cornerIndex}`
      );
    }
  }
});

test("uses calibrated pose instead of the distinct legacy camera projection", () => {
  const calibrated = input({
    fovDeg: 67,
    pose: {
      position: { x: 1.4, y: 2.6, z: 5.3 },
      lookAt: { x: -0.4, y: 0.1, z: -0.7 },
      up: { x: 0, y: 1, z: 0 },
    },
  });
  const point = { x: 1.2, y: 0, z: -0.5 };
  const calibratedCamera = requireCamera(buildCalibratedReadOnlyProjectionCamera(calibrated));
  const displayProjection = projectFloorPointThroughPose(
    calibrated.pose,
    calibrated.frameSize,
    { verticalFovDeg: calibrated.fovDeg },
    { x: point.x, y: point.z }
  );
  assert.equal(displayProjection.ok, true);
  if (!displayProjection.ok) return;

  const calibratedProjection = projectThreeCamera(calibratedCamera, calibrated.frameSize, point);
  assertPixelsEqual(calibratedProjection, displayProjection.value, "calibrated projection");

  const legacyCamera = new THREE.PerspectiveCamera(
    50,
    calibrated.frameSize.width / calibrated.frameSize.height,
    CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR
  );
  legacyCamera.position.set(0, 1.1, 3.2);
  legacyCamera.rotation.set(0, 0, 0);
  legacyCamera.updateProjectionMatrix();
  legacyCamera.updateMatrixWorld(true);
  const legacyProjection = projectThreeCamera(legacyCamera, calibrated.frameSize, point);
  assert.ok(
    Math.hypot(calibratedProjection.x - legacyProjection.x, calibratedProjection.y - legacyProjection.y) > 1,
    "calibrated projection must not match the legacy camera"
  );
});
