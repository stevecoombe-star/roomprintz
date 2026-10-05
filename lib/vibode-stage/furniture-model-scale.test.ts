import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as THREE from "three";

import { realizeFrozenCamera, frozenCameraSnapshotFromAuthority } from "@/lib/afc-v2-runtime/frozen-camera";
import { realizeObjectWorldTransform } from "@/lib/afc-v2-runtime/metric-world-realization";
import { registerModelAxisScaleLookup } from "@/lib/afc-v2-runtime/model-axis-scale";
import { instantiateSceneObjectDefinitions } from "@/lib/afc-v2-runtime/furniture-runtime";
import { createOneMetreCubeMesh, localAabbDimensions } from "@/lib/afc-v2-runtime/object-runtime";
import { createPi3aAuthority } from "@/lib/afc-v2-runtime/pi3a-test-fixture";
import { realizeProductionWorld } from "@/lib/afc-v2-runtime/production-world";
import { mountLiveRuntimeSceneObject } from "@/lib/afc-v2-runtime/scene-runtime";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  AFC_V2_USER_SIZE_MAX,
  type FurnitureAssetDefinition,
  type RuntimeSceneObject,
} from "@/lib/afc-v2-runtime/types";
import {
  sceneDefinitionFromThumbnailObject,
  thumbnailObjectModelAxisScale,
  type VibodeThumbnailRenderObject,
} from "@/lib/vibode-thumbnail-render/contract";

import { STAGE_CATALOG_TABLES } from "./catalog-store";
import {
  FURNITURE_MODEL_SCALE_ASSET_TABLE,
  FURNITURE_MODEL_SCALE_VARIANT_TABLE,
  authoritativeFurnitureScale,
  expectedRenderedModelSize,
  stageAssetDimensionFromRow,
  stageModelAxisScale,
  stageVariantDimensionFromRow,
  type AuthoritativeFurnitureScale,
} from "./furniture-model-scale";

const ASSET_ID = "asset-cube";
const VARIANT_ID = "variant-cube";
const POSITION = { x: 1, y: 0.2, z: -2 };
const NATIVE = { authoredWidthM: 1, authoredHeightM: 1, authoredDepthM: 1 };
const EXACT_VARIANT = {
  assetId: ASSET_ID,
  modelWidthM: 2,
  modelHeightM: 0.5,
  modelDepthM: 1.5,
  modelSizingMode: "exact" as const,
};
const USER_SIZE = 1.25;
const ROOM_SCALE = 1.5;
const CERTIFIED_METRIC = 0.5;
const INTERNATIONAL_FOOT_M = 0.3048;

function close(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} vs ${expected}`);
}

function cubeMesh(edge: number): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.BoxGeometry(edge, edge, edge),
    new THREE.MeshStandardMaterial(),
  );
}

function stageDescriptor(userSizeMultiplier?: number): RuntimeSceneObject {
  return {
    roomId: "room-scale",
    generationId: "generation-scale",
    objectId: "cube-1",
    assetIdentity: { kind: "test_cube", id: ASSET_ID },
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    transform: {
      position: { ...POSITION },
      rotationDeg: { x: 0, y: 0, z: 0 },
      uniformScale: 1,
    },
    variantId: VARIANT_ID,
    userSizeMultiplier,
  };
}

function thumbnailObject(input: Readonly<{
  userSizeMultiplier: number;
  modelAxisScale?: AuthoritativeFurnitureScale["modelAxisScale"];
  edge: number;
}>): VibodeThumbnailRenderObject {
  return {
    objectId: "cube-1",
    assetId: ASSET_ID,
    glbUrl: "/cube.glb",
    position: { ...POSITION },
    rotationDeg: { x: 0, y: 0, z: 0 },
    userSizeMultiplier: input.userSizeMultiplier,
    ...(input.modelAxisScale ? { modelAxisScale: input.modelAxisScale } : {}),
  };
}

const cubeAsset = (edge: number): FurnitureAssetDefinition => ({
  assetId: ASSET_ID,
  glbUrl: "/cube.glb",
  authoredWidthM: edge,
  authoredHeightM: edge,
  authoredDepthM: edge,
});

function mountStage(input: Readonly<{
  mesh: THREE.Object3D;
  userSizeMultiplier?: number;
  modelAxisScale: AuthoritativeFurnitureScale["modelAxisScale"];
  metricScale: number;
}>) {
  const unregister = registerModelAxisScaleLookup(() => input.modelAxisScale);
  try {
    return mountLiveRuntimeSceneObject({
      descriptor: stageDescriptor(input.userSizeMultiplier),
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
  modelAxisScale?: AuthoritativeFurnitureScale["modelAxisScale"];
  metricScale: number;
}>) {
  const object = thumbnailObject({
    userSizeMultiplier: input.userSizeMultiplier,
    modelAxisScale: input.modelAxisScale,
    edge: input.edge,
  });
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: "room-scale",
    generationId: "generation-scale",
    definitions: [sceneDefinitionFromThumbnailObject(object)],
    resolver: (assetId) => (assetId === ASSET_ID ? cubeAsset(input.edge) : null),
  });
  assert.equal(instantiated.objects.length, 1);
  assert.equal(instantiated.objects[0]?.userSizeMultiplier ?? 1, input.userSizeMultiplier);
  return mountLiveRuntimeSceneObject({
    descriptor: instantiated.objects[0]!,
    imported: input.mesh,
    metricScale: input.metricScale,
    modelAxisScale: thumbnailObjectModelAxisScale(object),
  });
}

function assertSameMount(
  stage: ReturnType<typeof mountStage>,
  thumbnail: ReturnType<typeof mountThumbnail>,
  expected: AuthoritativeFurnitureScale,
  intrinsicEdge: number,
) {
  assert.deepEqual(
    thumbnail.importPlacement.scale.toArray(),
    stage.importPlacement.scale.toArray(),
  );
  assert.deepEqual(thumbnail.importPlacement.scale.toArray(), [
    expected.importScale.x,
    expected.importScale.y,
    expected.importScale.z,
  ]);
  const stageSize = localAabbDimensions(stage.localAabb!);
  const thumbnailSize = localAabbDimensions(thumbnail.localAabb!);
  const rendered = expectedRenderedModelSize({
    intrinsic: { widthM: intrinsicEdge, heightM: intrinsicEdge, depthM: intrinsicEdge },
    importScale: expected.importScale,
  });
  close(thumbnailSize.width, stageSize.width, "width");
  close(thumbnailSize.height, stageSize.height, "height");
  close(thumbnailSize.depth, stageSize.depth, "depth");
  close(thumbnailSize.width, rendered.widthM, "rendered width");
  close(thumbnailSize.height, rendered.heightM, "rendered height");
  close(thumbnailSize.depth, rendered.depthM, "rendered depth");
  assert.equal(thumbnail.realizedTransform.position.x, stage.realizedTransform.position.x);
  assert.equal(thumbnail.realizedTransform.position.y, stage.realizedTransform.position.y);
  assert.equal(thumbnail.realizedTransform.position.z, stage.realizedTransform.position.z);
  assert.equal(thumbnail.realizedTransform.position.y, POSITION.y);
}

test("catalog dimension tables stay the STAGE catalog tables", () => {
  assert.equal(FURNITURE_MODEL_SCALE_ASSET_TABLE, STAGE_CATALOG_TABLES.assets);
  assert.equal(FURNITURE_MODEL_SCALE_VARIANT_TABLE, STAGE_CATALOG_TABLES.variants);
});

test("numeric catalog rows use the same effective-dimension scale as STAGE", () => {
  const asset = stageAssetDimensionFromRow({
    asset_id: ASSET_ID,
    authored_width_m: "1.000",
    authored_height_m: "1.000",
    authored_depth_m: "1.000",
  });
  const variant = stageVariantDimensionFromRow({
    variant_id: VARIANT_ID,
    current_asset_id: ASSET_ID,
    model_width_m: "2.000",
    model_height_m: "0.500",
    model_depth_m: "1.500",
    model_sizing_mode: "exact",
  });
  assert.ok(asset);
  assert.equal(variant?.modelSizingMode, "exact");
  assert.deepEqual(stageModelAxisScale({
    assetId: ASSET_ID,
    asset,
    variant,
  }), { x: 2, y: 0.5, z: 1.5 });
  const incomplete = stageVariantDimensionFromRow({
    variant_id: VARIANT_ID,
    current_asset_id: ASSET_ID,
    model_width_m: "2",
    model_height_m: null,
    model_depth_m: "1",
    model_sizing_mode: "uniform",
  });
  assert.equal(incomplete?.modelWidthM, undefined);
  assert.deepEqual(stageModelAxisScale({
    assetId: ASSET_ID,
    asset,
    variant: incomplete,
  }), { x: 1, y: 1, z: 1 });
  assert.deepEqual(stageModelAxisScale({
    assetId: ASSET_ID,
    asset,
    variant: variant ? { ...variant, assetId: "other-asset" } : null,
  }), { x: 1, y: 1, z: 1 });
});

test("case 1 baseline asset, room scale 1, and size 1 match", () => {
  const expected = authoritativeFurnitureScale({
    assetId: ASSET_ID,
    asset: NATIVE,
    certifiedMetricScale: 1,
    roomScaleMultiplier: 1,
    userSizeMultiplier: 1,
  });
  assert.deepEqual(expected.modelAxisScale, { x: 1, y: 1, z: 1 });
  assert.deepEqual(expected.importScale, { x: 1, y: 1, z: 1 });
  assert.equal(expected.metricScale, 1);
  const stage = mountStage({
    mesh: createOneMetreCubeMesh(),
    userSizeMultiplier: 1,
    modelAxisScale: expected.modelAxisScale,
    metricScale: expected.metricScale,
  });
  const thumbnail = mountThumbnail({
    mesh: createOneMetreCubeMesh(),
    edge: 1,
    userSizeMultiplier: 1,
    metricScale: expected.metricScale,
  });
  assertSameMount(stage, thumbnail, expected, 1);
});

test("case 2 variant dimension override replaces asset authored dimensions", () => {
  const expected = authoritativeFurnitureScale({
    assetId: ASSET_ID,
    asset: NATIVE,
    variant: EXACT_VARIANT,
    certifiedMetricScale: 1,
    roomScaleMultiplier: 1,
    userSizeMultiplier: 1,
  });
  assert.deepEqual(expected.modelAxisScale, { x: 2, y: 0.5, z: 1.5 });
  const stage = mountStage({
    mesh: createOneMetreCubeMesh(),
    modelAxisScale: expected.modelAxisScale,
    metricScale: 1,
  });
  const thumbnail = mountThumbnail({
    mesh: createOneMetreCubeMesh(),
    edge: 1,
    userSizeMultiplier: 1,
    modelAxisScale: expected.modelAxisScale,
    metricScale: 1,
  });
  assertSameMount(stage, thumbnail, expected, 1);
  const authoredOnly = mountThumbnail({
    mesh: createOneMetreCubeMesh(),
    edge: 1,
    userSizeMultiplier: 1,
    metricScale: 1,
  });
  assert.notDeepEqual(
    thumbnail.importPlacement.scale.toArray(),
    authoredOnly.importPlacement.scale.toArray(),
  );
});

test("case 3 furniture size alone matches STAGE", () => {
  const expected = authoritativeFurnitureScale({
    assetId: ASSET_ID,
    asset: NATIVE,
    certifiedMetricScale: 1,
    userSizeMultiplier: USER_SIZE,
  });
  assert.deepEqual(expected.importScale, { x: USER_SIZE, y: USER_SIZE, z: USER_SIZE });
  const stage = mountStage({
    mesh: createOneMetreCubeMesh(),
    userSizeMultiplier: USER_SIZE,
    modelAxisScale: expected.modelAxisScale,
    metricScale: 1,
  });
  const thumbnail = mountThumbnail({
    mesh: createOneMetreCubeMesh(),
    edge: 1,
    userSizeMultiplier: USER_SIZE,
    metricScale: 1,
  });
  assertSameMount(stage, thumbnail, expected, 1);
});

test("case 4 room scale changes camera and XZ together and leaves model metres alone", () => {
  const authority = createPi3aAuthority({ metricScale: CERTIFIED_METRIC });
  const world = realizeProductionWorld(authority, ROOM_SCALE);
  const expected = authoritativeFurnitureScale({
    assetId: ASSET_ID,
    asset: NATIVE,
    certifiedMetricScale: CERTIFIED_METRIC,
    roomScaleMultiplier: ROOM_SCALE,
    userSizeMultiplier: 1,
  });
  assert.equal(expected.metricScale, world.metricScale);
  assert.equal(expected.metricScale, 0.75);
  assert.deepEqual(expected.importScale, { x: 1, y: 1, z: 1 });
  const stage = mountStage({
    mesh: createOneMetreCubeMesh(),
    userSizeMultiplier: 1,
    modelAxisScale: expected.modelAxisScale,
    metricScale: world.metricScale,
  });
  const thumbnail = mountThumbnail({
    mesh: createOneMetreCubeMesh(),
    edge: 1,
    userSizeMultiplier: 1,
    metricScale: expected.metricScale,
  });
  assertSameMount(stage, thumbnail, expected, 1);
  const realized = realizeObjectWorldTransform(stageDescriptor().transform, world.metricScale);
  assert.equal(thumbnail.realizedTransform.position.x, realized.position.x);
  assert.equal(thumbnail.realizedTransform.position.z, realized.position.z);
  const camera = realizeFrozenCamera(
    frozenCameraSnapshotFromAuthority(authority),
    expected.metricScale,
  );
  assert.deepEqual(camera.pose, world.camera.pose);
  assert.equal(camera.pose.position.z, authority.frozenCamera.pose.position.z * expected.metricScale);
  const unscaledRoom = mountThumbnail({
    mesh: createOneMetreCubeMesh(),
    edge: 1,
    userSizeMultiplier: 1,
    metricScale: CERTIFIED_METRIC,
  });
  assert.deepEqual(
    thumbnail.importPlacement.scale.toArray(),
    unscaledRoom.importPlacement.scale.toArray(),
  );
  assert.notEqual(
    thumbnail.realizedTransform.position.x,
    unscaledRoom.realizedTransform.position.x,
  );
});

test("case 5 variant, room scale, and furniture size combine exactly once", () => {
  const authority = createPi3aAuthority({ metricScale: CERTIFIED_METRIC });
  const world = realizeProductionWorld(authority, ROOM_SCALE);
  const expected = authoritativeFurnitureScale({
    assetId: ASSET_ID,
    asset: NATIVE,
    variant: EXACT_VARIANT,
    userSizeMultiplier: USER_SIZE,
    certifiedMetricScale: CERTIFIED_METRIC,
    roomScaleMultiplier: ROOM_SCALE,
  });
  assert.deepEqual(expected.modelAxisScale, { x: 2, y: 0.5, z: 1.5 });
  assert.deepEqual(expected.importScale, { x: 2.5, y: 0.625, z: 1.875 });
  assert.equal(expected.metricScale, world.metricScale);
  const stage = mountStage({
    mesh: createOneMetreCubeMesh(),
    userSizeMultiplier: USER_SIZE,
    modelAxisScale: expected.modelAxisScale,
    metricScale: world.metricScale,
  });
  const thumbnail = mountThumbnail({
    mesh: createOneMetreCubeMesh(),
    edge: 1,
    userSizeMultiplier: USER_SIZE,
    modelAxisScale: expected.modelAxisScale,
    metricScale: expected.metricScale,
  });
  assertSameMount(stage, thumbnail, expected, 1);

  const before = mountThumbnail({
    mesh: createOneMetreCubeMesh(),
    edge: 1,
    userSizeMultiplier: USER_SIZE,
    metricScale: CERTIFIED_METRIC,
  });
  assert.deepEqual(before.importPlacement.scale.toArray(), [USER_SIZE, USER_SIZE, USER_SIZE]);
  assert.notDeepEqual(
    before.importPlacement.scale.toArray(),
    thumbnail.importPlacement.scale.toArray(),
  );
  assert.equal(before.realizedTransform.position.x, POSITION.x * CERTIFIED_METRIC);
  assert.equal(thumbnail.realizedTransform.position.x, POSITION.x * expected.metricScale);
  assert.notEqual(before.realizedTransform.position.x, thumbnail.realizedTransform.position.x);
});

test("case 6 exact variant dimensions stay non-uniform", () => {
  const uniform = authoritativeFurnitureScale({
    assetId: ASSET_ID,
    asset: NATIVE,
    variant: {
      assetId: ASSET_ID,
      modelWidthM: 2,
      modelHeightM: 2,
      modelDepthM: 2,
      modelSizingMode: "uniform",
    },
    certifiedMetricScale: 1,
  });
  const exact = authoritativeFurnitureScale({
    assetId: ASSET_ID,
    asset: NATIVE,
    variant: EXACT_VARIANT,
    certifiedMetricScale: 1,
  });
  assert.deepEqual(uniform.modelAxisScale, { x: 2, y: 2, z: 2 });
  assert.notEqual(exact.modelAxisScale.x, exact.modelAxisScale.y);
  assert.notEqual(exact.modelAxisScale.y, exact.modelAxisScale.z);
  const thumbnail = mountThumbnail({
    mesh: createOneMetreCubeMesh(),
    edge: 1,
    userSizeMultiplier: 1,
    modelAxisScale: exact.modelAxisScale,
    metricScale: 1,
  });
  const size = localAabbDimensions(thumbnail.localAabb!);
  close(size.width, 2, "exact width");
  close(size.height, 0.5, "exact height");
  close(size.depth, 1.5, "exact depth");
});

test("analytical 1m and 1ft cubes keep their edge, then follow the shared scale", () => {
  const identity = authoritativeFurnitureScale({
    assetId: ASSET_ID,
    asset: NATIVE,
    certifiedMetricScale: 1,
    roomScaleMultiplier: 1,
    userSizeMultiplier: 1,
  });
  const metre = mountThumbnail({
    mesh: createOneMetreCubeMesh(),
    edge: 1,
    userSizeMultiplier: 1,
    metricScale: identity.metricScale,
  });
  const foot = mountThumbnail({
    mesh: cubeMesh(INTERNATIONAL_FOOT_M),
    edge: INTERNATIONAL_FOOT_M,
    userSizeMultiplier: 1,
    metricScale: identity.metricScale,
  });
  const metreSize = localAabbDimensions(metre.localAabb!);
  const footSize = localAabbDimensions(foot.localAabb!);
  close(metreSize.width, 1, "1m width");
  close(metreSize.height, 1, "1m height");
  close(metreSize.depth, 1, "1m depth");
  close(footSize.width, INTERNATIONAL_FOOT_M, "1ft width");
  close(footSize.height, INTERNATIONAL_FOOT_M, "1ft height");
  close(footSize.depth, INTERNATIONAL_FOOT_M, "1ft depth");

  const roundedFoot = stageAssetDimensionFromRow({
    asset_id: ASSET_ID,
    authored_width_m: INTERNATIONAL_FOOT_M,
    authored_height_m: INTERNATIONAL_FOOT_M,
    authored_depth_m: INTERNATIONAL_FOOT_M,
  });
  assert.equal(roundedFoot?.authoredWidthM, 0.305);
  assert.deepEqual(stageModelAxisScale({
    assetId: ASSET_ID,
    asset: roundedFoot,
    variant: stageVariantDimensionFromRow({
      variant_id: VARIANT_ID,
      current_asset_id: ASSET_ID,
      model_width_m: INTERNATIONAL_FOOT_M,
      model_height_m: INTERNATIONAL_FOOT_M,
      model_depth_m: INTERNATIONAL_FOOT_M,
      model_sizing_mode: "exact",
    }),
  }), { x: 1, y: 1, z: 1 });
  const scaled = authoritativeFurnitureScale({
    assetId: ASSET_ID,
    asset: roundedFoot,
    variant: {
      assetId: ASSET_ID,
      modelWidthM: 0.61,
      modelHeightM: 0.305,
      modelDepthM: 0.915,
      modelSizingMode: "exact",
    },
    userSizeMultiplier: USER_SIZE,
    certifiedMetricScale: 1,
    roomScaleMultiplier: ROOM_SCALE,
  });
  assert.deepEqual(scaled.modelAxisScale, { x: 2, y: 1, z: 3 });
  assert.deepEqual(scaled.importScale, { x: 2.5, y: 1.25, z: 3.75 });
  assert.equal(scaled.metricScale, ROOM_SCALE);
  const scaledFoot = mountThumbnail({
    mesh: cubeMesh(INTERNATIONAL_FOOT_M),
    edge: INTERNATIONAL_FOOT_M,
    userSizeMultiplier: USER_SIZE,
    modelAxisScale: scaled.modelAxisScale,
    metricScale: scaled.metricScale,
  });
  const scaledSize = localAabbDimensions(scaledFoot.localAabb!);
  close(scaledSize.width, INTERNATIONAL_FOOT_M * scaled.importScale.x, "scaled 1ft width");
  close(scaledSize.height, INTERNATIONAL_FOOT_M * scaled.importScale.y, "scaled 1ft height");
  close(scaledSize.depth, INTERNATIONAL_FOOT_M * scaled.importScale.z, "scaled 1ft depth");
  assert.equal(scaledFoot.realizedTransform.position.x, POSITION.x * ROOM_SCALE);
  assert.equal(scaledFoot.realizedTransform.position.y, POSITION.y);
  const roomOnly = mountThumbnail({
    mesh: cubeMesh(INTERNATIONAL_FOOT_M),
    edge: INTERNATIONAL_FOOT_M,
    userSizeMultiplier: 1,
    metricScale: ROOM_SCALE,
  });
  const roomOnlySize = localAabbDimensions(roomOnly.localAabb!);
  close(roomOnlySize.width, INTERNATIONAL_FOOT_M, "room scale leaves 1ft width");
  close(roomOnlySize.height, INTERNATIONAL_FOOT_M, "room scale leaves 1ft height");
  close(roomOnlySize.depth, INTERNATIONAL_FOOT_M, "room scale leaves 1ft depth");
});

test("an out-of-range size is clamped once, the same way STAGE mounts it", () => {
  const expected = authoritativeFurnitureScale({
    assetId: ASSET_ID,
    asset: NATIVE,
    certifiedMetricScale: 1,
    userSizeMultiplier: 9,
  });
  assert.equal(expected.importScale.x, AFC_V2_USER_SIZE_MAX);
  const stage = mountStage({
    mesh: createOneMetreCubeMesh(),
    userSizeMultiplier: 9,
    modelAxisScale: expected.modelAxisScale,
    metricScale: 1,
  });
  assert.equal(stage.importPlacement.scale.x, expected.importScale.x);
});

test("the viewport, placement, and thumbnail renderer call the shared scale", () => {
  const viewport = readFileSync("components/afc-3d/AfcIntegratedEditorViewport.tsx", "utf8");
  const editor = readFileSync("components/stage/StageEditorContext.tsx", "utf8");
  const frame = readFileSync("app/internal/vibode-thumbnail-render/ThumbnailRenderFrame.tsx", "utf8");
  const payload = readFileSync("lib/vibode-thumbnail-render/payload.server.ts", "utf8");
  assert.match(viewport, /stageModelAxisScale\(/);
  assert.doesNotMatch(viewport, /deriveModelAxisScale\(/);
  assert.match(editor, /stageModelAxisScale\(/);
  assert.match(frame, /thumbnailObjectModelAxisScale\(/);
  assert.match(frame, /modelAxisScale: modelAxisScaleByObjectId\.get\(descriptor\.objectId\)/);
  assert.match(payload, /effectiveMetricScale\(/);
  assert.match(payload, /stageModelAxisScale\(/);
  assert.match(payload, /loadRoomScaleMultiplier/);
  assert.match(payload, /lookupStageModelDimensions/);
});
