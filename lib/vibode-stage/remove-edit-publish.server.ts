import sharp from "sharp";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  REMOVE_EDIT_CONTRACT,
  REMOVE_EDIT_MAX_PIXELS,
  base64ToBytes,
  compositeRemoveEditRgba,
  removeEditExportAdmission,
  removeEditFingerprintMaterial,
  removeEditHasChanges,
  removeEditStoragePath,
} from "@/lib/vibode-stage/remove-edit";
import type { RemoveAlignmentReport } from "@/lib/vibode-stage/remove-alignment";

const HEX64 = /^[0-9a-f]{64}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RemoveEditPublishCode =
  | "saved"
  | "already_saved"
  | "unchanged"
  | "invalid"
  | "incompatible"
  | "not_found"
  | "unavailable";

export type RemoveEditPublishResult =
  | Readonly<{ ok: true; created: boolean; assetId: string; activated: false }>
  | Readonly<{ ok: false; code: Exclude<RemoveEditPublishCode, "saved" | "already_saved"> }>;

export type RemoveEditStorage = Readonly<{
  putPng: (path: string, bytes: Uint8Array) => Promise<"stored" | "exists-same" | "exists-different" | "failed">;
  publish: (input: Readonly<{
    userId: string;
    roomId: string;
    fingerprint: string;
    afcGenerationId: string;
    parentAssetId: string | null;
    selectedAssetId: string | null;
    width: number;
    height: number;
    outputSha256: string;
    storagePath: string;
    originalSha256: string;
    emptySha256: string;
  }>) => Promise<Readonly<{ ok: true; created: boolean; assetId: string }> | Readonly<{ ok: false; code: "not_found" | "invalid" | "unavailable" }>>;
}>;

export type RemoveEditSubmission = Readonly<{
  userId: string;
  roomId: string;
  generationId: string;
  parentAssetId: string | null;
  width: number;
  height: number;
  coverageBase64: string;
  report: RemoveAlignmentReport;
  originalBytes: Uint8Array;
  emptyBytes: Uint8Array;
  originalSha256: string;
  emptySha256: string;
}>;

export async function publishPreparedRemoveEdit(
  storage: RemoveEditStorage,
  submission: RemoveEditSubmission,
): Promise<RemoveEditPublishResult> {
  if (!UUID.test(submission.userId) || !UUID.test(submission.roomId) || !UUID.test(submission.generationId)) {
    return { ok: false, code: "not_found" };
  }
  if (submission.parentAssetId !== null && !UUID.test(submission.parentAssetId)) {
    return { ok: false, code: "invalid" };
  }
  if (submission.report.generationId !== submission.generationId) {
    return { ok: false, code: "not_found" };
  }
  if (
    submission.report.original.sha256.toLowerCase() !== submission.originalSha256.toLowerCase()
    || submission.report.empty.sha256.toLowerCase() !== submission.emptySha256.toLowerCase()
    || !HEX64.test(submission.originalSha256)
    || !HEX64.test(submission.emptySha256)
  ) {
    return { ok: false, code: "invalid" };
  }
  const admission = removeEditExportAdmission(submission.report);
  if (!admission.allowed) return { ok: false, code: "incompatible" };
  if (
    submission.width !== submission.report.original.decodedWidth
    || submission.height !== submission.report.original.decodedHeight
  ) {
    return { ok: false, code: "invalid" };
  }
  const pixels = submission.width * submission.height;
  if (!Number.isInteger(pixels) || pixels < 1 || pixels > REMOVE_EDIT_MAX_PIXELS) {
    return { ok: false, code: "invalid" };
  }
  const coverage = base64ToBytes(submission.coverageBase64);
  if (!coverage || coverage.length !== pixels || !removeEditHasChanges(coverage)) {
    return { ok: false, code: coverage && coverage.length === pixels ? "unchanged" : "invalid" };
  }

  let raster: Uint8Array;
  try {
    raster = await renderRemoveEditPng({
      originalBytes: submission.originalBytes,
      emptyBytes: submission.emptyBytes,
      coverage,
      width: submission.width,
      height: submission.height,
    });
  } catch {
    return { ok: false, code: "invalid" };
  }
  const outputSha256 = sha256Hex(raster);
  const coverageSha256 = sha256Hex(coverage);
  const fingerprint = sha256Hex(new TextEncoder().encode(removeEditFingerprintMaterial({
    generationId: submission.generationId,
    originalSha256: submission.originalSha256,
    emptySha256: submission.emptySha256,
    width: submission.width,
    height: submission.height,
    coverageSha256,
  })));
  const storagePath = removeEditStoragePath(submission.roomId, fingerprint);
  const stored = await storage.putPng(storagePath, raster);
  if (stored === "failed" || stored === "exists-different") return { ok: false, code: "unavailable" };
  const published = await storage.publish({
    userId: submission.userId,
    roomId: submission.roomId,
    fingerprint,
    afcGenerationId: submission.generationId,
    parentAssetId: submission.parentAssetId,
    selectedAssetId: submission.parentAssetId,
    width: submission.width,
    height: submission.height,
    outputSha256,
    storagePath,
    originalSha256: submission.originalSha256.toLowerCase(),
    emptySha256: submission.emptySha256.toLowerCase(),
  });
  if (!published.ok) return published;
  return {
    ok: true,
    created: published.created,
    assetId: published.assetId,
    activated: false,
  };
}

export async function renderRemoveEditPng(input: Readonly<{
  originalBytes: Uint8Array;
  emptyBytes: Uint8Array;
  coverage: Uint8Array;
  width: number;
  height: number;
}>): Promise<Uint8Array> {
  const original = await decodeRgba(input.originalBytes, input.width, input.height);
  const empty = await decodeRgba(input.emptyBytes, input.width, input.height, true);
  const blended = compositeRemoveEditRgba({
    original,
    empty,
    coverage: input.coverage,
    width: input.width,
    height: input.height,
  });
  if (!blended) throw new Error("invalid composite");
  const png = await sharp(Buffer.from(blended), {
    raw: { width: input.width, height: input.height, channels: 4 },
    limitInputPixels: REMOVE_EDIT_MAX_PIXELS,
  }).png({ compressionLevel: 9 }).toBuffer();
  return new Uint8Array(png);
}

async function decodeRgba(
  bytes: Uint8Array,
  width: number,
  height: number,
  stretch = false,
): Promise<Uint8Array> {
  let pipeline = sharp(bytes, { failOn: "error", limitInputPixels: REMOVE_EDIT_MAX_PIXELS });
  if (stretch) pipeline = pipeline.resize(width, height, { fit: "fill" });
  const decoded = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (
    decoded.info.width !== width
    || decoded.info.height !== height
    || decoded.info.channels !== 4
    || decoded.data.length !== width * height * 4
  ) {
    throw new Error("dimensions");
  }
  return new Uint8Array(decoded.data);
}

export const REMOVE_EDIT_MODEL = REMOVE_EDIT_CONTRACT;
