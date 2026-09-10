import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionPerspectiveCamera,
  frozenCameraAspect,
  realizeFrozenCameraFromAuthority,
} from "./frozen-camera";
import { createPi3aAuthority } from "./pi3a-test-fixture";
import { realizeCameraPose as labRealizeCameraPose } from "@/app/admin/3d-room-lab-v2/scene-metric-world-realization";

test("production camera FOV, pose, up, and aspect come only from persisted authority", () => {
  const pose = {
    position: { x: 1.25, y: 2.5, z: 3.75 },
    lookAt: { x: 0.25, y: 0.5, z: -0.75 },
    up: { x: 0, y: 1, z: 0 },
  };
  const frame = { width: 1118, height: 698 };
  const authority = createPi3aAuthority({
    verticalFovDeg: 61.5,
    pose,
    frame,
    metricScale: 1.7,
  });
  const realized = realizeFrozenCameraFromAuthority(authority);
  const expectedPose = labRealizeCameraPose(pose, 1.7);
  assert.equal(realized.verticalFovDeg, 61.5);
  assert.equal(realized.aspect, frame.width / frame.height);
  assert.equal(realized.aspect, frozenCameraAspect(frame));
  assert.deepEqual(realized.pose.position, expectedPose.position);
  assert.deepEqual(realized.pose.lookAt, expectedPose.lookAt);
  assert.deepEqual(realized.pose.up, pose.up);

  const built = buildProductionPerspectiveCamera(realized);
  if (!built.ok) throw new Error(built.reason);
  assert.equal(built.camera.fov, 61.5);
  assert.equal(built.camera.aspect, frame.width / frame.height);
  assert.deepEqual(built.camera.position.toArray(), [
    expectedPose.position.x,
    expectedPose.position.y,
    expectedPose.position.z,
  ]);
  assert.deepEqual(built.camera.up.toArray(), [0, 1, 0]);
});

test("camera construction does not use container aspect or a second FOV estimate", () => {
  const authority = createPi3aAuthority({
    verticalFovDeg: 47,
    frame: { width: 1600, height: 900 },
  });
  const realized = realizeFrozenCameraFromAuthority(authority);
  const built = buildProductionPerspectiveCamera(realized);
  if (!built.ok) throw new Error(built.reason);
  assert.equal(built.camera.fov, authority.frozenCamera.verticalFovDeg);
  assert.equal(built.camera.aspect, 1600 / 900);
  assert.notEqual(built.camera.aspect, 16 / 10);
});
