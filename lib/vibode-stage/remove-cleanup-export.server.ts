/**
 * REMOVE-2B admin export of Clean Up Room inputs.
 *
 * The handler loads the certified ORIGINAL itself. Client image bytes,
 * signed URLs, and storage paths are not accepted. Hidden SAM 3 masks are
 * client-submitted and are not cryptographically authenticated as Roboflow
 * outputs. This route does not call a provider, write History, or persist
 * the ZIP.
 */

import { createHash } from "node:crypto";

import { NextResponse } from "next/server";
import sharp from "sharp";

import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import { sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import {
  parseAfcGenerationId,
  parseRoomId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import type {
  AfcProductionStore,
  AfcRoomPointer,
} from "@/lib/afc-v2-production/production-store";
import { zipStore } from "@/lib/vibode-stage/harmonize-export";
import {
  REMOVE_CLEANUP_CONCEPT_SET,
  REMOVE_CLEANUP_COORDINATE_BASIS,
  REMOVE_CLEANUP_DIAGNOSTIC_FILE,
  REMOVE_CLEANUP_EXPORT_VERSION,
  REMOVE_CLEANUP_FILL_OPACITY,
  REMOVE_CLEANUP_MAGENTA,
  REMOVE_CLEANUP_MANIFEST_FILE,
  REMOVE_CLEANUP_MASK_PROVENANCE,
  REMOVE_CLEANUP_MASK_PROVENANCE_LIMITATION,
  REMOVE_CLEANUP_MODEL_ID,
  REMOVE_CLEANUP_OUTLINE,
  REMOVE_CLEANUP_OVERLAY_FILE,
  REMOVE_CLEANUP_PROMPT_FILE,
  REMOVE_CLEANUP_PROMPT_VERSION,
  REMOVE_CLEANUP_PROVIDER_ID,
  REMOVE_CLEANUP_REFERENCE_EXPANSION_PX,
  REMOVE_CLEANUP_SCHEMA,
  REMOVE_CLEANUP_ZIP_NAME,
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

export const REMOVE_CLEANUP_MAX_BODY_BYTES = 32_000_000;
export const REMOVE_CLEANUP_MAX_PACKED_BYTES = 8_000_000;
export const REMOVE_CLEANUP_MAX_ZIP_BYTES = 64_000_000;

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

type ParseResult =
  | Readonly<{ ok: true; request: RemoveCleanupParsedRequest }>
  | Readonly<{ ok: false; reason: string }>;

export async function handleRemoveCleanupExport(
  request: Request,
  deps: RemoveCleanupExportDeps,
): Promise<Response> {
  const body = await readBoundedBody(request, REMOVE_CLEANUP_MAX_BODY_BYTES);
  if (body === "too-large") return jsonError("Request body is too large.", 400);
  const admin = await deps.getAdmin();
  if (!admin) return jsonError("Admin access required.", 403);
  const parsed = parseRemoveCleanupExportRequest(body);
  if (!parsed.ok) return jsonError(parsed.reason, 400);

  const store = deps.createStore();
  const service = deps.createService();
  if (!store || !service) return jsonError("Server misconfigured.", 500);
  const room = await store.getRoom(parsed.request.roomId);
  if (!room || room.userId !== admin.id) return jsonError("Room not found.", 404);
  const generation = room.currentAfcGenerationId
    ? await store.getGeneration(room.currentAfcGenerationId)
    : null;
  if (!generation || generation.userId !== admin.id || generation.roomId !== parsed.request.roomId) {
    return jsonError("Authoritative images are unavailable.", 404);
  }
  if (generation.id !== parsed.request.generationId) {
    return jsonError("Authoritative images are unavailable.", 404);
  }
  if (generation.status !== "ready") {
    return jsonError("This room has no production-ready AFC generation.", 422);
  }
  const original = generation.original;
  if (!original) return jsonError("Authoritative ORIGINAL image is unavailable.", 404);
  const storedOrientation: number = original.orientation;
  if (storedOrientation !== 1) return jsonError("ORIGINAL orientation is not supported.", 422);
  const mimeType: string = original.mimeType;
  if (mimeType !== "image/jpeg" && mimeType !== "image/png" && mimeType !== "image/webp") {
    return jsonError("ORIGINAL image could not be decoded.", 422);
  }
  if (
    original.sha256.toLowerCase() !== parsed.request.originalSha256
    || original.decodedWidth !== parsed.request.width
    || original.decodedHeight !== parsed.request.height
  ) {
    return jsonError("ORIGINAL identity does not match this generation.", 422);
  }

  const loaded = await deps.loadOriginal(service, { userId: admin.id, room });
  if (!loaded.ok || loaded.bytes.byteLength === 0) {
    return jsonError("Authoritative ORIGINAL image is unavailable.", 404);
  }
  if (loaded.bytes.byteLength !== original.byteCount) {
    return jsonError("ORIGINAL byte count does not match.", 422);
  }
  if (sha256Hex(loaded.bytes) !== original.sha256.toLowerCase()) {
    return jsonError("ORIGINAL SHA-256 does not match.", 422);
  }

  const decoded = await decodeAuthoritativeOriginal(loaded.bytes, {
    width: original.decodedWidth,
    height: original.decodedHeight,
  });
  if (!decoded.ok) return jsonError(decoded.reason, 422);

  const masks = parsed.request.objects.map((object) => object.bits);
  const blended = blendRemoveCleanupRgb({
    rgb: decoded.rgb,
    width: original.decodedWidth,
    height: original.decodedHeight,
    masks,
  });
  if (!blended || blended.unionPixels < 1) {
    return jsonError("Selected mask is empty.", 400);
  }
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
  const originalFile = `01-original.${extensionForMime(original.mimeType)}`;
  const phrases = parsed.request.objects.map((object) => removeCleanupObjectPhrase({
    concept: object.concept,
    bounds: object.bounds,
    width: original.decodedWidth,
    height: original.decodedHeight,
  }));
  const prompt = renderRemoveCleanupPrompt(phrases);
  const promptBytes = new TextEncoder().encode(prompt);
  const createdAt = deps.now?.() ?? new Date().toISOString();
  const pixels = original.decodedWidth * original.decodedHeight;
  const manifest = {
    schemaVersion: REMOVE_CLEANUP_EXPORT_VERSION,
    createdAt,
    roomId: parsed.request.roomId,
    generationId: generation.id,
    original: {
      sha256: original.sha256.toLowerCase(),
      decodedWidth: original.decodedWidth,
      decodedHeight: original.decodedHeight,
      mimeType: original.mimeType,
      orientation: 1 as const,
      fileName: originalFile,
      byteCount: loaded.bytes.byteLength,
      sha256MatchesExport: true,
    },
    segmentation: {
      provider: REMOVE_CLEANUP_PROVIDER_ID,
      modelId: REMOVE_CLEANUP_MODEL_ID,
      conceptSet: REMOVE_CLEANUP_CONCEPT_SET,
      schema: REMOVE_CLEANUP_SCHEMA,
      coordinateBasis: REMOVE_CLEANUP_COORDINATE_BASIS,
      maskProvenance: REMOVE_CLEANUP_MASK_PROVENANCE,
      maskProvenanceLimitation: REMOVE_CLEANUP_MASK_PROVENANCE_LIMITATION,
    },
    selection: {
      count: parsed.request.objects.length,
      objects: parsed.request.objects.map((object) => ({
        id: object.id,
        concept: object.concept,
        confidence: object.confidence,
        bounds: object.bounds,
        areaPx: object.areaPx,
        maskSha256: object.maskSha256,
      })),
      unionPixels: blended.unionPixels,
      unionCoveragePercent: Math.round((blended.unionPixels / pixels) * 1_000_000) / 10_000,
    },
    overlay: {
      color: REMOVE_CLEANUP_MAGENTA.hex,
      opacity: REMOVE_CLEANUP_FILL_OPACITY,
      outline: REMOVE_CLEANUP_OUTLINE,
      referenceExpansionPx: REMOVE_CLEANUP_REFERENCE_EXPANSION_PX,
      width: original.decodedWidth,
      height: original.decodedHeight,
      sha256: sha256Hex(overlayPng),
      fileName: REMOVE_CLEANUP_OVERLAY_FILE,
      mimeType: "image/png",
    },
    diagnosticMask: {
      fileName: REMOVE_CLEANUP_DIAGNOSTIC_FILE,
      sha256: sha256Hex(diagnosticPng),
      width: original.decodedWidth,
      height: original.decodedHeight,
      role: "internal-diagnostic",
      modelInput: false,
    },
    prompt: {
      version: REMOVE_CLEANUP_PROMPT_VERSION,
      fileName: REMOVE_CLEANUP_PROMPT_FILE,
      sha256: sha256Hex(promptBytes),
    },
    exclusions: {
      brushReveal: "excluded",
      brushRestore: "excluded",
      protectObjects: "excluded",
      interactiveMaskExpansion: "excluded",
      instantComposite: "excluded",
      emptyImage: "excluded",
      modelInputs: [originalFile, REMOVE_CLEANUP_OVERLAY_FILE],
    },
  };
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  const zip = zipStore([
    { name: originalFile, data: loaded.bytes },
    { name: REMOVE_CLEANUP_OVERLAY_FILE, data: overlayPng },
    { name: REMOVE_CLEANUP_DIAGNOSTIC_FILE, data: diagnosticPng },
    { name: REMOVE_CLEANUP_MANIFEST_FILE, data: manifestBytes },
    { name: REMOVE_CLEANUP_PROMPT_FILE, data: promptBytes },
  ]);
  if (zip.byteLength > REMOVE_CLEANUP_MAX_ZIP_BYTES) {
    return jsonError("Clean Up export is too large.", 422);
  }
  if (sha256Hex(loaded.bytes) !== manifest.original.sha256) {
    return jsonError("ORIGINAL SHA-256 does not match.", 422);
  }
  return new NextResponse(Buffer.from(zip), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${REMOVE_CLEANUP_ZIP_NAME}"`,
      "Content-Length": String(zip.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
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

function extensionForMime(mime: "image/jpeg" | "image/png" | "image/webp"): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "png";
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

function jsonError(reason: string, status: number) {
  const body = { usable: false as const, reason };
  assertProductionPayloadPrivacy(body);
  return productionAfcJson(body, status);
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
