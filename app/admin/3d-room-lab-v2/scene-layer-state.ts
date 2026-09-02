/**
 * V2-S3E Object Scene Layer state.
 *
 * Downstream of frozen Floor/Camera authority. Reducers never accept camera
 * pose, FOV, freeze receipts, Floor polygons, or EMPTY room observation.
 * Transforms are not clamped to the cyan Floor quad.
 *
 * World Y is independently bounded by the infinite calibrated floor plane
 * at Y = 0. That is not room-footprint collision (V2-S4).
 *
 * X/Z are not bounded by SCENE_TRANSFORM_LIMITS. Those historical min/max
 * values are not runtime movement authority. Live slider ranges are derived
 * at view time from the current Floor rectangle and active collision walls.
 * Runtime X/Z is limited only by SCENE_POSITION_XZ_SAFETY_ABS_M (sanity),
 * active collision walls, and the floor plane.
 */

export const DEFAULT_SHOW_FLOOR_QUAD = true;
export const DEFAULT_SHOW_WALL_BOUNDARY = true;
export const DEFAULT_SHOW_COLLISION_BOUNDARY = true;
export const DEFAULT_VIEWPORT_TRANSFORM_MODE = "move" as const;
export const SCENE_ROTATION_EULER_ORDER = "XYZ" as const;
export const CALIBRATED_FLOOR_PLANE_Y = 0;

/**
 * Far sanity bound for stored X/Z so non-finite or exploded values cannot
 * enter scene state. Not a room sandbox wall and not UI slider range.
 */
export const SCENE_POSITION_XZ_SAFETY_ABS_M = 500;

export type ViewportTransformMode = "move" | "rotate" | "scale";

export const TEST_CUBE_GEOMETRY_SIZE = 0.8;
export const TEST_CUBE_COLOR = "#34d399";

export const SCENE_TRANSFORM_LIMITS = {
  /**
   * Historical X sandbox. Not applied as runtime movement law.
   * UI X range is derived live; runtime X uses SCENE_POSITION_XZ_SAFETY_ABS_M.
   */
  positionX: { min: -5, max: 5, step: 0.01 },
  positionY: { min: CALIBRATED_FLOOR_PLANE_Y, max: 5, step: 0.01 },
  /**
   * Historical Z sandbox. Not applied as runtime movement law.
   * UI Z range is derived live; runtime Z uses SCENE_POSITION_XZ_SAFETY_ABS_M.
   */
  positionZ: { min: -10, max: 10, step: 0.01 },
  rotationDeg: { min: -180, max: 180, step: 1 },
  uniformScale: { min: 0.1, max: 4, step: 0.01 },
} as const;

export type WorldTransform = Readonly<{
  position: Readonly<{ x: number; y: number; z: number }>;
  rotationDeg: Readonly<{ x: number; y: number; z: number }>;
  uniformScale: number;
}>;

export type SceneObjectKind = "test_cube" | "glb";

export type SceneObjectLoadStatus =
  | "ready"
  | "loading"
  | "loaded"
  | "failed";

export type SceneObjectRecord = Readonly<{
  id: string;
  kind: SceneObjectKind;
  label: string;
  transform: WorldTransform;
  initialTransform: WorldTransform;
  objectUrl: string | null;
  loadStatus: SceneObjectLoadStatus;
  loadError: string | null;
}>;

export type SceneLayerState = Readonly<{
  objects: readonly SceneObjectRecord[];
  selectedObjectId: string | null;
  transformMode: ViewportTransformMode;
  nextSerial: number;
}>;

export const DEFAULT_WORLD_TRANSFORM: WorldTransform = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotationDeg: Object.freeze({ x: 0, y: 0, z: 0 }),
  uniformScale: 1,
});

export function createInitialSceneLayerState(): SceneLayerState {
  return {
    objects: [],
    selectedObjectId: null,
    transformMode: DEFAULT_VIEWPORT_TRANSFORM_MODE,
    nextSerial: 1,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampPositionXZ(value: number): number {
  return clamp(
    value,
    -SCENE_POSITION_XZ_SAFETY_ABS_M,
    SCENE_POSITION_XZ_SAFETY_ABS_M,
  );
}

function finiteOrUnchanged(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function getSelectedSceneObject(
  state: SceneLayerState,
): SceneObjectRecord | null {
  if (!state.selectedObjectId) return null;
  return state.objects.find((object) => object.id === state.selectedObjectId) ??
    null;
}

export function sceneObjectBlobUrls(
  state: SceneLayerState,
): readonly string[] {
  return state.objects
    .map((object) => object.objectUrl)
    .filter((url): url is string => isOwnedBlobUrl(url));
}

export function isOwnedBlobUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && url.startsWith("blob:");
}

export function blobUrlOwnedSolelyByObject(
  state: SceneLayerState,
  object: SceneObjectRecord,
): string | null {
  if (!isOwnedBlobUrl(object.objectUrl)) return null;
  const shared = state.objects.some(
    (item) => item.id !== object.id && item.objectUrl === object.objectUrl,
  );
  return shared ? null : object.objectUrl;
}

export function addTestCube(state: SceneLayerState): SceneLayerState {
  const serial = state.nextSerial;
  const id = `test-cube-${serial}`;
  const record: SceneObjectRecord = {
    id,
    kind: "test_cube",
    label: `Test Cube ${serial}`,
    transform: DEFAULT_WORLD_TRANSFORM,
    initialTransform: DEFAULT_WORLD_TRANSFORM,
    objectUrl: null,
    loadStatus: "ready",
    loadError: null,
  };
  return {
    objects: [...state.objects, record],
    selectedObjectId: id,
    transformMode: state.transformMode,
    nextSerial: serial + 1,
  };
}

export function addGlbModel(
  state: SceneLayerState,
  input: Readonly<{ objectUrl: string; fileName: string }>,
): SceneLayerState {
  const serial = state.nextSerial;
  const id = `glb-${serial}`;
  const trimmedName = input.fileName.trim() || "GLB Model";
  const record: SceneObjectRecord = {
    id,
    kind: "glb",
    label: trimmedName,
    transform: DEFAULT_WORLD_TRANSFORM,
    initialTransform: DEFAULT_WORLD_TRANSFORM,
    objectUrl: input.objectUrl,
    loadStatus: "loading",
    loadError: null,
  };
  return {
    objects: [...state.objects, record],
    selectedObjectId: id,
    transformMode: state.transformMode,
    nextSerial: serial + 1,
  };
}

export function selectSceneObject(
  state: SceneLayerState,
  objectId: string | null,
): SceneLayerState {
  if (objectId === null) {
    return { ...state, selectedObjectId: null };
  }
  if (!state.objects.some((object) => object.id === objectId)) return state;
  return { ...state, selectedObjectId: objectId };
}

export function setViewportTransformMode(
  state: SceneLayerState,
  transformMode: ViewportTransformMode,
): SceneLayerState {
  if (transformMode === state.transformMode) return state;
  return { ...state, transformMode };
}

export function setSceneObjectLoadStatus(
  state: SceneLayerState,
  objectId: string,
  loadStatus: SceneObjectLoadStatus,
  loadError: string | null = null,
): SceneLayerState {
  return {
    ...state,
    objects: state.objects.map((object) =>
      object.id === objectId
        ? { ...object, loadStatus, loadError }
        : object
    ),
  };
}

export function updateSelectedPositionAxis(
  state: SceneLayerState,
  axis: "x" | "y" | "z",
  value: number,
): SceneLayerState {
  const selected = getSelectedSceneObject(state);
  if (!selected || !Number.isFinite(value)) return state;
  const nextValue = axis === "y"
    ? clamp(
      value,
      SCENE_TRANSFORM_LIMITS.positionY.min,
      SCENE_TRANSFORM_LIMITS.positionY.max,
    )
    : clampPositionXZ(value);
  return patchSelectedTransform(state, {
    ...selected.transform,
    position: {
      ...selected.transform.position,
      [axis]: nextValue,
    },
  });
}

export function updateSelectedRotationAxis(
  state: SceneLayerState,
  axis: "x" | "y" | "z",
  value: number,
): SceneLayerState {
  const selected = getSelectedSceneObject(state);
  if (!selected || !Number.isFinite(value)) return state;
  const nextValue = clamp(
    value,
    SCENE_TRANSFORM_LIMITS.rotationDeg.min,
    SCENE_TRANSFORM_LIMITS.rotationDeg.max,
  );
  return patchSelectedTransform(state, {
    ...selected.transform,
    rotationDeg: {
      ...selected.transform.rotationDeg,
      [axis]: nextValue,
    },
  });
}

export function updateSelectedUniformScale(
  state: SceneLayerState,
  value: number,
): SceneLayerState {
  const selected = getSelectedSceneObject(state);
  if (!selected || !Number.isFinite(value)) return state;
  return patchSelectedTransform(state, {
    ...selected.transform,
    uniformScale: clamp(
      finiteOrUnchanged(value, selected.transform.uniformScale),
      SCENE_TRANSFORM_LIMITS.uniformScale.min,
      SCENE_TRANSFORM_LIMITS.uniformScale.max,
    ),
  });
}

export function applyObjectWorldTransform(
  state: SceneLayerState,
  objectId: string,
  transform: WorldTransform,
): SceneLayerState {
  if (!state.objects.some((object) => object.id === objectId)) return state;
  const nextTransform = clampWorldTransform(transform);
  return {
    ...state,
    objects: state.objects.map((object) =>
      object.id === objectId ? { ...object, transform: nextTransform } : object
    ),
  };
}

export function resetSceneObjectTransform(
  state: SceneLayerState,
  objectId: string | null = state.selectedObjectId,
): SceneLayerState {
  if (!objectId) return state;
  const object = state.objects.find((item) => item.id === objectId);
  if (!object) return state;
  const nextTransform = clampWorldTransform(object.initialTransform);
  if (worldTransformsEqual(object.transform, nextTransform)) return state;
  return {
    ...state,
    objects: state.objects.map((item) =>
      item.id === objectId ? { ...item, transform: nextTransform } : item
    ),
  };
}

export function deleteSceneObject(
  state: SceneLayerState,
  objectId: string,
): SceneLayerState {
  if (!state.objects.some((object) => object.id === objectId)) return state;
  return {
    ...state,
    objects: state.objects.filter((object) => object.id !== objectId),
    selectedObjectId: state.selectedObjectId === objectId
      ? null
      : state.selectedObjectId,
  };
}

export function deleteSelectedSceneObject(
  state: SceneLayerState,
): SceneLayerState {
  if (!state.selectedObjectId) return state;
  return deleteSceneObject(state, state.selectedObjectId);
}

function clampWorldTransform(transform: WorldTransform): WorldTransform {
  return {
    position: {
      x: clampPositionXZ(finiteOrUnchanged(transform.position.x, 0)),
      y: clamp(
        finiteOrUnchanged(transform.position.y, 0),
        SCENE_TRANSFORM_LIMITS.positionY.min,
        SCENE_TRANSFORM_LIMITS.positionY.max,
      ),
      z: clampPositionXZ(finiteOrUnchanged(transform.position.z, 0)),
    },
    rotationDeg: {
      x: clamp(
        finiteOrUnchanged(transform.rotationDeg.x, 0),
        SCENE_TRANSFORM_LIMITS.rotationDeg.min,
        SCENE_TRANSFORM_LIMITS.rotationDeg.max,
      ),
      y: clamp(
        finiteOrUnchanged(transform.rotationDeg.y, 0),
        SCENE_TRANSFORM_LIMITS.rotationDeg.min,
        SCENE_TRANSFORM_LIMITS.rotationDeg.max,
      ),
      z: clamp(
        finiteOrUnchanged(transform.rotationDeg.z, 0),
        SCENE_TRANSFORM_LIMITS.rotationDeg.min,
        SCENE_TRANSFORM_LIMITS.rotationDeg.max,
      ),
    },
    uniformScale: clamp(
      finiteOrUnchanged(transform.uniformScale, 1),
      SCENE_TRANSFORM_LIMITS.uniformScale.min,
      SCENE_TRANSFORM_LIMITS.uniformScale.max,
    ),
  };
}

function patchSelectedTransform(
  state: SceneLayerState,
  transform: WorldTransform,
): SceneLayerState {
  if (!state.selectedObjectId) return state;
  const nextTransform = clampWorldTransform(transform);
  return {
    ...state,
    objects: state.objects.map((object) =>
      object.id === state.selectedObjectId
        ? { ...object, transform: nextTransform }
        : object
    ),
  };
}

function worldTransformsEqual(
  left: WorldTransform,
  right: WorldTransform,
): boolean {
  return left.position.x === right.position.x &&
    left.position.y === right.position.y &&
    left.position.z === right.position.z &&
    left.rotationDeg.x === right.rotationDeg.x &&
    left.rotationDeg.y === right.rotationDeg.y &&
    left.rotationDeg.z === right.rotationDeg.z &&
    left.uniformScale === right.uniformScale;
}
