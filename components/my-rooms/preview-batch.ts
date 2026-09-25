import { ROOM_PREVIEW_BATCH_MAX } from "@/lib/vibode-room-preview/batch-limit";
import type { MyRoomsPreviewStatus, MyRoomsRoom } from "@/components/my-rooms/types";

export const MY_ROOMS_EAGER_IMAGE_COUNT = 6;
const PREVIEW_CACHE_KEY = "vibode:my-rooms-preview-urls:v1";
const REUSE_SKEW_MS = 60_000;
const SIGN_MARKER = "/storage/v1/object/sign/";

export type ListingPreviewSource = "3d" | "2d-thumbnail" | "asset" | "cover";

export type ListingPreviewItem = {
  roomId: string;
  previewUrl: string | null;
  source: ListingPreviewSource | null;
};

export type RoomPreviewBatchLoad = {
  ok: boolean;
  previews: Record<string, ListingPreviewItem>;
  failedRoomIds: string[];
  completedRoomIds: string[];
};

export type PreviewCacheStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const LISTING_SOURCES = new Set<ListingPreviewSource>(["3d", "2d-thumbnail", "asset", "cover"]);

export function chunkRoomIds(roomIds: readonly string[], size = ROOM_PREVIEW_BATCH_MAX): string[][] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const roomId of roomIds) {
    if (seen.has(roomId)) continue;
    seen.add(roomId);
    unique.push(roomId);
  }
  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += size) {
    chunks.push(unique.slice(index, index + size));
  }
  return chunks;
}

export function roomCardImageDelivery(index: number): {
  loading: "eager" | "lazy";
  fetchPriority: "high" | "low" | "auto";
} {
  if (index <= 0) return { loading: "eager", fetchPriority: "high" };
  if (index < MY_ROOMS_EAGER_IMAGE_COUNT) return { loading: "eager", fetchPriority: "auto" };
  return { loading: "lazy", fetchPriority: "low" };
}

export function previewObjectIdentity(url: string): string | null {
  try {
    const parsed = new URL(url);
    const markerAt = parsed.pathname.indexOf(SIGN_MARKER);
    if (markerAt >= 0) return parsed.pathname.slice(markerAt + SIGN_MARKER.length);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return null;
  }
}

function jwtExpiryMs(token: string): number | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function previewUrlReusable(url: string, nowMs: number): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const token = parsed.searchParams.get("token");
    const signed = parsed.pathname.includes("/object/sign/") || token !== null;
    if (!signed) return true;
    if (!token) return false;
    const expMs = jwtExpiryMs(token);
    if (expMs === null) return false;
    return expMs - REUSE_SKEW_MS > nowMs;
  } catch {
    return false;
  }
}

export function chooseStablePreviewUrl(
  previous: string | null,
  next: string | null,
  nowMs: number,
): string | null {
  if (!next) return null;
  if (
    previous &&
    previewObjectIdentity(previous) === previewObjectIdentity(next) &&
    previewUrlReusable(previous, nowMs)
  ) {
    return previous;
  }
  return next;
}

export function browserPreviewCacheStore(): PreviewCacheStore | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readFreshPreviewUrls(
  store: PreviewCacheStore | null,
  userId: string,
  nowMs: number,
): Record<string, string> {
  if (!store) return {};
  try {
    const raw = store.getItem(PREVIEW_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { userId?: unknown; entries?: unknown };
    if (parsed.userId !== userId || !parsed.entries || typeof parsed.entries !== "object") return {};
    const fresh: Record<string, string> = {};
    for (const [roomId, url] of Object.entries(parsed.entries as Record<string, unknown>)) {
      if (typeof url !== "string" || !previewUrlReusable(url, nowMs)) continue;
      fresh[roomId] = url;
    }
    return fresh;
  } catch {
    return {};
  }
}

export function writeFreshPreviewUrls(
  store: PreviewCacheStore | null,
  userId: string,
  entries: Readonly<Record<string, string>>,
) {
  if (!store) return;
  try {
    store.setItem(PREVIEW_CACHE_KEY, JSON.stringify({ userId, entries }));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

export function initialDisplayPreview(
  roomId: string,
  cache: Readonly<Record<string, string>>,
): { display_image_url: string | null; preview_status: MyRoomsPreviewStatus } {
  const cached = cache[roomId];
  if (cached) return { display_image_url: cached, preview_status: "ready" };
  return { display_image_url: null, preview_status: "pending" };
}

export function settlePendingPreviews(rooms: readonly MyRoomsRoom[]): MyRoomsRoom[] {
  return rooms.map((room) =>
    room.preview_status === "pending" ? { ...room, preview_status: "ready" } : room,
  );
}

export function applyRoomPreviewBatch(
  rooms: readonly MyRoomsRoom[],
  batch: RoomPreviewBatchLoad,
  nowMs: number,
): MyRoomsRoom[] {
  if (!batch.ok && batch.completedRoomIds.length === 0) {
    return settlePendingPreviews(rooms);
  }
  const failed = new Set(batch.failedRoomIds);
  const completed = new Set(batch.completedRoomIds);
  return rooms.map((room) => {
    if (completed.has(room.id) && !failed.has(room.id)) {
      const item = batch.previews[room.id];
      return {
        ...room,
        display_image_url: chooseStablePreviewUrl(room.display_image_url, item?.previewUrl ?? null, nowMs),
        preview_status: "ready",
      };
    }
    if ((failed.has(room.id) || !batch.ok) && room.preview_status === "pending") {
      return { ...room, preview_status: "ready" };
    }
    return room;
  });
}

export function retainPreviewCache(
  entries: Readonly<Record<string, string>>,
  roomIds: readonly string[],
): Record<string, string> {
  const keep = new Set(roomIds);
  const next: Record<string, string> = {};
  for (const [roomId, url] of Object.entries(entries)) {
    if (keep.has(roomId)) next[roomId] = url;
  }
  return next;
}

export function nextPreviewCache(
  previous: Readonly<Record<string, string>>,
  batch: RoomPreviewBatchLoad,
  nowMs: number,
): Record<string, string> {
  if (!batch.ok && batch.completedRoomIds.length === 0) return { ...previous };
  const failed = new Set(batch.failedRoomIds);
  const next: Record<string, string> = { ...previous };
  for (const roomId of batch.completedRoomIds) {
    if (failed.has(roomId)) continue;
    const chosen = chooseStablePreviewUrl(previous[roomId] ?? null, batch.previews[roomId]?.previewUrl ?? null, nowMs);
    if (chosen) next[roomId] = chosen;
    else delete next[roomId];
  }
  return next;
}

function parsePreviewItem(roomId: string, value: unknown): ListingPreviewItem | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { previewUrl?: unknown; source?: unknown };
  const previewUrl =
    typeof record.previewUrl === "string" && record.previewUrl.trim().length > 0
      ? record.previewUrl
      : null;
  const source =
    typeof record.source === "string" && LISTING_SOURCES.has(record.source as ListingPreviewSource)
      ? (record.source as ListingPreviewSource)
      : null;
  return { roomId, previewUrl, source };
}

export function parseRoomPreviewBatchResponse(
  body: unknown,
): Record<string, ListingPreviewItem> | null {
  if (!body || typeof body !== "object") return null;
  const previews = (body as { previews?: unknown }).previews;
  if (!previews || typeof previews !== "object" || Array.isArray(previews)) return null;
  const parsed: Record<string, ListingPreviewItem> = {};
  for (const [roomId, value] of Object.entries(previews)) {
    const item = parsePreviewItem(roomId, value);
    if (item) parsed[roomId] = item;
  }
  return parsed;
}

export async function requestRoomPreviewBatch(args: {
  roomIds: readonly string[];
  accessToken: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<RoomPreviewBatchLoad> {
  const chunks = chunkRoomIds(args.roomIds);
  if (chunks.length === 0) {
    return { ok: true, previews: {}, failedRoomIds: [], completedRoomIds: [] };
  }
  if (!args.accessToken) {
    return {
      ok: false,
      previews: {},
      failedRoomIds: chunks.flat(),
      completedRoomIds: [],
    };
  }
  if (args.signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  const previews: Record<string, ListingPreviewItem> = {};
  const failedRoomIds: string[] = [];
  const completedRoomIds: string[] = [];

  for (const roomIds of chunks) {
    if (args.signal?.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    try {
      const res = await fetchImpl("/api/vibode/room-preview-urls", {
        method: "POST",
        signal: args.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${args.accessToken}`,
        },
        body: JSON.stringify({ roomIds }),
      });
      if (!res.ok) {
        failedRoomIds.push(...roomIds);
        continue;
      }
      const parsed = parseRoomPreviewBatchResponse(await res.json());
      if (!parsed) {
        failedRoomIds.push(...roomIds);
        continue;
      }
      Object.assign(previews, parsed);
      completedRoomIds.push(...roomIds);
    } catch (err) {
      if (args.signal?.aborted || (err instanceof Error && err.name === "AbortError")) {
        throw err;
      }
      failedRoomIds.push(...roomIds);
    }
  }

  return {
    ok: completedRoomIds.length > 0,
    previews,
    failedRoomIds,
    completedRoomIds,
  };
}
