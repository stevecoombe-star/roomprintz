import type { MyRoomsRoom } from "@/components/my-rooms/types";
import { thumbnailScheduleNotBefore } from "@/lib/vibode-thumbnail-jobs/policy";

/**
 * One manual refresh waits for the existing thumbnail worker.
 * This is not a listing poller: the wait lives inside that single request.
 * Kept under the route maxDuration of 60s.
 */
export const ROOM_THUMBNAIL_REFRESH_TIMEOUT_MS = 40_000;

export const ROOM_THUMBNAIL_REFRESH_INTERVAL_MS = 2_000;

export const ROOM_THUMBNAIL_REFRESH_ERROR_MESSAGE =
  "Couldn't refresh this room's thumbnail. The current preview is unchanged.";

export type RoomThumbnailScheduleSnapshot =
  | Readonly<{
      ok: true;
      scheduled: "pending" | "unchanged";
      contentToken: string;
    }>
  | Readonly<{
      ok: true;
      scheduled: "cleared";
      contentToken: null;
      sceneUpdatedAt: string;
    }>
  | Readonly<{ ok: false; code: string }>;

export type RoomThumbnailRefreshSuccess = Readonly<{
  ok: true;
  previewUrl: string | null;
  cacheVersion: string;
}>;

export type RoomThumbnailRefreshFailure = Readonly<{
  ok: false;
  code: string;
}>;

export type RoomThumbnailRefreshResult =
  | RoomThumbnailRefreshSuccess
  | RoomThumbnailRefreshFailure;

const CACHE_VERSION_PARAM = "v";

export function manualThumbnailNotBefore(nowMs: number): string {
  return thumbnailScheduleNotBefore(nowMs, true);
}

/**
 * 3D thumbnails are content-addressed, so the object path already changes
 * when the scene changes. A reused path (the 2D `thumb.webp` key) gets the
 * authoritative version as a query param. The same version always produces
 * the same URL.
 */
export function thumbnailDisplayUrl(url: string, version: string): string {
  const trimmed = url.trim();
  const cacheVersion = version.trim();
  if (!trimmed || !cacheVersion) return trimmed;
  if (thumbnailUrlCarriesVersion(trimmed, cacheVersion)) return trimmed;
  try {
    const parsed = new URL(trimmed);
    parsed.searchParams.set(CACHE_VERSION_PARAM, cacheVersion);
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

export function thumbnailUrlCarriesVersion(url: string, version: string): boolean {
  const cacheVersion = version.trim();
  if (!cacheVersion) return false;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.get(CACHE_VERSION_PARAM) === cacheVersion) return true;
    let path = parsed.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // Keep the raw pathname when it is not valid percent-encoding.
    }
    return path.includes(`/${cacheVersion}.`) || path.includes(`/${cacheVersion}/`);
  } catch {
    return false;
  }
}

export function thumbnailRefreshDisplayUrl(
  previewUrl: string | null,
  cacheVersion: string,
): string | null {
  if (!previewUrl) return null;
  return thumbnailDisplayUrl(previewUrl, cacheVersion);
}

export function beginThumbnailRefresh(
  refreshingRoomIds: ReadonlySet<string>,
  roomId: string,
): ReadonlySet<string> {
  if (refreshingRoomIds.has(roomId)) return refreshingRoomIds;
  const next = new Set(refreshingRoomIds);
  next.add(roomId);
  return next;
}

export function endThumbnailRefresh(
  refreshingRoomIds: ReadonlySet<string>,
  roomId: string,
): ReadonlySet<string> {
  if (!refreshingRoomIds.has(roomId)) return refreshingRoomIds;
  const next = new Set(refreshingRoomIds);
  next.delete(roomId);
  return next;
}

export function thumbnailRefreshInFlight(
  refreshingRoomIds: ReadonlySet<string>,
  roomId: string,
): boolean {
  return refreshingRoomIds.has(roomId);
}

export function applyThumbnailRefreshToRooms(
  rooms: readonly MyRoomsRoom[],
  roomId: string,
  result: RoomThumbnailRefreshResult,
): MyRoomsRoom[] {
  if (!result.ok) return rooms as MyRoomsRoom[];
  const displayUrl = thumbnailRefreshDisplayUrl(result.previewUrl, result.cacheVersion);
  let changed = false;
  const next = rooms.map((room) => {
    if (room.id !== roomId) return room;
    if (room.display_image_url === displayUrl && room.preview_status === "ready") return room;
    changed = true;
    return {
      ...room,
      display_image_url: displayUrl,
      preview_status: "ready" as const,
    };
  });
  return changed ? next : (rooms as MyRoomsRoom[]);
}

export function upsertPreviewCacheUrl(
  entries: Readonly<Record<string, string>>,
  roomId: string,
  previewUrl: string | null,
): Record<string, string> {
  const next = { ...entries };
  if (previewUrl) next[roomId] = previewUrl;
  else delete next[roomId];
  return next;
}

export function parseRoomThumbnailRefreshResponse(
  body: unknown,
): RoomThumbnailRefreshSuccess | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as { ok?: unknown; previewUrl?: unknown; cacheVersion?: unknown };
  if (record.ok !== true) return null;
  const cacheVersion = typeof record.cacheVersion === "string" ? record.cacheVersion.trim() : "";
  if (!cacheVersion) return null;
  if (record.previewUrl == null) {
    return { ok: true, previewUrl: null, cacheVersion };
  }
  if (typeof record.previewUrl !== "string" || record.previewUrl.trim().length === 0) return null;
  return { ok: true, previewUrl: record.previewUrl.trim(), cacheVersion };
}

export function roomThumbnailRefreshHttpStatus(code: string): number {
  if (code === "not_found") return 404;
  if (code === "invalid_room") return 400;
  if (code === "no_version" || code === "scene_missing" || code === "scene_empty") return 409;
  if (code === "thumbnail_not_ready") return 503;
  return 500;
}

export async function requestRoomThumbnailRefresh(args: {
  roomId: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<RoomThumbnailRefreshResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  try {
    const res = await fetchImpl("/api/vibode/room-thumbnail-refresh", {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.accessToken}`,
      },
      body: JSON.stringify({ roomId: args.roomId }),
    });
    if (!res.ok) return { ok: false, code: "refresh_failed" };
    const parsed = parseRoomThumbnailRefreshResponse(await res.json());
    if (!parsed) return { ok: false, code: "refresh_failed" };
    return parsed;
  } catch {
    return { ok: false, code: "refresh_failed" };
  }
}

export async function waitForThumbnailContentToken(args: {
  contentToken: string;
  readPublishedToken: () => Promise<string | null>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  timeoutMs: number;
  intervalMs: number;
}): Promise<boolean> {
  const started = args.now();
  const deadline = started + Math.max(0, args.timeoutMs);
  const intervalMs = Math.max(0, args.intervalMs);
  const maxReads = intervalMs === 0 ? 1 : Math.ceil(Math.max(0, args.timeoutMs) / intervalMs) + 1;
  for (let read = 0; read < maxReads; read += 1) {
    let published: string | null;
    try {
      published = await args.readPublishedToken();
    } catch {
      return false;
    }
    if (published === args.contentToken) return true;
    if (args.now() >= deadline || intervalMs === 0) return false;
    const remaining = deadline - args.now();
    if (remaining <= 0) return false;
    await args.sleep(Math.min(intervalMs, remaining));
  }
  return false;
}

export async function executeRoomThumbnailRefresh(deps: {
  schedule: () => Promise<RoomThumbnailScheduleSnapshot>;
  readPublishedToken: () => Promise<string | null>;
  signPublishedThumbnail: (contentToken: string) => Promise<string | null>;
  resolveClearedPreview: () => Promise<string | null>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<RoomThumbnailRefreshResult> {
  let scheduled: RoomThumbnailScheduleSnapshot;
  try {
    scheduled = await deps.schedule();
  } catch {
    return { ok: false, code: "enqueue_failed" };
  }
  if (!scheduled.ok) return { ok: false, code: scheduled.code };

  if (scheduled.scheduled === "cleared") {
    const cacheVersion = scheduled.sceneUpdatedAt.trim();
    if (!cacheVersion) return { ok: false, code: "scene_missing" };
    try {
      const previewUrl = await deps.resolveClearedPreview();
      return { ok: true, previewUrl, cacheVersion };
    } catch {
      return { ok: false, code: "preview_unavailable" };
    }
  }

  const contentToken = scheduled.contentToken;
  if (scheduled.scheduled === "pending") {
    const published = await waitForThumbnailContentToken({
      contentToken,
      readPublishedToken: deps.readPublishedToken,
      sleep: deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
      now: deps.now ?? Date.now,
      timeoutMs: deps.timeoutMs ?? ROOM_THUMBNAIL_REFRESH_TIMEOUT_MS,
      intervalMs: deps.intervalMs ?? ROOM_THUMBNAIL_REFRESH_INTERVAL_MS,
    });
    if (!published) return { ok: false, code: "thumbnail_not_ready" };
  }

  try {
    const previewUrl = await deps.signPublishedThumbnail(contentToken);
    if (!previewUrl) return { ok: false, code: "preview_unavailable" };
    return { ok: true, previewUrl, cacheVersion: contentToken };
  } catch {
    return { ok: false, code: "preview_unavailable" };
  }
}
