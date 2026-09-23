export const AFC_UI2A_PREPARE_ORIGINAL_REQUEST_VERSION = "afc-ui2a-prepare-original-request/v1" as const;
export const AFC_UI2A_CURRENT_IMAGE_VERSION = "afc-ui2a-current-image/v1" as const;
export const AFC_UI2A_ORIGINAL_PREPARATION_RECEIPT_VERSION = "afc-ui2a-original-preparation-receipt/v1" as const;

export type AfcUi2aSupportedMime = "image/jpeg" | "image/png" | "image/webp";
export type AfcUi2aFailureCode =
  | "feature_disabled" | "invalid_request" | "capture_not_authorized" | "image_url_invalid"
  | "image_fetch_failed" | "image_mime_unsupported" | "image_byte_limit_exceeded"
  | "image_decode_failed" | "image_fingerprint_mismatch" | "image_dimension_mismatch"
  | "image_orientation_invalid" | "room_label_invalid" | "fixed_inputs_root_unavailable"
  | "fixed_inputs_root_disallowed" | "room_directory_invalid" | "room_directory_symlink_escape"
  | "image_capture_failed" | "receipt_capture_failed" | "receipt_validation_failed" | "unexpected_failure";

export type AfcUi2aPrepareOriginalRequestV1 = Readonly<{
  contractVersion: typeof AFC_UI2A_PREPARE_ORIGINAL_REQUEST_VERSION;
  currentImage: Readonly<{
    contractVersion: typeof AFC_UI2A_CURRENT_IMAGE_VERSION;
    imageUrl: string;
    expectedFingerprint: string;
    expectedWidth: number;
    expectedHeight: number;
  }>;
  roomLabel: string;
  executeCapture: unknown;
}>;

export type AfcUi2aOriginalPreparationReceiptV1 = Readonly<{
  receiptContractVersion: typeof AFC_UI2A_ORIGINAL_PREPARATION_RECEIPT_VERSION;
  preparationStage: "original_captured";
  preparationId: string;
  roomId: string;
  source: Readonly<{
    sanitizedImageUrl: string;
    expectedQualifiedFingerprint: string;
    expectedDecodedWidth: number;
    expectedDecodedHeight: number;
  }>;
  original: Readonly<{
    fileName: string;
    sha256: string;
    byteCount: number;
    mimeType: AfcUi2aSupportedMime;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
  }>;
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
    localResearchCaptureWritten: true;
  }>;
}>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function supportedMime(value: unknown): value is AfcUi2aSupportedMime {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}
function safeRoomId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/.test(value);
}
function safeBasename(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255 && !value.includes("\0") && value === value.split(/[\\/]/).pop();
}

export function normalizeAfcUi2aRoomLabel(value: unknown): string | null {
  if (typeof value !== "string" || value.includes("\0") || value.includes("/") || value.includes("\\") || value.includes("..")) return null;
  const normalized = value.trim().toLowerCase().replace(/[ _]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  return safeRoomId(normalized) ? normalized : null;
}

export function sanitizeAfcUi2aSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function originalFilename(roomId: string, sha256: string, mimeType: AfcUi2aSupportedMime): string {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
  return `${roomId}.original.${sha256}.${extension}`;
}
export function originalPreparationId(roomId: string, sha256: string): string {
  return `afc-ui2a-original:${roomId}:${sha256}`;
}
export function originalPreparationReceiptFilename(roomId: string, sha256: string): string {
  return `afc-ui2a-original-preparation.${roomId}.${sha256}.receipt.json`;
}

/** Closed wire parser; executeCapture intentionally remains unknown for the runtime side-effect gate. */
export function parseAfcUi2aPrepareOriginalRequest(value: unknown):
  | { ok: true; request: AfcUi2aPrepareOriginalRequestV1 }
  | { ok: false; code: "invalid_request" } {
  if (!record(value) || !exactKeys(value, ["contractVersion", "currentImage", "roomLabel", "executeCapture"])) return { ok: false, code: "invalid_request" };
  if (value.contractVersion !== AFC_UI2A_PREPARE_ORIGINAL_REQUEST_VERSION || typeof value.roomLabel !== "string" || !record(value.currentImage)) return { ok: false, code: "invalid_request" };
  const image = value.currentImage;
  if (!exactKeys(image, ["contractVersion", "imageUrl", "expectedFingerprint", "expectedWidth", "expectedHeight"]) ||
    image.contractVersion !== AFC_UI2A_CURRENT_IMAGE_VERSION || typeof image.imageUrl !== "string" ||
    !hash(image.expectedFingerprint) || !integer(image.expectedWidth) || !integer(image.expectedHeight) ||
    !normalizeAfcUi2aRoomLabel(value.roomLabel)) return { ok: false, code: "invalid_request" };
  return { ok: true, request: value as AfcUi2aPrepareOriginalRequestV1 };
}

export function parseAfcUi2aOriginalPreparationReceipt(value: unknown):
  | { ok: true; receipt: AfcUi2aOriginalPreparationReceiptV1 }
  | { ok: false; path: string } {
  if (!record(value) || !exactKeys(value, ["receiptContractVersion", "preparationStage", "preparationId", "roomId", "source", "original", "safety"])) return { ok: false, path: "$" };
  if (value.receiptContractVersion !== AFC_UI2A_ORIGINAL_PREPARATION_RECEIPT_VERSION || value.preparationStage !== "original_captured" || !safeRoomId(value.roomId) || !record(value.source) || !record(value.original) || !record(value.safety)) return { ok: false, path: "$.identity" };
  const source = value.source;
  const original = value.original;
  const safety = value.safety;
  if (!exactKeys(source, ["sanitizedImageUrl", "expectedQualifiedFingerprint", "expectedDecodedWidth", "expectedDecodedHeight"]) ||
    typeof source.sanitizedImageUrl !== "string" || sanitizeAfcUi2aSourceUrl(source.sanitizedImageUrl) !== source.sanitizedImageUrl ||
    !hash(source.expectedQualifiedFingerprint) || !integer(source.expectedDecodedWidth) || !integer(source.expectedDecodedHeight)) return { ok: false, path: "$.source" };
  if (!exactKeys(original, ["fileName", "sha256", "byteCount", "mimeType", "decodedWidth", "decodedHeight", "orientation"]) ||
    !safeBasename(original.fileName) || !hash(original.sha256) || !integer(original.byteCount) || !supportedMime(original.mimeType) ||
    !integer(original.decodedWidth) || !integer(original.decodedHeight) || original.orientation !== 1) return { ok: false, path: "$.original" };
  if (original.fileName !== originalFilename(value.roomId, original.sha256, original.mimeType)) return { ok: false, path: "$.original.fileName" };
  if (value.preparationId !== originalPreparationId(value.roomId, original.sha256)) return { ok: false, path: "$.preparationId" };
  const expectedSafety = {
    authoritative: false, applied: false, persistedToScene: false, activeCameraUnchanged: true, floorStateUnchanged: true,
    supportStateUnchanged: true, databaseWrites: false, productionAssetWrites: false, productionTokenAccountingUsed: false,
    emptyRoomGenerationCall: false, geminiFloorProposalCall: false, localResearchCaptureWritten: true,
  };
  if (!exactKeys(safety, Object.keys(expectedSafety)) || Object.entries(expectedSafety).some(([key, expected]) => safety[key] !== expected)) return { ok: false, path: "$.safety" };
  return { ok: true, receipt: value as AfcUi2aOriginalPreparationReceiptV1 };
}

export function stableAfcUi2aReceiptBytes(receipt: AfcUi2aOriginalPreparationReceiptV1): Buffer {
  return Buffer.from(JSON.stringify(receipt, null, 2), "utf8");
}
