import "server-only";

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { loadP2S2BHoldoutOracleEmptyImage } from "./p2-s2b-holdout-oracle-image";
import {
  P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB,
  P2_S2B_CERTIFIED_REGION_MODULE_BLOB,
  type P2S2BFrozenPredictionReceipt,
  hashP2S2BPredictionReceipt,
  parseP2S2BFrozenPredictionReceipt,
  readP2S2BFrozenHoldout,
} from "./p2-s2b-holdout-prediction";
import {
  type P2S2BFrozenReviewRoomId,
} from "./p2-s2b-frozen-prediction-review";

export const P2_S2B_FROZEN_REVIEW_RECEIPT_HASHES = Object.freeze({
  "room-b": "fbf7f3fafdb1a0eff9ccb0677755c7ceef2d1e08a4016ee6752aa7365bbad15e",
  "room-d": "fd7673799be656c8cbd1ed910885a97e8e5965afa0af8c79c9e228a31bfc43e2",
} as const);

export type P2S2BFrozenReviewVerifiedReceipt = Readonly<{
  ok: true;
  receipt: P2S2BFrozenPredictionReceipt;
  receiptSha256: string;
}>;

export type P2S2BFrozenReviewReceiptVerification =
  | P2S2BFrozenReviewVerifiedReceipt
  | Readonly<{
      ok: false;
      code:
        | "receipt_json_invalid"
        | "receipt_schema_invalid"
        | "receipt_room_mismatch"
        | "receipt_sidecar_invalid"
        | "receipt_hash_mismatch";
    }>;

type ModuleBlobs = Readonly<{
  regionModuleBlob: string;
  fragmentModuleBlob: string;
}>;

export type P2S2BFrozenMaskReconstruction =
  | Readonly<{
      ok: true;
      pngBytes: Uint8Array;
      componentMaskSha256: string;
      moduleBlobs: ModuleBlobs;
    }>
  | Readonly<{
      ok: false;
      code: "frozen_mask_reconstruction_unavailable";
      reason:
        | "receipt_unverified"
        | "receipt_outcome_unavailable"
        | "module_blob_mismatch"
        | "certified_empty_unavailable"
        | "frozen_reader_failed"
        | "mask_shape_mismatch"
        | "component_mask_hash_mismatch"
        | "mask_encoding_failed";
    }>;

const RECEIPT_ROOT = path.join(
  process.cwd(),
  "app",
  "admin",
  "3d-room-lab",
  "research",
  "fixtures",
  "p2-s2b-holdout-predictions"
);
const RESEARCH_ROOT = path.join(
  process.cwd(),
  "app",
  "admin",
  "3d-room-lab",
  "research"
);
const SHA_256 = /^[a-f0-9]{64}$/;

function gitBlobSha1(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.byteLength}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

export function verifyP2S2BFrozenReviewReceipt(
  roomId: P2S2BFrozenReviewRoomId,
  rawJson: string,
  rawSidecar: string
): P2S2BFrozenReviewReceiptVerification {
  let value: unknown;
  try {
    value = JSON.parse(rawJson) as unknown;
  } catch {
    return { ok: false, code: "receipt_json_invalid" };
  }
  const parsed = parseP2S2BFrozenPredictionReceipt(value);
  if (!parsed.ok) return { ok: false, code: "receipt_schema_invalid" };
  if (parsed.receipt.input.roomId !== roomId) {
    return { ok: false, code: "receipt_room_mismatch" };
  }
  const sidecarHash = rawSidecar.trim();
  if (!SHA_256.test(sidecarHash)) {
    return { ok: false, code: "receipt_sidecar_invalid" };
  }
  const canonicalHash = hashP2S2BPredictionReceipt(parsed.receipt);
  if (
    canonicalHash !== sidecarHash ||
    canonicalHash !== P2_S2B_FROZEN_REVIEW_RECEIPT_HASHES[roomId]
  ) {
    return { ok: false, code: "receipt_hash_mismatch" };
  }
  return Object.freeze({
    ok: true,
    receipt: parsed.receipt,
    receiptSha256: canonicalHash,
  });
}

export async function loadP2S2BFrozenReviewReceipt(
  roomId: P2S2BFrozenReviewRoomId
): Promise<P2S2BFrozenReviewReceiptVerification> {
  try {
    const [rawJson, rawSidecar] = await Promise.all([
      readFile(path.join(RECEIPT_ROOT, `${roomId}.json`), "utf8"),
      readFile(path.join(RECEIPT_ROOT, `${roomId}.json.sha256`), "utf8"),
    ]);
    return verifyP2S2BFrozenReviewReceipt(roomId, rawJson, rawSidecar);
  } catch {
    return { ok: false, code: "receipt_json_invalid" };
  }
}

export async function currentP2S2BFrozenReviewModuleBlobs(): Promise<ModuleBlobs> {
  const [regionBytes, fragmentBytes] = await Promise.all([
    readFile(path.join(RESEARCH_ROOT, "empty-visible-floor-region.ts")),
    readFile(path.join(RESEARCH_ROOT, "empty-region-boundary-fragments.ts")),
  ]);
  return Object.freeze({
    regionModuleBlob: gitBlobSha1(regionBytes),
    fragmentModuleBlob: gitBlobSha1(fragmentBytes),
  });
}

export function p2S2BFrozenReviewModuleBlobsMatch(
  receipt: P2S2BFrozenPredictionReceipt,
  current: ModuleBlobs
): boolean {
  return receipt.detector.regionModuleBlob ===
      P2_S2B_CERTIFIED_REGION_MODULE_BLOB &&
    receipt.detector.fragmentModuleBlob ===
      P2_S2B_CERTIFIED_FRAGMENT_MODULE_BLOB &&
    current.regionModuleBlob === receipt.detector.regionModuleBlob &&
    current.fragmentModuleBlob === receipt.detector.fragmentModuleBlob;
}

/**
 * Reconstructs only the receipt-hashed component mask. Persisted receipt
 * fragments remain the sole fragment authority and are never replaced by the
 * reader's fresh fragment output.
 */
export async function reconstructP2S2BFrozenReviewMask(
  roomId: P2S2BFrozenReviewRoomId,
  currentModuleBlobs?: ModuleBlobs
): Promise<P2S2BFrozenMaskReconstruction> {
  const verified = await loadP2S2BFrozenReviewReceipt(roomId);
  if (!verified.ok) {
    return {
      ok: false,
      code: "frozen_mask_reconstruction_unavailable",
      reason: "receipt_unverified",
    };
  }
  if (verified.receipt.outcome.status !== "ok") {
    return {
      ok: false,
      code: "frozen_mask_reconstruction_unavailable",
      reason: "receipt_outcome_unavailable",
    };
  }
  const moduleBlobs = currentModuleBlobs ??
    await currentP2S2BFrozenReviewModuleBlobs();
  if (!p2S2BFrozenReviewModuleBlobsMatch(verified.receipt, moduleBlobs)) {
    return {
      ok: false,
      code: "frozen_mask_reconstruction_unavailable",
      reason: "module_blob_mismatch",
    };
  }
  const image = await loadP2S2BHoldoutOracleEmptyImage(roomId);
  if (!image.ok) {
    return {
      ok: false,
      code: "frozen_mask_reconstruction_unavailable",
      reason: "certified_empty_unavailable",
    };
  }
  const fresh = await readP2S2BFrozenHoldout(
    image.bytes,
    verified.receipt.input
  );
  if (!fresh.ok) {
    return {
      ok: false,
      code: "frozen_mask_reconstruction_unavailable",
      reason: "frozen_reader_failed",
    };
  }
  const { width, height } = verified.receipt.input.emptyDimensions;
  if (fresh.region.componentMask.byteLength !== width * height) {
    return {
      ok: false,
      code: "frozen_mask_reconstruction_unavailable",
      reason: "mask_shape_mismatch",
    };
  }
  const componentMaskSha256 = createHash("sha256")
    .update(fresh.region.componentMask)
    .digest("hex");
  if (
    componentMaskSha256 !==
    verified.receipt.outcome.region.componentMaskSha256
  ) {
    return {
      ok: false,
      code: "frozen_mask_reconstruction_unavailable",
      reason: "component_mask_hash_mismatch",
    };
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let index = 0; index < fresh.region.componentMask.length; index += 1) {
    if (fresh.region.componentMask[index] === 0) continue;
    const offset = index * 4;
    rgba[offset] = 14;
    rgba[offset + 1] = 165;
    rgba[offset + 2] = 233;
    rgba[offset + 3] = 178;
  }
  try {
    const pngBytes = await sharp(rgba, {
      raw: { width, height, channels: 4 },
    }).png({ compressionLevel: 9 }).toBuffer();
    return Object.freeze({
      ok: true,
      pngBytes,
      componentMaskSha256,
      moduleBlobs,
    });
  } catch {
    return {
      ok: false,
      code: "frozen_mask_reconstruction_unavailable",
      reason: "mask_encoding_failed",
    };
  }
}
