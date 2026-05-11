import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabaseClient = SupabaseClient;

type PlacementRow = {
  id: string;
  user_id: string;
  room_id: string;
  version_id: string | null;
  furniture_id: string | null;
  thumbnail_url: string | null;
  thumbnail_path: string | null;
  source_image_url: string;
  source_image_path: string | null;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
};

type GenerationRunEdgeRow = {
  source_asset_id: string | null;
  output_asset_id: string | null;
  created_at: string;
};

type RoomAssetRow = {
  id: string;
  room_id: string;
  user_id: string;
  asset_type: string;
};

type VibodeRoomBaseRow = {
  id: string;
  user_id: string;
  base_image_url: string | null;
  base_storage_path: string | null;
  base_version_id: string | null;
  active_asset_id: string | null;
  cover_image_url: string | null;
};

export type ResolvedScenePlacement = {
  id: string;
  room_id: string;
  user_id: string;
  version_id: string | null;
  furniture_id: string | null;
  thumbnail_url: string | null;
  thumbnail_path: string | null;
  source_image_url: string;
  source_image_path: string | null;
  source_storage_path: string | null;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
};

export type ResolveScenePlacementsArgs = {
  supabase: AnySupabaseClient;
  roomId: string;
  userId: string;
  versionId: string;
};

export type ResolveScenePlacementsResult = {
  roomId: string;
  userId: string;
  versionId: string;
  lineageVersionIds: string[];
  resolvedPlacements: ResolvedScenePlacement[];
};

export type BuildSceneRebuildPayloadArgs = {
  supabase: AnySupabaseClient;
  roomId: string;
  userId: string;
  versionId: string;
};

export type SceneRebuildPayloadRoom = {
  id: string;
  userId: string;
  requestedVersionId: string;
  activeAssetId: string | null;
  baseImageUrl: string;
  baseStoragePath: string | null;
  baseVersionId: string | null;
  fallbackImageUrlUsed: boolean;
};

export type SceneRebuildPayloadPlacement = {
  id: string;
  furnitureId: string | null;
  sourceImageUrl: string;
  sourceStoragePath: string | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  isVisible: boolean;
};

export type SceneRebuildPayload = {
  room: SceneRebuildPayloadRoom;
  placements: SceneRebuildPayloadPlacement[];
  placementCount: number;
  lineageVersionIds: string[];
};

export type SceneBaseImageResolutionStrategy =
  | "canonical_room_upload"
  | "source_version_image"
  | "fallback_version_image"
  | "unknown";

export type ResolvedSceneBaseImage = {
  assetId: string | null;
  imageUrl: string | null;
  storagePath: string | null;
  resolutionStrategy: SceneBaseImageResolutionStrategy;
};

function dedupeCoord(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "NaN";
}

function buildPlacementIdentity(row: Pick<PlacementRow, "furniture_id" | "source_image_url" | "x" | "y">): string {
  return [
    row.furniture_id ?? "",
    row.source_image_url.trim(),
    dedupeCoord(row.x),
    dedupeCoord(row.y),
  ].join("::");
}

function toResolvedPlacement(row: PlacementRow): ResolvedScenePlacement {
  return {
    id: row.id,
    room_id: row.room_id,
    user_id: row.user_id,
    version_id: row.version_id,
    furniture_id: row.furniture_id,
    thumbnail_url: row.thumbnail_url,
    thumbnail_path: row.thumbnail_path,
    source_image_url: row.source_image_url,
    source_image_path: row.source_image_path,
    source_storage_path: row.source_image_path,
    x: row.x,
    y: row.y,
    scale: row.scale,
    rotation: row.rotation,
    is_visible: row.is_visible,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function dedupeAndSortRows(rows: PlacementRow[]): PlacementRow[] {
  const dedupedByIdentity = new Map<string, PlacementRow>();
  for (const row of rows) {
    if (!row.is_visible) continue;
    dedupedByIdentity.set(buildPlacementIdentity(row), row);
  }
  return [...dedupedByIdentity.values()].sort((a, b) => {
    const createdCmp = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (createdCmp !== 0) return createdCmp;
    return a.id.localeCompare(b.id);
  });
}

async function fetchVersionPlacements(args: {
  supabase: AnySupabaseClient;
  roomId: string;
  userId: string;
  versionIds: string[];
}): Promise<PlacementRow[]> {
  const uniqueVersionIds = [...new Set(args.versionIds.filter((value) => value.trim().length > 0))];
  if (uniqueVersionIds.length === 0) return [];

  const { data, error } = await args.supabase
    .from("room_furniture_placements")
    .select("*")
    .eq("room_id", args.roomId)
    .eq("user_id", args.userId)
    .in("version_id", uniqueVersionIds)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`[vibode] failed to resolve scene placements: ${error.message}`);
  }

  return ((data ?? []) as PlacementRow[]).filter((row) => typeof row.version_id === "string");
}

async function buildLineageVersionIds(args: {
  supabase: AnySupabaseClient;
  roomId: string;
  userId: string;
  versionId: string;
}): Promise<string[]> {
  const { data: requestedAsset, error: requestedAssetErr } = await args.supabase
    .from("vibode_room_assets")
    .select("id,room_id,user_id,asset_type")
    .eq("id", args.versionId)
    .eq("room_id", args.roomId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (requestedAssetErr) {
    throw new Error(
      `[vibode] failed to validate requested scene version: ${requestedAssetErr.message}`
    );
  }

  const typedRequestedAsset = (requestedAsset as RoomAssetRow | null) ?? null;
  if (typedRequestedAsset?.asset_type === "base") {
    return [args.versionId];
  }

  const { data, error } = await args.supabase
    .from("vibode_generation_runs")
    .select("source_asset_id,output_asset_id,created_at")
    .eq("room_id", args.roomId)
    .eq("user_id", args.userId)
    .not("output_asset_id", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`[vibode] failed to load version lineage: ${error.message}`);
  }

  const sourceByOutput = new Map<string, string | null>();
  for (const edge of (data ?? []) as GenerationRunEdgeRow[]) {
    if (!edge.output_asset_id) continue;
    if (sourceByOutput.has(edge.output_asset_id)) continue;
    sourceByOutput.set(edge.output_asset_id, edge.source_asset_id ?? null);
  }

  const lineageNewestFirst: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = args.versionId;
  let depth = 0;
  while (cursor && !seen.has(cursor) && depth < 200) {
    lineageNewestFirst.push(cursor);
    seen.add(cursor);
    cursor = sourceByOutput.get(cursor) ?? null;
    depth += 1;
  }

  return lineageNewestFirst.reverse();
}

async function fetchRoomBaseMetadata(args: {
  supabase: AnySupabaseClient;
  roomId: string;
  userId: string;
}): Promise<VibodeRoomBaseRow> {
  const { data, error } = await args.supabase
    .from("vibode_rooms")
    .select(
      "id,user_id,base_image_url,base_storage_path,base_version_id,active_asset_id,cover_image_url"
    )
    .eq("id", args.roomId)
    .eq("user_id", args.userId)
    .maybeSingle();

  if (error) {
    throw new Error(`[vibode] failed to load room base metadata: ${error.message}`);
  }
  if (!data) {
    throw new Error("[vibode] room not found or access denied");
  }

  return data as VibodeRoomBaseRow;
}

function resolveBaseImageFromRoomMetadata(room: VibodeRoomBaseRow): ResolvedSceneBaseImage {
  const canonicalBaseImageUrl = room.base_image_url?.trim() ?? "";
  if (canonicalBaseImageUrl.length > 0) {
    return {
      assetId: room.base_version_id,
      imageUrl: canonicalBaseImageUrl,
      storagePath: room.base_storage_path,
      resolutionStrategy: "canonical_room_upload",
    };
  }

  const fallbackCoverImageUrl = room.cover_image_url?.trim() ?? "";
  if (fallbackCoverImageUrl.length > 0) {
    return {
      assetId: room.active_asset_id,
      imageUrl: fallbackCoverImageUrl,
      storagePath: null,
      resolutionStrategy: "fallback_version_image",
    };
  }

  return {
    assetId: null,
    imageUrl: null,
    storagePath: null,
    resolutionStrategy: "unknown",
  };
}

function resolveWithSnapshotInheritance(args: {
  lineageVersionIds: string[];
  placements: PlacementRow[];
}): PlacementRow[] {
  const rowsByVersion = new Map<string, PlacementRow[]>();
  for (const row of args.placements) {
    if (typeof row.version_id !== "string") continue;
    const list = rowsByVersion.get(row.version_id) ?? [];
    list.push(row);
    rowsByVersion.set(row.version_id, list);
  }

  const state = new Map<string, PlacementRow>();
  for (const versionId of args.lineageVersionIds) {
    const versionRows = rowsByVersion.get(versionId) ?? [];
    if (versionRows.length === 0) continue;

    // Current placement behavior stores inherited rows in-version; replacing state
    // preserves version-local deletions while still allowing empty-child inheritance.
    state.clear();
    for (const row of dedupeAndSortRows(versionRows)) {
      state.set(buildPlacementIdentity(row), row);
    }
  }

  return [...state.values()].sort((a, b) => {
    const createdCmp = Date.parse(a.created_at) - Date.parse(b.created_at);
    if (createdCmp !== 0) return createdCmp;
    return a.id.localeCompare(b.id);
  });
}

export async function resolveScenePlacements(
  args: ResolveScenePlacementsArgs
): Promise<ResolveScenePlacementsResult> {
  const lineageVersionIds = await buildLineageVersionIds(args);
  const fallbackLineage = lineageVersionIds.length > 0 ? lineageVersionIds : [args.versionId];

  const placementRows = await fetchVersionPlacements({
    supabase: args.supabase,
    roomId: args.roomId,
    userId: args.userId,
    versionIds: fallbackLineage,
  });

  const currentVersionRows = dedupeAndSortRows(
    placementRows.filter((row) => row.version_id === args.versionId)
  );

  // Preserve today's behavior: if the current version already has rows, treat that
  // as canonical resolved state. Fallback lineage resolution handles empty versions.
  const resolvedRows =
    currentVersionRows.length > 0
      ? currentVersionRows
      : resolveWithSnapshotInheritance({
          lineageVersionIds: fallbackLineage,
          placements: placementRows,
        });

  return {
    roomId: args.roomId,
    userId: args.userId,
    versionId: args.versionId,
    lineageVersionIds: fallbackLineage,
    resolvedPlacements: resolvedRows.map(toResolvedPlacement),
  };
}

export async function resolveSceneBaseImage(args: {
  supabase: AnySupabaseClient;
  roomId: string;
  userId: string;
}): Promise<ResolvedSceneBaseImage> {
  const room = await fetchRoomBaseMetadata(args);
  return resolveBaseImageFromRoomMetadata(room);
}

export async function buildSceneRebuildPayload(
  args: BuildSceneRebuildPayloadArgs
): Promise<SceneRebuildPayload> {
  const room = await fetchRoomBaseMetadata(args);
  const resolved = await resolveScenePlacements(args);
  const resolvedBaseImage = resolveBaseImageFromRoomMetadata(room);
  const fallbackImageUrlUsed = resolvedBaseImage.resolutionStrategy === "fallback_version_image";
  const baseImageUrl = resolvedBaseImage.imageUrl ?? "";

  if (baseImageUrl.length === 0) {
    throw new Error("[vibode] missing base image url for rebuild payload");
  }

  const placements: SceneRebuildPayloadPlacement[] = resolved.resolvedPlacements.map((placement) => ({
    id: placement.id,
    furnitureId: placement.furniture_id,
    sourceImageUrl: placement.source_image_url,
    sourceStoragePath: placement.source_storage_path,
    thumbnailUrl: placement.thumbnail_url,
    thumbnailPath: placement.thumbnail_path,
    x: placement.x,
    y: placement.y,
    scale: placement.scale,
    rotation: placement.rotation,
    isVisible: placement.is_visible,
  }));

  return {
    room: {
      id: room.id,
      userId: room.user_id,
      requestedVersionId: args.versionId,
      activeAssetId: room.active_asset_id,
      baseImageUrl,
      baseStoragePath: room.base_storage_path,
      baseVersionId: room.base_version_id,
      fallbackImageUrlUsed,
    },
    placements,
    placementCount: placements.length,
    lineageVersionIds: resolved.lineageVersionIds,
  };
}
