import * as THREE from "three";

import {
  AFC_V2_RUNTIME_FLOOR_PLANE_Y,
  AFC_V2_RUNTIME_POSITION_XZ_SAFETY_ABS_M,
  AFC_V2_RUNTIME_ROTATION_EULER_ORDER,
  type RuntimeTransformMode,
  type WorldTransform,
} from "./types";

export const SCENE_OBJECT_ID_USERDATA_KEY = "sceneObjectId";
export const SCENE_SELECTION_POINTER_SLOP_PX = 5;

export type SceneObjectRoot = Readonly<{
  placement: THREE.Object3D;
  importPlacement: THREE.Object3D;
}>;

export function tagSceneObjectRoot(
  placement: THREE.Object3D,
  sceneObjectId: string,
): void {
  placement.userData[SCENE_OBJECT_ID_USERDATA_KEY] = sceneObjectId;
}

export function resolveSceneObjectId(
  object: THREE.Object3D | null | undefined,
): string | null {
  let current: THREE.Object3D | null | undefined = object;
  while (current) {
    const id = current.userData[SCENE_OBJECT_ID_USERDATA_KEY];
    if (typeof id === "string" && id.length > 0) return id;
    current = current.parent;
  }
  return null;
}

export function pickSceneObjectId(
  intersects: ReadonlyArray<{ object: THREE.Object3D }>,
): string | null {
  for (const hit of intersects) {
    const id = resolveSceneObjectId(hit.object);
    if (id) return id;
  }
  return null;
}

export function transformControlsAttachmentTarget(
  root: SceneObjectRoot,
): THREE.Object3D {
  return root.placement;
}

export function viewportModeToControlsMode(
  mode: RuntimeTransformMode,
): "translate" | "rotate" {
  return mode === "rotate" ? "rotate" : "translate";
}

export function pointerEventToNdc(
  clientX: number,
  clientY: number,
  rect: Readonly<{ left: number; top: number; width: number; height: number }>,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * 2 - 1,
    y: -((clientY - rect.top) / rect.height) * 2 + 1,
  };
}

export function shouldSuppressSceneSelection(input: Readonly<{
  gizmoDragging: boolean;
  pointerDownOnGizmo: boolean;
  pointerMovementPx: number;
  bodyDragging?: boolean;
}>): boolean {
  return input.gizmoDragging ||
    input.pointerDownOnGizmo ||
    input.bodyDragging === true ||
    input.pointerMovementPx > SCENE_SELECTION_POINTER_SLOP_PX;
}

export function shouldBeginObjectBodyDrag(input: Readonly<{
  pointerDownOnGizmo: boolean;
  gizmoDragging: boolean;
  hitObjectId: string | null;
}>): boolean {
  return !input.pointerDownOnGizmo &&
    !input.gizmoDragging &&
    typeof input.hitObjectId === "string" &&
    input.hitObjectId.length > 0;
}

export function shouldActivateObjectBodyDrag(pointerMovementPx: number): boolean {
  return pointerMovementPx > SCENE_SELECTION_POINTER_SLOP_PX;
}

export function intersectRayWithHorizontalPlane(
  ray: THREE.Ray,
  planeY: number,
): { x: number; y: number; z: number } | null {
  if (!Number.isFinite(planeY)) return null;
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
  const target = new THREE.Vector3();
  const hit = ray.intersectPlane(plane, target);
  if (!hit) return null;
  return { x: hit.x, y: planeY, z: hit.z };
}

export function bodyDragGrabOffset(
  hit: Readonly<{ x: number; z: number }>,
  placement: Readonly<{ x: number; z: number }>,
): { offsetX: number; offsetZ: number } {
  return {
    offsetX: hit.x - placement.x,
    offsetZ: hit.z - placement.z,
  };
}

export function objectBodyDragWorldPosition(input: Readonly<{
  hitX: number;
  hitZ: number;
  offsetX: number;
  offsetZ: number;
  placementY: number;
}>): { x: number; y: number; z: number } {
  return {
    x: clamp(
      input.hitX - input.offsetX,
      -AFC_V2_RUNTIME_POSITION_XZ_SAFETY_ABS_M,
      AFC_V2_RUNTIME_POSITION_XZ_SAFETY_ABS_M,
    ),
    y: input.placementY,
    z: clamp(
      input.hitZ - input.offsetZ,
      -AFC_V2_RUNTIME_POSITION_XZ_SAFETY_ABS_M,
      AFC_V2_RUNTIME_POSITION_XZ_SAFETY_ABS_M,
    ),
  };
}

export function worldPositionXZ(object: THREE.Object3D): { x: number; z: number } {
  const world = new THREE.Vector3();
  object.updateWorldMatrix(true, false);
  object.getWorldPosition(world);
  return { x: world.x, z: world.z };
}

export function applyPlacementWorldPosition(
  placement: THREE.Object3D,
  world: Readonly<{ x: number; y: number; z: number }>,
): void {
  const target = new THREE.Vector3(world.x, world.y, world.z);
  if (placement.parent) {
    placement.parent.updateWorldMatrix(true, false);
    placement.parent.worldToLocal(target);
  }
  placement.position.copy(target);
  enforceNonNegativeWorldY(placement);
}

export function enforceNonNegativeWorldY(object: THREE.Object3D): void {
  if (object.position.y < AFC_V2_RUNTIME_FLOOR_PLANE_Y) {
    object.position.y = AFC_V2_RUNTIME_FLOOR_PLANE_Y;
  }
}

export function worldTransformFromObject3D(
  object: THREE.Object3D,
): WorldTransform {
  enforceNonNegativeWorldY(object);
  object.rotation.order = AFC_V2_RUNTIME_ROTATION_EULER_ORDER;
  return {
    position: {
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
    },
    rotationDeg: {
      x: radToDegWrapped(object.rotation.x),
      y: radToDegWrapped(object.rotation.y),
      z: radToDegWrapped(object.rotation.z),
    },
    uniformScale: 1,
  };
}

export function objectMatchesWorldTransform(
  object: THREE.Object3D,
  transform: WorldTransform,
): boolean {
  return Math.abs(object.position.x - transform.position.x) < 1e-5 &&
    Math.abs(object.position.y - transform.position.y) < 1e-5 &&
    Math.abs(object.position.z - transform.position.z) < 1e-5 &&
    Math.abs(
      radToDegWrapped(object.rotation.x) - transform.rotationDeg.x,
    ) < 1e-3 &&
    Math.abs(
      radToDegWrapped(object.rotation.y) - transform.rotationDeg.y,
    ) < 1e-3 &&
    Math.abs(
      radToDegWrapped(object.rotation.z) - transform.rotationDeg.z,
    ) < 1e-3 &&
    Math.abs(object.scale.x - 1) < 1e-5 &&
    Math.abs(object.scale.y - 1) < 1e-5 &&
    Math.abs(object.scale.z - 1) < 1e-5 &&
    Math.abs(transform.uniformScale - 1) < 1e-5;
}

function radToDegWrapped(radians: number): number {
  let degrees = THREE.MathUtils.radToDeg(radians);
  while (degrees > 180) degrees -= 360;
  while (degrees < -180) degrees += 360;
  return degrees;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
