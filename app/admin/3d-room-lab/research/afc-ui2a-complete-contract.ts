import { normalizeAfcUi2aRoomLabel } from "./afc-ui2a-original-preparation-contract";

export const AFC_UI2A_COMPLETE_REQUEST_VERSION = "afc-ui2a-complete-request/v1" as const;

export type AfcUi2aCompleteRequest = Readonly<{
  contractVersion: typeof AFC_UI2A_COMPLETE_REQUEST_VERSION;
  roomLabel: string;
  originalPreparation: Readonly<{ preparationId: string; receiptFileName: string; receiptSha256: string }>;
  currentExpectedFingerprint?: string;
  executeCapture?: unknown;
  executeEmptyRoomGeneration?: unknown;
}>;

export type AfcUi2aCompleteFailureCode =
  | "invalid_input" | "capture_not_authorized" | "original_evidence_invalid" | "original_image_mismatch"
  | "empty_generation_disabled" | "empty_generation_in_progress" | "empty_generation_failed"
  | "empty_evidence_invalid" | "empty_image_mismatch" | "empty_lineage_mismatch"
  | "conflicting_empty_evidence" | "pair_incompatible" | "shared_context_invalid"
  | "manifest_conflict" | "manifest_capture_failed" | "manifest_validation_failed"
  | "package_receipt_capture_failed" | "package_receipt_validation_failed" | "package_replay_failed"
  | "unexpected_failure";

type Image = Readonly<{
  fileName: string; sha256: string; byteCount: number; mimeType: string;
  decodedWidth: number; decodedHeight: number; orientation: 1;
}>;
type EmptyImage = Image & Readonly<{
  generatedFromOriginalSha256: string; generatorId: string; requestedModelId: "NBP";
  resolvedModelStatus: "not_reported_by_compositor";
}>;
type Compatibility = Readonly<{
  version: "afc-r3c-image-pair-compatibility/v1"; tier: "exact_grid_compatible" | "aspect_compatible_rescaled";
  relativeAspectErrorRaw: number; relativeAspectError: number;
}>;
type PackageSafety = Readonly<{
  authoritative: false; applied: false; persistedToScene: false; activeCameraUnchanged: true;
  floorStateUnchanged: true; supportStateUnchanged: true; databaseWrites: false;
  productionAssetWrites: false; productionTokenAccountingUsed: false; emptyRoomGenerationCall: false;
  geminiFloorProposalCall: false; afcR2Run: false; localResearchPackageWritten: true;
}>;

export type AfcUi2aPublicPreparedPackage = Readonly<{
  packageId: string;
  original: Image;
  emptyRoomAssist: EmptyImage;
  compatibility: Compatibility;
  sharedContextDigest: string;
  manifest: Readonly<{ fileName: string; sha256: string; contractVersion: "afc-r3c-image-manifest/v1"; disposition: "written" | "byte_identical" | "semantically_adopted" }>;
  receipt: Readonly<{ fileName: string; sha256: string; reused: boolean }>;
  safety: PackageSafety;
}>;

export type AfcUi2aCompleteResult =
  | Readonly<{
    status: "package_completed"; roomId: string; originalPreparationId: string;
    emptyResolutionSource: "disk_reused" | "cache_hit" | "generated"; emptyRoomGenerationCall: boolean;
    package: AfcUi2aPublicPreparedPackage;
    attemptSafety: Readonly<{
      authoritative: false; applied: false; persistedToScene: false; activeCameraUnchanged: true;
      floorStateUnchanged: true; supportStateUnchanged: true; databaseWrites: false;
      productionAssetWrites: false; productionTokenAccountingUsed: false; emptyRoomGenerationCall: boolean;
      geminiFloorProposalCall: false; afcR2Run: false; packageReplayVerified: true;
    }>;
  }>
  | Readonly<{
    status: "empty_generation_required"; roomId: string; originalPreparationId: string;
    requestedModelId: "NBP"; expectedCompositorCallCount: 1; emptyRoomGenerationCall: false;
  }>
  | Readonly<{ status: "failure"; failureCode: AfcUi2aCompleteFailureCode; message: string; emptyRoomGenerationCall: boolean }>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function hash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function basename(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && !value.includes("\0") && value === value.split(/[\\/]/).pop();
}
function preparationId(value: unknown): value is string {
  return typeof value === "string" && /^afc-ui2a-original:[a-z][a-z0-9-]{0,63}:[a-f0-9]{64}$/.test(value);
}

/** Closed browser contract: only a preparation selector and primitive acknowledgements cross the boundary. */
export function parseAfcUi2aCompleteRequest(value: unknown):
  | Readonly<{ ok: true; request: AfcUi2aCompleteRequest }>
  | Readonly<{ ok: false }> {
  if (!record(value)) return { ok: false };
  const allowed = ["contractVersion", "roomLabel", "originalPreparation", "currentExpectedFingerprint", "executeCapture", "executeEmptyRoomGeneration"];
  const required = ["contractVersion", "roomLabel", "originalPreparation"];
  if (!Object.keys(value).every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(value, key)) ||
    value.contractVersion !== AFC_UI2A_COMPLETE_REQUEST_VERSION || typeof value.roomLabel !== "string" ||
    !normalizeAfcUi2aRoomLabel(value.roomLabel) || !record(value.originalPreparation) ||
    !exactKeys(value.originalPreparation, ["preparationId", "receiptFileName", "receiptSha256"]) ||
    !preparationId(value.originalPreparation.preparationId) || !basename(value.originalPreparation.receiptFileName) ||
    !hash(value.originalPreparation.receiptSha256) ||
    (Object.hasOwn(value, "currentExpectedFingerprint") && !hash(value.currentExpectedFingerprint))) return { ok: false };
  return { ok: true, request: deepFreeze({
    contractVersion: AFC_UI2A_COMPLETE_REQUEST_VERSION,
    roomLabel: value.roomLabel,
    originalPreparation: {
      preparationId: value.originalPreparation.preparationId,
      receiptFileName: value.originalPreparation.receiptFileName,
      receiptSha256: value.originalPreparation.receiptSha256,
    },
    ...(Object.hasOwn(value, "currentExpectedFingerprint") ? { currentExpectedFingerprint: value.currentExpectedFingerprint as string } : {}),
    ...(Object.hasOwn(value, "executeCapture") ? { executeCapture: value.executeCapture } : {}),
    ...(Object.hasOwn(value, "executeEmptyRoomGeneration") ? { executeEmptyRoomGeneration: value.executeEmptyRoomGeneration } : {}),
  }) };
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child, seen);
    Object.freeze(object);
  }
  return value;
}
