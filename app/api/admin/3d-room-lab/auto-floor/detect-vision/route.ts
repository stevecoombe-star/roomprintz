import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import {
  getAutoFloorVisionAllowedImageHosts,
  getAutoFloorVisionApiKey,
  isAutoFloorVisionAllowLocalhostHttp,
  getAutoFloorVisionGeminiTimeoutMs,
  getAutoFloorVisionImageFetchTimeoutMs,
  getAutoFloorVisionImageMaxBytes,
  getAutoFloorVisionModel,
  isAutoFloorVisionDebugLog,
  isAutoFloorVisionEnabled,
} from "@/lib/vibodeAutoFloorVisionConfig";
import {
  callGeminiAutoFloorDetection,
  classifyGeminiAutoFloorFailure,
} from "@/lib/vibodeGeminiAutoFloorDetection";
import { getRequestIdFromHeaders } from "@/lib/vibodeGeminiUsageAccounting";
import {
  AUTO_FLOOR_VISION_RESPONSE_SCHEMA,
  DEFAULT_AUTO_FLOOR_VISION_CONFIG,
  buildAutoFloorVisionPrompt,
  mapSourceNormalizedRawVisionResponseToDetectionResult,
} from "@/app/admin/3d-room-lab/auto-floor-vision-provider-scaffold";
import type { AutoFloorDetectionResult } from "@/app/admin/3d-room-lab/auto-floor-detection";

// --- Phase 2F-F: lab-only, flag-gated REAL Gemini vision floor route ---------
// POST /api/admin/3d-room-lab/auto-floor/detect-vision
//
// Hard gates (fail closed on every error):
// - authenticated admin only
// - AUTO_FLOOR_VISION_ENABLED must be truthy (server-only)
// - server-only Gemini key required
// - SSRF-hardened, URL-first image fetch (https + allowlist + private-IP block +
//   MIME allowlist + max bytes + controlled redirects + fetch timeout)
//
// Flow: image bytes -> Gemini (intrinsic-source-normalized coords) ->
// non-clamping source->container conversion -> Phase 2F-B validator/mapper ->
// AutoFloorDetectionResult. The mapper remains the sole validation authority.

export const runtime = "nodejs";

const VISION_ROUTE = "/api/admin/3d-room-lab/auto-floor/detect-vision";
const MAX_CANDIDATES = 3;
const DEFAULT_FLOOR_RECT = { widthMeters: 4, depthMeters: 4 };
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// Logs ONLY derived/sanitized metadata. Never logs API keys, image bytes/base64,
// full image URLs/query strings, prompts, or raw model responses.
function logVisionFailure(fields: Record<string, unknown>): void {
  console.warn("[auto-floor-vision] failure", fields);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseSize(value: unknown): { width: number; height: number } | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.width) || !isFiniteNumber(value.height)) return null;
  if (value.width <= 0 || value.height <= 0) return null;
  return { width: value.width, height: value.height };
}

function parseFloorRect(value: unknown): { widthMeters: number; depthMeters: number } {
  if (!isRecord(value)) return DEFAULT_FLOOR_RECT;
  if (!isFiniteNumber(value.widthMeters) || !isFiniteNumber(value.depthMeters)) return DEFAULT_FLOOR_RECT;
  if (value.widthMeters <= 0 || value.depthMeters <= 0) return DEFAULT_FLOOR_RECT;
  return { widthMeters: value.widthMeters, depthMeters: value.depthMeters };
}

function failed(reason: string): AutoFloorDetectionResult {
  return {
    status: "failed",
    candidates: [],
    selectedCandidateId: null,
    notes: [],
    failureReasons: [reason],
  };
}

// ---------------------------------------------------------------------------
// SSRF-safe image fetch
// ---------------------------------------------------------------------------

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return true; // malformed → block
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
  if (a === 192 && b === 168) return true; // 192.168/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  if (lower.startsWith("fe80")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local fc00::/7
  // IPv4-mapped IPv6 (::ffff:a.b.c.d)
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  return false;
}

function isBlockedAddress(ip: string, family: number): boolean {
  return family === 6 ? isBlockedIpv6(ip) : isBlockedIpv4(ip);
}

async function hostResolvesToBlockedAddress(hostname: string): Promise<boolean> {
  try {
    const results = await lookup(hostname, { all: true });
    if (!results || results.length === 0) return true;
    return results.some((r) => isBlockedAddress(r.address, r.family));
  } catch {
    return true; // unresolvable → block
  }
}

type SafeImageResult =
  | { ok: true; base64: string; buffer: Buffer; mime: string; byteCount: number; host: string }
  | { ok: false; reason: string };

function isAllowedDevLocalhostHttpUrl(url: URL): boolean {
  if (!isAutoFloorVisionAllowLocalhostHttp()) return false;
  if (url.protocol !== "http:") return false;
  if (url.port !== "3000") return false;
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

async function validateImageUrl(
  rawUrl: string,
  allowedHosts: string[]
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Invalid image URL." };
  }
  const devLocalhostHttp = isAllowedDevLocalhostHttpUrl(url);
  if (url.protocol !== "https:" && !devLocalhostHttp) {
    return { ok: false, reason: "Only https image URLs are supported." };
  }
  const host = url.hostname.toLowerCase();
  if (!devLocalhostHttp && !allowedHosts.includes(host)) {
    return { ok: false, reason: "Image host is not allowed." };
  }
  // Preserve private/link-local/loopback blocking for all normal URLs.
  // Narrow exception: explicit dev-only localhost HTTP:3000 flow above.
  if (!devLocalhostHttp && (await hostResolvesToBlockedAddress(host))) {
    return { ok: false, reason: "Image host resolves to a blocked address." };
  }
  return { ok: true, url };
}

async function fetchRoomImageSafely(
  rawUrl: string,
  opts: { allowedHosts: string[]; maxBytes: number; timeoutMs: number }
): Promise<SafeImageResult> {
  const firstCheck = await validateImageUrl(rawUrl, opts.allowedHosts);
  if (!firstCheck.ok) return { ok: false, reason: firstCheck.reason };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    let response = await fetch(firstCheck.url.toString(), {
      redirect: "manual",
      signal: controller.signal,
    });

    // Controlled single redirect with full re-validation.
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return { ok: false, reason: "Image redirect was missing a location." };
      const redirectUrl = new URL(location, firstCheck.url).toString();
      const secondCheck = await validateImageUrl(redirectUrl, opts.allowedHosts);
      if (!secondCheck.ok) return { ok: false, reason: `Blocked image redirect: ${secondCheck.reason}` };
      response = await fetch(secondCheck.url.toString(), {
        redirect: "error",
        signal: controller.signal,
      });
    }

    if (!response.ok) {
      return { ok: false, reason: `Image fetch failed (HTTP ${response.status}).` };
    }

    const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_IMAGE_MIME.has(mime)) {
      return { ok: false, reason: "Unsupported image type (allowed: jpeg, png, webp)." };
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > opts.maxBytes) {
      return { ok: false, reason: "Image is too large." };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0) {
      return { ok: false, reason: "Image was empty." };
    }
    if (buffer.byteLength > opts.maxBytes) {
      return { ok: false, reason: "Image is too large." };
    }

    return {
      ok: true,
      base64: buffer.toString("base64"),
      buffer,
      mime,
      byteCount: buffer.byteLength,
      host: firstCheck.url.hostname.toLowerCase(),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { ok: false, reason: "Image fetch timed out." };
    }
    return { ok: false, reason: "Image could not be fetched." };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Decoded-dimension + EXIF verification (Phase 2F-F1)
// ---------------------------------------------------------------------------
// Reads metadata from the already-fetched in-memory buffer ONLY. Does not
// resize/crop/rotate/strip — the exact original bytes are still sent to Gemini.
// sharp's metadata().width/height are the stored (pre-rotation) decoded pixel
// dimensions, which must match the client's intrinsic dimensions for the
// source->container conversion to describe the same coordinate system.

type ImageMetaResult =
  | { ok: true; width: number; height: number; orientation: number }
  | { ok: false; reason: string };

async function inspectImageMetadata(buffer: Buffer): Promise<ImageMetaResult> {
  try {
    const sharp = await import("sharp");
    const meta = await sharp.default(buffer).metadata();
    const width = meta.width;
    const height = meta.height;
    if (typeof width !== "number" || typeof height !== "number" || width <= 0 || height <= 0) {
      return { ok: false, reason: "Room image could not be decoded for vision calibration." };
    }
    // sharp omits `orientation` when there is no EXIF orientation tag; treat
    // absent as normal (1).
    const orientation = typeof meta.orientation === "number" ? meta.orientation : 1;
    return { ok: true, width, height, orientation };
  } catch {
    return { ok: false, reason: "Room image could not be decoded for vision calibration." };
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const startedAt = Date.now();

  const adminUser = await getAuthenticatedAdminUser();
  if (!adminUser) {
    return NextResponse.json(failed("Admin access required."), { status: 403 });
  }

  if (!isAutoFloorVisionEnabled()) {
    return NextResponse.json(
      failed("Gemini vision floor detection is disabled on the server."),
      { status: 200 }
    );
  }

  const apiKey = getAutoFloorVisionApiKey();
  if (!apiKey) {
    return NextResponse.json(failed("Server is not configured with a Gemini API key."), { status: 200 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(failed("Request body was not valid JSON."), { status: 200 });
  }

  const record = isRecord(body) ? body : {};
  const requestId = getRequestIdFromHeaders(request.headers, "auto-floor-vision");
  const imageUrl = safeStr(record.imageUrl);
  const frameSize = parseSize(record.frameSize);
  // Accept either intrinsicSize or sourceSize for the original-image dimensions.
  const intrinsicSize = parseSize(record.intrinsicSize) ?? parseSize(record.sourceSize);
  const floorRect = parseFloorRect(record.floorRect);

  if (!frameSize) {
    return NextResponse.json(failed("Missing or invalid frame size."), { status: 200 });
  }
  if (!intrinsicSize) {
    return NextResponse.json(failed("Missing or invalid intrinsic/source image size."), { status: 200 });
  }
  if (!imageUrl) {
    return NextResponse.json(failed("Missing image URL."), { status: 200 });
  }
  if (imageUrl.startsWith("data:") || imageUrl.startsWith("blob:")) {
    // The lab is URL-only today; data/blob inputs are not supported this phase.
    return NextResponse.json(
      failed("Inline (data/blob) images are not supported by the vision route."),
      { status: 200 }
    );
  }

  const image = await fetchRoomImageSafely(imageUrl, {
    allowedHosts: getAutoFloorVisionAllowedImageHosts(),
    maxBytes: getAutoFloorVisionImageMaxBytes(),
    timeoutMs: getAutoFloorVisionImageFetchTimeoutMs(),
  });
  if (!image.ok) {
    logVisionFailure({ requestId, route: VISION_ROUTE, stage: "fetch", reason: image.reason });
    return NextResponse.json(failed(image.reason), { status: 200 });
  }

  // Phase 2F-F1: verify the decoded bytes describe the same coordinate system as
  // the client intrinsicSize used for source->container conversion. The exact
  // original bytes are still what Gemini receives (image.base64 is unchanged).
  const meta = await inspectImageMetadata(image.buffer);
  if (!meta.ok) {
    logVisionFailure({ requestId, route: VISION_ROUTE, stage: "image_verify", reason: "decode_failed" });
    return NextResponse.json(failed(meta.reason), { status: 200 });
  }
  if (meta.orientation !== 1) {
    // No partial orientation handling: fail closed rather than risk coordinate
    // drift between Gemini's view and the lab's container space.
    logVisionFailure({
      requestId,
      route: VISION_ROUTE,
      stage: "image_verify",
      reason: "non_normal_orientation",
      orientation: meta.orientation,
    });
    return NextResponse.json(
      failed("This image orientation is not yet supported for vision calibration."),
      { status: 200 }
    );
  }
  if (meta.width !== intrinsicSize.width || meta.height !== intrinsicSize.height) {
    logVisionFailure({ requestId, route: VISION_ROUTE, stage: "image_verify", reason: "dimension_mismatch" });
    return NextResponse.json(
      failed("Room image dimensions changed before vision calibration could run."),
      { status: 200 }
    );
  }

  // Verified decoded dimensions drive the source->container conversion.
  const verifiedSourceSize = { width: meta.width, height: meta.height };

  const model = getAutoFloorVisionModel();
  const prompt = buildAutoFloorVisionPrompt({
    frameSize,
    intrinsicSize,
    // Manual polygon hint intentionally omitted this phase: it is in container
    // space and converting it to source space safely is deferred (avoids
    // coordinate-space corruption / echoing).
    maxCandidates: MAX_CANDIDATES,
  });

  let raw: unknown;
  try {
    const call = await callGeminiAutoFloorDetection({
      apiKey,
      model,
      prompt,
      responseSchema: AUTO_FLOOR_VISION_RESPONSE_SCHEMA,
      imageBase64: image.base64,
      mime: image.mime,
      temperature: DEFAULT_AUTO_FLOOR_VISION_CONFIG.temperature,
      maxOutputTokens: DEFAULT_AUTO_FLOOR_VISION_CONFIG.maxOutputTokens,
      timeoutMs: getAutoFloorVisionGeminiTimeoutMs(),
      accounting: {
        requestId,
        route: VISION_ROUTE,
        userId: adminUser.id ?? null,
      },
    });
    raw = call.raw;
  } catch (error) {
    const info = classifyGeminiAutoFloorFailure(error);
    logVisionFailure({
      requestId,
      route: VISION_ROUTE,
      model,
      latencyMs: Date.now() - startedAt,
      stage: info.stage,
      code: info.code,
      httpStatus: info.httpStatus,
      upstreamStatus: info.upstreamStatus,
      upstreamMessage: info.sanitizedMessage,
      imageMime: image.mime,
      imageBytes: image.byteCount,
      schemaSent: true,
    });
    return NextResponse.json(failed(info.uiReason), { status: 200 });
  }

  let result: AutoFloorDetectionResult;
  try {
    result = mapSourceNormalizedRawVisionResponseToDetectionResult(raw, {
      sourceSize: verifiedSourceSize,
      containerSize: frameSize,
      floorRect,
      maxCandidates: MAX_CANDIDATES,
    });
  } catch (error) {
    logVisionFailure({
      requestId,
      route: VISION_ROUTE,
      model,
      latencyMs: Date.now() - startedAt,
      stage: "phase_2fb_mapping",
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(failed("Failed to process vision response."), { status: 200 });
  }

  if (result.status === "failed") {
    // Covers source-to-container conversion failures and "no valid candidate"
    // outcomes surfaced by the Phase 2F-B mapper (its reasons are already safe).
    logVisionFailure({
      requestId,
      route: VISION_ROUTE,
      model,
      latencyMs: Date.now() - startedAt,
      stage: "phase_2fb_mapping",
      candidateCount: result.candidates.length,
      failureReasons: result.failureReasons,
    });
  }

  const selected = result.candidates.find((c) => c.id === result.selectedCandidateId) ?? null;
  console.log("[auto-floor-vision] completed", {
    requestId,
    model,
    latencyMs: Date.now() - startedAt,
    imageHost: image.host,
    imageMime: image.mime,
    imageBytes: image.byteCount,
    candidateCount: result.candidates.length,
    status: result.status,
    selectedConfidence: selected?.confidence ?? null,
    selectedScore: selected?.confidenceScore ?? null,
  });
  if (isAutoFloorVisionDebugLog()) {
    console.log("[auto-floor-vision] debug raw type", {
      requestId,
      rawType: typeof raw,
      hasCandidates: isRecord(raw) && Array.isArray((raw as Record<string, unknown>).candidates),
    });
  }

  return NextResponse.json(result, { status: 200 });
}
