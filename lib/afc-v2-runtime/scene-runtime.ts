/**
 * Live multi-object AFC scene collection.
 *
 * Domain RuntimeSceneObject remains the persistence-ready record.
 * LiveRuntimeSceneObject is the mounted Three.js consumer of that record.
 * serializeRuntimeScene is the PI-4C persistence serializer.
 */

import * as THREE from "three";

import {
  resolveSceneObjectCollision,
  type SceneCollisionMode,
  type SceneCollisionResult,
} from "./collision-resolver";
import {
  canonicalizeObjectWorldTransform,
  realizeObjectWorldTransform,
} from "./metric-world-realization";
import {
  applyWorldTransform,
  attachImportedObject,
  createSceneObjectRoot,
  measurePlacementLocalAabb,
} from "./object-runtime";
import type {
  LocalAabb,
  RuntimeAssetIdentity,
  RuntimeCollisionWall,
  RuntimeSceneObject,
  SerializedRuntimeScene,
  WorldTransform,
} from "./types";
import {
  AFC_V2_USER_SIZE_DEFAULT,
  clampUserSizeMultiplier,
} from "./types";
import { cloneSceneObjectDefinition } from "./persisted-scene";
import {
  tagSceneObjectRoot,
  transformControlsAttachmentTarget,
} from "./viewport-interaction";

export type LiveRuntimeSceneObject = {
  objectId: string;
  assetIdentity: RuntimeAssetIdentity;
  canonicalTransform: WorldTransform;
  realizedTransform: WorldTransform;
  placement: THREE.Group;
  importPlacement: THREE.Group;
  localAabb: LocalAabb | null;
  productId?: string;
  variantId?: string;
  userSizeMultiplier: number;
  authoredImportScale: number;
};

export type RuntimeSceneCollection = Map<string, LiveRuntimeSceneObject>;

export function cloneWorldTransform(transform: WorldTransform): WorldTransform {
  return {
    position: {
      x: transform.position.x,
      y: transform.position.y,
      z: transform.position.z,
    },
    rotationDeg: {
      x: transform.rotationDeg.x,
      y: transform.rotationDeg.y,
      z: transform.rotationDeg.z,
    },
    uniformScale: 1,
  };
}

export function createRuntimeSceneCollection(): RuntimeSceneCollection {
  return new Map();
}

export function getLiveSceneObject(
  scene: RuntimeSceneCollection,
  objectId: string | null | undefined,
): LiveRuntimeSceneObject | null {
  if (typeof objectId !== "string" || objectId.length === 0) return null;
  return scene.get(objectId) ?? null;
}

export function setLiveSceneObject(
  scene: RuntimeSceneCollection,
  object: LiveRuntimeSceneObject,
): void {
  scene.set(object.objectId, object);
}

export function removeLiveSceneObject(
  scene: RuntimeSceneCollection,
  objectId: string,
): LiveRuntimeSceneObject | null {
  const object = getLiveSceneObject(scene, objectId);
  if (!object) return null;
  scene.delete(objectId);
  return object;
}

export function liveSceneObjectForBodyDrag(
  scene: RuntimeSceneCollection,
  session: Readonly<{ objectId: string }> | null,
): LiveRuntimeSceneObject | null {
  if (!session) return null;
  return getLiveSceneObject(scene, session.objectId);
}

export function resolveSelectedObjectId(
  hitObjectId: string | null,
): string | null {
  if (typeof hitObjectId !== "string" || hitObjectId.length === 0) return null;
  return hitObjectId;
}

export function attachTargetForSelectedObject(
  scene: RuntimeSceneCollection,
  selectedObjectId: string | null,
): THREE.Object3D | null {
  const object = getLiveSceneObject(scene, selectedObjectId);
  if (!object) return null;
  return transformControlsAttachmentTarget(object);
}

export function mountLiveRuntimeSceneObject(input: Readonly<{
  descriptor: RuntimeSceneObject;
  imported: THREE.Object3D;
  metricScale: number;
}>): LiveRuntimeSceneObject {
  const root = createSceneObjectRoot();
  tagSceneObjectRoot(root.placement, input.descriptor.objectId);
  attachImportedObject(root.importPlacement, input.imported);
  const authoredImportScale = root.importPlacement.scale.x;
  const userSizeMultiplier = clampUserSizeMultiplier(
    input.descriptor.userSizeMultiplier ?? AFC_V2_USER_SIZE_DEFAULT,
  );
  if (userSizeMultiplier !== AFC_V2_USER_SIZE_DEFAULT) {
    root.importPlacement.scale.setScalar(authoredImportScale * userSizeMultiplier);
  }
  const realized = cloneWorldTransform(
    realizeObjectWorldTransform(input.descriptor.transform, input.metricScale),
  );
  applyWorldTransform(root.placement, realized);
  const identity = cloneSceneObjectDefinition({
    objectId: input.descriptor.objectId,
    assetId: input.descriptor.assetIdentity.id,
    transform: input.descriptor.transform,
    productId: input.descriptor.productId,
    variantId: input.descriptor.variantId,
    userSizeMultiplier,
  });
  return {
    objectId: input.descriptor.objectId,
    assetIdentity: input.descriptor.assetIdentity,
    canonicalTransform: cloneWorldTransform(input.descriptor.transform),
    realizedTransform: realized,
    placement: root.placement,
    importPlacement: root.importPlacement,
    localAabb: measurePlacementLocalAabb(root.placement, root.importPlacement),
    productId: identity.productId,
    variantId: identity.variantId,
    userSizeMultiplier,
    authoredImportScale,
  };
}

export function applyLiveUserSizeMultiplier(
  object: LiveRuntimeSceneObject,
  multiplier: number,
): void {
  const next = clampUserSizeMultiplier(multiplier);
  object.userSizeMultiplier = next;
  object.importPlacement.scale.setScalar(object.authoredImportScale * next);
  object.localAabb = measurePlacementLocalAabb(
    object.placement,
    object.importPlacement,
  );
}

export function commitLiveSceneObjectTransform(
  object: LiveRuntimeSceneObject,
  realized: WorldTransform,
  metricScale: number,
): void {
  const next = cloneWorldTransform(realized);
  applyWorldTransform(object.placement, next);
  object.placement.scale.setScalar(1);
  object.realizedTransform = next;
  object.canonicalTransform = cloneWorldTransform(
    canonicalizeObjectWorldTransform(next, metricScale),
  );
}

export function commitSceneObjectTransformById(input: Readonly<{
  scene: RuntimeSceneCollection;
  objectId: string;
  realized: WorldTransform;
  metricScale: number;
}>): LiveRuntimeSceneObject | null {
  const object = getLiveSceneObject(input.scene, input.objectId);
  if (!object) return null;
  commitLiveSceneObjectTransform(object, input.realized, input.metricScale);
  return object;
}

export function resolveLiveSceneObjectCollision(input: Readonly<{
  object: LiveRuntimeSceneObject;
  proposed: WorldTransform;
  walls: readonly RuntimeCollisionWall[];
  mode: SceneCollisionMode;
}>): SceneCollisionResult {
  return resolveSceneObjectCollision({
    current: input.object.realizedTransform,
    proposed: input.proposed,
    localAabb: input.object.localAabb,
    walls: input.walls,
    mode: input.mode,
  });
}

export function serializeRuntimeScene(
  scene: RuntimeSceneCollection,
): SerializedRuntimeScene {
  return {
    objects: [...scene.values()].map((object) => cloneSceneObjectDefinition({
      objectId: object.objectId,
      assetId: object.assetIdentity.id,
      transform: cloneWorldTransform(object.canonicalTransform),
      productId: object.productId,
      variantId: object.variantId,
      userSizeMultiplier: object.userSizeMultiplier,
    })),
  };
}
