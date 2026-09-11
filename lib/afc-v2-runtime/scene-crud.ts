/**
 * Production scene-object CRUD policy.
 *
 * Operates on serializable SceneObjectDefinition collections. Live Three
 * instantiation is a consumer of these descriptors. This module does not
 * import the AFC engine, providers, Camera, or Lab analysis.
 */

import { aabbIsValid, footprintFromLocalAabb } from "./collision-footprint";
import { posePenetratesWalls, prepareCollisionWall } from "./collision-geometry";
import { furnitureAssetDefinition } from "./furniture-assets";
import { furnitureAssetPlacementAabb } from "./furniture-runtime";
import { realizeObjectWorldTransform } from "./metric-world-realization";
import {
  PI4C_MAX_SCENE_OBJECTS,
  clonePersistedWorldTransform,
  persistenceSafeSceneObjects,
} from "./persisted-scene";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  DEFAULT_WORLD_TRANSFORM,
  type LocalAabb,
  type RuntimeCollisionWall,
  type SceneObjectDefinition,
  type WorldTransform,
} from "./types";

export const PI5A_DUPLICATE_OFFSET_M = Object.freeze({ x: 0.45, z: 0.45 });

export const PI5A_PLACEMENT_SEARCH_STEP_M = 0.4;

export const PI5A_PLACEMENT_SEARCH_RINGS = 5;

export const PI5A_SCENE_AT_CAPACITY_MESSAGE =
  "This scene already has the maximum number of furniture objects.";

export const PI5A_UNKNOWN_ASSET_MESSAGE =
  "That furniture isn't available.";

export const PI5A_MISSING_OBJECT_MESSAGE =
  "Select furniture first.";

export const PI5A_NOT_READY_MESSAGE =
  "Furniture isn't ready yet.";

export const PI5A_INSTANTIATE_FAILED_MESSAGE =
  "Couldn't add furniture.";

export type SceneCrudReason =
  | "unknown_asset"
  | "max_objects"
  | "missing_object"
  | "not_ready"
  | "instantiate_failed";

export type SceneCrudSuccess = Readonly<{
  ok: true;
  objects: readonly SceneObjectDefinition[];
  object: SceneObjectDefinition;
  selectedObjectId: string | null;
}>;

export type SceneCrudFailure = Readonly<{
  ok: false;
  reason: SceneCrudReason;
  message: string;
  objects: readonly SceneObjectDefinition[];
  selectedObjectId: string | null;
}>;

export type SceneCrudResult = SceneCrudSuccess | SceneCrudFailure;

export type ProductionSceneCrudHost = Readonly<{
  addSceneObject: (assetId: string) => SceneCrudResult;
  duplicateSceneObject: (objectId: string) => SceneCrudResult;
  deleteSceneObject: (objectId: string) => SceneCrudResult;
  objectCount: () => number;
  canMutate: () => boolean;
}>;

export type LiveSceneCrudSnapshot = Readonly<{
  objectCount: number;
  selectedObjectId: string | null;
  liveReady: boolean;
}>;

export type ScenePlacementContext = Readonly<{
  metricScale: number;
  realizedWalls: readonly RuntimeCollisionWall[];
  localAabb?: LocalAabb | null;
}>;

function fail(
  reason: SceneCrudReason,
  message: string,
  objects: readonly SceneObjectDefinition[],
  selectedObjectId: string | null,
): SceneCrudFailure {
  return {
    ok: false,
    reason,
    message,
    objects: persistenceSafeSceneObjects(objects),
    selectedObjectId,
  };
}

function randomObjectToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}

export function createSceneObjectId(
  createId: () => string = randomObjectToken,
): string {
  const raw = createId().trim();
  const objectId = raw.startsWith("so-") ? raw : `so-${raw || randomObjectToken()}`;
  return objectId;
}

function allocateObjectId(
  existing: ReadonlySet<string>,
  createId?: () => string,
): string | null {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const objectId = createSceneObjectId(createId);
    if (!existing.has(objectId)) return objectId;
  }
  return null;
}

export function preferredAddCanonicalTransform(): WorldTransform {
  return clonePersistedWorldTransform(DEFAULT_WORLD_TRANSFORM);
}

export function offsetCanonicalTransform(
  transform: WorldTransform,
  offset: Readonly<{ x: number; z: number }>,
): WorldTransform {
  const next = clonePersistedWorldTransform(transform);
  return {
    ...next,
    position: {
      x: next.position.x + offset.x,
      y: next.position.y,
      z: next.position.z + offset.z,
    },
    uniformScale: 1,
  };
}

export function duplicateOffsetCanonicalTransform(
  transform: WorldTransform,
): WorldTransform {
  return offsetCanonicalTransform(transform, PI5A_DUPLICATE_OFFSET_M);
}

export function canonicalPlacementSearchOffsets(): readonly { x: number; z: number }[] {
  const offsets: { x: number; z: number }[] = [{ x: 0, z: 0 }];
  for (let ring = 1; ring <= PI5A_PLACEMENT_SEARCH_RINGS; ring += 1) {
    const distance = ring * PI5A_PLACEMENT_SEARCH_STEP_M;
    offsets.push(
      { x: distance, z: 0 },
      { x: -distance, z: 0 },
      { x: 0, z: distance },
      { x: 0, z: -distance },
      { x: distance, z: distance },
      { x: -distance, z: distance },
      { x: distance, z: -distance },
      { x: -distance, z: -distance },
    );
  }
  return offsets;
}

export function realizedTransformPenetratesWalls(input: Readonly<{
  realized: WorldTransform;
  localAabb: LocalAabb | null | undefined;
  realizedWalls: readonly RuntimeCollisionWall[];
}>): boolean {
  if (!aabbIsValid(input.localAabb) || input.realizedWalls.length === 0) {
    return false;
  }
  const prepared = input.realizedWalls
    .map(prepareCollisionWall)
    .filter((wall): wall is NonNullable<typeof wall> => wall !== null);
  if (prepared.length === 0) return false;
  return posePenetratesWalls(
    footprintFromLocalAabb(input.localAabb, input.realized),
    prepared,
  );
}

export function resolveCollisionFreeCanonicalTransform(input: Readonly<{
  preferredCanonical: WorldTransform;
  metricScale: number;
  realizedWalls: readonly RuntimeCollisionWall[];
  localAabb: LocalAabb | null | undefined;
  offsets?: readonly { x: number; z: number }[];
}>): WorldTransform {
  const preferred = {
    ...clonePersistedWorldTransform(input.preferredCanonical),
    uniformScale: 1,
  };
  const offsets = input.offsets ?? canonicalPlacementSearchOffsets();
  if (!aabbIsValid(input.localAabb) || input.realizedWalls.length === 0) {
    return preferred;
  }
  for (const offset of offsets) {
    const canonical = offsetCanonicalTransform(preferred, offset);
    const realized = realizeObjectWorldTransform(canonical, input.metricScale);
    if (
      !realizedTransformPenetratesWalls({
        realized,
        localAabb: input.localAabb,
        realizedWalls: input.realizedWalls,
      })
    ) {
      return canonical;
    }
  }
  return preferred;
}

function placementAabbForAsset(
  assetId: string,
  override?: LocalAabb | null,
): LocalAabb | null {
  if (override) return override;
  return furnitureAssetPlacementAabb(assetId);
}

function createCanonicalDescriptor(input: Readonly<{
  objectId: string;
  assetId: string;
  transform: WorldTransform;
}>): SceneObjectDefinition {
  return {
    objectId: input.objectId,
    assetId: input.assetId,
    transform: {
      ...clonePersistedWorldTransform(input.transform),
      uniformScale: 1,
    },
  };
}

export function addSceneObject(input: Readonly<{
  objects: readonly SceneObjectDefinition[];
  assetId: string;
  placement?: ScenePlacementContext;
  createObjectId?: () => string;
  selectedObjectId?: string | null;
}>): SceneCrudResult {
  const current = persistenceSafeSceneObjects(input.objects);
  const selectedObjectId = input.selectedObjectId ?? null;
  const asset = furnitureAssetDefinition(input.assetId);
  if (!asset) {
    return fail("unknown_asset", PI5A_UNKNOWN_ASSET_MESSAGE, current, selectedObjectId);
  }
  if (current.length >= PI4C_MAX_SCENE_OBJECTS) {
    return fail("max_objects", PI5A_SCENE_AT_CAPACITY_MESSAGE, current, selectedObjectId);
  }
  const objectId = allocateObjectId(
    new Set(current.map((object) => object.objectId)),
    input.createObjectId,
  );
  if (!objectId) {
    return fail("instantiate_failed", PI5A_INSTANTIATE_FAILED_MESSAGE, current, selectedObjectId);
  }
  const metricScale = input.placement?.metricScale ?? 1;
  const transform = resolveCollisionFreeCanonicalTransform({
    preferredCanonical: preferredAddCanonicalTransform(),
    metricScale,
    realizedWalls: input.placement?.realizedWalls ?? [],
    localAabb: placementAabbForAsset(asset.assetId, input.placement?.localAabb),
  });
  const object = createCanonicalDescriptor({
    objectId,
    assetId: asset.assetId,
    transform,
  });
  const objects = [...current, object];
  return {
    ok: true,
    objects,
    object,
    selectedObjectId: object.objectId,
  };
}

export function deleteSceneObject(input: Readonly<{
  objects: readonly SceneObjectDefinition[];
  objectId: string;
  selectedObjectId?: string | null;
}>): SceneCrudResult {
  const current = persistenceSafeSceneObjects(input.objects);
  const selectedObjectId = input.selectedObjectId ?? null;
  const index = current.findIndex((object) => object.objectId === input.objectId);
  if (index < 0) {
    return fail("missing_object", PI5A_MISSING_OBJECT_MESSAGE, current, selectedObjectId);
  }
  const removed = current[index];
  const objects = current.filter((object) => object.objectId !== input.objectId);
  return {
    ok: true,
    objects,
    object: removed,
    selectedObjectId: selectedObjectId === input.objectId ? null : selectedObjectId,
  };
}

export function duplicateSceneObject(input: Readonly<{
  objects: readonly SceneObjectDefinition[];
  objectId: string;
  placement?: ScenePlacementContext;
  createObjectId?: () => string;
  selectedObjectId?: string | null;
}>): SceneCrudResult {
  const current = persistenceSafeSceneObjects(input.objects);
  const selectedObjectId = input.selectedObjectId ?? null;
  const source = current.find((object) => object.objectId === input.objectId);
  if (!source) {
    return fail("missing_object", PI5A_MISSING_OBJECT_MESSAGE, current, selectedObjectId);
  }
  const asset = furnitureAssetDefinition(source.assetId);
  if (!asset) {
    return fail("unknown_asset", PI5A_UNKNOWN_ASSET_MESSAGE, current, selectedObjectId);
  }
  if (current.length >= PI4C_MAX_SCENE_OBJECTS) {
    return fail("max_objects", PI5A_SCENE_AT_CAPACITY_MESSAGE, current, selectedObjectId);
  }
  const objectId = allocateObjectId(
    new Set(current.map((object) => object.objectId)),
    input.createObjectId,
  );
  if (!objectId) {
    return fail("instantiate_failed", PI5A_INSTANTIATE_FAILED_MESSAGE, current, selectedObjectId);
  }
  const metricScale = input.placement?.metricScale ?? 1;
  const transform = resolveCollisionFreeCanonicalTransform({
    preferredCanonical: duplicateOffsetCanonicalTransform(source.transform),
    metricScale,
    realizedWalls: input.placement?.realizedWalls ?? [],
    localAabb: placementAabbForAsset(asset.assetId, input.placement?.localAabb),
  });
  const object = createCanonicalDescriptor({
    objectId,
    assetId: asset.assetId,
    transform,
  });
  return {
    ok: true,
    objects: [...current, object],
    object,
    selectedObjectId: object.objectId,
  };
}

export function sceneObjectCoordinateSpace(): typeof AFC_V2_RUNTIME_COORDINATE_SPACE {
  return AFC_V2_RUNTIME_COORDINATE_SPACE;
}
