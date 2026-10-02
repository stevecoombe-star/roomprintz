import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { PARTNER_ASSET_INTAKE_BUCKET, PARTNER_ASSET_INTAKE_MAX_BYTES } from "@/lib/vibode-stage/partner-asset-intake";
import {
  STAGE_ASSET_STORAGE_TABLE,
  STAGE_PARTNER_ASSETS_TABLE,
} from "@/lib/vibode-stage/partner-asset-register";
import { partnerRuntimeAssetObjectPath } from "@/lib/vibode-stage/partner-runtime-asset-id";
import { resolvePartnerPortalContext } from "@/lib/vibode-stage/partner-portal-auth.server";
import { VIBODE_3D_THUMBNAIL_CACHE_MAX_AGE_SEC } from "@/lib/vibode-thumbnail-jobs/policy";

import { encodeModelThumbnailWebp } from "./encode";
import { staticModelThumbnailSha } from "./identity";
import {
  VIBODE_MODEL_THUMBNAIL_BUCKET,
  VIBODE_MODEL_THUMBNAIL_DISPLAY_URL_EXPIRES_SEC,
  VIBODE_MODEL_THUMBNAIL_MAX_IMAGE_BYTES,
  VIBODE_STAGE_MODEL_THUMBNAILS_TABLE,
  isDisplayableModelThumbnailUrl,
  isModelThumbnailAssetId,
  isModelThumbnailSha256,
  modelThumbnailObjectPath,
} from "./policy";
import { isGlbBytes, isStaticModelGlbUrl, staticGlbUrlForAsset } from "./source";

type AnySupabase = SupabaseClient;

export type PartnerModelThumbnailDenied = Readonly<{
  ok: false;
  status: number;
  error: string;
  errorCode: string;
}>;

type PartnerModelThumbnailGrant = Readonly<{
  ok: true;
  supabase: AnySupabase;
  assetId: string;
}>;

async function partnerOwnsAsset(
  supabase: AnySupabase,
  partnerId: string,
  assetId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(STAGE_PARTNER_ASSETS_TABLE)
    .select("asset_id")
    .eq("partner_id", partnerId)
    .eq("asset_id", assetId)
    .maybeSingle();
  return !error && typeof (data as { asset_id?: unknown } | null)?.asset_id === "string";
}

export async function authorizePartnerModelThumbnail(
  assetId: string,
): Promise<PartnerModelThumbnailGrant | PartnerModelThumbnailDenied> {
  const trimmed = assetId.trim();
  if (!isModelThumbnailAssetId(trimmed)) {
    return { ok: false, status: 404, error: "Model not found.", errorCode: "ASSET_NOT_FOUND" };
  }
  const auth = await resolvePartnerPortalContext();
  if (!auth.ok) {
    return {
      ok: false,
      status: auth.status,
      error: auth.error,
      errorCode: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
    };
  }
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    return {
      ok: false,
      status: 500,
      error: "Partner Portal is unavailable.",
      errorCode: "SERVICE_UNAVAILABLE",
    };
  }
  const owned = await partnerOwnsAsset(supabase, auth.context.partnerId, trimmed);
  if (!owned) {
    return { ok: false, status: 404, error: "Model not found.", errorCode: "ASSET_NOT_FOUND" };
  }
  return { ok: true, supabase, assetId: trimmed };
}

async function sourceSha256(
  supabase: AnySupabase,
  assetId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from(STAGE_ASSET_STORAGE_TABLE)
    .select("sha256")
    .eq("asset_id", assetId)
    .maybeSingle();
  if (error) return null;
  const sha = typeof (data as { sha256?: unknown } | null)?.sha256 === "string"
    ? (data as { sha256: string }).sha256
    : "";
  if (isModelThumbnailSha256(sha)) return sha;
  const glbUrl = staticGlbUrlForAsset(assetId);
  return glbUrl ? staticModelThumbnailSha(assetId, glbUrl) : null;
}

async function readStaticGlb(glbUrl: string): Promise<Uint8Array | null> {
  if (!isStaticModelGlbUrl(glbUrl)) return null;
  const root = path.resolve(process.cwd(), "public");
  const resolved = path.resolve(root, glbUrl.slice(1));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
  try {
    const bytes = new Uint8Array(await readFile(resolved));
    if (bytes.byteLength === 0 || bytes.byteLength > PARTNER_ASSET_INTAKE_MAX_BYTES) return null;
    return isGlbBytes(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

export async function readPartnerModelGlb(
  supabase: AnySupabase,
  assetId: string,
): Promise<Uint8Array | null> {
  const expectedPath = partnerRuntimeAssetObjectPath(assetId);
  const { data, error } = await supabase
    .from(STAGE_ASSET_STORAGE_TABLE)
    .select("storage_bucket, storage_object_path")
    .eq("asset_id", assetId)
    .maybeSingle();
  const row = data as { storage_bucket?: unknown; storage_object_path?: unknown } | null;
  const bucket = typeof row?.storage_bucket === "string" ? row.storage_bucket : "";
  const objectPath = typeof row?.storage_object_path === "string" ? row.storage_object_path : "";
  if (error) return null;
  if (bucket || objectPath) {
    if (bucket !== PARTNER_ASSET_INTAKE_BUCKET || !expectedPath || objectPath !== expectedPath) {
      return null;
    }
    const downloaded = await supabase.storage.from(bucket).download(objectPath);
    if (downloaded.error || !downloaded.data) return null;
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    if (
      bytes.byteLength === 0 ||
      bytes.byteLength > PARTNER_ASSET_INTAKE_MAX_BYTES ||
      !isGlbBytes(bytes)
    ) {
      return null;
    }
    return bytes;
  }
  const glbUrl = staticGlbUrlForAsset(assetId);
  return glbUrl ? readStaticGlb(glbUrl) : null;
}

function logThumbnailPersistFailure(input: Readonly<{
  stage: "storage_upload" | "thumbnail_upsert";
  assetId: string;
  errorCode: string;
  message: string;
}>): void {
  const message = input.message.replace(/\s+/g, " ").trim() || "unknown error";
  console.error(
    `[model-thumbnail] persist failed stage=${input.stage} assetId=${input.assetId} errorCode=${input.errorCode} message=${message}`,
  );
}

async function signThumbnail(
  supabase: AnySupabase,
  storagePath: string,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(VIBODE_MODEL_THUMBNAIL_BUCKET)
    .createSignedUrl(storagePath, VIBODE_MODEL_THUMBNAIL_DISPLAY_URL_EXPIRES_SEC);
  const signedUrl = typeof data?.signedUrl === "string" ? data.signedUrl : "";
  if (error || !isDisplayableModelThumbnailUrl(signedUrl)) return null;
  return signedUrl;
}

async function rememberThumbnailFailure(
  supabase: AnySupabase,
  assetId: string,
  code: string,
  message: string,
): Promise<void> {
  const { error } = await supabase.from(VIBODE_STAGE_MODEL_THUMBNAILS_TABLE).upsert({
    asset_id: assetId,
    last_error_code: code.slice(0, 80),
    last_error_message: message.slice(0, 240),
  }, { onConflict: "asset_id" });
  if (error) console.error("[model-thumbnail] failure was not recorded", error.message);
}

export async function savePartnerModelThumbnail(
  supabase: AnySupabase,
  assetId: string,
  image: Uint8Array,
): Promise<
  | Readonly<{ ok: true; thumbnailUrl: string | null }>
  | Readonly<{ ok: false; status: number; error: string; errorCode: string }>
> {
  if (image.byteLength === 0 || image.byteLength > VIBODE_MODEL_THUMBNAIL_MAX_IMAGE_BYTES) {
    return { ok: false, status: 413, error: "Thumbnail image is too large.", errorCode: "IMAGE_TOO_LARGE" };
  }
  const webp = await encodeModelThumbnailWebp(image);
  const sha = await sourceSha256(supabase, assetId);
  const storagePath = sha ? modelThumbnailObjectPath(assetId, sha) : null;
  if (!webp || !sha || !storagePath) {
    await rememberThumbnailFailure(supabase, assetId, "encode_failed", "Thumbnail image could not be stored.");
    return { ok: false, status: 422, error: "Thumbnail image could not be stored.", errorCode: "ENCODE_FAILED" };
  }
  const uploaded = await supabase.storage.from(VIBODE_MODEL_THUMBNAIL_BUCKET).upload(storagePath, webp, {
    contentType: "image/webp",
    cacheControl: String(VIBODE_3D_THUMBNAIL_CACHE_MAX_AGE_SEC),
    upsert: true,
  });
  if (uploaded.error) {
    logThumbnailPersistFailure({
      stage: "storage_upload",
      assetId,
      errorCode: String(uploaded.error.statusCode || uploaded.error.name || "UPLOAD_FAILED"),
      message: uploaded.error.message,
    });
    await rememberThumbnailFailure(supabase, assetId, "upload_failed", "Thumbnail image could not be stored.");
    return { ok: false, status: 500, error: "Thumbnail image could not be stored.", errorCode: "UPLOAD_FAILED" };
  }
  const { error } = await supabase.from(VIBODE_STAGE_MODEL_THUMBNAILS_TABLE).upsert({
    asset_id: assetId,
    source_sha256: sha,
    storage_bucket: VIBODE_MODEL_THUMBNAIL_BUCKET,
    storage_path: storagePath,
    last_error_code: null,
    last_error_message: null,
    generated_at: new Date().toISOString(),
  }, { onConflict: "asset_id" });
  if (error) {
    logThumbnailPersistFailure({
      stage: "thumbnail_upsert",
      assetId,
      errorCode: error.code || "PERSIST_FAILED",
      message: error.message,
    });
    return { ok: false, status: 500, error: "Thumbnail image could not be stored.", errorCode: "PERSIST_FAILED" };
  }
  return { ok: true, thumbnailUrl: await signThumbnail(supabase, storagePath) };
}

export async function attachModelThumbnailUrls<T extends Readonly<{ assetId: string }>>(
  assets: readonly T[],
): Promise<Array<T & { thumbnailUrl: string | null }>> {
  const blank = assets.map((asset) => ({ ...asset, thumbnailUrl: null as string | null }));
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase || assets.length === 0) return blank;
  const ids = [...new Set(assets.map((asset) => asset.assetId))];
  const { data, error } = await supabase
    .from(VIBODE_STAGE_MODEL_THUMBNAILS_TABLE)
    .select("asset_id, storage_bucket, storage_path")
    .in("asset_id", ids);
  if (error || !Array.isArray(data)) return blank;
  const paths: string[] = [];
  const pathToAsset = new Map<string, string>();
  for (const value of data) {
    const row = value as Record<string, unknown>;
    const assetId = typeof row.asset_id === "string" ? row.asset_id : "";
    const storagePath = typeof row.storage_path === "string" ? row.storage_path : "";
    if (row.storage_bucket !== VIBODE_MODEL_THUMBNAIL_BUCKET || !assetId || !storagePath) continue;
    paths.push(storagePath);
    pathToAsset.set(storagePath, assetId);
  }
  if (paths.length === 0) return blank;
  const { data: signed, error: signError } = await supabase.storage
    .from(VIBODE_MODEL_THUMBNAIL_BUCKET)
    .createSignedUrls(paths, VIBODE_MODEL_THUMBNAIL_DISPLAY_URL_EXPIRES_SEC);
  if (signError || !Array.isArray(signed)) return blank;
  const urls = new Map<string, string>();
  for (const item of signed) {
    const storagePath = typeof item.path === "string" ? item.path : "";
    const signedUrl = typeof item.signedUrl === "string" ? item.signedUrl : "";
    const assetId = pathToAsset.get(storagePath);
    if (!assetId || !signedUrl || item.error || !isDisplayableModelThumbnailUrl(signedUrl)) continue;
    urls.set(assetId, signedUrl);
  }
  return assets.map((asset) => ({
    ...asset,
    thumbnailUrl: urls.get(asset.assetId) ?? null,
  }));
}
