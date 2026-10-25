/**
 * REMOVE-2D1 shared Clean Up input preparation.
 *
 * `prepareAuthorizedRemoveCleanupInput` is the only way to build a generation
 * snapshot. It authenticates the admin, checks room ownership, reloads the
 * certified ORIGINAL, and validates the hidden-object selection. The resulting
 * snapshot is memory-only: this module does not call a provider, write a
 * database, or store an object.
 *
 * Buffer ownership:
 * - The loader's ORIGINAL bytes and the parsed mask bytes stay with the
 *   caller. The snapshot copies them before its first later await and never
 *   keeps those aliases.
 * - The snapshot owns its ORIGINAL, overlay, and packed-mask copies until the
 *   snapshot becomes unreachable. Accessors return new copies. Mutating a
 *   returned copy does not change the next read.
 * - Decoded RGB is local to preparation and is not retained.
 * - The diagnostic PNG is owned by the preparation result, not the snapshot.
 *   It is an export accessory. Callers receive a copy and may release it
 *   after packaging. It is not a model input.
 * - `Object.freeze` covers the snapshot's plain data. It is not the
 *   protection for binary buffers.
 *
 * The input fingerprint identifies this prepared input. It is not a job
 * idempotency record. A future paid request must also hash its separate
 * output configuration through `removeCleanupPaidRequestFingerprint`.
 */

import { createHash } from "node:crypto";

import sharp from "sharp";

import {
  classifyNanoBananaProAspectRatio,
  type NanoBananaProAspectRatio,
} from "@/lib/afc-image-models";
import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  parseAfcGenerationId,
  parseRoomId,
} from "@/lib/afc-v2-production/production-http";
import type {
  AfcProductionStore,
  AfcRoomPointer,
} from "@/lib/afc-v2-production/production-store";
import {
  REMOVE_CLEANUP_CONCEPT_SET,
  REMOVE_CLEANUP_COORDINATE_BASIS,
  REMOVE_CLEANUP_FILL_OPACITY,
  REMOVE_CLEANUP_MAGENTA,
  REMOVE_CLEANUP_MASK_PROVENANCE,
  REMOVE_CLEANUP_MASK_PROVENANCE_LIMITATION,
  REMOVE_CLEANUP_MODEL_ID,
  REMOVE_CLEANUP_OUTLINE,
  REMOVE_CLEANUP_PROMPT_VERSION,
  REMOVE_CLEANUP_PROVIDER_ID,
  REMOVE_CLEANUP_REFERENCE_EXPANSION_PX,
  REMOVE_CLEANUP_SCHEMA,
  blendRemoveCleanupRgb,
  removeCleanupObjectPhrase,
  renderRemoveCleanupPrompt,
} from "@/lib/vibode-stage/remove-cleanup-contract";
import type { RemoveDirtyRect } from "@/lib/vibode-stage/remove-mask";
import {
  REMOVE_SEGMENTATION_CONCEPTS_V1,
  REMOVE_SEGMENTATION_MAX_EDGE,
  REMOVE_SEGMENTATION_MAX_PIXELS,
  REMOVE_SEGMENTATION_MAX_PREDICTIONS,
} from "@/lib/vibode-stage/remove-segmentation";

export const REMOVE_CLEANUP_SNAPSHOT_VERSION = "remove-cleanup-generation-input/v1" as const;
export const REMOVE_CLEANUP_OVERLAY_VERSION = "remove-cleanup-overlay/v1" as const;
export const REMOVE_CLEANUP_INPUT_FINGERPRINT_VERSION = "remove-cleanup-input-fingerprint/v1" as const;
export const REMOVE_CLEANUP_OUTPUT_CONFIG_VERSION = "remove-cleanup-output-config/v1" as const;
export const REMOVE_CLEANUP_PAID_REQUEST_FINGERPRINT_VERSION =
  "remove-cleanup-paid-request-fingerprint/v1" as const;
export const REMOVE_CLEANUP_ASPECT_CLASSIFIER = "classifyNanoBananaProAspectRatio" as const;
export const REMOVE_CLEANUP_STAGE_REGISTRATION = "not-assessed" as const;

export const REMOVE_CLEANUP_MAX_BODY_BYTES = 32_000_000;
export const REMOVE_CLEANUP_MAX_PACKED_BYTES = 8_000_000;
export const REMOVE_CLEANUP_MAX_ZIP_BYTES = 64_000_000;

const OUTPUT_RESOLUTION_CLASSES = Object.freeze(["1K", "2K", "4K"] as const);
const OUTPUT_MIME_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"] as const);

const EXCLUSIONS = Object.freeze({
  brushReveal: "excluded",
  brushRestore: "excluded",
  protectObjects: "excluded",
  interactiveMaskExpansion: "excluded",
  instantComposite: "excluded",
  emptyImage: "excluded",
} as const);

const REQUEST_KEYS = Object.freeze([
  "roomId",
  "generationId",
  "originalSha256",
  "originalDecodedWidth",
  "originalDecodedHeight",
  "provider",
  "modelId",
  "conceptSet",
  "schema",
  "coordinateBasis",
  "referenceExpansionPx",
  "selectedObjects",
] as const);

const OBJECT_KEYS = Object.freeze([
  "id",
  "concept",
  "confidence",
  "maskSha256",
  "bits",
] as const);

export type RemoveCleanupExportStore = Pick<AfcProductionStore, "getRoom" | "getGeneration">;

export type RemoveCleanupOriginalLoad =
  | Readonly<{ ok: true; bytes: Uint8Array }>
  | Readonly<{ ok: false }>;

export type RemoveCleanupExportDeps = Readonly<{
  getAdmin: () => Promise<{ id: string } | null>;
  createStore: () => RemoveCleanupExportStore | null;
  createService: () => unknown;
  loadOriginal: (
    service: unknown,
    input: Readonly<{ userId: string; room: AfcRoomPointer }>,
  ) => Promise<RemoveCleanupOriginalLoad>;
  now?: () => string;
}>;

export type RemoveCleanupSelectedObject = Readonly<{
  id: string;
  concept: string;
  confidence: number;
  maskSha256: string;
  bits: Uint8Array;
  areaPx: number;
  bounds: RemoveDirtyRect;
}>;

export type RemoveCleanupParsedRequest = Readonly<{
  roomId: string;
  generationId: string;
  originalSha256: string;
  width: number;
  height: number;
  objects: readonly RemoveCleanupSelectedObject[];
}>;

export type RemoveCleanupOutputResolutionClass = (typeof OUTPUT_RESOLUTION_CLASSES)[number];
export type RemoveCleanupOutputMimeType = (typeof OUTPUT_MIME_TYPES)[number];

/**
 * Future provider-output settings. Preparation does not choose them, and the
 * input fingerprint does not include them. Two paid calls with the same
 * snapshot and different values here are different requests.
 *
 * `aspectRatioFamily` comes from the shared NBP classifier. It does not make
 * the image eligible to replace a STAGE background.
 */
export type RemoveCleanupProviderOutputConfig = Readonly<{
  schemaVersion: typeof REMOVE_CLEANUP_OUTPUT_CONFIG_VERSION;
  providerId: string;
  modelId: string;
  aspectRatioFamily: NanoBananaProAspectRatio;
  resolutionClass: RemoveCleanupOutputResolutionClass;
  mimeType: RemoveCleanupOutputMimeType;
}>;

export type RemoveCleanupProviderFamily =
  | Readonly<{
      admissible: true;
      classifier: typeof REMOVE_CLEANUP_ASPECT_CLASSIFIER;
      family: NanoBananaProAspectRatio;
      /** Documented 1K grid for this family. Not a resize of the ORIGINAL. */
      documented1kGridWidth: number;
      documented1kGridHeight: number;
    }>
  | Readonly<{
      admissible: false;
      classifier: typeof REMOVE_CLEANUP_ASPECT_CLASSIFIER;
      reason: string;
    }>;

export type RemoveCleanupGenerationInputSnapshot = Readonly<{
  schemaVersion: typeof REMOVE_CLEANUP_SNAPSHOT_VERSION;
  userId: string;
  roomId: string;
  generationId: string;
  original: Readonly<{
    sha256: string;
    byteCount: number;
    decodedWidth: number;
    decodedHeight: number;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    orientation: 1;
  }>;
  segmentation: Readonly<{
    provider: typeof REMOVE_CLEANUP_PROVIDER_ID;
    modelId: typeof REMOVE_CLEANUP_MODEL_ID;
    conceptSet: typeof REMOVE_CLEANUP_CONCEPT_SET;
    schema: typeof REMOVE_CLEANUP_SCHEMA;
    coordinateBasis: typeof REMOVE_CLEANUP_COORDINATE_BASIS;
    maskProvenance: typeof REMOVE_CLEANUP_MASK_PROVENANCE;
    maskProvenanceLimitation: typeof REMOVE_CLEANUP_MASK_PROVENANCE_LIMITATION;
  }>;
  selection: Readonly<{
    count: number;
    objects: readonly Readonly<{
      id: string;
      concept: string;
      confidence: number;
      bounds: RemoveDirtyRect;
      areaPx: number;
      maskSha256: string;
    }>[];
    unionPixels: number;
    unionCoveragePercent: number;
    unionSha256: string;
  }>;
  overlay: Readonly<{
    constructionVersion: typeof REMOVE_CLEANUP_OVERLAY_VERSION;
    format: "image/png";
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    color: "#FF00FF";
    opacity: typeof REMOVE_CLEANUP_FILL_OPACITY;
    referenceExpansionPx: 0;
    outline: typeof REMOVE_CLEANUP_OUTLINE;
  }>;
  prompt: Readonly<{
    version: typeof REMOVE_CLEANUP_PROMPT_VERSION;
    text: string;
    sha256: string;
    phrases: readonly string[];
  }>;
  exclusions: typeof EXCLUSIONS;
  aspect: Readonly<{
    sourceWidth: number;
    sourceHeight: number;
    orientation: 1;
    providerFamily: RemoveCleanupProviderFamily;
    stageRegistration: typeof REMOVE_CLEANUP_STAGE_REGISTRATION;
  }>;
  providerOutput: null;
  inputFingerprint: string;
  artifacts: Readonly<{
    originalBytes: () => Uint8Array;
    overlayPng: () => Uint8Array;
    selectedMasks: () => readonly Readonly<{
      id: string;
      maskSha256: string;
      bits: Uint8Array;
    }>[];
  }>;
}>;

export type RemoveCleanupPreparation =
  | Readonly<{
      ok: true;
      snapshot: RemoveCleanupGenerationInputSnapshot;
      copyDiagnosticPng: () => Uint8Array;
    }>
  | Readonly<{ ok: false; status: number; reason: string }>;

type ParseResult =
  | Readonly<{ ok: true; request: RemoveCleanupParsedRequest }>
  | Readonly<{ ok: false; reason: string }>;

type OriginalMime = "image/jpeg" | "image/png" | "image/webp";

type InputIdentity = Readonly<{
  userId: string;
  roomId: string;
  generationId: string;
  originalSha256: string;
  originalByteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  mimeType: OriginalMime;
  orientation: 1;
  selectedObjects: readonly Readonly<{ id: string; maskSha256: string }>[];
  promptVersion: typeof REMOVE_CLEANUP_PROMPT_VERSION;
  promptSha256: string;
  overlayVersion: typeof REMOVE_CLEANUP_OVERLAY_VERSION;
  overlayColor: "#FF00FF";
  overlayOpacity: typeof REMOVE_CLEANUP_FILL_OPACITY;
  overlayOutline: typeof REMOVE_CLEANUP_OUTLINE;
  overlayReferenceExpansionPx: 0;
  overlaySha256: string;
}>;

/**
 * Authorize one Clean Up preparation and return its immutable snapshot.
 * Export packaging and any future job must call this rather than rebuilding
 * the overlay, prompt, or ORIGINAL checks.
 */
export async function prepareAuthorizedRemoveCleanupInput(
  request: Request,
  deps: RemoveCleanupExportDeps,
): Promise<RemoveCleanupPreparation> {
  const body = await readBoundedBody(request, REMOVE_CLEANUP_MAX_BODY_BYTES);
  if (body === "too-large") return fail(400, "Request body is too large.");
  const admin = await deps.getAdmin();
  if (!admin) return fail(403, "Sign in required.");
  const parsed = parseRemoveCleanupExportRequest(body);
  if (!parsed.ok) return fail(400, parsed.reason);

  const store = deps.createStore();
  const service = deps.createService();
  if (!store || !service) return fail(500, "Server misconfigured.");
  const room = await store.getRoom(parsed.request.roomId);
  if (!room || room.userId !== admin.id) return fail(404, "Room not found.");
  const generation = room.currentAfcGenerationId
    ? await store.getGeneration(room.currentAfcGenerationId)
    : null;
  if (!generation || generation.userId !== admin.id || generation.roomId !== parsed.request.roomId) {
    return fail(404, "Authoritative images are unavailable.");
  }
  if (generation.id !== parsed.request.generationId) {
    return fail(404, "Authoritative images are unavailable.");
  }
  if (generation.status !== "ready") {
    return fail(422, "This room has no production-ready AFC generation.");
  }
  const original = generation.original;
  if (!original) return fail(404, "Authoritative ORIGINAL image is unavailable.");
  const storedOrientation: number = original.orientation;
  if (storedOrientation !== 1) return fail(422, "ORIGINAL orientation is not supported.");
  const mimeType: string = original.mimeType;
  if (!supportedOriginalMime(mimeType)) return fail(422, "ORIGINAL image could not be decoded.");
  if (
    original.sha256.toLowerCase() !== parsed.request.originalSha256
    || original.decodedWidth !== parsed.request.width
    || original.decodedHeight !== parsed.request.height
  ) {
    return fail(422, "ORIGINAL identity does not match this generation.");
  }

  const loaded = await deps.loadOriginal(service, { userId: admin.id, room });
  if (!loaded.ok || loaded.bytes.byteLength === 0) {
    return fail(404, "Authoritative ORIGINAL image is unavailable.");
  }
  if (loaded.bytes.byteLength !== original.byteCount) {
    return fail(422, "ORIGINAL byte count does not match.");
  }
  if (sha256Hex(loaded.bytes) !== original.sha256.toLowerCase()) {
    return fail(422, "ORIGINAL SHA-256 does not match.");
  }
  const originalBytes = Uint8Array.from(loaded.bytes);
  if (sha256Hex(originalBytes) !== original.sha256.toLowerCase()) {
    return fail(422, "ORIGINAL SHA-256 does not match.");
  }

  const decoded = await decodeAuthoritativeOriginal(originalBytes, {
    width: original.decodedWidth,
    height: original.decodedHeight,
  });
  if (!decoded.ok) return fail(422, decoded.reason);

  const masks = parsed.request.objects.map((object) => object.bits);
  const blended = blendRemoveCleanupRgb({
    rgb: decoded.rgb,
    width: original.decodedWidth,
    height: original.decodedHeight,
    masks,
  });
  if (!blended || blended.unionPixels < 1) return fail(400, "Selected mask is empty.");
  const overlayPng = await encodeOpaqueRgbPng(
    blended.overlay,
    original.decodedWidth,
    original.decodedHeight,
  );
  const diagnosticPng = await encodeOpaqueRgbPng(
    blended.diagnostic,
    original.decodedWidth,
    original.decodedHeight,
  );
  const phrases = parsed.request.objects.map((object) => removeCleanupObjectPhrase({
    concept: object.concept,
    bounds: object.bounds,
    width: original.decodedWidth,
    height: original.decodedHeight,
  }));
  const prompt = renderRemoveCleanupPrompt(phrases);
  const promptBytes = new TextEncoder().encode(prompt);
  const pixels = original.decodedWidth * original.decodedHeight;
  const ownedMasks = parsed.request.objects.map((object) => ({
    id: object.id,
    maskSha256: object.maskSha256,
    bits: Uint8Array.from(object.bits),
  }));
  const identity: InputIdentity = {
    userId: admin.id,
    roomId: parsed.request.roomId,
    generationId: generation.id,
    originalSha256: sha256Hex(originalBytes),
    originalByteCount: originalBytes.byteLength,
    decodedWidth: original.decodedWidth,
    decodedHeight: original.decodedHeight,
    mimeType,
    orientation: 1,
    selectedObjects: ownedMasks.map((object) => ({
      id: object.id,
      maskSha256: object.maskSha256,
    })),
    promptVersion: REMOVE_CLEANUP_PROMPT_VERSION,
    promptSha256: sha256Hex(promptBytes),
    overlayVersion: REMOVE_CLEANUP_OVERLAY_VERSION,
    overlayColor: REMOVE_CLEANUP_MAGENTA.hex,
    overlayOpacity: REMOVE_CLEANUP_FILL_OPACITY,
    overlayOutline: REMOVE_CLEANUP_OUTLINE,
    overlayReferenceExpansionPx: REMOVE_CLEANUP_REFERENCE_EXPANSION_PX,
    overlaySha256: sha256Hex(overlayPng),
  };
  const snapshot = Object.freeze({
    schemaVersion: REMOVE_CLEANUP_SNAPSHOT_VERSION,
    userId: identity.userId,
    roomId: identity.roomId,
    generationId: identity.generationId,
    original: Object.freeze({
      sha256: identity.originalSha256,
      byteCount: identity.originalByteCount,
      decodedWidth: identity.decodedWidth,
      decodedHeight: identity.decodedHeight,
      mimeType: identity.mimeType,
      orientation: identity.orientation,
    }),
    segmentation: Object.freeze({
      provider: REMOVE_CLEANUP_PROVIDER_ID,
      modelId: REMOVE_CLEANUP_MODEL_ID,
      conceptSet: REMOVE_CLEANUP_CONCEPT_SET,
      schema: REMOVE_CLEANUP_SCHEMA,
      coordinateBasis: REMOVE_CLEANUP_COORDINATE_BASIS,
      maskProvenance: REMOVE_CLEANUP_MASK_PROVENANCE,
      maskProvenanceLimitation: REMOVE_CLEANUP_MASK_PROVENANCE_LIMITATION,
    }),
    selection: Object.freeze({
      count: parsed.request.objects.length,
      objects: Object.freeze(parsed.request.objects.map((object) => Object.freeze({
        id: object.id,
        concept: object.concept,
        confidence: object.confidence,
        bounds: Object.freeze({ ...object.bounds }),
        areaPx: object.areaPx,
        maskSha256: object.maskSha256,
      }))),
      unionPixels: blended.unionPixels,
      unionCoveragePercent: Math.round((blended.unionPixels / pixels) * 1_000_000) / 10_000,
      unionSha256: sha256Hex(unionPacked(ownedMasks.map((object) => object.bits))),
    }),
    overlay: Object.freeze({
      constructionVersion: identity.overlayVersion,
      format: "image/png" as const,
      sha256: identity.overlaySha256,
      decodedWidth: identity.decodedWidth,
      decodedHeight: identity.decodedHeight,
      color: identity.overlayColor,
      opacity: identity.overlayOpacity,
      referenceExpansionPx: identity.overlayReferenceExpansionPx,
      outline: identity.overlayOutline,
    }),
    prompt: Object.freeze({
      version: identity.promptVersion,
      text: prompt,
      sha256: identity.promptSha256,
      phrases: Object.freeze([...phrases]),
    }),
    exclusions: EXCLUSIONS,
    aspect: Object.freeze({
      sourceWidth: identity.decodedWidth,
      sourceHeight: identity.decodedHeight,
      orientation: 1 as const,
      providerFamily: providerFamilyFor(identity.decodedWidth, identity.decodedHeight),
      stageRegistration: REMOVE_CLEANUP_STAGE_REGISTRATION,
    }),
    providerOutput: null,
    inputFingerprint: sha256Hex(new TextEncoder().encode(inputIdentityMaterial(identity))),
    artifacts: Object.freeze({
      originalBytes: ownedBytes(originalBytes),
      overlayPng: ownedBytes(overlayPng),
      selectedMasks: () => ownedMasks.map((object) => ({
        id: object.id,
        maskSha256: object.maskSha256,
        bits: Uint8Array.from(object.bits),
      })),
    }),
  });
  return Object.freeze({
    ok: true as const,
    snapshot,
    copyDiagnosticPng: ownedBytes(diagnosticPng),
  });
}

export function removeCleanupInputIdentityMaterial(
  snapshot: RemoveCleanupGenerationInputSnapshot,
): string {
  return inputIdentityMaterial({
    userId: snapshot.userId,
    roomId: snapshot.roomId,
    generationId: snapshot.generationId,
    originalSha256: snapshot.original.sha256,
    originalByteCount: snapshot.original.byteCount,
    decodedWidth: snapshot.original.decodedWidth,
    decodedHeight: snapshot.original.decodedHeight,
    mimeType: snapshot.original.mimeType,
    orientation: snapshot.original.orientation,
    selectedObjects: snapshot.selection.objects.map((object) => ({
      id: object.id,
      maskSha256: object.maskSha256,
    })),
    promptVersion: snapshot.prompt.version,
    promptSha256: snapshot.prompt.sha256,
    overlayVersion: snapshot.overlay.constructionVersion,
    overlayColor: snapshot.overlay.color,
    overlayOpacity: snapshot.overlay.opacity,
    overlayOutline: snapshot.overlay.outline,
    overlayReferenceExpansionPx: snapshot.overlay.referenceExpansionPx,
    overlaySha256: snapshot.overlay.sha256,
  });
}

/**
 * Distinguish two future paid requests that share one input snapshot.
 * This does not create a job, choose a model, or contact a provider.
 */
export function removeCleanupPaidRequestFingerprint(
  inputFingerprint: string,
  output: RemoveCleanupProviderOutputConfig,
): string | null {
  if (!/^[0-9a-f]{64}$/.test(inputFingerprint)) return null;
  if (output.schemaVersion !== REMOVE_CLEANUP_OUTPUT_CONFIG_VERSION) return null;
  if (!token(output.providerId) || !token(output.modelId)) return null;
  if (!/^[1-9][0-9]?:[1-9][0-9]?$/.test(output.aspectRatioFamily)) return null;
  if (!OUTPUT_RESOLUTION_CLASSES.includes(output.resolutionClass)) return null;
  if (!OUTPUT_MIME_TYPES.includes(output.mimeType)) return null;
  const material = canonicalJson({
    schemaVersion: REMOVE_CLEANUP_PAID_REQUEST_FINGERPRINT_VERSION,
    inputFingerprint,
    providerId: output.providerId,
    modelId: output.modelId,
    aspectRatioFamily: output.aspectRatioFamily,
    resolutionClass: output.resolutionClass,
    mimeType: output.mimeType,
  });
  return sha256Hex(new TextEncoder().encode(material));
}

export function parseRemoveCleanupExportRequest(bytes: Uint8Array): ParseResult {
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return { ok: false, reason: "Request body is invalid." };
  }
  if (!record(payload)) return { ok: false, reason: "Request body is invalid." };
  if (!exactKeys(payload, REQUEST_KEYS)) {
    return { ok: false, reason: "Cleanup export request has an unknown field." };
  }
  const roomId = parseRoomId(payload.roomId);
  const generationId = parseAfcGenerationId(payload.generationId);
  if (!roomId || !generationId) return { ok: false, reason: "Request body is invalid." };
  if (typeof payload.originalSha256 !== "string" || !/^[0-9a-f]{64}$/.test(payload.originalSha256)) {
    return { ok: false, reason: "Request body is invalid." };
  }
  const grid = readOriginalGrid(payload.originalDecodedWidth, payload.originalDecodedHeight);
  if (!grid) return { ok: false, reason: "Request body is invalid." };
  const { width, height } = grid;
  if (payload.provider !== REMOVE_CLEANUP_PROVIDER_ID || payload.modelId !== REMOVE_CLEANUP_MODEL_ID) {
    return { ok: false, reason: "Segmentation provider is not supported." };
  }
  if (payload.conceptSet !== REMOVE_CLEANUP_CONCEPT_SET || payload.schema !== REMOVE_CLEANUP_SCHEMA) {
    return { ok: false, reason: "Segmentation provider is not supported." };
  }
  if (payload.coordinateBasis !== REMOVE_CLEANUP_COORDINATE_BASIS) {
    return { ok: false, reason: "Cleanup coordinate basis is not supported." };
  }
  if (typeof payload.referenceExpansionPx !== "number" || !Number.isInteger(payload.referenceExpansionPx)) {
    return { ok: false, reason: "Request body is invalid." };
  }
  if (payload.referenceExpansionPx !== REMOVE_CLEANUP_REFERENCE_EXPANSION_PX) {
    return { ok: false, reason: "Reference mask expansion is not supported." };
  }
  if (!Array.isArray(payload.selectedObjects)) return { ok: false, reason: "Request body is invalid." };
  if (payload.selectedObjects.length === 0) {
    return { ok: false, reason: "Select a hidden object before exporting." };
  }
  if (payload.selectedObjects.length > REMOVE_SEGMENTATION_MAX_PREDICTIONS) {
    return { ok: false, reason: "Selected masks exceed the export limit." };
  }
  const packedLength = Math.ceil((width * height) / 8);
  if (packedLength * payload.selectedObjects.length > REMOVE_CLEANUP_MAX_PACKED_BYTES) {
    return { ok: false, reason: "Selected masks exceed the export limit." };
  }
  const seen = new Set<string>();
  const objects: RemoveCleanupSelectedObject[] = [];
  for (const item of payload.selectedObjects) {
    const decoded = decodeSelectedObject(item, width, height, packedLength);
    if (!decoded.ok) return decoded;
    if (seen.has(decoded.object.id)) return { ok: false, reason: "Selected object ids must be unique." };
    seen.add(decoded.object.id);
    objects.push(decoded.object);
  }
  objects.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return {
    ok: true,
    request: {
      roomId,
      generationId,
      originalSha256: payload.originalSha256,
      width,
      height,
      objects,
    },
  };
}

export function removeCleanupIdDigest(bits: Uint8Array, confidence: number): string {
  return createHash("sha256")
    .update(bits)
    .update(JSON.stringify(confidence))
    .digest("hex")
    .slice(0, 8);
}

function inputIdentityMaterial(identity: InputIdentity): string {
  const selectedObjects = [...identity.selectedObjects].sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ));
  return canonicalJson({
    schemaVersion: REMOVE_CLEANUP_INPUT_FINGERPRINT_VERSION,
    userId: identity.userId,
    roomId: identity.roomId,
    generationId: identity.generationId,
    originalSha256: identity.originalSha256,
    originalByteCount: identity.originalByteCount,
    decodedWidth: identity.decodedWidth,
    decodedHeight: identity.decodedHeight,
    mimeType: identity.mimeType,
    orientation: identity.orientation,
    selectedObjects,
    promptVersion: identity.promptVersion,
    promptSha256: identity.promptSha256,
    overlayVersion: identity.overlayVersion,
    overlayColor: identity.overlayColor,
    overlayOpacity: identity.overlayOpacity,
    overlayOutline: identity.overlayOutline,
    overlayReferenceExpansionPx: identity.overlayReferenceExpansionPx,
    overlaySha256: identity.overlaySha256,
  });
}

function providerFamilyFor(width: number, height: number): RemoveCleanupProviderFamily {
  const classified = classifyNanoBananaProAspectRatio(width, height);
  if (!classified.ok) {
    return Object.freeze({
      admissible: false,
      classifier: REMOVE_CLEANUP_ASPECT_CLASSIFIER,
      reason: classified.reason,
    });
  }
  return Object.freeze({
    admissible: true,
    classifier: REMOVE_CLEANUP_ASPECT_CLASSIFIER,
    family: classified.ratio,
    documented1kGridWidth: classified.gridWidth,
    documented1kGridHeight: classified.gridHeight,
  });
}

function ownedBytes(bytes: Uint8Array): () => Uint8Array {
  const stored = Uint8Array.from(bytes);
  return () => Uint8Array.from(stored);
}

function unionPacked(masks: readonly Uint8Array[]): Uint8Array {
  const length = masks[0]?.byteLength ?? 0;
  const union = new Uint8Array(length);
  for (const mask of masks) {
    for (let index = 0; index < length; index += 1) union[index] |= mask[index] ?? 0;
  }
  return union;
}

function supportedOriginalMime(value: string): value is OriginalMime {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function token(value: string): boolean {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value);
}

function fail(status: number, reason: string): RemoveCleanupPreparation {
  return { ok: false, status, reason };
}

function canonicalJson(value: unknown): string {
  if (
    typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || value === null
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (!value || typeof value !== "object") return "null";
  const entries = Object.keys(value).sort();
  return `{${entries.map((key) => {
    const item = (value as Record<string, unknown>)[key];
    return `${JSON.stringify(key)}:${canonicalJson(item)}`;
  }).join(",")}}`;
}

function decodeSelectedObject(
  value: unknown,
  width: number,
  height: number,
  packedLength: number,
): Readonly<{ ok: true; object: RemoveCleanupSelectedObject } | { ok: false; reason: string }> {
  if (!record(value) || !exactKeys(value, OBJECT_KEYS)) {
    return { ok: false, reason: "Cleanup export request has an unknown field." };
  }
  const id = typeof value.id === "string" ? value.id : "";
  const concept = typeof value.concept === "string" ? value.concept : "";
  const confidence = value.confidence;
  if (!/^[a-z0-9-]{1,80}$/.test(id)) return { ok: false, reason: "Selected object id does not match its mask." };
  if (!REMOVE_SEGMENTATION_CONCEPTS_V1.includes(concept as (typeof REMOVE_SEGMENTATION_CONCEPTS_V1)[number])) {
    return { ok: false, reason: "Segmentation concept is not supported." };
  }
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    return { ok: false, reason: "Request body is invalid." };
  }
  if (typeof value.maskSha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.maskSha256)) {
    return { ok: false, reason: "Selected mask does not match its digest." };
  }
  if (typeof value.bits !== "string") return { ok: false, reason: "Selected mask dimensions are invalid." };
  const expectedText = canonicalBase64Length(packedLength);
  if (value.bits.length !== expectedText) return { ok: false, reason: "Selected mask dimensions are invalid." };
  const bits = decodeCanonicalBase64(value.bits);
  if (!bits || bits.length !== packedLength) return { ok: false, reason: "Selected mask dimensions are invalid." };
  if (unusedBitsSet(bits, width * height)) return { ok: false, reason: "Selected mask dimensions are invalid." };
  const measured = measureMask(bits, width, height);
  if (!measured || measured.areaPx < 1) return { ok: false, reason: "Selected mask is empty." };
  const digest = sha256Hex(bits);
  if (digest !== value.maskSha256) return { ok: false, reason: "Selected mask does not match its digest." };
  const slug = concept.replaceAll(" ", "-");
  const idDigest = removeCleanupIdDigest(bits, confidence);
  const match = /^v1-(.+)-((?:0|[1-9][0-9]*))-([0-9a-f]{8})$/.exec(id);
  if (!match || match[1] !== slug || match[3] !== idDigest) {
    return { ok: false, reason: "Selected object id does not match its mask." };
  }
  return {
    ok: true,
    object: {
      id,
      concept,
      confidence,
      maskSha256: digest,
      bits,
      areaPx: measured.areaPx,
      bounds: measured.bounds,
    },
  };
}

async function decodeAuthoritativeOriginal(
  bytes: Uint8Array,
  expected: Readonly<{ width: number; height: number }>,
): Promise<Readonly<{ ok: true; rgb: Uint8Array } | { ok: false; reason: string }>> {
  try {
    const meta = await sharp(Buffer.from(bytes)).metadata();
    // Same contract as inspectImageMetadata: stored pixel dimensions, missing
    // EXIF orientation means upright, and sharp must not rotate the samples.
    const orientation = typeof meta.orientation === "number" ? meta.orientation : 1;
    if (
      typeof meta.width !== "number"
      || typeof meta.height !== "number"
      || meta.width < 1
      || meta.height < 1
    ) {
      return { ok: false, reason: "ORIGINAL image could not be decoded." };
    }
    if (orientation !== 1) return { ok: false, reason: "ORIGINAL orientation is not supported." };
    if (meta.width !== expected.width || meta.height !== expected.height) {
      return { ok: false, reason: "ORIGINAL dimensions do not match." };
    }
    const { data, info } = await sharp(Buffer.from(bytes), {
      failOn: "error",
      limitInputPixels: REMOVE_SEGMENTATION_MAX_PIXELS,
    }).raw().toBuffer({ resolveWithObject: true });
    if (info.width !== expected.width || info.height !== expected.height) {
      return { ok: false, reason: "ORIGINAL dimensions do not match." };
    }
    if (info.channels === 3) return { ok: true, rgb: new Uint8Array(data) };
    if (info.channels === 4) {
      const rgb = new Uint8Array(info.width * info.height * 3);
      for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
        const source = pixel * 4;
        if (data[source + 3] !== 255) return { ok: false, reason: "ORIGINAL image could not be decoded." };
        rgb[pixel * 3] = data[source] ?? 0;
        rgb[pixel * 3 + 1] = data[source + 1] ?? 0;
        rgb[pixel * 3 + 2] = data[source + 2] ?? 0;
      }
      return { ok: true, rgb };
    }
    return { ok: false, reason: "ORIGINAL image could not be decoded." };
  } catch {
    return { ok: false, reason: "ORIGINAL image could not be decoded." };
  }
}

async function encodeOpaqueRgbPng(
  rgb: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const png = await sharp(rgb, { raw: { width, height, channels: 3 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return new Uint8Array(png);
}

function measureMask(
  bits: Uint8Array,
  width: number,
  height: number,
): Readonly<{ areaPx: number; bounds: RemoveDirtyRect }> | null {
  let areaPx = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!packedBit(bits, y * width + x)) continue;
      areaPx += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + 1 > maxX) maxX = x + 1;
      if (y + 1 > maxY) maxY = y + 1;
    }
  }
  if (areaPx === 0) return null;
  return {
    areaPx,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

function unusedBitsSet(bits: Uint8Array, pixels: number): boolean {
  const used = pixels % 8;
  if (used === 0) return false;
  const last = bits[bits.length - 1] ?? 0;
  const unused = (~((1 << used) - 1)) & 0xff;
  return (last & unused) !== 0;
}

function packedBit(bits: Uint8Array, index: number): boolean {
  return ((bits[index >> 3] ?? 0) & (1 << (index & 7))) !== 0;
}

function canonicalBase64Length(byteLength: number): number {
  return 4 * Math.ceil(byteLength / 3);
}

function decodeCanonicalBase64(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) return null;
  return new Uint8Array(bytes);
}

function readOriginalGrid(
  width: unknown,
  height: unknown,
): Readonly<{ width: number; height: number }> | null {
  if (
    typeof width !== "number"
    || typeof height !== "number"
    || !Number.isInteger(width)
    || !Number.isInteger(height)
    || width < 1
    || height < 1
    || width > REMOVE_SEGMENTATION_MAX_EDGE
    || height > REMOVE_SEGMENTATION_MAX_EDGE
    || width * height > REMOVE_SEGMENTATION_MAX_PIXELS
  ) {
    return null;
  }
  return { width, height };
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array | "too-large"> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return "too-large";
  if (!request.body) {
    const text = await request.text();
    if (text.length > maxBytes) return "too-large";
    return new TextEncoder().encode(text);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    total += step.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(step.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
