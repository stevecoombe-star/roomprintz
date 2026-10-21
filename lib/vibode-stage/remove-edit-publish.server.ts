import sharp from "sharp";

import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  REMOVE_EDIT_CONTRACT,
  REMOVE_EDIT_MAX_PIXELS,
  base64ToBytes,
  compositeRemoveEditRgba,
  mapRemoveCoverageToKeepGrid,
  removeEditExportAdmission,
  removeEditFingerprintMaterial,
  removeEditHasChanges,
  removeEditKeepAdmission,
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
  | "stale"
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
    keepSha256: string;
    coverageWidth: number;
    coverageHeight: number;
  }>) => Promise<Readonly<{ ok: true; created: boolean; assetId: string }> | Readonly<{ ok: false; code: "not_found" | "invalid" | "unavailable" }>>;
}>;

export type RemoveEditSubmission = Readonly<{
  userId: string;
  roomId: string;
  generationId: string;
  parentAssetId: string;
  coverageWidth: number;
  coverageHeight: number;
  coverageBase64: string;
  report: RemoveAlignmentReport;
  keepBytes: Uint8Array;
  emptyBytes: Uint8Array;
  keepSha256: string;
  keepWidth: number;
  keepHeight: number;
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
  if (!UUID.test(submission.parentAssetId)) return { ok: false, code: "not_found" };
  if (submission.report.generationId !== submission.generationId) {
    return { ok: false, code: "not_found" };
  }
  if (
    submission.report.original.sha256.toLowerCase() !== submission.originalSha256.toLowerCase()
    || submission.report.empty.sha256.toLowerCase() !== submission.emptySha256.toLowerCase()
    || !HEX64.test(submission.originalSha256)
    || !HEX64.test(submission.emptySha256)
    || !HEX64.test(submission.keepSha256)
  ) {
    return { ok: false, code: "invalid" };
  }
  if (sha256Hex(submission.keepBytes) !== submission.keepSha256.toLowerCase()) {
    return { ok: false, code: "stale" };
  }
  const admission = removeEditExportAdmission(submission.report);
  const keepAdmission = removeEditKeepAdmission({
    keepWidth: submission.keepWidth,
    keepHeight: submission.keepHeight,
    emptyWidth: submission.report.empty.decodedWidth,
    emptyHeight: submission.report.empty.decodedHeight,
  });
  if (!admission.allowed || !keepAdmission.allowed) return { ok: false, code: "incompatible" };
  if (
    submission.coverageWidth !== submission.report.original.decodedWidth
    || submission.coverageHeight !== submission.report.original.decodedHeight
  ) {
    return { ok: false, code: "invalid" };
  }
  const coveragePixels = submission.coverageWidth * submission.coverageHeight;
  const keepPixels = submission.keepWidth * submission.keepHeight;
  if (
    !Number.isInteger(coveragePixels)
    || coveragePixels < 1
    || coveragePixels > REMOVE_EDIT_MAX_PIXELS
    || !Number.isInteger(keepPixels)
    || keepPixels < 1
    || keepPixels > REMOVE_EDIT_MAX_PIXELS
  ) {
    return { ok: false, code: "invalid" };
  }
  const coverage = base64ToBytes(submission.coverageBase64);
  if (!coverage || coverage.length !== coveragePixels || !removeEditHasChanges(coverage)) {
    return { ok: false, code: coverage && coverage.length === coveragePixels ? "unchanged" : "invalid" };
  }

  let raster: Uint8Array;
  try {
    raster = await renderRemoveEditPng({
      keepBytes: submission.keepBytes,
      emptyBytes: submission.emptyBytes,
      coverage,
      coverageWidth: submission.coverageWidth,
      coverageHeight: submission.coverageHeight,
      keepWidth: submission.keepWidth,
      keepHeight: submission.keepHeight,
    });
  } catch {
    return { ok: false, code: "invalid" };
  }
  const outputSha256 = sha256Hex(raster);
  const coverageSha256 = sha256Hex(coverage);
  const fingerprint = sha256Hex(new TextEncoder().encode(removeEditFingerprintMaterial({
    generationId: submission.generationId,
    keepAssetId: submission.parentAssetId,
    keepSha256: submission.keepSha256,
    originalSha256: submission.originalSha256,
    emptySha256: submission.emptySha256,
    keepWidth: submission.keepWidth,
    keepHeight: submission.keepHeight,
    coverageWidth: submission.coverageWidth,
    coverageHeight: submission.coverageHeight,
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
    width: submission.keepWidth,
    height: submission.keepHeight,
    outputSha256,
    storagePath,
    originalSha256: submission.originalSha256.toLowerCase(),
    emptySha256: submission.emptySha256.toLowerCase(),
    keepSha256: submission.keepSha256.toLowerCase(),
    coverageWidth: submission.coverageWidth,
    coverageHeight: submission.coverageHeight,
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
  keepBytes: Uint8Array;
  emptyBytes: Uint8Array;
  coverage: Uint8Array;
  coverageWidth: number;
  coverageHeight: number;
  keepWidth: number;
  keepHeight: number;
}>): Promise<Uint8Array> {
  const keep = await decodeRgba(input.keepBytes, input.keepWidth, input.keepHeight);
  const empty = await decodeRgba(input.emptyBytes, input.keepWidth, input.keepHeight, true);
  const mapped = mapRemoveCoverageToKeepGrid({
    coverage: input.coverage,
    coverageWidth: input.coverageWidth,
    coverageHeight: input.coverageHeight,
    keepWidth: input.keepWidth,
    keepHeight: input.keepHeight,
  });
  if (!mapped) throw new Error("invalid coverage");
  const blended = compositeRemoveEditRgba({
    keep,
    empty,
    coverage: mapped,
    width: input.keepWidth,
    height: input.keepHeight,
  });
  if (!blended) throw new Error("invalid composite");
  const png = await sharp(Buffer.from(blended), {
    raw: { width: input.keepWidth, height: input.keepHeight, channels: 4 },
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
