import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as THREE from "three";

import { instantiateSceneObjectDefinitions } from "@/lib/afc-v2-runtime/furniture-runtime";
import { beginPlacementFootprint } from "@/lib/afc-v2-runtime/model-axis-scale";
import { realizeObjectWorldTransform } from "@/lib/afc-v2-runtime/metric-world-realization";
import {
  localAabbDimensions,
  measurePlacementLocalAabb,
} from "@/lib/afc-v2-runtime/object-runtime";
import {
  createInheritedChildScene,
  persistenceSafeSceneObjects,
  toPersistedVersionScene,
  validatePersistedVersionScene,
} from "@/lib/afc-v2-runtime/persisted-scene";
import { addSceneObject, duplicateSceneObject } from "@/lib/afc-v2-runtime/scene-crud";
import {
  applyLiveUserSizeMultiplier,
  commitLiveSceneObjectTransform,
  createRuntimeSceneCollection,
  mountLiveRuntimeSceneObject,
  serializeRuntimeScene,
  setLiveSceneObject,
} from "@/lib/afc-v2-runtime/scene-runtime";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  DEFAULT_WORLD_TRANSFORM,
  type FurnitureAssetDefinition,
  type SceneObjectDefinition,
} from "@/lib/afc-v2-runtime/types";
import { modelAxisScaleForPlacement } from "@/lib/vibode-stage/furniture-model-scale";

import { createPersonalFurnitureAssetId } from "./asset-id";
import { fetchPersonalFurniturePlacement } from "./place-client";
import {
  personalFurniturePlaceResponse,
  placePersonalFurniture,
} from "./operations";
import type { PersonalFurnitureAssetRecord } from "./library";
import type { PersonalFurnitureStore, PersonalObjectStore } from "./store";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_ID = createPersonalFurnitureAssetId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")!;
const IDENTITY = {
  roomId: "11111111-1111-4111-8111-111111111111",
  versionId: "22222222-2222-4222-8222-222222222222",
  afcGenerationId: "33333333-3333-4333-8333-333333333333",
};
const AUTHORED = {
  width: 0.5834554135799408,
  height: 0.45000000298023224,
  depth: 0.3094782084226608,
};
const DISPLAY = { width: 1.175, height: 0.907, depth: 0.623 };

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function asset(input?: Partial<PersonalFurnitureAssetRecord>): PersonalFurnitureAssetRecord {
  return {
    assetId: ASSET_ID,
    userId: USER,
    displayName: "Dark coffee table",
    category: null,
    origin: "uploaded",
    authoredWidthM: AUTHORED.width,
    authoredHeightM: AUTHORED.height,
    authoredDepthM: AUTHORED.depth,
    displayWidthM: DISPLAY.width,
    displayHeightM: DISPLAY.height,
    displayDepthM: DISPLAY.depth,
    sizingMode: "uniform",
    sha256: "ab".repeat(32),
    byteSize: 128,
    storageBucket: "vibode-furniture-assets",
    storageObjectPath: "users/owner/assets/model.glb",
    libraryVisibility: "active",
    ...input,
  };
}

function storeFor(record: PersonalFurnitureAssetRecord): PersonalFurnitureStore {
  return {
    async findOwnedAsset(userId: string, assetId: string) {
      return userId === record.userId && assetId === record.assetId ? record : null;
    },
  } as unknown as PersonalFurnitureStore;
}

const objects = {
  async signGet() {
    return {
      signedUrl: "https://example.invalid/model.glb",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
  },
} as unknown as PersonalObjectStore;

function authoredMesh(width: number, height: number, depth: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth));
  mesh.scale.set(1, 1, 1);
  return mesh;
}

function resolverFor(record: PersonalFurnitureAssetRecord) {
  const definition: FurnitureAssetDefinition = {
    assetId: record.assetId,
    glbUrl: "https://example.invalid/model.glb",
    authoredWidthM: record.authoredWidthM,
    authoredHeightM: record.authoredHeightM,
    authoredDepthM: record.authoredDepthM,
  };
  return (assetId: string) => (assetId === definition.assetId ? definition : null);
}

function mountSaved(
  definition: SceneObjectDefinition,
  record: PersonalFurnitureAssetRecord,
  metricScale = 1,
) {
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: IDENTITY.roomId,
    generationId: IDENTITY.afcGenerationId,
    definitions: [definition],
    resolver: resolverFor(record),
  });
  const descriptor = instantiated.objects[0];
  assert.ok(descriptor);
  const imported = authoredMesh(record.authoredWidthM, record.authoredHeightM, record.authoredDepthM);
  const live = mountLiveRuntimeSceneObject({
    descriptor,
    imported,
    metricScale,
    ...(definition.modelAxisScale ? { modelAxisScale: definition.modelAxisScale } : {}),
  });
  commitLiveSceneObjectTransform(
    live,
    realizeObjectWorldTransform(descriptor.transform, metricScale),
    metricScale,
  );
  live.localAabb = measurePlacementLocalAabb(live.placement, live.importPlacement);
  return { live, imported, descriptor };
}

function closeTo(actual: number, expected: number, tolerance = 0.002) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${expected} within ${tolerance}, received ${actual}`,
  );
}

test("the place response is what gives STAGE the saved furniture scale", async () => {
  const route = source("app/api/vibode/furniture-assets/place/route.ts");
  assert.match(route, /personalFurniturePlaceResponse\(placed\)/);
  assert.doesNotMatch(route, /assetId: placed\.assetId/);
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(viewer, /const scale = placed\.modelAxisScale/);
  assert.match(viewer, /definition\.modelAxisScale \? \{ modelAxisScale: definition\.modelAxisScale \}/);
  assert.match(source("lib/afc-v2-runtime/scene-runtime.ts"), /modelAxisScale: object\.placementModelAxisScale/);
  assert.match(source("components/stage/StageEditorContext.tsx"), /addFurnitureWithIdentity\(assetId\)/);

  const placed = await placePersonalFurniture({
    userId: USER,
    assetId: ASSET_ID,
    store: storeFor(asset()),
    objects,
  });
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  assert.ok(placed.modelAxisScale);
  assert.equal(placed.runtimeAsset.authoredWidthM, AUTHORED.width);
  assert.equal("displayWidthM" in placed.runtimeAsset, false);

  const dropped = await fetchPersonalFurniturePlacement({
    ...IDENTITY,
    assetId: ASSET_ID,
    token: "token",
    fetchImpl: async () => Response.json({
      ok: true,
      assetId: placed.assetId,
      runtimeAsset: placed.runtimeAsset,
    }),
  });
  assert.equal(dropped.ok, true);
  if (!dropped.ok) return;
  assert.equal(dropped.modelAxisScale, undefined);

  const received = await fetchPersonalFurniturePlacement({
    ...IDENTITY,
    assetId: ASSET_ID,
    token: "token",
    fetchImpl: async () => Response.json(personalFurniturePlaceResponse(placed)),
  });
  assert.equal(received.ok, true);
  if (!received.ok) return;
  assert.deepEqual(received.modelAxisScale, placed.modelAxisScale);
});

test("a new coffee table renders at the saved width and the earlier copy stays authored", async () => {
  const record = asset();
  const placed = await placePersonalFurniture({
    userId: USER,
    assetId: ASSET_ID,
    store: storeFor(record),
    objects,
  });
  assert.equal(placed.ok, true);
  if (!placed.ok || !placed.modelAxisScale) return;
  const received = await fetchPersonalFurniturePlacement({
    ...IDENTITY,
    assetId: ASSET_ID,
    token: "token",
    fetchImpl: async () => Response.json(personalFurniturePlaceResponse(placed)),
  });
  assert.equal(received.ok, true);
  if (!received.ok || !received.modelAxisScale) return;

  const earlier: SceneObjectDefinition = {
    objectId: "so-dark-earlier",
    assetId: ASSET_ID,
    transform: DEFAULT_WORLD_TRANSFORM,
  };
  const endFootprint = beginPlacementFootprint({
    assetId: ASSET_ID,
    scale: received.modelAxisScale,
  });
  const added = addSceneObject({
    objects: [earlier],
    assetId: ASSET_ID,
    identity: { modelAxisScale: received.modelAxisScale },
    resolver: resolverFor(record),
    createObjectId: () => "so-dark-new",
  });
  endFootprint();
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.object.objectId, "so-dark-new");
  assert.deepEqual(added.object.modelAxisScale, received.modelAxisScale);
  assert.equal(added.object.userSizeMultiplier, undefined);
  assert.equal(added.objects[0]?.modelAxisScale, undefined);

  const created = mountSaved(added.object, record);
  const createdSize = localAabbDimensions(created.live.localAabb!);
  closeTo(createdSize.width, DISPLAY.width);
  closeTo(createdSize.height, DISPLAY.height);
  closeTo(createdSize.depth, DISPLAY.depth);
  closeTo(createdSize.width, AUTHORED.width * created.live.importPlacement.scale.x, 1e-6);
  assert.deepEqual(created.imported.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(created.live.placement.scale.toArray(), [1, 1, 1]);
  assert.equal(created.live.userSizeMultiplier, 1);
  assert.ok(createdSize.width > 1);

  const earlierLive = mountSaved(earlier, record);
  const earlierSize = localAabbDimensions(earlierLive.live.localAabb!);
  closeTo(earlierSize.width, AUTHORED.width, 1e-6);
  closeTo(earlierSize.height, AUTHORED.height, 1e-6);
  closeTo(earlierSize.depth, AUTHORED.depth, 1e-6);

  const scene = createRuntimeSceneCollection();
  setLiveSceneObject(scene, earlierLive.live);
  setLiveSceneObject(scene, created.live);
  const serialized = serializeRuntimeScene(scene);
  const saved = toPersistedVersionScene(IDENTITY, serialized);
  const validated = validatePersistedVersionScene(saved);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const savedNew = validated.scene.objects.find((object) => object.objectId === "so-dark-new");
  const savedEarlier = validated.scene.objects.find((object) => object.objectId === "so-dark-earlier");
  assert.deepEqual(savedNew?.modelAxisScale, received.modelAxisScale);
  assert.equal(savedNew?.userSizeMultiplier, undefined);
  assert.equal(savedEarlier?.modelAxisScale, undefined);
  assert.deepEqual(modelAxisScaleForPlacement({
    persisted: savedNew?.modelAxisScale,
    lookedUp: { x: 1, y: 1, z: 1 },
  }), received.modelAxisScale);

  const reloaded = mountSaved(savedNew!, record, 1.7);
  const reloadedSize = localAabbDimensions(reloaded.live.localAabb!);
  closeTo(reloadedSize.width, DISPLAY.width);
  closeTo(reloadedSize.height, DISPLAY.height);
  closeTo(reloadedSize.depth, DISPLAY.depth);
  assert.deepEqual(
    reloaded.live.importPlacement.scale.toArray(),
    created.live.importPlacement.scale.toArray(),
  );

  const moved = {
    ...savedNew!,
    transform: {
      ...savedNew!.transform,
      position: { x: 1, y: 0, z: 0.4 },
      rotationDeg: { x: 0, y: 37, z: 0 },
    },
  };
  const turned = mountSaved(moved, record);
  const turnedSize = localAabbDimensions(turned.live.localAabb!);
  closeTo(turnedSize.width, DISPLAY.width);
  closeTo(turnedSize.depth, DISPLAY.depth);
  assert.ok(Math.abs(turned.live.realizedTransform.position.x - 1) < 1e-9);

  const roomScaled = mountSaved(moved, record, 1.7);
  assert.ok(Math.abs(roomScaled.live.realizedTransform.position.x - 1.7) < 1e-9);
  assert.deepEqual(
    roomScaled.live.importPlacement.scale.toArray(),
    created.live.importPlacement.scale.toArray(),
  );
  closeTo(localAabbDimensions(roomScaled.live.localAabb!).width, DISPLAY.width);

  applyLiveUserSizeMultiplier(created.live, 1.25);
  created.live.localAabb = measurePlacementLocalAabb(
    created.live.placement,
    created.live.importPlacement,
  );
  closeTo(localAabbDimensions(created.live.localAabb!).width, DISPLAY.width * 1.25);
  const sizedScene = createRuntimeSceneCollection();
  setLiveSceneObject(sizedScene, created.live);
  const sized = serializeRuntimeScene(sizedScene).objects[0]!;
  assert.equal(sized.userSizeMultiplier, 1.25);
  assert.deepEqual(sized.modelAxisScale, received.modelAxisScale);
  const sizedReload = mountSaved(sized, record);
  closeTo(localAabbDimensions(sizedReload.live.localAabb!).width, DISPLAY.width * 1.25);
  assert.ok(Math.abs(sizedReload.live.importPlacement.scale.x - created.live.importPlacement.scale.x) < 1e-9);

  const undone = persistenceSafeSceneObjects([savedNew!]);
  const restored = mountSaved(undone[0]!, record);
  closeTo(localAabbDimensions(restored.live.localAabb!).width, DISPLAY.width);
  assert.equal(restored.live.userSizeMultiplier, 1);

  const copied = duplicateSceneObject({
    objects: validated.scene.objects,
    objectId: "so-dark-new",
    resolver: resolverFor(record),
    createObjectId: () => "so-dark-copy",
  });
  assert.equal(copied.ok, true);
  if (!copied.ok) return;
  assert.deepEqual(copied.object.modelAxisScale, received.modelAxisScale);
  const copyLive = mountSaved(copied.object, record);
  closeTo(localAabbDimensions(copyLive.live.localAabb!).width, DISPLAY.width);

  const child = createInheritedChildScene({
    parentScene: validated.scene,
    childRoomId: "44444444-4444-4444-8444-444444444444",
    childVersionId: "55555555-5555-4555-8555-555555555555",
    currentAfcGenerationId: IDENTITY.afcGenerationId,
  });
  assert.equal(child.ok, true);
  if (!child.ok) return;
  const childObject = child.scene.objects.find((object) => object.objectId === "so-dark-new");
  assert.deepEqual(childObject?.modelAxisScale, received.modelAxisScale);
  const childLive = mountSaved(childObject!, record);
  closeTo(localAabbDimensions(childLive.live.localAabb!).width, DISPLAY.width);

  const later = await placePersonalFurniture({
    userId: USER,
    assetId: ASSET_ID,
    store: storeFor(asset({
      displayWidthM: 2,
      displayHeightM: DISPLAY.height,
      displayDepthM: DISPLAY.depth,
      sizingMode: "exact",
    })),
    objects,
  });
  assert.equal(later.ok, true);
  if (!later.ok) return;
  assert.notDeepEqual(later.modelAxisScale, savedNew?.modelAxisScale);
  assert.deepEqual(savedNew?.modelAxisScale, received.modelAxisScale);
});

test("an unedited model and an independent height edit render on the correct axes", async () => {
  const plain = asset({
    authoredWidthM: 1.2,
    authoredHeightM: 0.408,
    authoredDepthM: 0.615,
    displayWidthM: null,
    displayHeightM: null,
    displayDepthM: null,
    sizingMode: "uniform",
  });
  const placedPlain = await placePersonalFurniture({
    userId: USER,
    assetId: ASSET_ID,
    store: storeFor(plain),
    objects,
  });
  assert.equal(placedPlain.ok, true);
  if (!placedPlain.ok) return;
  assert.equal(personalFurniturePlaceResponse(placedPlain).modelAxisScale, undefined);
  const plainObject: SceneObjectDefinition = {
    objectId: "so-plain",
    assetId: ASSET_ID,
    transform: {
      ...DEFAULT_WORLD_TRANSFORM,
      position: { ...DEFAULT_WORLD_TRANSFORM.position },
      rotationDeg: { ...DEFAULT_WORLD_TRANSFORM.rotationDeg },
    },
  };
  const plainLive = mountSaved(plainObject, plain);
  const plainSize = localAabbDimensions(plainLive.live.localAabb!);
  closeTo(plainSize.width, 1.2, 1e-6);
  closeTo(plainSize.height, 0.408, 1e-6);
  closeTo(plainSize.depth, 0.615, 1e-6);
  assert.deepEqual(plainLive.live.importPlacement.scale.toArray(), [1, 1, 1]);

  const exact = asset({
    displayWidthM: 1.2,
    displayHeightM: 0.907,
    displayDepthM: 0.615,
    sizingMode: "exact",
    authoredWidthM: 1.2,
    authoredHeightM: 0.408,
    authoredDepthM: 0.615,
  });
  const placedExact = await placePersonalFurniture({
    userId: USER,
    assetId: ASSET_ID,
    store: storeFor(exact),
    objects,
  });
  assert.equal(placedExact.ok, true);
  if (!placedExact.ok || !placedExact.modelAxisScale) return;
  assert.equal(placedExact.modelAxisScale.x, 1);
  assert.equal(placedExact.modelAxisScale.z, 1);
  assert.ok(placedExact.modelAxisScale.y > 2);
  const added = addSceneObject({
    objects: [],
    assetId: ASSET_ID,
    identity: { modelAxisScale: placedExact.modelAxisScale },
    resolver: resolverFor(exact),
    createObjectId: () => "so-exact",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const exactLive = mountSaved(added.object, exact);
  const exactSize = localAabbDimensions(exactLive.live.localAabb!);
  closeTo(exactSize.width, 1.2, 1e-6);
  closeTo(exactSize.height, 0.907, 0.002);
  closeTo(exactSize.depth, 0.615, 1e-6);
  assert.equal(exactLive.live.placement.scale.y, 1);
  assert.ok(Math.abs(exactLive.live.importPlacement.scale.y - placedExact.modelAxisScale.y) < 1e-9);
  assert.equal(exactLive.descriptor.coordinateSpace, AFC_V2_RUNTIME_COORDINATE_SPACE);
});
