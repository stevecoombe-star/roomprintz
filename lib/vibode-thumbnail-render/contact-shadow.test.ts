import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as THREE from "three";

import { instantiateSceneObjectDefinitions } from "@/lib/afc-v2-runtime/furniture-runtime";
import {
  MODEL_AXIS_SCALE_IDENTITY,
  registerModelAxisScaleLookup,
  type ModelAxisScale,
} from "@/lib/afc-v2-runtime/model-axis-scale";
import { realizeObjectWorldTransform } from "@/lib/afc-v2-runtime/metric-world-realization";
import { measurePlacementLocalAabb } from "@/lib/afc-v2-runtime/object-runtime";
import {
  commitLiveSceneObjectTransform,
  mountLiveRuntimeSceneObject,
  type LiveRuntimeSceneObject,
} from "@/lib/afc-v2-runtime/scene-runtime";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  type FurnitureAssetDefinition,
  type RuntimeSceneObject,
} from "@/lib/afc-v2-runtime/types";
import {
  STAGE_CONTACT_SHADOW_NAME,
  STAGE_LIGHTING_V1,
  contactShadowFootprint,
  createStageContactResources,
  syncStageContactShadow,
  type StageContactResources,
} from "@/lib/vibode-stage/stage-lighting";

import {
  sceneDefinitionFromThumbnailObject,
  thumbnailObjectModelAxisScale,
  type VibodeThumbnailRenderObject,
} from "./contract";

const ASSET_ID = "asset-contact";
const POSITION = { x: 1.2, y: 0, z: -2.4 };

function close(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-4, `${label}: ${actual} vs ${expected}`);
}

function offsetMesh(width: number, height: number, depth: number): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  geometry.translate(width * 0.35, height / 2, -depth * 0.2);
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

function stageDescriptor(input: Readonly<{
  objectId: string;
  userSizeMultiplier: number;
  rotationYDeg: number;
}>): RuntimeSceneObject {
  return {
    roomId: "room-contact",
    generationId: "generation-contact",
    objectId: input.objectId,
    assetIdentity: { kind: "test_cube", id: ASSET_ID },
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    transform: {
      position: { ...POSITION },
      rotationDeg: { x: 0, y: input.rotationYDeg, z: 0 },
      uniformScale: 1,
    },
    variantId: "variant-contact",
    userSizeMultiplier: input.userSizeMultiplier,
  };
}

function thumbnailObject(input: Readonly<{
  objectId: string;
  userSizeMultiplier: number;
  rotationYDeg: number;
  modelAxisScale?: ModelAxisScale;
}>): VibodeThumbnailRenderObject {
  return {
    objectId: input.objectId,
    assetId: ASSET_ID,
    glbUrl: "/contact.glb",
    position: { ...POSITION },
    rotationDeg: { x: 0, y: input.rotationYDeg, z: 0 },
    userSizeMultiplier: input.userSizeMultiplier,
    ...(input.modelAxisScale ? { modelAxisScale: input.modelAxisScale } : {}),
  };
}

const asset = (edge: number): FurnitureAssetDefinition => ({
  assetId: ASSET_ID,
  glbUrl: "/contact.glb",
  authoredWidthM: edge,
  authoredHeightM: edge,
  authoredDepthM: edge,
});

function mountStage(input: Readonly<{
  mesh: THREE.Object3D;
  userSizeMultiplier: number;
  modelAxisScale: ModelAxisScale;
  metricScale: number;
  rotationYDeg: number;
  objectId?: string;
}>): LiveRuntimeSceneObject {
  const unregister = registerModelAxisScaleLookup(() => input.modelAxisScale);
  try {
    return mountLiveRuntimeSceneObject({
      descriptor: stageDescriptor({
        objectId: input.objectId ?? "piece",
        userSizeMultiplier: input.userSizeMultiplier,
        rotationYDeg: input.rotationYDeg,
      }),
      imported: input.mesh,
      metricScale: input.metricScale,
    });
  } finally {
    unregister();
  }
}

function mountThumbnail(input: Readonly<{
  mesh: THREE.Object3D;
  edge: number;
  userSizeMultiplier: number;
  modelAxisScale?: ModelAxisScale;
  metricScale: number;
  rotationYDeg: number;
  objectId?: string;
}>): LiveRuntimeSceneObject {
  const object = thumbnailObject({
    objectId: input.objectId ?? "piece",
    userSizeMultiplier: input.userSizeMultiplier,
    rotationYDeg: input.rotationYDeg,
    modelAxisScale: input.modelAxisScale,
  });
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: "room-contact",
    generationId: "generation-contact",
    definitions: [sceneDefinitionFromThumbnailObject(object)],
    resolver: (assetId) => (assetId === ASSET_ID ? asset(input.edge) : null),
  });
  assert.equal(instantiated.objects.length, 1);
  const descriptor = instantiated.objects[0];
  assert.ok(descriptor);
  const live = mountLiveRuntimeSceneObject({
    descriptor,
    imported: input.mesh,
    metricScale: input.metricScale,
    modelAxisScale: thumbnailObjectModelAxisScale(object),
  });
  const realized = realizeObjectWorldTransform(descriptor.transform, input.metricScale);
  live.localAabb = measurePlacementLocalAabb(live.placement, live.importPlacement);
  commitLiveSceneObjectTransform(live, realized, input.metricScale);
  return live;
}

function attachCard(
  live: LiveRuntimeSceneObject,
  resources: StageContactResources,
) {
  const measured = measurePlacementLocalAabb(live.placement, live.importPlacement);
  assert.deepEqual(measured, live.localAabb);
  const card = syncStageContactShadow(live.placement, live.localAabb, resources);
  assert.ok(card);
  assert.equal(card.name, STAGE_CONTACT_SHADOW_NAME);
  assert.equal(card.visible, true);
  const footprint = contactShadowFootprint(live.localAabb);
  assert.ok(footprint);
  assert.equal(card.scale.x, footprint.width);
  assert.equal(card.scale.y, footprint.depth);
  assert.equal(card.position.x, footprint.centerX);
  assert.equal(card.position.z, footprint.centerZ);
  assert.equal(card.position.y, footprint.baseY + STAGE_LIGHTING_V1.contactLiftM);
  assert.equal(card.rotation.y, 0);
  const again = measurePlacementLocalAabb(live.placement, live.importPlacement);
  assert.deepEqual(again, measured);
  return card;
}

function worldCenter(object: THREE.Object3D): THREE.Vector3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
}

function renderedCenter(root: THREE.Object3D): THREE.Vector3 {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || child.name === STAGE_CONTACT_SHADOW_NAME) return;
    box.union(new THREE.Box3().setFromObject(child));
  });
  return box.getCenter(new THREE.Vector3());
}

test("the thumbnail frame mounts the STAGE contact card and leaves cast shadows off", () => {
  const frame = readFileSync(
    "app/internal/vibode-thumbnail-render/ThumbnailRenderFrame.tsx",
    "utf8",
  );
  assert.equal(frame.match(/createStageContactResources\(/g)?.length, 1);
  assert.equal(frame.match(/syncStageContactShadow\(/g)?.length, 1);
  assert.match(frame, /contactResources\?\.geometry\.dispose\(\)/);
  assert.match(frame, /contactResources\?\.material\.dispose\(\)/);
  assert.match(frame, /contactResources\?\.texture\.dispose\(\)/);
  assert.match(frame, /renderer\.shadowMap\.enabled = false/);
  assert.match(frame, /keyLight\.castShadow = false/);
  assert.doesNotMatch(frame, /shadowMap\.enabled = true/);
  assert.doesNotMatch(frame, /castShadow = true/);
  assert.doesNotMatch(frame, /enableFurnitureShadowFlags|PCFSoftShadowMap|ShadowMaterial/);
});

test("thumbnail contact cards match STAGE for variant size, furniture size, and room scale", () => {
  const resources = createStageContactResources();
  const variant: ModelAxisScale = { x: 2, y: 0.5, z: 1.5 };
  const userSize = 1.25;
  const metricScale = 0.75;
  const edge = 1;
  const stage = mountStage({
    mesh: offsetMesh(edge, edge, edge),
    userSizeMultiplier: userSize,
    modelAxisScale: variant,
    metricScale,
    rotationYDeg: 35,
  });
  const thumbnail = mountThumbnail({
    mesh: offsetMesh(edge, edge, edge),
    edge,
    userSizeMultiplier: userSize,
    modelAxisScale: variant,
    metricScale,
    rotationYDeg: 35,
  });
  const stageCard = attachCard(stage, resources);
  const thumbnailCard = attachCard(thumbnail, resources);
  assert.equal(thumbnailCard.material, stageCard.material);
  assert.deepEqual(thumbnailCard.scale.toArray(), stageCard.scale.toArray());
  assert.deepEqual(thumbnailCard.position.toArray(), stageCard.position.toArray());
  assert.equal(thumbnail.placement.rotation.y, stage.placement.rotation.y);

  const native = mountThumbnail({
    mesh: offsetMesh(edge, edge, edge),
    edge,
    userSizeMultiplier: 1,
    metricScale: 1,
    rotationYDeg: 0,
    objectId: "native",
  });
  const nativeCard = attachCard(native, resources);
  close(thumbnailCard.scale.x / nativeCard.scale.x, variant.x * userSize, "width follows variant and size");
  close(thumbnailCard.scale.y / nativeCard.scale.y, variant.z * userSize, "depth follows variant and size");
  assert.equal(nativeCard.scale.x, contactShadowFootprint(native.localAabb)?.width);

  const roomScaled = mountThumbnail({
    mesh: offsetMesh(edge, edge, edge),
    edge,
    userSizeMultiplier: 1,
    metricScale,
    rotationYDeg: 0,
    objectId: "room-scale",
  });
  const roomCard = attachCard(roomScaled, resources);
  assert.equal(roomCard.scale.x, nativeCard.scale.x);
  assert.equal(roomCard.scale.y, nativeCard.scale.y);
  assert.equal(roomCard.position.x, nativeCard.position.x);
  assert.equal(roomCard.position.z, nativeCard.position.z);
  close(roomScaled.placement.position.x, POSITION.x * metricScale, "room scale moves X");
  close(roomScaled.placement.position.z, POSITION.z * metricScale, "room scale moves Z");
  assert.equal(roomScaled.placement.position.y, POSITION.y);

  const moved = roomCard.position.clone();
  roomScaled.placement.position.x += 0.4;
  roomScaled.placement.updateMatrixWorld(true);
  assert.deepEqual(roomCard.position.toArray(), moved.toArray());
  const modelCenter = renderedCenter(roomScaled.placement);
  const cardCenter = worldCenter(roomCard);
  close(cardCenter.x, modelCenter.x, "moved card stays under the model in X");
  close(cardCenter.z, modelCenter.z, "moved card stays under the model in Z");

  const rotatedCenter = renderedCenter(thumbnail.placement);
  const rotatedCard = worldCenter(thumbnailCard);
  close(rotatedCard.x, rotatedCenter.x, "rotated card stays under the model in X");
  close(rotatedCard.z, rotatedCenter.z, "rotated card stays under the model in Z");
  assert.equal(thumbnailCard.rotation.y, 0);

  const chair = mountThumbnail({
    mesh: offsetMesh(0.6, 0.9, 0.6),
    edge: 0.6,
    userSizeMultiplier: 1,
    metricScale: 1,
    rotationYDeg: 0,
    objectId: "chair",
  });
  const sofa = mountThumbnail({
    mesh: offsetMesh(2.2, 0.8, 0.9),
    edge: 2.2,
    userSizeMultiplier: 1,
    modelAxisScale: MODEL_AXIS_SCALE_IDENTITY,
    metricScale: 1,
    rotationYDeg: 0,
    objectId: "sofa",
  });
  const chairCard = attachCard(chair, resources);
  const sofaCard = attachCard(sofa, resources);
  assert.ok(sofaCard.scale.x > chairCard.scale.x * 2);
  assert.equal(chairCard.material, sofaCard.material);
  assert.notEqual(chairCard, sofaCard);

  resources.geometry.dispose();
  resources.material.dispose();
  resources.texture.dispose();
});
