import "server-only";

import { callCompositorVibodeStageRun } from "@/lib/callCompositorVibodeStageRun";
import { fetchRoomImageSafely, ALLOWED_IMAGE_MIME } from "@/lib/vibodeAutoFloorImageFetch";

// --- Phase 2H-B: lab-only Empty Room generation + transient cache ------------
// SAFETY MODEL (load-bearing):
// - This calls the compositor's stage-run HTTP client DIRECTLY. That client is
//   side-effect-free in this repo: it does NOT charge tokens, create/finalize
//   vibode_room_assets, update lineage, or mutate the room active asset. All of
//   those side effects live in app/api/vibode/stage-run/route.ts, which this
//   path intentionally does NOT use.
// - The generated empty-room image is held ONLY in a process-local in-memory
//   cache keyed by the SHA-256 of the VERIFIED ORIGINAL bytes. It is lab-only,
//   transient, and LOST ON RESTART. This is NOT durable storage and must NOT be
//   treated as a production design.
// - Empty-room bytes never come from the browser; the browser only sends the
//   original room-image context to the admin route.

/** Stable identity for the transient lab-only Stage 1 empty-room generator. */
export const EMPTY_ROOM_ASSIST_GENERATOR_ID = "vibode-empty-room-assist/stage1-empty-room/v1";
/**
 * The requested compositor model label. This is deliberately distinct from a
 * resolved provider identity, which the compositor does not return.
 */
export const EMPTY_ROOM_ASSIST_REQUESTED_MODEL_ID = "NBP";

/**
 * The compositor's ratio label is provenance only. Keep it bounded and
 * printable before it reaches the process cache or an immutable receipt.
 */
export function sanitizeEmptyRoomAppliedAspectRatio(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:._-]{1,32}$/.test(trimmed) ? trimmed : null;
}

export type EmptyRoomGenerationProvenance = Readonly<{
  generatorId: typeof EMPTY_ROOM_ASSIST_GENERATOR_ID;
  requestedModelId: typeof EMPTY_ROOM_ASSIST_REQUESTED_MODEL_ID;
  resolvedModelId: null;
  resolvedModelStatus: "not_reported_by_compositor";
  appliedAspectRatio: string | null;
  imageTransport: "data_url" | "http_url";
  generatedAt: string;
}>;

export type EmptyRoomImageBytes = {
  base64: string;
  mime: string;
  byteCount: number;
  provenance: EmptyRoomGenerationProvenance;
};

export type EmptyRoomCacheStatus = "hit" | "miss" | "unavailable" | "not_used";

export type EmptyRoomAssistGenerateResult =
  | { ok: true; cacheStatus: "hit" | "miss"; image: EmptyRoomImageBytes }
  | {
      ok: false;
      cacheStatus: "miss" | "unavailable";
      // Safe, generic stage label only — never raw upstream text.
      stage: "config" | "generate" | "fetch_result" | "decode" | "mime_mismatch";
      reason: string;
    };

function sanitizeFieldName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(trimmed)) return null;
  return trimmed;
}

function extractSafeCompositor422Message(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const statusMatch = message.match(/\b(?:stage-run\):\s*)?(\d{3})\b/);
  const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : null;
  if (status !== 422) return null;

  // callCompositorVibodeStageRun throws:
  // "Compositor backend error (stage-run): <status> <text>".
  const jsonStart = message.indexOf("{");
  const bodyText = jsonStart >= 0 ? message.slice(jsonStart) : "";
  const fields = new Set<string>();
  if (bodyText) {
    try {
      const parsed = JSON.parse(bodyText) as unknown;
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(walk);
          return;
        }
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        if (Array.isArray(record.loc)) {
          for (const locPart of record.loc) {
            const field = sanitizeFieldName(locPart);
            if (field && field !== "body") fields.add(field);
            if (fields.size >= 5) return;
          }
        }
        for (const child of Object.values(record)) {
          walk(child);
          if (fields.size >= 5) return;
        }
      };
      walk(parsed);
    } catch {
      // keep generic 422 message below
    }
  }

  const safeFields = [...fields].slice(0, 5);
  if (safeFields.length === 1) {
    return `Empty-room compositor request was rejected (HTTP 422). Missing or invalid field: ${safeFields[0]}.`;
  }
  if (safeFields.length > 1) {
    return `Empty-room compositor request was rejected (HTTP 422). Missing or invalid fields: ${safeFields.join(", ")}.`;
  }
  return "Empty-room compositor request was rejected (HTTP 422).";
}

// Process-local, capped cache. Intentionally tiny: the lab tests one base image
// at a time and we never want this to grow unbounded in a long-lived process.
const MAX_CACHE_ENTRIES = 8;
const emptyRoomCache = new Map<string, EmptyRoomImageBytes>();

function cacheSet(hash: string, image: EmptyRoomImageBytes): EmptyRoomImageBytes {
  // Cache provenance is captured at generation time and never modified on a
  // cache hit. Freeze both levels so process-local callers cannot relabel it.
  const immutable = Object.freeze({
    ...image,
    provenance: Object.freeze({ ...image.provenance }),
  });
  if (emptyRoomCache.has(hash)) emptyRoomCache.delete(hash);
  emptyRoomCache.set(hash, immutable);
  while (emptyRoomCache.size > MAX_CACHE_ENTRIES) {
    const oldest = emptyRoomCache.keys().next().value;
    if (oldest === undefined) break;
    emptyRoomCache.delete(oldest);
  }
  return immutable;
}

export function getCachedEmptyRoomImage(originalHash: string): EmptyRoomImageBytes | null {
  return emptyRoomCache.get(originalHash) ?? null;
}

/** Detect only the supported image signatures; never rewrite or relabel bytes. */
export function detectEmptyRoomImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
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

function decodeDataUrlImage(args: {
  dataUrl: string;
  maxBytes: number;
  appliedAspectRatio: string | null;
}):
  | { ok: true; image: EmptyRoomImageBytes }
  | { ok: false; stage: "decode" | "mime_mismatch"; reason: string } {
  // Format: data:<mime>;base64,<payload>
  const match = args.dataUrl.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
  if (!match) return { ok: false, stage: "decode", reason: "Empty-room result was not a valid data URL." };
  const mime = match[1].trim().toLowerCase();
  const isBase64 = Boolean(match[2]);
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    return { ok: false, stage: "decode", reason: "Empty-room result type is not supported (allowed: jpeg, png, webp)." };
  }
  if (!isBase64) return { ok: false, stage: "decode", reason: "Empty-room data URL was not base64-encoded." };
  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[3], "base64");
  } catch {
    return { ok: false, stage: "decode", reason: "Empty-room data URL could not be decoded." };
  }
  if (buffer.byteLength === 0) return { ok: false, stage: "decode", reason: "Empty-room result was empty." };
  if (buffer.byteLength > args.maxBytes) return { ok: false, stage: "decode", reason: "Empty-room result is too large." };
  const detectedMime = detectEmptyRoomImageMime(buffer);
  if (!detectedMime) {
    return { ok: false, stage: "decode", reason: "Empty-room result type is not supported (allowed: jpeg, png, webp)." };
  }
  if (detectedMime !== mime) {
    return { ok: false, stage: "mime_mismatch", reason: "Empty-room result MIME did not match the image bytes." };
  }
  return {
    ok: true,
    image: {
      base64: buffer.toString("base64"),
      mime,
      byteCount: buffer.byteLength,
      provenance: {
        generatorId: EMPTY_ROOM_ASSIST_GENERATOR_ID,
        requestedModelId: EMPTY_ROOM_ASSIST_REQUESTED_MODEL_ID,
        // The compositor reports no resolved provider model identity.
        resolvedModelId: null,
        resolvedModelStatus: "not_reported_by_compositor",
        appliedAspectRatio: args.appliedAspectRatio,
        imageTransport: "data_url",
        generatedAt: new Date().toISOString(),
      },
    },
  };
}

export type GenerateEmptyRoomArgs = {
  // SHA-256 hex of the verified ORIGINAL bytes; the transient cache key.
  originalHash: string;
  // Public/signed URL of the original image (the compositor fetches this).
  baseImageUrl: string;
  // For fetching an http(s) empty-room RESULT url, reusing the shared SSRF fetch.
  resultAllowedHosts: string[];
  maxBytes: number;
  fetchTimeoutMs: number;
  allowLocalhostHttp: boolean;
  generationTimeoutMs: number;
};

/**
 * Returns a cached empty-room image for `originalHash`, or generates one via the
 * compositor (no charge / no persistence) on a cache miss. Never throws; returns
 * a safe discriminated result. Upstream error details are never propagated.
 */
export async function getOrGenerateEmptyRoomImage(
  args: GenerateEmptyRoomArgs
): Promise<EmptyRoomAssistGenerateResult> {
  const cached = emptyRoomCache.get(args.originalHash);
  if (cached) {
    return { ok: true, cacheStatus: "hit", image: cached };
  }

  if (!process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim()) {
    return {
      ok: false,
      cacheStatus: "unavailable",
      stage: "config",
      reason: "Empty-room generation is not configured on the server.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.generationTimeoutMs);
  let imageUrl: string;
  let appliedAspectRatio: string | null = null;
  try {
    const body = {
      stage: 1 as const,
      stage1Mode: "empty_room" as const,
      emptyRoom: true,
      baseImageUrl: args.baseImageUrl,
      modelVersion: EMPTY_ROOM_ASSIST_REQUESTED_MODEL_ID,
      aspectRatio: "auto" as const,
    };
    const generation = await callCompositorVibodeStageRun({
      // Minimal empty-room request. No vibodeRoomId / room state is sent, so the
      // compositor cannot tie this to a persisted room version. Our side does no
      // charging/persistence regardless.
      payload: body,
      signal: controller.signal,
    });
    imageUrl = generation.imageUrl;
    appliedAspectRatio = sanitizeEmptyRoomAppliedAspectRatio(generation.appliedAspectRatio);
  } catch (error) {
    const safe422 = extractSafeCompositor422Message(error);
    return {
      ok: false,
      cacheStatus: "miss",
      stage: "generate",
      reason: safe422 ?? "Empty-room generation failed.",
    };
  } finally {
    clearTimeout(timeout);
  }

  // The compositor may return either a data: URL (bytes inline) or an http(s)
  // URL. Both paths are size/MIME constrained.
  if (imageUrl.startsWith("data:")) {
    const decoded = decodeDataUrlImage({
      dataUrl: imageUrl,
      maxBytes: args.maxBytes,
      appliedAspectRatio,
    });
    if (!decoded.ok) {
      return { ok: false, cacheStatus: "miss", stage: decoded.stage, reason: decoded.reason };
    }
    const cached = cacheSet(args.originalHash, decoded.image);
    return { ok: true, cacheStatus: "miss", image: cached };
  }

  const fetched = await fetchRoomImageSafely(imageUrl, {
    allowedHosts: args.resultAllowedHosts,
    maxBytes: args.maxBytes,
    timeoutMs: args.fetchTimeoutMs,
    allowLocalhostHttp: args.allowLocalhostHttp,
  });
  if (!fetched.ok) {
    return { ok: false, cacheStatus: "miss", stage: "fetch_result", reason: fetched.reason };
  }
  const detectedMime = detectEmptyRoomImageMime(fetched.buffer);
  if (!detectedMime) {
    return {
      ok: false,
      cacheStatus: "miss",
      stage: "decode",
      reason: "Empty-room result type is not supported (allowed: jpeg, png, webp).",
    };
  }
  if (detectedMime !== fetched.mime) {
    return {
      ok: false,
      cacheStatus: "miss",
      stage: "mime_mismatch",
      reason: "Empty-room result MIME did not match the image bytes.",
    };
  }

  const image: EmptyRoomImageBytes = {
    base64: fetched.base64,
    mime: fetched.mime,
    byteCount: fetched.byteCount,
    provenance: {
      generatorId: EMPTY_ROOM_ASSIST_GENERATOR_ID,
      requestedModelId: EMPTY_ROOM_ASSIST_REQUESTED_MODEL_ID,
      // The compositor reports no resolved provider model identity.
      resolvedModelId: null,
      resolvedModelStatus: "not_reported_by_compositor",
      appliedAspectRatio,
      imageTransport: "http_url",
      generatedAt: new Date().toISOString(),
    },
  };
  const cachedImage = cacheSet(args.originalHash, image);
  return { ok: true, cacheStatus: "miss", image: cachedImage };
}
