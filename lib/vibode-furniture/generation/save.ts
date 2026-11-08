/**
 * Saves a ready generation candidate as a new private furniture asset.
 *
 * The candidate object is only read. One uniform scale is baked into the
 * GLB positions and translations, the result is validated again, and the
 * new bytes are stored at the personal asset path. STAGE then places that
 * file at scale 1. The candidate checksum, byte count, and expiry stay put.
 */

import "server-only";

import { createHash } from "node:crypto";

import { validateFurnitureAsset } from "@/lib/afc-v2-runtime/furniture-asset-validate";
import {
  FURNITURE_ASSET_PLAUSIBLE_MAX_M,
  FURNITURE_ASSET_PLAUSIBLE_MIN_M,
  isPlausibleFurnitureAxisM,
} from "@/lib/afc-v2-runtime/furniture-asset-policy";
import { isUuidLike } from "@/lib/vibode-stage/asset-id";
import {
  PERSONAL_FURNITURE_BUCKET,
  PERSONAL_FURNITURE_GLB_MAX_BYTES,
  createPersonalFurnitureAssetId,
  personalFurniturePermanentPath,
} from "@/lib/vibode-furniture/asset-id";
import {
  customerMessageForPersonalGlb,
  type PersonalFurnitureFailure,
} from "@/lib/vibode-furniture/operations";
import {
  normalizePersonalCategory,
  normalizePersonalDisplayName,
  toPersonalLibraryItem,
  type PersonalFurnitureAssetRecord,
  type PersonalFurnitureLibraryItem,
} from "@/lib/vibode-furniture/library";
import type { PersonalFurnitureStore, PersonalObjectStore } from "@/lib/vibode-furniture/store";

import { bakeUniformGlbScale } from "./bake-glb-scale";
import {
  type CalibrationAxis,
  type CalibrationFailure,
  calibrateUniformDimensions,
  calibrationTargetMatches,
  canonicalCalibrationTargetM,
  isCalibrationAxis,
  measuredMetresMatch,
} from "./calibrate";
import type {
  BucketObjectStore,
  GenerationCommands,
  GenerationSaveSource,
} from "./contracts";
import type { GenerationAuthorizer } from "./http";
import { generationObjectAllowed } from "./objects";
import { generationCandidateStillPreviewable } from "./preview-access";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SAVE_BODY_MAX_BYTES = 4096;

const FORBIDDEN_BODY_FIELDS = [
  "userId",
  "user_id",
  "assetId",
  "asset_id",
  "jobId",
  "savedAssetId",
  "sha256",
  "url",
  "signedUrl",
  "glbUrl",
  "storageObjectPath",
] as const;

export type CalibratedSaveResult =
  | Readonly<{ ok: true; idempotent: boolean; item: PersonalFurnitureLibraryItem }>
  | PersonalFurnitureFailure;

export type CalibratedSaveRequest = Readonly<{
  userId: string;
  jobId: string;
  displayName: string;
  category?: string | null;
  axis: string;
  targetM: number;
  nowMs: number;
  commands: GenerationCommands;
  objects: BucketObjectStore;
  library: PersonalFurnitureStore;
  libraryObjects: PersonalObjectStore;
}>;

type SaveBody = Readonly<{
  displayName: string;
  category: string | null;
  axis: CalibrationAxis;
  targetM: number;
}>;

export function calibratedFurnitureAssetId(input: Readonly<{
  userId: string;
  jobId: string;
  axis: CalibrationAxis;
  targetM: number;
  sourceSha256: string;
}>): string | null {
  const target = canonicalCalibrationTargetM(input.targetM);
  const userId = input.userId.trim().toLowerCase();
  const jobId = input.jobId.trim().toLowerCase();
  if (
    target == null
    || !isCalibrationAxis(input.axis)
    || !isUuidLike(userId)
    || !isUuidLike(jobId)
    || !/^[a-f0-9]{64}$/.test(input.sourceSha256)
  ) {
    return null;
  }
  const hex = createHash("sha256")
    .update([
      "vibode-calibrated-save",
      "v1",
      userId,
      jobId,
      input.axis,
      target.toFixed(6),
      input.sourceSha256,
    ].join("\n"))
    .digest("hex");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  return createPersonalFurnitureAssetId(uuid);
}

export async function saveCalibratedFurnitureCandidate(
  input: CalibratedSaveRequest,
): Promise<CalibratedSaveResult> {
  const displayName = normalizePersonalDisplayName(input.displayName);
  if (!displayName) return failure(400, "INVALID_NAME", "Enter a name up to 80 characters.");
  const category = normalizePersonalCategory(input.category);
  if (category === "invalid") {
    return failure(400, "INVALID_CATEGORY", "Category must be 40 characters or fewer.");
  }
  if (!isCalibrationAxis(input.axis)) {
    return failure(400, "INVALID_TARGET", "Choose height, width, or depth.");
  }
  const earlyTarget = canonicalCalibrationTargetM(input.targetM);
  if (earlyTarget == null) {
    return failure(400, "INVALID_TARGET", "Enter one positive height, width, or depth in metres.");
  }
  if (earlyTarget < FURNITURE_ASSET_PLAUSIBLE_MIN_M || earlyTarget > FURNITURE_ASSET_PLAUSIBLE_MAX_M) {
    return failure(400, "IMPLAUSIBLE_SIZE", "That size is outside the supported range of 0.05 m to 8 m.");
  }

  const source = await input.commands.readSaveSource(input.userId, input.jobId);
  if (!source.ok) return failure(404, "NOT_FOUND", "That generated model could not be found.");
  if (source.savedAssetId) {
    return finishSavedAsset(input, source.savedAssetId, input.axis, earlyTarget, true);
  }

  if (source.status === "ready" && source.sha256 && source.byteSize != null) {
    const assetId = calibratedFurnitureAssetId({
      userId: input.userId,
      jobId: input.jobId,
      axis: input.axis,
      targetM: earlyTarget,
      sourceSha256: source.sha256,
    });
    const existing = assetId ? await input.library.findOwnedAsset(input.userId, assetId) : null;
    if (existing) {
      return finishSavedAsset(input, existing.assetId, input.axis, earlyTarget, true, source);
    }
  }

  if (!candidateIsSaveable(source, input.userId, input.nowMs)) {
    if (
      source.status === "expired"
      || (source.status === "ready" && !generationCandidateStillPreviewable(source.expiresAtMs, input.nowMs))
    ) {
      return failure(409, "CANDIDATE_EXPIRED", "This generated model has expired.");
    }
    return failure(404, "NOT_FOUND", "That generated model could not be found.");
  }

  const candidate = await input.objects.get({ bucket: source.bucket!, path: source.path! });
  if (!candidate) return failure(404, "CANDIDATE_MISSING", "That generated model is no longer available.");
  const sourceSha = sha256Hex(candidate);
  if (sourceSha !== source.sha256 || candidate.byteLength !== source.byteSize) {
    return failure(409, "SOURCE_MISMATCH", "This generated model could not be saved.");
  }
  const assetId = calibratedFurnitureAssetId({
    userId: input.userId,
    jobId: input.jobId,
    axis: input.axis,
    targetM: earlyTarget,
    sourceSha256: sourceSha,
  });
  const permanentPath = assetId ? personalFurniturePermanentPath(input.userId, assetId) : null;
  if (!assetId || !permanentPath || permanentPath === source.path) {
    return failure(500, "SAVE_FAILED", "The model could not be saved. Please try again.");
  }

  const measuredSource = await measureGlb(candidate, assetId);
  if (!measuredSource.ok) return measuredSource.failure;
  const calibration = calibrateUniformDimensions({
    measured: measuredSource.measured,
    axis: input.axis,
    targetM: earlyTarget,
  });
  if (!calibration.ok) return calibrationFailure(calibration.code);

  const baked = bakeUniformGlbScale(candidate, calibration.calibration.factor);
  if (!baked.ok) {
    return failure(400, "INVALID_GLB", "This generated model cannot be calibrated.");
  }
  if (sha256Hex(candidate) !== sourceSha) {
    return failure(500, "SAVE_FAILED", "The model could not be saved. Please try again.");
  }
  const measuredBaked = await measureGlb(baked.bytes, assetId);
  if (!measuredBaked.ok) return measuredBaked.failure;
  if (
    !measuredMetresMatch(measuredBaked.measured, calibration.calibration)
    || !isPlausibleFurnitureAxisM(measuredBaked.measured.widthM)
    || !isPlausibleFurnitureAxisM(measuredBaked.measured.heightM)
    || !isPlausibleFurnitureAxisM(measuredBaked.measured.depthM)
    || measuredBaked.byteSize > PERSONAL_FURNITURE_GLB_MAX_BYTES
  ) {
    return failure(500, "BAKE_MISMATCH", "The model could not be calibrated.");
  }

  const asset: PersonalFurnitureAssetRecord = {
    assetId,
    userId: input.userId,
    displayName,
    category,
    origin: "uploaded",
    authoredWidthM: measuredBaked.measured.widthM,
    authoredHeightM: measuredBaked.measured.heightM,
    authoredDepthM: measuredBaked.measured.depthM,
    sha256: measuredBaked.sha256,
    byteSize: measuredBaked.byteSize,
    storageBucket: PERSONAL_FURNITURE_BUCKET,
    storageObjectPath: permanentPath,
    libraryVisibility: "active",
  };

  try {
    const duplicate = await input.library.findAssetBySha(input.userId, asset.sha256);
    if (duplicate) {
      if (duplicate.userId !== input.userId || !assetMatchesTarget(duplicate, input.axis, earlyTarget)) {
        return failure(409, "ASSET_EXISTS", "This model was already saved.");
      }
      return finishSavedAsset(input, duplicate.assetId, input.axis, earlyTarget, true, source);
    }
    const written = await input.libraryObjects.writePermanent(permanentPath, baked.bytes);
    if (written === "failed") return failure(500, "STORE_FAILED", "The model could not be saved. Please try again.");
    if (written === "exists") {
      const stored = await input.libraryObjects.read(permanentPath);
      if (!stored || sha256Hex(stored) !== asset.sha256) {
        return failure(409, "ASSET_EXISTS", "This model was already saved.");
      }
    }
    const inserted = await input.library.insertAsset(asset);
    if (inserted === "exists") {
      const raced = await input.library.findOwnedAsset(input.userId, asset.assetId);
      if (!raced || raced.userId !== input.userId || raced.sha256 !== asset.sha256) {
        const sameBytes = await input.library.findAssetBySha(input.userId, asset.sha256);
        if (
          sameBytes
          && sameBytes.userId === input.userId
          && assetMatchesTarget(sameBytes, input.axis, earlyTarget)
        ) {
          if (sameBytes.storageObjectPath !== permanentPath) {
            await input.libraryObjects.remove(permanentPath);
          }
          return finishSavedAsset(input, sameBytes.assetId, input.axis, earlyTarget, true, source);
        }
        return failure(409, "ASSET_EXISTS", "This model was already saved.");
      }
    }
    const linked = await input.commands.linkSavedAsset({
      userId: input.userId,
      jobId: input.jobId,
      assetId: asset.assetId,
      sourceSha256: sourceSha,
      sourceByteSize: candidate.byteLength,
      assetSha256: asset.sha256,
      assetByteSize: asset.byteSize,
      nowMs: input.nowMs,
    });
    if (!linked.ok) {
      const again = await input.commands.readSaveSource(input.userId, input.jobId);
      if (!again.ok || again.savedAssetId !== asset.assetId) {
        return failure(500, "SAVE_INCOMPLETE", "The model could not be finished. Please try again.");
      }
    }
    return present(input.libraryObjects, asset, false);
  } catch {
    return failure(500, "SAVE_FAILED", "The model could not be saved. Please try again.");
  }
}

export async function postCalibratedFurnitureSave(
  request: Request,
  deps: Readonly<{
    authorize: GenerationAuthorizer;
    commands: GenerationCommands;
    objects: BucketObjectStore;
    library: PersonalFurnitureStore;
    libraryObjects: PersonalObjectStore;
    nowMs: () => number;
  }>,
  jobId: string,
): Promise<{ status: number; body: unknown }> {
  const caller = await deps.authorize(request);
  if (!caller.ok) return caller.response;
  if (!UUID.test(jobId)) {
    return json(404, { ok: false, error: "That generated model could not be found." });
  }
  let body: SaveBody | null;
  try {
    body = parseSaveBody(JSON.parse(await readBodyText(request, SAVE_BODY_MAX_BYTES)));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return json(413, { ok: false, error: "The save request is too large." });
    }
    return json(400, { ok: false, error: "The save request could not be read." });
  }
  if (!body) return json(400, { ok: false, error: "The save request could not be read." });
  try {
    const saved = await saveCalibratedFurnitureCandidate({
      userId: caller.userId,
      jobId,
      displayName: body.displayName,
      category: body.category,
      axis: body.axis,
      targetM: body.targetM,
      nowMs: deps.nowMs(),
      commands: deps.commands,
      objects: deps.objects,
      library: deps.library,
      libraryObjects: deps.libraryObjects,
    });
    if (!saved.ok) {
      return json(saved.status, { ok: false, error: saved.error, errorCode: saved.errorCode });
    }
    return json(200, { ok: true, item: saved.item, idempotent: saved.idempotent });
  } catch {
    return json(500, { ok: false, error: "The model could not be saved." });
  }
}

function candidateIsSaveable(
  source: GenerationSaveSource,
  userId: string,
  nowMs: number,
): source is GenerationSaveSource & { bucket: string; path: string; sha256: string; byteSize: number } {
  return source.status === "ready"
    && typeof source.bucket === "string"
    && typeof source.path === "string"
    && typeof source.sha256 === "string"
    && typeof source.byteSize === "number"
    && source.byteSize > 0
    && generationObjectAllowed(source.bucket, source.path, userId)
    && generationCandidateStillPreviewable(source.expiresAtMs, nowMs);
}

async function finishSavedAsset(
  input: CalibratedSaveRequest,
  assetId: string,
  axis: CalibrationAxis,
  targetM: number,
  idempotent: boolean,
  source?: GenerationSaveSource,
): Promise<CalibratedSaveResult> {
  const asset = await input.library.findOwnedAsset(input.userId, assetId);
  if (!asset || asset.userId !== input.userId) {
    return failure(500, "ASSET_MISSING", "The saved model could not be loaded.");
  }
  if (!assetMatchesTarget(asset, axis, targetM)) {
    return failure(409, "ALREADY_SAVED", "This generated model was already saved at a different size.");
  }
  const intact = await input.libraryObjects.read(asset.storageObjectPath);
  if (!intact || intact.byteLength !== asset.byteSize || sha256Hex(intact) !== asset.sha256) {
    return failure(500, "ASSET_MISSING", "The saved model could not be loaded.");
  }
  if (source && source.savedAssetId !== asset.assetId && source.status === "ready") {
    const linked = await linkReadyAsset(input, source, asset);
    if (linked === "failed") {
      return failure(500, "SAVE_INCOMPLETE", "The model could not be finished. Please try again.");
    }
  }
  return present(input.libraryObjects, asset, idempotent);
}

async function linkReadyAsset(
  input: CalibratedSaveRequest,
  source: GenerationSaveSource,
  asset: PersonalFurnitureAssetRecord,
): Promise<"linked" | "failed"> {
  if (!generationCandidateStillPreviewable(source.expiresAtMs, input.nowMs)) return "linked";
  if (!source.sha256 || source.byteSize == null) return "failed";
  const linked = await input.commands.linkSavedAsset({
    userId: input.userId,
    jobId: input.jobId,
    assetId: asset.assetId,
    sourceSha256: source.sha256,
    sourceByteSize: source.byteSize,
    assetSha256: asset.sha256,
    assetByteSize: asset.byteSize,
    nowMs: input.nowMs,
  });
  if (linked.ok || linked.code === "already_saved" || linked.code === "expired") return "linked";
  return "failed";
}

async function present(
  objects: PersonalObjectStore,
  asset: PersonalFurnitureAssetRecord,
  idempotent: boolean,
): Promise<CalibratedSaveResult> {
  const signed = await objects.signGet(asset.storageObjectPath);
  return {
    ok: true,
    idempotent,
    item: toPersonalLibraryItem(asset, signed?.signedUrl ?? null),
  };
}

async function measureGlb(
  bytes: Uint8Array,
  assetId: string,
): Promise<
  | { ok: true; measured: { widthM: number; heightM: number; depthM: number }; sha256: string; byteSize: number }
  | { ok: false; failure: PersonalFurnitureFailure }
> {
  const result = await validateFurnitureAsset({
    bytes,
    glbPath: "calibrated-furniture.glb",
    assetId,
    dimensionAuthority: "measured",
    maxBytes: PERSONAL_FURNITURE_GLB_MAX_BYTES,
  });
  if (
    !result.accepted
    || result.placementScale !== 1
    || result.measured == null
  ) {
    const codes = result.errors.map((item) => item.code);
    if (result.placementScale != null && result.placementScale !== 1) codes.push("NON_UNIT_PLACEMENT_SCALE");
    const status = codes.includes("FILE_TOO_LARGE") ? 413 : 400;
    return {
      ok: false,
      failure: failure(status, codes[0] ?? "INVALID_GLB", customerMessageForPersonalGlb(codes)),
    };
  }
  return {
    ok: true,
    measured: result.measured,
    sha256: result.sha256,
    byteSize: result.fileSizeBytes,
  };
}

function assetMatchesTarget(
  asset: PersonalFurnitureAssetRecord,
  axis: CalibrationAxis,
  targetM: number,
): boolean {
  const actual = axis === "width"
    ? asset.authoredWidthM
    : axis === "height"
      ? asset.authoredHeightM
      : asset.authoredDepthM;
  return calibrationTargetMatches(actual, targetM);
}

function calibrationFailure(code: CalibrationFailure): PersonalFurnitureFailure {
  if (code === "implausible_result") {
    return failure(400, "IMPLAUSIBLE_SIZE", "That size is outside the supported range of 0.05 m to 8 m.");
  }
  if (code === "invalid_axis") return failure(400, "INVALID_TARGET", "Choose height, width, or depth.");
  return failure(400, "INVALID_TARGET", "Enter one positive height, width, or depth in metres.");
}

function failure(
  status: PersonalFurnitureFailure["status"],
  errorCode: string,
  error: string,
): PersonalFurnitureFailure {
  return { ok: false, status, errorCode, error };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseSaveBody(value: unknown): SaveBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (FORBIDDEN_BODY_FIELDS.some((key) => key in record)) return null;
  if (typeof record.displayName !== "string") return null;
  if (record.category != null && typeof record.category !== "string") return null;
  if (typeof record.axis !== "string" || !isCalibrationAxis(record.axis)) return null;
  if (typeof record.targetM !== "number" || !Number.isFinite(record.targetM)) return null;
  return {
    displayName: record.displayName,
    category: typeof record.category === "string" ? record.category : null,
    axis: record.axis,
    targetM: record.targetM,
  };
}

class BodyTooLargeError extends Error {}

async function readBodyText(request: Request, maxBytes: number): Promise<string> {
  const body = request.body;
  if (!body) {
    const text = await request.text();
    if (Buffer.byteLength(text) > maxBytes) throw new BodyTooLargeError();
    return text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLargeError();
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(status: number, body: unknown): { status: number; body: unknown } {
  return { status, body };
}
