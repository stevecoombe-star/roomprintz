import * as THREE from "three";

import {
  CALIBRATED_FLOOR_PLANE_Y,
  SCENE_POSITION_XZ_SAFETY_ABS_M,
  SCENE_ROTATION_EULER_ORDER,
  SCENE_TRANSFORM_LIMITS,
  type ViewportTransformMode,
  type WorldTransform,
} from "./scene-layer-state";

export const SCENE_OBJECT_ID_USERDATA_KEY = "sceneObjectId";
export const SCENE_SELECTION_POINTER_SLOP_PX = 5;

export type SceneObjectRoot = Readonly<{
  placement: THREE.Object3D;
  autoBounds: THREE.Object3D;
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
  mode: ViewportTransformMode,
): "translate" | "rotate" | "scale" {
  if (mode === "move") return "translate";
  return mode;
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

export function pointerRayAgainstHorizontalPlane(input: Readonly<{
  clientX: number;
  clientY: number;
  rect: Readonly<{ left: number; top: number; width: number; height: number }>;
  camera: THREE.Camera;
  planeY: number;
}>): { x: number; y: number; z: number } | null {
  const ndc = pointerEventToNdc(input.clientX, input.clientY, input.rect);
  if (!ndc) return null;
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), input.camera);
  return intersectRayWithHorizontalPlane(raycaster.ray, input.planeY);
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
      -SCENE_POSITION_XZ_SAFETY_ABS_M,
      SCENE_POSITION_XZ_SAFETY_ABS_M,
    ),
    y: input.placementY,
    z: clamp(
      input.hitZ - input.offsetZ,
      -SCENE_POSITION_XZ_SAFETY_ABS_M,
      SCENE_POSITION_XZ_SAFETY_ABS_M,
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

export function parentWorldTransformIsIdentity(object: THREE.Object3D): boolean {
  const parent = object.parent;
  if (!parent) return true;
  parent.updateWorldMatrix(true, false);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  parent.matrixWorld.decompose(position, quaternion, scale);
  return position.lengthSq() < 1e-12 &&
    Math.abs(quaternion.x) < 1e-12 &&
    Math.abs(quaternion.y) < 1e-12 &&
    Math.abs(quaternion.z) < 1e-12 &&
    Math.abs(quaternion.w - 1) < 1e-12 &&
    Math.abs(scale.x - 1) < 1e-12 &&
    Math.abs(scale.y - 1) < 1e-12 &&
    Math.abs(scale.z - 1) < 1e-12;
}

export function enforceNonNegativeWorldY(object: THREE.Object3D): void {
  if (object.position.y < CALIBRATED_FLOOR_PLANE_Y) {
    object.position.y = CALIBRATED_FLOOR_PLANE_Y;
  }
}

export function deriveUniformScaleFromAxes(
  scale: Readonly<{ x: number; y: number; z: number }>,
  previousUniform: number,
): number {
  const axes = [scale.x, scale.y, scale.z]
    .map((value) => Math.abs(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (axes.length === 0) {
    return clamp(
      previousUniform,
      SCENE_TRANSFORM_LIMITS.uniformScale.min,
      SCENE_TRANSFORM_LIMITS.uniformScale.max,
    );
  }
  const diffs = axes.map((value) => Math.abs(value - previousUniform));
  const maxDiff = Math.max(...diffs);
  const chosen = maxDiff < 1e-8
    ? axes[0]
    : axes[diffs.indexOf(maxDiff)] ?? axes[0];
  return clamp(
    chosen,
    SCENE_TRANSFORM_LIMITS.uniformScale.min,
    SCENE_TRANSFORM_LIMITS.uniformScale.max,
  );
}

export function worldTransformFromObject3D(
  object: THREE.Object3D,
): WorldTransform {
  enforceNonNegativeWorldY(object);
  object.rotation.order = SCENE_ROTATION_EULER_ORDER;
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
    uniformScale: deriveUniformScaleFromAxes(object.scale, object.scale.x),
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
    Math.abs(object.scale.x - transform.uniformScale) < 1e-5 &&
    Math.abs(object.scale.y - transform.uniformScale) < 1e-5 &&
    Math.abs(object.scale.z - transform.uniformScale) < 1e-5;
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
