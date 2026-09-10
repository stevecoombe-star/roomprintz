/**
 * PI-4A real furniture runtime object.
 *
 * Geometry is the authored test sofa GLB. Import-placement grounds the
 * asset (minY ≈ 0) without changing authored scale. Transforms are
 * canonical AFC-world. PI-4A does not persist them.
 */

import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";

import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  AFC_V2_RUNTIME_FURNITURE_OBJECT_ID,
  DEFAULT_WORLD_TRANSFORM,
  type LocalAabb,
  type RuntimeSceneObject,
} from "./types";

export const PI4A_FURNITURE_LOADING_MESSAGE = "Loading furniture…";

export const PI4A_SOFA_PLACEMENT_LOCAL_AABB: LocalAabb = Object.freeze({
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

export function pi4aFurnitureGlbPublicPath(): string {
  return AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH;
}
