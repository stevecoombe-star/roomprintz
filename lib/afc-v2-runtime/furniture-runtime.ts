/**
 * Furniture runtime object factories.
 *
 * Geometry is the authored test sofa GLB. Import-placement grounds the
 * asset (minY ≈ 0) without changing authored scale. Transforms are
 * canonical AFC-world. PI-4C persists objectId, assetId, and canonical
 * transform per History version.
 */

import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";

import {
  furnitureAssetDefinition,
  type FurnitureAssetResolver,
} from "./furniture-assets";
import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  AFC_V2_RUNTIME_FURNITURE_OBJECT_ID,
  AFC_V2_RUNTIME_PI4B_SOFA_A_OBJECT_ID,
  AFC_V2_RUNTIME_PI4B_SOFA_B_OBJECT_ID,
  AFC_V2_USER_SIZE_DEFAULT,
  DEFAULT_WORLD_TRANSFORM,
  clampUserSizeMultiplier,
  type LocalAabb,
  type RuntimeSceneObject,
  type SceneObjectDefinition,
  type WorldTransform,
} from "./types";
import { cloneSceneObjectIdentity } from "./persisted-scene";

export const PI4A_FURNITURE_LOADING_MESSAGE = "Loading furniture…";

export function authoredPlacementLocalAabb(input: Readonly<{
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
}>): LocalAabb | null {
  const width = input.authoredWidthM;
  const height = input.authoredHeightM;
  const depth = input.authoredDepthM;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(depth) ||
    width <= 0 ||
    height <= 0 ||
    depth <= 0
  ) {
    return null;
  }
  return Object.freeze({
    min: Object.freeze({ x: -width / 2, y: 0, z: -depth / 2 }),
    max: Object.freeze({ x: width / 2, y: height, z: depth / 2 }),
  });
}

export const PI4A_SOFA_PLACEMENT_LOCAL_AABB: LocalAabb = authoredPlacementLocalAabb({
  authoredWidthM: 2.2,
  authoredHeightM: 0.8,
  authoredDepthM: 0.9,
}) ?? Object.freeze({
  min: Object.freeze({ x: -1.1, y: 0, z: -0.45 }),
  max: Object.freeze({ x: 1.1, y: 0.8, z: 0.45 }),
});

export function createPi4aFurnitureObject(input: Readonly<{
  roomId: string;
  generationId: string;
}>): RuntimeSceneObject {
  return Object.freeze({
    roomId: input.roomId,
    generationId: input.generationId,
    objectId: AFC_V2_RUNTIME_FURNITURE_OBJECT_ID,
    assetIdentity: Object.freeze({
      kind: "test_furniture_glb" as const,
      id: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    }),
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    transform: DEFAULT_WORLD_TRANSFORM,
  });
}

export function createPi4aFurnitureObjectFromAuthority(
  roomId: string,
  authority: AfcV2ProductionRoomAuthority,
): RuntimeSceneObject {
  return createPi4aFurnitureObject({
    roomId,
    generationId: authority.generationId,
  });
}

export function furnitureBelongsToGeneration(
  object: RuntimeSceneObject,
  generationId: string,
): boolean {
  return object.generationId === generationId &&
    object.objectId === AFC_V2_RUNTIME_FURNITURE_OBJECT_ID;
}

export function furnitureAssetPlacementAabb(
  assetId: string,
  resolver: FurnitureAssetResolver = furnitureAssetDefinition,
): LocalAabb | null {
  const asset = resolver(assetId);
  if (!asset) return null;
  return authoredPlacementLocalAabb(asset);
}

export function pi4aFurnitureGlbPublicPath(): string {
  return AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH;
}

export const PI4B_SOFA_A_OBJECT_ID = AFC_V2_RUNTIME_PI4B_SOFA_A_OBJECT_ID;
export const PI4B_SOFA_B_OBJECT_ID = AFC_V2_RUNTIME_PI4B_SOFA_B_OBJECT_ID;
export const PI4B_INITIAL_SELECTED_OBJECT_ID = PI4B_SOFA_A_OBJECT_ID;

export const PI4B_SOFA_A_TRANSFORM: WorldTransform = Object.freeze({
  position: Object.freeze({ x: -1.3, y: 0, z: 0.25 }),
  rotationDeg: Object.freeze({ x: 0, y: 0, z: 0 }),
  uniformScale: 1,
});

export const PI4B_SOFA_B_TRANSFORM: WorldTransform = Object.freeze({
  position: Object.freeze({ x: 1.3, y: 0, z: -0.25 }),
  rotationDeg: Object.freeze({ x: 0, y: 18, z: 0 }),
  uniformScale: 1,
});

export function createPi4bSceneObjectDefinitions(): readonly SceneObjectDefinition[] {
  return Object.freeze([
    Object.freeze({
      objectId: PI4B_SOFA_A_OBJECT_ID,
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      transform: PI4B_SOFA_A_TRANSFORM,
    }),
    Object.freeze({
      objectId: PI4B_SOFA_B_OBJECT_ID,
      assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
      transform: PI4B_SOFA_B_TRANSFORM,
    }),
  ]);
}

export type UnknownSceneAssetSkip = Readonly<{
  objectId: string;
  assetId: string;
  reason: "unknown_asset";
}>;

export type SceneObjectInstantiation = Readonly<{
  objects: RuntimeSceneObject[];
  skipped: readonly UnknownSceneAssetSkip[];
}>;

export function instantiateSceneObjectDefinitions(input: Readonly<{
  roomId: string;
  generationId: string;
  definitions: readonly SceneObjectDefinition[];
  resolver?: FurnitureAssetResolver;
}>): SceneObjectInstantiation {
  const resolve = input.resolver ?? furnitureAssetDefinition;
  const objects: RuntimeSceneObject[] = [];
  const skipped: UnknownSceneAssetSkip[] = [];
  for (const definition of input.definitions) {
    const asset = resolve(definition.assetId);
    if (!asset) {
      skipped.push({
        objectId: definition.objectId,
        assetId: definition.assetId,
        reason: "unknown_asset",
      });
      continue;
    }
    const identity = cloneSceneObjectIdentity({
      productId: definition.productId,
      variantId: definition.variantId,
      userSizeMultiplier: clampUserSizeMultiplier(
        definition.userSizeMultiplier ?? AFC_V2_USER_SIZE_DEFAULT,
      ),
    });
    objects.push(Object.freeze({
      roomId: input.roomId,
      generationId: input.generationId,
      objectId: definition.objectId,
      assetIdentity: Object.freeze({
        kind: "test_furniture_glb" as const,
        id: asset.assetId,
      }),
      coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
      transform: definition.transform,
      ...identity,
    }));
  }
  return { objects, skipped };
}

export function createRuntimeSceneObjectsFromDefinitions(input: Readonly<{
  roomId: string;
  generationId: string;
  definitions: readonly SceneObjectDefinition[];
  resolver?: FurnitureAssetResolver;
}>): RuntimeSceneObject[] {
  return instantiateSceneObjectDefinitions(input).objects;
}

export function createPi4bSceneObjects(input: Readonly<{
  roomId: string;
  generationId: string;
}>): RuntimeSceneObject[] {
  return createRuntimeSceneObjectsFromDefinitions({
    roomId: input.roomId,
    generationId: input.generationId,
    definitions: createPi4bSceneObjectDefinitions(),
  });
}

export function createPi4bSceneObjectsFromAuthority(
  roomId: string,
  authority: AfcV2ProductionRoomAuthority,
): RuntimeSceneObject[] {
  return createPi4bSceneObjects({
    roomId,
    generationId: authority.generationId,
  });
}
