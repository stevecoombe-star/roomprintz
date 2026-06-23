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

export type EmptyRoomImageBytes = {
  base64: string;
  mime: string;
  byteCount: number;
};

export type EmptyRoomCacheStatus = "hit" | "miss" | "unavailable" | "not_used";

export type EmptyRoomAssistGenerateResult =
  | { ok: true; cacheStatus: "hit" | "miss"; image: EmptyRoomImageBytes }
  | {
      ok: false;
      cacheStatus: "miss" | "unavailable";
      // Safe, generic stage label only — never raw upstream text.
      stage: "config" | "generate" | "fetch_result" | "decode";
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

function cacheSet(hash: string, image: EmptyRoomImageBytes): void {
  if (emptyRoomCache.has(hash)) emptyRoomCache.delete(hash);
  emptyRoomCache.set(hash, image);
  while (emptyRoomCache.size > MAX_CACHE_ENTRIES) {
    const oldest = emptyRoomCache.keys().next().value;
    if (oldest === undefined) break;
    emptyRoomCache.delete(oldest);
  }
}

export function getCachedEmptyRoomImage(originalHash: string): EmptyRoomImageBytes | null {
  return emptyRoomCache.get(originalHash) ?? null;
}

function decodeDataUrlImage(
  dataUrl: string,
  maxBytes: number
): { ok: true; image: EmptyRoomImageBytes } | { ok: false; reason: string } {
  // Format: data:<mime>;base64,<payload>
  const match = dataUrl.match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/);
  if (!match) return { ok: false, reason: "Empty-room result was not a valid data URL." };
  const mime = match[1].trim().toLowerCase();
  const isBase64 = Boolean(match[2]);
  if (!ALLOWED_IMAGE_MIME.has(mime)) {
    return { ok: false, reason: "Empty-room result type is not supported (allowed: jpeg, png, webp)." };
  }
  if (!isBase64) return { ok: false, reason: "Empty-room data URL was not base64-encoded." };
  let buffer: Buffer;
  try {
    buffer = Buffer.from(match[3], "base64");
  } catch {
    return { ok: false, reason: "Empty-room data URL could not be decoded." };
  }
  if (buffer.byteLength === 0) return { ok: false, reason: "Empty-room result was empty." };
  if (buffer.byteLength > maxBytes) return { ok: false, reason: "Empty-room result is too large." };
  return {
    ok: true,
    image: { base64: buffer.toString("base64"), mime, byteCount: buffer.byteLength },
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
  try {
    const body = {
      stage: 1 as const,
      stage1Mode: "empty_room" as const,
      emptyRoom: true,
      baseImageUrl: args.baseImageUrl,
      modelVersion: "NBP",
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
    const decoded = decodeDataUrlImage(imageUrl, args.maxBytes);
    if (!decoded.ok) {
      return { ok: false, cacheStatus: "miss", stage: "decode", reason: decoded.reason };
    }
    cacheSet(args.originalHash, decoded.image);
    return { ok: true, cacheStatus: "miss", image: decoded.image };
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

  const image: EmptyRoomImageBytes = {
    base64: fetched.base64,
    mime: fetched.mime,
    byteCount: fetched.byteCount,
  };
  cacheSet(args.originalHash, image);
  return { ok: true, cacheStatus: "miss", image };
}
