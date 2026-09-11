import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
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
  persistenceSafeSceneObjects,
  reconcileLiveScene,
  reportUnknownPersistedAssets as reportUnknownFromPersistence,
  shouldReplaceLiveScene,
  validatePersistedVersionScene,
} from "./persisted-scene";
import { PI3A_GENERATION_A, PI3A_GENERATION_B, PI3A_ROOM_ID } from "./pi3a-test-fixture";
import {
  insertVersionSceneIfAbsent,
  planVersionSceneInheritance,
  resolveVersionScene,
  upsertVersionScene,
  type LoadedSceneRow,
  type OwnedVersionRecord,
  type ResolveVersionScenePorts,
} from "./scene-inheritance";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  DEFAULT_WORLD_TRANSFORM,
  type SceneObjectDefinition,
} from "./types";
import { resolveCanonicalImmediateParentVersionId } from "@/lib/vibode/version-lineage";

const ROOT = process.cwd();
const VERSION_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VERSION_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VERSION_C = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const USER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const OTHER_USER = "99999999-9999-4999-8999-999999999999";
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

function sceneObjects(sofaAX: number, sofaBYaw: number): SceneObjectDefinition[] {
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

function makeScene(
  versionId: string,
  sofaAX: number,
  sofaBYaw: number,
  generationId = PI3A_GENERATION_A,
  roomId = PI3A_ROOM_ID,
) {
  const parsed = validatePersistedVersionScene({
    roomId,
    versionId,
    afcGenerationId: generationId,
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    objects: sceneObjects(sofaAX, sofaBYaw),
  });
  if (!parsed.ok) {
    throw new Error(parsed.reason);
  }
  return parsed.scene;
}

function versionRecord(
  id: string,
  roomId = PI3A_ROOM_ID,
  userId = USER_ID,
): OwnedVersionRecord {
  return { id, roomId, userId };
}

function objectIds(objects: readonly { objectId: string }[]) {
  return objects.map((object) => object.objectId);
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

test("PI-4D uses existing generation-run then metadata lineage and never timestamps", () => {
  assert.equal(
    resolveCanonicalImmediateParentVersionId(
      { id: VERSION_B, metadata: { sourceVersionId: VERSION_C } },
      [{ output_asset_id: VERSION_B, source_asset_id: VERSION_A }],
    ),
    VERSION_A,
  );
  assert.equal(
    resolveCanonicalImmediateParentVersionId(
      { id: VERSION_B, metadata: { source_version_id: VERSION_A } },
      [],
    ),
    VERSION_A,
  );
  assert.equal(
    resolveCanonicalImmediateParentVersionId(
      { id: VERSION_B, metadata: { sourceVersionId: VERSION_A } },
      [{ output_asset_id: VERSION_B, source_asset_id: null }],
    ),
    null,
  );
  assert.equal(
    resolveCanonicalImmediateParentVersionId(
      { id: VERSION_A, metadata: {} },
      [],
    ),
    null,
  );
  assert.equal(
    resolveCanonicalImmediateParentVersionId(
      { id: VERSION_B, metadata: { sourceVersionId: VERSION_B } },
      [{ output_asset_id: VERSION_B, source_asset_id: VERSION_B }],
    ),
    null,
  );

  const lineage = source("lib/vibode/version-lineage.ts");
  const inheritance = source("lib/afc-v2-runtime/scene-inheritance.ts");
  const server = source("lib/afc-v2-runtime/scene-persistence.server.ts");
  assert.match(lineage, /resolveCanonicalImmediateParentVersionId/);
  assert.match(lineage, /source_asset_id/);
  assert.match(lineage, /source_version_id/);
  assert.doesNotMatch(lineage, /created_at|active_asset_id|order\(.*created/);
  assert.doesNotMatch(inheritance, /created_at|active_asset_id/);
  assert.match(server, /resolveCanonicalImmediateParentVersionId/);
  assert.match(server, /vibode_generation_runs/);
  assert.match(server, /from\("vibode_generation_runs"\)/);
  const roomAssetQueries = server.match(/from\("vibode_room_assets"\)[\s\S]*?;/g) ?? [];
  assert.ok(roomAssetQueries.length > 0);
  for (const query of roomAssetQueries) {
    assert.doesNotMatch(query, /order\("created_at"/);
  }
});

test("PI-4D child inherits parent objects and transforms once into a child-owned row", async () => {
  const parent = makeScene(VERSION_A, -2, 45);
  const state: MemoryState = {
    scenes: new Map([[sceneKey(PI3A_ROOM_ID, VERSION_A), parent]]),
    versions: new Map([
      [VERSION_A, versionRecord(VERSION_A)],
      [VERSION_B, versionRecord(VERSION_B)],
    ]),
    parentByVersionId: new Map([[VERSION_B, VERSION_A]]),
  };
  const resolved = await resolveVersionScene(createMemory(state));
  assert.equal(resolved.status, "ready");
  if (resolved.status !== "ready") return;
  assert.equal(resolved.origin, "inherited");
  assert.equal(resolved.scene.versionId, VERSION_B);
  assert.equal(resolved.scene.roomId, PI3A_ROOM_ID);
  assert.equal(resolved.scene.afcGenerationId, PI3A_GENERATION_A);
  assert.equal(resolved.scene.objects[0]?.objectId, PI4B_SOFA_A_OBJECT_ID);
  assert.equal(resolved.scene.objects[1]?.objectId, PI4B_SOFA_B_OBJECT_ID);
  assert.equal(resolved.scene.objects[0]?.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(resolved.scene.objects[1]?.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(resolved.scene.objects[0]?.transform.position.x, -2);
  assert.equal(resolved.scene.objects[1]?.transform.rotationDeg.y, 45);
  assert.equal(resolved.scene.objects[0]?.transform.uniformScale, 1);

  const storedParent = state.scenes.get(sceneKey(PI3A_ROOM_ID, VERSION_A));
  assert.equal(storedParent?.versionId, VERSION_A);
  assert.equal(storedParent?.objects[0]?.transform.position.x, -2);
  assert.equal(storedParent?.objects[1]?.transform.rotationDeg.y, 45);

  const second = await resolveVersionScene(createMemory(state));
  assert.equal(second.status, "ready");
  if (second.status !== "ready") return;
  assert.equal(second.origin, "persisted");
  assert.equal(second.scene.versionId, VERSION_B);
});

test("PI-4D inherited child row is independent after divergence and parent later edits", async () => {
  const parent = makeScene(VERSION_A, -2, 45);
  const state: MemoryState = {
    scenes: new Map([[sceneKey(PI3A_ROOM_ID, VERSION_A), parent]]),
    versions: new Map([
      [VERSION_A, versionRecord(VERSION_A)],
      [VERSION_B, versionRecord(VERSION_B)],
    ]),
    parentByVersionId: new Map([[VERSION_B, VERSION_A]]),
  };
  const inherited = await resolveVersionScene(createMemory(state));
  assert.equal(inherited.status, "ready");

  upsertVersionScene(state.scenes, makeScene(VERSION_B, 1, 90));
  const afterChildEdit = await resolveVersionScene(createMemory(state));
  assert.equal(afterChildEdit.status, "ready");
  if (afterChildEdit.status !== "ready") return;
  assert.equal(afterChildEdit.scene.objects[0]?.transform.position.x, 1);
  assert.equal(afterChildEdit.scene.objects[1]?.transform.rotationDeg.y, 90);
  assert.equal(
    state.scenes.get(sceneKey(PI3A_ROOM_ID, VERSION_A))?.objects[0]?.transform.position.x,
    -2,
  );

  upsertVersionScene(state.scenes, makeScene(VERSION_A, -4, 15));
  const afterParentEdit = await resolveVersionScene(createMemory(state));
  assert.equal(afterParentEdit.status, "ready");
  if (afterParentEdit.status !== "ready") return;
  assert.equal(afterParentEdit.scene.objects[0]?.transform.position.x, 1);
  assert.equal(afterParentEdit.scene.objects[1]?.transform.rotationDeg.y, 90);
  assert.equal(
    state.scenes.get(sceneKey(PI3A_ROOM_ID, VERSION_A))?.objects[0]?.transform.position.x,
    -4,
  );
  assert.equal(
    state.scenes.get(sceneKey(PI3A_ROOM_ID, VERSION_A))?.objects[1]?.transform.rotationDeg.y,
    15,
  );
});

test("PI-4D existing child scene wins and inheritance cannot overwrite it", async () => {
  const parent = makeScene(VERSION_A, -2, 45);
  const child = makeScene(VERSION_B, 1, 0);
  const state: MemoryState = {
    scenes: new Map([
      [sceneKey(PI3A_ROOM_ID, VERSION_A), parent],
      [sceneKey(PI3A_ROOM_ID, VERSION_B), child],
    ]),
    versions: new Map([
      [VERSION_A, versionRecord(VERSION_A)],
      [VERSION_B, versionRecord(VERSION_B)],
    ]),
    parentByVersionId: new Map([[VERSION_B, VERSION_A]]),
  };
  const resolved = await resolveVersionScene(createMemory(state));
  assert.equal(resolved.status, "ready");
  if (resolved.status !== "ready") return;
  assert.equal(resolved.origin, "persisted");
  assert.equal(resolved.scene.objects[0]?.transform.position.x, 1);
  assert.equal(resolved.scene.versionId, VERSION_B);

  const inheritAttempt = makeScene(VERSION_B, -2, 45);
  const race = insertVersionSceneIfAbsent(state.scenes, inheritAttempt);
  assert.equal(race.inserted, false);
  assert.equal(race.scene.objects[0]?.transform.position.x, 1);
  assert.notEqual(race.scene.objects[0]?.transform.position.x, -2);
});

test("PI-4D first-writer-wins when inherit races an explicit child save", async () => {
  const parent = makeScene(VERSION_A, -2, 45);
  const userSave = makeScene(VERSION_B, 3, 12);
  const rows = new Map([[sceneKey(PI3A_ROOM_ID, VERSION_A), parent]]);
  const inherit = createInheritedChildScene({
    parentScene: parent,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    currentAfcGenerationId: PI3A_GENERATION_A,
  });
  assert.equal(inherit.ok, true);
  if (!inherit.ok) return;

  const userFirst = insertVersionSceneIfAbsent(rows, userSave);
  const inheritSecond = insertVersionSceneIfAbsent(rows, inherit.scene);
  assert.equal(userFirst.inserted, true);
  assert.equal(inheritSecond.inserted, false);
  assert.equal(inheritSecond.scene.objects[0]?.transform.position.x, 3);
  assert.equal(rows.get(sceneKey(PI3A_ROOM_ID, VERSION_A))?.objects[0]?.transform.position.x, -2);

  const inheritFirstRows = new Map([[sceneKey(PI3A_ROOM_ID, VERSION_A), parent]]);
  const inheritFirst = insertVersionSceneIfAbsent(inheritFirstRows, inherit.scene);
  const userSecond = insertVersionSceneIfAbsent(inheritFirstRows, userSave);
  assert.equal(inheritFirst.inserted, true);
  assert.equal(userSecond.inserted, false);
  assert.equal(userSecond.scene.objects[0]?.transform.position.x, -2);
  upsertVersionScene(inheritFirstRows, userSave);
  assert.equal(
    inheritFirstRows.get(sceneKey(PI3A_ROOM_ID, VERSION_B))?.objects[0]?.transform.position.x,
    3,
  );
});

test("PI-4D chain C inherits B's current scene, not A's", async () => {
  const sceneA = makeScene(VERSION_A, -2, 45);
  const sceneB = makeScene(VERSION_B, 1, 90);
  const state: MemoryState = {
    scenes: new Map([
      [sceneKey(PI3A_ROOM_ID, VERSION_A), sceneA],
      [sceneKey(PI3A_ROOM_ID, VERSION_B), sceneB],
    ]),
    versions: new Map([
      [VERSION_A, versionRecord(VERSION_A)],
      [VERSION_B, versionRecord(VERSION_B)],
      [VERSION_C, versionRecord(VERSION_C)],
    ]),
    parentByVersionId: new Map([
      [VERSION_B, VERSION_A],
      [VERSION_C, VERSION_B],
    ]),
  };
  const ports: ResolveVersionScenePorts = {
    ...createMemory(state),
    childVersionId: VERSION_C,
    loadChildScene: async () => {
      const stored = state.scenes.get(sceneKey(PI3A_ROOM_ID, VERSION_C));
      return stored ? { found: true, scene: stored } : { found: false };
    },
    resolveParentVersionId: async () => state.parentByVersionId.get(VERSION_C) ?? null,
  };
  const resolved = await resolveVersionScene(ports);
  assert.equal(resolved.status, "ready");
  if (resolved.status !== "ready") return;
  assert.equal(resolved.scene.versionId, VERSION_C);
  assert.equal(resolved.scene.objects[0]?.transform.position.x, 1);
  assert.equal(resolved.scene.objects[1]?.transform.rotationDeg.y, 90);
  assert.notEqual(resolved.scene.objects[0]?.transform.position.x, -2);
  assert.equal(
    state.scenes.get(sceneKey(PI3A_ROOM_ID, VERSION_A))?.objects[0]?.transform.position.x,
    -2,
  );
  assert.equal(
    state.scenes.get(sceneKey(PI3A_ROOM_ID, VERSION_B))?.objects[0]?.transform.position.x,
    1,
  );
});

test("PI-4D skips inheritance for root, missing parent scene, mismatch, and bad parents", async () => {
  const parent = makeScene(VERSION_A, -2, 45);
  const incompatibleParent = makeScene(VERSION_A, -2, 45, PI3A_GENERATION_B);

  const none = planVersionSceneInheritance({
    childFound: false,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    userId: USER_ID,
    currentAfcGenerationId: PI3A_GENERATION_A,
    parentVersionId: null,
    parentVersion: null,
    parentScene: { found: false },
  });
  assert.equal(none.action, "skip");
  if (none.action === "skip") assert.equal(none.reason, "no-parent");

  const missing = planVersionSceneInheritance({
    childFound: false,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    userId: USER_ID,
    currentAfcGenerationId: PI3A_GENERATION_A,
    parentVersionId: VERSION_A,
    parentVersion: null,
    parentScene: { found: false },
  });
  assert.equal(missing.action, "skip");
  if (missing.action === "skip") assert.equal(missing.reason, "parent-missing");

  const noScene = planVersionSceneInheritance({
    childFound: false,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    userId: USER_ID,
    currentAfcGenerationId: PI3A_GENERATION_A,
    parentVersionId: VERSION_A,
    parentVersion: versionRecord(VERSION_A),
    parentScene: { found: false },
  });
  assert.equal(noScene.action, "skip");
  if (noScene.action === "skip") assert.equal(noScene.reason, "parent-no-scene");

  const mismatch = planVersionSceneInheritance({
    childFound: false,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    userId: USER_ID,
    currentAfcGenerationId: PI3A_GENERATION_A,
    parentVersionId: VERSION_A,
    parentVersion: versionRecord(VERSION_A),
    parentScene: { found: true, scene: incompatibleParent },
  });
  assert.equal(mismatch.action, "skip");
  if (mismatch.action === "skip") assert.equal(mismatch.reason, "parent-incompatible");

  const crossRoom = planVersionSceneInheritance({
    childFound: false,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    userId: USER_ID,
    currentAfcGenerationId: PI3A_GENERATION_A,
    parentVersionId: VERSION_A,
    parentVersion: versionRecord(VERSION_A, OTHER_ROOM),
    parentScene: { found: true, scene: parent },
  });
  assert.equal(crossRoom.action, "skip");
  if (crossRoom.action === "skip") assert.equal(crossRoom.reason, "parent-cross-room");

  const otherUser = planVersionSceneInheritance({
    childFound: false,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    userId: USER_ID,
    currentAfcGenerationId: PI3A_GENERATION_A,
    parentVersionId: VERSION_A,
    parentVersion: versionRecord(VERSION_A, PI3A_ROOM_ID, OTHER_USER),
    parentScene: { found: true, scene: parent },
  });
  assert.equal(otherUser.action, "skip");
  if (otherUser.action === "skip") assert.equal(otherUser.reason, "parent-unauthorized");

  const malformed = planVersionSceneInheritance({
    childFound: false,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    userId: USER_ID,
    currentAfcGenerationId: PI3A_GENERATION_A,
    parentVersionId: VERSION_A,
    parentVersion: versionRecord(VERSION_A),
    parentScene: { found: true, malformed: true },
  });
  assert.equal(malformed.action, "skip");
  if (malformed.action === "skip") assert.equal(malformed.reason, "parent-malformed");

  const existingChild = planVersionSceneInheritance({
    childFound: true,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    userId: USER_ID,
    currentAfcGenerationId: PI3A_GENERATION_A,
    parentVersionId: VERSION_A,
    parentVersion: versionRecord(VERSION_A),
    parentScene: { found: true, scene: parent },
  });
  assert.equal(existingChild.action, "use-child");

  const rootResolve = await resolveVersionScene({
    ...createMemory({
      scenes: new Map(),
      versions: new Map([[VERSION_B, versionRecord(VERSION_B)]]),
      parentByVersionId: new Map([[VERSION_B, null]]),
    }),
  });
  assert.equal(rootResolve.status, "none");
});

test("PI-4D copies unknown assets without substitution and fails closed on persist errors", async () => {
  const parent = makeScene(VERSION_A, -2, 45);
  const withUnknown = {
    ...parent,
    objects: [
      ...parent.objects,
      {
        objectId: "custom-chair",
        assetId: "not-registered",
        transform: DEFAULT_WORLD_TRANSFORM,
      },
    ],
  };
  const inherited = createInheritedChildScene({
    parentScene: withUnknown,
    childRoomId: PI3A_ROOM_ID,
    childVersionId: VERSION_B,
    currentAfcGenerationId: PI3A_GENERATION_A,
  });
  assert.equal(inherited.ok, true);
  if (!inherited.ok) return;
  assert.equal(inherited.scene.objects[2]?.assetId, "not-registered");
  const skipped = reportUnknownFromPersistence({
    definitions: inherited.scene.objects,
    knownAssetIds: new Set([AFC_V2_RUNTIME_FURNITURE_ASSET_ID]),
  });
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]?.reason, "unknown_asset");
  const instantiated = instantiateSceneObjectDefinitions({
    roomId: PI3A_ROOM_ID,
    generationId: PI3A_GENERATION_A,
    definitions: inherited.scene.objects,
  });
  assert.equal(instantiated.objects.length, 2);
  assert.equal(instantiated.skipped.length, 1);
  assert.equal(parent.objects.length, 2);

  const failed = await resolveVersionScene({
    ...createMemory({
      scenes: new Map([[sceneKey(PI3A_ROOM_ID, VERSION_A), parent]]),
      versions: new Map([
        [VERSION_A, versionRecord(VERSION_A)],
        [VERSION_B, versionRecord(VERSION_B)],
      ]),
      parentByVersionId: new Map([[VERSION_B, VERSION_A]]),
    }),
    insertChildSceneIfAbsent: async () => ({ ok: false, error: "transient" }),
  });
  assert.equal(failed.status, "none");
});

test("PI-4D inherited scene becomes the first loaded furniture snapshot and save-echo does not remount", () => {
  const identityB = {
    roomId: PI3A_ROOM_ID,
    versionId: VERSION_B,
    afcGenerationId: PI3A_GENERATION_A,
  };
  const defaults = createPi4bSceneObjectDefinitions();
  const inherited = sceneObjects(-2, 45);
  assert.deepEqual(objectIds(inherited), objectIds(defaults));
  assert.notEqual(inherited[0]?.transform.position.x, defaults[0]?.transform.position.x);

  let visit = createUnloadedSceneVisit();
  const live = createEmptyLiveFurnitureCommit();
  visit = beginSceneVisitLoad(visit, identityB);
  const pending = applyVisitToLiveFurniture(live, visit);
  assert.equal(pending.action, "hide");
  assert.equal(pending.live.objects.length, 0);

  visit = completeSceneVisitLoad(visit, identityB, inherited, "persisted");
  const mounted = applyVisitToLiveFurniture(pending.live, visit);
  assert.equal(mounted.action, "mount");
  assert.equal(mounted.live.objects[0]?.objectId, PI4B_SOFA_A_OBJECT_ID);
  assert.equal(mounted.live.objects[1]?.objectId, PI4B_SOFA_B_OBJECT_ID);
  assert.equal(mounted.live.objects[0]?.transform.position.x, -2);
  assert.equal(mounted.live.objects[1]?.transform.rotationDeg.y, 45);
  assert.notEqual(mounted.live.objects[0]?.transform.position.x, defaults[0]?.transform.position.x);
  assert.equal(visit.loadRevision, 1);
  assert.equal(visit.sceneInstanceId, createLoadedSceneInstanceId(identityB, 1));

  const edited = sceneObjects(1, 90);
  visit = echoSceneVisitCommit(visit, edited);
  const echoed = applyVisitToLiveFurniture(mounted.live, visit);
  assert.equal(echoed.action, "leave-untouched");
  assert.equal(visit.loadRevision, 1);
  assert.equal(
    reconcileLiveScene({
      sceneReady: visit.sceneReady,
      appliedInstanceId: mounted.live.appliedInstanceId,
      nextInstanceId: visit.sceneInstanceId,
      appliedObjectIds: mounted.live.appliedObjectIds,
      nextObjectIds: objectIds(visit.objects),
    }),
    "leave-untouched",
  );
  assert.equal(
    shouldReplaceLiveScene({
      appliedInstanceId: visit.sceneInstanceId,
      nextInstanceId: visit.sceneInstanceId,
      appliedObjectIds: objectIds(inherited),
      nextObjectIds: objectIds(edited),
    }),
    false,
  );
});

test("PI-4D keeps inheritance in the scene resolver and out of Three / AFC", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  const hook = source("lib/afc-v2-runtime/use-persisted-3d-scene.ts");
  const route = source("app/api/vibode/3d-scene/route.ts");
  const server = source("lib/afc-v2-runtime/scene-persistence.server.ts");
  const inheritance = source("lib/afc-v2-runtime/scene-inheritance.ts");
  const persisted = source("lib/afc-v2-runtime/persisted-scene.ts");

  for (const text of [viewer, integrated, hook]) {
    assert.doesNotMatch(text, /resolveCanonicalImmediateParentVersionId|planVersionSceneInheritance/);
    assert.doesNotMatch(text, /inheritFromVersionId/);
    assert.doesNotMatch(text, /executeAfcV2Analysis/);
  }
  assert.match(route, /resolveOwnedVersionScene/);
  assert.doesNotMatch(route, /inheritFromVersionId/);
  assert.doesNotMatch(route, /executeAfcV2Analysis/);
  assert.match(server, /ignoreDuplicates: true/);
  assert.match(server, /onConflict: "room_id,version_id"/);
  assert.match(server, /resolveVersionScene/);
  assert.doesNotMatch(server, /executeAfcV2Analysis/);
  assert.doesNotMatch(server, /from\("vibode_afc_generations"\)\.update/);
  assert.match(inheritance, /insertVersionSceneIfAbsent/);
  assert.match(inheritance, /planVersionSceneInheritance/);
  assert.doesNotMatch(inheritance, /executeAfcV2Analysis|observeRoom|generateTiled/);
  assert.match(persisted, /createInheritedChildScene/);
  assert.doesNotMatch(inheritance, /create table|alter table/i);
  assert.doesNotMatch(server, /create table public\./);
  assert.doesNotMatch(viewer, /vibode_generation_runs/);
});
