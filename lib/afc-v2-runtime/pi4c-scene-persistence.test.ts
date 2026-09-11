import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  PI4B_SOFA_A_OBJECT_ID,
  PI4B_SOFA_B_OBJECT_ID,
  createPi4bSceneObjectDefinitions,
  createPi4bSceneObjectsFromAuthority,
  instantiateSceneObjectDefinitions,
} from "./furniture-runtime";
import {
  PI4C_DEFAULT_SCENE_POLICY,
  PI4C_SCENE_TABLE,
  applyVisitToLiveFurniture,
  authorizeOwned3dSceneContext,
  beginSceneVisitLoad,
  clonePersistedWorldTransform,
  completeSceneVisitLoad,
  createEmptyLiveFurnitureCommit,
  createLoadedSceneInstanceId,
  createSceneInstanceId,
  createUnloadedSceneVisit,
  destroySceneVisit,
  echoSceneVisitCommit,
  persistenceSafeSceneObjects,
  reconcileLiveScene,
  reportUnknownPersistedAssets,
  resolveLoadedVersionScene,
  resolvePersistedSceneCompatibility,
  sceneIdentitiesEqual,
  shouldApplySceneRequest,
  shouldReplaceLiveScene,
  toPersistedVersionScene,
  validatePersistedSceneObjects,
  validatePersistedVersionScene,
  validatePersistedWorldTransform,
  type Owned3dSceneAuthorization,
} from "./persisted-scene";
import { createPi3aAuthority, PI3A_GENERATION_A, PI3A_GENERATION_B, PI3A_ROOM_ID } from "./pi3a-test-fixture";
import {
  commitSceneObjectTransformById,
  createRuntimeSceneCollection,
  mountLiveRuntimeSceneObject,
  serializeRuntimeScene,
  setLiveSceneObject,
} from "./scene-runtime";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  DEFAULT_WORLD_TRANSFORM,
} from "./types";
import { createPi4aSofaObject3D } from "./pi4a-sofa-geometry";

const ROOT = process.cwd();
const VERSION_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VERSION_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const USER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OTHER_ROOM = "22222222-2222-4222-8222-222222222222";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function transformAt(x: number, yaw = 0) {
  return {
    ...DEFAULT_WORLD_TRANSFORM,
    position: { x, y: 0, z: 0 },
    rotationDeg: { x: 0, y: yaw, z: 0 },
  };
}

function authStatus(result: Owned3dSceneAuthorization): number | null {
  return result.ok ? null : result.status;
}

function identity(versionId: string, generationId = PI3A_GENERATION_A) {
  return {
    roomId: PI3A_ROOM_ID,
    versionId,
    afcGenerationId: generationId,
  };
}

function objectIds(objects: readonly { objectId: string }[]) {
  return objects.map((object) => object.objectId);
}

function sceneWithTransforms(sofaAX: number, sofaBYaw: number) {
  return persistenceSafeSceneObjects(
    createPi4bSceneObjectDefinitions().map((object) => {
      if (object.objectId === PI4B_SOFA_A_OBJECT_ID) {
        return { ...object, transform: transformAt(sofaAX) };
      }
      if (object.objectId === PI4B_SOFA_B_OBJECT_ID) {
        return { ...object, transform: transformAt(1.3, sofaBYaw) };
      }
      return object;
    }),
  );
}

function mountSerializedScene() {
  const authority = createPi3aAuthority();
  const descriptors = createPi4bSceneObjectsFromAuthority(PI3A_ROOM_ID, authority);
  const scene = createRuntimeSceneCollection();
  for (const descriptor of descriptors) {
    setLiveSceneObject(scene, mountLiveRuntimeSceneObject({
      descriptor,
      imported: createPi4aSofaObject3D(),
      metricScale: 1,
    }));
  }
  return { authority, scene };
}

test("PI-4C persistence schema is version-owned mutable scene state", () => {
  const migration = source("supabase/migrations/20260910160000_vibode_3d_scenes.sql");
  assert.match(migration, /create table public\.vibode_3d_scenes/);
  assert.match(migration, /constraint vibode_3d_scenes_room_version_key unique \(room_id, version_id\)/);
  assert.match(migration, /constraint vibode_3d_scenes_version_id_key unique \(version_id\)/);
  assert.match(migration, /references public\.vibode_room_assets \(id, room_id\)\s+on delete cascade/);
  assert.match(migration, /references public\.vibode_rooms\(id\) on delete cascade/);
  assert.match(migration, /afc_generation_id uuid not null/);
  assert.doesNotMatch(migration, /afc_generation_id[\s\S]*references public\.vibode_afc_generations/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.vibode_3d_scenes from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.vibode_3d_scenes\s+to service_role/);
  assert.doesNotMatch(migration, /to authenticated/);
  assert.match(migration, /coordinate_space = 'calibrated-world-xz\/v1'/);
  assert.equal(PI4C_SCENE_TABLE, "vibode_3d_scenes");
  assert.equal(PI4C_DEFAULT_SCENE_POLICY, "initialize-default-persist-on-first-commit");
});

test("PI-4C authorization rejects unauthorized room, version, and generation access", () => {
  const room = {
    id: PI3A_ROOM_ID,
    userId: USER_ID,
    currentAfcGenerationId: PI3A_GENERATION_A,
  };
  const version = {
    id: VERSION_A,
    roomId: PI3A_ROOM_ID,
    userId: USER_ID,
  };
  const generation = {
    id: PI3A_GENERATION_A,
    roomId: PI3A_ROOM_ID,
    userId: USER_ID,
    status: "ready",
  };
  const allowed = authorizeOwned3dSceneContext({
    userId: USER_ID,
    room,
    version,
    generation,
    requestedRoomId: PI3A_ROOM_ID,
    requestedVersionId: VERSION_A,
    requestedAfcGenerationId: PI3A_GENERATION_A,
  });
  assert.equal(allowed.ok, true);

  assert.equal(
    authStatus(authorizeOwned3dSceneContext({
      userId: null,
      room,
      version,
      generation,
      requestedRoomId: PI3A_ROOM_ID,
      requestedVersionId: VERSION_A,
      requestedAfcGenerationId: PI3A_GENERATION_A,
    })),
    401,
  );
  assert.equal(
    authStatus(authorizeOwned3dSceneContext({
      userId: USER_ID,
      room: { ...room, userId: "other-user" },
      version,
      generation,
      requestedRoomId: PI3A_ROOM_ID,
      requestedVersionId: VERSION_A,
      requestedAfcGenerationId: PI3A_GENERATION_A,
    })),
    404,
  );
  assert.equal(
    authStatus(authorizeOwned3dSceneContext({
      userId: USER_ID,
      room,
      version: { ...version, roomId: OTHER_ROOM },
      generation,
      requestedRoomId: PI3A_ROOM_ID,
      requestedVersionId: VERSION_A,
      requestedAfcGenerationId: PI3A_GENERATION_A,
    })),
    404,
  );
  assert.equal(
    authStatus(authorizeOwned3dSceneContext({
      userId: USER_ID,
      room,
      version,
      generation: { ...generation, roomId: OTHER_ROOM },
      requestedRoomId: PI3A_ROOM_ID,
      requestedVersionId: VERSION_A,
      requestedAfcGenerationId: PI3A_GENERATION_A,
    })),
    404,
  );
});

test("PI-4C serialization stores only persistence-safe scene data", () => {
  const { scene } = mountSerializedScene();
  commitSceneObjectTransformById({
    scene,
    objectId: PI4B_SOFA_A_OBJECT_ID,
    realized: transformAt(-2),
    metricScale: 1,
  });
  const serialized = serializeRuntimeScene(scene);
  const persisted = toPersistedVersionScene(identity(VERSION_A), serialized);
  assert.deepEqual(Object.keys(persisted).sort(), [
    "afcGenerationId",
    "coordinateSpace",
    "objects",
    "roomId",
    "versionId",
  ]);
  for (const object of persisted.objects) {
    assert.deepEqual(Object.keys(object).sort(), ["assetId", "objectId", "transform"]);
    assert.equal(object.transform.uniformScale, 1);
    assert.equal("placement" in object, false);
    assert.equal("matrixWorld" in object, false);
  }
  const json = JSON.stringify(persisted);
  assert.doesNotMatch(json, /THREE|Group|Mesh|matrixWorld|TransformControls|localAabb/);
  const validated = validatePersistedVersionScene(persisted);
  assert.equal(validated.ok, true);
});

test("PI-4C transform validation rejects NaN, Infinity, scale, and unexpected space", () => {
  assert.equal(validatePersistedWorldTransform(DEFAULT_WORLD_TRANSFORM).ok, true);
  assert.equal(
    validatePersistedWorldTransform({
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: Number.NaN, y: 0, z: 0 },
    }).ok,
    false,
  );
  assert.equal(
    validatePersistedWorldTransform({
      ...DEFAULT_WORLD_TRANSFORM,
      position: { x: Infinity, y: 0, z: 0 },
    }).ok,
    false,
  );
  assert.equal(
    validatePersistedWorldTransform({
      ...DEFAULT_WORLD_TRANSFORM,
      uniformScale: 1.2,
    }).ok,
    false,
  );
  assert.equal(
    validatePersistedWorldTransform({
      ...DEFAULT_WORLD_TRANSFORM,
      uniformScale: -1,
    }).ok,
    false,
  );
  assert.equal(
    validatePersistedWorldTransform({
      ...DEFAULT_WORLD_TRANSFORM,
      coordinateSpace: "image-space",
    }).ok,
    false,
  );
  assert.equal(
    validatePersistedSceneObjects([
      {
        objectId: PI4B_SOFA_A_OBJECT_ID,
        assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
        transform: DEFAULT_WORLD_TRANSFORM,
        placement: {},
      },
    ]).ok,
    false,
  );
});

test("PI-4C object identity round-trips unchanged", () => {
  const { scene } = mountSerializedScene();
  commitSceneObjectTransformById({
    scene,
    objectId: PI4B_SOFA_A_OBJECT_ID,
    realized: transformAt(-2),
    metricScale: 1,
  });
  commitSceneObjectTransformById({
    scene,
    objectId: PI4B_SOFA_B_OBJECT_ID,
    realized: transformAt(1.3, 45),
    metricScale: 1,
  });
  const serialized = serializeRuntimeScene(scene);
  const persisted = toPersistedVersionScene(identity(VERSION_A), serialized);
  const restored = instantiateSceneObjectDefinitions({
    roomId: persisted.roomId,
    generationId: persisted.afcGenerationId,
    definitions: persisted.objects,
  });
  assert.equal(restored.skipped.length, 0);
  assert.equal(restored.objects[0]?.objectId, PI4B_SOFA_A_OBJECT_ID);
  assert.equal(restored.objects[1]?.objectId, PI4B_SOFA_B_OBJECT_ID);
  assert.equal(restored.objects[0]?.assetIdentity.id, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(restored.objects[0]?.transform.position.x, -2);
  assert.equal(restored.objects[1]?.transform.rotationDeg.y, 45);
  assert.equal(restored.objects[0]?.objectId, serialized.objects[0]?.objectId);
});

test("PI-4C scene save uses committed canonical transforms", () => {
  const { scene } = mountSerializedScene();
  commitSceneObjectTransformById({
    scene,
    objectId: PI4B_SOFA_A_OBJECT_ID,
    realized: transformAt(-2),
    metricScale: 1,
  });
  const persisted = toPersistedVersionScene(
    identity(VERSION_A),
    serializeRuntimeScene(scene),
  );
  const sofaA = persisted.objects.find((object) => object.objectId === PI4B_SOFA_A_OBJECT_ID);
  assert.equal(sofaA?.transform.position.x, -2);
  assert.equal(sofaA?.transform.uniformScale, 1);
  assert.equal(persisted.coordinateSpace, AFC_V2_RUNTIME_COORDINATE_SPACE);
});

test("PI-4C scene restore reinstantiates the same object IDs and transforms", () => {
  const definitions = persistenceSafeSceneObjects([
    {
      objectId: PI4B_SOFA_A_OBJECT_ID,
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      transform: transformAt(-2),
    },
    {
      objectId: PI4B_SOFA_B_OBJECT_ID,
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      transform: transformAt(1, 45),
    },
  ]);
  const restored = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: PI3A_GENERATION_A,
    definitions,
  });
  assert.deepEqual(
    restored.objects.map((object) => object.objectId),
    [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
  );
  assert.equal(restored.objects[0]?.transform.position.x, -2);
  assert.equal(restored.objects[1]?.transform.rotationDeg.y, 45);
});

test("PI-4C Version A and Version B restore independently with no inheritance", () => {
  const scenes = new Map<string, ReturnType<typeof toPersistedVersionScene>>();
  const { scene } = mountSerializedScene();
  commitSceneObjectTransformById({
    scene,
    objectId: PI4B_SOFA_A_OBJECT_ID,
    realized: transformAt(-2),
    metricScale: 1,
  });
  commitSceneObjectTransformById({
    scene,
    objectId: PI4B_SOFA_B_OBJECT_ID,
    realized: transformAt(0, 45),
    metricScale: 1,
  });
  scenes.set(VERSION_A, toPersistedVersionScene(identity(VERSION_A), serializeRuntimeScene(scene)));

  const versionB = mountSerializedScene().scene;
  commitSceneObjectTransformById({
    scene: versionB,
    objectId: PI4B_SOFA_A_OBJECT_ID,
    realized: transformAt(1),
    metricScale: 1,
  });
  commitSceneObjectTransformById({
    scene: versionB,
    objectId: PI4B_SOFA_B_OBJECT_ID,
    realized: transformAt(1.3, 0),
    metricScale: 1,
  });
  scenes.set(VERSION_B, toPersistedVersionScene(identity(VERSION_B), serializeRuntimeScene(versionB)));

  const restoreA = resolveLoadedVersionScene({
    found: true,
    currentAfcGenerationId: PI3A_GENERATION_A,
    stored: scenes.get(VERSION_A) ?? null,
    defaultObjects: createPi4bSceneObjectDefinitions(),
  });
  const restoreB = resolveLoadedVersionScene({
    found: true,
    currentAfcGenerationId: PI3A_GENERATION_A,
    stored: scenes.get(VERSION_B) ?? null,
    defaultObjects: createPi4bSceneObjectDefinitions(),
  });
  const missingChild = resolveLoadedVersionScene({
    found: false,
    currentAfcGenerationId: PI3A_GENERATION_A,
    stored: null,
    defaultObjects: createPi4bSceneObjectDefinitions(),
  });
  assert.equal(restoreA.objects[0]?.transform.position.x, -2);
  assert.equal(restoreA.objects[1]?.transform.rotationDeg.y, 45);
  assert.equal(restoreB.objects[0]?.transform.position.x, 1);
  assert.equal(restoreB.objects[1]?.transform.rotationDeg.y, 0);
  assert.equal(missingChild.origin, "default");
  assert.notEqual(missingChild.objects[0]?.transform.position.x, -2);
  assert.equal(createSceneInstanceId(identity(VERSION_A)), `${PI3A_ROOM_ID}::${VERSION_A}::${PI3A_GENERATION_A}`);
  assert.equal(sceneIdentitiesEqual(identity(VERSION_A), identity(VERSION_B)), false);
});

test("PI-4C AFC generation mismatch is fail-closed and uses the default scene", () => {
  const stored = toPersistedVersionScene(
    identity(VERSION_A, PI3A_GENERATION_A),
    { objects: createPi4bSceneObjectDefinitions() },
  );
  const mismatch = resolvePersistedSceneCompatibility({
    storedAfcGenerationId: PI3A_GENERATION_A,
    currentAfcGenerationId: PI3A_GENERATION_B,
  });
  assert.equal(mismatch.ok, false);
  const loaded = resolveLoadedVersionScene({
    found: true,
    currentAfcGenerationId: PI3A_GENERATION_B,
    stored,
    defaultObjects: createPi4bSceneObjectDefinitions(),
  });
  assert.equal(loaded.status, "incompatible");
  assert.equal(loaded.origin, "default");
  assert.equal(loaded.objects[0]?.transform.position.x, createPi4bSceneObjectDefinitions()[0]?.transform.position.x);
});

test("PI-4C saving a transform does not remount the AFC world or GLB scene", () => {
  assert.equal(
    shouldReplaceLiveScene({
      appliedInstanceId: createSceneInstanceId(identity(VERSION_A)),
      nextInstanceId: createSceneInstanceId(identity(VERSION_A)),
      appliedObjectIds: [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
      nextObjectIds: [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
    }),
    false,
  );
  assert.equal(
    shouldReplaceLiveScene({
      appliedInstanceId: createSceneInstanceId(identity(VERSION_A)),
      nextInstanceId: createSceneInstanceId(identity(VERSION_B)),
      appliedObjectIds: [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
      nextObjectIds: [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
    }),
    true,
  );
  assert.equal(
    shouldReplaceLiveScene({
      appliedInstanceId: createLoadedSceneInstanceId(identity(VERSION_A), 1),
      nextInstanceId: createLoadedSceneInstanceId(identity(VERSION_A), 2),
      appliedObjectIds: [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
      nextObjectIds: [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
    }),
    true,
  );
  assert.equal(
    shouldReplaceLiveScene({
      appliedInstanceId: createLoadedSceneInstanceId(identity(VERSION_A), 1),
      nextInstanceId: createLoadedSceneInstanceId(identity(VERSION_A), 1),
      appliedObjectIds: [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
      nextObjectIds: [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID],
    }),
    false,
  );

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(
    viewer,
    /key=\{productionViewerWorldLifecycleKey\(validated\.authority\)\}/,
  );
  assert.match(
    viewer,
    /\}, \[authority\.generationId, furniture\.objectId, furniture\.transform, world\]\);/,
  );
  assert.doesNotMatch(
    viewer,
    /\[authority\.generationId, furniture\.objectId, furniture\.transform, world, resolvedSceneObjects\]/,
  );
  assert.doesNotMatch(viewer, /key=\{[^}]*sceneInstanceId/);
  assert.doesNotMatch(viewer, /key=\{[^}]*sceneObjects/);
  assert.match(viewer, /onObjectTransformCommitted/);
  assert.match(viewer, /serializeRuntimeScene\(sceneObjects\)/);
  assert.match(viewer, /shouldReplaceLiveScene/);
  assert.match(viewer, /if \(!input\.ready\)/);
  assert.doesNotMatch(viewer, /from\("@\/lib\/supabase/);
  assert.doesNotMatch(viewer, /vibode_3d_scenes/);
});

test("PI-4C stale room/version loads cannot overwrite the current scene", () => {
  const current = identity(VERSION_B);
  assert.equal(
    shouldApplySceneRequest({
      requestId: 1,
      latestRequestId: 2,
      requestIdentity: identity(VERSION_A),
      currentIdentity: current,
    }),
    false,
  );
  assert.equal(
    shouldApplySceneRequest({
      requestId: 2,
      latestRequestId: 2,
      requestIdentity: identity(VERSION_B),
      currentIdentity: current,
    }),
    true,
  );
  assert.equal(
    shouldApplySceneRequest({
      requestId: 2,
      latestRequestId: 2,
      requestIdentity: identity(VERSION_A),
      currentIdentity: current,
    }),
    false,
  );
  assert.equal(
    shouldApplySceneRequest({
      requestId: 3,
      latestRequestId: 3,
      requestIdentity: {
        roomId: OTHER_ROOM,
        versionId: VERSION_A,
        afcGenerationId: PI3A_GENERATION_A,
      },
      currentIdentity: current,
    }),
    false,
  );

  const hook = source("lib/afc-v2-runtime/use-persisted-3d-scene.ts");
  assert.match(hook, /shouldApplySceneRequest/);
  assert.match(hook, /latestLoadIdRef/);
  assert.match(hook, /pendingSaveRef/);
  assert.match(hook, /commitResolvedSnapshot/);
  assert.match(hook, /createLoadedSceneInstanceId/);
  assert.match(hook, /loadRevisionRef/);
  assert.doesNotMatch(hook, /useState\(defaultObjects\)/);
  assert.doesNotMatch(hook, /executeAfcV2Analysis/);
  assert.doesNotMatch(hook, /parentScene|inherit.*scene/i);
});

test("PI-4C unknown assets are skipped without substituting the sofa", () => {
  const skipped = reportUnknownPersistedAssets({
    definitions: [
      {
        objectId: PI4B_SOFA_A_OBJECT_ID,
        assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
        transform: DEFAULT_WORLD_TRANSFORM,
      },
      {
        objectId: "missing-object",
        assetId: "not-registered",
        transform: DEFAULT_WORLD_TRANSFORM,
      },
    ],
    knownAssetIds: new Set([AFC_V2_RUNTIME_FURNITURE_ASSET_ID]),
  });
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]?.reason, "unknown_asset");
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: PI3A_GENERATION_A,
    definitions: [
      {
        objectId: PI4B_SOFA_A_OBJECT_ID,
        assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
        transform: DEFAULT_WORLD_TRANSFORM,
      },
      {
        objectId: "missing-object",
        assetId: "not-registered",
        transform: DEFAULT_WORLD_TRANSFORM,
      },
    ],
  });
  assert.equal(instantiated.objects.length, 1);
  assert.equal(instantiated.objects[0]?.objectId, PI4B_SOFA_A_OBJECT_ID);
  assert.equal(instantiated.skipped.length, 1);
});

test("PI-4C keeps AFC authority, History version identity, and the no-inheritance boundary", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const hook = source("lib/afc-v2-runtime/use-persisted-3d-scene.ts");
  const route = source("app/api/vibode/3d-scene/route.ts");
  const editor = source("app/editor/page.tsx");
  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  for (const text of [viewer, hook, route]) {
    assert.doesNotMatch(text, /executeAfcV2Analysis/);
    assert.doesNotMatch(text, /observeRoom|generateTiled|readTiledPerspective/);
    assert.doesNotMatch(text, /parentScene|scene inheritance/i);
    assert.doesNotMatch(text, /userWorldScale|DEFAULT_PX_PER_IN/);
  }
  assert.match(editor, /versionId=\{selectedVersionId\}/);
  assert.match(editor, /spatialAuthorityId=\{afcRuntime\.generationId\}/);
  assert.match(integrated, /usePersisted3dScene/);
  assert.match(integrated, /sceneObjects=\{persistedScene\.objects\}/);
  assert.match(integrated, /!persistedScene\.sceneReady/);
  assert.doesNotMatch(integrated, /selectedVersion/);
  assert.doesNotMatch(viewer, /selectedVersionId/);
  assert.equal(clonePersistedWorldTransform(DEFAULT_WORLD_TRANSFORM).uniformScale, 1);
});

test("PI-4C1 loaded snapshot applies same objectIds with different transforms after a fresh visit", () => {
  const identityA = identity(VERSION_A);
  const defaults = createPi4bSceneObjectDefinitions();
  const saved = sceneWithTransforms(-2, 45);
  assert.deepEqual(objectIds(saved), [PI4B_SOFA_A_OBJECT_ID, PI4B_SOFA_B_OBJECT_ID]);
  assert.deepEqual(objectIds(defaults), objectIds(saved));
  assert.notEqual(saved[0]?.transform.position.x, defaults[0]?.transform.position.x);
  assert.notEqual(saved[1]?.transform.rotationDeg.y, defaults[1]?.transform.rotationDeg.y);

  assert.equal(
    shouldReplaceLiveScene({
      appliedInstanceId: createSceneInstanceId(identityA),
      nextInstanceId: createSceneInstanceId(identityA),
      appliedObjectIds: objectIds(defaults),
      nextObjectIds: objectIds(saved),
    }),
    false,
  );

  let visit = createUnloadedSceneVisit();
  let live = createEmptyLiveFurnitureCommit();
  visit = beginSceneVisitLoad(visit, identityA);
  ({ live } = applyVisitToLiveFurniture(live, visit));
  visit = completeSceneVisitLoad(visit, identityA, defaults, "default");
  ({ live } = applyVisitToLiveFurniture(live, visit));
  assert.equal(live.objects[0]?.transform.position.x, defaults[0]?.transform.position.x);

  visit = echoSceneVisitCommit(visit, saved);
  const echoed = applyVisitToLiveFurniture(live, visit);
  assert.equal(echoed.action, "leave-untouched");
  assert.equal(echoed.live.appliedInstanceId, live.appliedInstanceId);
  assert.equal(visit.loadRevision, 1);

  const persisted = saved;
  visit = destroySceneVisit();
  live = createEmptyLiveFurnitureCommit();
  visit = beginSceneVisitLoad(visit, identityA);
  const loading = applyVisitToLiveFurniture(live, visit);
  assert.equal(loading.action, "hide");
  assert.equal(loading.live.objects.length, 0);

  visit = completeSceneVisitLoad(visit, identityA, persisted, "persisted");
  const restored = applyVisitToLiveFurniture(loading.live, visit);
  assert.equal(restored.action, "mount");
  assert.equal(restored.live.objects[0]?.objectId, PI4B_SOFA_A_OBJECT_ID);
  assert.equal(restored.live.objects[1]?.objectId, PI4B_SOFA_B_OBJECT_ID);
  assert.equal(restored.live.objects[0]?.transform.position.x, -2);
  assert.equal(restored.live.objects[1]?.transform.rotationDeg.y, 45);
  assert.equal(restored.live.appliedInstanceId, createLoadedSceneInstanceId(identityA, 1));
});

test("PI-4C1 does not commit furniture before the loaded snapshot resolves", () => {
  const identityA = identity(VERSION_A);
  const persisted = sceneWithTransforms(-2, 45);
  const defaults = createPi4bSceneObjectDefinitions();
  let visit = createUnloadedSceneVisit();
  const live = createEmptyLiveFurnitureCommit();

  visit = beginSceneVisitLoad(visit, identityA);
  const pending = applyVisitToLiveFurniture(live, visit);
  assert.equal(visit.sceneReady, false);
  assert.equal(pending.action, "hide");
  assert.equal(pending.live.objects.length, 0);
  assert.equal(pending.live.appliedInstanceId, null);

  visit = completeSceneVisitLoad(visit, identityA, persisted, "persisted");
  const mounted = applyVisitToLiveFurniture(pending.live, visit);
  assert.equal(visit.sceneReady, true);
  assert.equal(mounted.action, "mount");
  assert.equal(mounted.live.objects[0]?.transform.position.x, -2);
  assert.equal(mounted.live.objects[1]?.transform.rotationDeg.y, 45);
  assert.notEqual(mounted.live.objects[0]?.transform.position.x, defaults[0]?.transform.position.x);
  assert.equal(mounted.live.appliedInstanceId, visit.sceneInstanceId);
});

test("PI-4C1 version switches apply same objectIds with independent transforms", () => {
  const identityA = identity(VERSION_A);
  const identityB = identity(VERSION_B);
  const sceneA = sceneWithTransforms(-2, 45);
  const sceneB = sceneWithTransforms(1, 0);
  assert.deepEqual(objectIds(sceneA), objectIds(sceneB));

  let visit = createUnloadedSceneVisit();
  let live = createEmptyLiveFurnitureCommit();

  visit = beginSceneVisitLoad(visit, identityA);
  ({ live } = applyVisitToLiveFurniture(live, visit));
  visit = completeSceneVisitLoad(visit, identityA, sceneA, "persisted");
  ({ live } = applyVisitToLiveFurniture(live, visit));
  assert.equal(live.objects[0]?.transform.position.x, -2);
  assert.equal(live.objects[1]?.transform.rotationDeg.y, 45);

  visit = beginSceneVisitLoad(visit, identityB);
  const hiddenB = applyVisitToLiveFurniture(live, visit);
  assert.equal(hiddenB.action, "hide");
  assert.equal(hiddenB.live.objects[0]?.transform.position.x, -2);
  visit = completeSceneVisitLoad(visit, identityB, sceneB, "persisted");
  const loadedB = applyVisitToLiveFurniture(hiddenB.live, visit);
  assert.equal(loadedB.action, "replace");
  assert.equal(loadedB.live.objects[0]?.transform.position.x, 1);
  assert.equal(loadedB.live.objects[1]?.transform.rotationDeg.y, 0);
  assert.deepEqual(loadedB.live.appliedObjectIds, objectIds(sceneA));

  visit = beginSceneVisitLoad(visit, identityA);
  ({ live } = applyVisitToLiveFurniture(loadedB.live, visit));
  visit = completeSceneVisitLoad(visit, identityA, sceneA, "persisted");
  const restoredA = applyVisitToLiveFurniture(live, visit);
  assert.equal(restoredA.action, "replace");
  assert.equal(restoredA.live.objects[0]?.transform.position.x, -2);
  assert.equal(restoredA.live.objects[1]?.transform.rotationDeg.y, 45);
});

test("PI-4C1 save echo keeps the loaded snapshot revision and does not replace live furniture", () => {
  const identityA = identity(VERSION_A);
  const loadedObjects = sceneWithTransforms(-2, 45);
  const echoedObjects = sceneWithTransforms(-3, 90);
  assert.deepEqual(objectIds(loadedObjects), objectIds(echoedObjects));

  let visit = createUnloadedSceneVisit();
  visit = beginSceneVisitLoad(visit, identityA);
  visit = completeSceneVisitLoad(visit, identityA, loadedObjects, "persisted");
  let live = createEmptyLiveFurnitureCommit();
  ({ live } = applyVisitToLiveFurniture(live, visit));
  const revision = visit.loadRevision;
  const instanceId = visit.sceneInstanceId;
  assert.equal(revision, 1);
  assert.equal(instanceId, createLoadedSceneInstanceId(identityA, 1));

  visit = echoSceneVisitCommit(visit, echoedObjects);
  assert.equal(visit.loadRevision, revision);
  assert.equal(visit.sceneInstanceId, instanceId);
  const echoed = applyVisitToLiveFurniture(live, visit);
  assert.equal(echoed.action, "leave-untouched");
  assert.equal(
    reconcileLiveScene({
      sceneReady: visit.sceneReady,
      appliedInstanceId: live.appliedInstanceId,
      nextInstanceId: visit.sceneInstanceId,
      appliedObjectIds: live.appliedObjectIds,
      nextObjectIds: objectIds(visit.objects),
    }),
    "leave-untouched",
  );
  assert.equal(echoed.live.objects[0]?.transform.position.x, -2);
  assert.equal(shouldReplaceLiveScene({
    appliedInstanceId: instanceId,
    nextInstanceId: visit.sceneInstanceId,
    appliedObjectIds: live.appliedObjectIds,
    nextObjectIds: objectIds(visit.objects),
  }), false);
});

test("PI-4C1 2D to 3D visit destroy and recreate restores the saved scene", () => {
  const identityA = identity(VERSION_A);
  const defaults = createPi4bSceneObjectDefinitions();
  const saved = sceneWithTransforms(-2, 45);

  let visit = createUnloadedSceneVisit();
  let live = createEmptyLiveFurnitureCommit();
  visit = beginSceneVisitLoad(visit, identityA);
  ({ live } = applyVisitToLiveFurniture(live, visit));
  visit = completeSceneVisitLoad(visit, identityA, defaults, "default");
  ({ live } = applyVisitToLiveFurniture(live, visit));
  visit = echoSceneVisitCommit(visit, saved);
  applyVisitToLiveFurniture(live, visit);

  visit = destroySceneVisit();
  live = createEmptyLiveFurnitureCommit();
  assert.equal(visit.sceneReady, false);
  assert.equal(live.appliedInstanceId, null);

  visit = beginSceneVisitLoad(visit, identityA);
  const secondVisitPending = applyVisitToLiveFurniture(live, visit);
  assert.equal(secondVisitPending.action, "hide");
  assert.equal(secondVisitPending.live.objects.length, 0);

  visit = completeSceneVisitLoad(visit, identityA, saved, "persisted");
  const secondVisit = applyVisitToLiveFurniture(secondVisitPending.live, visit);
  assert.equal(secondVisit.action, "mount");
  assert.equal(secondVisit.live.objects[0]?.transform.position.x, -2);
  assert.equal(secondVisit.live.objects[1]?.transform.rotationDeg.y, 45);
  assert.equal(visit.origin, "persisted");
  assert.equal(visit.loadRevision, 1);
});

test("PI-4C1 malformed fallback is still a loaded snapshot for the visit", () => {
  const identityA = identity(VERSION_A);
  const defaults = createPi4bSceneObjectDefinitions();
  let visit = createUnloadedSceneVisit();
  let live = createEmptyLiveFurnitureCommit();
  visit = beginSceneVisitLoad(visit, identityA);
  ({ live } = applyVisitToLiveFurniture(live, visit));
  visit = completeSceneVisitLoad(visit, identityA, defaults, "default");
  const mounted = applyVisitToLiveFurniture(live, visit);
  assert.equal(mounted.action, "mount");
  assert.equal(visit.origin, "default");
  assert.equal(visit.loadRevision, 1);
  assert.equal(visit.sceneReady, true);
  assert.equal(mounted.live.objects[0]?.transform.position.x, defaults[0]?.transform.position.x);
});
