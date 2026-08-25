import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "../3d-room-lab/calibrated-camera-readonly-projection";

const source = readFileSync(
  path.join(process.cwd(), "app/admin/3d-room-lab-v2/CalibratedRoomViewer.tsx"),
  "utf8",
);

test("read-only viewer realizes only the supplied frozen snapshot", () => {
  assert.match(source, /buildCalibratedReadOnlyProjectionCamera/);
  assert.match(source, /fovDeg:\s*snapshot\.verticalFovDeg/);
  assert.match(source, /pose:\s*snapshot\.pose/);
  assert.match(source, /frameSize:\s*snapshot\.frame/);
  assert.match(source, /renderer\.render\(scene, result\.camera\)/);
});

test("frozen snapshot FOV, position, and orientation are applied exactly", () => {
  const snapshot = {
    verticalFovDeg: 61.5,
    frame: { width: 1118, height: 698 },
    pose: {
      position: { x: 1.25, y: 2.5, z: 3.75 },
      lookAt: { x: 0.25, y: 0.5, z: -0.75 },
      up: { x: 0, y: 1, z: 0 },
    },
  };
  const result = buildCalibratedReadOnlyProjectionCamera({
    fovDeg: snapshot.verticalFovDeg,
    pose: snapshot.pose,
    frameSize: snapshot.frame,
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.camera.fov, snapshot.verticalFovDeg);
  assert.deepEqual(result.camera.position.toArray(), [1.25, 2.5, 3.75]);
  assert.deepEqual(result.camera.up.toArray(), [0, 1, 0]);
  assert.equal(result.camera.aspect, snapshot.frame.width / snapshot.frame.height);
});

test("read-only viewer has no solver, camera writer, or historical host coupling", () => {
  assert.doesNotMatch(
    source,
    /evaluateQuadSolvability|settleAfc|evaluateCalibratedCameraApply|freezeApplied|setCalibratedCamera|ThreeRoomLab/,
  );
  assert.doesNotMatch(source, /collision|support|furniture/i);
  assert.doesNotMatch(source, /on[A-Z][A-Za-z]*=/);
});
