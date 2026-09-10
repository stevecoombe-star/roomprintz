/**
 * Production AFC runtime types.
 *
 * Transforms live in canonical AFC world space:
 *   calibrated-world-xz/v1
 *
 * These records are PI-4-compatible in shape. PI-3A does not persist them.
 */

export const AFC_V2_RUNTIME_COORDINATE_SPACE = "calibrated-world-xz/v1" as const;

export const AFC_V2_RUNTIME_FLOOR_PLANE_Y = 0;

export const AFC_V2_RUNTIME_ROTATION_EULER_ORDER = "XYZ" as const;

export const AFC_V2_RUNTIME_POSITION_XZ_SAFETY_ABS_M = 500;

export const AFC_V2_RUNTIME_CUBE_EDGE_M = 1;

export const AFC_V2_RUNTIME_CUBE_OBJECT_ID = "pi3a-1m-cube" as const;

export const AFC_V2_RUNTIME_CUBE_ASSET_ID = "afc-v2-runtime/test-cube/1m" as const;

export const AFC_V2_RUNTIME_CAMERA_NEAR = 0.1;

export const AFC_V2_RUNTIME_CAMERA_FAR = 100;

export type RuntimeVec2 = Readonly<{ x: number; z: number }>;

export type RuntimeVec3 = Readonly<{ x: number; y: number; z: number }>;

export type RuntimeCollisionWall = Readonly<{
  id: string;
  sourceBoundaryId: string;
  sourceSeamId: string;
  a: RuntimeVec2;
  b: RuntimeVec2;
  supportPlaneNormal: RuntimeVec3;
  supportPlaneConstant: number;
  sideSign: -1 | 1;
}>;

export type WorldTransform = Readonly<{
  position: RuntimeVec3;
  rotationDeg: RuntimeVec3;
  uniformScale: number;
}>;

export type RuntimeTransformMode = "move" | "rotate";

export type RuntimeAssetIdentity = Readonly<{
  kind: "test_cube";
  id: string;
}>;

export type RuntimeSceneObject = Readonly<{
  roomId: string;
  generationId: string;
  objectId: string;
  assetIdentity: RuntimeAssetIdentity;
  coordinateSpace: typeof AFC_V2_RUNTIME_COORDINATE_SPACE;
  transform: WorldTransform;
}>;

export const DEFAULT_WORLD_TRANSFORM: WorldTransform = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotationDeg: Object.freeze({ x: 0, y: 0, z: 0 }),
  uniformScale: 1,
});

export type LocalAabb = Readonly<{
  min: RuntimeVec3;
  max: RuntimeVec3;
}>;

export type CanonicalFloorRectangle = Readonly<{
  worldWidthM: number;
  referenceDepthM: number;
}>;

export type CameraPose = Readonly<{
  position: RuntimeVec3;
  lookAt: RuntimeVec3;
  up: RuntimeVec3;
}>;

export type FrozenCameraSnapshot = Readonly<{
  verticalFovDeg: number;
  pose: CameraPose;
  frame: Readonly<{ width: number; height: number }>;
}>;

export type RealizedFrozenCamera = Readonly<{
  verticalFovDeg: number;
  aspect: number;
  near: number;
  far: number;
  pose: CameraPose;
  frame: Readonly<{ width: number; height: number }>;
}>;
