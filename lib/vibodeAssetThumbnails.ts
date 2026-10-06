import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabaseClient = SupabaseClient;

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

export const VIBODE_2D_THUMBNAIL_WIDTH_PX = THUMBNAIL_WIDTH_PX;
export const VIBODE_2D_THUMBNAIL_HEIGHT_PX = THUMBNAIL_HEIGHT_PX;
export const VIBODE_2D_THUMBNAIL_WEBP_QUALITY = 80;

export function vibode2dThumbnailBucket(): string {
  return THUMBNAILS_BUCKET;
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizePathPart(value: string, fallback: string) {
  const normalized = value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

export function vibode2dThumbnailObjectPath(roomId: string, assetId: string): string {
  const roomPart = sanitizePathPart(roomId, "room");
  const assetPart = sanitizePathPart(assetId, "asset");
  return `${roomPart}/${assetPart}/thumb.webp`;
}

export function isVibodeWebp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 12) return false;
  const riff = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  const webp = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
  return riff === "RIFF" && webp === "WEBP";
}

export async function renderVibode2dThumbnail(sourceBytes: Buffer): Promise<Buffer> {
  const sharp = await import("sharp");
  return sharp.default(sourceBytes)
    .rotate()
    .resize({
      width: VIBODE_2D_THUMBNAIL_WIDTH_PX,
      height: VIBODE_2D_THUMBNAIL_HEIGHT_PX,
      fit: "cover",
      position: "attention",
      withoutEnlargement: true,
    })
    .webp({ quality: VIBODE_2D_THUMBNAIL_WEBP_QUALITY })
    .toBuffer();
}

export async function readVibodeImageDimensions(
  bytes: Buffer,
): Promise<{ width: number | null; height: number | null }> {
  const sharp = await import("sharp");
  const metadata = await sharp.default(bytes).metadata();
  return {
    width: typeof metadata.width === "number" ? metadata.width : null,
    height: typeof metadata.height === "number" ? metadata.height : null,
  };
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

  const thumbBytes = await renderVibode2dThumbnail(sourceBytes);
  const thumbPath = vibode2dThumbnailObjectPath(args.roomId, args.assetId);
  const thumbnailBucket = vibode2dThumbnailBucket();

  // This key is upserted on creation retries, so leave Cache-Control at the
  // storage default. A long max-age would keep replaced bytes.
  const { error: uploadErr } = await args.adminSupabase.storage
    .from(thumbnailBucket)
    .upload(thumbPath, thumbBytes, {
      contentType: "image/webp",
      upsert: true,
    });
  if (uploadErr) {
    throw new Error(`Failed to upload room asset thumbnail: ${uploadErr.message}`);
  }

  return {
    thumbnail_storage_bucket: thumbnailBucket,
    thumbnail_storage_path: thumbPath,
  };
}
