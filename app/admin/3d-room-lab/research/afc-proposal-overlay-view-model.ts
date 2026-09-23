/**
 * AFC-UI1A — read-only replay of an immutable AFC-R3C proposal receipt.
 *
 * This module deliberately has no provider, runner, capture-writer, compositor,
 * scene, camera, or persistence imports. It is the server-only verification
 * boundary for displaying already captured evidence.
 */
import "server-only";

import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inspectImageMetadata } from "@/lib/vibodeAutoFloorImageFetch";
import { classifyAfcR3cImagePairCompatibility } from "./gemini-floor-proposal-composition";
import { GEMINI_FLOOR_COORDINATE_EXTENT_POLICY, parseGeminiFloorProposalResponse } from "./gemini-floor-proposal-contract";
import { parseAfcR3cImageManifest, type AfcR3cImageManifestV1 } from "./gemini-floor-proposal-manifest";

export const AFC_UI1_CAPTURE_ROOT_RELATIVE = path.join(".local", "afc-r3c-captures");
export const AFC_UI1_RECEIPT_VERSION = "afc-r3c-proposal-run-receipt/v1" as const;
export const AFC_UI1_FIXED_INPUTS_DIRECTORY_NAME = "vibode-afc-r3c-fixed-inputs" as const;

type JsonPrimitive = string | number | boolean | null;
export type AfcOverlayJson = JsonPrimitive | readonly AfcOverlayJson[] | AfcOverlayJsonObject;
export interface AfcOverlayJsonObject { readonly [key: string]: AfcOverlayJson; }
type ImageRole = "original" | "empty";
type ReceiptImageRole = "empty_room_boundary_specialist" | "original_contextual";

export type AfcProposalReceiptSummary = Readonly<{
  receiptFileName: string;
  receiptSha256: string;
  createdAt: string;
  roomId: string;
  studyMode: string;
  imageRole: string;
  requestId: string;
  r3cCandidateId: string;
  candidateCount: number;
}>;

export type AfcProposalReceiptInventory = Readonly<{
  receipts: readonly AfcProposalReceiptSummary[];
  invalidCandidateCount: number;
}>;

export type AfcProposalOverlayViewModel = Readonly<{
  artifactIdentity: Readonly<{
    receiptFileName: string;
    receiptSha256: string;
    requestId: string;
    createdAt: string;
    roomId: string;
    studyMode: string;
    imageRole: ReceiptImageRole;
  }>;
  imageBasis: Readonly<{
    basisBinding: string;
    manifestVersion: string;
    original: Readonly<{ sha256: string; width: number; height: number; mimeType: string }>;
    emptyRoom: Readonly<{ sha256: string; width: number; height: number; mimeType: string; generatedFromOriginalSha256: string }>;
  }>;
  /** Replay-verified Original ↔ Empty transfer classification. */
  pairCompatibility: Readonly<{
    tier: "exact_grid_compatible" | "aspect_compatible_rescaled";
    relativeAspectErrorRaw: number;
    relativeAspectError: number;
  }>;
  candidate: Readonly<{
    r3bCandidateId: string;
    r3cCandidateId: string;
    coordinateSpace: "source-normalized/v1";
    semanticOrder: readonly ["NL", "NR", "FR", "FL"];
  }>;
  corners: Readonly<{
    NL: Readonly<{ x: number; y: number; support: string }>;
    NR: Readonly<{ x: number; y: number; support: string }>;
    FR: Readonly<{ x: number; y: number; support: string }>;
    FL: Readonly<{ x: number; y: number; support: string }>;
  }>;
  edges: Readonly<{
    near: Readonly<{ support: string; note: string }>;
    right: Readonly<{ support: string; note: string }>;
    far: Readonly<{ support: string; note: string }>;
    left: Readonly<{ support: string; note: string }>;
  }>;
  warnings: readonly string[];
  provenance: Readonly<{
    prompt: Readonly<{ contractVersion: string; version: string; sha256: string }>;
    provider: Readonly<{ providerId: string; modelId: string; modelVersion: string; finishReason: string; extractionPolicyVersion: string; usageMetadata: AfcOverlayJson }>;
    afcR3b: Readonly<{ status: string; candidateIds: readonly string[] }>;
    afcR3c: Readonly<{ status: string; candidateIds: readonly string[] }>;
    afcR2: Readonly<{ selectionState: string; comparisonFingerprint: string | null }>;
    artifactHashes: Readonly<{ providerEnvelopeSha256: string; modelOutputSha256: string; receiptSha256: string }>;
  }>;
  safety: Readonly<{
    researchOnly: true;
    applied: false;
    authoritative: false;
    persisted: false;
    activeCameraUnchanged: true;
  }>;
  raw: Readonly<{ receipt: AfcOverlayJson; modelOutput: AfcOverlayJson }>;
}>;

export type AfcProposalOverlayFailure = Readonly<{
  status: "invalid" | "basis_mismatch" | "unsupported";
  reason: string;
  path: string;
}>;
export type AfcProposalOverlayReplay =
  | Readonly<{ status: "valid"; viewModel: AfcProposalOverlayViewModel; images: Readonly<Record<ImageRole, VerifiedImage>> }>
  | AfcProposalOverlayFailure;

export type VerifiedImage = Readonly<{
  role: ImageRole;
  bytes: Buffer;
  sha256: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
}>;

export type AfcProposalOverlayReplayOptions = Readonly<{
  receiptFileName: string;
  captureRoot?: string;
  fixedInputsRoot?: string | null;
  /** Test-only root resolver; production always enforces the configured policy. */
  resolveFixedInputsRoot?: (value: string | null | undefined) => Promise<string | null>;
}>;

type StrictReceipt = Readonly<{
  requestId: string;
  createdAt: string;
  roomId: string;
  studyMode: "empty_only" | "original_only" | "parallel_union";
  imageRole: ReceiptImageRole;
  inputImage: Readonly<{ fingerprint: string; decodedWidth: number; decodedHeight: number; orientation: 1; mimeType: string }>;
  originalImageFingerprint: string;
  emptyRoomAssistFingerprint: string;
  compatibility: Readonly<{ tier: "exact_grid_compatible" | "aspect_compatible_rescaled"; relativeAspectErrorRaw: number; relativeAspectError: number }>;
  prompt: Readonly<{ contractVersion: string; version: string; sha256: string }>;
  provider: Readonly<{
    providerId: string; modelId: string; providerEnvelopeSha256: string; providerEnvelopeByteLength: number;
    modelOutputTextSha256: string; modelOutputUtf8ByteLength: number; finishReason: string; providerModelVersion: string;
    extractionPolicyVersion: string; usageMetadata: AfcOverlayJson;
  }>;
  afcR3b: Readonly<{ status: "proposals"; candidateIds: readonly string[] }>;
  afcR3c: Readonly<{ compositionStatus: "proposals"; candidateIds: readonly string[] }>;
  afcR2: Readonly<{ comparisonFingerprint: string | null; selectionState: "not_run" }>;
  capture: Readonly<{ providerEnvelopePath: string; modelOutputPath: string }>;
}>;

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    // Exact verified image bytes remain server-private; populated typed arrays
    // cannot be frozen by Node and are never exposed in the view model.
    if (ArrayBuffer.isView(object)) return value;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
    Object.freeze(object);
  }
  return value;
}

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function json(value: unknown): AfcOverlayJson {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(json);
  if (plain(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, json(child)]));
  throw new TypeError("Value is not JSON.");
}
function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function text(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && !/[\0\r\n]/.test(value);
}
function positiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function failure(status: AfcProposalOverlayFailure["status"], reason: string, at: string): AfcProposalOverlayFailure {
  return deepFreeze({ status, reason, path: at });
}
function safeFileName(value: string): boolean {
  return value.length > 0 && value === path.basename(value) && !value.includes("\0");
}
function isReceiptFilename(value: string): boolean {
  return /^afc-r3c-run\.[A-Za-z0-9._-]{1,180}\.receipt\.json$/.test(value);
}
function expectedArtifactFilename(prefix: "provider-envelope" | "model-output", digestValue: string): string {
  return `${prefix}.${digestValue}.json`;
}

const FRAME_TRUNCATION_SIGNAL = /\b(?:image frame|frame boundary|cropp?ed|clipp(?:ed|ing)|exits? the image|outside the image|cut across the visible floor)\b/i;

/**
 * Operator qualifications are derived only from already validated AFC evidence.
 * They are not captured model evidence and never mutate support enums or notes.
 */
export function deriveAfcProposalOperatorWarnings(input: Readonly<{
  corners: Readonly<Record<"NL" | "NR" | "FR" | "FL", Readonly<{ x: number; y: number; support: string }>>>;
  near: Readonly<{ support: string; note: string }>;
}>): readonly string[] {
  const outsideFrame = Object.values(input.corners).some((corner) =>
    corner.x < 0 || corner.x > 1 || corner.y < 0 || corner.y > 1 || corner.support === "outside_frame_inferred"
  );
  const nearQualifies = ["partially_visible", "inferred_continuation", "not_visible"].includes(input.near.support) ||
    FRAME_TRUNCATION_SIGNAL.test(input.near.note);
  const warnings: string[] = [];
  if (nearQualifies) {
    warnings.push("Operator qualification — validated near-edge evidence indicates possible frame truncation. Captured support values and notes remain unchanged.");
  }
  if (outsideFrame) {
    warnings.push("Operator qualification — one or more valid AFC-R3B coordinates extend outside the visible image frame and may be visually clipped; values are not clamped.");
  }
  return deepFreeze(warnings);
}

async function canonicalDirectory(root: string): Promise<string | null> {
  try {
    const metadata = await lstat(root);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return null;
    return await realpath(root);
  } catch {
    return null;
  }
}
async function safeRead(root: string, filename: string): Promise<Buffer | null> {
  if (!safeFileName(filename)) return null;
  const target = path.resolve(root, filename);
  if (!inside(root, target)) return null;
  try {
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) return null;
    const actual = await realpath(target);
    if (!inside(root, actual)) return null;
    return await readFile(actual);
  } catch {
    return null;
  }
}

/** Fixed inputs must be explicitly configured under the operator's home directory. */
export async function resolveAfcUi1FixedInputsRoot(value: string | null | undefined): Promise<string | null> {
  if (typeof value !== "string" || !value.trim() || value.includes("\0") || !path.isAbsolute(value)) return null;
  const configured = path.resolve(value.trim());
  if (path.basename(configured) !== AFC_UI1_FIXED_INPUTS_DIRECTORY_NAME || !inside(path.resolve(os.homedir()), configured)) return null;
  const resolved = await canonicalDirectory(configured);
  return resolved && inside(path.resolve(os.homedir()), resolved) && path.basename(resolved) === AFC_UI1_FIXED_INPUTS_DIRECTORY_NAME ? resolved : null;
}

function parseReceipt(value: unknown): StrictReceipt | AfcProposalOverlayFailure {
  if (!plain(value)) return failure("invalid", "Receipt must be a JSON object.", "$");
  const required = ["receiptContractVersion", "requestId", "createdAt", "roomId", "studyMode", "imageRole", "inputImage", "originalImageFingerprint", "emptyRoomAssistFingerprint", "compatibility", "prompt", "provider", "afcR3b", "afcR3c", "afcR2", "capture", "safety"];
  if (!exactKeys(value, required)) return failure("unsupported", "Receipt has an unknown or missing field.", "$");
  if (value.receiptContractVersion !== AFC_UI1_RECEIPT_VERSION) return failure("unsupported", "Unsupported receipt contract version.", "$.receiptContractVersion");
  if (!text(value.requestId, 180) || !/^[A-Za-z0-9._-]+$/.test(value.requestId) || !text(value.createdAt, 64) || Number.isNaN(Date.parse(value.createdAt)) || !text(value.roomId, 128) || !/^[A-Za-z0-9._-]+$/.test(value.roomId)) {
    return failure("invalid", "Receipt identity is invalid.", "$");
  }
  if (!["empty_only", "original_only", "parallel_union"].includes(value.studyMode as string) || !["empty_room_boundary_specialist", "original_contextual"].includes(value.imageRole as string)) {
    return failure("unsupported", "Receipt study mode or image role is unsupported.", "$.studyMode");
  }
  const image = value.inputImage;
  if (!plain(image) || !exactKeys(image, ["fingerprint", "decodedWidth", "decodedHeight", "orientation", "mimeType"]) || !digest(image.fingerprint) || !positiveInt(image.decodedWidth) || !positiveInt(image.decodedHeight) || image.orientation !== 1 || !["image/jpeg", "image/png", "image/webp"].includes(image.mimeType as string)) {
    return failure("invalid", "Receipt input image is invalid.", "$.inputImage");
  }
  if (!digest(value.originalImageFingerprint) || !digest(value.emptyRoomAssistFingerprint)) return failure("invalid", "Receipt image fingerprints are invalid.", "$");
  const compatibility = value.compatibility;
  if (!plain(compatibility) || !exactKeys(compatibility, ["tier", "relativeAspectErrorRaw", "relativeAspectError"]) ||
    !["exact_grid_compatible", "aspect_compatible_rescaled"].includes(compatibility.tier as string) ||
    typeof compatibility.relativeAspectErrorRaw !== "number" || !Number.isFinite(compatibility.relativeAspectErrorRaw) ||
    typeof compatibility.relativeAspectError !== "number" || !Number.isFinite(compatibility.relativeAspectError)) {
    return failure("invalid", "Receipt image compatibility is invalid.", "$.compatibility");
  }
  if (!plain(value.prompt) || !exactKeys(value.prompt, ["contractVersion", "version", "sha256"]) || !text(value.prompt.contractVersion) || !text(value.prompt.version) || !digest(value.prompt.sha256)) return failure("invalid", "Receipt prompt provenance is invalid.", "$.prompt");
  const provider = value.provider;
  const providerKeys = ["providerId", "modelId", "generationConfig", "providerEnvelopeSha256", "providerEnvelopeByteLength", "modelOutputTextSha256", "modelOutputUtf8ByteLength", "finishReason", "providerModelVersion", "usageMetadata", "extractionPolicyVersion"];
  if (!plain(provider) || !exactKeys(provider, providerKeys) || !text(provider.providerId) || !text(provider.modelId) || !digest(provider.providerEnvelopeSha256) || !positiveInt(provider.providerEnvelopeByteLength) || !digest(provider.modelOutputTextSha256) || !positiveInt(provider.modelOutputUtf8ByteLength) || !text(provider.finishReason) || !text(provider.providerModelVersion) || !text(provider.extractionPolicyVersion)) return failure("invalid", "Receipt provider provenance is invalid.", "$.provider");
  const generationConfig = provider.generationConfig;
  if (!plain(generationConfig) || !exactKeys(generationConfig, ["contractVersion", "temperature", "maxOutputTokens", "responseMimeType", "thinkingLevel", "thinkingLevelApplied"]) ||
    generationConfig.contractVersion !== "afc-r3c-gemini-generation/v1" ||
    typeof generationConfig.temperature !== "number" || !Number.isFinite(generationConfig.temperature) ||
    !positiveInt(generationConfig.maxOutputTokens) || generationConfig.responseMimeType !== "application/json" ||
    !text(generationConfig.thinkingLevel) || typeof generationConfig.thinkingLevelApplied !== "boolean") {
    return failure("invalid", "Receipt provider generation configuration is invalid.", "$.provider.generationConfig");
  }
  const usage = provider.usageMetadata;
  if (!plain(usage) || !exactKeys(usage, ["promptTokenCount", "candidatesTokenCount", "totalTokenCount", "promptTokensDetails", "serviceTier"]) ||
    ![usage.promptTokenCount, usage.candidatesTokenCount, usage.totalTokenCount].every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    !Array.isArray(usage.promptTokensDetails) || !usage.promptTokensDetails.every((detail) => plain(detail) && exactKeys(detail, ["modality", "tokenCount"]) && ["IMAGE", "TEXT"].includes(detail.modality as string) && typeof detail.tokenCount === "number" && Number.isSafeInteger(detail.tokenCount) && detail.tokenCount >= 0) ||
    !text(usage.serviceTier)) {
    return failure("invalid", "Receipt provider usage metadata is invalid.", "$.provider.usageMetadata");
  }
  const r3b = value.afcR3b;
  if (!plain(r3b) || !exactKeys(r3b, ["status", "failureReason", "failurePath", "candidateIds"]) || r3b.status !== "proposals" || r3b.failureReason !== null || r3b.failurePath !== null || !Array.isArray(r3b.candidateIds) || r3b.candidateIds.length < 1 || !r3b.candidateIds.every((id) => typeof id === "string")) return failure("invalid", "Receipt AFC-R3B claims are invalid.", "$.afcR3b");
  const r3c = value.afcR3c;
  if (!plain(r3c) || !exactKeys(r3c, ["compositionStatus", "candidateIds"]) || r3c.compositionStatus !== "proposals" || !Array.isArray(r3c.candidateIds) || r3c.candidateIds.length !== r3b.candidateIds.length || !r3c.candidateIds.every((id) => typeof id === "string")) return failure("invalid", "Receipt AFC-R3C claims are invalid.", "$.afcR3c");
  const r2 = value.afcR2;
  if (!plain(r2) || !exactKeys(r2, ["comparisonFingerprint", "selectionState"]) || r2.comparisonFingerprint !== null || r2.selectionState !== "not_run") return failure("invalid", "Receipt AFC-R2 state is unsafe.", "$.afcR2");
  const capture = value.capture;
  if (!plain(capture) || !exactKeys(capture, ["providerEnvelopePath", "modelOutputPath"]) || typeof capture.providerEnvelopePath !== "string" || typeof capture.modelOutputPath !== "string") return failure("invalid", "Receipt capture references are invalid.", "$.capture");
  const safety = value.safety;
  if (!plain(safety) || !exactKeys(safety, ["researchOnly", "applied", "authoritative", "persisted", "activeCameraUnchanged", "noCompositorCall", "noUserTokenAccounting"]) || safety.researchOnly !== true || safety.applied !== false || safety.authoritative !== false || safety.persisted !== false || safety.activeCameraUnchanged !== true || safety.noCompositorCall !== true || safety.noUserTokenAccounting !== true) return failure("invalid", "Receipt safety declarations are unsafe.", "$.safety");
  return {
    requestId: value.requestId, createdAt: value.createdAt, roomId: value.roomId, studyMode: value.studyMode as StrictReceipt["studyMode"], imageRole: value.imageRole as ReceiptImageRole,
    inputImage: image as StrictReceipt["inputImage"], originalImageFingerprint: value.originalImageFingerprint, emptyRoomAssistFingerprint: value.emptyRoomAssistFingerprint,
    compatibility: compatibility as StrictReceipt["compatibility"],
    prompt: value.prompt as StrictReceipt["prompt"],
    provider: { providerId: provider.providerId, modelId: provider.modelId, providerEnvelopeSha256: provider.providerEnvelopeSha256, providerEnvelopeByteLength: provider.providerEnvelopeByteLength, modelOutputTextSha256: provider.modelOutputTextSha256, modelOutputUtf8ByteLength: provider.modelOutputUtf8ByteLength, finishReason: provider.finishReason, providerModelVersion: provider.providerModelVersion, extractionPolicyVersion: provider.extractionPolicyVersion, usageMetadata: json(provider.usageMetadata) },
    afcR3b: { status: "proposals", candidateIds: r3b.candidateIds as string[] }, afcR3c: { compositionStatus: "proposals", candidateIds: r3c.candidateIds as string[] },
    afcR2: { comparisonFingerprint: null, selectionState: "not_run" }, capture: capture as StrictReceipt["capture"],
  };
}

function extractEnvelopeText(envelope: unknown): { text: string; finishReason: string; modelVersion: string; usageMetadata: AfcOverlayJson } | null {
  if (!plain(envelope) || !Array.isArray(envelope.candidates) || envelope.candidates.length !== 1 || !plain(envelope.candidates[0])) return null;
  const candidate = envelope.candidates[0];
  const content = candidate.content;
  if (!plain(content) || !exactKeys(candidate, ["content", "finishReason", "index"]) || candidate.index !== 0 || !text(candidate.finishReason) || !exactKeys(content, ["parts", "role"]) || content.role !== "model" || !Array.isArray(content.parts) || content.parts.length !== 1 || !plain(content.parts[0])) return null;
  const part = content.parts[0];
  if (!Object.keys(part).every((key) => key === "text" || key === "thoughtSignature") || typeof part.text !== "string" || Buffer.byteLength(part.text, "utf8") === 0 || Buffer.byteLength(part.text, "utf8") > 65_536) return null;
  if (part.thoughtSignature !== undefined && !text(part.thoughtSignature, 4096)) return null;
  if (!text(envelope.modelVersion) || !Object.hasOwn(envelope, "usageMetadata")) return null;
  return { text: part.text, finishReason: candidate.finishReason, modelVersion: envelope.modelVersion, usageMetadata: json(envelope.usageMetadata) };
}

function mimeFromBytes(bytes: Buffer): VerifiedImage["mimeType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}
async function verifyImage(root: string, descriptor: AfcR3cImageManifestV1["original"], role: ImageRole): Promise<VerifiedImage | AfcProposalOverlayFailure> {
  if (path.basename(descriptor.filePath) !== descriptor.filePath) return failure("invalid", "Manifest image path is unsafe.", `$.${role}.filePath`);
  const bytes = await safeRead(root, descriptor.filePath);
  if (!bytes) return failure("invalid", "Verified image is missing or escapes the fixed-input root.", `$.${role}.filePath`);
  if (bytes.byteLength !== descriptor.byteCount || sha256(bytes) !== descriptor.sha256) return failure("invalid", "Verified image bytes do not match the manifest.", `$.${role}`);
  if (mimeFromBytes(bytes) !== descriptor.mimeType) return failure("invalid", "Verified image MIME does not match the manifest.", `$.${role}.mimeType`);
  const metadata = await inspectImageMetadata(bytes);
  if (!metadata.ok || metadata.width !== descriptor.decodedWidth || metadata.height !== descriptor.decodedHeight || metadata.orientation !== descriptor.orientation) return failure("invalid", "Verified image dimensions or orientation do not match the manifest.", `$.${role}`);
  return deepFreeze({ role, bytes, sha256: descriptor.sha256, mimeType: descriptor.mimeType, width: metadata.width, height: metadata.height });
}

export async function replayAfcProposalOverlay(options: AfcProposalOverlayReplayOptions): Promise<AfcProposalOverlayReplay> {
  if (!isReceiptFilename(options.receiptFileName)) return failure("invalid", "Receipt filename is not allow-listed.", "$.receiptFileName");
  const captureRoot = await canonicalDirectory(options.captureRoot ?? path.join(process.cwd(), AFC_UI1_CAPTURE_ROOT_RELATIVE));
  const fixedRoot = await (options.resolveFixedInputsRoot ?? resolveAfcUi1FixedInputsRoot)(
    options.fixedInputsRoot ?? process.env.AFC_UI1_FIXED_INPUTS_ROOT
  );
  if (!captureRoot) return failure("invalid", "AFC capture root is unavailable.", "$.captureRoot");
  if (!fixedRoot) return failure("invalid", "AFC fixed-input root is unavailable or disallowed.", "$.fixedInputsRoot");
  const receiptBytes = await safeRead(captureRoot, options.receiptFileName);
  if (!receiptBytes) return failure("invalid", "Receipt is missing or escapes the capture root.", "$.receiptFileName");
  let rawReceipt: unknown;
  try { rawReceipt = JSON.parse(receiptBytes.toString("utf8")); } catch { return failure("invalid", "Receipt is not valid JSON.", "$"); }
  const receipt = parseReceipt(rawReceipt);
  if ("status" in receipt) return receipt;
  const envelopeName = expectedArtifactFilename("provider-envelope", receipt.provider.providerEnvelopeSha256);
  const modelName = expectedArtifactFilename("model-output", receipt.provider.modelOutputTextSha256);
  if (path.basename(receipt.capture.providerEnvelopePath) !== envelopeName || path.basename(receipt.capture.modelOutputPath) !== modelName) return failure("invalid", "Receipt artifact path identifier does not match its pinned digest.", "$.capture");
  const [envelopeBytes, modelBytes] = await Promise.all([safeRead(captureRoot, envelopeName), safeRead(captureRoot, modelName)]);
  if (!envelopeBytes || !modelBytes) return failure("invalid", "Receipt artifact is missing or unsafe.", "$.capture");
  if (envelopeBytes.byteLength !== receipt.provider.providerEnvelopeByteLength || sha256(envelopeBytes) !== receipt.provider.providerEnvelopeSha256) return failure("invalid", "Provider envelope hash mismatch.", "$.provider.providerEnvelopeSha256");
  if (modelBytes.byteLength !== receipt.provider.modelOutputUtf8ByteLength || sha256(modelBytes) !== receipt.provider.modelOutputTextSha256) return failure("invalid", "Model output hash mismatch.", "$.provider.modelOutputTextSha256");
  let rawEnvelope: unknown;
  let rawModel: unknown;
  try { rawEnvelope = JSON.parse(envelopeBytes.toString("utf8")); rawModel = JSON.parse(modelBytes.toString("utf8")); } catch { return failure("invalid", "Captured artifact is not valid JSON.", "$.capture"); }
  const extraction = extractEnvelopeText(rawEnvelope);
  const modelText = modelBytes.toString("utf8");
  if (!extraction) return failure("invalid", "Provider envelope is not an accepted single-text AFC capture.", "$.provider");
  if (extraction.text !== modelText) return failure("invalid", "Provider envelope text does not exactly match the receipt-pinned model output.", "$.provider");
  if (extraction.finishReason !== receipt.provider.finishReason || extraction.modelVersion !== receipt.provider.providerModelVersion) return failure("invalid", "Provider envelope finish or model provenance does not match the receipt.", "$.provider");
  if (JSON.stringify(extraction.usageMetadata) !== JSON.stringify(receipt.provider.usageMetadata)) return failure("invalid", "Provider envelope usage provenance does not match the receipt.", "$.provider.usageMetadata");
  const manifestName = `afc-r3c-${receipt.roomId}.image-manifest.v1.json`;
  const manifestRoot = path.join(fixedRoot, receipt.roomId);
  const canonicalManifestRoot = await canonicalDirectory(manifestRoot);
  if (!canonicalManifestRoot || !inside(fixedRoot, canonicalManifestRoot)) return failure("invalid", "Room fixed-input directory is unavailable or unsafe.", "$.roomId");
  const manifestBytes = await safeRead(canonicalManifestRoot, manifestName);
  if (!manifestBytes) return failure("invalid", "Fixed-input manifest is missing or unsafe.", "$.manifest");
  let rawManifest: unknown;
  try { rawManifest = JSON.parse(manifestBytes.toString("utf8")); } catch { return failure("invalid", "Fixed-input manifest is not valid JSON.", "$.manifest"); }
  const parsedManifest = parseAfcR3cImageManifest(rawManifest);
  if (!parsedManifest.ok) return failure("invalid", parsedManifest.reason, parsedManifest.path);
  const manifest = parsedManifest.manifest;
  if (manifest.roomId !== receipt.roomId || manifest.original.sha256 !== receipt.originalImageFingerprint || manifest.emptyRoomAssist.sha256 !== receipt.emptyRoomAssistFingerprint || manifest.emptyRoomAssist.generatedFromOriginalSha256 !== manifest.original.sha256) return failure("basis_mismatch", "Receipt image lineage does not match the fixed-input manifest.", "$.manifest");
  const compatibility = classifyAfcR3cImagePairCompatibility(
    { fingerprint: manifest.original.sha256, decodedWidth: manifest.original.decodedWidth, decodedHeight: manifest.original.decodedHeight, orientation: manifest.original.orientation },
    { fingerprint: manifest.emptyRoomAssist.sha256, decodedWidth: manifest.emptyRoomAssist.decodedWidth, decodedHeight: manifest.emptyRoomAssist.decodedHeight, orientation: manifest.emptyRoomAssist.orientation }
  );
  if (compatibility.tier === "incompatible" || compatibility.tier !== receipt.compatibility.tier ||
    compatibility.relativeAspectErrorRaw !== receipt.compatibility.relativeAspectErrorRaw ||
    compatibility.relativeAspectError !== receipt.compatibility.relativeAspectError) {
    return failure("basis_mismatch", "Receipt image compatibility does not match the validated manifest pair.", "$.compatibility");
  }
  const expectedInput = receipt.imageRole === "empty_room_boundary_specialist" ? manifest.emptyRoomAssist : manifest.original;
  if (receipt.inputImage.fingerprint !== expectedInput.sha256 || receipt.inputImage.decodedWidth !== expectedInput.decodedWidth || receipt.inputImage.decodedHeight !== expectedInput.decodedHeight || receipt.inputImage.orientation !== expectedInput.orientation || receipt.inputImage.mimeType !== expectedInput.mimeType) return failure("basis_mismatch", "Receipt input image does not match its manifest role.", "$.inputImage");
  const [original, empty] = await Promise.all([verifyImage(canonicalManifestRoot, manifest.original, "original"), verifyImage(canonicalManifestRoot, manifest.emptyRoomAssist, "empty")]);
  if ("status" in original) return original;
  if ("status" in empty) return empty;
  const r3b = parseGeminiFloorProposalResponse(modelText, {
    sharedComparisonContext: manifest.sharedComparisonContext,
    coordinateExtentPolicy: GEMINI_FLOOR_COORDINATE_EXTENT_POLICY,
    auditProvenance: { requestId: receipt.requestId, contractVersion: "AFC-R3B/v1", promptVersion: receipt.prompt.version, providerId: receipt.provider.providerId, modelId: receipt.provider.modelId, responseReceivedAt: receipt.createdAt, rawResponseSha256: receipt.provider.modelOutputTextSha256 },
  });
  if (r3b.status === "contract_failure") return failure(r3b.reason === "r3_basis_binding_mismatch" ? "basis_mismatch" : "invalid", `${r3b.reason}: ${r3b.detail}`, r3b.path);
  if (r3b.status === "insufficient_evidence") return failure("invalid", `AFC-R3B insufficient evidence: ${r3b.reasonCode}`, "$.status");
  const r3bIds = r3b.candidates.map((candidate) => candidate.candidateId);
  const r3cIds = r3bIds.map((candidateId) => `afc-r3c:${receipt.imageRole === "empty_room_boundary_specialist" ? "empty" : "original"}:${candidateId}`);
  if (JSON.stringify(r3bIds) !== JSON.stringify(receipt.afcR3b.candidateIds) || JSON.stringify(r3cIds) !== JSON.stringify(receipt.afcR3c.candidateIds) || r3b.candidates.length !== 1) return failure("invalid", "Receipt candidate identities do not match strict AFC replay.", "$.afcR3c.candidateIds");
  const candidate = r3b.candidates[0];
  const review = r3b.reviewEvidenceByCandidateId[candidate.candidateId];
  const points = candidate.sourceFloorPolygon;
  const warnings = [
    "AFC-R2 selection state is not_run. This evidence is read-only and non-authoritative.",
    ...deriveAfcProposalOperatorWarnings({
      corners: {
        NL: { x: points[0].x, y: points[0].y, support: review.corners.NL },
        NR: { x: points[1].x, y: points[1].y, support: review.corners.NR },
        FR: { x: points[2].x, y: points[2].y, support: review.corners.FR },
        FL: { x: points[3].x, y: points[3].y, support: review.corners.FL },
      },
      near: review.edges.near,
    }),
  ];
  const viewModel: AfcProposalOverlayViewModel = {
    artifactIdentity: { receiptFileName: options.receiptFileName, receiptSha256: sha256(receiptBytes), requestId: receipt.requestId, createdAt: receipt.createdAt, roomId: receipt.roomId, studyMode: receipt.studyMode, imageRole: receipt.imageRole },
    imageBasis: { basisBinding: typeof (rawModel as Record<string, unknown>).basis_binding === "string" ? (rawModel as Record<string, string>).basis_binding : "", manifestVersion: manifest.contractVersion, original: { sha256: original.sha256, width: original.width, height: original.height, mimeType: original.mimeType }, emptyRoom: { sha256: empty.sha256, width: empty.width, height: empty.height, mimeType: empty.mimeType, generatedFromOriginalSha256: manifest.emptyRoomAssist.generatedFromOriginalSha256 } },
    pairCompatibility: receipt.compatibility,
    candidate: { r3bCandidateId: candidate.candidateId, r3cCandidateId: r3cIds[0], coordinateSpace: "source-normalized/v1", semanticOrder: ["NL", "NR", "FR", "FL"] },
    corners: { NL: { x: points[0].x, y: points[0].y, support: review.corners.NL }, NR: { x: points[1].x, y: points[1].y, support: review.corners.NR }, FR: { x: points[2].x, y: points[2].y, support: review.corners.FR }, FL: { x: points[3].x, y: points[3].y, support: review.corners.FL } },
    edges: { near: review.edges.near, right: review.edges.right, far: review.edges.far, left: review.edges.left },
    warnings,
    provenance: { prompt: receipt.prompt, provider: { providerId: receipt.provider.providerId, modelId: receipt.provider.modelId, modelVersion: receipt.provider.providerModelVersion, finishReason: receipt.provider.finishReason, extractionPolicyVersion: receipt.provider.extractionPolicyVersion, usageMetadata: receipt.provider.usageMetadata }, afcR3b: { status: r3b.status, candidateIds: r3bIds }, afcR3c: { status: receipt.afcR3c.compositionStatus, candidateIds: r3cIds }, afcR2: receipt.afcR2, artifactHashes: { providerEnvelopeSha256: receipt.provider.providerEnvelopeSha256, modelOutputSha256: receipt.provider.modelOutputTextSha256, receiptSha256: sha256(receiptBytes) } },
    safety: { researchOnly: true, applied: false, authoritative: false, persisted: false, activeCameraUnchanged: true },
    raw: {
      receipt: json({
        ...(rawReceipt as Record<string, unknown>),
        capture: {
          providerEnvelopePath: envelopeName,
          modelOutputPath: modelName,
        },
      }),
      modelOutput: json(rawModel),
    },
  };
  return deepFreeze({ status: "valid", viewModel: deepFreeze(viewModel), images: deepFreeze({ original, empty }) });
}

function compareInventoryText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareAfcProposalReceiptCanonical(
  left: AfcProposalReceiptSummary,
  right: AfcProposalReceiptSummary
): number {
  return Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    compareInventoryText(left.roomId, right.roomId) ||
    compareInventoryText(left.studyMode, right.studyMode) ||
    compareInventoryText(left.receiptSha256, right.receiptSha256);
}

export async function discoverAfcProposalReceipts(options: Pick<AfcProposalOverlayReplayOptions, "captureRoot"> = {}): Promise<AfcProposalReceiptInventory> {
  const captureRoot = await canonicalDirectory(options.captureRoot ?? path.join(process.cwd(), AFC_UI1_CAPTURE_ROOT_RELATIVE));
  if (!captureRoot) return deepFreeze({ receipts: [], invalidCandidateCount: 0 });
  let names: string[];
  try { names = await readdir(captureRoot); } catch { return deepFreeze({ receipts: [], invalidCandidateCount: 0 }); }
  const summaries: AfcProposalReceiptSummary[] = [];
  let invalidCandidateCount = 0;
  for (const name of names.filter(isReceiptFilename).sort(compareInventoryText)) {
    const bytes = await safeRead(captureRoot, name);
    if (!bytes) continue;
    try {
      const parsed = parseReceipt(JSON.parse(bytes.toString("utf8")));
      if ("status" in parsed) {
        invalidCandidateCount += 1;
        continue;
      }
      summaries.push(deepFreeze({
        receiptFileName: name,
        receiptSha256: sha256(bytes),
        createdAt: parsed.createdAt,
        roomId: parsed.roomId,
        studyMode: parsed.studyMode,
        imageRole: parsed.imageRole,
        requestId: parsed.requestId,
        r3cCandidateId: parsed.afcR3c.candidateIds[0],
        candidateCount: parsed.afcR3c.candidateIds.length,
      }));
    } catch {
      invalidCandidateCount += 1;
    }
  }
  summaries.sort(compareAfcProposalReceiptCanonical);
  return deepFreeze({ receipts: summaries, invalidCandidateCount });
}
