import { canonicalStringify, sha256Hex, type Json } from "@/lib/sceneHash";
import { parsePlacementStorageRef } from "@/lib/furniturePlacementImageUrl";

export type PlacementStateHashInput = {
  id?: unknown;
  roomId?: unknown;
  room_id?: unknown;
  versionId?: unknown;
  version_id?: unknown;
  furnitureId?: unknown;
  furniture_id?: unknown;
  thumbnailUrl?: unknown;
  thumbnail_url?: unknown;
  thumbnailPath?: unknown;
  thumbnail_path?: unknown;
  sourceImageUrl?: unknown;
  source_image_url?: unknown;
  sourceImagePath?: unknown;
  source_image_path?: unknown;
  x?: unknown;
  y?: unknown;
  scale?: unknown;
  rotation?: unknown;
  isVisible?: unknown;
  is_visible?: unknown;
};

export type NormalizedPlacementStateRow = {
  id: string;
  roomId: string | null;
  versionId: string | null;
  furnitureId: string | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  sourceImageUrl: string | null;
  sourceImagePath: string | null;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  isVisible: boolean;
};

type PlacementStateHashRow = {
  id: string;
  roomId: string | null;
  versionId: string | null;
  furnitureId: string | null;
  sourceImageIdentity: string | null;
  thumbnailIdentity: string | null;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  isVisible: boolean;
};

const ROUND_DP = 6;

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeFinite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundToDp(value: number, dp: number): number {
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

function normalizeUrlIdentity(value: string | null | undefined): string | null {
  const raw = safeStr(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return raw.split(/[?#]/, 1)[0]?.trim() || null;
  }
}

function resolveImageIdentity(args: {
  storagePath: string | null;
  fallbackUrl: string | null;
}): string | null {
  const storageRef = parsePlacementStorageRef(args.storagePath, args.fallbackUrl);
  if (storageRef) {
    return `path:${storageRef.bucket}/${storageRef.path}`;
  }
  const normalizedUrl = normalizeUrlIdentity(args.fallbackUrl);
  if (!normalizedUrl) return null;
  return `url:${normalizedUrl}`;
}

function normalizeRow(value: PlacementStateHashInput): NormalizedPlacementStateRow | null {
  const id = safeStr(value.id);
  if (!id) return null;

  const x = safeFinite(value.x);
  const y = safeFinite(value.y);
  if (x === null || y === null) return null;

  const scale = safeFinite(value.scale) ?? 1;
  const rotation = safeFinite(value.rotation) ?? 0;
  const isVisibleRaw = value.is_visible ?? value.isVisible;

  return {
    id,
    roomId: safeStr(value.room_id) ?? safeStr(value.roomId),
    versionId: safeStr(value.version_id) ?? safeStr(value.versionId),
    furnitureId: safeStr(value.furniture_id) ?? safeStr(value.furnitureId),
    thumbnailUrl: safeStr(value.thumbnail_url) ?? safeStr(value.thumbnailUrl),
    thumbnailPath: safeStr(value.thumbnail_path) ?? safeStr(value.thumbnailPath),
    sourceImageUrl: safeStr(value.source_image_url) ?? safeStr(value.sourceImageUrl),
    sourceImagePath: safeStr(value.source_image_path) ?? safeStr(value.sourceImagePath),
    x: roundToDp(x, ROUND_DP),
    y: roundToDp(y, ROUND_DP),
    scale: roundToDp(scale, ROUND_DP),
    rotation: roundToDp(rotation, ROUND_DP),
    isVisible: typeof isVisibleRaw === "boolean" ? isVisibleRaw : true,
  };
}

export function normalizePlacementStateForHash(
  placements: PlacementStateHashInput[]
): NormalizedPlacementStateRow[] {
  return placements
    .map((placement) => normalizeRow(placement))
    .filter((placement): placement is NormalizedPlacementStateRow => Boolean(placement))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function toStableHashRows(rows: NormalizedPlacementStateRow[]): PlacementStateHashRow[] {
  return rows.map((row) => ({
    id: row.id,
    roomId: row.roomId,
    versionId: row.versionId,
    furnitureId: row.furnitureId,
    sourceImageIdentity: resolveImageIdentity({
      storagePath: row.sourceImagePath,
      fallbackUrl: row.sourceImageUrl,
    }),
    thumbnailIdentity: resolveImageIdentity({
      storagePath: row.thumbnailPath,
      fallbackUrl: row.thumbnailUrl,
    }),
    x: row.x,
    y: row.y,
    scale: row.scale,
    rotation: row.rotation,
    isVisible: row.isVisible,
  }));
}

export async function hashPlacementState(placements: PlacementStateHashInput[]): Promise<string> {
  const normalized = normalizePlacementStateForHash(placements);
  const stableHashRows = toStableHashRows(normalized);
  const canonical = canonicalStringify(stableHashRows as unknown as Json);
  return sha256Hex(canonical);
}
