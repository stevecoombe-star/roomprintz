/**
 * Persistence-safe 3D scene contract.
 *
 * Live Three.js objects are never part of this record. Canonical
 * WorldTransform values are the portable AFC-world representation.
 *
 * PI-4C stores one mutable scene row per History version. PI-4D may
 * copy a parent's persisted scene into a child version once when the
 * child has no row. After that copy the child is independent PI-4C
 * state. This module does not live-sync parent and child.
 */

import {
  AFC_V2_RUNTIME_COORDINATE_SPACE,
  type SceneObjectDefinition,
  type SerializedRuntimeScene,
  type WorldTransform,
} from "./types";

export const PI4C_DEFAULT_SCENE_POLICY =
  "initialize-default-persist-on-first-commit" as const;

export const PI4C_SCENE_TABLE = "vibode_3d_scenes";

export const PI4C_MAX_SCENE_OBJECTS = 32;

export const PI4C_MAX_OBJECT_ID_LENGTH = 128;

export const PI4C_MAX_ASSET_ID_LENGTH = 256;

export type PersistedSceneIdentity = Readonly<{
  roomId: string;
  versionId: string;
  afcGenerationId: string;
}>;

export type PersistedVersionScene = Readonly<{
  roomId: string;
  versionId: string;
  afcGenerationId: string;
  coordinateSpace: typeof AFC_V2_RUNTIME_COORDINATE_SPACE;
  objects: readonly SceneObjectDefinition[];
}>;

export type SceneCompatibilityResult =
  | Readonly<{ ok: true }>
  | Readonly<{
      ok: false;
      reason: "afc_generation_mismatch";
      storedAfcGenerationId: string;
      currentAfcGenerationId: string;
    }>;

export type SceneValidationFailure = Readonly<{
  ok: false;
  reason: string;
}>;

export type SceneObjectValidationResult =
  | Readonly<{ ok: true; objects: SceneObjectDefinition[] }>
  | SceneValidationFailure;

export type PersistedSceneValidationResult =
  | Readonly<{ ok: true; scene: PersistedVersionScene }>
  | SceneValidationFailure;

export type Owned3dSceneContext = Readonly<{
  userId: string;
  roomId: string;
  versionId: string;
  afcGenerationId: string;
}>;

export type Owned3dSceneAuthorization =
  | Readonly<{ ok: true; context: Owned3dSceneContext }>
  | Readonly<{ ok: false; status: 400 | 401 | 404 | 500; error: string }>;

const OBJECT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function clonePersistedWorldTransform(
  transform: WorldTransform,
): WorldTransform {
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

export function cloneSceneObjectDefinition(
  object: SceneObjectDefinition,
): SceneObjectDefinition {
  return {
    objectId: object.objectId,
    assetId: object.assetId,
    transform: clonePersistedWorldTransform(object.transform),
  };
}

export function persistenceSafeSceneObjects(
  objects: readonly SceneObjectDefinition[],
): SceneObjectDefinition[] {
  return objects.map(cloneSceneObjectDefinition);
}

export function sceneIdentityKey(
  identity: PersistedSceneIdentity,
): string {
  return `${identity.roomId}::${identity.versionId}::${identity.afcGenerationId}`;
}

export function sceneIdentitiesEqual(
  left: PersistedSceneIdentity | null | undefined,
  right: PersistedSceneIdentity | null | undefined,
): boolean {
  if (!left || !right) return false;
  return sceneIdentityKey(left) === sceneIdentityKey(right);
}

export function createSceneInstanceId(
  identity: PersistedSceneIdentity,
): string {
  return sceneIdentityKey(identity);
}

export function createLoadedSceneInstanceId(
  identity: PersistedSceneIdentity,
  loadRevision: number,
): string {
  return `${sceneIdentityKey(identity)}::load-${loadRevision}`;
}

export function nextLoadedSnapshotRevision(current: number): number {
  return current + 1;
}

export function pendingSceneInstanceId(
  identity: PersistedSceneIdentity,
): string {
  return `${sceneIdentityKey(identity)}::pending`;
}

export function validatePersistedWorldTransform(
  value: unknown,
): { ok: true; transform: WorldTransform } | SceneValidationFailure {
  if (!isRecord(value)) {
    return { ok: false, reason: "transform must be an object." };
  }
  const position = value.position;
  const rotationDeg = value.rotationDeg;
  if (!isRecord(position) || !isRecord(rotationDeg)) {
    return { ok: false, reason: "transform position and rotationDeg are required." };
  }
  if (
    !isFiniteNumber(position.x) ||
    !isFiniteNumber(position.y) ||
    !isFiniteNumber(position.z)
  ) {
    return { ok: false, reason: "transform position must be finite x/y/z." };
  }
  if (
    !isFiniteNumber(rotationDeg.x) ||
    !isFiniteNumber(rotationDeg.y) ||
    !isFiniteNumber(rotationDeg.z)
  ) {
    return { ok: false, reason: "transform rotationDeg must be finite x/y/z." };
  }
  if (value.uniformScale !== 1) {
    return { ok: false, reason: "transform uniformScale must be 1." };
  }
  if (
    value.coordinateSpace != null &&
    value.coordinateSpace !== AFC_V2_RUNTIME_COORDINATE_SPACE
  ) {
    return { ok: false, reason: "unexpected transform coordinate space." };
  }
  return {
    ok: true,
    transform: {
      position: { x: position.x, y: position.y, z: position.z },
      rotationDeg: {
        x: rotationDeg.x,
        y: rotationDeg.y,
        z: rotationDeg.z,
      },
      uniformScale: 1,
    },
  };
}

function validateObjectId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const objectId = value.trim();
  if (
    objectId.length === 0 ||
    objectId.length > PI4C_MAX_OBJECT_ID_LENGTH ||
    !OBJECT_ID_PATTERN.test(objectId)
  ) {
    return null;
  }
  return objectId;
}

function validateAssetId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const assetId = value.trim();
  if (assetId.length === 0 || assetId.length > PI4C_MAX_ASSET_ID_LENGTH) {
    return null;
  }
  return assetId;
}

export function validatePersistedSceneObjects(
  value: unknown,
): SceneObjectValidationResult {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "objects must be an array." };
  }
  if (value.length > PI4C_MAX_SCENE_OBJECTS) {
    return { ok: false, reason: "too many scene objects." };
  }
  const objects: SceneObjectDefinition[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      return { ok: false, reason: "scene object must be an object." };
    }
    const objectId = validateObjectId(item.objectId);
    const assetId = validateAssetId(item.assetId);
    if (!objectId) {
      return { ok: false, reason: "objectId is invalid." };
    }
    if (!assetId) {
      return { ok: false, reason: "assetId is invalid." };
    }
    if (seen.has(objectId)) {
      return { ok: false, reason: "objectId must be unique in a scene." };
    }
    if (
      "placement" in item ||
      "importPlacement" in item ||
      "localAabb" in item ||
      "matrixWorld" in item
    ) {
      return { ok: false, reason: "scene object includes non-portable runtime fields." };
    }
    const transform = validatePersistedWorldTransform(item.transform);
    if (!transform.ok) return transform;
    seen.add(objectId);
    objects.push({
      objectId,
      assetId,
      transform: transform.transform,
    });
  }
  return { ok: true, objects };
}

export function validatePersistedVersionScene(
  value: unknown,
): PersistedSceneValidationResult {
  if (!isRecord(value)) {
    return { ok: false, reason: "scene payload must be an object." };
  }
  const roomId = typeof value.roomId === "string" ? value.roomId.trim() : "";
  const versionId = typeof value.versionId === "string" ? value.versionId.trim() : "";
  const afcGenerationId = typeof value.afcGenerationId === "string"
    ? value.afcGenerationId.trim()
    : "";
  if (!roomId || !versionId || !afcGenerationId) {
    return { ok: false, reason: "roomId, versionId, and afcGenerationId are required." };
  }
  if (
    value.coordinateSpace != null &&
    value.coordinateSpace !== AFC_V2_RUNTIME_COORDINATE_SPACE
  ) {
    return { ok: false, reason: "unexpected scene coordinate space." };
  }
  const objects = validatePersistedSceneObjects(value.objects);
  if (!objects.ok) return objects;
  return {
    ok: true,
    scene: {
      roomId,
      versionId,
      afcGenerationId,
      coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
      objects: objects.objects,
    },
  };
}

export function toPersistedVersionScene(
  identity: PersistedSceneIdentity,
  serialized: SerializedRuntimeScene,
): PersistedVersionScene {
  return {
    roomId: identity.roomId,
    versionId: identity.versionId,
    afcGenerationId: identity.afcGenerationId,
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    objects: persistenceSafeSceneObjects(serialized.objects),
  };
}

export function createInheritedChildScene(input: Readonly<{
  parentScene: PersistedVersionScene;
  childRoomId: string;
  childVersionId: string;
  currentAfcGenerationId: string;
}>): PersistedSceneValidationResult {
  return validatePersistedVersionScene({
    roomId: input.childRoomId,
    versionId: input.childVersionId,
    afcGenerationId: input.currentAfcGenerationId,
    coordinateSpace: AFC_V2_RUNTIME_COORDINATE_SPACE,
    objects: persistenceSafeSceneObjects(input.parentScene.objects),
  });
}

export function resolvePersistedSceneCompatibility(input: Readonly<{
  storedAfcGenerationId: string;
  currentAfcGenerationId: string;
}>): SceneCompatibilityResult {
  if (input.storedAfcGenerationId === input.currentAfcGenerationId) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "afc_generation_mismatch",
    storedAfcGenerationId: input.storedAfcGenerationId,
    currentAfcGenerationId: input.currentAfcGenerationId,
  };
}

export function shouldReplaceLiveScene(input: Readonly<{
  appliedInstanceId: string | null;
  nextInstanceId: string;
  appliedObjectIds: readonly string[];
  nextObjectIds: readonly string[];
}>): boolean {
  if (input.appliedInstanceId !== input.nextInstanceId) return true;
  if (input.appliedObjectIds.length === 0 && input.nextObjectIds.length > 0) {
    return true;
  }
  if (input.appliedObjectIds.length > 0 && input.nextObjectIds.length === 0) {
    return true;
  }
  if (input.appliedObjectIds.length !== input.nextObjectIds.length) return true;
  for (let index = 0; index < input.nextObjectIds.length; index += 1) {
    if (input.appliedObjectIds[index] !== input.nextObjectIds[index]) return true;
  }
  return false;
}

export function liveSceneObjectIds(
  objects: readonly SceneObjectDefinition[],
): string[] {
  return objects.map((object) => object.objectId);
}

export type LiveSceneReconcileAction =
  | "hide"
  | "mount"
  | "replace"
  | "leave-untouched";

export function reconcileLiveScene(input: Readonly<{
  sceneReady: boolean;
  appliedInstanceId: string | null;
  nextInstanceId: string;
  appliedObjectIds: readonly string[];
  nextObjectIds: readonly string[];
}>): LiveSceneReconcileAction {
  if (!input.sceneReady) return "hide";
  if (
    shouldReplaceLiveScene({
      appliedInstanceId: input.appliedInstanceId,
      nextInstanceId: input.nextInstanceId,
      appliedObjectIds: input.appliedObjectIds,
      nextObjectIds: input.nextObjectIds,
    })
  ) {
    return input.appliedInstanceId == null ? "mount" : "replace";
  }
  return "leave-untouched";
}

export type SceneVisitState = Readonly<{
  identity: PersistedSceneIdentity | null;
  objects: readonly SceneObjectDefinition[];
  origin: "default" | "persisted";
  loading: boolean;
  sceneReady: boolean;
  loadRevision: number;
  sceneInstanceId: string;
}>;

export type LiveFurnitureCommit = Readonly<{
  appliedInstanceId: string | null;
  appliedObjectIds: readonly string[];
  objects: readonly SceneObjectDefinition[];
}>;

export function createUnloadedSceneVisit(): SceneVisitState {
  return {
    identity: null,
    objects: [],
    origin: "default",
    loading: false,
    sceneReady: false,
    loadRevision: 0,
    sceneInstanceId: "unloaded",
  };
}

export function createEmptyLiveFurnitureCommit(): LiveFurnitureCommit {
  return {
    appliedInstanceId: null,
    appliedObjectIds: [],
    objects: [],
  };
}

export function beginSceneVisitLoad(
  state: SceneVisitState,
  identity: PersistedSceneIdentity,
): SceneVisitState {
  return {
    ...state,
    identity,
    loading: true,
    sceneReady: false,
    sceneInstanceId: pendingSceneInstanceId(identity),
  };
}

export function completeSceneVisitLoad(
  state: SceneVisitState,
  identity: PersistedSceneIdentity,
  objects: readonly SceneObjectDefinition[],
  origin: "default" | "persisted",
): SceneVisitState {
  const loadRevision = nextLoadedSnapshotRevision(state.loadRevision);
  return {
    identity,
    objects: persistenceSafeSceneObjects(objects),
    origin,
    loading: false,
    sceneReady: true,
    loadRevision,
    sceneInstanceId: createLoadedSceneInstanceId(identity, loadRevision),
  };
}

export function echoSceneVisitCommit(
  state: SceneVisitState,
  objects: readonly SceneObjectDefinition[],
): SceneVisitState {
  return {
    ...state,
    objects: persistenceSafeSceneObjects(objects),
  };
}

export function destroySceneVisit(): SceneVisitState {
  return createUnloadedSceneVisit();
}

export function applyVisitToLiveFurniture(
  live: LiveFurnitureCommit,
  visit: SceneVisitState,
): Readonly<{ live: LiveFurnitureCommit; action: LiveSceneReconcileAction }> {
  const action = reconcileLiveScene({
    sceneReady: visit.sceneReady,
    appliedInstanceId: live.appliedInstanceId,
    nextInstanceId: visit.sceneInstanceId,
    appliedObjectIds: live.appliedObjectIds,
    nextObjectIds: liveSceneObjectIds(visit.objects),
  });
  if (action === "hide" || action === "leave-untouched") {
    return { live, action };
  }
  return {
    action,
    live: {
      appliedInstanceId: visit.sceneInstanceId,
      appliedObjectIds: liveSceneObjectIds(visit.objects),
      objects: persistenceSafeSceneObjects(visit.objects),
    },
  };
}

export function shouldApplySceneRequest(input: Readonly<{
  requestId: number;
  latestRequestId: number;
  requestIdentity: PersistedSceneIdentity;
  currentIdentity: PersistedSceneIdentity | null;
}>): boolean {
  if (input.requestId !== input.latestRequestId) return false;
  return sceneIdentitiesEqual(input.requestIdentity, input.currentIdentity);
}

export function authorizeOwned3dSceneContext(input: Readonly<{
  userId: string | null;
  room: Readonly<{
    id: string;
    userId: string;
    currentAfcGenerationId: string | null;
  }> | null;
  version: Readonly<{
    id: string;
    roomId: string;
    userId: string;
  }> | null;
  generation: Readonly<{
    id: string;
    roomId: string;
    userId: string;
    status: string;
  }> | null;
  requestedRoomId: string;
  requestedVersionId: string;
  requestedAfcGenerationId: string;
}>): Owned3dSceneAuthorization {
  if (!input.userId) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  if (!input.room || input.room.userId !== input.userId || input.room.id !== input.requestedRoomId) {
    return { ok: false, status: 404, error: "Room not found." };
  }
  if (
    !input.version ||
    input.version.id !== input.requestedVersionId ||
    input.version.roomId !== input.requestedRoomId ||
    input.version.userId !== input.userId
  ) {
    return { ok: false, status: 404, error: "Version not found." };
  }
  if (
    !input.generation ||
    input.generation.id !== input.requestedAfcGenerationId ||
    input.generation.roomId !== input.requestedRoomId ||
    input.generation.userId !== input.userId
  ) {
    return { ok: false, status: 404, error: "AFC generation not found." };
  }
  if (input.generation.status !== "ready") {
    return { ok: false, status: 400, error: "AFC generation is not production-ready." };
  }
  if (input.room.currentAfcGenerationId !== input.generation.id) {
    return { ok: false, status: 400, error: "AFC generation is not the room's current spatial authority." };
  }
  return {
    ok: true,
    context: {
      userId: input.userId,
      roomId: input.room.id,
      versionId: input.version.id,
      afcGenerationId: input.generation.id,
    },
  };
}

export type VersionSceneLoadStatus = "ready" | "none" | "incompatible" | "malformed";

export type ResolvedVersionSceneLoad = Readonly<{
  status: VersionSceneLoadStatus;
  origin: "persisted" | "default";
  objects: readonly SceneObjectDefinition[];
  reason: string | null;
  storedAfcGenerationId: string | null;
}>;

export function resolveLoadedVersionScene(input: Readonly<{
  found: boolean;
  currentAfcGenerationId: string;
  stored: PersistedVersionScene | null;
  defaultObjects: readonly SceneObjectDefinition[];
}>): ResolvedVersionSceneLoad {
  if (!input.found || !input.stored) {
    return {
      status: "none",
      origin: "default",
      objects: persistenceSafeSceneObjects(input.defaultObjects),
      reason: null,
      storedAfcGenerationId: null,
    };
  }
  const compatibility = resolvePersistedSceneCompatibility({
    storedAfcGenerationId: input.stored.afcGenerationId,
    currentAfcGenerationId: input.currentAfcGenerationId,
  });
  if (!compatibility.ok) {
    return {
      status: "incompatible",
      origin: "default",
      objects: persistenceSafeSceneObjects(input.defaultObjects),
      reason: "Stored 3D scene belongs to a different AFC generation.",
      storedAfcGenerationId: input.stored.afcGenerationId,
    };
  }
  return {
    status: "ready",
    origin: "persisted",
    objects: persistenceSafeSceneObjects(input.stored.objects),
    reason: null,
    storedAfcGenerationId: input.stored.afcGenerationId,
  };
}

export function reportUnknownPersistedAssets(input: Readonly<{
  definitions: readonly SceneObjectDefinition[];
  knownAssetIds: ReadonlySet<string>;
}>): readonly Readonly<{ objectId: string; assetId: string; reason: "unknown_asset" }>[] {
  return input.definitions
    .filter((definition) => !input.knownAssetIds.has(definition.assetId))
    .map((definition) => ({
      objectId: definition.objectId,
      assetId: definition.assetId,
      reason: "unknown_asset" as const,
    }));
}
