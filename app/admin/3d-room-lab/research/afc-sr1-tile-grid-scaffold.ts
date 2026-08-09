/**
 * AFC-SR1 TS0 — research-only EMPTY → tiled-EMPTY instrument.
 *
 * This module is deliberately side-effect free: it talks directly to the
 * compositor client, retains no cache, and imports no room state, Apply
 * authority, persistence, token accounting, or downstream perspective reader.
 */
import "server-only";

import { createHash, randomUUID } from "node:crypto";

import {
  classifyAfcR3cImagePairCompatibility,
  type AfcR3cImagePairCompatibility,
} from "./afc-r3c-image-pair-compatibility";
import { callCompositorVibodeStageRun } from "@/lib/callCompositorVibodeStageRun";
import {
  ALLOWED_IMAGE_MIME,
  fetchRoomImageSafely,
  inspectImageMetadata,
} from "@/lib/vibodeAutoFloorImageFetch";

export const AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE = "afc-sr1-tile-grid-scaffold/v1" as const;
export const AFC_SR1_TILE_GRID_SCAFFOLD_PRESET = "tile_grid_scaffold" as const;
export const AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID = "NBP" as const;
export const AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID =
  "vibode-tile-grid-scaffold/stage2/v1" as const;

type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp";

export type AfcSr1TileGridScaffoldImageIdentity = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  mimeType: SupportedImageMime;
  orientation: 1;
}>;

export type AfcSr1TileGridScaffoldEmptyInput = Readonly<{
  /** Exact, established EMPTY bytes; these, not a room asset, reach the compositor. */
  base64: string;
  identity: AfcSr1TileGridScaffoldImageIdentity;
}>;

export type AfcSr1TileGridScaffoldProvenance = Readonly<{
  generatorId: typeof AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID;
  profileId: typeof AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE;
  researchPreset: typeof AFC_SR1_TILE_GRID_SCAFFOLD_PRESET;
  requestedModelId: typeof AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID;
  runId: string;
  generatedAt: string;
  appliedAspectRatio: string | null;
  imageTransport: "data_url" | "http_url";
  generationStatus: "generated";
}>;

export type AfcSr1TileGridScaffoldResult =
  | Readonly<{
      status: "generated";
      input: AfcSr1TileGridScaffoldImageIdentity;
      tiled: Readonly<{
        base64: string;
        identity: AfcSr1TileGridScaffoldImageIdentity & Readonly<{ mimeType: "image/png" }>;
      }>;
      provenance: AfcSr1TileGridScaffoldProvenance;
      compatibility: AfcR3cImagePairCompatibility;
    }>
  | Readonly<{
      status: "failure";
      code:
        | "invalid_empty_input"
        | "compositor_unavailable"
        | "generation_failed"
        | "invalid_output_image"
        | "unsupported_output_mime"
        | "output_decode_failed"
        | "basis_incompatible";
      runId: string;
      input?: AfcSr1TileGridScaffoldImageIdentity;
      tiled?: AfcSr1TileGridScaffoldImageIdentity;
      compatibility?: AfcR3cImagePairCompatibility;
    }>;

export type AfcSr1TileGridScaffoldArgs = Readonly<{
  empty: AfcSr1TileGridScaffoldEmptyInput;
  resultAllowedHosts: string[];
  maxOutputBytes: number;
  fetchTimeoutMs: number;
  allowLocalhostHttp: boolean;
  generationTimeoutMs: number;
  dependencies?: Readonly<{
    now?: () => Date;
    createRunId?: () => string;
  }>;
}>;

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isSupportedMime(value: unknown): value is SupportedImageMime {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

function validIdentity(value: unknown): value is AfcSr1TileGridScaffoldImageIdentity {
  if (!value || typeof value !== "object") return false;
  const image = value as AfcSr1TileGridScaffoldImageIdentity;
  return (
    isSha256(image.sha256) &&
    Number.isSafeInteger(image.byteCount) &&
    image.byteCount > 0 &&
    Number.isSafeInteger(image.decodedWidth) &&
    image.decodedWidth > 0 &&
    Number.isSafeInteger(image.decodedHeight) &&
    image.decodedHeight > 0 &&
    isSupportedMime(image.mimeType) &&
    image.orientation === 1
  );
}

function isCanonicalBase64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value) &&
    Buffer.from(value, "base64").toString("base64") === value
  );
}

function detectSupportedImageMime(bytes: Buffer): SupportedImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function sanitizeAppliedAspectRatio(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:._-]{1,32}$/.test(trimmed) ? trimmed : null;
}

async function identityFromExactBytes(
  bytes: Buffer,
  declaredMime: string,
  maxBytes: number
): Promise<
  | {
      ok: true;
      identity: AfcSr1TileGridScaffoldImageIdentity & Readonly<{ mimeType: "image/png" }>;
    }
  | { ok: false; code: "invalid_output_image" | "unsupported_output_mime" | "output_decode_failed" }
> {
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) return { ok: false, code: "invalid_output_image" };
  const detectedMime = detectSupportedImageMime(bytes);
  if (!detectedMime || !isSupportedMime(declaredMime) || detectedMime !== declaredMime) {
    return { ok: false, code: "unsupported_output_mime" };
  }
  if (detectedMime !== "image/png") return { ok: false, code: "unsupported_output_mime" };
  const metadata = await inspectImageMetadata(bytes);
  if (
    !metadata.ok ||
    !Number.isSafeInteger(metadata.width) ||
    metadata.width <= 0 ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.height <= 0 ||
    metadata.orientation !== 1
  ) {
    return { ok: false, code: "output_decode_failed" };
  }
  return {
    ok: true,
    identity: Object.freeze({
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteCount: bytes.byteLength,
      decodedWidth: metadata.width,
      decodedHeight: metadata.height,
      mimeType: "image/png" as const,
      orientation: 1,
    }),
  };
}

async function verifyExactEmpty(
  empty: AfcSr1TileGridScaffoldEmptyInput,
  maxBytes: number
): Promise<{ ok: true; bytes: Buffer; identity: AfcSr1TileGridScaffoldImageIdentity } | { ok: false }> {
  if (!empty || !isCanonicalBase64(empty.base64) || !validIdentity(empty.identity)) return { ok: false };
  const bytes = Buffer.from(empty.base64, "base64");
  if (
    bytes.byteLength !== empty.identity.byteCount ||
    bytes.byteLength > maxBytes ||
    createHash("sha256").update(bytes).digest("hex") !== empty.identity.sha256 ||
    detectSupportedImageMime(bytes) !== empty.identity.mimeType
  ) {
    return { ok: false };
  }
  const metadata = await inspectImageMetadata(bytes);
  if (
    !metadata.ok ||
    metadata.width !== empty.identity.decodedWidth ||
    metadata.height !== empty.identity.decodedHeight ||
    metadata.orientation !== empty.identity.orientation
  ) {
    return { ok: false };
  }
  return { ok: true, bytes, identity: Object.freeze({ ...empty.identity }) };
}

async function decodeCompositorResult(args: {
  imageUrl: string;
  maxBytes: number;
  resultAllowedHosts: string[];
  fetchTimeoutMs: number;
  allowLocalhostHttp: boolean;
}): Promise<
  | { ok: true; bytes: Buffer; mimeType: string; imageTransport: "data_url" | "http_url" }
  | { ok: false; code: "invalid_output_image" | "unsupported_output_mime" }
> {
  if (args.imageUrl.startsWith("data:")) {
    const match = args.imageUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/);
    if (!match || !isCanonicalBase64(match[2])) return { ok: false, code: "invalid_output_image" };
    const mimeType = match[1].trim().toLowerCase();
    if (!ALLOWED_IMAGE_MIME.has(mimeType)) return { ok: false, code: "unsupported_output_mime" };
    return { ok: true, bytes: Buffer.from(match[2], "base64"), mimeType, imageTransport: "data_url" };
  }

  const fetched = await fetchRoomImageSafely(args.imageUrl, {
    allowedHosts: args.resultAllowedHosts,
    maxBytes: args.maxBytes,
    timeoutMs: args.fetchTimeoutMs,
    allowLocalhostHttp: args.allowLocalhostHttp,
  });
  if (!fetched.ok) return { ok: false, code: "invalid_output_image" };
  if (!ALLOWED_IMAGE_MIME.has(fetched.mime)) return { ok: false, code: "unsupported_output_mime" };
  return { ok: true, bytes: fetched.buffer, mimeType: fetched.mime, imageTransport: "http_url" };
}

/**
 * Produces one new analytical tile derivative from an already established EMPTY.
 * There is intentionally no cache or reuse option: each call is a fresh NBP
 * generation, which lets TS1 request independent stochastic samples.
 */
export async function vibodeTileGridScaffoldAssist(
  args: AfcSr1TileGridScaffoldArgs
): Promise<AfcSr1TileGridScaffoldResult> {
  const runId = (args.dependencies?.createRunId ?? randomUUID)();
  const empty = await verifyExactEmpty(args.empty, args.maxOutputBytes);
  if (!empty.ok) return Object.freeze({ status: "failure", code: "invalid_empty_input", runId });
  if (!process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim()) {
    return Object.freeze({ status: "failure", code: "compositor_unavailable", runId, input: empty.identity });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.generationTimeoutMs);
  let generation: Awaited<ReturnType<typeof callCompositorVibodeStageRun>>;
  try {
    generation = await callCompositorVibodeStageRun({
      payload: {
        stage: 2,
        baseImageBase64: empty.bytes.toString("base64"),
        modelVersion: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
        flooringPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
        researchProfile: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
        isContinuation: true,
        repairDamage: false,
        repaintWalls: false,
        heavyDeclutter: false,
        renovateRoom: false,
        aspectRatio: "auto",
      },
      signal: controller.signal,
    });
  } catch {
    return Object.freeze({ status: "failure", code: "generation_failed", runId, input: empty.identity });
  } finally {
    clearTimeout(timeout);
  }

  const decoded = await decodeCompositorResult({
    imageUrl: generation.imageUrl,
    maxBytes: args.maxOutputBytes,
    resultAllowedHosts: args.resultAllowedHosts,
    fetchTimeoutMs: args.fetchTimeoutMs,
    allowLocalhostHttp: args.allowLocalhostHttp,
  });
  if (!decoded.ok) return Object.freeze({ status: "failure", code: decoded.code, runId, input: empty.identity });

  const tiled = await identityFromExactBytes(decoded.bytes, decoded.mimeType, args.maxOutputBytes);
  if (!tiled.ok) return Object.freeze({ status: "failure", code: tiled.code, runId, input: empty.identity });

  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: empty.identity.sha256,
      decodedWidth: empty.identity.decodedWidth,
      decodedHeight: empty.identity.decodedHeight,
      orientation: empty.identity.orientation,
    },
    {
      fingerprint: tiled.identity.sha256,
      decodedWidth: tiled.identity.decodedWidth,
      decodedHeight: tiled.identity.decodedHeight,
      orientation: tiled.identity.orientation,
    }
  );
  if (compatibility.tier === "incompatible") {
    return Object.freeze({
      status: "failure",
      code: "basis_incompatible",
      runId,
      input: empty.identity,
      tiled: tiled.identity,
      compatibility,
    });
  }

  const generatedAt = (args.dependencies?.now ?? (() => new Date()))().toISOString();
  return Object.freeze({
    status: "generated",
    input: empty.identity,
    tiled: Object.freeze({ base64: decoded.bytes.toString("base64"), identity: tiled.identity }),
    provenance: Object.freeze({
      generatorId: AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
      profileId: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
      researchPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
      requestedModelId: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
      runId,
      generatedAt,
      appliedAspectRatio: sanitizeAppliedAspectRatio(generation.appliedAspectRatio),
      imageTransport: decoded.imageTransport,
      generationStatus: "generated",
    }),
    compatibility,
  });
}
