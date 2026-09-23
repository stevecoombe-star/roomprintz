import "server-only";

import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import {
  normalizeAfcUi2aRoomLabel,
  originalPreparationReceiptFilename,
  parseAfcUi2aOriginalPreparationReceipt,
  type AfcUi2aOriginalPreparationReceiptV1,
  type AfcUi2aSupportedMime,
} from "./afc-ui2a-original-preparation-contract";
import { deepFreeze, type AfcUi2aOriginalPreparationSelector, type AfcUi2aPackageFailureCode, type AfcUi2aVerifiedImageMetadata } from "./afc-ui2a-package-contract";

type RootResult = { ok: true; root: string } | { ok: false; code: "fixed_inputs_root_unavailable" | "fixed_inputs_root_disallowed" };

export type AfcUi2aVerifiedOriginalEvidence = Readonly<{
  roomId: string;
  preparationId: string;
  receipt: AfcUi2aOriginalPreparationReceiptV1;
  original: AfcUi2aVerifiedImageMetadata;
  /** Server-only paths; never project this value into a public result. */
  roomDirectory: string;
  /** Server-only path; never project this value into a public result. */
  originalFilePath: string;
  /** Previously sanitized by the committed UI2A-1 receipt parser. */
  sanitizedImageUrl: string;
}>;

export type AfcUi2aOriginalPreparationReplayResult =
  | Readonly<{ ok: true; evidence: AfcUi2aVerifiedOriginalEvidence }>
  | Readonly<{ ok: false; failureCode: AfcUi2aPackageFailureCode; message: string }>;

export type AfcUi2aOriginalPreparationReplayDependencies = Readonly<{
  resolveFixedInputsRoot?: (configured: string | null | undefined) => Promise<RootResult>;
  inspectMetadata?: typeof inspectImageMetadata;
  fingerprint?: (bytes: Buffer) => string;
}>;

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function mimeFromBytes(bytes: Buffer): AfcUi2aSupportedMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
function extensionForMime(mime: AfcUi2aSupportedMime): string {
  return mime === "image/jpeg" ? "jpg" : mime === "image/png" ? "png" : "webp";
}
function fail(failureCode: AfcUi2aPackageFailureCode, message: string): AfcUi2aOriginalPreparationReplayResult {
  return deepFreeze({ ok: false as const, failureCode, message });
}
async function localRegularFile(directory: string, basename: string): Promise<string | null> {
  if (path.basename(basename) !== basename) return null;
  const lexical = path.resolve(directory, basename);
  if (!inside(directory, lexical)) return null;
  try {
    const info = await lstat(lexical);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const actual = await realpath(lexical);
    return inside(directory, actual) ? actual : null;
  } catch {
    return null;
  }
}

/** Rereads immutable UI2A-1 evidence. Browser summaries and paths are never authority. */
export async function replayAfcUi2aOriginalPreparation(args: {
  roomLabel: unknown;
  selector: AfcUi2aOriginalPreparationSelector;
  currentExpectedFingerprint?: string;
}, dependencies: AfcUi2aOriginalPreparationReplayDependencies = {}): Promise<AfcUi2aOriginalPreparationReplayResult> {
  const roomId = normalizeAfcUi2aRoomLabel(args.roomLabel);
  if (!roomId) return fail("invalid_request", "The room label is invalid.");
  const idParts = args.selector.preparationId.match(/^afc-ui2a-original:([a-z][a-z0-9-]{0,63}):([a-f0-9]{64})$/);
  if (!idParts || idParts[1] !== roomId) return fail("original_receipt_invalid", "The selected Original preparation does not match the room.");
  const expectedReceiptName = originalPreparationReceiptFilename(roomId, idParts[2]);
  if (path.basename(args.selector.receiptFileName) !== args.selector.receiptFileName || args.selector.receiptFileName !== expectedReceiptName) {
    return fail("original_receipt_invalid", "The selected Original-preparation receipt name is invalid.");
  }

  const rootResult = await (dependencies.resolveFixedInputsRoot ?? resolveAfcUi2aFixedInputsRoot)(process.env.AFC_UI1_FIXED_INPUTS_ROOT);
  if (!rootResult.ok) return fail(rootResult.code, rootResult.code === "fixed_inputs_root_unavailable" ? "The fixed-input root is unavailable." : "The fixed-input root is disallowed.");
  const roomLexical = path.resolve(rootResult.root, roomId);
  if (!inside(rootResult.root, roomLexical) || path.basename(roomLexical) !== roomId) return fail("original_preparation_not_found", "The prepared room directory is unavailable.");
  let roomDirectory: string;
  try {
    const info = await lstat(roomLexical);
    if (!info.isDirectory() || info.isSymbolicLink()) return fail("original_preparation_not_found", "The prepared room directory is unavailable.");
    const [rootReal, roomReal] = await Promise.all([realpath(rootResult.root), realpath(roomLexical)]);
    if (!inside(rootReal, roomReal)) return fail("original_preparation_not_found", "The prepared room directory is unavailable.");
    roomDirectory = roomReal;
  } catch {
    return fail("original_preparation_not_found", "The prepared room directory is unavailable.");
  }

  const receiptPath = await localRegularFile(roomDirectory, expectedReceiptName);
  if (!receiptPath) return fail("original_preparation_not_found", "The selected Original-preparation receipt is unavailable.");
  let receiptBytes: Buffer;
  try {
    receiptBytes = await readFile(receiptPath);
  } catch {
    return fail("original_preparation_not_found", "The selected Original-preparation receipt is unavailable.");
  }
  const fingerprint = dependencies.fingerprint ?? computeCalibrationImageFingerprint;
  if (fingerprint(receiptBytes) !== args.selector.receiptSha256) return fail("original_receipt_hash_mismatch", "The selected Original-preparation receipt changed after selection.");
  let parsed: ReturnType<typeof parseAfcUi2aOriginalPreparationReceipt>;
  try {
    parsed = parseAfcUi2aOriginalPreparationReceipt(JSON.parse(receiptBytes.toString("utf8")));
  } catch {
    return fail("original_receipt_invalid", "The selected Original-preparation receipt is invalid.");
  }
  if (!parsed.ok || parsed.receipt.preparationId !== args.selector.preparationId || parsed.receipt.roomId !== roomId) {
    return fail("original_receipt_invalid", "The selected Original-preparation receipt is invalid.");
  }
  const receipt = parsed.receipt;
  const originalPath = await localRegularFile(roomDirectory, receipt.original.fileName);
  if (!originalPath) return fail("original_image_missing", "The immutable Original image is unavailable.");
  let bytes: Buffer;
  try {
    bytes = await readFile(originalPath);
  } catch {
    return fail("original_image_missing", "The immutable Original image is unavailable.");
  }
  const mimeType = mimeFromBytes(bytes);
  if (!mimeType || mimeType !== receipt.original.mimeType || !receipt.original.fileName.endsWith(`.${extensionForMime(mimeType)}`) ||
    fingerprint(bytes) !== receipt.original.sha256 || bytes.byteLength !== receipt.original.byteCount) {
    return fail("original_image_mismatch", "The immutable Original image no longer matches its receipt.");
  }
  const metadata = await (dependencies.inspectMetadata ?? inspectImageMetadata)(bytes);
  if (!metadata.ok || metadata.orientation !== 1 ||
    metadata.width !== receipt.original.decodedWidth || metadata.height !== receipt.original.decodedHeight ||
    receipt.source.expectedDecodedWidth !== receipt.original.decodedWidth || receipt.source.expectedDecodedHeight !== receipt.original.decodedHeight ||
    receipt.source.expectedQualifiedFingerprint !== receipt.original.sha256 ||
    args.currentExpectedFingerprint !== undefined && args.currentExpectedFingerprint !== receipt.source.expectedQualifiedFingerprint) {
    return fail("original_image_mismatch", "The immutable Original image no longer matches its receipt.");
  }
  return deepFreeze({
    ok: true as const,
    evidence: {
      roomId,
      preparationId: receipt.preparationId,
      receipt,
      original: { ...receipt.original },
      roomDirectory,
      originalFilePath: originalPath,
      sanitizedImageUrl: receipt.source.sanitizedImageUrl,
    },
  });
}
