/**
 * Server-built thumbnail render contract.
 *
 * The browser page receives only this payload. It does not accept room
 * ids, storage paths, or caller-chosen asset URLs.
 */

import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";
import { PI4C_MAX_SCENE_OBJECTS } from "@/lib/afc-v2-runtime/persisted-scene";
import {
  AFC_V2_RUNTIME_CAMERA_FAR,
  AFC_V2_RUNTIME_CAMERA_NEAR,
  AFC_V2_USER_SIZE_MAX,
  AFC_V2_USER_SIZE_MIN,
  type SceneObjectDefinition,
} from "@/lib/afc-v2-runtime/types";

import {
  VIBODE_PRODUCTION_AMBIENT_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_POSITION,
} from "./still-renderer";

export const VIBODE_THUMBNAIL_RENDER_SCHEMA_VERSION =
  "vibode-thumbnail-render/v1" as const;

/**
 * Asset URLs and the render access token both live this long.
 *
 * THUMB-2B rendered in about 10–15 seconds. This stage builds the
 * contract immediately before rendering, so 15 minutes covers cold
 * Chromium startup, GLB download, and a few local retries. It matches
 * the THUMB-2A recommendation. Signed URLs are not stored. When a queue
 * exists, mint them when a worker claims the job, not at enqueue time.
 */
export const VIBODE_THUMBNAIL_ASSET_URL_EXPIRES_SEC = 15 * 60;

export const VIBODE_THUMBNAIL_RENDER_TOKEN_EXPIRES_SEC = 15 * 60;

/** Short replay so one page load can fetch the contract twice. */
export const VIBODE_THUMBNAIL_RENDER_TOKEN_REPLAY_MS = 30_000;

export const VIBODE_THUMBNAIL_MAX_FRAME_EDGE_PX = 8192;

export const VIBODE_THUMBNAIL_MAX_FRAME_PIXELS = 16_777_216;

export const VIBODE_THUMBNAIL_RENDER_ERROR_CODES = Object.freeze([
  "render_access_denied",
  "scene_missing",
  "scene_empty",
  "generation_mismatch",
  "background_missing",
  "camera_authority_missing",
  "glb_identity_missing",
  "signed_url_failed",
  "glb_load_failed",
  "render_page_error",
] as const);

export type VibodeThumbnailRenderErrorCode =
  (typeof VIBODE_THUMBNAIL_RENDER_ERROR_CODES)[number];

export type VibodeThumbnailVec3 = Readonly<{
  x: number;
  y: number;
  z: number;
}>;

export type VibodeThumbnailRenderPayload = Readonly<{
  schemaVersion: typeof VIBODE_THUMBNAIL_RENDER_SCHEMA_VERSION;
  job: Readonly<{
    jobId: string;
    contentToken: string;
  }>;
  room: Readonly<{
    roomId: string;
    versionId: string;
    afcGenerationId: string;
  }>;
  frame: Readonly<{
    width: number;
    height: number;
  }>;
  background: Readonly<{
    url: string;
  }>;
  camera: Readonly<{
    verticalFovDeg: number;
    position: VibodeThumbnailVec3;
    lookAt: VibodeThumbnailVec3;
    up: VibodeThumbnailVec3;
    metricScale: number;
    near: number;
    far: number;
  }>;
  objects: readonly VibodeThumbnailRenderObject[];
  lighting: Readonly<{
    ambientIntensity: number;
    directionalIntensity: number;
    directionalPosition: VibodeThumbnailVec3;
  }>;
}>;

export type VibodeThumbnailRenderObject = Readonly<{
  objectId: string;
  assetId: string;
  glbUrl: string;
  position: VibodeThumbnailVec3;
  rotationDeg: VibodeThumbnailVec3;
  userSizeMultiplier: number;
}>;

export type VibodeThumbnailRenderFailure = Readonly<{
  ok: false;
  code: VibodeThumbnailRenderErrorCode;
  message: string;
  retryable: boolean;
}>;

export type VibodeThumbnailRenderReadiness = Readonly<{
  status: "loading" | "ready" | "error";
  jobId: string | null;
  contentToken: string | null;
  objectCount: number;
  timing: Readonly<{
    contractFetchMs: number | null;
    backgroundDecodeMs: number | null;
    glbLoadMs: number | null;
    sceneConstructionMs: number | null;
    firstRenderMs: number | null;
    totalReadinessMs: number | null;
  }>;
  error?: Readonly<{
    code: VibodeThumbnailRenderErrorCode;
    message: string;
  }>;
}>;

export type ThumbnailRenderUrlPolicy = Readonly<{
  supabaseHost: string | null;
}>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONTENT_TOKEN = /^[0-9a-f]{64}$/;

const STATIC_GLB_PATH = /^\/afc-v2-runtime\/[A-Za-z0-9._/-]+\.glb$/;

const VECTOR_EPSILON = 1e-9;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readVec3(value: unknown): VibodeThumbnailVec3 | null {
  if (!isRecord(value)) return null;
  if (!finite(value.x) || !finite(value.y) || !finite(value.z)) return null;
  return { x: value.x, y: value.y, z: value.z };
}

function vectorLength(vector: VibodeThumbnailVec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function crossLength(
  first: VibodeThumbnailVec3,
  second: VibodeThumbnailVec3,
): number {
  return Math.hypot(
    first.y * second.z - first.z * second.y,
    first.z * second.x - first.x * second.z,
    first.x * second.y - first.y * second.x,
  );
}

export function thumbnailRenderError(
  code: VibodeThumbnailRenderErrorCode,
  message: string,
  retryable: boolean,
): VibodeThumbnailRenderFailure {
  return { ok: false, code, message, retryable };
}

export function isVibodeThumbnailRenderErrorCode(
  value: string,
): value is VibodeThumbnailRenderErrorCode {
  return (VIBODE_THUMBNAIL_RENDER_ERROR_CODES as readonly string[]).includes(value);
}

export function thumbnailAssetUrlPolicyFromEnv(
  env?: Readonly<Record<string, string | undefined>>,
): ThumbnailRenderUrlPolicy {
  const raw = env?.NEXT_PUBLIC_SUPABASE_URL ||
    env?.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  try {
    const host = new URL(raw).host;
    return { supabaseHost: host || null };
  } catch {
    return { supabaseHost: null };
  }
}

function rejectUrl(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("file:") ||
    lower.startsWith("blob:") ||
    value.includes("\\") ||
    value.includes("..")
  );
}

function parseHttps(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (!url.host || url.host !== url.host.toLowerCase()) return null;
    return url;
  } catch {
    return null;
  }
}

export function isRegisteredThumbnailGlbUrl(
  assetId: string,
  glbUrl: string,
): boolean {
  const registered = furnitureAssetDefinition(assetId);
  if (!registered) return false;
  return glbUrl === registered.glbUrl && STATIC_GLB_PATH.test(glbUrl);
}

export function isServerMintedThumbnailSignedUrl(
  value: string,
  policy: ThumbnailRenderUrlPolicy,
): boolean {
  if (!policy.supabaseHost || rejectUrl(value)) return false;
  const url = parseHttps(value);
  if (!url || url.host !== policy.supabaseHost) return false;
  return url.pathname.includes("/storage/v1/object/sign/");
}

export function isServerThumbnailBackgroundUrl(
  value: string,
  policy: ThumbnailRenderUrlPolicy,
): boolean {
  if (rejectUrl(value)) return false;
  return isServerMintedThumbnailSignedUrl(value, policy) ||
    isSupabasePublicObjectUrl(value, policy);
}

function isSupabasePublicObjectUrl(
  value: string,
  policy: ThumbnailRenderUrlPolicy,
): boolean {
  if (!policy.supabaseHost) return false;
  const url = parseHttps(value);
  if (!url || url.host !== policy.supabaseHost) return false;
  if (url.searchParams.has("token")) return false;
  if (url.pathname.includes("/storage/v1/object/sign/")) return false;
  return url.pathname.includes("/storage/v1/object/public/");
}

export function validateVibodeThumbnailRenderPayload(
  value: unknown,
  policy: ThumbnailRenderUrlPolicy = thumbnailAssetUrlPolicyFromEnv(),
):
  | Readonly<{ ok: true; payload: VibodeThumbnailRenderPayload }>
  | Readonly<{ ok: false; reason: string }> {
  if (!isRecord(value)) {
    return { ok: false, reason: "payload must be an object." };
  }
  if (value.schemaVersion !== VIBODE_THUMBNAIL_RENDER_SCHEMA_VERSION) {
    return { ok: false, reason: "unsupported thumbnail render schema." };
  }
  if (!isRecord(value.job) || !isRecord(value.room) || !isRecord(value.frame)) {
    return { ok: false, reason: "job, room, and frame are required." };
  }
  const jobId = typeof value.job.jobId === "string" ? value.job.jobId : "";
  const contentToken = typeof value.job.contentToken === "string"
    ? value.job.contentToken
    : "";
  if (!UUID.test(jobId) || !CONTENT_TOKEN.test(contentToken)) {
    return { ok: false, reason: "job identity is invalid." };
  }
  const roomId = typeof value.room.roomId === "string" ? value.room.roomId : "";
  const versionId = typeof value.room.versionId === "string"
    ? value.room.versionId
    : "";
  const afcGenerationId = typeof value.room.afcGenerationId === "string"
    ? value.room.afcGenerationId
    : "";
  if (!UUID.test(roomId) || !UUID.test(versionId) || !UUID.test(afcGenerationId)) {
    return { ok: false, reason: "room identity is invalid." };
  }
  const frame = readFrame(value.frame);
  if (!frame.ok) return frame;
  const camera = readCamera(value.camera);
  if (!camera.ok) return camera;
  const backgroundUrl = isRecord(value.background) &&
      typeof value.background.url === "string"
    ? value.background.url
    : "";
  if (!isServerThumbnailBackgroundUrl(backgroundUrl, policy)) {
    return { ok: false, reason: "background URL is not server-minted." };
  }
  const objects = readObjects(value.objects, policy);
  if (!objects.ok) return objects;
  const lighting = readLighting(value.lighting);
  if (!lighting.ok) return lighting;
  return {
    ok: true,
    payload: {
      schemaVersion: VIBODE_THUMBNAIL_RENDER_SCHEMA_VERSION,
      job: { jobId, contentToken },
      room: { roomId, versionId, afcGenerationId },
      frame: frame.frame,
      background: { url: backgroundUrl },
      camera: camera.camera,
      objects: objects.objects,
      lighting: lighting.lighting,
    },
  };
}

function readFrame(value: unknown):
  | Readonly<{ ok: true; frame: { width: number; height: number } }>
  | Readonly<{ ok: false; reason: string }> {
  if (!isRecord(value)) return { ok: false, reason: "frame is required." };
  const width = value.width;
  const height = value.height;
  if (
    !finite(width) ||
    !finite(height) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { ok: false, reason: "frame dimensions must be positive integers." };
  }
  if (
    width > VIBODE_THUMBNAIL_MAX_FRAME_EDGE_PX ||
    height > VIBODE_THUMBNAIL_MAX_FRAME_EDGE_PX ||
    width * height > VIBODE_THUMBNAIL_MAX_FRAME_PIXELS
  ) {
    return { ok: false, reason: "frame dimensions exceed the render bound." };
  }
  return { ok: true, frame: { width, height } };
}

function readCamera(value: unknown):
  | Readonly<{ ok: true; camera: VibodeThumbnailRenderPayload["camera"] }>
  | Readonly<{ ok: false; reason: string }> {
  if (!isRecord(value)) return { ok: false, reason: "camera is required." };
  if (!finite(value.verticalFovDeg) || value.verticalFovDeg <= 0 || value.verticalFovDeg >= 180) {
    return { ok: false, reason: "camera FOV must be a positive finite value." };
  }
  const position = readVec3(value.position);
  const lookAt = readVec3(value.lookAt);
  const up = readVec3(value.up);
  if (!position || !lookAt || !up) {
    return { ok: false, reason: "camera vectors must be finite." };
  }
  if (
    !finite(value.metricScale) ||
    value.metricScale <= 0 ||
    value.metricScale >= 1000
  ) {
    return { ok: false, reason: "metric scale must be a positive finite value." };
  }
  if (
    value.near !== AFC_V2_RUNTIME_CAMERA_NEAR ||
    value.far !== AFC_V2_RUNTIME_CAMERA_FAR
  ) {
    return { ok: false, reason: "camera near/far must match the production camera." };
  }
  const view = {
    x: lookAt.x - position.x,
    y: lookAt.y - position.y,
    z: lookAt.z - position.z,
  };
  if (
    vectorLength(view) <= VECTOR_EPSILON ||
    vectorLength(up) <= VECTOR_EPSILON ||
    crossLength(view, up) <= VECTOR_EPSILON
  ) {
    return { ok: false, reason: "camera pose is degenerate." };
  }
  return {
    ok: true,
    camera: {
      verticalFovDeg: value.verticalFovDeg,
      position,
      lookAt,
      up,
      metricScale: value.metricScale,
      near: AFC_V2_RUNTIME_CAMERA_NEAR,
      far: AFC_V2_RUNTIME_CAMERA_FAR,
    },
  };
}

function readObjects(
  value: unknown,
  policy: ThumbnailRenderUrlPolicy,
):
  | Readonly<{ ok: true; objects: VibodeThumbnailRenderObject[] }>
  | Readonly<{ ok: false; reason: string }> {
  if (!Array.isArray(value)) {
    return { ok: false, reason: "objects must be an array." };
  }
  if (value.length === 0) {
    return { ok: false, reason: "a render payload cannot describe an empty scene." };
  }
  if (value.length > PI4C_MAX_SCENE_OBJECTS) {
    return { ok: false, reason: "too many scene objects." };
  }
  const objects: VibodeThumbnailRenderObject[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      return { ok: false, reason: "scene object must be an object." };
    }
    const objectId = typeof item.objectId === "string" ? item.objectId.trim() : "";
    const assetId = typeof item.assetId === "string" ? item.assetId.trim() : "";
    const glbUrl = typeof item.glbUrl === "string" ? item.glbUrl.trim() : "";
    if (!objectId || !assetId || !glbUrl) {
      return { ok: false, reason: "object identity is incomplete." };
    }
    if (seen.has(objectId)) {
      return { ok: false, reason: "objectId must be unique in a scene." };
    }
    const position = readVec3(item.position);
    const rotationDeg = readVec3(item.rotationDeg);
    if (!position || !rotationDeg) {
      return { ok: false, reason: "object transform must be finite." };
    }
    if (
      !finite(item.userSizeMultiplier) ||
      item.userSizeMultiplier < AFC_V2_USER_SIZE_MIN ||
      item.userSizeMultiplier > AFC_V2_USER_SIZE_MAX
    ) {
      return { ok: false, reason: "userSizeMultiplier is outside the production clamp." };
    }
    const staticUrl = isRegisteredThumbnailGlbUrl(assetId, glbUrl);
    const signedUrl = isServerMintedThumbnailSignedUrl(glbUrl, policy);
    if (!staticUrl && !signedUrl) {
      return { ok: false, reason: "GLB URL is not server-resolved." };
    }
    if ("transform" in item || "uniformScale" in item || "glbSignedUrl" in item) {
      return { ok: false, reason: "object transform shape is not canonical." };
    }
    seen.add(objectId);
    objects.push({
      objectId,
      assetId,
      glbUrl,
      position,
      rotationDeg,
      userSizeMultiplier: item.userSizeMultiplier,
    });
  }
  return { ok: true, objects };
}

function readLighting(value: unknown):
  | Readonly<{ ok: true; lighting: VibodeThumbnailRenderPayload["lighting"] }>
  | Readonly<{ ok: false; reason: string }> {
  if (!isRecord(value)) return { ok: false, reason: "lighting is required." };
  const directionalPosition = readVec3(value.directionalPosition);
  if (
    value.ambientIntensity !== VIBODE_PRODUCTION_AMBIENT_INTENSITY ||
    value.directionalIntensity !== VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY ||
    !directionalPosition ||
    directionalPosition.x !== VIBODE_PRODUCTION_DIRECTIONAL_POSITION.x ||
    directionalPosition.y !== VIBODE_PRODUCTION_DIRECTIONAL_POSITION.y ||
    directionalPosition.z !== VIBODE_PRODUCTION_DIRECTIONAL_POSITION.z
  ) {
    return { ok: false, reason: "lighting must match the production viewer." };
  }
  return {
    ok: true,
    lighting: {
      ambientIntensity: VIBODE_PRODUCTION_AMBIENT_INTENSITY,
      directionalIntensity: VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
      directionalPosition: { ...VIBODE_PRODUCTION_DIRECTIONAL_POSITION },
    },
  };
}

export function sceneDefinitionFromThumbnailObject(
  object: VibodeThumbnailRenderObject,
): SceneObjectDefinition {
  return {
    objectId: object.objectId,
    assetId: object.assetId,
    transform: {
      position: { ...object.position },
      rotationDeg: { ...object.rotationDeg },
      uniformScale: 1,
    },
    userSizeMultiplier: object.userSizeMultiplier,
  };
}

export function emptyThumbnailRenderTiming(): VibodeThumbnailRenderReadiness["timing"] {
  return {
    contractFetchMs: null,
    backgroundDecodeMs: null,
    glbLoadMs: null,
    sceneConstructionMs: null,
    firstRenderMs: null,
    totalReadinessMs: null,
  };
}
