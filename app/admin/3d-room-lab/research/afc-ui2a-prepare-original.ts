/**
 * UI2A-1's intentionally narrow server-only boundary: refetch a qualified
 * Original, prove byte identity, and retain immutable local research evidence.
 * It has no Empty, manifest, provider, compositor, scene, or persistence path.
 */
import "server-only";

import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import {
  getAutoFloorVisionAllowedImageHosts,
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  isAutoFloorVisionAllowLocalhostHttp,
} from "@/lib/vibodeAutoFloorVisionConfig";
import { fetchRoomImageSafely, inspectImageMetadata, type SafeImageResult } from "@/lib/vibodeAutoFloorImageFetch";
import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import { writeAfcR3cImmutableCapture } from "./gemini-floor-proposal-capture";
import { resolveAfcUi2aFixedInputsRoot } from "./afc-ui2a-fixed-input-root";
import {
  normalizeAfcUi2aRoomLabel,
  originalFilename,
  originalPreparationId,
  originalPreparationReceiptFilename,
  parseAfcUi2aOriginalPreparationReceipt,
  parseAfcUi2aPrepareOriginalRequest,
  sanitizeAfcUi2aSourceUrl,
  stableAfcUi2aReceiptBytes,
  type AfcUi2aFailureCode,
  type AfcUi2aOriginalPreparationReceiptV1,
  type AfcUi2aSupportedMime,
} from "./afc-ui2a-original-preparation-contract";

export type AfcUi2aPreparationResult =
  | Readonly<{
      status: "prepared";
      preparationStage: "original_captured";
      preparationId: string;
      roomId: string;
      original: Readonly<{ fileName: string; sha256: string; byteCount: number; mimeType: AfcUi2aSupportedMime; decodedWidth: number; decodedHeight: number; orientation: 1 }>;
      receipt: Readonly<{ fileName: string; sha256: string }>;
      reused: Readonly<{ original: boolean; receipt: boolean }>;
      safety: Readonly<{ emptyRoomGenerationCall: false; geminiFloorProposalCall: false; floorStateUnchanged: true; activeCameraUnchanged: true }>;
    }>
  | Readonly<{ status: "failure"; failureCode: AfcUi2aFailureCode; message: string; path?: string }>;

export type AfcUi2aPrepareOriginalDependencies = Readonly<{
  fetchImage?: (url: string) => Promise<SafeImageResult>;
  inspectMetadata?: typeof inspectImageMetadata;
  fingerprint?: typeof computeCalibrationImageFingerprint;
  immutableWriter?: typeof writeAfcR3cImmutableCapture;
  maxImageBytes?: number;
  resolveFixedInputsRoot?: (configured: string | null | undefined) => Promise<{ ok: true; root: string } | { ok: false; code: "fixed_inputs_root_unavailable" | "fixed_inputs_root_disallowed" }>;
}>;

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function supportedMime(value: string): value is AfcUi2aSupportedMime {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}
function mimeFromVerifiedBytes(bytes: Buffer): AfcUi2aSupportedMime | null {
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.byteLength >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.byteLength >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
function failure(failureCode: AfcUi2aFailureCode, message: string, pathValue?: string): AfcUi2aPreparationResult {
  return Object.freeze({ status: "failure" as const, failureCode, message, ...(pathValue ? { path: pathValue } : {}) });
}

async function prepareRoomDirectory(root: string, roomId: string): Promise<{ ok: true; roomDirectory: string } | { ok: false; code: "room_directory_invalid" | "room_directory_symlink_escape" }> {
  const lexicalRoom = path.resolve(root, roomId);
  if (!inside(root, lexicalRoom) || path.basename(lexicalRoom) !== roomId) return { ok: false, code: "room_directory_invalid" };
  try {
    try {
      const existing = await lstat(lexicalRoom);
      if (existing.isSymbolicLink()) return { ok: false, code: "room_directory_symlink_escape" };
      if (!existing.isDirectory()) return { ok: false, code: "room_directory_invalid" };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(lexicalRoom, { recursive: false });
    }
    const roomInfo = await lstat(lexicalRoom);
    if (!roomInfo.isDirectory() || roomInfo.isSymbolicLink()) return { ok: false, code: "room_directory_symlink_escape" };
    const [realRoot, realRoom] = await Promise.all([realpath(root), realpath(lexicalRoom)]);
    if (!inside(realRoot, realRoom)) return { ok: false, code: "room_directory_symlink_escape" };
    return { ok: true, roomDirectory: realRoom };
  } catch {
    return { ok: false, code: "room_directory_invalid" };
  }
}

function receiptFor(args: {
  roomId: string; sanitizedImageUrl: string; expectedFingerprint: string; expectedWidth: number; expectedHeight: number;
  original: { fileName: string; sha256: string; byteCount: number; mimeType: AfcUi2aSupportedMime; decodedWidth: number; decodedHeight: number };
}): AfcUi2aOriginalPreparationReceiptV1 {
  return Object.freeze({
    receiptContractVersion: "afc-ui2a-original-preparation-receipt/v1",
    preparationStage: "original_captured",
    preparationId: originalPreparationId(args.roomId, args.original.sha256),
    roomId: args.roomId,
    source: Object.freeze({
      sanitizedImageUrl: args.sanitizedImageUrl,
      expectedQualifiedFingerprint: args.expectedFingerprint,
      expectedDecodedWidth: args.expectedWidth,
      expectedDecodedHeight: args.expectedHeight,
    }),
    original: Object.freeze({ ...args.original, orientation: 1 }),
    safety: Object.freeze({
      authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true, floorStateUnchanged: true,
      supportStateUnchanged: true, databaseWrites: false, productionAssetWrites: false, productionTokenAccountingUsed: false,
      emptyRoomGenerationCall: false, geminiFloorProposalCall: false, localResearchCaptureWritten: true,
    }),
  });
}

async function rereadReceipt(directory: string, filename: string): Promise<{ ok: true; bytes: Buffer; receipt: AfcUi2aOriginalPreparationReceiptV1 } | { ok: false }> {
  try {
    const target = path.resolve(directory, filename);
    if (!inside(directory, target)) return { ok: false };
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) return { ok: false };
    const actual = await realpath(target);
    if (!inside(directory, actual)) return { ok: false };
    const bytes = await readFile(actual);
    const parsed = parseAfcUi2aOriginalPreparationReceipt(JSON.parse(bytes.toString("utf8")));
    return parsed.ok ? { ok: true, bytes, receipt: parsed.receipt } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export async function prepareAfcUi2aOriginal(rawRequest: unknown, dependencies: AfcUi2aPrepareOriginalDependencies = {}): Promise<AfcUi2aPreparationResult> {
  const parsed = parseAfcUi2aPrepareOriginalRequest(rawRequest);
  if (!parsed.ok) return failure("invalid_request", "The preparation request is invalid.");
  const request = parsed.request;
  if (request.executeCapture !== true) return failure("capture_not_authorized", "Confirm immutable Original preparation before writing local research evidence.");
  const roomId = normalizeAfcUi2aRoomLabel(request.roomLabel);
  if (!roomId) return failure("room_label_invalid", "Enter a room label using letters, numbers, spaces, underscores, or hyphens.");
  const sanitizedImageUrl = sanitizeAfcUi2aSourceUrl(request.currentImage.imageUrl);
  if (!sanitizedImageUrl) return failure("image_url_invalid", "The current Room image URL is invalid.");
  const maxBytes = dependencies.maxImageBytes ?? getAutoFloorVisionImageMaxBytes();
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) return failure("invalid_request", "The image byte limit configuration is invalid.");
  const fetchImage = dependencies.fetchImage ?? ((url: string) => fetchRoomImageSafely(url, {
    allowedHosts: getAutoFloorVisionAllowedImageHosts(),
    maxBytes,
    timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
    allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
  }));
  const fetched = await fetchImage(request.currentImage.imageUrl);
  if (!fetched.ok) return failure("image_fetch_failed", "The current Room image could not be refetched through the approved image boundary.");
  if (fetched.buffer.byteLength !== fetched.byteCount || fetched.byteCount <= 0 || fetched.byteCount > maxBytes) {
    return failure("image_byte_limit_exceeded", "The refetched Room image exceeds the permitted byte limit.");
  }
  const verifiedMime = mimeFromVerifiedBytes(fetched.buffer);
  if (!supportedMime(fetched.mime) || !verifiedMime || fetched.mime !== verifiedMime) {
    return failure("image_mime_unsupported", "The refetched Room image must be a byte-verified JPEG, PNG, or WebP.");
  }
  const metadata = await (dependencies.inspectMetadata ?? inspectImageMetadata)(fetched.buffer);
  if (!metadata.ok) return failure("image_decode_failed", "The refetched Room image could not be decoded.");
  if (metadata.orientation !== 1) return failure("image_orientation_invalid", "The refetched Room image has a non-normal encoded orientation.");
  const fingerprint = (dependencies.fingerprint ?? computeCalibrationImageFingerprint)(fetched.buffer);
  if (fingerprint !== request.currentImage.expectedFingerprint) {
    return failure("image_fingerprint_mismatch", "The image bytes changed after qualification. Re-qualify the current Room image and prepare again.");
  }
  if (metadata.width !== request.currentImage.expectedWidth || metadata.height !== request.currentImage.expectedHeight) {
    return failure("image_dimension_mismatch", "The refetched Room image dimensions changed after qualification. Re-qualify the current Room image and prepare again.");
  }

  const rootResult = await (dependencies.resolveFixedInputsRoot ?? resolveAfcUi2aFixedInputsRoot)(process.env.AFC_UI1_FIXED_INPUTS_ROOT);
  if (!rootResult.ok) return failure(rootResult.code, rootResult.code === "fixed_inputs_root_unavailable" ? "The fixed-input root is unavailable." : "The configured fixed-input root is disallowed.");
  const room = await prepareRoomDirectory(rootResult.root, roomId);
  if (!room.ok) return failure(room.code, room.code === "room_directory_symlink_escape" ? "The room directory is unsafe." : "The room directory could not be prepared.");

  const original = {
    fileName: originalFilename(roomId, fingerprint, verifiedMime),
    sha256: fingerprint,
    byteCount: fetched.byteCount,
    mimeType: verifiedMime,
    decodedWidth: metadata.width,
    decodedHeight: metadata.height,
  };
  const writer = dependencies.immutableWriter ?? writeAfcR3cImmutableCapture;
  const originalWrite = await writer({ outputDir: room.roomDirectory, filename: original.fileName, bytes: fetched.buffer });
  if (!originalWrite.ok) return failure("image_capture_failed", "The verified Original image could not be captured immutably.");

  const receipt = receiptFor({
    roomId, sanitizedImageUrl, expectedFingerprint: request.currentImage.expectedFingerprint,
    expectedWidth: request.currentImage.expectedWidth, expectedHeight: request.currentImage.expectedHeight, original,
  });
  const receiptFilename = originalPreparationReceiptFilename(roomId, fingerprint);
  const receiptWrite = await writer({ outputDir: room.roomDirectory, filename: receiptFilename, bytes: stableAfcUi2aReceiptBytes(receipt) });
  if (!receiptWrite.ok) return failure("receipt_capture_failed", "The Original-preparation receipt could not be captured immutably.");
  const reread = await rereadReceipt(room.roomDirectory, receiptFilename);
  if (!reread.ok || reread.receipt.preparationId !== receipt.preparationId || reread.receipt.original.sha256 !== fingerprint) {
    return failure("receipt_validation_failed", "The saved Original-preparation receipt did not pass verification.");
  }
  const receiptSha256 = (dependencies.fingerprint ?? computeCalibrationImageFingerprint)(reread.bytes);
  return Object.freeze({
    status: "prepared", preparationStage: "original_captured", preparationId: receipt.preparationId, roomId,
    original: Object.freeze({ ...original, orientation: 1 as const }),
    receipt: Object.freeze({ fileName: receiptFilename, sha256: receiptSha256 }),
    reused: Object.freeze({ original: originalWrite.reused, receipt: receiptWrite.reused }),
    safety: Object.freeze({ emptyRoomGenerationCall: false, geminiFloorProposalCall: false, floorStateUnchanged: true, activeCameraUnchanged: true }),
  });
}
