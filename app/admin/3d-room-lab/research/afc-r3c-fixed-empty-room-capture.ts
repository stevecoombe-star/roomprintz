/**
 * AFC-R3C fixed Empty-Room capture.
 *
 * This is a server-only, manual research capture boundary. It never imports a
 * route, scene state, persistence, Apply authority, token accounting, upload,
 * or Gemini proposal code. The only optional provider path is the existing
 * transient Empty-Room Assist helper, behind an exact primitive-true gate.
 */
import "server-only";

import { lstat, open, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  getAutoFloorVisionAllowedImageHosts,
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  getEmptyRoomAssistResultAllowedHosts,
  isAutoFloorVisionAllowLocalhostHttp,
} from "@/lib/vibodeAutoFloorVisionConfig";
import { fetchRoomImageSafely, inspectImageMetadata, type SafeImageResult } from "@/lib/vibodeAutoFloorImageFetch";
import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import {
  EMPTY_ROOM_ASSIST_GENERATOR_ID,
  EMPTY_ROOM_ASSIST_REQUESTED_MODEL_ID,
  getCachedEmptyRoomImage,
  getOrGenerateEmptyRoomImage,
  sanitizeEmptyRoomAppliedAspectRatio,
  type EmptyRoomAssistGenerateResult,
  type EmptyRoomGenerationProvenance,
  type EmptyRoomImageBytes,
  type GenerateEmptyRoomArgs,
} from "@/lib/vibodeEmptyRoomAssist";
import {
  prepareAfcR3cCaptureDirectory,
  sanitizeAfcR3cCaptureToken,
  stableReceiptBytes,
  writeAfcR3cImmutableCapture,
} from "./gemini-floor-proposal-capture";

export const AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_REQUEST_VERSION =
  "afc-r3c-fixed-empty-room-capture-request/v1" as const;
export const AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_RECEIPT_VERSION =
  "afc-r3c-fixed-empty-room-capture-receipt/v1" as const;
export const AFC_R3C_FIXED_EMPTY_ROOM_MAX_BYTES = 10 * 1024 * 1024;

type SupportedMime = "image/jpeg" | "image/png" | "image/webp";
type CacheStatus = "hit" | "miss";

export type AfcR3cFixedEmptyRoomCaptureRequest = Readonly<{
  contractVersion: typeof AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_REQUEST_VERSION;
  roomId: string;
  requestId: string;
  originalFilePath: string;
  originalImageUrl: string;
  expectedOriginalSha256: string;
  outputDir: string;
  executeCapture: true;
  executeEmptyRoomGeneration?: boolean;
}>;

export type AfcR3cFixedEmptyRoomCaptureFailureCode =
  | "invalid_request"
  | "capture_not_authorized"
  | "original_not_regular_file"
  | "original_read_failed"
  | "original_empty"
  | "original_oversized"
  | "original_mime_unsupported"
  | "original_hash_mismatch"
  | "original_metadata_invalid"
  | "original_orientation_unsupported"
  | "output_preflight_failed"
  | "request_id_reused"
  | "request_id_in_progress"
  | "original_url_evidence_failed"
  | "original_url_evidence_mismatch"
  | "empty_generation_failed"
  | "empty_base64_invalid"
  | "empty_empty"
  | "empty_oversized"
  | "empty_byte_count_mismatch"
  | "empty_mime_unsupported"
  | "empty_mime_mismatch"
  | "empty_metadata_invalid"
  | "empty_orientation_unsupported"
  | "empty_provenance_invalid"
  | "capture_write_failed";

export type AfcR3cFixedEmptyRoomSafety = Readonly<{
  applied: false;
  authoritative: false;
  /** False means no production/scene persistence; local research files are intentionally written. */
  persisted: false;
  activeCameraUnchanged: true;
  sceneStateUnchanged: true;
  databaseWrites: false;
  productionAssetWrites: false;
  productionTokenAccountingUsed: false;
  emptyRoomGenerationCall: boolean;
  geminiFloorProposalCall: false;
  localResearchCaptureWritten: boolean;
}>;

export type AfcR3cFixedEmptyRoomCaptureResult =
  | Readonly<{
      status: "captured";
      captureSource: "cache_hit" | "generated";
      originalPath: string;
      emptyPath: string;
      receiptPath: string;
      emptyRoomGenerationCall: boolean;
      safety: AfcR3cFixedEmptyRoomSafety;
    }>
  | Readonly<{
      status: "cache_miss";
      captureSource: null;
      emptyRoomGenerationCall: false;
      captureWritten: false;
      safety: AfcR3cFixedEmptyRoomSafety;
    }>
  | Readonly<{
      status: "failure";
      failureCode: AfcR3cFixedEmptyRoomCaptureFailureCode;
      receiptPath?: string;
      emptyRoomGenerationCall: boolean;
      captureWritten: boolean;
      safety: AfcR3cFixedEmptyRoomSafety;
    }>;

type VerifiedImage = Readonly<{
  bytes: Buffer;
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  orientation: 1;
  mimeType: SupportedMime;
}>;

export type AfcR3cFixedEmptyRoomCaptureDependencies = Readonly<{
  repositoryRoot?: string;
  maxImageBytes?: number;
  getCachedEmptyRoomImage?: (originalHash: string) => EmptyRoomImageBytes | null;
  getOrGenerateEmptyRoomImage?: (args: GenerateEmptyRoomArgs) => Promise<EmptyRoomAssistGenerateResult>;
  fetchOriginalImage?: (url: string) => Promise<SafeImageResult>;
  prepareDirectory?: typeof prepareAfcR3cCaptureDirectory;
  captureWriter?: typeof writeAfcR3cImmutableCapture;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsoluteSafePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0") && path.isAbsolute(value);
}

function isSafeRoomId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z][a-z0-9-]{0,63}$/.test(value) &&
    sanitizeAfcR3cCaptureToken(value) === value
  );
}

function isSafeRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) &&
    sanitizeAfcR3cCaptureToken(value) === value
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

/**
 * Exact closed request parsing. `executeCapture` remains unknown until its
 * exact primitive-true acknowledgement is checked by the service.
 */
export function parseAfcR3cFixedEmptyRoomCaptureRequest(
  value: unknown
):
  | Readonly<{
      ok: true;
      request: Omit<AfcR3cFixedEmptyRoomCaptureRequest, "executeCapture" | "executeEmptyRoomGeneration"> & {
        executeCapture: unknown;
        executeEmptyRoomGeneration?: boolean;
      };
    }>
  | Readonly<{ ok: false; code: "invalid_request" }> {
  if (!isRecord(value)) return { ok: false, code: "invalid_request" };
  const allowed = [
    "contractVersion",
    "roomId",
    "requestId",
    "originalFilePath",
    "originalImageUrl",
    "expectedOriginalSha256",
    "outputDir",
    "executeCapture",
    "executeEmptyRoomGeneration",
  ];
  const required = allowed.filter((key) => key !== "executeEmptyRoomGeneration");
  if (!Object.keys(value).every((key) => allowed.includes(key)) || !required.every((key) => key in value)) {
    return { ok: false, code: "invalid_request" };
  }
  if (
    value.contractVersion !== AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_REQUEST_VERSION ||
    !isSafeRoomId(value.roomId) ||
    !isSafeRequestId(value.requestId) ||
    !isAbsoluteSafePath(value.originalFilePath) ||
    typeof value.originalImageUrl !== "string" ||
    !isSha256(value.expectedOriginalSha256) ||
    !isAbsoluteSafePath(value.outputDir) ||
    ("executeEmptyRoomGeneration" in value && typeof value.executeEmptyRoomGeneration !== "boolean")
  ) {
    return { ok: false, code: "invalid_request" };
  }
  return {
    ok: true,
    request: {
      contractVersion: value.contractVersion,
      roomId: value.roomId,
      requestId: value.requestId,
      originalFilePath: value.originalFilePath,
      originalImageUrl: value.originalImageUrl,
      expectedOriginalSha256: value.expectedOriginalSha256,
      outputDir: value.outputDir,
      executeCapture: value.executeCapture,
      ...(Object.prototype.hasOwnProperty.call(value, "executeEmptyRoomGeneration")
        ? { executeEmptyRoomGeneration: value.executeEmptyRoomGeneration as boolean }
        : {}),
    },
  };
}

function isSupportedMime(value: string | null): value is SupportedMime {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function mimeFromBytes(bytes: Buffer): SupportedMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function isFinitePositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function extensionForMime(mimeType: SupportedMime): "jpg" | "png" | "webp" {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
}

function safety(args: {
  emptyRoomGenerationCall: boolean;
  localResearchCaptureWritten: boolean;
}): AfcR3cFixedEmptyRoomSafety {
  return Object.freeze({
    applied: false,
    authoritative: false,
    persisted: false,
    activeCameraUnchanged: true,
    sceneStateUnchanged: true,
    databaseWrites: false,
    productionAssetWrites: false,
    productionTokenAccountingUsed: false,
    emptyRoomGenerationCall: args.emptyRoomGenerationCall,
    geminiFloorProposalCall: false,
    localResearchCaptureWritten: args.localResearchCaptureWritten,
  });
}

function failure(
  failureCode: AfcR3cFixedEmptyRoomCaptureFailureCode,
  emptyRoomGenerationCall = false,
  captureWritten = false,
  receiptPath?: string,
  localResearchCaptureWritten = captureWritten
): AfcR3cFixedEmptyRoomCaptureResult {
  return Object.freeze({
    status: "failure" as const,
    failureCode,
    ...(receiptPath ? { receiptPath } : {}),
    emptyRoomGenerationCall,
    captureWritten,
    safety: safety({ emptyRoomGenerationCall, localResearchCaptureWritten }),
  });
}

async function verifyExactLocalOriginal(args: {
  filePath: string;
  expectedSha256: string;
  maxBytes: number;
}): Promise<{ ok: true; image: VerifiedImage } | { ok: false; code: AfcR3cFixedEmptyRoomCaptureFailureCode }> {
  try {
    if (!(await lstat(args.filePath)).isFile()) return { ok: false, code: "original_not_regular_file" };
  } catch {
    return { ok: false, code: "original_read_failed" };
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(args.filePath);
  } catch {
    return { ok: false, code: "original_read_failed" };
  }
  if (bytes.byteLength === 0) return { ok: false, code: "original_empty" };
  if (bytes.byteLength > args.maxBytes) return { ok: false, code: "original_oversized" };
  const mimeType = mimeFromBytes(bytes);
  if (!isSupportedMime(mimeType)) return { ok: false, code: "original_mime_unsupported" };
  const sha256 = computeCalibrationImageFingerprint(bytes);
  if (sha256 !== args.expectedSha256) return { ok: false, code: "original_hash_mismatch" };
  const metadata = await inspectImageMetadata(bytes);
  if (!metadata.ok || !isFinitePositiveInteger(metadata.width) || !isFinitePositiveInteger(metadata.height)) {
    return { ok: false, code: "original_metadata_invalid" };
  }
  if (metadata.orientation !== 1) return { ok: false, code: "original_orientation_unsupported" };
  return {
    ok: true,
    image: Object.freeze({
      bytes,
      sha256,
      byteCount: bytes.byteLength,
      decodedWidth: metadata.width,
      decodedHeight: metadata.height,
      orientation: 1,
      mimeType,
    }),
  };
}

async function verifyFetchedOriginalEvidence(args: {
  fetched: SafeImageResult;
  original: VerifiedImage;
}): Promise<"ok" | "original_url_evidence_failed" | "original_url_evidence_mismatch"> {
  if (!args.fetched.ok) return "original_url_evidence_failed";
  const byteMime = mimeFromBytes(args.fetched.buffer);
  if (!isSupportedMime(byteMime) || args.fetched.mime !== byteMime || args.fetched.byteCount !== args.fetched.buffer.byteLength) {
    return "original_url_evidence_failed";
  }
  const metadata = await inspectImageMetadata(args.fetched.buffer);
  if (!metadata.ok || !isFinitePositiveInteger(metadata.width) || !isFinitePositiveInteger(metadata.height) || metadata.orientation !== 1) {
    return "original_url_evidence_failed";
  }
  if (
    computeCalibrationImageFingerprint(args.fetched.buffer) !== args.original.sha256 ||
    metadata.width !== args.original.decodedWidth ||
    metadata.height !== args.original.decodedHeight
  ) {
    return "original_url_evidence_mismatch";
  }
  return "ok";
}

async function verifyCachedEmptyImage(args: {
  image: EmptyRoomImageBytes;
  maxBytes: number;
}): Promise<{ ok: true; image: VerifiedImage; provenance: EmptyRoomGenerationProvenance } | { ok: false; code: AfcR3cFixedEmptyRoomCaptureFailureCode }> {
  const base64 = args.image?.base64;
  if (typeof base64 !== "string" || base64.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    return { ok: false, code: "empty_base64_invalid" };
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength === 0) return { ok: false, code: "empty_empty" };
  if (bytes.toString("base64") !== base64) return { ok: false, code: "empty_base64_invalid" };
  if (bytes.byteLength > args.maxBytes) return { ok: false, code: "empty_oversized" };
  if (!Number.isSafeInteger(args.image.byteCount) || args.image.byteCount !== bytes.byteLength) {
    return { ok: false, code: "empty_byte_count_mismatch" };
  }
  const byteMime = mimeFromBytes(bytes);
  if (!isSupportedMime(byteMime)) return { ok: false, code: "empty_mime_unsupported" };
  if (args.image.mime !== byteMime) return { ok: false, code: "empty_mime_mismatch" };
  const metadata = await inspectImageMetadata(bytes);
  if (!metadata.ok || !isFinitePositiveInteger(metadata.width) || !isFinitePositiveInteger(metadata.height)) {
    return { ok: false, code: "empty_metadata_invalid" };
  }
  if (metadata.orientation !== 1) return { ok: false, code: "empty_orientation_unsupported" };
  const provenance = args.image.provenance;
  if (
    !provenance ||
    provenance.generatorId !== EMPTY_ROOM_ASSIST_GENERATOR_ID ||
    provenance.requestedModelId !== EMPTY_ROOM_ASSIST_REQUESTED_MODEL_ID ||
    provenance.resolvedModelId !== null ||
    provenance.resolvedModelStatus !== "not_reported_by_compositor" ||
    (provenance.imageTransport !== "data_url" && provenance.imageTransport !== "http_url") ||
    provenance.appliedAspectRatio !== sanitizeEmptyRoomAppliedAspectRatio(provenance.appliedAspectRatio) ||
    !isCanonicalIsoTimestamp(provenance.generatedAt)
  ) {
    return { ok: false, code: "empty_provenance_invalid" };
  }
  return {
    ok: true,
    image: Object.freeze({
      bytes,
      sha256: computeCalibrationImageFingerprint(bytes),
      byteCount: bytes.byteLength,
      decodedWidth: metadata.width,
      decodedHeight: metadata.height,
      orientation: 1,
      mimeType: byteMime,
    }),
    provenance,
  };
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value;
}

function receiptFilename(requestId: string): string {
  return `afc-r3c-fixed-empty-room.${requestId}.receipt.json`;
}

function reservationFilename(requestId: string): string {
  return `.afc-r3c-fixed-empty-room.${requestId}.reservation`;
}

async function receiptAlreadyExists(outputDir: string, requestId: string): Promise<boolean> {
  try {
    await lstat(path.join(outputDir, receiptFilename(requestId)));
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

async function acquireRequestReservation(args: {
  outputDir: string;
  requestId: string;
}): Promise<{ ok: true; filePath: string } | { ok: false; code: "request_id_in_progress" | "capture_write_failed" }> {
  const filename = reservationFilename(args.requestId);
  if (path.basename(filename) !== filename) return { ok: false, code: "capture_write_failed" };
  const filePath = path.join(args.outputDir, filename);
  try {
    const handle = await open(filePath, "wx", 0o600);
    await handle.close();
    return { ok: true, filePath };
  } catch (error) {
    return {
      ok: false,
      code: (error as NodeJS.ErrnoException).code === "EEXIST" ? "request_id_in_progress" : "capture_write_failed",
    };
  }
}

async function releaseRequestReservation(filePath: string): Promise<void> {
  await rm(filePath, { force: true }).catch(() => undefined);
}

async function writeUniqueReceipt(args: {
  outputDir: string;
  requestId: string;
  receipt: Record<string, unknown>;
  writer: typeof writeAfcR3cImmutableCapture;
}): Promise<{ ok: true; filePath: string } | { ok: false; code: "request_id_reused" | "capture_write_failed" }> {
  if (await receiptAlreadyExists(args.outputDir, args.requestId)) return { ok: false, code: "request_id_reused" };
  const result = await args.writer({
    outputDir: args.outputDir,
    filename: receiptFilename(args.requestId),
    bytes: stableReceiptBytes(args.receipt),
  });
  if (!result.ok) return { ok: false, code: "capture_write_failed" };
  // The immutable writer may safely reuse digest artifacts, but a receipt ID is
  // an operation nonce and must never replay.
  if (result.reused) return { ok: false, code: "request_id_reused" };
  return { ok: true, filePath: result.filePath };
}

function receiptSafety(emptyRoomGenerationCall: boolean): AfcR3cFixedEmptyRoomSafety {
  return safety({ emptyRoomGenerationCall, localResearchCaptureWritten: true });
}

function successfulReceipt(args: {
  request: AfcR3cFixedEmptyRoomCaptureRequest;
  original: VerifiedImage;
  originalPath: string;
  empty: VerifiedImage;
  emptyPath: string;
  cacheStatus: CacheStatus;
  captureSource: "cache_hit" | "generated";
  provenance: EmptyRoomGenerationProvenance;
  emptyRoomGenerationCall: boolean;
}): Record<string, unknown> {
  return {
    receiptContractVersion: AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_RECEIPT_VERSION,
    roomId: args.request.roomId,
    requestId: args.request.requestId,
    createdAt: new Date().toISOString(),
    captureSource: args.captureSource,
    original: {
      sourceFilePath: args.request.originalFilePath,
      capturedFilePath: args.originalPath,
      sha256: args.original.sha256,
      byteCount: args.original.byteCount,
      decodedWidth: args.original.decodedWidth,
      decodedHeight: args.original.decodedHeight,
      orientation: args.original.orientation,
      mimeType: args.original.mimeType,
    },
    emptyRoomAssist: {
      capturedFilePath: args.emptyPath,
      sha256: args.empty.sha256,
      byteCount: args.empty.byteCount,
      decodedWidth: args.empty.decodedWidth,
      decodedHeight: args.empty.decodedHeight,
      orientation: args.empty.orientation,
      mimeType: args.empty.mimeType,
      generatedFromOriginalSha256: args.original.sha256,
    },
    generation: {
      cacheStatus: args.cacheStatus,
      generatorId: args.provenance.generatorId,
      requestedModelId: args.provenance.requestedModelId,
      resolvedModelId: null,
      resolvedModelStatus: "not_reported_by_compositor",
      appliedAspectRatio: args.provenance.appliedAspectRatio,
      imageTransport: args.provenance.imageTransport,
      generatedAt: args.provenance.generatedAt,
    },
    safety: receiptSafety(args.emptyRoomGenerationCall),
  };
}

function generationFailureReceipt(args: {
  request: AfcR3cFixedEmptyRoomCaptureRequest;
  original: VerifiedImage;
  failureCode: AfcR3cFixedEmptyRoomCaptureFailureCode;
  compositorCallOccurred: boolean;
}): Record<string, unknown> {
  return {
    receiptContractVersion: AFC_R3C_FIXED_EMPTY_ROOM_CAPTURE_RECEIPT_VERSION,
    receiptStatus: "generation_failure",
    roomId: args.request.roomId,
    requestId: args.request.requestId,
    createdAt: new Date().toISOString(),
    failureCode: args.failureCode,
    failureReason: "Authorized Empty-Room generation did not produce an admissible research image.",
    original: {
      sourceFilePath: args.request.originalFilePath,
      sha256: args.original.sha256,
      byteCount: args.original.byteCount,
      decodedWidth: args.original.decodedWidth,
      decodedHeight: args.original.decodedHeight,
      orientation: args.original.orientation,
      mimeType: args.original.mimeType,
    },
    generationAttempt: { compositorCallOccurred: args.compositorCallOccurred },
    safety: receiptSafety(args.compositorCallOccurred),
  };
}

/**
 * Executes a fixed local pair capture. No default path writes files, fetches an
 * original URL, or calls the compositor: each side effect requires the exact
 * primitive `true` acknowledgement specified by the request contract.
 */
export async function captureAfcR3cFixedEmptyRoom(
  rawRequest: unknown,
  dependencies: AfcR3cFixedEmptyRoomCaptureDependencies = {}
): Promise<AfcR3cFixedEmptyRoomCaptureResult> {
  const parsed = parseAfcR3cFixedEmptyRoomCaptureRequest(rawRequest);
  if (!parsed.ok) return failure(parsed.code);
  if (parsed.request.executeCapture !== true) return failure("capture_not_authorized");
  const request = parsed.request as AfcR3cFixedEmptyRoomCaptureRequest;
  const maxBytes = dependencies.maxImageBytes ?? AFC_R3C_FIXED_EMPTY_ROOM_MAX_BYTES;
  if (!isFinitePositiveInteger(maxBytes)) return failure("invalid_request");

  const originalResult = await verifyExactLocalOriginal({
    filePath: request.originalFilePath,
    expectedSha256: request.expectedOriginalSha256,
    maxBytes,
  });
  if (!originalResult.ok) return failure(originalResult.code);
  const original = originalResult.image;
  const cached = (dependencies.getCachedEmptyRoomImage ?? getCachedEmptyRoomImage)(original.sha256);

  if (!cached && request.executeEmptyRoomGeneration !== true) {
    return Object.freeze({
      status: "cache_miss" as const,
      captureSource: null,
      emptyRoomGenerationCall: false,
      captureWritten: false,
      safety: safety({ emptyRoomGenerationCall: false, localResearchCaptureWritten: false }),
    });
  }

  const repositoryRoot = path.resolve(dependencies.repositoryRoot ?? process.cwd());
  // This package is stricter than the older generic R3C helper: pilot inputs
  // must be outside the repository, never in its approved local subdirectory.
  if (inside(repositoryRoot, path.resolve(request.outputDir))) return failure("output_preflight_failed");
  const prepared = await (dependencies.prepareDirectory ?? prepareAfcR3cCaptureDirectory)({
    outputDir: request.outputDir,
    repositoryRoot,
  });
  if (!prepared.ok || inside(repositoryRoot, path.resolve(prepared.outputDir))) return failure("output_preflight_failed");
  if (await receiptAlreadyExists(prepared.outputDir, request.requestId)) return failure("request_id_reused");
  // The cache-only miss returned above deliberately does not reserve. Every
  // remaining path can fetch, generate, or publish and must be single-flight
  // per request ID until a receipt becomes the durable replay barrier.
  const reservation = await acquireRequestReservation({
    outputDir: prepared.outputDir,
    requestId: request.requestId,
  });
  if (!reservation.ok) return failure(reservation.code);

  try {
    let emptySource: "cache_hit" | "generated" = "cache_hit";
    let cacheStatus: CacheStatus = "hit";
    let emptyRoomGenerationCall = false;
    let emptyImage = cached;

    if (!emptyImage) {
      if (!request.originalImageUrl.trim()) return failure("original_url_evidence_failed");
      const fetchOriginal = dependencies.fetchOriginalImage ?? ((url: string) =>
        fetchRoomImageSafely(url, {
          allowedHosts: getAutoFloorVisionAllowedImageHosts(),
          maxBytes: getAutoFloorVisionImageMaxBytes(),
          timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
          allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
        }));
      const evidence = await verifyFetchedOriginalEvidence({ fetched: await fetchOriginal(request.originalImageUrl), original });
      if (evidence !== "ok") return failure(evidence);

      // This is the only generation path. The helper performs one cache lookup
      // and at most one compositor request; no retry or model fallback exists.
      emptyRoomGenerationCall = true;
      const generation = await (dependencies.getOrGenerateEmptyRoomImage ?? getOrGenerateEmptyRoomImage)({
        originalHash: original.sha256,
        baseImageUrl: request.originalImageUrl,
        resultAllowedHosts: getEmptyRoomAssistResultAllowedHosts(),
        maxBytes,
        fetchTimeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
        allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
        generationTimeoutMs: 60_000,
      });
      if (!generation.ok) {
        const compositorCallOccurred = generation.stage !== "config";
        const receipt = await writeUniqueReceipt({
          outputDir: prepared.outputDir,
          requestId: request.requestId,
          receipt: generationFailureReceipt({
            request,
            original,
            failureCode: "empty_generation_failed",
            compositorCallOccurred,
          }),
          writer: dependencies.captureWriter ?? writeAfcR3cImmutableCapture,
        });
        return receipt.ok
          ? failure("empty_generation_failed", compositorCallOccurred, false, receipt.filePath, true)
          : failure(receipt.code, compositorCallOccurred);
      }
      emptyImage = generation.image;
      cacheStatus = generation.cacheStatus;
      emptySource = generation.cacheStatus === "hit" ? "cache_hit" : "generated";
      // A helper-level hit cannot have called the compositor.
      emptyRoomGenerationCall = generation.cacheStatus === "miss";
    }

    const emptyResult = await verifyCachedEmptyImage({ image: emptyImage, maxBytes });
    if (!emptyResult.ok) {
      if (cacheStatus === "miss") {
        const receipt = await writeUniqueReceipt({
          outputDir: prepared.outputDir,
          requestId: request.requestId,
          receipt: generationFailureReceipt({
            request,
            original,
            failureCode: emptyResult.code,
            compositorCallOccurred: emptyRoomGenerationCall,
          }),
          writer: dependencies.captureWriter ?? writeAfcR3cImmutableCapture,
        });
        return receipt.ok
          ? failure(emptyResult.code, emptyRoomGenerationCall, false, receipt.filePath, true)
          : failure(receipt.code, emptyRoomGenerationCall);
      }
      return failure(emptyResult.code);
    }

    const empty = emptyResult.image;
    const originalFilename = `${request.roomId}.original.${original.sha256}.${extensionForMime(original.mimeType)}`;
    const emptyFilename = `${request.roomId}.empty-room.${empty.sha256}.${extensionForMime(empty.mimeType)}`;
    const writer = dependencies.captureWriter ?? writeAfcR3cImmutableCapture;

    const originalWrite = await writer({ outputDir: prepared.outputDir, filename: originalFilename, bytes: original.bytes });
    if (!originalWrite.ok) return failure("capture_write_failed", emptyRoomGenerationCall);
    const emptyWrite = await writer({ outputDir: prepared.outputDir, filename: emptyFilename, bytes: empty.bytes });
    if (!emptyWrite.ok) return failure("capture_write_failed", emptyRoomGenerationCall);

    const receipt = await writeUniqueReceipt({
      outputDir: prepared.outputDir,
      requestId: request.requestId,
      receipt: successfulReceipt({
        request,
        original,
        originalPath: originalWrite.filePath,
        empty,
        emptyPath: emptyWrite.filePath,
        cacheStatus,
        captureSource: emptySource,
        provenance: emptyResult.provenance,
        emptyRoomGenerationCall,
      }),
      writer,
    });
    if (!receipt.ok) return failure(receipt.code, emptyRoomGenerationCall);

    return Object.freeze({
      status: "captured" as const,
      captureSource: emptySource,
      originalPath: originalWrite.filePath,
      emptyPath: emptyWrite.filePath,
      receiptPath: receipt.filePath,
      emptyRoomGenerationCall,
      safety: safety({ emptyRoomGenerationCall, localResearchCaptureWritten: true }),
    });
  } finally {
    await releaseRequestReservation(reservation.filePath);
  }
}
