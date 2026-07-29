import type { AfcUi2aSupportedMime } from "./afc-ui2a-original-preparation-contract";

export const AFC_UI2A_EMPTY_RESOLUTION_REQUEST_VERSION = "afc-ui2a-empty-resolution-request/v1" as const;

export type AfcUi2aPackageFailureCode =
  | "invalid_request"
  | "capture_not_authorized"
  | "original_preparation_not_found"
  | "original_receipt_hash_mismatch"
  | "original_receipt_invalid"
  | "original_image_missing"
  | "original_image_mismatch"
  | "fixed_inputs_root_unavailable"
  | "fixed_inputs_root_disallowed"
  | "durable_empty_not_found"
  | "durable_empty_invalid"
  | "conflicting_empty_evidence"
  | "empty_lineage_mismatch"
  | "empty_generation_disabled"
  | "empty_generation_not_authorized"
  | "empty_generation_required"
  | "empty_generation_in_progress"
  | "empty_generation_request_reused"
  | "empty_generation_failed"
  | "empty_capture_failed"
  | "pair_incompatible"
  | "unexpected_failure";

export type AfcUi2aVerifiedImageMetadata = Readonly<{
  fileName: string;
  sha256: string;
  byteCount: number;
  mimeType: AfcUi2aSupportedMime;
  decodedWidth: number;
  decodedHeight: number;
  orientation: 1;
}>;

export type AfcUi2aVerifiedGenerationProvenance = Readonly<{
  generatedFromOriginalSha256: string;
  generatorId: string;
  requestedModelId: "NBP";
  resolvedModelId: null;
  resolvedModelStatus: "not_reported_by_compositor";
}>;

export type AfcUi2aOriginalPreparationSelector = Readonly<{
  preparationId: string;
  receiptFileName: string;
  receiptSha256: string;
}>;

export type AfcUi2aEmptyResolutionRequest = Readonly<{
  contractVersion: typeof AFC_UI2A_EMPTY_RESOLUTION_REQUEST_VERSION;
  roomLabel: string;
  originalPreparation: AfcUi2aOriginalPreparationSelector;
  currentExpectedFingerprint?: string;
  executeCapture: unknown;
  executeEmptyRoomGeneration?: unknown;
}>;

export type AfcUi2aEmptyResolutionSource = "disk_reused" | "cache_hit" | "generated";

export type AfcUi2aEmptyResolutionSuccess = Readonly<{
  status: "empty_resolved";
  roomId: string;
  originalPreparationId: string;
  resolutionSource: AfcUi2aEmptyResolutionSource;
  original: AfcUi2aVerifiedImageMetadata;
  emptyRoomAssist: AfcUi2aVerifiedImageMetadata & AfcUi2aVerifiedGenerationProvenance;
  emptyRoomGenerationCall: boolean;
  safety: Readonly<{
    geminiFloorProposalCall: false;
    afcR2Run: false;
    floorStateUnchanged: true;
    supportStateUnchanged: true;
    activeCameraUnchanged: true;
    sceneStateUnchanged: true;
    productionTokenAccountingUsed: false;
  }>;
}>;

export type AfcUi2aEmptyGenerationRequired = Readonly<{
  status: "empty_generation_required";
  roomId: string;
  originalPreparationId: string;
  requestedModelId: "NBP";
  expectedCompositorCallCount: 1;
  emptyRoomGenerationCall: false;
}>;

export type AfcUi2aEmptyResolutionFailure = Readonly<{
  status: "failure";
  failureCode: AfcUi2aPackageFailureCode;
  message: string;
  emptyRoomGenerationCall: boolean;
}>;

export type AfcUi2aEmptyResolutionResult =
  | AfcUi2aEmptyResolutionSuccess
  | AfcUi2aEmptyGenerationRequired
  | AfcUi2aEmptyResolutionFailure;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function safeBasename(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && !value.includes("\0") && value === value.split(/[\\/]/).pop();
}
function preparationId(value: unknown): value is string {
  return typeof value === "string" && /^afc-ui2a-original:[a-z][a-z0-9-]{0,63}:[a-f0-9]{64}$/.test(value);
}

/** Closed wire parser. Side-effect acknowledgements deliberately remain unknown. */
export function parseAfcUi2aEmptyResolutionRequest(value: unknown):
  | Readonly<{ ok: true; request: AfcUi2aEmptyResolutionRequest }>
  | Readonly<{ ok: false; code: "invalid_request" }> {
  if (!record(value)) return { ok: false, code: "invalid_request" };
  const allowed = ["contractVersion", "roomLabel", "originalPreparation", "currentExpectedFingerprint", "executeCapture", "executeEmptyRoomGeneration"];
  const required = ["contractVersion", "roomLabel", "originalPreparation", "executeCapture"];
  if (!Object.keys(value).every((key) => allowed.includes(key)) || !required.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    return { ok: false, code: "invalid_request" };
  }
  if (value.contractVersion !== AFC_UI2A_EMPTY_RESOLUTION_REQUEST_VERSION || typeof value.roomLabel !== "string" || !record(value.originalPreparation)) {
    return { ok: false, code: "invalid_request" };
  }
  if (!exactKeys(value.originalPreparation, ["preparationId", "receiptFileName", "receiptSha256"]) ||
    !preparationId(value.originalPreparation.preparationId) ||
    !safeBasename(value.originalPreparation.receiptFileName) ||
    !hash(value.originalPreparation.receiptSha256) ||
    ("currentExpectedFingerprint" in value && !hash(value.currentExpectedFingerprint))) {
    return { ok: false, code: "invalid_request" };
  }
  return { ok: true, request: value as AfcUi2aEmptyResolutionRequest };
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
