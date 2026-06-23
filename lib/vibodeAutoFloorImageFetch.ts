import "server-only";

import { lookup } from "node:dns/promises";

// --- Phase 2H-B: shared SSRF-safe image fetch + decoded-metadata verification -
// Factored out of the Phase 2F-F vision route VERBATIM so both the direct
// detection route and the lab-only empty-room-assist route share ONE hardened
// implementation (no weakening, no divergence). Behavior is intentionally
// identical to the original inline route code; only the dev-localhost allowance
// is parameterized (callers pass the server-only flag) so this module stays
// free of feature-flag coupling.

export const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export type SafeImageResult =
  | { ok: true; base64: string; buffer: Buffer; mime: string; byteCount: number; host: string }
  | { ok: false; reason: string };

export type ImageMetaResult =
  | { ok: true; width: number; height: number; orientation: number }
  | { ok: false; reason: string };

export type FetchRoomImageOptions = {
  allowedHosts: string[];
  maxBytes: number;
  timeoutMs: number;
  // Dev-only narrow allowance for http://localhost:3000 (the caller resolves the
  // server-only flag). Never widen this.
  allowLocalhostHttp: boolean;
};

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

function isAllowedDevLocalhostHttpUrl(url: URL, allowLocalhostHttp: boolean): boolean {
  if (!allowLocalhostHttp) return false;
  if (url.protocol !== "http:") return false;
  if (url.port !== "3000") return false;
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export async function validateImageUrl(
  rawUrl: string,
  allowedHosts: string[],
  allowLocalhostHttp: boolean
): Promise<{ ok: true; url: URL } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Invalid image URL." };
  }
  const devLocalhostHttp = isAllowedDevLocalhostHttpUrl(url, allowLocalhostHttp);
  if (url.protocol !== "https:" && !devLocalhostHttp) {
    return { ok: false, reason: "Only https image URLs are supported." };
  }
  const host = url.hostname.toLowerCase();
  if (!devLocalhostHttp && !allowedHosts.includes(host)) {
    return { ok: false, reason: "Image host is not allowed." };
  }
  if (!devLocalhostHttp && (await hostResolvesToBlockedAddress(host))) {
    return { ok: false, reason: "Image host resolves to a blocked address." };
  }
  return { ok: true, url };
}

export async function fetchRoomImageSafely(
  rawUrl: string,
  opts: FetchRoomImageOptions
): Promise<SafeImageResult> {
  const firstCheck = await validateImageUrl(rawUrl, opts.allowedHosts, opts.allowLocalhostHttp);
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
      const secondCheck = await validateImageUrl(redirectUrl, opts.allowedHosts, opts.allowLocalhostHttp);
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

// Reads metadata from the already-fetched in-memory buffer ONLY. Does not
// resize/crop/rotate/strip — the exact original bytes are still what Gemini
// receives. sharp's metadata().width/height are the stored (pre-rotation)
// decoded pixel dimensions.
export async function inspectImageMetadata(buffer: Buffer): Promise<ImageMetaResult> {
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
