import { createHash } from "node:crypto";

import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";
import type { RuntimeFurnitureAssetDefinition } from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import { runtimeDefinitionLeaksProvenance } from "@/lib/vibode-stage/partner-runtime-assets";

import {
  isPersonalFurnitureAssetId,
  PERSONAL_FURNITURE_BUCKET,
  PERSONAL_FURNITURE_GLB_MAX_BYTES,
  PERSONAL_FURNITURE_PENDING_LIMIT,
  PERSONAL_FURNITURE_UPLOAD_TTL_MS,
  personalFurniturePendingPath,
  personalFurniturePermanentPath,
} from "./asset-id";
import {
  normalizePersonalCategory,
  normalizePersonalDisplayName,
  personalFurnitureAssetIds,
  toPersonalLibraryItem,
  type PersonalFurnitureAssetRecord,
  type PersonalFurnitureLibraryItem,
  type PersonalFurnitureUploadRecord,
} from "./library";
import type {
  PersonalFurnitureStore,
  PersonalGlbValidator,
  PersonalObjectStore,
} from "./store";

export type PersonalFurnitureFailure = Readonly<{
  ok: false;
  status: 400 | 401 | 403 | 404 | 409 | 413 | 500;
  error: string;
  errorCode: string;
}>;

function failure(
  status: PersonalFurnitureFailure["status"],
  errorCode: string,
  error: string,
): PersonalFurnitureFailure {
  return { ok: false, status, errorCode, error };
}

export function customerMessageForPersonalGlb(codes: readonly string[]): string {
  if (codes.includes("FILE_TOO_LARGE")) {
    return "This GLB is too large. The limit is 25 MB.";
  }
  if (codes.includes("IMPLAUSIBLE_SIZE") || codes.includes("DIMENSION_MISMATCH")) {
    return "This model's dimensions are outside the supported range. One GLB unit must be one metre.";
  }
  if (codes.includes("UNSUPPORTED_REQUIRED_EXTENSION") || codes.includes("UNSUPPORTED_OPTIONAL_EXTENSION")) {
    return "This GLB uses a compression or texture format STAGE cannot read.";
  }
  return "This file isn't a supported GLB.";
}

function runtimeFromAsset(
  asset: PersonalFurnitureAssetRecord,
  signedUrl: string,
  expiresAt: string,
): RuntimeFurnitureAssetDefinition | null {
  const dto: RuntimeFurnitureAssetDefinition = {
    assetId: asset.assetId,
    glbUrl: signedUrl,
    authoredWidthM: asset.authoredWidthM,
    authoredHeightM: asset.authoredHeightM,
    authoredDepthM: asset.authoredDepthM,
    expiresAt,
  };
  if (runtimeDefinitionLeaksProvenance(dto)) return null;
  return dto;
}

export async function createPersonalFurnitureUpload(input: Readonly<{
  userId: string;
  uploadId: string;
  assetId: string;
  now: Date;
  store: PersonalFurnitureStore;
  objects: PersonalObjectStore;
}>): Promise<
  | Readonly<{ ok: true; uploadId: string; signedUrl: string; expiresAt: string }>
  | PersonalFurnitureFailure
> {
  const pendingObjectPath = personalFurniturePendingPath(input.userId, input.uploadId);
  const permanentObjectPath = personalFurniturePermanentPath(input.userId, input.assetId);
  if (!pendingObjectPath || !permanentObjectPath || !isPersonalFurnitureAssetId(input.assetId)) {
    return failure(400, "INVALID_REQUEST", "The upload could not be started.");
  }
  const expiredPaths = await input.store.expireUploads(input.userId, input.now.toISOString());
  await Promise.all(expiredPaths.map((path) => input.objects.remove(path)));
  const open = await input.store.countOpenUploads(input.userId, input.now.toISOString());
  if (open >= PERSONAL_FURNITURE_PENDING_LIMIT) {
    return failure(
      409,
      "TOO_MANY_UPLOADS",
      "Too many unfinished uploads. Wait for one to finish or expire.",
    );
  }
  const expiresAt = new Date(input.now.getTime() + PERSONAL_FURNITURE_UPLOAD_TTL_MS).toISOString();
  const upload: PersonalFurnitureUploadRecord = {
    uploadId: input.uploadId,
    userId: input.userId,
    assetId: input.assetId,
    storageBucket: PERSONAL_FURNITURE_BUCKET,
    pendingObjectPath,
    permanentObjectPath,
    status: "pending",
    resultAssetId: null,
    expiresAt,
    updatedAt: input.now.toISOString(),
  };
  await input.store.insertUpload(upload);
  const signed = await input.objects.createPendingUploadUrl(pendingObjectPath);
  if (!signed) {
    await input.store.markUploadRejected(input.userId, input.uploadId);
    return failure(500, "UPLOAD_UNAVAILABLE", "The upload could not be started.");
  }
  return { ok: true, uploadId: input.uploadId, signedUrl: signed.signedUrl, expiresAt };
}

export async function finalizePersonalFurnitureUpload(input: Readonly<{
  userId: string;
  uploadId: string;
  displayName: string;
  category?: string | null;
  now: Date;
  store: PersonalFurnitureStore;
  objects: PersonalObjectStore;
  validate: PersonalGlbValidator;
}>): Promise<
  | Readonly<{ ok: true; item: PersonalFurnitureLibraryItem; idempotent: boolean }>
  | PersonalFurnitureFailure
> {
  const displayName = normalizePersonalDisplayName(input.displayName);
  if (!displayName) {
    return failure(400, "INVALID_NAME", "Enter a name up to 80 characters.");
  }
  const category = normalizePersonalCategory(input.category);
  if (category === "invalid") {
    return failure(400, "INVALID_CATEGORY", "Category must be 40 characters or fewer.");
  }
  const existing = await input.store.readUpload(input.userId, input.uploadId);
  if (!existing || existing.userId !== input.userId) {
    return failure(404, "UPLOAD_NOT_FOUND", "That upload could not be found.");
  }
  if (existing.status === "finalized" && existing.resultAssetId) {
    const asset = await input.store.findOwnedAsset(input.userId, existing.resultAssetId);
    if (!asset) return failure(500, "ASSET_MISSING", "The saved model could not be loaded.");
    const preview = await signPreview(input.objects, asset);
    return { ok: true, item: toPersonalLibraryItem(asset, preview), idempotent: true };
  }
  if (existing.status === "finalizing") {
    const recovered = await recoverFinalizedAsset(input, existing.assetId);
    if (recovered) return recovered;
  }
  if (existing.status !== "pending" && existing.status !== "finalizing") {
    return failure(409, "UPLOAD_CLOSED", "This upload can no longer be saved.");
  }
  const claimed = await input.store.claimUpload(input.userId, input.uploadId, input.now.toISOString());
  if (claimed === "lost") {
    const again = await input.store.readUpload(input.userId, input.uploadId);
    if (again?.status === "finalized" && again.resultAssetId) {
      const asset = await input.store.findOwnedAsset(input.userId, again.resultAssetId);
      if (!asset) return failure(500, "ASSET_MISSING", "The saved model could not be loaded.");
      const preview = await signPreview(input.objects, asset);
      return { ok: true, item: toPersonalLibraryItem(asset, preview), idempotent: true };
    }
    return failure(409, "UPLOAD_IN_PROGRESS", "This upload is already being saved.");
  }
  if (!claimed) {
    return failure(409, "UPLOAD_EXPIRED", "This upload expired. Please try again.");
  }
  const bytes = await input.objects.read(claimed.pendingObjectPath);
  if (!bytes) {
    await input.store.markUploadRejected(input.userId, input.uploadId);
    return failure(400, "UPLOAD_MISSING", "The uploaded file could not be read.");
  }
  if (bytes.byteLength > PERSONAL_FURNITURE_GLB_MAX_BYTES) {
    await input.objects.remove(claimed.pendingObjectPath);
    await input.store.markUploadRejected(input.userId, input.uploadId);
    return failure(413, "FILE_TOO_LARGE", customerMessageForPersonalGlb(["FILE_TOO_LARGE"]));
  }
  const validated = await input.validate({ bytes, assetId: claimed.assetId });
  if (
    !validated.accepted ||
    validated.widthM == null ||
    validated.heightM == null ||
    validated.depthM == null
  ) {
    await input.objects.remove(claimed.pendingObjectPath);
    await input.store.markUploadRejected(input.userId, input.uploadId);
    return failure(
      400,
      "INVALID_GLB",
      customerMessageForPersonalGlb(validated.errors.map((item) => item.code)),
    );
  }
  const duplicate = await input.store.findAssetBySha(input.userId, validated.sha256);
  if (duplicate) {
    await input.objects.remove(claimed.pendingObjectPath);
    await input.store.markUploadFinalized(input.userId, input.uploadId, duplicate.assetId);
    const preview = await signPreview(input.objects, duplicate);
    return { ok: true, item: toPersonalLibraryItem(duplicate, preview), idempotent: true };
  }
  const written = await input.objects.writePermanent(claimed.permanentObjectPath, bytes);
  if (written === "failed") {
    await input.store.markUploadRejected(input.userId, input.uploadId);
    return failure(500, "STORE_FAILED", "The model could not be saved.");
  }
  if (written === "exists") {
    const stored = await input.objects.read(claimed.permanentObjectPath);
    const sameBytes = stored != null && sha256Hex(stored) === validated.sha256;
    if (!sameBytes) {
      const owner = await input.store.findOwnedAsset(input.userId, claimed.assetId);
      if (owner) {
        return failure(409, "ASSET_EXISTS", "This model was already saved.");
      }
      await input.objects.remove(claimed.permanentObjectPath);
      const rewritten = await input.objects.writePermanent(claimed.permanentObjectPath, bytes);
      if (rewritten !== "written") {
        return failure(500, "STORE_FAILED", "The model could not be saved. Please try again.");
      }
    }
  }
  const asset: PersonalFurnitureAssetRecord = {
    assetId: claimed.assetId,
    userId: input.userId,
    displayName,
    category,
    origin: "uploaded",
    authoredWidthM: validated.widthM,
    authoredHeightM: validated.heightM,
    authoredDepthM: validated.depthM,
    sha256: validated.sha256,
    byteSize: validated.byteSize,
    storageBucket: PERSONAL_FURNITURE_BUCKET,
    storageObjectPath: claimed.permanentObjectPath,
    libraryVisibility: "active",
  };
  const inserted = await input.store.insertAsset(asset);
  if (inserted === "exists") {
    const raced = await input.store.findOwnedAsset(input.userId, asset.assetId);
    if (raced?.sha256 === asset.sha256 && raced.userId === input.userId) {
      // The winning request inserted this asset. Finish this upload.
    } else {
      const sameBytes = await input.store.findAssetBySha(input.userId, asset.sha256);
      if (
        sameBytes &&
        sameBytes.userId === input.userId &&
        sameBytes.storageObjectPath !== asset.storageObjectPath
      ) {
        await input.objects.remove(asset.storageObjectPath);
        await input.objects.remove(claimed.pendingObjectPath);
        await input.store.markUploadFinalized(input.userId, input.uploadId, sameBytes.assetId);
        const preview = await signPreview(input.objects, sameBytes);
        return { ok: true, item: toPersonalLibraryItem(sameBytes, preview), idempotent: true };
      }
      await input.store.markUploadRejected(input.userId, input.uploadId);
      return failure(409, "ASSET_EXISTS", "This model was already saved.");
    }
  }
  await input.objects.remove(claimed.pendingObjectPath);
  await input.store.markUploadFinalized(input.userId, input.uploadId, asset.assetId);
  const preview = await signPreview(input.objects, asset);
  return { ok: true, item: toPersonalLibraryItem(asset, preview), idempotent: false };
}

export async function listPersonalFurniture(input: Readonly<{
  userId: string;
  store: PersonalFurnitureStore;
  objects: PersonalObjectStore;
}>): Promise<readonly PersonalFurnitureLibraryItem[]> {
  const assets = await input.store.listActive(input.userId);
  const items: PersonalFurnitureLibraryItem[] = [];
  for (const asset of assets) {
    if (asset.userId !== input.userId || asset.libraryVisibility !== "active") continue;
    const preview = await signPreview(input.objects, asset);
    items.push(toPersonalLibraryItem(asset, preview));
  }
  return items;
}

export async function archivePersonalFurniture(input: Readonly<{
  userId: string;
  assetId: string;
  store: PersonalFurnitureStore;
}>): Promise<{ ok: true } | PersonalFurnitureFailure> {
  if (!isPersonalFurnitureAssetId(input.assetId)) {
    return failure(404, "ASSET_NOT_FOUND", "That model isn't in your library.");
  }
  const result = await input.store.archiveAsset(input.userId, input.assetId);
  if (result === "missing") {
    return failure(404, "ASSET_NOT_FOUND", "That model isn't in your library.");
  }
  return { ok: true };
}

export async function placePersonalFurniture(input: Readonly<{
  userId: string;
  assetId: string;
  store: PersonalFurnitureStore;
  objects: PersonalObjectStore;
}>): Promise<
  | Readonly<{ ok: true; assetId: string; runtimeAsset: RuntimeFurnitureAssetDefinition }>
  | PersonalFurnitureFailure
> {
  if (!isPersonalFurnitureAssetId(input.assetId)) {
    return failure(404, "ASSET_NOT_FOUND", "That model isn't in your library.");
  }
  const asset = await input.store.findOwnedAsset(input.userId, input.assetId);
  if (!asset || asset.userId !== input.userId || asset.libraryVisibility !== "active") {
    return failure(404, "ASSET_NOT_FOUND", "That model isn't in your library.");
  }
  const signed = await input.objects.signGet(asset.storageObjectPath);
  if (!signed) return failure(500, "PREVIEW_UNAVAILABLE", "This model could not be opened.");
  const runtimeAsset = runtimeFromAsset(asset, signed.signedUrl, signed.expiresAt);
  if (!runtimeAsset) return failure(500, "PREVIEW_UNAVAILABLE", "This model could not be opened.");
  return { ok: true, assetId: asset.assetId, runtimeAsset };
}

export async function personalSceneAssetsAreOwned(input: Readonly<{
  userId: string;
  objects: readonly SceneObjectDefinition[];
  store: PersonalFurnitureStore;
}>): Promise<"owned" | "foreign" | "empty"> {
  const ids = personalFurnitureAssetIds(input.objects);
  if (ids.length === 0) return "empty";
  const owned = await input.store.ownedAssetIds(input.userId, ids);
  return ids.every((id) => owned.has(id)) ? "owned" : "foreign";
}

async function recoverFinalizedAsset(
  input: Readonly<{
    userId: string;
    uploadId: string;
    store: PersonalFurnitureStore;
    objects: PersonalObjectStore;
  }>,
  assetId: string,
): Promise<Readonly<{ ok: true; item: PersonalFurnitureLibraryItem; idempotent: true }> | null> {
  const recovered = await input.store.findOwnedAsset(input.userId, assetId);
  if (!recovered || recovered.userId !== input.userId) return null;
  await input.store.markUploadFinalized(input.userId, input.uploadId, recovered.assetId);
  const preview = await signPreview(input.objects, recovered);
  return { ok: true, item: toPersonalLibraryItem(recovered, preview), idempotent: true };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function signPreview(
  objects: PersonalObjectStore,
  asset: PersonalFurnitureAssetRecord,
): Promise<string | null> {
  const signed = await objects.signGet(asset.storageObjectPath);
  return signed?.signedUrl ?? null;
}
