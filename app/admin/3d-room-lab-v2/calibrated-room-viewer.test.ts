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
const roomLabSource = readFileSync(
  path.join(process.cwd(), "app/admin/3d-room-lab-v2/RoomLabV2.tsx"),
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
  assert.doesNotMatch(source, /live-collision-blockers|support-attachment|room-envelope-reconciliation/);
  assert.doesNotMatch(source, /on[A-Z][A-Za-z]*=/);
  assert.doesNotMatch(source, /result\.camera\.(fov|aspect|position|up)\s*=/);
});

test("floor quad visibility is a render flag and does not rebuild the frozen camera", () => {
  assert.match(source, /floorSurface\.visible = showFloorQuadRef\.current/);
  assert.match(source, /floorWireframe\.visible = showFloorQuadRef\.current/);
  assert.match(
    source,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot\]\);/,
  );
  assert.doesNotMatch(
    source,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot, showFloorQuad\]\);/,
  );
});

test("collision-boundary visibility is a render flag and does not rebuild the frozen camera", () => {
  assert.match(
    source,
    /collisionWallLayer\.visible = showCollisionBoundaryRef\.current/,
  );
  assert.match(
    source,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot\]\);/,
  );
  assert.doesNotMatch(
    source,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot, showCollisionBoundary\]\);/,
  );
  assert.doesNotMatch(
    source,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot, showFloorQuad, showCollisionBoundary\]\);/,
  );
});

test("wall-boundary visibility is a render flag and does not rebuild the frozen camera", () => {
  assert.match(
    source,
    /wallBaseLayer\.visible = showWallBoundaryRef\.current/,
  );
  assert.match(
    source,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot\]\);/,
  );
  assert.doesNotMatch(
    source,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot, showWallBoundary\]\);/,
  );
  assert.doesNotMatch(
    source,
    /collisionWallLayer\.visible = showWallBoundaryRef\.current/,
  );
});

test("accepted Original and transparent calibrated overlay coexist after apply", () => {
  assert.match(
    roomLabSource,
    /selectedRepresentation === "ORIGINAL"[\s\S]*applied[\s\S]*<CalibratedRoomViewer[\s\S]*originalImageUrl=\{selectedRepresentation\.imageUrl\}[\s\S]*camera=\{applied\.camera\}/,
  );
  assert.match(source, /<Image[\s\S]*src=\{originalImageUrl\}/);
  assert.match(source, /alt="Accepted Original room basis"/);
  assert.match(source, /className="z-0 object-contain"/);
  assert.match(source, /pointer-events-none absolute inset-0 overflow-hidden/);
  assert.match(source, /new THREE\.WebGLRenderer\(\{ alpha: true/);
  assert.match(source, /renderer\.setClearColor\(0x000000, 0\)/);
  assert.match(source, /renderer\.setClearAlpha\(0\)/);
  assert.match(source, /scene\.background = null/);
  assert.match(source, /className="pointer-events-auto absolute inset-0 z-10 bg-transparent"/);
  assert.doesNotMatch(source, /TextureLoader|map:\s*texture/);
  assert.match(source, /new THREE\.MeshBasicMaterial\(\{[\s\S]*color: 0x22d3ee/);
  assert.match(source, /new THREE\.EdgesGeometry\(geometry\)/);
  assert.match(source, /new THREE\.LineSegments/);
  assert.match(roomLabSource, /frame:\s*originalDisplayFrame/);
  assert.doesNotMatch(source, /camera\.aspect\s*=|setCalibratedCamera/);
  assert.doesNotMatch(source, /OrbitControls/);
  assert.match(source, /new TransformControls\(result\.camera, renderer\.domElement\)/);
  assert.match(source, /controls\.attach\(target\)/);
  assert.match(source, /transformControlsAttachmentTarget\(entry\)/);
  assert.match(source, /raycaster\.intersectObject\(objectLayer, true\)/);
  assert.doesNotMatch(source, /attach\(entry\.autoBounds\)/);
});
