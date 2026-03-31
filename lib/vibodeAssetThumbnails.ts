import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabaseClient = SupabaseClient<any, "public", any>;

type CreateAssetThumbnailArgs = {
  adminSupabase: AnySupabaseClient;
  roomId: string;
  assetId: string;
  sourceStorageBucket?: string | null;
  sourceStoragePath?: string | null;
  sourceImageUrl?: string | null;
};

type AssetThumbnailLocation = {
  thumbnail_storage_bucket: string;
  thumbnail_storage_path: string;
};

const THUMBNAILS_BUCKET = (process.env.VIBODE_THUMBNAILS_BUCKET || "vibode-thumbnails").trim();
const THUMBNAIL_WIDTH_PX = Math.max(128, Number(process.env.VIBODE_THUMBNAIL_WIDTH_PX ?? 640));
const THUMBNAIL_HEIGHT_PX = Math.max(96, Number(process.env.VIBODE_THUMBNAIL_HEIGHT_PX ?? 480));

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizePathPart(value: string, fallback: string) {
  const normalized = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function parseDataUrlImage(dataUrl: string): Buffer | null {
  const matched = dataUrl.trim().match(/^data:image\/[^;]+;base64,(.+)$/i);
  if (!matched) return null;
  return Buffer.from(matched[1], "base64");
}

async function loadImageBytesFromStorage(args: {
  adminSupabase: AnySupabaseClient;
  bucket: string;
  path: string;
}): Promise<Buffer | null> {
  const { data, error } = await args.adminSupabase.storage.from(args.bucket).download(args.path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

async function loadImageBytesFromUrl(url: string): Promise<Buffer | null> {
  if (url.toLowerCase().startsWith("data:image/")) {
    return parseDataUrlImage(url);
  }

  if (!/^https?:\/\//i.test(url)) return null;

  const res = await fetch(url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

export async function createVibodeAssetThumbnail(
  args: CreateAssetThumbnailArgs
): Promise<AssetThumbnailLocation | null> {
  const sourceStorageBucket = normalizeText(args.sourceStorageBucket);
  const sourceStoragePath = normalizeText(args.sourceStoragePath);
  const sourceImageUrl = normalizeText(args.sourceImageUrl);

  let sourceBytes: Buffer | null = null;
  if (sourceStorageBucket && sourceStoragePath) {
    sourceBytes = await loadImageBytesFromStorage({
      adminSupabase: args.adminSupabase,
      bucket: sourceStorageBucket,
      path: sourceStoragePath,
    });
  }
  if (!sourceBytes && sourceImageUrl) {
    sourceBytes = await loadImageBytesFromUrl(sourceImageUrl);
  }
  if (!sourceBytes) return null;

  const sharp = await import("sharp");
  const thumbBytes = await sharp.default(sourceBytes)
    .rotate()
    .resize({
      width: THUMBNAIL_WIDTH_PX,
      height: THUMBNAIL_HEIGHT_PX,
      fit: "cover",
      position: "attention",
      withoutEnlargement: true,
    })
    .webp({ quality: 80 })
    .toBuffer();

  const roomPart = sanitizePathPart(args.roomId, "room");
  const assetPart = sanitizePathPart(args.assetId, "asset");
  const thumbPath = `${roomPart}/${assetPart}/thumb.webp`;

  const { error: uploadErr } = await args.adminSupabase.storage
    .from(THUMBNAILS_BUCKET)
    .upload(thumbPath, thumbBytes, {
      contentType: "image/webp",
      upsert: true,
    });
  if (uploadErr) {
    throw new Error(`Failed to upload room asset thumbnail: ${uploadErr.message}`);
  }

  return {
    thumbnail_storage_bucket: THUMBNAILS_BUCKET,
    thumbnail_storage_path: thumbPath,
  };
}

