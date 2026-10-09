import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as THREE from "three";

import { buildProductionPerspectiveCamera } from "@/lib/afc-v2-runtime/frozen-camera";
import {
  AFC_V2_RUNTIME_CAMERA_FAR,
  AFC_V2_RUNTIME_CAMERA_NEAR,
  type RealizedFrozenCamera,
} from "@/lib/afc-v2-runtime/types";
import { STAGE_CONTACT_SHADOW_NAME } from "@/lib/vibode-stage/stage-lighting";

import {
  HARMONIZE_TRUSTED_PATH_NAME,
  collectHarmonizeHiddenObjects,
  flipRgbaRows,
  stageCameraMatchesRealized,
  withHarmonizeVisibilityIsolation,
} from "./harmonize-export-scene";

const realized: RealizedFrozenCamera = {
  verticalFovDeg: 50,
  aspect: 1.5,
  near: AFC_V2_RUNTIME_CAMERA_NEAR,
  far: AFC_V2_RUNTIME_CAMERA_FAR,
  pose: {
    position: { x: 0, y: 1.5, z: 4 },
    lookAt: { x: 0, y: 0.4, z: 0 },
    up: { x: 0, y: 1, z: 0 },
  },
  frame: { width: 1200, height: 800 },
};

test("export isolation hides shadows and chrome without moving furniture", () => {
  const root = new THREE.Group();
  const furniture = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
  furniture.name = "sofa";
  furniture.position.set(1, 2, 3);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial(),
  );
  shadow.name = STAGE_CONTACT_SHADOW_NAME;
  shadow.position.set(4, 5, 6);
  const path = new THREE.Group();
  path.name = HARMONIZE_TRUSTED_PATH_NAME;
  const gizmo = new THREE.Group();
  gizmo.name = "gizmo";
  root.add(furniture, shadow, path, gizmo);

  const hidden = collectHarmonizeHiddenObjects(root, [gizmo]);
  assert.equal(hidden.includes(furniture), false);
  assert.equal(hidden.filter((object) => object === shadow).length, 1);
  let sawShadow = true;
  let sawFurniture = false;
  let sawGizmo = true;
  assert.throws(() => {
    withHarmonizeVisibilityIsolation(hidden, () => {
      sawShadow = shadow.visible;
      sawFurniture = furniture.visible;
      sawGizmo = gizmo.visible;
      throw new Error("render failed");
    });
  }, /render failed/);
  assert.equal(sawShadow, false);
  assert.equal(sawFurniture, true);
  assert.equal(sawGizmo, false);
  assert.equal(shadow.visible, true);
  assert.equal(path.visible, true);
  assert.equal(gizmo.visible, true);
  assert.deepEqual(furniture.position.toArray(), [1, 2, 3]);
  assert.deepEqual(shadow.position.toArray(), [4, 5, 6]);

  gizmo.visible = false;
  withHarmonizeVisibilityIsolation([gizmo], () => undefined);
  assert.equal(gizmo.visible, false);
});

test("certified camera match accepts the frozen projection and rejects drift", () => {
  const built = buildProductionPerspectiveCamera(realized);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(stageCameraMatchesRealized(built.camera, realized), true);
  built.camera.fov += 2;
  assert.equal(stageCameraMatchesRealized(built.camera, realized), false);
});

test("framebuffer rows flip without resampling", () => {
  const bottomUp = Uint8Array.of(
    0, 255, 0, 255,
    255, 0, 0, 255,
  );
  const flipped = flipRgbaRows(bottomUp, 1, 2);
  assert.deepEqual(flipped, Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255));
  assert.throws(() => flipRgbaRows(Uint8Array.of(1, 2, 3, 4), 2, 2), /stopped instead of scaling/);
});

test("offscreen export creates and destroys its own renderer", () => {
  const scene = readFileSync("lib/vibode-stage/harmonize-export-scene.ts", "utf8");
  assert.match(scene, /new THREE\.WebGLRenderer\(\{/);
  assert.match(scene, /premultipliedAlpha: false/);
  assert.match(scene, /preserveDrawingBuffer: true/);
  assert.match(scene, /setPixelRatio\(1\)/);
  assert.match(scene, /exportRenderer\?\.dispose\(\)/);
  assert.match(scene, /exportRenderer\?\.forceContextLoss\(\)/);
  assert.doesNotMatch(scene, /camera\.fov\s*=/);
  assert.doesNotMatch(scene, /camera\.aspect\s*=/);
  assert.doesNotMatch(scene, /castShadow\s*=\s*true/);
  assert.match(scene, /Export image failed: \$\{detail\}/);
  assert.doesNotMatch(scene, /This display cannot create an export image/);
});
