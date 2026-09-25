import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { createProductionAfcStoreFromEnv } from "@/lib/afc-v2-production/production-persistence.server";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";
import {
  authorizeOwned3dSceneContext,
  resolvePersistedSceneCompatibility,
  validatePersistedVersionScene,
  PI4C_SCENE_TABLE,
  type PersistedVersionScene,
} from "@/lib/afc-v2-runtime/persisted-scene";
import type { LoadedSceneRow } from "@/lib/afc-v2-runtime/scene-inheritance";
import {
  AFC_V2_RUNTIME_CAMERA_FAR,
  AFC_V2_RUNTIME_CAMERA_NEAR,
  AFC_V2_USER_SIZE_DEFAULT,
  type SceneObjectDefinition,
} from "@/lib/afc-v2-runtime/types";
import { validateProductionRuntimeAuthority } from "@/lib/afc-v2-runtime/runtime-authority";
import type { RuntimeAssetIssue } from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";
import { lookupPartnerRuntimeAssets } from "@/lib/vibode-stage/partner-runtime-assets.server";
import {
  expiresAtFromNow,
  resolveSceneRuntimeAssets,
  type DynamicRuntimeLookupRow,
  type SignedGetMintResult,
} from "@/lib/vibode-stage/partner-runtime-assets";

import {
  consumeThumbnailRenderToken,
  mintThumbnailRenderToken,
  verifyThumbnailRenderToken,
} from "./access.server";
import {
  isServerMintedThumbnailSignedUrl,
  isServerThumbnailBackgroundUrl,
  thumbnailAssetUrlPolicyFromEnv,
  thumbnailRenderError,
  validateVibodeThumbnailRenderPayload,
  VIBODE_THUMBNAIL_ASSET_URL_EXPIRES_SEC,
  VIBODE_THUMBNAIL_RENDER_SCHEMA_VERSION,
  type ThumbnailRenderUrlPolicy,
  type VibodeThumbnailRenderFailure,
  type VibodeThumbnailRenderPayload,
} from "./contract";
import {
  VIBODE_PRODUCTION_AMBIENT_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_POSITION,
} from "./still-renderer";

type RoomRecord = Readonly<{
  id: string;
  userId: string;
  currentAfcGenerationId: string | null;
}>;

type VersionRecord = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  imageUrl: string | null;
  storageBucket: string | null;
  storagePath: string | null;
}>;

type GenerationRecord = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  status: string;
  productionAuthority: unknown;
}>;

export type ThumbnailRenderSource = Readonly<{
  policy: ThumbnailRenderUrlPolicy;
  loadRoom: (roomId: string) => Promise<RoomRecord | null>;
  loadVersion: (versionId: string) => Promise<VersionRecord | null>;
  loadGeneration: (generationId: string) => Promise<GenerationRecord | null>;
  loadScene: (roomId: string, versionId: string) => Promise<LoadedSceneRow>;
  signStorageUrl: (bucket: string, path: string) => Promise<string | null>;
  lookupDynamicAssets: (
    assetIds: readonly string[],
  ) => Promise<readonly DynamicRuntimeLookupRow[]>;
  mintDynamicSignedGet: (row: DynamicRuntimeLookupRow) => Promise<SignedGetMintResult>;
}>;

export type ThumbnailRenderBuildResult =
  | Readonly<{ ok: true; payload: VibodeThumbnailRenderPayload }>
  | VibodeThumbnailRenderFailure;

export async function buildVibodeThumbnailRenderPayload(
  input: Readonly<{ roomId: string; versionId: string; jobId?: string }>,
  source: ThumbnailRenderSource = createProductionThumbnailRenderSource(),
): Promise<ThumbnailRenderBuildResult> {
  const room = await source.loadRoom(input.roomId);
  const version = room ? await source.loadVersion(input.versionId) : null;
  const generationId = room?.currentAfcGenerationId ?? "";
  const generation = generationId ? await source.loadGeneration(generationId) : null;
  const authorized = authorizeOwned3dSceneContext({
    userId: room?.userId ?? null,
    room,
    version,
    generation: generation
      ? {
          id: generation.id,
          roomId: generation.roomId,
          userId: generation.userId,
          status: generation.status,
        }
      : null,
    requestedRoomId: input.roomId,
    requestedVersionId: input.versionId,
    requestedAfcGenerationId: generationId,
  });
  if (!authorized.ok) {
    if (
      authorized.error === "AFC generation is not production-ready." ||
      authorized.error === "AFC generation is not the room's current spatial authority." ||
      authorized.error === "AFC generation not found."
    ) {
      return thumbnailRenderError(
        "camera_authority_missing",
        "Production camera authority is not ready.",
        false,
      );
    }
    return thumbnailRenderError(
      "render_access_denied",
      "Render access denied.",
      false,
    );
  }

  const authority = validateProductionRuntimeAuthority(generation?.productionAuthority);
  if (!authority.ok) {
    return thumbnailRenderError(
      "camera_authority_missing",
      "Production camera authority is missing.",
      false,
    );
  }

  const loaded = await source.loadScene(input.roomId, input.versionId);
  if (!loaded.found || "malformed" in loaded) {
    return thumbnailRenderError(
      "scene_missing",
      "Saved 3D scene is missing.",
      false,
    );
  }
  const compatibility = resolvePersistedSceneCompatibility({
    storedAfcGenerationId: loaded.scene.afcGenerationId,
    currentAfcGenerationId: authority.authority.generationId,
  });
  if (!compatibility.ok) {
    return thumbnailRenderError(
      "generation_mismatch",
      "Saved scene does not match the current AFC generation.",
      false,
    );
  }
  if (loaded.scene.objects.length === 0) {
    return thumbnailRenderError(
      "scene_empty",
      "Saved scene has no furniture.",
      false,
    );
  }

  const background = await resolveBackground(version, source);
  if (!background) {
    return thumbnailRenderError(
      "background_missing",
      "History background image is missing.",
      false,
    );
  }

  const resolvedAssets = await resolveObjectAssets(loaded.scene.objects, source);
  if (!resolvedAssets.ok) return resolvedAssets.failure;

  const payload = assemblePayload({
    jobId: input.jobId ?? randomUUID(),
    scene: loaded.scene,
    authority: authority.authority,
    background,
    glbUrls: resolvedAssets.glbUrls,
    policy: source.policy,
  });
  if (!payload.ok) {
    return thumbnailRenderError("glb_identity_missing", payload.reason, false);
  }
  return { ok: true, payload: payload.payload };
}

export async function mintVibodeThumbnailRenderAccess(
  input: Readonly<{ roomId: string; versionId: string }>,
  source?: ThumbnailRenderSource,
): Promise<
  | Readonly<{
      ok: true;
      accessToken: string;
      jobId: string;
      expiresAt: string;
      frame: { width: number; height: number };
      objectCount: number;
    }>
  | VibodeThumbnailRenderFailure
> {
  const built = await buildVibodeThumbnailRenderPayload(input, source);
  if (!built.ok) return built;
  const minted = mintThumbnailRenderToken({
    jobId: built.payload.job.jobId,
    roomId: built.payload.room.roomId,
    versionId: built.payload.room.versionId,
    contentToken: built.payload.job.contentToken,
  });
  if (!minted) {
    return thumbnailRenderError(
      "render_access_denied",
      "Render access denied.",
      false,
    );
  }
  return {
    ok: true,
    accessToken: minted.token,
    jobId: built.payload.job.jobId,
    expiresAt: new Date(minted.claims.exp).toISOString(),
    frame: built.payload.frame,
    objectCount: built.payload.objects.length,
  };
}

export async function readVibodeThumbnailRenderAccess(
  token: string,
  source?: ThumbnailRenderSource,
): Promise<ThumbnailRenderBuildResult> {
  const claims = verifyThumbnailRenderToken(token);
  if (!claims) {
    return thumbnailRenderError(
      "render_access_denied",
      "Render access denied.",
      false,
    );
  }
  const built = await buildVibodeThumbnailRenderPayload({
    roomId: claims.roomId,
    versionId: claims.versionId,
    jobId: claims.jobId,
  }, source);
  if (!built.ok) return built;
  if (
    built.payload.job.contentToken !== claims.contentToken ||
    built.payload.room.roomId !== claims.roomId ||
    built.payload.room.versionId !== claims.versionId ||
    built.payload.job.jobId !== claims.jobId
  ) {
    consumeThumbnailRenderToken(claims);
    return thumbnailRenderError(
      "render_access_denied",
      "Render access denied.",
      false,
    );
  }
  consumeThumbnailRenderToken(claims);
  return built;
}

function assemblePayload(input: Readonly<{
  jobId: string;
  scene: PersistedVersionScene;
  authority: AfcV2ProductionRoomAuthority;
  background: ThumbnailBackgroundIdentity;
  glbUrls: ReadonlyMap<string, string>;
  policy: ThumbnailRenderUrlPolicy;
}>):
  | Readonly<{ ok: true; payload: VibodeThumbnailRenderPayload }>
  | Readonly<{ ok: false; reason: string }> {
  const camera = input.authority.frozenCamera;
  const metricScale = input.authority.metric.metricScale;
  const objects = input.scene.objects.map((object) => {
    const glbUrl = input.glbUrls.get(object.assetId) ?? "";
    return {
      objectId: object.objectId,
      assetId: object.assetId,
      glbUrl,
      position: {
        x: object.transform.position.x,
        y: object.transform.position.y,
        z: object.transform.position.z,
      },
      rotationDeg: {
        x: object.transform.rotationDeg.x,
        y: object.transform.rotationDeg.y,
        z: object.transform.rotationDeg.z,
      },
      userSizeMultiplier: object.userSizeMultiplier ?? AFC_V2_USER_SIZE_DEFAULT,
    };
  });
  const draft = {
    schemaVersion: VIBODE_THUMBNAIL_RENDER_SCHEMA_VERSION,
    job: {
      jobId: input.jobId,
      contentToken: thumbnailContentToken({
        renderContract: VIBODE_THUMBNAIL_RENDER_SCHEMA_VERSION,
        roomId: input.scene.roomId,
        versionId: input.scene.versionId,
        afcGenerationId: input.authority.generationId,
        frame: {
          width: camera.frame.width,
          height: camera.frame.height,
        },
        camera: {
          verticalFovDeg: camera.verticalFovDeg,
          position: camera.pose.position,
          lookAt: camera.pose.lookAt,
          up: camera.pose.up,
          metricScale,
        },
        background: {
          bucket: input.background.bucket,
          objectPath: input.background.objectPath,
        },
        objects: objects.map((object) => ({
          objectId: object.objectId,
          assetId: object.assetId,
          position: object.position,
          rotationDeg: object.rotationDeg,
          userSizeMultiplier: object.userSizeMultiplier,
        })),
      }),
    },
    room: {
      roomId: input.scene.roomId,
      versionId: input.scene.versionId,
      afcGenerationId: input.authority.generationId,
    },
    frame: {
      width: camera.frame.width,
      height: camera.frame.height,
    },
    background: { url: input.background.url },
    camera: {
      verticalFovDeg: camera.verticalFovDeg,
      position: { ...camera.pose.position },
      lookAt: { ...camera.pose.lookAt },
      up: { ...camera.pose.up },
      metricScale,
      near: AFC_V2_RUNTIME_CAMERA_NEAR,
      far: AFC_V2_RUNTIME_CAMERA_FAR,
    },
    objects,
    lighting: {
      ambientIntensity: VIBODE_PRODUCTION_AMBIENT_INTENSITY,
      directionalIntensity: VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
      directionalPosition: { ...VIBODE_PRODUCTION_DIRECTIONAL_POSITION },
    },
  };
  return validateVibodeThumbnailRenderPayload(draft, input.policy);
}

type ThumbnailBackgroundIdentity = Readonly<{
  url: string;
  bucket: string;
  objectPath: string;
}>;

export function thumbnailContentToken(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("thumbnail content token rejected a non-finite number");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = sortValue(record[key]);
  }
  return sorted;
}

const OBJECT_MARKERS = [
  "/storage/v1/object/public/",
  "/storage/v1/object/sign/",
] as const;

function publicObjectIdentity(imageUrl: string): { bucket: string; objectPath: string } | null {
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    return null;
  }
  const marker = OBJECT_MARKERS.find((candidate) => url.pathname.includes(candidate));
  if (!marker) return null;
  const markerAt = url.pathname.indexOf(marker);
  const rest = decodeURIComponent(url.pathname.slice(markerAt + marker.length));
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  const bucket = rest.slice(0, slash);
  const objectPath = rest.slice(slash + 1);
  if (!bucket || !objectPath || objectPath.includes("..")) return null;
  return { bucket, objectPath };
}

async function resolveBackground(
  version: VersionRecord | null,
  source: ThumbnailRenderSource,
): Promise<ThumbnailBackgroundIdentity | null> {
  if (!version) return null;
  const bucket = version.storageBucket?.trim() ?? "";
  const objectPath = version.storagePath?.trim() ?? "";
  if (bucket && objectPath && !objectPath.includes("..")) {
    const signed = await source.signStorageUrl(bucket, objectPath);
    if (signed && isServerThumbnailBackgroundUrl(signed, source.policy)) {
      return { url: signed, bucket, objectPath };
    }
    return null;
  }
  const imageUrl = version.imageUrl?.trim() ?? "";
  if (!imageUrl || !isServerThumbnailBackgroundUrl(imageUrl, source.policy)) return null;
  const identity = publicObjectIdentity(imageUrl);
  if (!identity) return null;
  return { url: imageUrl, bucket: identity.bucket, objectPath: identity.objectPath };
}

async function resolveObjectAssets(
  objects: readonly SceneObjectDefinition[],
  source: ThumbnailRenderSource,
): Promise<
  | Readonly<{ ok: true; glbUrls: Map<string, string> }>
  | Readonly<{ ok: false; failure: VibodeThumbnailRenderFailure }>
> {
  const glbUrls = new Map<string, string>();
  const dynamicIds: string[] = [];
  for (const object of objects) {
    const registered = furnitureAssetDefinition(object.assetId);
    if (registered) {
      glbUrls.set(object.assetId, registered.glbUrl);
      continue;
    }
    dynamicIds.push(object.assetId);
  }
  if (dynamicIds.length === 0) return { ok: true, glbUrls };
  let resolved: {
    assetDefinitions: ReadonlyArray<{ assetId: string; glbUrl: string }>;
    assetIssues: readonly RuntimeAssetIssue[];
  };
  try {
    resolved = await resolveSceneRuntimeAssets({
      assetIds: objects.map((object) => object.assetId),
      lookupDynamicAssets: source.lookupDynamicAssets,
      mintSignedGet: source.mintDynamicSignedGet,
    });
  } catch {
    return {
      ok: false,
      failure: thumbnailRenderError(
        "signed_url_failed",
        "Furniture signed URL could not be created.",
        true,
      ),
    };
  }
  if (resolved.assetIssues.length > 0) {
    const retryable = resolved.assetIssues.some((issue) =>
      issue.code === "RUNTIME_ASSET_URL_MINT_FAILED" ||
      issue.code === "RUNTIME_ASSET_LOAD_FAILED"
    );
    return {
      ok: false,
      failure: thumbnailRenderError(
        retryable ? "signed_url_failed" : "glb_identity_missing",
        retryable
          ? "Furniture signed URL could not be created."
          : "Furniture asset identity could not be resolved.",
        retryable,
      ),
    };
  }
  for (const definition of resolved.assetDefinitions) {
    if (!isServerMintedThumbnailSignedUrl(definition.glbUrl, source.policy)) {
      return {
        ok: false,
        failure: thumbnailRenderError(
          "signed_url_failed",
          "Furniture signed URL could not be created.",
          true,
        ),
      };
    }
    glbUrls.set(definition.assetId, definition.glbUrl);
  }
  for (const object of objects) {
    if (!glbUrls.has(object.assetId)) {
      return {
        ok: false,
        failure: thumbnailRenderError(
          "glb_identity_missing",
          "Furniture asset identity could not be resolved.",
          false,
        ),
      };
    }
  }
  return { ok: true, glbUrls };
}

export function createProductionThumbnailRenderSource(): ThumbnailRenderSource {
  const policy = thumbnailAssetUrlPolicyFromEnv();
  return {
    policy,
    async loadRoom(roomId) {
      const store = createProductionAfcStoreFromEnv();
      if (!store) return null;
      const room = await store.getRoom(roomId);
      if (!room) return null;
      return {
        id: room.id,
        userId: room.userId,
        currentAfcGenerationId: room.currentAfcGenerationId,
      };
    },
    async loadVersion(versionId) {
      const supabase = getServiceRoleSupabaseClient();
      if (!supabase) return null;
      const { data, error } = await supabase
        .from("vibode_room_assets")
        .select("id, room_id, user_id, image_url, storage_bucket, storage_path")
        .eq("id", versionId)
        .maybeSingle();
      if (error || !data || typeof data !== "object") return null;
      const row = data as Record<string, unknown>;
      return {
        id: String(row.id),
        roomId: String(row.room_id),
        userId: String(row.user_id),
        imageUrl: typeof row.image_url === "string" ? row.image_url : null,
        storageBucket: typeof row.storage_bucket === "string" ? row.storage_bucket : null,
        storagePath: typeof row.storage_path === "string" ? row.storage_path : null,
      };
    },
    async loadGeneration(generationId) {
      const store = createProductionAfcStoreFromEnv();
      if (!store) return null;
      const generation = await store.getGeneration(generationId);
      if (!generation) return null;
      return {
        id: generation.id,
        roomId: generation.roomId,
        userId: generation.userId,
        status: generation.status,
        productionAuthority: generation.productionAuthority,
      };
    },
    async loadScene(roomId, versionId) {
      const supabase = getServiceRoleSupabaseClient();
      if (!supabase) return { found: false };
      const { data, error } = await supabase
        .from(PI4C_SCENE_TABLE)
        .select("room_id, version_id, afc_generation_id, coordinate_space, objects_json")
        .eq("room_id", roomId)
        .eq("version_id", versionId)
        .maybeSingle();
      if (error || !data || typeof data !== "object") return { found: false };
      const row = data as Record<string, unknown>;
      const scene = validatePersistedVersionScene({
        roomId: row.room_id,
        versionId: row.version_id,
        afcGenerationId: row.afc_generation_id,
        coordinateSpace: row.coordinate_space,
        objects: row.objects_json,
      });
      if (!scene.ok) return { found: true, malformed: true };
      return { found: true, scene: scene.scene };
    },
    async signStorageUrl(bucket, path) {
      const supabase = getServiceRoleSupabaseClient();
      if (!supabase) return null;
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, VIBODE_THUMBNAIL_ASSET_URL_EXPIRES_SEC);
      const signedUrl = typeof data?.signedUrl === "string" ? data.signedUrl.trim() : "";
      if (error || !signedUrl) return null;
      return signedUrl;
    },
    lookupDynamicAssets(assetIds) {
      const supabase = getServiceRoleSupabaseClient();
      if (!supabase) return Promise.resolve([]);
      return lookupPartnerRuntimeAssets(supabase, assetIds);
    },
    async mintDynamicSignedGet(row) {
      const supabase = getServiceRoleSupabaseClient();
      if (!supabase) return { ok: false };
      try {
        const { data, error } = await supabase.storage
          .from(row.storageBucket)
          .createSignedUrl(row.storageObjectPath, VIBODE_THUMBNAIL_ASSET_URL_EXPIRES_SEC);
        const signedUrl = typeof data?.signedUrl === "string" ? data.signedUrl.trim() : "";
        if (error || !signedUrl) return { ok: false };
        return {
          ok: true,
          signedUrl,
          expiresAt: expiresAtFromNow(Date.now(), VIBODE_THUMBNAIL_ASSET_URL_EXPIRES_SEC),
        };
      } catch {
        return { ok: false };
      }
    },
  };
}
