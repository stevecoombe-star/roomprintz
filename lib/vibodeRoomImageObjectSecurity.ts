/**
 * Server-side guards for the paid room-image-objects provider path.
 *
 * Room uploads are compressed to 3.25 MiB before storage
 * (MAX_OUTPUT_BYTES in lib/prepareRoomImageForUpload.ts). 8 MiB covers that
 * output, HEIC-normalized JPEGs, and typical generation stills, and it rejects
 * the 25 MiB raw input ceiling. The paid route never fetches a caller URL.
 */

export const MAX_ROOM_IMAGE_READ_BYTES = 8 * 1024 * 1024;

export const ROOM_IMAGE_READ_BUCKETS = ["vibode-base-images", "vibode-generations"] as const;

export type RoomImageReadBucket = (typeof ROOM_IMAGE_READ_BUCKETS)[number];

export type RoomImageMime = "image/jpeg" | "image/png" | "image/webp";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STORAGE_OBJECT_MODES = new Set(["public", "sign", "authenticated"]);

export type OwnedStorageLocation = {
  bucket: RoomImageReadBucket;
  objectPath: string;
};

export type RoomImageDetection =
  | { ok: true; mime: RoomImageMime }
  | { ok: false; reason: "too_large" | "empty" | "unsupported" | "corrupt" | "mime_mismatch" };

export type ReservationDecision =
  | { status: "reserved"; attemptId: string }
  | { status: "busy" }
  | { status: "quota" }
  | { status: "forbidden" }
  | { status: "invalid" }
  | { status: "unavailable" };

export type StorageDownloadResult =
  | { ok: true; bytes: Uint8Array; contentType: string | null }
  | { ok: false; reason: "too_large" | "empty" | "invalid" | "not_found" | "redirect" | "unavailable" };

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function isRoomImageReadBucket(value: string): value is RoomImageReadBucket {
  return (ROOM_IMAGE_READ_BUCKETS as readonly string[]).includes(value);
}

export function isSafeOwnedStoragePath(objectPath: string, userId: string, roomId: string): boolean {
  if (!isUuid(userId) || !isUuid(roomId)) return false;
  if (!objectPath || objectPath.length > 512) return false;
  if (objectPath.includes("\\") || objectPath.includes("\0")) return false;
  if (objectPath.startsWith("/") || objectPath.endsWith("/")) return false;
  if (objectPath.includes("//")) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(objectPath)) return false;
  let decoded = objectPath;
  try {
    decoded = decodeURIComponent(objectPath);
  } catch {
    return false;
  }
  if (decoded !== objectPath) return false;
  if (decoded.includes("..") || decoded.includes("\\") || decoded.includes("\0")) return false;
  if (!/^[a-zA-Z0-9._/-]+$/.test(decoded)) return false;
  const segments = decoded.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return false;
  const names = new Set(segments.map((segment) => segment.toLowerCase()));
  return names.has(userId.toLowerCase()) || names.has(roomId.toLowerCase());
}

function blank(value: string | null | undefined): boolean {
  return typeof value !== "string" || value.trim().length === 0;
}

function normalizeBucket(value: string | null | undefined): RoomImageReadBucket | null {
  if (blank(value)) return null;
  const bucket = value!.trim();
  return isRoomImageReadBucket(bucket) ? bucket : null;
}

export function resolveOwnedRoomImageLocation(args: {
  userId: string;
  roomId: string;
  storageBucket: string | null;
  storagePath: string | null;
  imageUrl: string | null;
  supabaseUrl: string;
}): OwnedStorageLocation | null {
  const storedBucketRaw = blank(args.storageBucket) ? null : args.storageBucket!.trim();
  const storedPath = blank(args.storagePath) ? null : args.storagePath!.trim();
  const storedBucket = normalizeBucket(storedBucketRaw);

  if (storedBucketRaw && !storedBucket) return null;

  if (storedPath) {
    if (!storedBucket) {
      const recovered = recoverLocationFromOwnedImageUrl(args);
      if (!recovered) return null;
      if (recovered.objectPath !== storedPath) return null;
      return recovered;
    }
    if (!isSafeOwnedStoragePath(storedPath, args.userId, args.roomId)) return null;
    return { bucket: storedBucket, objectPath: storedPath };
  }

  const recovered = recoverLocationFromOwnedImageUrl(args);
  if (!recovered) return null;
  if (storedBucket && recovered.bucket !== storedBucket) return null;
  return recovered;
}

function recoverLocationFromOwnedImageUrl(args: {
  userId: string;
  roomId: string;
  imageUrl: string | null;
  supabaseUrl: string;
}): OwnedStorageLocation | null {
  if (blank(args.imageUrl) || blank(args.supabaseUrl)) return null;
  let configured: URL;
  let candidate: URL;
  try {
    configured = new URL(args.supabaseUrl);
    candidate = new URL(args.imageUrl!);
  } catch {
    return null;
  }
  if (candidate.username || candidate.password) return null;
  if (candidate.protocol !== configured.protocol) return null;
  if (candidate.host !== configured.host) return null;
  if (candidate.protocol !== "https:" && candidate.protocol !== "http:") return null;

  const marker = "/storage/v1/object/";
  const markerAt = candidate.pathname.indexOf(marker);
  if (markerAt < 0) return null;
  const rest = candidate.pathname.slice(markerAt + marker.length);
  const parts = rest.split("/").filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  let bucketIndex = 0;
  if (STORAGE_OBJECT_MODES.has(parts[0] ?? "")) {
    bucketIndex = 1;
  } else {
    return null;
  }
  const bucketPart = parts[bucketIndex];
  const pathParts = parts.slice(bucketIndex + 1);
  if (!bucketPart || pathParts.length === 0) return null;
  let bucket = "";
  let objectPath = "";
  try {
    bucket = decodeURIComponent(bucketPart);
    objectPath = pathParts.map((part) => decodeURIComponent(part)).join("/");
  } catch {
    return null;
  }
  if (!isRoomImageReadBucket(bucket)) return null;
  if (!isSafeOwnedStoragePath(objectPath, args.userId, args.roomId)) return null;
  return { bucket, objectPath };
}

function normalizeDeclaredMime(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const mime = value.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mime) return null;
  if (mime === "image/jpg") return "image/jpeg";
  return mime;
}

function matchesJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 32) return false;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false;
  for (let index = 4; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] === 0xd9) return true;
  }
  return false;
}

function matchesPng(bytes: Uint8Array): boolean {
  if (bytes.length < 32) return false;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) return false;
  }
  if (asciiAt(bytes, 12, "IHDR") === false) return false;
  return indexOfAscii(bytes, "IEND") >= 0;
}

function matchesWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  if (!asciiAt(bytes, 0, "RIFF") || !asciiAt(bytes, 8, "WEBP")) return false;
  const size = readUint32LE(bytes, 4);
  if (size !== bytes.length - 8) return false;
  const fourcc = asciiSlice(bytes, 12, 4);
  return fourcc === "VP8 " || fourcc === "VP8L" || fourcc === "VP8X";
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  return asciiSlice(bytes, offset, value.length) === value;
}

function asciiSlice(bytes: Uint8Array, offset: number, length: number): string | null {
  if (offset < 0 || offset + length > bytes.length) return null;
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return out;
}

function indexOfAscii(bytes: Uint8Array, value: string): number {
  const needle = value.split("").map((char) => char.charCodeAt(0));
  for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    let matched = true;
    for (let inner = 0; inner < needle.length; inner += 1) {
      if (bytes[index + inner] !== needle[inner]) {
        matched = false;
        break;
      }
    }
    if (matched) return index;
  }
  return -1;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) |
    ((bytes[offset + 1] ?? 0) << 8) |
    ((bytes[offset + 2] ?? 0) << 16) |
    ((bytes[offset + 3] ?? 0) << 24)
  ) >>> 0;
}

export function detectRoomImage(bytes: Uint8Array, contentType: string | null | undefined): RoomImageDetection {
  if (bytes.byteLength === 0) return { ok: false, reason: "empty" };
  if (bytes.byteLength > MAX_ROOM_IMAGE_READ_BYTES) return { ok: false, reason: "too_large" };
  const detected = matchesJpeg(bytes)
    ? "image/jpeg"
    : matchesPng(bytes)
      ? "image/png"
      : matchesWebp(bytes)
        ? "image/webp"
        : null;
  if (!detected) {
    const declared = normalizeDeclaredMime(contentType);
    if (declared === "image/jpeg" || declared === "image/png" || declared === "image/webp") {
      return { ok: false, reason: "corrupt" };
    }
    return { ok: false, reason: "unsupported" };
  }
  const declared = normalizeDeclaredMime(contentType);
  if (
    declared &&
    declared !== "application/octet-stream" &&
    declared !== "binary/octet-stream" &&
    declared !== detected
  ) {
    return { ok: false, reason: "mime_mismatch" };
  }
  return { ok: true, mime: detected };
}

export type CompletionDecision =
  | { status: "completed"; attemptId: string; outcome: "succeeded" | "failed" }
  | { status: "already_terminal"; attemptId: string; outcome: "succeeded" | "failed" | "timed_out" }
  | { status: "forbidden" }
  | { status: "invalid" }
  | { status: "unavailable" };

export function parseRoomImageReadCompletion(value: unknown): CompletionDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "unavailable" };
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string") return { status: "unavailable" };
  if (record.ok === true) {
    if (typeof record.attemptId !== "string" || !isUuid(record.attemptId)) return { status: "unavailable" };
    if (record.code === "completed") {
      if (record.outcome !== "succeeded" && record.outcome !== "failed") return { status: "unavailable" };
      return { status: "completed", attemptId: record.attemptId, outcome: record.outcome };
    }
    if (record.code === "already_terminal") {
      if (record.outcome !== "succeeded" && record.outcome !== "failed" && record.outcome !== "timed_out") {
        return { status: "unavailable" };
      }
      return { status: "already_terminal", attemptId: record.attemptId, outcome: record.outcome };
    }
    return { status: "unavailable" };
  }
  if (record.ok !== false) return { status: "unavailable" };
  if (record.attemptId !== null) return { status: "unavailable" };
  if (record.code === "forbidden") return { status: "forbidden" };
  if (record.code === "invalid") return { status: "invalid" };
  return { status: "unavailable" };
}

export function parseRoomImageReadReservation(value: unknown): ReservationDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { status: "unavailable" };
  const record = value as Record<string, unknown>;
  if (typeof record.code !== "string") return { status: "unavailable" };
  if (record.ok === true) {
    if (record.code !== "reserved") return { status: "unavailable" };
    if (typeof record.attemptId !== "string" || !isUuid(record.attemptId)) return { status: "unavailable" };
    return { status: "reserved", attemptId: record.attemptId };
  }
  if (record.ok !== false) return { status: "unavailable" };
  if (record.attemptId !== null) return { status: "unavailable" };
  if (record.code === "busy") return { status: "busy" };
  if (record.code === "user_quota" || record.code === "global_quota") return { status: "quota" };
  if (record.code === "forbidden") return { status: "forbidden" };
  if (record.code === "invalid") return { status: "invalid" };
  return { status: "unavailable" };
}

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: "too_large" | "empty" | "failed" }> {
  if (!body) return { ok: false, reason: "empty" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const step = await reader.read();
      if (step.done) break;
      const value = step.value;
      if (!value || value.byteLength === 0) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "failed" };
  }
  if (total === 0) return { ok: false, reason: "empty" };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

function contentLength(value: string | null): number | null {
  if (!value || !/^[0-9]+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function discardResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

export function buildSupabaseStorageObjectUrl(args: {
  supabaseUrl: string;
  bucket: string;
  objectPath: string;
}): URL | null {
  if (!isRoomImageReadBucket(args.bucket)) return null;
  let configured: URL;
  try {
    configured = new URL(args.supabaseUrl);
  } catch {
    return null;
  }
  if (configured.username || configured.password) return null;
  if (configured.protocol !== "https:" && configured.protocol !== "http:") return null;
  const encodedPath = args.objectPath.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  const url = new URL(
    `/storage/v1/object/${encodeURIComponent(args.bucket)}/${encodedPath}`,
    configured.origin,
  );
  if (url.origin !== configured.origin) return null;
  if (!url.pathname.startsWith("/storage/v1/object/")) return null;
  return url;
}

export async function downloadSupabaseStorageObject(args: {
  supabaseUrl: string;
  serviceRoleKey: string;
  bucket: string;
  objectPath: string;
  userId: string;
  roomId: string;
  fetchImpl?: typeof fetch;
  maxBytes?: number;
}): Promise<StorageDownloadResult> {
  if (!args.serviceRoleKey || args.serviceRoleKey.trim().length === 0) {
    return { ok: false, reason: "unavailable" };
  }
  if (!isSafeOwnedStoragePath(args.objectPath, args.userId, args.roomId)) {
    return { ok: false, reason: "invalid" };
  }
  const url = buildSupabaseStorageObjectUrl(args);
  if (!url) return { ok: false, reason: "invalid" };
  const maxBytes = args.maxBytes ?? MAX_ROOM_IMAGE_READ_BYTES;
  const fetchImpl = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      cache: "no-store",
      headers: {
        authorization: `Bearer ${args.serviceRoleKey}`,
        apikey: args.serviceRoleKey,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "";
    if (/redirect/i.test(message)) return { ok: false, reason: "redirect" };
    return { ok: false, reason: "unavailable" };
  }
  if (response.redirected) {
    await discardResponse(response);
    return { ok: false, reason: "redirect" };
  }
  if (response.url) {
    let responseUrl: URL;
    try {
      responseUrl = new URL(response.url);
    } catch {
      await discardResponse(response);
      return { ok: false, reason: "redirect" };
    }
    if (responseUrl.origin !== url.origin) {
      await discardResponse(response);
      return { ok: false, reason: "redirect" };
    }
  }
  if (response.status >= 300 && response.status < 400) {
    await discardResponse(response);
    return { ok: false, reason: "redirect" };
  }
  if (response.status === 404 || response.status === 400) {
    await discardResponse(response);
    return { ok: false, reason: "not_found" };
  }
  if (!response.ok) {
    await discardResponse(response);
    return { ok: false, reason: "unavailable" };
  }
  const declaredLength = contentLength(response.headers.get("content-length"));
  if (declaredLength === 0) {
    await discardResponse(response);
    return { ok: false, reason: "empty" };
  }
  if (declaredLength !== null && declaredLength > maxBytes) {
    await discardResponse(response);
    return { ok: false, reason: "too_large" };
  }
  const bounded = await readBoundedBody(response.body, maxBytes);
  if (!bounded.ok) {
    if (bounded.reason === "too_large") return { ok: false, reason: "too_large" };
    if (bounded.reason === "empty") return { ok: false, reason: "empty" };
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    bytes: bounded.bytes,
    contentType: response.headers.get("content-type"),
  };
}
