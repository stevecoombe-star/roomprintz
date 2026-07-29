import "server-only";

import { createHash } from "node:crypto";

import {
  validateSharedCandidateComparisonContext,
  type ValidSharedCandidateComparisonContext,
} from "./gemini-floor-proposal-manifest";
import { originalPreparationId, type AfcUi2aSupportedMime } from "./afc-ui2a-original-preparation-contract";
import { digestAfcUi2aSharedContext } from "./afc-ui2a-shared-context";

export const AFC_UI2A_PREPARED_INPUT_RECEIPT_VERSION = "afc-ui2a-prepared-input-receipt/v1" as const;
export const AFC_UI2A_PREPARED_PACKAGE_STAGE = "pair_manifest_prepared" as const;
export const AFC_UI2A_PACKAGE_IDENTITY_VERSION = "afc-ui2a-package-identity/v1" as const;
export const AFC_UI2A_COMPATIBILITY_VERSION = "afc-r3c-image-pair-compatibility/v1" as const;
export const AFC_R3C_MANIFEST_FILENAME_VERSION = "afc-r3c-image-manifest/v1" as const;

type ExactCompatibility = Readonly<{
  version: typeof AFC_UI2A_COMPATIBILITY_VERSION;
  tier: "exact_grid_compatible";
  relativeAspectErrorRaw: number;
  relativeAspectError: number;
}>;

type ReceiptImage = Readonly<{
  fileName: string;
  sha256: string;
  byteCount: number;
  mimeType: AfcUi2aSupportedMime;
  decodedWidth: number;
  decodedHeight: number;
  orientation: 1;
}>;

export type AfcUi2aPreparedInputReceiptV1 = Readonly<{
  receiptContractVersion: typeof AFC_UI2A_PREPARED_INPUT_RECEIPT_VERSION;
  preparationStage: typeof AFC_UI2A_PREPARED_PACKAGE_STAGE;
  packageId: string;
  roomId: string;
  originalPreparation: Readonly<{ preparationId: string; receiptFileName: string; receiptSha256: string }>;
  original: ReceiptImage;
  emptyRoomAssist: ReceiptImage & Readonly<{
    generatedFromOriginalSha256: string;
    generatorId: string;
    requestedModelId: "NBP";
    resolvedModelStatus: "not_reported_by_compositor";
  }>;
  compatibility: ExactCompatibility;
  sharedComparisonContext: ValidSharedCandidateComparisonContext;
  sharedContextDigest: string;
  manifest: Readonly<{ fileName: string; sha256: string; contractVersion: typeof AFC_R3C_MANIFEST_FILENAME_VERSION }>;
  safety: Readonly<{
    authoritative: false;
    applied: false;
    persistedToScene: false;
    activeCameraUnchanged: true;
    floorStateUnchanged: true;
    supportStateUnchanged: true;
    databaseWrites: false;
    productionAssetWrites: false;
    productionTokenAccountingUsed: false;
    emptyRoomGenerationCall: false;
    geminiFloorProposalCall: false;
    afcR2Run: false;
    localResearchPackageWritten: true;
  }>;
}>;

export type AfcUi2aPackageIdentity = Readonly<{
  packageDigest: string;
  packageId: string;
  receiptFileName: string;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}
function roomId(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value); }
function sha(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function basename(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 &&
    !value.includes("\0") && value === value.split(/[\\/]/).pop();
}
function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function mime(value: unknown): value is AfcUi2aSupportedMime {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}
function extensionMatches(fileName: string, mimeType: AfcUi2aSupportedMime): boolean {
  return mimeType === "image/jpeg" ? /\.(jpg|jpeg)$/.test(fileName) :
    mimeType === "image/png" ? /\.png$/.test(fileName) : /\.webp$/.test(fileName);
}
function imageFields(value: Record<string, unknown>): boolean {
  return basename(value.fileName) && sha(value.sha256) && positiveInteger(value.byteCount) && mime(value.mimeType) &&
    extensionMatches(value.fileName, value.mimeType) && positiveInteger(value.decodedWidth) &&
    positiveInteger(value.decodedHeight) && value.orientation === 1;
}
function image(value: unknown): value is ReceiptImage {
  return record(value) && exactKeys(value, ["fileName", "sha256", "byteCount", "mimeType", "decodedWidth", "decodedHeight", "orientation"]) &&
    imageFields(value);
}
function emptyImage(value: unknown): value is AfcUi2aPreparedInputReceiptV1["emptyRoomAssist"] {
  const candidate = value as Record<string, unknown>;
  return record(value) && exactKeys(candidate, [
    "fileName", "sha256", "byteCount", "mimeType", "decodedWidth", "decodedHeight", "orientation",
    "generatedFromOriginalSha256", "generatorId", "requestedModelId", "resolvedModelStatus",
  ]) && imageFields(candidate) && sha(candidate.generatedFromOriginalSha256) && typeof candidate.generatorId === "string" &&
    candidate.generatorId.length > 0 && candidate.requestedModelId === "NBP" &&
    candidate.resolvedModelStatus === "not_reported_by_compositor";
}
function originalPreparation(value: unknown): value is AfcUi2aPreparedInputReceiptV1["originalPreparation"] {
  return record(value) && exactKeys(value, ["preparationId", "receiptFileName", "receiptSha256"]) &&
    typeof value.preparationId === "string" && basename(value.receiptFileName) && sha(value.receiptSha256);
}
function finite(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function zero(value: number): number { return Object.is(value, -0) ? 0 : value; }

export function afcUi2aManifestFilename(room: string): string {
  return `afc-r3c-${room}.image-manifest.v1.json`;
}

export function buildAfcUi2aPackageIdentity(input: {
  roomId: string;
  originalSha256: string;
  emptySha256: string;
  manifestSha256: string;
  sharedContextDigest: string;
  compatibility: Pick<ExactCompatibility, "version" | "tier" | "relativeAspectErrorRaw">;
}): AfcUi2aPackageIdentity | null {
  if (!roomId(input.roomId) || !sha(input.originalSha256) || !sha(input.emptySha256) ||
    !sha(input.manifestSha256) || !sha(input.sharedContextDigest) ||
    input.compatibility.version !== AFC_UI2A_COMPATIBILITY_VERSION ||
    input.compatibility.tier !== "exact_grid_compatible" || !finite(input.compatibility.relativeAspectErrorRaw)) return null;
  const payload = {
    contractVersion: AFC_UI2A_PACKAGE_IDENTITY_VERSION,
    roomId: input.roomId,
    originalSha256: input.originalSha256,
    emptySha256: input.emptySha256,
    manifestSha256: input.manifestSha256,
    sharedContextDigest: input.sharedContextDigest,
    compatibility: {
      version: AFC_UI2A_COMPATIBILITY_VERSION,
      tier: "exact_grid_compatible" as const,
      relativeAspectErrorRaw: zero(input.compatibility.relativeAspectErrorRaw),
    },
  };
  const packageDigest = createHash("sha256").update(Buffer.from(JSON.stringify(payload), "utf8")).digest("hex");
  return deepFreeze({
    packageDigest,
    packageId: `afc-ui2a-package:${input.roomId}:${packageDigest}`,
    receiptFileName: `afc-ui2a-prepared-input.${input.roomId}.${packageDigest}.receipt.json`,
  });
}

function expectedSafety(): AfcUi2aPreparedInputReceiptV1["safety"] {
  return {
    authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true,
    floorStateUnchanged: true, supportStateUnchanged: true, databaseWrites: false,
    productionAssetWrites: false, productionTokenAccountingUsed: false, emptyRoomGenerationCall: false,
    geminiFloorProposalCall: false, afcR2Run: false, localResearchPackageWritten: true,
  };
}

/** Closed parser for package authority. It rejects timestamp and attempt-specific fields by construction. */
export function parseAfcUi2aPreparedInputReceipt(value: unknown):
  | Readonly<{ ok: true; receipt: AfcUi2aPreparedInputReceiptV1 }>
  | Readonly<{ ok: false; path: string }> {
  const invalid = (path: string) => Object.freeze({ ok: false as const, path });
  if (!record(value) || !exactKeys(value, [
    "receiptContractVersion", "preparationStage", "packageId", "roomId", "originalPreparation",
    "original", "emptyRoomAssist", "compatibility", "sharedComparisonContext", "sharedContextDigest",
    "manifest", "safety",
  ])) return invalid("$");
  if (value.receiptContractVersion !== AFC_UI2A_PREPARED_INPUT_RECEIPT_VERSION ||
    value.preparationStage !== AFC_UI2A_PREPARED_PACKAGE_STAGE || !roomId(value.roomId) ||
    typeof value.packageId !== "string" || !originalPreparation(value.originalPreparation) || !image(value.original) ||
    !record(value.emptyRoomAssist) || !record(value.compatibility) || !sha(value.sharedContextDigest) ||
    !record(value.manifest) || !record(value.safety)) return invalid("$.identity");
  if (value.originalPreparation.preparationId !== originalPreparationId(value.roomId, value.original.sha256)) return invalid("$.originalPreparation");
  const empty = value.emptyRoomAssist;
  if (!emptyImage(empty) || empty.generatedFromOriginalSha256 !== value.original.sha256) return invalid("$.emptyRoomAssist");
  if (empty.decodedWidth !== value.original.decodedWidth || empty.decodedHeight !== value.original.decodedHeight) return invalid("$.emptyRoomAssist");
  const compatibility = value.compatibility;
  if (!exactKeys(compatibility, ["version", "tier", "relativeAspectErrorRaw", "relativeAspectError"]) ||
    compatibility.version !== AFC_UI2A_COMPATIBILITY_VERSION || compatibility.tier !== "exact_grid_compatible" ||
    !finite(compatibility.relativeAspectErrorRaw) || !finite(compatibility.relativeAspectError) ||
    zero(compatibility.relativeAspectErrorRaw) !== zero(compatibility.relativeAspectError)) return invalid("$.compatibility");
  const context = validateSharedCandidateComparisonContext(value.sharedComparisonContext);
  if (!context.ok || context.value.basisFingerprint !== value.original.sha256 ||
    context.value.decodedWidth !== value.original.decodedWidth || context.value.decodedHeight !== value.original.decodedHeight ||
    digestAfcUi2aSharedContext(context.value) !== value.sharedContextDigest) return invalid("$.sharedComparisonContext");
  const manifest = value.manifest;
  if (!exactKeys(manifest, ["fileName", "sha256", "contractVersion"]) ||
    manifest.fileName !== afcUi2aManifestFilename(value.roomId) || !sha(manifest.sha256) ||
    manifest.contractVersion !== AFC_R3C_MANIFEST_FILENAME_VERSION) return invalid("$.manifest");
  const safety = expectedSafety();
  const suppliedSafety = value.safety as Record<string, unknown>;
  if (!exactKeys(suppliedSafety, Object.keys(safety)) ||
    Object.entries(safety).some(([key, expected]) => suppliedSafety[key] !== expected)) return invalid("$.safety");
  const identity = buildAfcUi2aPackageIdentity({
    roomId: value.roomId,
    originalSha256: value.original.sha256,
    emptySha256: empty.sha256,
    manifestSha256: manifest.sha256,
    sharedContextDigest: value.sharedContextDigest,
    compatibility: {
      version: compatibility.version,
      tier: compatibility.tier,
      relativeAspectErrorRaw: compatibility.relativeAspectErrorRaw,
    },
  });
  if (!identity || identity.packageId !== value.packageId) return invalid("$.packageId");
  return Object.freeze({
    ok: true as const,
    receipt: deepFreeze({
      receiptContractVersion: AFC_UI2A_PREPARED_INPUT_RECEIPT_VERSION,
      preparationStage: AFC_UI2A_PREPARED_PACKAGE_STAGE,
      packageId: value.packageId,
      roomId: value.roomId,
      originalPreparation: {
        preparationId: value.originalPreparation.preparationId,
        receiptFileName: value.originalPreparation.receiptFileName,
        receiptSha256: value.originalPreparation.receiptSha256,
      },
      original: {
        fileName: value.original.fileName, sha256: value.original.sha256, byteCount: value.original.byteCount,
        mimeType: value.original.mimeType, decodedWidth: value.original.decodedWidth,
        decodedHeight: value.original.decodedHeight, orientation: 1 as const,
      },
      emptyRoomAssist: { ...empty },
      compatibility: {
        version: AFC_UI2A_COMPATIBILITY_VERSION,
        tier: "exact_grid_compatible" as const,
        relativeAspectErrorRaw: zero(compatibility.relativeAspectErrorRaw),
        relativeAspectError: zero(compatibility.relativeAspectError),
      },
      sharedComparisonContext: context.value,
      sharedContextDigest: value.sharedContextDigest,
      manifest: { fileName: manifest.fileName, sha256: manifest.sha256, contractVersion: AFC_R3C_MANIFEST_FILENAME_VERSION },
      safety,
    }),
  });
}

export function stableAfcUi2aPreparedInputReceiptBytes(receipt: AfcUi2aPreparedInputReceiptV1): Buffer {
  return Buffer.from(JSON.stringify(receipt, null, 2), "utf8");
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (ArrayBuffer.isView(object)) return value;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
    Object.freeze(object);
  }
  return value;
}
