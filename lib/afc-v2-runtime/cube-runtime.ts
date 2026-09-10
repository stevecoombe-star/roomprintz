/**
 * PI-3A 1 m cube runtime object.
 *
 * Geometry is THREE.BoxGeometry(1, 1, 1) with object scale 1.
 * Floor contact uses import-placement offset so world minY ≈ 0.
 * Transforms are canonical AFC-world; they are not migrated across generations.
 */

import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";

import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  AFC_V2_RUNTIME_CUBE_ASSET_ID,
  AFC_V2_RUNTIME_CUBE_OBJECT_ID,
  DEFAULT_WORLD_TRANSFORM,
  type RuntimeSceneObject,
} from "./types";

export function createPi3aCubeObject(input: Readonly<{
  roomId: string;
  generationId: string;
}>): RuntimeSceneObject {
  return Object.freeze({
    roomId: input.roomId,
    generationId: input.generationId,
    objectId: AFC_V2_RUNTIME_CUBE_OBJECT_ID,
    assetIdentity: Object.freeze({
      kind: "test_cube" as const,
      id: AFC_V2_RUNTIME_CUBE_ASSET_ID,
    }),
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    transform: DEFAULT_WORLD_TRANSFORM,
  });
}

export function createPi3aCubeObjectFromAuthority(
  roomId: string,
  authority: AfcV2ProductionRoomAuthority,
): RuntimeSceneObject {
  return createPi3aCubeObject({
    roomId,
    generationId: authority.generationId,
  });
}

export function cubeBelongsToGeneration(
  object: RuntimeSceneObject,
  generationId: string,
): boolean {
  return object.generationId === generationId &&
    object.objectId === AFC_V2_RUNTIME_CUBE_OBJECT_ID;
}
