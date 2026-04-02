import type { SupabaseClient } from "@supabase/supabase-js";
import { createVibodeAssetThumbnail } from "@/lib/vibodeAssetThumbnails";
import { createVibodeRoomAsset, updateVibodeRoom, updateVibodeRoomAsset } from "@/lib/vibodePersistence";

type AnySupabaseClient = SupabaseClient<any, "public", any>;

type ResolveStorageInput = Record<string, unknown> & {
  imageUrl?: unknown;
  output?: unknown;
};

type ResolveDimensionsInput = Record<string, unknown> & {
  widthPx?: unknown;
  width?: unknown;
  heightPx?: unknown;
  height?: unknown;
  output?: unknown;
};

type FinalizeVibodeOutputAssetArgs = {
  logPrefix: string;
  adminSupabase: AnySupabaseClient | null;
  persistenceSupabase: AnySupabaseClient | null;
  roomId: string | null;
  userId: string | null;
  assetType: string;
  stageNumber: number | null;
  modelVersion: string;
  responseImageUrl: string | null;
  responseStorageBucket: string | null;
  responseStoragePath: string | null;
  responseWidth: number | null;
  responseHeight: number | null;
  sourceImageUrlForThumbnail?: string | null;
  markAssetActive?: boolean;
  updateRoomCurrentStage?: number | null;
  updateRoomSortKey?: string | null;
};

type FinalizeVibodeOutputAssetResult = {
  imageUrl: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  durableImageUrl: string | null;
  width: number | null;
  height: number | null;
  outputAssetId: string | null;
  assetFinalizationError: unknown | null;
};

const VIBODE_STAGED_BUCKET = (process.env.VIBODE_STAGED_BUCKET || "vibode-generations").trim();
const STAGED_SIGNED_URL_EXPIRES_IN_SEC = Math.max(
  60,
  Number(process.env.VIBODE_STAGED_SIGNED_URL_EXPIRES_IN ?? 60 * 60 * 24 * 7)
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseOptionalPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (n <= 0) return null;
  return n;
}

function isDataUrl(value: string | null): boolean {
  if (!value) return false;
  return value.toLowerCase().startsWith("data:image/");
}

function isLikelyExpiringSignedUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/storage/v1/object/sign/")) return true;
    if (parsed.searchParams.has("token")) return true;
    if (parsed.searchParams.has("X-Amz-Signature")) return true;
    if (parsed.searchParams.has("X-Amz-Credential")) return true;
    return false;
  } catch {
    return false;
  }
}

function getDurableImageUrl(args: {
  candidateUrl?: string | null;
  storageBucket?: string | null;
}): string | null {
  const url = safeStr(args.candidateUrl);
  if (!url) return null;

  const bucket = safeStr(args.storageBucket);
  const isPrivateBucket =
    bucket === "vibode-generations" || bucket === VIBODE_STAGED_BUCKET || bucket === "vibode-base-images";
  if (isPrivateBucket && isLikelyExpiringSignedUrl(url)) return null;

  return url;
}

function parseStorageLocationFromImageUrl(
  imageUrl: string | null
): { storageBucket: string | null; storagePath: string | null } {
  if (!imageUrl) return { storageBucket: null, storagePath: null };

  try {
    const parsed = new URL(imageUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const objectIndex = parts.indexOf("object");
    if (objectIndex < 0) return { storageBucket: null, storagePath: null };

    let bucketIndex = objectIndex + 1;
    const mode = parts[objectIndex + 1];
    if (mode === "sign" || mode === "public" || mode === "authenticated") {
      bucketIndex = objectIndex + 2;
    }

    const bucket = parts[bucketIndex];
    const keyParts = parts.slice(bucketIndex + 1);
    if (!bucket || keyParts.length === 0) {
      return { storageBucket: null, storagePath: null };
    }

    return {
      storageBucket: decodeURIComponent(bucket),
      storagePath: decodeURIComponent(keyParts.join("/")),
    };
  } catch {
    return { storageBucket: null, storagePath: null };
  }
}

export function resolveVibodeOutputStorage(result: ResolveStorageInput): {
  storageBucket: string | null;
  storagePath: string | null;
} {
  const output = isRecord(result.output) ? result.output : null;

  const storageBucket =
    safeStr(result.storageBucket) ??
    safeStr(result.storage_bucket) ??
    safeStr(result.bucket) ??
    safeStr(output?.storageBucket) ??
    safeStr(output?.storage_bucket) ??
    safeStr(output?.bucket);

  const storagePath =
    safeStr(result.storagePath) ??
    safeStr(result.storage_path) ??
    safeStr(result.storageKey) ??
    safeStr(result.storage_key) ??
    safeStr(result.key) ??
    safeStr(output?.storagePath) ??
    safeStr(output?.storage_path) ??
    safeStr(output?.storageKey) ??
    safeStr(output?.storage_key) ??
    safeStr(output?.key);

  if (storageBucket && storagePath) {
    return { storageBucket, storagePath };
  }

  return parseStorageLocationFromImageUrl(safeStr(result.imageUrl));
}

export function resolveVibodeOutputDimensions(result: ResolveDimensionsInput): {
  width: number | null;
  height: number | null;
} {
  const output = isRecord(result.output) ? result.output : null;
  const width =
    parseOptionalPositiveInt(result.widthPx) ??
    parseOptionalPositiveInt(result.width) ??
    parseOptionalPositiveInt(output?.widthPx) ??
    parseOptionalPositiveInt(output?.width);
  const height =
    parseOptionalPositiveInt(result.heightPx) ??
    parseOptionalPositiveInt(result.height) ??
    parseOptionalPositiveInt(output?.heightPx) ??
    parseOptionalPositiveInt(output?.height);
  return { width, height };
}

function parseDataUrlImage(dataUrl: string): { mime: string; buf: Buffer } {
  const matched = dataUrl.trim().match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (!matched) {
    throw new Error("Invalid image data URL.");
  }
  return {
    mime: matched[1].toLowerCase(),
    buf: Buffer.from(matched[2], "base64"),
  };
}

function inferExtFromContentType(contentType: string) {
  const c = (contentType || "").toLowerCase();
  if (c.includes("jpeg") || c.includes("jpg")) return { ext: "jpg", contentType: "image/jpeg" };
  if (c.includes("webp")) return { ext: "webp", contentType: "image/webp" };
  if (c.includes("png")) return { ext: "png", contentType: "image/png" };
  return { ext: "png", contentType: "image/png" };
}

function sanitizeStoragePathPart(value: string | null | undefined, fallback: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function buildOutputStoragePath(args: {
  roomId: string | null;
  stageNumber: number | null;
  assetType: string;
  ext: string;
}) {
  const roomPart = sanitizeStoragePathPart(args.roomId, "room");
  const stagePart =
    typeof args.stageNumber === "number" && Number.isFinite(args.stageNumber)
      ? `stage_${Math.trunc(args.stageNumber)}`
      : sanitizeStoragePathPart(args.assetType, "output");
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${roomPart}/${stagePart}/${nonce}.${args.ext}`;
}

async function persistOutputDataUrlToStorage(args: {
  logPrefix: string;
  adminSupabase: AnySupabaseClient;
  dataUrl: string;
  roomId: string | null;
  stageNumber: number | null;
  assetType: string;
  storageBucketHint: string | null;
  storagePathHint: string | null;
}): Promise<{ imageUrl: string; storageBucket: string; storagePath: string }> {
  const { mime, buf } = parseDataUrlImage(args.dataUrl);
  const inferred = inferExtFromContentType(mime);
  const storageBucket = safeStr(args.storageBucketHint) ?? VIBODE_STAGED_BUCKET;
  const storagePath =
    safeStr(args.storagePathHint) ??
    buildOutputStoragePath({
      roomId: args.roomId,
      stageNumber: args.stageNumber,
      assetType: args.assetType,
      ext: inferred.ext,
    });

  const { error: uploadErr } = await args.adminSupabase.storage
    .from(storageBucket)
    .upload(storagePath, buf, { contentType: inferred.contentType, upsert: true });
  if (uploadErr) {
    throw new Error(`Failed to upload output image: ${uploadErr.message}`);
  }

  const { data: signed, error: signErr } = await args.adminSupabase.storage
    .from(storageBucket)
    .createSignedUrl(storagePath, STAGED_SIGNED_URL_EXPIRES_IN_SEC);
  if (signErr || !signed?.signedUrl) {
    throw new Error(`Failed to sign output image URL: ${signErr?.message ?? "unknown error"}`);
  }

  console.info(`${args.logPrefix} output image persisted to storage`, {
    storageBucket,
    storagePath,
  });

  return {
    imageUrl: signed.signedUrl,
    storageBucket,
    storagePath,
  };
}

export async function finalizeVibodeOutputAsset(
  args: FinalizeVibodeOutputAssetArgs
): Promise<FinalizeVibodeOutputAssetResult> {
  let imageUrl = safeStr(args.responseImageUrl);
  let storageBucket = safeStr(args.responseStorageBucket);
  let storagePath = safeStr(args.responseStoragePath);
  const width = parseOptionalPositiveInt(args.responseWidth);
  const height = parseOptionalPositiveInt(args.responseHeight);

  if (isDataUrl(imageUrl)) {
    if (!args.adminSupabase) {
      console.warn(`${args.logPrefix} output image persistence skipped: missing admin client`);
    } else {
      try {
        const persisted = await persistOutputDataUrlToStorage({
          logPrefix: args.logPrefix,
          adminSupabase: args.adminSupabase,
          dataUrl: imageUrl!,
          roomId: args.roomId,
          stageNumber: args.stageNumber,
          assetType: args.assetType,
          storageBucketHint: storageBucket,
          storagePathHint: storagePath,
        });
        imageUrl = persisted.imageUrl;
        storageBucket = persisted.storageBucket;
        storagePath = persisted.storagePath;
      } catch (storageErr) {
        console.warn(`${args.logPrefix} output image persistence failed; using fallback image URL`, {
          error: storageErr instanceof Error ? storageErr.message : String(storageErr),
        });
      }
    }
  }

  const durableImageUrl = getDurableImageUrl({
    candidateUrl: imageUrl,
    storageBucket,
  });
  let coverImageUrl = durableImageUrl ?? imageUrl;
  let coverImageSource: "full" | "response" | "none" = coverImageUrl
    ? durableImageUrl
      ? "full"
      : "response"
    : "none";

  if (!args.persistenceSupabase || !args.roomId || !args.userId) {
    return {
      imageUrl,
      storageBucket,
      storagePath,
      durableImageUrl,
      width,
      height,
      outputAssetId: null,
      assetFinalizationError: null,
    };
  }

  let outputAssetId: string | null = null;
  let assetFinalizationError: unknown | null = null;
  const markAssetActive = args.markAssetActive !== false;

  console.info(`${args.logPrefix} asset finalization start`, {
    roomId: args.roomId,
    userId: args.userId,
    assetType: args.assetType,
    stageNumber: args.stageNumber,
    markAssetActive,
  });

  try {
    const outputAsset = await createVibodeRoomAsset(args.persistenceSupabase, {
      room_id: args.roomId,
      user_id: args.userId,
      asset_type: args.assetType,
      stage_number: args.stageNumber,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      image_url: durableImageUrl ?? "",
      model_version: args.modelVersion,
      width,
      height,
      is_active: markAssetActive,
    });
    outputAssetId = outputAsset.id;
    console.info(`${args.logPrefix} asset row insert success`, {
      assetId: outputAsset.id,
      roomId: args.roomId,
      assetType: args.assetType,
    });

    try {
      if (!args.adminSupabase) {
        console.warn(`${args.logPrefix} thumbnail generation failed: missing admin client`);
        console.warn(`${args.logPrefix} thumbnail upload failed: missing admin client`);
      } else {
        const thumbnailLocation = await createVibodeAssetThumbnail({
          adminSupabase: args.adminSupabase,
          roomId: args.roomId,
          assetId: outputAsset.id,
          sourceStorageBucket: storageBucket,
          sourceStoragePath: storagePath,
          sourceImageUrl: durableImageUrl ?? imageUrl ?? safeStr(args.sourceImageUrlForThumbnail),
        });

        if (!thumbnailLocation) {
          console.warn(`${args.logPrefix} thumbnail generation failed: source image unavailable`);
          console.warn(`${args.logPrefix} thumbnail upload failed: no thumbnail bytes generated`);
        } else {
          console.info(`${args.logPrefix} thumbnail generation success`, {
            assetId: outputAsset.id,
          });
          console.info(`${args.logPrefix} thumbnail upload success`, {
            assetId: outputAsset.id,
            thumbnailBucket: thumbnailLocation.thumbnail_storage_bucket,
            thumbnailPath: thumbnailLocation.thumbnail_storage_path,
          });

          await updateVibodeRoomAsset(args.persistenceSupabase, outputAsset.id, thumbnailLocation);
          console.info(`${args.logPrefix} asset row update success`, {
            assetId: outputAsset.id,
            fields: ["thumbnail_storage_bucket", "thumbnail_storage_path"],
          });

        }
      }
    } catch (thumbnailErr) {
      const message = thumbnailErr instanceof Error ? thumbnailErr.message : String(thumbnailErr);
      if (message.toLowerCase().includes("upload")) {
        console.warn(`${args.logPrefix} thumbnail upload failed`, { error: message });
      } else {
        console.warn(`${args.logPrefix} thumbnail generation failed`, { error: message });
      }
    }

    if (markAssetActive) {
      const { error: deactivateErr } = await args.persistenceSupabase
        .from("vibode_room_assets")
        .update({ is_active: false })
        .eq("room_id", args.roomId)
        .eq("user_id", args.userId)
        .eq("is_active", true)
        .neq("id", outputAsset.id);
      if (deactivateErr) {
        throw new Error(`[vibode] failed to deactivate prior room assets: ${deactivateErr.message}`);
      }

      await updateVibodeRoom(args.persistenceSupabase, args.roomId, {
        active_asset_id: outputAsset.id,
        current_stage:
          typeof args.updateRoomCurrentStage === "number" ? args.updateRoomCurrentStage : undefined,
        cover_image_url: coverImageUrl,
        sort_key: args.updateRoomSortKey ?? new Date().toISOString(),
      });
      console.info(`${args.logPrefix} room cover/active asset update success`, {
        roomId: args.roomId,
        activeAssetId: outputAsset.id,
        hasCoverImageUrl: Boolean(coverImageUrl),
        coverImageSource,
      });
    }
  } catch (err) {
    assetFinalizationError = err;
    console.error(`${args.logPrefix} asset finalization failed`, err);
  }

  return {
    imageUrl,
    storageBucket,
    storagePath,
    durableImageUrl,
    width,
    height,
    outputAssetId,
    assetFinalizationError,
  };
}
