import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { callCompositorVibodeStageRun } from "@/lib/callCompositorVibodeStageRun";
import {
  getAutoFloorVisionAllowedImageHosts,
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  getEmptyRoomAssistResultAllowedHosts,
  isAutoFloorVisionAllowLocalhostHttp,
} from "@/lib/vibodeAutoFloorVisionConfig";
import {
  fetchRoomImageSafely,
  inspectImageMetadata,
} from "@/lib/vibodeAutoFloorImageFetch";
import {
  AFC_V2_FULLY_TILED_PROMPT,
  AFC_V2_FULLY_TILED_PROMPT_VERSION,
} from "./fully-tiled-prompt";
import type { RoomObservationImageIdentity } from "./room-observation-contract";

export const AFC_V2_FULLY_TILED_GENERATOR_ID =
  "afc-v2-fully-tiled-compositor/stage4/v1" as const;
export const AFC_V2_FULLY_TILED_MODEL_ID = "NBP" as const;
export const AFC_V2_FULLY_TILED_TIMEOUT_MS = 120_000;

export type FullyTiledGeneration = Readonly<{
  bytes: Uint8Array;
  identity: RoomObservationImageIdentity;
  originalIdentity: RoomObservationImageIdentity;
  provenance: Readonly<{
    generationId: string;
    generatorId: typeof AFC_V2_FULLY_TILED_GENERATOR_ID;
    promptVersion: typeof AFC_V2_FULLY_TILED_PROMPT_VERSION;
    promptSha256: string;
    requestedModelId: typeof AFC_V2_FULLY_TILED_MODEL_ID;
    generatedFrom: "ORIGINAL";
    parentOriginalSha256: string;
    generatedAt: string;
    appliedAspectRatio: string | null;
    imageTransport: "data_url" | "http_url";
  }>;
}>;

export type FullyTiledGenerationResult =
  | Readonly<{ status: "generated"; value: FullyTiledGeneration }>
  | Readonly<{ status: "failed"; reason: string }>;

export type FullyTiledGenerationInput = Readonly<{
  sourceImageUrl: string;
  sourceImageIdentity: Readonly<{
    sha256: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: 1;
  }>;
}>;

type RetainedFullyTiledEvidence = Readonly<{
  resultId: string;
  binding: Readonly<{
    floorResultId: string;
    floorAuthorityKey: string | null;
    floorObservationSource: "FULLY_TILED";
  }>;
  bytes: Uint8Array;
  identity: RoomObservationImageIdentity;
  provenance: FullyTiledGeneration["provenance"];
}>;

const retainedEvidence = new Map<string, RetainedFullyTiledEvidence>();
const MAX_RETAINED_ATTEMPTS = 12;

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isCanonicalBase64(value: string): boolean {
  return value.length > 0 &&
    value.length % 4 === 0 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value) &&
    Buffer.from(value, "base64").toString("base64") === value;
}

function detectMime(
  bytes: Buffer,
): RoomObservationImageIdentity["mimeType"] | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  return null;
}

async function identity(
  bytes: Buffer,
  declaredMime: string,
): Promise<RoomObservationImageIdentity | null> {
  const mimeType = detectMime(bytes);
  if (!mimeType || mimeType !== declaredMime) return null;
  const metadata = await inspectImageMetadata(bytes);
  if (!metadata.ok || metadata.orientation !== 1) return null;
  return Object.freeze({
    sha256: sha256(bytes),
    byteCount: bytes.byteLength,
    decodedWidth: metadata.width,
    decodedHeight: metadata.height,
    mimeType,
    orientation: 1,
  });
}

function aspectCompatible(
  original: RoomObservationImageIdentity,
  generated: RoomObservationImageIdentity,
): boolean {
  const originalRatio = original.decodedWidth / original.decodedHeight;
  const generatedRatio = generated.decodedWidth / generated.decodedHeight;
  return Math.abs(generatedRatio - originalRatio) / originalRatio <= 0.015;
}

async function decodeGenerationArtifact(
  imageUrl: string,
): Promise<
  | {
      ok: true;
      bytes: Buffer;
      mime: RoomObservationImageIdentity["mimeType"];
      transport: "data_url" | "http_url";
    }
  | { ok: false }
> {
  if (imageUrl.startsWith("data:")) {
    const match = imageUrl.match(/^data:([^;,]+);base64,([\s\S]*)$/);
    if (!match || !isCanonicalBase64(match[2])) return { ok: false };
    const bytes = Buffer.from(match[2], "base64");
    const mime = detectMime(bytes);
    return mime && mime === match[1].trim().toLowerCase()
      ? { ok: true, bytes, mime, transport: "data_url" }
      : { ok: false };
  }

  const fetched = await fetchRoomImageSafely(imageUrl, {
    allowedHosts: getEmptyRoomAssistResultAllowedHosts(),
    maxBytes: getAutoFloorVisionImageMaxBytes(),
    timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
    allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
  });
  if (!fetched.ok) return { ok: false };
  const mime = detectMime(fetched.buffer);
  return mime && mime === fetched.mime
    ? { ok: true, bytes: fetched.buffer, mime, transport: "http_url" }
    : { ok: false };
}

/**
 * Generates the public FULLY_TILED representation directly from the exact
 * authority-qualified Original. Stage 4 is used only as the compositor's
 * existing exact-prompt transport; the supplied prompt replaces its styling
 * prompt in full.
 */
export async function generateFullyTiledFromOriginal(
  input: FullyTiledGenerationInput,
  dependencies: Readonly<{
    createGenerationId?: () => string;
    now?: () => Date;
  }> = {},
): Promise<FullyTiledGenerationResult> {
  const fetched = await fetchRoomImageSafely(input.sourceImageUrl, {
    allowedHosts: getAutoFloorVisionAllowedImageHosts(),
    maxBytes: getAutoFloorVisionImageMaxBytes(),
    timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
    allowLocalhostHttp: isAutoFloorVisionAllowLocalhostHttp(),
  });
  if (!fetched.ok) {
    return { status: "failed", reason: "FULLY_TILED Original fetch failed." };
  }
  const originalIdentity = await identity(fetched.buffer, fetched.mime);
  if (
    !originalIdentity ||
    originalIdentity.sha256 !== input.sourceImageIdentity.sha256 ||
    originalIdentity.decodedWidth !== input.sourceImageIdentity.decodedWidth ||
    originalIdentity.decodedHeight !== input.sourceImageIdentity.decodedHeight ||
    originalIdentity.orientation !== input.sourceImageIdentity.orientation
  ) {
    return {
      status: "failed",
      reason: "FULLY_TILED Original identity did not match the accepted basis.",
    };
  }
  if (!process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim()) {
    return {
      status: "failed",
      reason: "FULLY_TILED compositor endpoint is unavailable.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    AFC_V2_FULLY_TILED_TIMEOUT_MS,
  );
  let generation: Awaited<ReturnType<typeof callCompositorVibodeStageRun>>;
  try {
    generation = await callCompositorVibodeStageRun({
      payload: {
        stage: 4,
        baseImageBase64: fetched.base64,
        modelVersion: AFC_V2_FULLY_TILED_MODEL_ID,
        stage4Prompt: AFC_V2_FULLY_TILED_PROMPT,
        isContinuation: true,
        aspectRatio: "auto",
      },
      signal: controller.signal,
    });
  } catch {
    return {
      status: "failed",
      reason: controller.signal.aborted
        ? "FULLY_TILED generation timed out."
        : "FULLY_TILED compositor generation failed.",
    };
  } finally {
    clearTimeout(timeout);
  }

  const decoded = await decodeGenerationArtifact(generation.imageUrl);
  if (!decoded.ok) {
    return {
      status: "failed",
      reason: "FULLY_TILED output artifact was invalid.",
    };
  }
  const generatedIdentity = await identity(
    decoded.bytes,
    decoded.mime,
  );
  if (
    !generatedIdentity ||
    generatedIdentity.mimeType !== "image/png" ||
    generatedIdentity.sha256 === originalIdentity.sha256 ||
    !aspectCompatible(originalIdentity, generatedIdentity)
  ) {
    return {
      status: "failed",
      reason: "FULLY_TILED output did not preserve an admissible image basis.",
    };
  }

  const provenance = Object.freeze({
    generationId: (dependencies.createGenerationId ?? randomUUID)(),
    generatorId: AFC_V2_FULLY_TILED_GENERATOR_ID,
    promptVersion: AFC_V2_FULLY_TILED_PROMPT_VERSION,
    promptSha256: sha256(AFC_V2_FULLY_TILED_PROMPT),
    requestedModelId: AFC_V2_FULLY_TILED_MODEL_ID,
    generatedFrom: "ORIGINAL" as const,
    parentOriginalSha256: originalIdentity.sha256,
    generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    appliedAspectRatio:
      typeof generation.appliedAspectRatio === "string"
        ? generation.appliedAspectRatio
        : null,
    imageTransport: decoded.transport,
  });
  return {
    status: "generated",
    value: Object.freeze({
      bytes: Uint8Array.from(decoded.bytes),
      identity: generatedIdentity,
      originalIdentity,
      provenance,
    }),
  };
}

export function retainFullyTiledEvidence(
  attemptId: string,
  resultId: string,
  generation: FullyTiledGeneration,
  binding: Readonly<{
    floorResultId: string;
    floorAuthorityKey: string | null;
    floorObservationSource: "FULLY_TILED";
  }>,
): void {
  retainedEvidence.delete(attemptId);
  retainedEvidence.set(attemptId, Object.freeze({
    resultId,
    binding: Object.freeze({ ...binding }),
    bytes: Uint8Array.from(generation.bytes),
    identity: generation.identity,
    provenance: generation.provenance,
  }));
  while (retainedEvidence.size > MAX_RETAINED_ATTEMPTS) {
    const oldest = retainedEvidence.keys().next().value;
    if (typeof oldest !== "string") break;
    retainedEvidence.delete(oldest);
  }
}

export function getRetainedFullyTiledEvidence(
  attemptId: string,
): RetainedFullyTiledEvidence | null {
  return retainedEvidence.get(attemptId) ?? null;
}
