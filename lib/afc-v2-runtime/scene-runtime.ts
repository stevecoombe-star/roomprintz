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
import {
  composeImportAxisScale,
  MODEL_AXIS_SCALE_IDENTITY,
  resolveMountedModelAxisScale,
  type ModelAxisScale,
} from "./model-axis-scale";
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
  /**
   * Floor-contact and XZ-center offset measured at authored scale 1.
   * Effective scale multiplies this offset. Three.js applies translation
   * after scale, so leaving it fixed slides the mesh off the footprint.
   */
  authoredImportOffset: THREE.Vector3;
  /** Variant physical scale. Identity leaves the loaded GLB at its native size. */
  modelAxisScale: ModelAxisScale;
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

function applyEffectiveImportPose(
  importPlacement: THREE.Object3D,
  authoredImportScale: number,
  userSizeMultiplier: number,
  modelAxisScale: ModelAxisScale,
  authoredImportOffset: THREE.Vector3,
): void {
  const composed = composeImportAxisScale(
    authoredImportScale,
    userSizeMultiplier,
    modelAxisScale,
  );
  importPlacement.scale.set(composed.x, composed.y, composed.z);
  importPlacement.position.set(
    authoredImportOffset.x * composed.x,
    authoredImportOffset.y * composed.y,
    authoredImportOffset.z * composed.z,
  );
}

export function mountLiveRuntimeSceneObject(input: Readonly<{
  descriptor: RuntimeSceneObject;
  imported: THREE.Object3D;
  metricScale: number;
  /** Test and caller override. Otherwise the registered Variant lookup is used. */
  modelAxisScale?: ModelAxisScale | null;
}>): LiveRuntimeSceneObject {
  const root = createSceneObjectRoot();
  tagSceneObjectRoot(root.placement, input.descriptor.objectId);
  attachImportedObject(root.importPlacement, input.imported);
  const authoredImportScale = root.importPlacement.scale.x;
  const authoredImportOffset = root.importPlacement.position.clone();
  const userSizeMultiplier = clampUserSizeMultiplier(
    input.descriptor.userSizeMultiplier ?? AFC_V2_USER_SIZE_DEFAULT,
  );
  const modelAxisScale = resolveMountedModelAxisScale({
    assetId: input.descriptor.assetIdentity.id,
    variantId: input.descriptor.variantId,
    explicit: input.modelAxisScale,
  });
  applyEffectiveImportPose(
    root.importPlacement,
    authoredImportScale,
    userSizeMultiplier,
    modelAxisScale,
    authoredImportOffset,
  );
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
    authoredImportOffset,
    modelAxisScale,
  };
}

export function applyLiveUserSizeMultiplier(
  object: LiveRuntimeSceneObject,
  multiplier: number,
): void {
  const next = clampUserSizeMultiplier(multiplier);
  object.userSizeMultiplier = next;
  const modelAxisScale = object.modelAxisScale ?? MODEL_AXIS_SCALE_IDENTITY;
  applyEffectiveImportPose(
    object.importPlacement,
    object.authoredImportScale,
    next,
    modelAxisScale,
    object.authoredImportOffset,
  );
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
