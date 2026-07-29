import "server-only";

import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { computeCalibrationImageFingerprint } from "@/lib/vibodeCalibrationImageBasis";
import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import type { AfcUi2aVerifiedOriginalEvidence } from "./afc-ui2a-original-preparation-replay";
import { deepFreeze, type AfcUi2aPackageFailureCode, type AfcUi2aVerifiedGenerationProvenance, type AfcUi2aVerifiedImageMetadata } from "./afc-ui2a-package-contract";
import type { AfcUi2aSupportedMime } from "./afc-ui2a-original-preparation-contract";

export const AFC_R3C_FIXED_EMPTY_RECEIPT_VERSION = "afc-r3c-fixed-empty-room-capture-receipt/v1" as const;
export const AFC_UI2A_EMPTY_GENERATOR_ID = "vibode-empty-room-assist/stage1-empty-room/v1" as const;

type FixedReceipt = Readonly<{
  receiptContractVersion: typeof AFC_R3C_FIXED_EMPTY_RECEIPT_VERSION;
  roomId: string;
  requestId: string;
  createdAt: string;
  captureSource: "cache_hit" | "generated";
  original: Readonly<{ sourceFilePath: string; capturedFilePath: string; sha256: string; byteCount: number; decodedWidth: number; decodedHeight: number; orientation: 1; mimeType: AfcUi2aSupportedMime }>;
  emptyRoomAssist: Readonly<{ capturedFilePath: string; sha256: string; byteCount: number; decodedWidth: number; decodedHeight: number; orientation: 1; mimeType: AfcUi2aSupportedMime; generatedFromOriginalSha256: string }>;
  generation: Readonly<{ cacheStatus: "hit" | "miss"; generatorId: string; requestedModelId: "NBP"; resolvedModelId: null; resolvedModelStatus: "not_reported_by_compositor"; appliedAspectRatio: string | null; imageTransport: "data_url" | "http_url"; generatedAt: string }>;
  safety: Readonly<{ applied: false; authoritative: false; persisted: false; activeCameraUnchanged: true; sceneStateUnchanged: true; databaseWrites: false; productionAssetWrites: false; productionTokenAccountingUsed: false; emptyRoomGenerationCall: boolean; geminiFloorProposalCall: false; localResearchCaptureWritten: true }>;
}>;

export type AfcUi2aVerifiedEmptyEvidence = Readonly<{
  canonicalReceiptFileName: string;
  emptyRoomAssist: AfcUi2aVerifiedImageMetadata & AfcUi2aVerifiedGenerationProvenance;
}>;
export type AfcUi2aDurableEmptyDiscovery =
  | Readonly<{ status: "absent" }>
  | Readonly<{ status: "selected"; evidence: AfcUi2aVerifiedEmptyEvidence }>
  | Readonly<{ status: "invalid"; failureCode: "durable_empty_invalid" | "empty_lineage_mismatch" | "pair_incompatible" }>
  | Readonly<{ status: "conflict"; failureCode: "conflicting_empty_evidence" }>;

export type AfcUi2aEmptyEvidenceReplayDependencies = Readonly<{
  inspectMetadata?: typeof inspectImageMetadata;
  fingerprint?: (bytes: Buffer) => string;
}>;

function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function pos(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function mime(value: unknown): value is AfcUi2aSupportedMime { return value === "image/jpeg" || value === "image/png" || value === "image/webp"; }
function iso(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(new Date(value).getTime()) && new Date(value).toISOString() === value;
}
function appliedAspectRatio(value: unknown): value is string | null {
  return value === null || typeof value === "string" && value.trim() === value && /^[A-Za-z0-9:._-]{1,32}$/.test(value);
}
function safeRequestId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value); }
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
function ext(value: AfcUi2aSupportedMime): "jpg" | "png" | "webp" { return value === "image/jpeg" ? "jpg" : value === "image/png" ? "png" : "webp"; }
function expectedEmptyName(roomId: string, hash: string, type: AfcUi2aSupportedMime): string { return `${roomId}.empty-room.${hash}.${ext(type)}`; }

/** Exact parser for successful fixed-capture receipts; failure-receipt shapes cannot parse here. */
export function parseAfcUi2aFixedEmptySuccessReceipt(value: unknown): { ok: true; receipt: FixedReceipt } | { ok: false } {
  if (!record(value) || !keys(value, ["receiptContractVersion", "roomId", "requestId", "createdAt", "captureSource", "original", "emptyRoomAssist", "generation", "safety"])) return { ok: false };
  if (value.receiptContractVersion !== AFC_R3C_FIXED_EMPTY_RECEIPT_VERSION || typeof value.roomId !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value.roomId) ||
    !safeRequestId(value.requestId) || !iso(value.createdAt) || (value.captureSource !== "cache_hit" && value.captureSource !== "generated") ||
    !record(value.original) || !record(value.emptyRoomAssist) || !record(value.generation) || !record(value.safety)) return { ok: false };
  const original = value.original; const empty = value.emptyRoomAssist; const generation = value.generation; const safety = value.safety;
  if (!keys(original, ["sourceFilePath", "capturedFilePath", "sha256", "byteCount", "decodedWidth", "decodedHeight", "orientation", "mimeType"]) ||
    typeof original.sourceFilePath !== "string" || !path.isAbsolute(original.sourceFilePath) || typeof original.capturedFilePath !== "string" || !path.isAbsolute(original.capturedFilePath) || !sha(original.sha256) || !pos(original.byteCount) || !pos(original.decodedWidth) || !pos(original.decodedHeight) || original.orientation !== 1 || !mime(original.mimeType)) return { ok: false };
  if (!keys(empty, ["capturedFilePath", "sha256", "byteCount", "decodedWidth", "decodedHeight", "orientation", "mimeType", "generatedFromOriginalSha256"]) ||
    typeof empty.capturedFilePath !== "string" || !path.isAbsolute(empty.capturedFilePath) || !sha(empty.sha256) || !pos(empty.byteCount) || !pos(empty.decodedWidth) || !pos(empty.decodedHeight) || empty.orientation !== 1 || !mime(empty.mimeType) || !sha(empty.generatedFromOriginalSha256)) return { ok: false };
  if (!keys(generation, ["cacheStatus", "generatorId", "requestedModelId", "resolvedModelId", "resolvedModelStatus", "appliedAspectRatio", "imageTransport", "generatedAt"]) ||
    (generation.cacheStatus !== "hit" && generation.cacheStatus !== "miss") || typeof generation.generatorId !== "string" || generation.requestedModelId !== "NBP" ||
    generation.resolvedModelId !== null || generation.resolvedModelStatus !== "not_reported_by_compositor" || !appliedAspectRatio(generation.appliedAspectRatio) ||
    (generation.imageTransport !== "data_url" && generation.imageTransport !== "http_url") || !iso(generation.generatedAt)) return { ok: false };
  const expectedSafety = { applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true, sceneStateUnchanged: true, databaseWrites: false, productionAssetWrites: false, productionTokenAccountingUsed: false, geminiFloorProposalCall: false, localResearchCaptureWritten: true };
  if (!keys(safety, [...Object.keys(expectedSafety), "emptyRoomGenerationCall"]) || typeof safety.emptyRoomGenerationCall !== "boolean" ||
    Object.entries(expectedSafety).some(([key, expected]) => safety[key] !== expected)) return { ok: false };
  return { ok: true, receipt: value as FixedReceipt };
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
  } catch { return null; }
}

async function verifyReceipt(args: {
  receipt: FixedReceipt;
  receiptFileName: string;
  original: AfcUi2aVerifiedOriginalEvidence;
  dependencies: AfcUi2aEmptyEvidenceReplayDependencies;
}): Promise<{ ok: true; evidence: AfcUi2aVerifiedEmptyEvidence } | { ok: false; failureCode: AfcUi2aPackageFailureCode }> {
  const { receipt, original } = args;
  if (receipt.roomId !== original.roomId || receipt.original.sha256 !== original.original.sha256 || receipt.emptyRoomAssist.generatedFromOriginalSha256 !== original.original.sha256) {
    return { ok: false, failureCode: "empty_lineage_mismatch" };
  }
  if (path.basename(receipt.original.capturedFilePath) !== original.original.fileName) {
    return { ok: false, failureCode: "empty_lineage_mismatch" };
  }
  if (receipt.generation.generatorId !== AFC_UI2A_EMPTY_GENERATOR_ID || receipt.generation.requestedModelId !== "NBP" || receipt.generation.resolvedModelId !== null || receipt.generation.resolvedModelStatus !== "not_reported_by_compositor") {
    return { ok: false, failureCode: "durable_empty_invalid" };
  }
  if (path.basename(receipt.emptyRoomAssist.capturedFilePath) !== expectedEmptyName(original.roomId, receipt.emptyRoomAssist.sha256, receipt.emptyRoomAssist.mimeType)) {
    return { ok: false, failureCode: "durable_empty_invalid" };
  }
  const emptyPath = await localRegularFile(original.roomDirectory, path.basename(receipt.emptyRoomAssist.capturedFilePath));
  if (!emptyPath) return { ok: false, failureCode: "durable_empty_invalid" };
  let bytes: Buffer;
  try { bytes = await readFile(emptyPath); } catch { return { ok: false, failureCode: "durable_empty_invalid" }; }
  const type = mimeFromBytes(bytes);
  const fingerprint = args.dependencies.fingerprint ?? computeCalibrationImageFingerprint;
  if (!type || type !== receipt.emptyRoomAssist.mimeType || bytes.byteLength !== receipt.emptyRoomAssist.byteCount || fingerprint(bytes) !== receipt.emptyRoomAssist.sha256) {
    return { ok: false, failureCode: "durable_empty_invalid" };
  }
  const metadata = await (args.dependencies.inspectMetadata ?? inspectImageMetadata)(bytes);
  if (!metadata.ok || metadata.orientation !== 1 || metadata.width !== receipt.emptyRoomAssist.decodedWidth || metadata.height !== receipt.emptyRoomAssist.decodedHeight) {
    return { ok: false, failureCode: "durable_empty_invalid" };
  }
  if (metadata.width !== original.original.decodedWidth || metadata.height !== original.original.decodedHeight) return { ok: false, failureCode: "pair_incompatible" };
  return {
    ok: true,
    evidence: deepFreeze({
      canonicalReceiptFileName: args.receiptFileName,
      emptyRoomAssist: {
        fileName: expectedEmptyName(original.roomId, receipt.emptyRoomAssist.sha256, type),
        sha256: receipt.emptyRoomAssist.sha256,
        byteCount: bytes.byteLength,
        mimeType: type,
        decodedWidth: metadata.width,
        decodedHeight: metadata.height,
        orientation: 1 as const,
        generatedFromOriginalSha256: original.original.sha256,
        generatorId: receipt.generation.generatorId,
        requestedModelId: "NBP" as const,
        resolvedModelId: null,
        resolvedModelStatus: "not_reported_by_compositor" as const,
      },
    }),
  };
}

/** Read-only durable discovery; path-bearing legacy receipt fields are never dereferenced. */
export async function discoverAfcUi2aDurableEmptyEvidence(
  original: AfcUi2aVerifiedOriginalEvidence,
  dependencies: AfcUi2aEmptyEvidenceReplayDependencies = {}
): Promise<AfcUi2aDurableEmptyDiscovery> {
  let names: string[];
  try { names = (await readdir(original.roomDirectory)).filter((name) => /^afc-r3c-fixed-empty-room\.[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.receipt\.json$/.test(name)).sort(); }
  catch { return deepFreeze({ status: "invalid" as const, failureCode: "durable_empty_invalid" as const }); }
  if (!names.length) return deepFreeze({ status: "absent" as const });
  const valid = new Map<string, AfcUi2aVerifiedEmptyEvidence>();
  let malformed = false;
  let lineageFailure: "empty_lineage_mismatch" | "pair_incompatible" | null = null;
  for (const name of names) {
    const receiptPath = await localRegularFile(original.roomDirectory, name);
    if (!receiptPath) { malformed = true; continue; }
    let raw: unknown;
    try { raw = JSON.parse((await readFile(receiptPath)).toString("utf8")); } catch { malformed = true; continue; }
    const parsed = parseAfcUi2aFixedEmptySuccessReceipt(raw);
    if (!parsed.ok) { malformed = true; continue; }
    if (parsed.receipt.roomId !== original.roomId || parsed.receipt.original.sha256 !== original.original.sha256 || parsed.receipt.emptyRoomAssist.generatedFromOriginalSha256 !== original.original.sha256) continue;
    const verified = await verifyReceipt({ receipt: parsed.receipt, receiptFileName: name, original, dependencies });
    if (!verified.ok) {
      if (verified.failureCode === "empty_lineage_mismatch" || verified.failureCode === "pair_incompatible") lineageFailure = verified.failureCode;
      else malformed = true;
      continue;
    }
    const existing = valid.get(verified.evidence.emptyRoomAssist.sha256);
    if (!existing || name < existing.canonicalReceiptFileName) valid.set(verified.evidence.emptyRoomAssist.sha256, verified.evidence);
  }
  if (valid.size > 1) return deepFreeze({ status: "conflict" as const, failureCode: "conflicting_empty_evidence" as const });
  if (valid.size === 1) return deepFreeze({ status: "selected" as const, evidence: [...valid.values()][0] });
  if (lineageFailure) return deepFreeze({ status: "invalid" as const, failureCode: lineageFailure });
  return malformed ? deepFreeze({ status: "invalid" as const, failureCode: "durable_empty_invalid" as const }) : deepFreeze({ status: "absent" as const });
}
