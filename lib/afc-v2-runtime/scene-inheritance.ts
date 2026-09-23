/**
 * PI-4D one-time parent → child 3D scene inheritance.
 *
 * Copy-on-first-resolution only. The child then owns an independent
 * vibode_3d_scenes row. This is not a live parent-child link, and it
 * does not run in the Three viewer.
 */

import {
  createInheritedChildScene,
  persistenceSafeSceneObjects,
  resolvePersistedSceneCompatibility,
  type PersistedVersionScene,
} from "./persisted-scene";

export type SceneInheritanceSkipReason =
  | "no-parent"
  | "parent-missing"
  | "parent-cross-room"
  | "parent-unauthorized"
  | "parent-no-scene"
  | "parent-malformed"
  | "parent-incompatible"
  | "inherited-payload-invalid";

export type SceneInheritanceOrigin = "persisted" | "inherited" | "default";

export type OwnedVersionRecord = Readonly<{
  id: string;
  roomId: string;
  userId: string;
}>;

export type LoadedSceneRow =
  | Readonly<{ found: false }>
  | Readonly<{ found: true; malformed: true }>
  | Readonly<{ found: true; scene: PersistedVersionScene }>;

export type SceneInheritanceDecision =
  | Readonly<{ action: "use-child"; origin: "persisted" }>
  | Readonly<{
      action: "inherit";
      origin: "inherited";
      childScene: PersistedVersionScene;
    }>
  | Readonly<{
      action: "skip";
      origin: "default";
      reason: SceneInheritanceSkipReason;
    }>;

export type InsertChildSceneIfAbsentResult =
  | Readonly<{ ok: true; inserted: boolean }>
  | Readonly<{ ok: false; error: string }>;

export type ResolvedVersionScene =
  | Readonly<{
      status: "ready";
      origin: "persisted" | "inherited";
      scene: PersistedVersionScene;
    }>
  | Readonly<{
      status: "none";
      origin: "default";
      scene: null;
      reason: SceneInheritanceSkipReason | null;
    }>
  | Readonly<{
      status: "malformed";
      origin: "default";
      scene: null;
      reason: string;
    }>
  | Readonly<{
      status: "incompatible";
      origin: "default";
      scene: null;
      reason: string;
      storedAfcGenerationId: string;
    }>;

export type ResolveVersionScenePorts = Readonly<{
  childRoomId: string;
  childVersionId: string;
  userId: string;
  currentAfcGenerationId: string;
  loadChildScene: () => Promise<LoadedSceneRow>;
  resolveParentVersionId: () => Promise<string | null>;
  loadParentVersion: (parentVersionId: string) => Promise<OwnedVersionRecord | null>;
  loadParentScene: (parentVersionId: string) => Promise<LoadedSceneRow>;
  insertChildSceneIfAbsent: (
    scene: PersistedVersionScene,
  ) => Promise<InsertChildSceneIfAbsentResult>;
}>;

export function sceneOwnershipKey(scene: PersistedVersionScene): string {
  return `${scene.roomId}::${scene.versionId}`;
}

export function insertVersionSceneIfAbsent(
  rows: Map<string, PersistedVersionScene>,
  scene: PersistedVersionScene,
): { inserted: boolean; scene: PersistedVersionScene } {
  const key = sceneOwnershipKey(scene);
  const existing = rows.get(key);
  if (existing) {
    return { inserted: false, scene: existing };
  }
  const stored: PersistedVersionScene = {
    roomId: scene.roomId,
    versionId: scene.versionId,
    afcGenerationId: scene.afcGenerationId,
    coordinateSpace: scene.coordinateSpace,
    objects: persistenceSafeSceneObjects(scene.objects),
  };
  rows.set(key, stored);
  return { inserted: true, scene: stored };
}

export function upsertVersionScene(
  rows: Map<string, PersistedVersionScene>,
  scene: PersistedVersionScene,
): PersistedVersionScene {
  const stored: PersistedVersionScene = {
    roomId: scene.roomId,
    versionId: scene.versionId,
    afcGenerationId: scene.afcGenerationId,
    coordinateSpace: scene.coordinateSpace,
    objects: persistenceSafeSceneObjects(scene.objects),
  };
  rows.set(sceneOwnershipKey(scene), stored);
  return stored;
}

export function planVersionSceneInheritance(input: Readonly<{
  childFound: boolean;
  childRoomId: string;
  childVersionId: string;
  userId: string;
  currentAfcGenerationId: string;
  parentVersionId: string | null;
  parentVersion: OwnedVersionRecord | null;
  parentScene: LoadedSceneRow;
}>): SceneInheritanceDecision {
  if (input.childFound) {
    return { action: "use-child", origin: "persisted" };
  }
  if (!input.parentVersionId) {
    return { action: "skip", origin: "default", reason: "no-parent" };
  }
  if (!input.parentVersion) {
    return { action: "skip", origin: "default", reason: "parent-missing" };
  }
  if (input.parentVersion.roomId !== input.childRoomId) {
    return { action: "skip", origin: "default", reason: "parent-cross-room" };
  }
  if (input.parentVersion.userId !== input.userId || input.parentVersion.id !== input.parentVersionId) {
    return { action: "skip", origin: "default", reason: "parent-unauthorized" };
  }
  if (!input.parentScene.found) {
    return { action: "skip", origin: "default", reason: "parent-no-scene" };
  }
  if ("malformed" in input.parentScene) {
    return { action: "skip", origin: "default", reason: "parent-malformed" };
  }
  if (input.parentScene.scene.roomId !== input.childRoomId) {
    return { action: "skip", origin: "default", reason: "parent-cross-room" };
  }
  const compatibility = resolvePersistedSceneCompatibility({
    storedAfcGenerationId: input.parentScene.scene.afcGenerationId,
    currentAfcGenerationId: input.currentAfcGenerationId,
  });
  if (!compatibility.ok) {
    return { action: "skip", origin: "default", reason: "parent-incompatible" };
  }
  const inherited = createInheritedChildScene({
    parentScene: input.parentScene.scene,
    childRoomId: input.childRoomId,
    childVersionId: input.childVersionId,
    currentAfcGenerationId: input.currentAfcGenerationId,
  });
  if (!inherited.ok) {
    return { action: "skip", origin: "default", reason: "inherited-payload-invalid" };
  }
  return {
    action: "inherit",
    origin: "inherited",
    childScene: inherited.scene,
  };
}

function warnInheritance(detail: unknown) {
  if (typeof console === "undefined") return;
  console.warn("[afc-3d-scene] parent scene inheritance did not apply", detail);
}

function childRowToResolved(
  row: Extract<LoadedSceneRow, { found: true }>,
  currentAfcGenerationId: string,
  origin: "persisted" | "inherited",
): ResolvedVersionScene {
  if ("malformed" in row) {
    return {
      status: "malformed",
      origin: "default",
      scene: null,
      reason: "Stored 3D scene is malformed.",
    };
  }
  const compatibility = resolvePersistedSceneCompatibility({
    storedAfcGenerationId: row.scene.afcGenerationId,
    currentAfcGenerationId,
  });
  if (!compatibility.ok) {
    return {
      status: "incompatible",
      origin: "default",
      scene: null,
      reason: "Stored 3D scene belongs to a different AFC generation.",
      storedAfcGenerationId: row.scene.afcGenerationId,
    };
  }
  return {
    status: "ready",
    origin,
    scene: row.scene,
  };
}

export async function resolveVersionScene(
  input: ResolveVersionScenePorts,
): Promise<ResolvedVersionScene> {
  const child = await input.loadChildScene();
  if (child.found) {
    return childRowToResolved(child, input.currentAfcGenerationId, "persisted");
  }

  try {
    const parentVersionId = await input.resolveParentVersionId();
    const parentVersion = parentVersionId
      ? await input.loadParentVersion(parentVersionId)
      : null;
    const parentScene = parentVersionId
      ? await input.loadParentScene(parentVersionId)
      : { found: false } as const;
    const plan = planVersionSceneInheritance({
      childFound: false,
      childRoomId: input.childRoomId,
      childVersionId: input.childVersionId,
      userId: input.userId,
      currentAfcGenerationId: input.currentAfcGenerationId,
      parentVersionId,
      parentVersion,
      parentScene,
    });
    if (plan.action === "skip") {
      if (plan.reason !== "no-parent") {
        warnInheritance({
          reason: plan.reason,
          roomId: input.childRoomId,
          versionId: input.childVersionId,
          parentVersionId,
        });
      }
      return {
        status: "none",
        origin: "default",
        scene: null,
        reason: plan.reason,
      };
    }
    if (plan.action !== "inherit") {
      return {
        status: "none",
        origin: "default",
        scene: null,
        reason: null,
      };
    }

    const inserted = await input.insertChildSceneIfAbsent(plan.childScene);
    if (!inserted.ok) {
      warnInheritance({
        reason: "persist-failed",
        roomId: input.childRoomId,
        versionId: input.childVersionId,
        parentVersionId,
        error: inserted.error,
      });
      return {
        status: "none",
        origin: "default",
        scene: null,
        reason: null,
      };
    }

    const reloaded = await input.loadChildScene();
    if (!reloaded.found) {
      warnInheritance({
        reason: "reload-missing",
        roomId: input.childRoomId,
        versionId: input.childVersionId,
        parentVersionId,
      });
      return {
        status: "none",
        origin: "default",
        scene: null,
        reason: null,
      };
    }
    return childRowToResolved(
      reloaded,
      input.currentAfcGenerationId,
      inserted.inserted ? "inherited" : "persisted",
    );
  } catch (error) {
    warnInheritance({
      reason: "unexpected-error",
      roomId: input.childRoomId,
      versionId: input.childVersionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      status: "none",
      origin: "default",
      scene: null,
      reason: null,
    };
  }
}
