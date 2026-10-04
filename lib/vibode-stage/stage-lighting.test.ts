import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as THREE from "three";

import { measurePlacementLocalAabb } from "../afc-v2-runtime/object-runtime";
import {
  applyLiveUserSizeMultiplier,
  mountLiveRuntimeSceneObject,
} from "../afc-v2-runtime/scene-runtime";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  DEFAULT_WORLD_TRANSFORM,
  type RuntimeSceneObject,
} from "../afc-v2-runtime/types";
import {
  STAGE_CONTACT_SHADOW_NAME,
  STAGE_LIGHTING_V1,
  applyDirectionalShadowFit,
  contactShadowFalloff,
  contactShadowFootprint,
  createStageContactResources,
  createStageLightingRig,
  detachStageContactShadow,
  enableFurnitureShadowFlags,
  isStageLightingVisual,
  stageShadowFrustumRadius,
  syncStageContactShadow,
} from "./stage-lighting";

function aabb(width: number, depth: number) {
  return {
    min: { x: -width / 2, y: 0, z: -depth / 2 },
    max: { x: width / 2, y: 0.8, z: depth / 2 },
  };
}

test("furniture shadow flags apply to eligible meshes and leave materials alone", () => {
  const material = new THREE.MeshStandardMaterial({ color: 0x336699, roughness: 0.4 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  const nested = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), material);
  const group = new THREE.Group();
  const visual = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material);
  visual.userData.stageLightingVisual = true;
  group.add(mesh);
  mesh.add(nested);
  group.add(new THREE.Object3D());
  group.add(visual);
  const template = mesh.clone();

  const count = enableFurnitureShadowFlags(group);

  assert.equal(count, 2);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.receiveShadow, true);
  assert.equal(nested.castShadow, true);
  assert.equal(nested.receiveShadow, true);
  assert.equal(visual.castShadow, false);
  assert.equal(template.castShadow, false);
  assert.equal(mesh.material, material);
  assert.equal((mesh.material as THREE.MeshStandardMaterial).roughness, 0.4);
  assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHex(), 0x336699);
});

test("contact footprint follows each object's dimensions", () => {
  const chair = contactShadowFootprint(aabb(0.6, 0.6));
  const sofa = contactShadowFootprint(aabb(2.2, 0.9));
  assert.ok(chair);
  assert.ok(sofa);
  assert.notEqual(chair.width, sofa.width);
  assert.notEqual(chair.depth, sofa.depth);
  const softness = 1 + STAGE_LIGHTING_V1.contactShadowSoftness;
  assert.equal(chair.width, 0.6 * softness);
  assert.equal(sofa.width, 2.2 * softness);
  assert.equal(sofa.depth, 0.9 * softness);
  assert.equal(chair.rotationY, 0);
  assert.equal(sofa.rotationY, 0);
});

test("contact falloff stays strong across the footprint, including the corners", () => {
  const inner = 1 / (1 + STAGE_LIGHTING_V1.contactShadowSoftness);
  assert.equal(contactShadowFalloff(0, 0), 1);
  assert.equal(contactShadowFalloff(inner, inner), 1);
  assert.ok(contactShadowFalloff(1, 0) < 0.05);
  assert.ok(contactShadowFalloff((1 + inner) / 2, 0) > 0);
  assert.ok(contactShadowFalloff((1 + inner) / 2, 0) < 1);
});

test("contact position uses the measured footprint center", () => {
  const shifted = {
    min: { x: 0.25, y: 0.25, z: -1.25 },
    max: { x: 1.25, y: 1.25, z: -0.25 },
  };
  const footprint = contactShadowFootprint(shifted);
  assert.ok(footprint);
  assert.equal(footprint.centerX, 0.75);
  assert.equal(footprint.centerZ, -0.75);
  assert.equal(footprint.baseY, 0.25);
  assert.notEqual(footprint.centerX, 0);
  assert.notEqual(footprint.centerZ, 0);
  const resources = createStageContactResources();
  const placement = new THREE.Group();
  const card = syncStageContactShadow(placement, shifted, resources);
  assert.ok(card);
  assert.equal(card.position.x, footprint.centerX);
  assert.equal(card.position.z, footprint.centerZ);
  assert.equal(card.position.y, footprint.baseY + STAGE_LIGHTING_V1.contactLiftM);
  assert.equal(card.rotation.y, 0);
  resources.geometry.dispose();
  resources.material.dispose();
  resources.texture.dispose();
});

test("contact footprint doubles when the effective dimensions double", () => {
  const base = contactShadowFootprint(aabb(0.9, 0.7));
  const enlarged = contactShadowFootprint(aabb(1.8, 1.4));
  assert.ok(base);
  assert.ok(enlarged);
  assert.equal(enlarged.width, base.width * 2);
  assert.equal(enlarged.depth, base.depth * 2);
  assert.equal(enlarged.centerX, 0);
  assert.equal(enlarged.centerZ, 0);
});

test("contact shadow stays placement-local and detaches without disposing the shared card", () => {
  const resources = createStageContactResources();
  const chair = new THREE.Group();
  const sofa = new THREE.Group();
  const chairShadow = syncStageContactShadow(chair, aabb(0.6, 0.6), resources);
  const sofaShadow = syncStageContactShadow(sofa, aabb(2.2, 0.9), resources);
  assert.ok(chairShadow);
  assert.ok(sofaShadow);
  assert.equal(chairShadow.name, STAGE_CONTACT_SHADOW_NAME);
  assert.equal(isStageLightingVisual(chairShadow), true);
  assert.equal(chairShadow.userData.objectId, undefined);
  assert.equal(chairShadow.scale.x, contactShadowFootprint(aabb(0.6, 0.6))?.width);
  assert.equal(sofaShadow.scale.x, contactShadowFootprint(aabb(2.2, 0.9))?.width);
  assert.notEqual(chairShadow.scale.x, sofaShadow.scale.x);
  assert.equal(chairShadow.material, sofaShadow.material);
  syncStageContactShadow(chair, aabb(1.2, 1.2), resources);
  assert.equal(chair.children.length, 1);
  assert.equal(chairShadow.scale.x, contactShadowFootprint(aabb(1.2, 1.2))?.width);
  detachStageContactShadow(chair);
  assert.equal(chair.children.length, 0);
  assert.equal(chairShadow.parent, null);
  assert.equal(sofa.children.length, 1);
  assert.equal(sofaShadow.parent, sofa);
  resources.geometry.dispose();
  resources.material.dispose();
  resources.texture.dispose();
});

function offsetFurnitureMesh(width: number, height: number, depth: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(width * 0.65, height * 0.8, -depth * 0.4);
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

function descriptor(objectId: string): RuntimeSceneObject {
  return {
    roomId: "room-light1",
    generationId: "generation-light1",
    objectId,
    assetIdentity: { kind: "test_cube", id: "asset-light1" },
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    transform: DEFAULT_WORLD_TRANSFORM,
  };
}

function renderedBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || child.name === STAGE_CONTACT_SHADOW_NAME) return;
    box.union(new THREE.Box3().setFromObject(child));
  });
  return box;
}

function assertCardMatchesFootprint(placement: THREE.Object3D, card: THREE.Object3D): void {
  const model = renderedBounds(placement);
  const cardBox = new THREE.Box3().setFromObject(card);
  const softness = 1 + STAGE_LIGHTING_V1.contactShadowSoftness;
  assert.ok(Math.abs(model.min.y) < 1e-4);
  assert.ok(Math.abs((model.min.x + model.max.x) / 2 - (cardBox.min.x + cardBox.max.x) / 2) < 1e-4);
  assert.ok(Math.abs((model.min.z + model.max.z) / 2 - (cardBox.min.z + cardBox.max.z) / 2) < 1e-4);
  assert.ok(Math.abs((cardBox.max.x - cardBox.min.x) / (model.max.x - model.min.x) - softness) < 1e-4);
  assert.ok(Math.abs((cardBox.max.z - cardBox.min.z) / (model.max.z - model.min.z) - softness) < 1e-4);
  assert.ok(Math.abs(cardBox.min.y - (model.min.y + STAGE_LIGHTING_V1.contactLiftM)) < 1e-4);
}

test("resized offset furniture keeps its contact card centered on the rendered footprint", () => {
  const resources = createStageContactResources();
  const scene = new THREE.Scene();
  const chair = mountLiveRuntimeSceneObject({
    descriptor: descriptor("chair"),
    imported: offsetFurnitureMesh(0.55, 0.9, 0.48),
    metricScale: 1,
  });
  const sofa = mountLiveRuntimeSceneObject({
    descriptor: descriptor("sofa"),
    imported: offsetFurnitureMesh(2.1, 0.8, 0.95),
    metricScale: 1,
    modelAxisScale: { x: 1.35, y: 0.9, z: 1.15 },
  });
  scene.add(chair.placement);
  scene.add(sofa.placement);
  const sync = (live: typeof chair) => {
    live.localAabb = measurePlacementLocalAabb(live.placement, live.importPlacement);
    const card = syncStageContactShadow(live.placement, live.localAabb, resources);
    assert.ok(card);
    assert.equal(card.userData.objectId, undefined);
    assert.equal(isStageLightingVisual(card), true);
    return card;
  };
  const chairCard = sync(chair);
  const sofaCard = sync(sofa);
  const chairMountedWidth = chairCard.scale.x;
  assertCardMatchesFootprint(chair.placement, chairCard);
  assertCardMatchesFootprint(sofa.placement, sofaCard);
  assert.ok(sofaCard.scale.x > chairMountedWidth * 2);

  applyLiveUserSizeMultiplier(chair, 0.6);
  const shrunk = sync(chair);
  assertCardMatchesFootprint(chair.placement, shrunk);
  assert.ok(Math.abs(shrunk.scale.x / chairMountedWidth - 0.6) < 1e-4);
  applyLiveUserSizeMultiplier(chair, 1.8);
  const grown = sync(chair);
  assertCardMatchesFootprint(chair.placement, grown);
  assert.ok(Math.abs(grown.scale.x / chairMountedWidth - 1.8) < 1e-4);
  assert.equal(sofaCard.scale.x, contactShadowFootprint(sofa.localAabb)?.width);

  chair.placement.rotation.y = Math.PI / 5;
  chair.placement.updateMatrixWorld(true);
  assertCardMatchesFootprint(chair.placement, grown);
  assert.equal(grown.rotation.y, 0);

  const localScale = grown.scale.clone();
  const localPosition = grown.position.clone();
  chair.placement.position.set(2.5, 0, -1.25);
  chair.placement.updateMatrixWorld(true);
  assert.ok(Math.abs(grown.scale.x - localScale.x) < 1e-8);
  assert.ok(Math.abs(grown.position.x - localPosition.x) < 1e-8);
  assert.ok(Math.abs(grown.position.z - localPosition.z) < 1e-8);
  assertCardMatchesFootprint(chair.placement, grown);

  detachStageContactShadow(chair.placement);
  assert.equal(chair.placement.children.some((child) => child.name === STAGE_CONTACT_SHADOW_NAME), false);
  assert.equal(sofaCard.parent, sofa.placement);
  resources.geometry.dispose();
  resources.material.dispose();
  resources.texture.dispose();
});

test("shadow frustum uses the realized floor once", () => {
  const pad = STAGE_LIGHTING_V1.shadowCameraPaddingM;
  const halfH = STAGE_LIGHTING_V1.shadowVolumeHeightM / 2;
  const floor = { worldWidthM: 8, referenceDepthM: 10 };
  const radius = stageShadowFrustumRadius(floor);
  assert.equal(radius, Math.hypot(4 + pad, 5 + pad, halfH));
  assert.notEqual(radius, Math.hypot(8 + pad, 10 + pad, halfH));
  const light = new THREE.DirectionalLight();
  light.position.set(
    STAGE_LIGHTING_V1.mainLightPosition.x,
    STAGE_LIGHTING_V1.mainLightPosition.y,
    STAGE_LIGHTING_V1.mainLightPosition.z,
  );
  assert.equal(applyDirectionalShadowFit(light, floor), radius);
  assert.equal(light.shadow.camera.right, radius);
  assert.equal(light.shadow.camera.left, -radius);
  const compact = stageShadowFrustumRadius({ worldWidthM: 4, referenceDepthM: 5 });
  assert.ok(radius > compact);
});

test("production STAGE does not cast directional shadows", () => {
  const scene = new THREE.Scene();
  const renderer = { shadowMap: { enabled: true, type: THREE.PCFSoftShadowMap } };
  const ambient = new THREE.AmbientLight(0xffffff, 0.8);
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
  keyLight.position.set(3, 6, 5);
  keyLight.castShadow = true;
  scene.add(ambient);
  scene.add(keyLight);
  const rig = createStageLightingRig({ scene, renderer, mainLight: keyLight });
  rig.syncWorld({ floor: { worldWidthM: 6, referenceDepthM: 4 } });
  assert.equal(renderer.shadowMap.enabled, false);
  assert.equal(keyLight.castShadow, false);
  assert.equal(ambient.castShadow, false);
  assert.equal(rig.mainLight, keyLight);
  assert.equal(scene.children.some((child) => child.name === "stage-shadow-receiver"), false);
  assert.equal(scene.children.filter((child) => child instanceof THREE.DirectionalLight).length, 1);
  rig.syncWorld({ floor: { worldWidthM: 12, referenceDepthM: 8 } });
  assert.equal(renderer.shadowMap.enabled, false);
  assert.equal(keyLight.castShadow, false);
  rig.dispose();
  assert.equal(scene.children.includes(keyLight), true);
  assert.equal(keyLight.castShadow, false);
  assert.equal(renderer.shadowMap.enabled, false);
});

test("the production viewer keeps LIGHT-1 outside floor-mesh source locks", () => {
  const viewer = readFileSync("components/afc-3d/AfcProductionRoomViewer.tsx", "utf8");
  const outline = readFileSync("lib/vibode-stage/stage-selection-outline.ts", "utf8");
  assert.equal(STAGE_LIGHTING_V1.ambientIntensity, 0.8);
  assert.equal(STAGE_LIGHTING_V1.mainLightIntensity, 1);
  assert.deepEqual(STAGE_LIGHTING_V1.mainLightPosition, { x: 3, y: 6, z: 5 });
  assert.match(viewer, /new THREE\.AmbientLight\(0xffffff, 0\.8\)/);
  assert.match(viewer, /new THREE\.DirectionalLight\(0xffffff, 1\.0\)/);
  assert.match(viewer, /keyLight\.position\.set\(3, 6, 5\)/);
  assert.match(viewer, /createStageLightingRig/);
  assert.match(viewer, /syncStageContactShadow/);
  assert.match(viewer, /lighting\.syncWorld\(next\)/);
  assert.match(viewer, /lighting\.dispose\(\)/);
  assert.doesNotMatch(viewer, /enableFurnitureShadowFlags/);
  assert.doesNotMatch(viewer, /castShadow\s*=\s*true/);
  assert.doesNotMatch(viewer, /shadowMap\.enabled\s*=\s*true/);
  assert.doesNotMatch(viewer, /ShadowMaterial|stage-shadow-receiver/);
  assert.doesNotMatch(viewer, /PlaneGeometry|MeshBasicMaterial|floorSurface|world\.floor/);
  assert.match(outline, /isStageLightingVisual/);
});
