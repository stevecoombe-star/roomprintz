import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";

import { intersectOverlayRayWithFloorPlane } from "../3d-room-lab/calibrated-floor-ray";
import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "../3d-room-lab/calibrated-camera-readonly-projection";
import { sourceNormToContainerNormUnclamped } from "../3d-room-lab/image-space";
import { classifyAfcR3cImagePairCompatibility } from "../3d-room-lab/research/afc-r3c-image-pair-compatibility";
import type { FrozenRoomBoundaryCameraSnapshot } from "./room-boundary-authority-contract";
import {
  mapOriginalSourceNormalizedToContainer,
  projectEmptyPolylineToWorld,
  projectEmptySourceNormalizedToWorld,
  projectOriginalSourceNormalizedToWorld,
  realizeFrozenRoomBoundaryCamera,
  ROOM_BOUNDARY_PROJECTION_FAR,
  ROOM_BOUNDARY_PROJECTION_NEAR,
} from "./room-boundary-projection.server";

const ORIGINAL = { width: 1600, height: 900 };
const FRAME = { width: 1200, height: 800 };

function snapshot(
  overrides: Partial<FrozenRoomBoundaryCameraSnapshot> = {},
): FrozenRoomBoundaryCameraSnapshot {
  return {
    verticalFovDeg: 52,
    pose: {
      position: { x: 0.4, y: 2.2, z: 4.8 },
      lookAt: { x: 0, y: 0, z: -0.6 },
      up: { x: 0, y: 1, z: 0 },
    },
    frame: FRAME,
    ...overrides,
  };
}

function compatibility(
  empty: { width: number; height: number },
  original = ORIGINAL,
) {
  return classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: "o".repeat(64),
      decodedWidth: original.width,
      decodedHeight: original.height,
      orientation: 1,
    },
    {
      fingerprint: "e".repeat(64),
      decodedWidth: empty.width,
      decodedHeight: empty.height,
      orientation: 1,
    },
  );
}

function identities(
  empty = ORIGINAL,
  original = ORIGINAL,
) {
  return {
    emptyIntrinsicSize: empty,
    originalIntrinsicSize: original,
    compatibility: compatibility(empty, original),
  };
}

test("frozen camera realization matches the certified V2 viewer recipe", () => {
  const frozen = snapshot();
  const realized = realizeFrozenRoomBoundaryCamera(frozen);
  const viewer = buildCalibratedReadOnlyProjectionCamera({
    fovDeg: frozen.verticalFovDeg,
    pose: frozen.pose,
    frameSize: frozen.frame,
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  });
  assert.equal(realized.ok, true);
  assert.equal(viewer.ok, true);
  if (!realized.ok || !viewer.ok) return;
  assert.equal(ROOM_BOUNDARY_PROJECTION_NEAR, CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR);
  assert.equal(ROOM_BOUNDARY_PROJECTION_FAR, CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR);
  assert.equal(realized.camera.fov, viewer.camera.fov);
  assert.equal(realized.camera.aspect, viewer.camera.aspect);
  assert.equal(realized.camera.near, viewer.camera.near);
  assert.equal(realized.camera.far, viewer.camera.far);
  assert.deepEqual(realized.camera.position.toArray(), viewer.camera.position.toArray());
  assert.deepEqual(realized.camera.up.toArray(), viewer.camera.up.toArray());
});

test("exact-grid EMPTY transfer preserves source-normalized coordinates", () => {
  const realized = realizeFrozenRoomBoundaryCamera(snapshot());
  assert.equal(realized.ok, true);
  if (!realized.ok) return;
  const value = identities({ width: 1600, height: 900 });
  assert.equal(value.compatibility.tier, "exact_grid_compatible");
  const projected = projectEmptySourceNormalizedToWorld(
    { x: 0.58, y: 0.66 },
    value,
    FRAME,
    realized.camera,
  );
  assert.equal(projected.ok, true);
  if (!projected.ok) return;
  assert.deepEqual(projected.originalSourceNormalized, { x: 0.58, y: 0.66 });
});

test("aspect-compatible EMPTY transfer uses numerical identity", () => {
  const realized = realizeFrozenRoomBoundaryCamera(snapshot());
  assert.equal(realized.ok, true);
  if (!realized.ok) return;
  const value = identities({ width: 1200, height: 675 });
  assert.equal(value.compatibility.tier, "aspect_compatible_rescaled");
  const projected = projectEmptySourceNormalizedToWorld(
    { x: 0.4, y: 0.7 },
    value,
    FRAME,
    realized.camera,
  );
  assert.equal(projected.ok, true);
  if (!projected.ok) return;
  assert.deepEqual(projected.originalSourceNormalized, { x: 0.4, y: 0.7 });
});

test("incompatible EMPTY/Original bases fail closed without projection", () => {
  const realized = realizeFrozenRoomBoundaryCamera(snapshot());
  assert.equal(realized.ok, true);
  if (!realized.ok) return;
  const value = identities({ width: 1000, height: 100 });
  assert.equal(value.compatibility.tier, "incompatible");
  const projected = projectEmptySourceNormalizedToWorld(
    { x: 0.5, y: 0.5 },
    value,
    FRAME,
    realized.camera,
  );
  assert.equal(projected.ok, false);
  if (projected.ok) return;
  assert.equal(projected.reason, "incompatible_basis");
});

test("cover-crop source→container mapping is never skipped", () => {
  const intrinsic = { width: 1200, height: 800 };
  const nearMatchFrame = { width: 900, height: 601 };
  const source = { x: 0.2, y: 0.8 };
  const mapped = mapOriginalSourceNormalizedToContainer(
    source,
    intrinsic,
    nearMatchFrame,
  );
  const helper = sourceNormToContainerNormUnclamped(
    source,
    intrinsic,
    nearMatchFrame,
  );
  assert.ok(mapped);
  assert.deepEqual(mapped, helper);
  assert.ok(Math.abs(mapped!.x - source.x) > 1e-6 || Math.abs(mapped!.y - source.y) > 1e-6);
});

test("NDC mapping is x=2u-1, y=1-2v via the shared floor-ray helper", () => {
  const realized = realizeFrozenRoomBoundaryCamera(snapshot());
  assert.equal(realized.ok, true);
  if (!realized.ok) return;
  const container = { x: 0.25, y: 0.25 };
  const ndc = new THREE.Vector3(container.x * 2 - 1, 1 - container.y * 2, 0.5);
  assert.equal(ndc.x, -0.5);
  assert.equal(ndc.y, 0.5);
  const ray = intersectOverlayRayWithFloorPlane(container, realized.camera, 0);
  const original = projectOriginalSourceNormalizedToWorld(
    container,
    { width: FRAME.width, height: FRAME.height },
    FRAME,
    realized.camera,
  );
  assert.equal(ray.ok, true);
  assert.equal(original.ok, true);
  if (!ray.ok || !original.ok) return;
  assert.ok(Math.abs(original.world.x - ray.worldPoint.x) <= 1e-12);
  assert.ok(Math.abs(original.world.z - ray.worldPoint.z) <= 1e-12);
  assert.ok(Math.abs(original.world.y) <= 1e-12);
});

test("parallel ray failure is preserved", () => {
  const realized = realizeFrozenRoomBoundaryCamera(snapshot({
    pose: {
      position: { x: 0.4, y: 2.2, z: 4.8 },
      lookAt: { x: 0.4, y: 2.2, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
  }));
  assert.equal(realized.ok, true);
  if (!realized.ok) return;
  const projected = projectEmptySourceNormalizedToWorld(
    { x: 0.5, y: 0.5 },
    identities(),
    FRAME,
    realized.camera,
  );
  assert.equal(projected.ok, false);
  if (projected.ok) return;
  assert.equal(projected.reason, "ray_parallel_to_floor");
});

test("behind-camera failure is preserved", () => {
  const realized = realizeFrozenRoomBoundaryCamera(snapshot({
    pose: {
      position: { x: 0, y: 2, z: 4 },
      lookAt: { x: 0, y: 2.4, z: 3 },
      up: { x: 0, y: 1, z: 0 },
    },
  }));
  assert.equal(realized.ok, true);
  if (!realized.ok) return;
  const projected = projectOriginalSourceNormalizedToWorld(
    { x: 0.5, y: 0.05 },
    ORIGINAL,
    FRAME,
    realized.camera,
  );
  assert.equal(projected.ok, false);
  if (projected.ok) return;
  assert.ok(
    projected.reason === "ray_intersection_behind_camera" ||
      projected.reason === "intersection behind camera" ||
      projected.reason === "ray parallel to floor" ||
      projected.reason === "ray_parallel_to_floor",
  );
});

test("non-finite input fails without a fallback point", () => {
  const realized = realizeFrozenRoomBoundaryCamera(snapshot());
  assert.equal(realized.ok, true);
  if (!realized.ok) return;
  const projected = projectEmptySourceNormalizedToWorld(
    { x: Number.NaN, y: 0.5 },
    identities(),
    FRAME,
    realized.camera,
  );
  assert.equal(projected.ok, false);
  if (projected.ok) return;
  assert.equal(projected.reason, "invalid_input");
});

test("partial polyline projection preserves the failed vertex", () => {
  const realized = realizeFrozenRoomBoundaryCamera(snapshot());
  assert.equal(realized.ok, true);
  if (!realized.ok) return;
  const points = projectEmptyPolylineToWorld(
    [{ x: 0.4, y: 0.7 }, { x: Number.POSITIVE_INFINITY, y: 0.7 }],
    identities(),
    FRAME,
    realized.camera,
  );
  assert.equal(points.length, 2);
  assert.equal(points[0]?.ok, true);
  assert.equal(points[1]?.ok, false);
  if (points[1] && !points[1].ok) {
    assert.equal(points[1].reason, "invalid_input");
  }
});
