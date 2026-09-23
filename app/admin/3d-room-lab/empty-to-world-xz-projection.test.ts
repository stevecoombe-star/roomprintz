import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { intersectOverlayRayWithFloorPlane } from "./calibrated-floor-ray";
import {
  projectEmptyFloorPointToWorldXZ,
  transferEmptySourceNormalizedToOriginal,
  type EmptyToWorldXZProjectionInput,
} from "./empty-to-world-xz-projection";
import { sourceNormToContainerNormUnclamped } from "./image-space";
import { classifyAfcR3cImagePairCompatibility } from "./research/afc-r3c-image-pair-compatibility";

const ORIGINAL = { width: 1600, height: 900 };
const FRAME = { width: 1200, height: 800 };

function camera(horizontal = false): THREE.PerspectiveCamera {
  const value = new THREE.PerspectiveCamera(52, FRAME.width / FRAME.height, 0.1, 100);
  value.position.set(0.4, 2.2, 4.8);
  value.up.set(0, 1, 0);
  value.lookAt(horizontal ? 0.4 : 0, horizontal ? 2.2 : 0, horizontal ? 0 : -0.6);
  value.updateProjectionMatrix();
  value.updateMatrixWorld(true);
  return value;
}

function compatibility(empty: { width: number; height: number }) {
  return classifyAfcR3cImagePairCompatibility(
    { fingerprint: "o".repeat(64), decodedWidth: ORIGINAL.width, decodedHeight: ORIGINAL.height, orientation: 1 },
    { fingerprint: "e".repeat(64), decodedWidth: empty.width, decodedHeight: empty.height, orientation: 1 }
  );
}

function input(
  empty = { width: 1600, height: 900 },
  overrides: Partial<EmptyToWorldXZProjectionInput> = {}
): EmptyToWorldXZProjectionInput {
  return {
    emptySourceNormalized: { x: 0.58, y: 0.66 },
    emptyIntrinsicSize: empty,
    originalIntrinsicSize: ORIGINAL,
    compatibility: compatibility(empty),
    containerSize: FRAME,
    calibratedCamera: camera(),
    ...overrides,
  };
}

function successful<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  assert.equal(result.ok, true, result.ok ? "expected success" : JSON.stringify(result));
  return result as Extract<T, { ok: true }>;
}

test("exact-grid EMPTY transfer preserves source-normalized coordinates", () => {
  const value = input();
  const result = successful(transferEmptySourceNormalizedToOriginal(value));

  assert.equal(value.compatibility.tier, "exact_grid_compatible");
  assert.deepEqual(result.originalSourceNormalized, value.emptySourceNormalized);
});

test("aspect-compatible EMPTY transfer uses normalized-coordinate reinterpretation", () => {
  const value = input({ width: 1200, height: 675 });
  const result = successful(transferEmptySourceNormalizedToOriginal(value));

  assert.equal(value.compatibility.tier, "aspect_compatible_rescaled");
  assert.deepEqual(result.originalSourceNormalized, value.emptySourceNormalized);
});

test("incompatible EMPTY/Original bases fail without projection", () => {
  const value = input({ width: 1000, height: 100 });
  const result = projectEmptyFloorPointToWorldXZ(value);

  assert.equal(value.compatibility.tier, "incompatible");
  assert.deepEqual(result, {
    ok: false,
    reason: "incompatible_basis",
    detail: "Input image aspect ratio diverges too far for transfer.",
  });
});

test("EMPTY projection matches the shared calibrated camera ray on the same container point", () => {
  for (const empty of [{ width: 1600, height: 900 }, { width: 1200, height: 675 }]) {
    const value = input(empty);
    const result = successful(projectEmptyFloorPointToWorldXZ(value));
    const container = sourceNormToContainerNormUnclamped(
      value.emptySourceNormalized,
      value.originalIntrinsicSize,
      value.containerSize
    );
    assert.ok(container);
    const directRay = successful(intersectOverlayRayWithFloorPlane(container, value.calibratedCamera, 0));

    assert.ok(Math.abs(result.worldXZ.x - directRay.floorPlane2D.x) <= 1e-12);
    assert.ok(Math.abs(result.worldXZ.z - directRay.floorPlane2D.y) <= 1e-12);
    assert.deepEqual(result.containerNormalized, container);
  }
});

test("rejects non-finite EMPTY coordinates", () => {
  const result = projectEmptyFloorPointToWorldXZ(input(undefined, {
    emptySourceNormalized: { x: Number.NaN, y: 0.5 },
  }));

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "invalid_input");
});

test("reports a parallel calibrated-camera ray without a fallback geometry path", () => {
  const result = projectEmptyFloorPointToWorldXZ(input(undefined, {
    emptySourceNormalized: { x: 0.5, y: 0.5 },
    calibratedCamera: camera(true),
  }));

  assert.deepEqual(result, {
    ok: false,
    reason: "ray_parallel_to_floor",
    detail: "ray parallel to floor",
  });
});
