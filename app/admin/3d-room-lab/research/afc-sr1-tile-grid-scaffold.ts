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
  CompositorTransportError,
  toCompositorTransportDiagnostic,
} from "@/lib/compositorTransportError";
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
export const AFC_SR1_TS0_GENERATION_TIMEOUT_CONTRACT_VERSION =
  "afc-sr1-ts0-single-dispatch-timeout/v1" as const;
export const AFC_SR1_TS0_GENERATION_TIMEOUT_MS = 120_000;
export const AFC_SR1_TS0_GENERATION_DIAGNOSTIC_VERSION =
  "afc-sr1-ts0-generation-diagnostic/v1" as const;

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

export type AfcSr1Ts0GenerationFailureCode =
  | "invalid_empty_input"
  | "compositor_unavailable"
  | "timeout"
  | "connection_failure"
  | "http_4xx"
  | "http_5xx"
  | "malformed_response"
  | "missing_image_artifact"
  | "generation_failed"
  | "invalid_output_image"
  | "unsupported_output_mime"
  | "output_decode_failed"
  | "basis_incompatible";

export type AfcSr1Ts0GenerationDiagnostic = Readonly<{
  schemaVersion: typeof AFC_SR1_TS0_GENERATION_DIAGNOSTIC_VERSION;
  classification: AfcSr1Ts0GenerationFailureCode;
  failureBoundary:
    | "pre_dispatch_readiness_failure"
    | "dispatch_outcome_indeterminate"
    | "knowable_generation_failure"
    | "response_contract_failure"
    | "scientific_artifact_rejection";
  elapsedMs: number;
  generationTimeoutMs: typeof AFC_SR1_TS0_GENERATION_TIMEOUT_MS;
  httpStatus: number | null;
  errorClass: string | null;
  message: string;
  authorizedAttemptCount: 0 | 1;
  providerDispatch:
    | "not_attempted"
    | "unknown"
    | "response_received";
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
      code: AfcSr1Ts0GenerationFailureCode;
      runId: string;
      input?: AfcSr1TileGridScaffoldImageIdentity;
      tiled?: AfcSr1TileGridScaffoldImageIdentity;
      compatibility?: AfcR3cImagePairCompatibility;
      diagnostic?: AfcSr1Ts0GenerationDiagnostic;
    }>;

export type AfcSr1TileGridScaffoldArgs = Readonly<{
  empty: AfcSr1TileGridScaffoldEmptyInput;
  resultAllowedHosts: string[];
  maxOutputBytes: number;
  fetchTimeoutMs: number;
  allowLocalhostHttp: boolean;
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

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000);
}

function safeErrorClass(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(name)
    ? name
    : null;
}

function generationDiagnostic(args: {
  classification: AfcSr1Ts0GenerationFailureCode;
  failureBoundary: AfcSr1Ts0GenerationDiagnostic["failureBoundary"];
  startedAt: number;
  httpStatus?: number | null;
  errorClass?: string | null;
  message: string;
  authorizedAttemptCount: 0 | 1;
  providerDispatch: AfcSr1Ts0GenerationDiagnostic["providerDispatch"];
}): AfcSr1Ts0GenerationDiagnostic {
  return Object.freeze({
    schemaVersion: AFC_SR1_TS0_GENERATION_DIAGNOSTIC_VERSION,
    classification: args.classification,
    failureBoundary: args.failureBoundary,
    elapsedMs: elapsedMs(args.startedAt),
    generationTimeoutMs: AFC_SR1_TS0_GENERATION_TIMEOUT_MS,
    httpStatus: args.httpStatus ?? null,
    errorClass: args.errorClass ?? null,
    message: args.message,
    authorizedAttemptCount: args.authorizedAttemptCount,
    providerDispatch: args.providerDispatch,
  });
}

function classifyGenerationError(
  error: unknown,
  startedAt: number
): Readonly<{
  code: AfcSr1Ts0GenerationFailureCode;
  diagnostic: AfcSr1Ts0GenerationDiagnostic;
}> {
  if (error instanceof CompositorTransportError) {
    const transport = toCompositorTransportDiagnostic(error);
    let code: AfcSr1Ts0GenerationFailureCode;
    let failureBoundary: AfcSr1Ts0GenerationDiagnostic["failureBoundary"];
    let providerDispatch: AfcSr1Ts0GenerationDiagnostic["providerDispatch"] =
      "unknown";
    if (transport.class === "timeout") {
      code = "timeout";
      failureBoundary = "dispatch_outcome_indeterminate";
    } else if (transport.class === "connection_failure") {
      code = "connection_failure";
      failureBoundary = "dispatch_outcome_indeterminate";
    } else if (
      transport.httpStatus !== null &&
      transport.httpStatus >= 400 &&
      transport.httpStatus <= 499
    ) {
      code = "http_4xx";
      failureBoundary = "knowable_generation_failure";
      providerDispatch = "response_received";
    } else if (transport.class === "http_5xx") {
      code = "http_5xx";
      failureBoundary = "knowable_generation_failure";
      providerDispatch = "response_received";
    } else if (transport.class === "malformed_response") {
      code = "malformed_response";
      failureBoundary = "response_contract_failure";
      providerDispatch = "response_received";
    } else if (transport.class === "missing_image_artifact") {
      code = "missing_image_artifact";
      failureBoundary = "response_contract_failure";
      providerDispatch = "response_received";
    } else if (transport.class === "client_construction_failure") {
      code = "compositor_unavailable";
      failureBoundary = "pre_dispatch_readiness_failure";
      providerDispatch = "not_attempted";
    } else {
      code = "generation_failed";
      failureBoundary = "knowable_generation_failure";
      providerDispatch = "response_received";
    }
    return Object.freeze({
      code,
      diagnostic: generationDiagnostic({
        classification: code,
        failureBoundary,
        startedAt,
        httpStatus: transport.httpStatus,
        errorClass: error.name,
        message: transport.message,
        authorizedAttemptCount:
          failureBoundary === "pre_dispatch_readiness_failure" ? 0 : 1,
        providerDispatch,
      }),
    });
  }
  return Object.freeze({
    code: "generation_failed",
    diagnostic: generationDiagnostic({
      classification: "generation_failed",
      failureBoundary: "dispatch_outcome_indeterminate",
      startedAt,
      errorClass: safeErrorClass(error),
      message: "TS0 generation failed without a recoverable classification.",
      authorizedAttemptCount: 1,
      providerDispatch: "unknown",
    }),
  });
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
  const startedAt = performance.now();
  const runId = (args.dependencies?.createRunId ?? randomUUID)();
  const empty = await verifyExactEmpty(args.empty, args.maxOutputBytes);
  if (!empty.ok) {
    const code = "invalid_empty_input";
    return Object.freeze({
      status: "failure",
      code,
      runId,
      diagnostic: generationDiagnostic({
        classification: code,
        failureBoundary: "pre_dispatch_readiness_failure",
        startedAt,
        message: "TS0 EMPTY input failed local validation.",
        authorizedAttemptCount: 0,
        providerDispatch: "not_attempted",
      }),
    });
  }
  if (!process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim()) {
    const code = "compositor_unavailable";
    return Object.freeze({
      status: "failure",
      code,
      runId,
      input: empty.identity,
      diagnostic: generationDiagnostic({
        classification: code,
        failureBoundary: "pre_dispatch_readiness_failure",
        startedAt,
        message: "TS0 compositor endpoint is unavailable.",
        authorizedAttemptCount: 0,
        providerDispatch: "not_attempted",
      }),
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AFC_SR1_TS0_GENERATION_TIMEOUT_MS
  );
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
  } catch (error) {
    const failure = classifyGenerationError(error, startedAt);
    return Object.freeze({
      status: "failure",
      code: failure.code,
      runId,
      input: empty.identity,
      diagnostic: failure.diagnostic,
    });
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
  if (!decoded.ok) {
    return Object.freeze({
      status: "failure",
      code: decoded.code,
      runId,
      input: empty.identity,
      diagnostic: generationDiagnostic({
        classification: decoded.code,
        failureBoundary: "scientific_artifact_rejection",
        startedAt,
        message: "TS0 output artifact transport was inadmissible.",
        authorizedAttemptCount: 1,
        providerDispatch: "response_received",
      }),
    });
  }

  const tiled = await identityFromExactBytes(decoded.bytes, decoded.mimeType, args.maxOutputBytes);
  if (!tiled.ok) {
    return Object.freeze({
      status: "failure",
      code: tiled.code,
      runId,
      input: empty.identity,
      diagnostic: generationDiagnostic({
        classification: tiled.code,
        failureBoundary: "scientific_artifact_rejection",
        startedAt,
        message: "TS0 output image failed structural validation.",
        authorizedAttemptCount: 1,
        providerDispatch: "response_received",
      }),
    });
  }

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
      diagnostic: generationDiagnostic({
        classification: "basis_incompatible",
        failureBoundary: "scientific_artifact_rejection",
        startedAt,
        message: "TS0 output image basis is incompatible with its parent.",
        authorizedAttemptCount: 1,
        providerDispatch: "response_received",
      }),
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
