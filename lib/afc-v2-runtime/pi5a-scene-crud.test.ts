import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";

import { cloneFurnitureGlbScene, parseFurnitureGlb } from "./furniture-glb-loader";
import {
  defaultFurnitureAssetId,
  furnitureAssetDefinition,
} from "./furniture-assets";
import {
  PI4A_SOFA_PLACEMENT_LOCAL_AABB,
  PI4B_SOFA_A_OBJECT_ID,
  PI4B_SOFA_B_OBJECT_ID,
  createPi4bSceneObjectDefinitions,
  instantiateSceneObjectDefinitions,
} from "./furniture-runtime";
import {
  applyVisitToLiveFurniture,
  beginSceneVisitLoad,
  completeSceneVisitLoad,
  createEmptyLiveFurnitureCommit,
  createInheritedChildScene,
  createLoadedSceneInstanceId,
  createUnloadedSceneVisit,
  echoSceneVisitCommit,
  PI4C_MAX_SCENE_OBJECTS,
  reconcileLiveScene,
  resolveLoadedVersionScene,
  shouldReplaceLiveScene,
  toPersistedVersionScene,
  validatePersistedSceneObjects,
  validatePersistedVersionScene,
} from "./persisted-scene";
import { createPi4aSofaObject3D } from "./pi4a-sofa-geometry";
import {
  PI3A_GENERATION_A,
  PI3A_RIGHT_WALL,
  PI3A_ROOM_ID,
  createPi3aAuthority,
} from "./pi3a-test-fixture";
import {
  addSceneObject,
  canonicalPlacementSearchOffsets,
  createSceneObjectId,
  deleteSceneObject,
  duplicateOffsetCanonicalTransform,
  duplicateSceneObject,
  PI5A_DUPLICATE_OFFSET_M,
  PI5A_INSTANTIATE_FAILED_MESSAGE,
  PI5A_MISSING_OBJECT_MESSAGE,
  PI5A_SCENE_AT_CAPACITY_MESSAGE,
  PI5A_UNKNOWN_ASSET_MESSAGE,
  preferredAddCanonicalTransform,
  realizedTransformPenetratesWalls,
  sceneObjectCoordinateSpace,
} from "./scene-crud";
import {
  insertVersionSceneIfAbsent,
  resolveVersionScene,
  upsertVersionScene,
  type LoadedSceneRow,
  type OwnedVersionRecord,
  type ResolveVersionScenePorts,
} from "./scene-inheritance";
import {
  commitSceneObjectTransformById,
  createRuntimeSceneCollection,
  getLiveSceneObject,
  mountLiveRuntimeSceneObject,
  removeLiveSceneObject,
  serializeRuntimeScene,
  setLiveSceneObject,
} from "./scene-runtime";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  DEFAULT_WORLD_TRANSFORM,
  type SceneObjectDefinition,
  type WorldTransform,
} from "./types";

const ROOT = process.cwd();
const VERSION_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VERSION_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const USER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const GLB_REPO_PATH = path.join(
  ROOT,
  "public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb",
);

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function identity(versionId: string) {
  return {
    roomId: PI3A_ROOM_ID,
    versionId,
    afcGenerationId: PI3A_GENERATION_A,
  };
}

function idFactory(start = 0) {
  let n = start;
  return () => `so-test-${++n}`;
}

function transformAt(x: number, z = 0, yaw = 0): WorldTransform {
  return {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x, y: 0, z },
    rotationDeg: { x: 0, y: yaw, z: 0 },
  };
}

function firstMesh(object: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!found && mesh.isMesh) found = mesh;
  });
  assert.ok(found, "expected a mesh");
  return found;
}

function makePersistedScene(
  versionId: string,
  objects: readonly SceneObjectDefinition[],
) {
  const parsed = validatePersistedVersionScene({
    roomId: PI3A_ROOM_ID,
    versionId,
    afcGenerationId: PI3A_GENERATION_A,
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    objects,
  });
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.scene;
}

type MemoryState = {
  scenes: Map<string, import("./persisted-scene").PersistedVersionScene>;
  versions: Map<string, OwnedVersionRecord>;
  parentByVersionId: Map<string, string | null>;
};

function sceneKey(roomId: string, versionId: string) {
  return `${roomId}::${versionId}`;
}

function createMemory(state: MemoryState): ResolveVersionScenePorts {
  const loadScene = (roomId: string, versionId: string): LoadedSceneRow => {
    const stored = state.scenes.get(sceneKey(roomId, versionId));
    if (!stored) return { found: false };
    return { found: true, scene: stored };
  };
  return {
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    userId: USER_ID,
    currentAfcGenerationId: PI3A_GENERATION_A,
    loadChildScene: async () => loadScene(PI3A_ROOM_ID, VERSION_B),
    resolveParentVersionId: async () => state.parentByVersionId.get(VERSION_B) ?? null,
    loadParentVersion: async (parentVersionId) => state.versions.get(parentVersionId) ?? null,
    loadParentScene: async (parentVersionId) => loadScene(PI3A_ROOM_ID, parentVersionId),
    insertChildSceneIfAbsent: async (scene) => {
      const result = insertVersionSceneIfAbsent(state.scenes, scene);
      return { ok: true, inserted: result.inserted };
    },
  };
}

function arrayBufferFromFile(filePath: string): ArrayBuffer {
  const buffer = readFileSync(filePath);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
}

test("PI-5A two objects of the same asset have distinct objectIds", () => {
  const createObjectId = idFactory();
  const first = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = addSceneObject({
    objects: first.objects,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(first.object.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(second.object.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(first.object.assetId, second.object.assetId);
  assert.notEqual(first.object.objectId, second.object.objectId);
  assert.match(first.object.objectId, /^so-/);
  assert.equal(first.object.transform.uniformScale, 1);
  assert.equal(sceneObjectCoordinateSpace(), AFC_V2_RUNTIME_COORDINATE_SPACE);
  const generated = createSceneObjectId(() => "9f1d3a12-7c4e-4b21-9a55-abcdef123456");
  assert.equal(generated, "so-9f1d3a12-7c4e-4b21-9a55-abcdef123456");
});

test("PI-5A add creates a valid canonical descriptor and durable save payload", () => {
  const added = addSceneObject({
    objects: [],
    assetId: defaultFurnitureAssetId(),
    createObjectId: idFactory(),
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.object.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(added.object.transform.uniformScale, 1);
  assert.equal(added.object.transform.position.y, 0);
  assert.deepEqual(added.object.transform.rotationDeg, { x: 0, y: 0, z: 0 });
  assert.equal(added.selectedObjectId, added.object.objectId);
  const persisted = toPersistedVersionScene(identity(VERSION_A), { objects: added.objects });
  const validated = validatePersistedVersionScene(persisted);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(validated.scene.objects.length, 1);
  assert.equal(validated.scene.objects[0]?.objectId, added.object.objectId);
});

test("PI-5A add restore reinstantiates the new object after destroy/recreate", () => {
  const added = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId: idFactory(),
    placement: { metricScale: 1, realizedWalls: [] },
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const live = createRuntimeSceneCollection();
  const descriptor = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: PI3A_GENERATION_A,
    definitions: added.objects,
  }).objects[0];
  assert.ok(descriptor);
  setLiveSceneObject(live, mountLiveRuntimeSceneObject({
    descriptor,
    imported: createPi4aSofaObject3D(),
    metricScale: 1,
  }));
  const serialized = serializeRuntimeScene(live);
  live.clear();
  const restored = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: PI3A_GENERATION_A,
    definitions: serialized.objects,
  });
  assert.equal(restored.objects.length, 1);
  assert.equal(restored.objects[0]?.objectId, added.object.objectId);
  assert.equal(restored.objects[0]?.assetIdentity.id, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.deepEqual(restored.objects[0]?.transform.position, added.object.transform.position);
});

test("PI-5A delete removes only the requested object and clears selection", () => {
  const createObjectId = idFactory();
  const first = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = addSceneObject({
    objects: first.objects,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const deleted = deleteSceneObject({
    objects: second.objects,
    objectId: first.object.objectId,
    selectedObjectId: first.object.objectId,
  });
  assert.equal(deleted.ok, true);
  if (!deleted.ok) return;
  assert.equal(deleted.objects.length, 1);
  assert.equal(deleted.objects[0]?.objectId, second.object.objectId);
  assert.equal(deleted.selectedObjectId, null);
  const missing = deleteSceneObject({
    objects: deleted.objects,
    objectId: "so-missing",
  });
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.reason, "missing_object");
  assert.equal(missing.message, PI5A_MISSING_OBJECT_MESSAGE);
});

test("PI-5A delete restore keeps the object gone and empty scenes persist as objects=[]", () => {
  const added = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId: idFactory(),
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const emptied = deleteSceneObject({
    objects: added.objects,
    objectId: added.object.objectId,
    selectedObjectId: added.object.objectId,
  });
  assert.equal(emptied.ok, true);
  if (!emptied.ok) return;
  assert.deepEqual(emptied.objects, []);
  const validated = validatePersistedSceneObjects([]);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.deepEqual(validated.objects, []);
  const persistedEmpty = resolveLoadedVersionScene({
    found: true,
    currentAfcGenerationId: PI3A_GENERATION_A,
    stored: makePersistedScene(VERSION_A, []),
    defaultObjects: createPi4bSceneObjectDefinitions(),
  });
  assert.equal(persistedEmpty.status, "ready");
  assert.equal(persistedEmpty.origin, "persisted");
  assert.deepEqual(persistedEmpty.objects, []);
  const missingRow = resolveLoadedVersionScene({
    found: false,
    currentAfcGenerationId: PI3A_GENERATION_A,
    stored: null,
    defaultObjects: createPi4bSceneObjectDefinitions(),
  });
  assert.equal(missingRow.status, "none");
  assert.equal(missingRow.origin, "default");
  assert.equal(missingRow.objects.length, 2);
  assert.equal(missingRow.objects[0]?.objectId, PI4B_SOFA_A_OBJECT_ID);
  assert.equal(missingRow.objects[1]?.objectId, PI4B_SOFA_B_OBJECT_ID);
});

test("PI-5A duplicate copies asset and transform with a collision-safe offset", () => {
  const source = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId: idFactory(10),
    placement: { metricScale: 1, realizedWalls: [] },
  });
  assert.equal(source.ok, true);
  if (!source.ok) return;
  const moved: SceneObjectDefinition = {
    ...source.object,
    transform: transformAt(-0.2, 0, 12),
  };
  const duplicated = duplicateSceneObject({
    objects: [moved],
    objectId: moved.objectId,
    createObjectId: idFactory(20),
    placement: { metricScale: 1, realizedWalls: [] },
  });
  assert.equal(duplicated.ok, true);
  if (!duplicated.ok) return;
  assert.equal(duplicated.object.assetId, moved.assetId);
  assert.notEqual(duplicated.object.objectId, moved.objectId);
  assert.equal(duplicated.object.transform.uniformScale, 1);
  assert.equal(duplicated.object.transform.rotationDeg.y, 12);
  assert.equal(
    duplicated.object.transform.position.x,
    moved.transform.position.x + PI5A_DUPLICATE_OFFSET_M.x,
  );
  assert.equal(
    duplicated.object.transform.position.z,
    moved.transform.position.z + PI5A_DUPLICATE_OFFSET_M.z,
  );
  assert.equal(duplicated.objects[0]?.transform.position.x, moved.transform.position.x);
  assert.equal(duplicated.selectedObjectId, duplicated.object.objectId);

  const colliding = duplicateSceneObject({
    objects: [{
      ...moved,
      transform: transformAt(-0.2),
    }],
    objectId: moved.objectId,
    createObjectId: idFactory(30),
    placement: {
      metricScale: 1,
      realizedWalls: [PI3A_RIGHT_WALL],
      localAabb: PI4A_SOFA_PLACEMENT_LOCAL_AABB,
    },
  });
  assert.equal(colliding.ok, true);
  if (!colliding.ok) return;
  assert.equal(
    realizedTransformPenetratesWalls({
      realized: colliding.object.transform,
      localAabb: PI4A_SOFA_PLACEMENT_LOCAL_AABB,
      realizedWalls: [PI3A_RIGHT_WALL],
    }),
    false,
  );
  assert.notDeepEqual(
    colliding.object.transform.position,
    duplicateOffsetCanonicalTransform(transformAt(-0.2)).position,
  );
});

test("PI-5A duplicate restore and independent transforms survive live collection edits", () => {
  const createObjectId = idFactory();
  const source = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(source.ok, true);
  if (!source.ok) return;
  const duplicated = duplicateSceneObject({
    objects: source.objects,
    objectId: source.object.objectId,
    createObjectId,
  });
  assert.equal(duplicated.ok, true);
  if (!duplicated.ok) return;
  const scene = createRuntimeSceneCollection();
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: PI3A_GENERATION_A,
    definitions: duplicated.objects,
  });
  for (const descriptor of instantiated.objects) {
    setLiveSceneObject(scene, mountLiveRuntimeSceneObject({
      descriptor,
      imported: createPi4aSofaObject3D(),
      metricScale: 1,
    }));
  }
  const beforeSource = getLiveSceneObject(scene, source.object.objectId)!.canonicalTransform;
  commitSceneObjectTransformById({
    scene,
    objectId: duplicated.object.objectId,
    realized: transformAt(2.4, -1.1, 40),
    metricScale: 1,
  });
  assert.deepEqual(
    getLiveSceneObject(scene, source.object.objectId)?.canonicalTransform,
    beforeSource,
  );
  assert.equal(
    getLiveSceneObject(scene, duplicated.object.objectId)?.canonicalTransform.position.x,
    2.4,
  );
  const serialized = serializeRuntimeScene(scene);
  scene.clear();
  const restored = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: PI3A_GENERATION_A,
    definitions: serialized.objects,
  });
  assert.equal(restored.objects.length, 2);
  assert.deepEqual(
    restored.objects.map((object) => object.objectId).sort(),
    [source.object.objectId, duplicated.object.objectId].sort(),
  );
});

test("PI-5A deleting one same-asset instance does not dispose the shared GLB", async () => {
  const loaded = await parseFurnitureGlb(arrayBufferFromFile(GLB_REPO_PATH));
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const createObjectId = idFactory(40);
  const first = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = addSceneObject({
    objects: first.objects,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const scene = createRuntimeSceneCollection();
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: PI3A_GENERATION_A,
    definitions: second.objects,
  });
  for (const descriptor of instantiated.objects) {
    setLiveSceneObject(scene, mountLiveRuntimeSceneObject({
      descriptor,
      imported: cloneFurnitureGlbScene(loaded.scene),
      metricScale: 1,
    }));
  }
  const remainingGeometry = firstMesh(
    getLiveSceneObject(scene, second.object.objectId)!.placement,
  ).geometry;
  const removed = removeLiveSceneObject(scene, first.object.objectId);
  assert.ok(removed);
  assert.equal(scene.size, 1);
  assert.equal(
    firstMesh(getLiveSceneObject(scene, second.object.objectId)!.placement).geometry,
    remainingGeometry,
  );
  assert.equal(remainingGeometry, firstMesh(loaded.scene).geometry);
});

test("PI-5A unknown assets and the persisted object maximum fail closed", () => {
  const unknown = addSceneObject({
    objects: [],
    assetId: "not-a-registered-asset",
    createObjectId: idFactory(),
  });
  assert.equal(unknown.ok, false);
  if (unknown.ok) return;
  assert.equal(unknown.reason, "unknown_asset");
  assert.equal(unknown.message, PI5A_UNKNOWN_ASSET_MESSAGE);
  assert.equal(furnitureAssetDefinition("not-a-registered-asset"), null);

  const filled: SceneObjectDefinition[] = [];
  const createObjectId = idFactory(100);
  for (let index = 0; index < PI4C_MAX_SCENE_OBJECTS; index += 1) {
    const added = addSceneObject({
      objects: filled,
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      createObjectId,
    });
    assert.equal(added.ok, true);
    if (!added.ok) return;
    filled.splice(0, filled.length, ...added.objects);
  }
  assert.equal(filled.length, PI4C_MAX_SCENE_OBJECTS);
  const overflow = addSceneObject({
    objects: filled,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(overflow.ok, false);
  if (overflow.ok) return;
  assert.equal(overflow.reason, "max_objects");
  assert.equal(overflow.message, PI5A_SCENE_AT_CAPACITY_MESSAGE);
  const overflowDup = duplicateSceneObject({
    objects: filled,
    objectId: filled[0]?.objectId ?? "",
    createObjectId,
  });
  assert.equal(overflowDup.ok, false);
  if (overflowDup.ok) return;
  assert.equal(overflowDup.reason, "max_objects");
  assert.equal(validatePersistedSceneObjects(filled).ok, true);
  assert.equal(validatePersistedSceneObjects([...filled, filled[0]!]).ok, false);
});

test("PI-5A Version A and Version B restore independent object collections", () => {
  const createA = idFactory(1);
  const sceneA = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId: createA,
  });
  assert.equal(sceneA.ok, true);
  if (!sceneA.ok) return;
  const sceneA2 = addSceneObject({
    objects: sceneA.objects,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId: createA,
  });
  assert.equal(sceneA2.ok, true);
  if (!sceneA2.ok) return;
  const sceneA3 = addSceneObject({
    objects: sceneA2.objects,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId: createA,
  });
  assert.equal(sceneA3.ok, true);
  if (!sceneA3.ok) return;
  const sceneB = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId: idFactory(50),
  });
  assert.equal(sceneB.ok, true);
  if (!sceneB.ok) return;
  const restoreA = resolveLoadedVersionScene({
    found: true,
    currentAfcGenerationId: PI3A_GENERATION_A,
    stored: makePersistedScene(VERSION_A, sceneA3.objects),
    defaultObjects: createPi4bSceneObjectDefinitions(),
  });
  const restoreB = resolveLoadedVersionScene({
    found: true,
    currentAfcGenerationId: PI3A_GENERATION_A,
    stored: makePersistedScene(VERSION_B, sceneB.objects),
    defaultObjects: createPi4bSceneObjectDefinitions(),
  });
  assert.equal(restoreA.objects.length, 3);
  assert.equal(restoreB.objects.length, 1);
  assert.notEqual(restoreA.objects[0]?.objectId, restoreB.objects[0]?.objectId);
  assert.equal(restoreA.origin, "persisted");
  assert.equal(restoreB.origin, "persisted");
});

test("PI-5A child inherits a dynamic collection once, including persisted empty scenes", async () => {
  const createObjectId = idFactory(60);
  const first = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = addSceneObject({
    objects: first.objects,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const remaining = deleteSceneObject({
    objects: second.objects,
    objectId: first.object.objectId,
  });
  assert.equal(remaining.ok, true);
  if (!remaining.ok) return;
  const third = addSceneObject({
    objects: remaining.objects,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId,
  });
  assert.equal(third.ok, true);
  if (!third.ok) return;
  const parent = makePersistedScene(VERSION_A, third.objects);
  const state: MemoryState = {
    scenes: new Map([[sceneKey(PI3A_ROOM_ID, VERSION_A), parent]]),
    versions: new Map([
      [VERSION_A, { id: VERSION_A, roomId: PI3A_ROOM_ID, userId: USER_ID }],
      [VERSION_B, { id: VERSION_B, roomId: PI3A_ROOM_ID, userId: USER_ID }],
    ]),
    parentByVersionId: new Map([[VERSION_B, VERSION_A]]),
  };
  const inherited = await resolveVersionScene(createMemory(state));
  assert.equal(inherited.status, "ready");
  if (inherited.status !== "ready") return;
  assert.equal(inherited.origin, "inherited");
  assert.deepEqual(
    inherited.scene.objects.map((object) => object.objectId),
    third.objects.map((object) => object.objectId),
  );

  const childDup = duplicateSceneObject({
    objects: inherited.scene.objects,
    objectId: inherited.scene.objects[0]!.objectId,
    createObjectId,
  });
  assert.equal(childDup.ok, true);
  if (!childDup.ok) return;
  upsertVersionScene(state.scenes, makePersistedScene(VERSION_B, childDup.objects));
  assert.equal(state.scenes.get(sceneKey(PI3A_ROOM_ID, VERSION_A))?.objects.length, 2);
  assert.equal(state.scenes.get(sceneKey(PI3A_ROOM_ID, VERSION_B))?.objects.length, 3);

  const emptyParent = makePersistedScene(VERSION_A, []);
  const emptyState: MemoryState = {
    scenes: new Map([[sceneKey(PI3A_ROOM_ID, VERSION_A), emptyParent]]),
    versions: new Map([
      [VERSION_A, { id: VERSION_A, roomId: PI3A_ROOM_ID, userId: USER_ID }],
      [VERSION_B, { id: VERSION_B, roomId: PI3A_ROOM_ID, userId: USER_ID }],
    ]),
    parentByVersionId: new Map([[VERSION_B, VERSION_A]]),
  };
  const emptyInherited = await resolveVersionScene(createMemory(emptyState));
  assert.equal(emptyInherited.status, "ready");
  if (emptyInherited.status !== "ready") return;
  assert.deepEqual(emptyInherited.scene.objects, []);
  const copied = createInheritedChildScene({
    parentScene: emptyParent,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    currentAfcGenerationId: PI3A_GENERATION_A,
  });
  assert.equal(copied.ok, true);
  if (!copied.ok) return;
  assert.deepEqual(copied.scene.objects, []);
});

test("PI-5A local CRUD persistence does not remount Camera/world and never calls AFC analysis", () => {
  const identityA = identity(VERSION_A);
  const added = addSceneObject({
    objects: createPi4bSceneObjectDefinitions(),
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId: idFactory(80),
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(
    shouldReplaceLiveScene({
      appliedInstanceId: createLoadedSceneInstanceId(identityA, 1),
      nextInstanceId: createLoadedSceneInstanceId(identityA, 1),
      appliedObjectIds: [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
      nextObjectIds: added.objects.map((object) => object.objectId),
    }),
    false,
  );

  let visit = createUnloadedSceneVisit();
  visit = beginSceneVisitLoad(visit, identityA);
  visit = completeSceneVisitLoad(
    visit,
    identityA,
    createPi4bSceneObjectDefinitions(),
    "persisted",
  );
  let live = createEmptyLiveFurnitureCommit();
  ({ live } = applyVisitToLiveFurniture(live, visit));
  visit = echoSceneVisitCommit(visit, added.objects);
  const echoed = applyVisitToLiveFurniture(live, visit);
  assert.equal(echoed.action, "leave-untouched");
  assert.equal(visit.loadRevision, 1);
  assert.equal(
    reconcileLiveScene({
      sceneReady: visit.sceneReady,
      appliedInstanceId: live.appliedInstanceId,
      nextInstanceId: visit.sceneInstanceId,
      appliedObjectIds: live.appliedObjectIds,
      nextObjectIds: added.objects.map((object) => object.objectId),
    }),
    "leave-untouched",
  );

  const authority = createPi3aAuthority();
  assert.ok(authority.generationId);

  const files = [
    source("lib/afc-v2-runtime/scene-crud.ts"),
    source("lib/afc-v2-runtime/scene-runtime.ts"),
    source("lib/afc-v2-runtime/use-persisted-3d-scene.ts"),
    source("components/afc-3d/AfcProductionRoomViewer.tsx"),
    source("components/afc-3d/AfcIntegratedEditorViewport.tsx"),
    source("components/afc-3d/AfcSceneObjectCrudSession.tsx"),
    source("components/afc-3d/Editor3dSceneObjectControls.tsx"),
  ];
  for (const text of files) {
    assert.doesNotMatch(text, /executeAfcV2Analysis/);
    assert.doesNotMatch(text, /observeRoom|generateTiled|readTiledPerspective/);
    assert.doesNotMatch(text, /userWorldScale|DEFAULT_PX_PER_IN/);
    assert.doesNotMatch(text, /object-object|furniture-to-furniture/);
  }

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.doesNotMatch(viewer, /PI4B_INITIAL_SELECTED_OBJECT_ID/);
  assert.doesNotMatch(viewer, /if \(sceneObjects\.size === 0\) return;/);
  assert.match(viewer, /cloneFurnitureGlbScene\(template\)/);
  assert.match(viewer, /addSceneObjectDescriptor/);
  assert.match(viewer, /selectObject\(null\)/);
  assert.doesNotMatch(viewer, />Add Furniture<|>Delete<|>Duplicate</);
  assert.match(
    viewer,
    /key=\{productionViewerWorldLifecycleKey\(validated\.authority\)\}/,
  );
  assert.match(
    viewer,
    /\}, \[authority\.generationId, furniture\.objectId, furniture\.transform, world\]\);/,
  );

  const crud = source("lib/afc-v2-runtime/scene-crud.ts");
  assert.match(crud, /crypto\.randomUUID/);
  assert.match(crud, /addSceneObject/);
  assert.doesNotMatch(crud, /addSofa\(/);
  assert.doesNotMatch(crud, /image-space|PPF|fit-to-room/);
  assert.match(crud, /PI4C_MAX_SCENE_OBJECTS/);
  assert.ok(canonicalPlacementSearchOffsets()[0]);
  assert.deepEqual(preferredAddCanonicalTransform().position, { x: 0, y: 0, z: 0 });

  const controls = source("components/afc-3d/Editor3dSceneObjectControls.tsx");
  assert.match(controls, /Add Furniture/);
  assert.match(controls, /aria-label="Duplicate"/);
  assert.match(controls, /aria-label="Delete"/);
  assert.doesNotMatch(controls, /Add Test Sofa|PI-5A|assetId|GLB/);

  const panel = source("components/afc-3d/Editor3dModePanel.tsx");
  assert.match(panel, /Editor3dSceneObjectControls/);
  assert.doesNotMatch(panel, /Scale|Delete|Duplicate|Material|Lighting|GLB/);

  const pkg = source("package.json");
  assert.match(pkg, /"test:afc-v2-pi5a"/);
  assert.equal(PI5A_INSTANTIATE_FAILED_MESSAGE.length > 0, true);
});
