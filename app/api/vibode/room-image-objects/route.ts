import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runGeminiRoomReadFromImageUrl } from "@/lib/vibodeGeminiRoomRead";
import { getRequestIdFromHeaders } from "@/lib/vibodeGeminiUsageAccounting";
import { resolveRoomReadModelVersion } from "@/lib/vibodeRoomReadModelVersion";
import type { DetectedRoomObjectLabel } from "@/lib/vibodeRoomObjectLabels";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

type AnySupabaseClient = SupabaseClient;

type RoomImageObjectRow = {
  label: string;
  confidence: number | null;
  center_x: number | null;
  center_y: number | null;
  bbox: unknown;
};

type RoomReadMode = "labels_only" | "geometry";
type RoomImageObjectsPurpose = "suggested-placement" | "remove-mode" | "legacy";
type RoomImageObjectUpsertRow = {
  user_id: string;
  room_id: string | null;
  asset_id: string | null;
  version_id: string | null;
  image_url: string | null;
  image_hash: string | null;
  label: string;
  confidence: number;
  center_x: number | null;
  center_y: number | null;
  bbox: { x: number; y: number; w: number; h: number } | null;
  source: string;
};

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.toLowerCase().trim().replace(/\s+/g, " ");
  return label.length > 0 ? label : null;
}

function normalizeObjects(
  input: Array<{ label?: unknown; confidence?: unknown }>
): DetectedRoomObjectLabel[] {
  const byLabel = new Map<string, number>();
  for (const item of input) {
    const label = normalizeLabel(item.label);
    if (!label) continue;
    const confidenceRaw =
      typeof item.confidence === "number"
        ? item.confidence
        : typeof item.confidence === "string"
          ? Number(item.confidence)
          : null;
    const confidence =
      typeof confidenceRaw === "number" && Number.isFinite(confidenceRaw) ? confidenceRaw : 0.6;
    const previous = byLabel.get(label);
    if (previous === undefined || confidence > previous) {
      byLabel.set(label, confidence);
    }
  }
  return Array.from(byLabel.entries())
    .map(([label, confidence]) => ({ label, confidence }))
    .sort((a, b) => b.confidence - a.confidence);
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeStoredObjects(rows: RoomImageObjectRow[]): DetectedRoomObjectLabel[] {
  const out: DetectedRoomObjectLabel[] = [];
  for (const row of rows) {
    const label = normalizeLabel(row.label);
    if (!label) continue;
    const confidence = parseFiniteNumber(row.confidence) ?? 0.6;
    const centerX = parseFiniteNumber(row.center_x);
    const centerY = parseFiniteNumber(row.center_y);
    const bboxRecord =
      row.bbox && typeof row.bbox === "object" ? (row.bbox as Record<string, unknown>) : null;
    const bboxX = parseFiniteNumber(bboxRecord?.x);
    const bboxY = parseFiniteNumber(bboxRecord?.y);
    const bboxW = parseFiniteNumber(bboxRecord?.w);
    const bboxH = parseFiniteNumber(bboxRecord?.h);
    out.push({
      label,
      confidence,
      ...(centerX !== null ? { centerX } : {}),
      ...(centerY !== null ? { centerY } : {}),
      ...(bboxX !== null && bboxY !== null && bboxW !== null && bboxH !== null
        ? {
            bbox: {
              x: bboxX,
              y: bboxY,
              w: bboxW,
              h: bboxH,
            },
          }
        : {}),
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

function hasGeometry(objects: DetectedRoomObjectLabel[]): boolean {
  return objects.some(
    (object) =>
      Boolean(object.bbox) ||
      (typeof object.centerX === "number" &&
        Number.isFinite(object.centerX) &&
        typeof object.centerY === "number" &&
        Number.isFinite(object.centerY))
  );
}

function countGeometryObjects(objects: DetectedRoomObjectLabel[]): number {
  return objects.filter(
    (object) =>
      Boolean(object.bbox) ||
      (typeof object.centerX === "number" &&
        Number.isFinite(object.centerX) &&
        typeof object.centerY === "number" &&
        Number.isFinite(object.centerY))
  ).length;
}

function countGeometryRows(rows: RoomImageObjectUpsertRow[]): number {
  return rows.filter(
    (row) =>
      Boolean(row.bbox) ||
      (typeof row.center_x === "number" &&
        Number.isFinite(row.center_x) &&
        typeof row.center_y === "number" &&
        Number.isFinite(row.center_y))
  ).length;
}

function hasSufficientGeometry(
  objects: DetectedRoomObjectLabel[],
  minCoverage = 0
): { sufficient: boolean; geometryCount: number; totalCount: number; coverage: number } {
  const totalCount = objects.length;
  const geometryCount = countGeometryObjects(objects);
  const coverage = totalCount > 0 ? geometryCount / totalCount : 0;
  return {
    sufficient: totalCount > 0 && geometryCount > 0 && coverage >= minCoverage,
    geometryCount,
    totalCount,
    coverage,
  };
}

function normalizeFreshRoomReadObjects(
  mode: RoomReadMode,
  objects: DetectedRoomObjectLabel[]
): DetectedRoomObjectLabel[] {
  if (mode !== "geometry") {
    return normalizeObjects(objects);
  }
  const out: DetectedRoomObjectLabel[] = [];
  for (const object of objects) {
    const label = normalizeLabel(object.label);
    if (!label) continue;
    const confidence = parseFiniteNumber(object.confidence) ?? 0.6;
    const centerX = parseFiniteNumber(object.centerX);
    const centerY = parseFiniteNumber(object.centerY);
    const bbox = object.bbox;
    const bboxX = parseFiniteNumber(bbox?.x);
    const bboxY = parseFiniteNumber(bbox?.y);
    const bboxW = parseFiniteNumber(bbox?.w);
    const bboxH = parseFiniteNumber(bbox?.h);
    out.push({
      label,
      confidence,
      ...(centerX !== null ? { centerX } : {}),
      ...(centerY !== null ? { centerY } : {}),
      ...(bboxX !== null && bboxY !== null && bboxW !== null && bboxH !== null
        ? {
            bbox: {
              x: bboxX,
              y: bboxY,
              w: bboxW,
              h: bboxH,
            },
          }
        : {}),
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

function hasBboxRow(row: RoomImageObjectUpsertRow): boolean {
  return Boolean(
    row.bbox &&
      Number.isFinite(row.bbox.x) &&
      Number.isFinite(row.bbox.y) &&
      Number.isFinite(row.bbox.w) &&
      Number.isFinite(row.bbox.h)
  );
}

function hasCenterRow(row: RoomImageObjectUpsertRow): boolean {
  return (
    typeof row.center_x === "number" &&
    Number.isFinite(row.center_x) &&
    typeof row.center_y === "number" &&
    Number.isFinite(row.center_y)
  );
}

function dedupeRoomImageObjectUpsertRows(
  rows: RoomImageObjectUpsertRow[]
): {
  dedupedRows: RoomImageObjectUpsertRow[];
  removedCount: number;
  duplicateLabels: string[];
  geometryCountBefore: number;
  geometryCountAfter: number;
} {
  const byConflictKey = new Map<string, { row: RoomImageObjectUpsertRow; firstIndex: number }>();
  const duplicateLabels = new Set<string>();
  const geometryCountBefore = countGeometryRows(rows);

  const buildConflictKey = (row: RoomImageObjectUpsertRow) =>
    [
      row.user_id,
      row.room_id ?? "__NULL__",
      row.asset_id ?? "__NULL__",
      row.version_id ?? "__NULL__",
      row.image_hash ?? "__NULL__",
      row.label,
      row.source,
    ].join("|");

  const isBetterRow = (candidate: RoomImageObjectUpsertRow, existing: RoomImageObjectUpsertRow) => {
    const candidateHasBbox = hasBboxRow(candidate);
    const existingHasBbox = hasBboxRow(existing);
    if (candidateHasBbox !== existingHasBbox) return candidateHasBbox;

    const candidateHasCenter = hasCenterRow(candidate);
    const existingHasCenter = hasCenterRow(existing);
    if (candidateHasCenter !== existingHasCenter) return candidateHasCenter;

    if (candidate.confidence !== existing.confidence) return candidate.confidence > existing.confidence;
    return false;
  };

  rows.forEach((row, index) => {
    const key = buildConflictKey(row);
    const existing = byConflictKey.get(key);
    if (!existing) {
      byConflictKey.set(key, { row, firstIndex: index });
      return;
    }
    duplicateLabels.add(row.label);
    if (isBetterRow(row, existing.row)) {
      byConflictKey.set(key, { row, firstIndex: existing.firstIndex });
    }
  });

  const dedupedRows = Array.from(byConflictKey.values())
    .sort((a, b) => a.firstIndex - b.firstIndex)
    .map((entry) => entry.row);
  return {
    dedupedRows,
    removedCount: rows.length - dedupedRows.length,
    duplicateLabels: Array.from(duplicateLabels).sort(),
    geometryCountBefore,
    geometryCountAfter: countGeometryRows(dedupedRows),
  };
}

function parseRoomReadMode(value: unknown): RoomReadMode {
  return value === "geometry" ? "geometry" : "labels_only";
}

function parsePurpose(value: unknown): RoomImageObjectsPurpose {
  if (value === "suggested-placement") return "suggested-placement";
  if (value === "remove-mode") return "remove-mode";
  if (value === "legacy" || value == null) return "legacy";
  if (typeof value === "string" && value.trim().length === 0) return "legacy";
  // Keep this endpoint backward compatible by treating unknown purpose values as legacy.
  console.warn("[room-image-objects] invalid purpose; defaulting to legacy", {
    purpose: value,
  });
  return "legacy";
}

function resolveSourceTrigger(args: {
  purpose: RoomImageObjectsPurpose;
  mode: RoomReadMode;
  allowRoomReadOnMiss: boolean;
}): "remove-mode" | "suggested-placement" | "geometry-prewarm" | "labels-only" | "unknown" {
  if (args.purpose === "remove-mode") return "remove-mode";
  if (args.purpose === "suggested-placement") return "suggested-placement";
  if (args.mode === "labels_only") return "labels-only";
  if (args.mode === "geometry" && args.allowRoomReadOnMiss) return "geometry-prewarm";
  return "unknown";
}

function getUserSupabaseClient(
  req: NextRequest
): { supabase: AnySupabaseClient | null; token: string | null } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { supabase: null, token: null };
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  if (!token) return { supabase: null, token: null };
  const supabase: AnySupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { supabase, token };
}

function hashImageIdentity(value: string | null): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const { supabase, token } = getUserSupabaseClient(req);
    if (!supabase || !token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = userData.user.id;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const roomId = safeStr(body.roomId) ?? safeStr(body.vibodeRoomId);
    const assetId = safeStr(body.assetId);
    const versionId = safeStr(body.versionId) ?? assetId;
    const imageUrl = safeStr(body.imageUrl);
    const imageHash = safeStr(body.imageHash) ?? hashImageIdentity(imageUrl);
    const hasVersionIdentity = Boolean(roomId || assetId || versionId);
    const effectiveImageHash = hasVersionIdentity
      ? hashImageIdentity(`${roomId ?? ""}|${assetId ?? ""}|${versionId ?? ""}`)
      : imageHash;
    const modelVersion = resolveRoomReadModelVersion(body.modelVersion);
    const allowRoomReadOnMiss = body.allowRoomReadOnMiss === true;
    const mode = parseRoomReadMode(body.mode);
    const requestId = getRequestIdFromHeaders(req.headers, "room-image-objects");
    // Purpose scopes which workflow invoked room-image-objects and protects future branching.
    const purpose = parsePurpose(body.purpose);
    const sourceTrigger = resolveSourceTrigger({
      purpose,
      mode,
      allowRoomReadOnMiss,
    });
    const source = "gemini_room_read";
    const identityLog = {
      roomId: roomId ?? null,
      assetId: assetId ?? null,
      versionId: versionId ?? null,
      imageHash: effectiveImageHash?.slice(0, 16) ?? null,
      source,
    };

    if (!roomId && !assetId && !versionId && !imageHash) {
      console.log("[room-image-objects] skipped because no stable image identity", {
        hasImageUrl: Boolean(imageUrl),
        purpose,
        mode,
      });
      return NextResponse.json({ objects: [] as DetectedRoomObjectLabel[] });
    }

    console.log("[room-image-objects] request scoped", {
      purpose,
      mode,
      allowRoomReadOnMiss,
      hasVersionIdentity,
      roomId: roomId ?? null,
      assetId: assetId ?? null,
      versionId: versionId ?? null,
      identityHash: effectiveImageHash?.slice(0, 12) ?? null,
    });

    let query = supabase
      .from("room_image_objects")
      .select("label, confidence, center_x, center_y, bbox")
      .eq("user_id", userId)
      .eq("source", source);

    if (roomId) query = query.eq("room_id", roomId);
    if (assetId) query = query.eq("asset_id", assetId);
    if (versionId) query = query.eq("version_id", versionId);
    if (effectiveImageHash) query = query.eq("image_hash", effectiveImageHash);

    const { data: existingRows, error: fetchError } = await query;
    if (fetchError) {
      console.warn("[room-image-objects] fetch failed", { message: fetchError.message });
      return NextResponse.json({ error: "Failed to fetch room image objects." }, { status: 500 });
    }

    const storedObjects = normalizeStoredObjects((existingRows ?? []) as RoomImageObjectRow[]);
    const normalizedExisting = normalizeObjects(storedObjects);
    let geometryLookupDecision:
      | "reused persisted geometry"
      | "fresh read because missing rows"
      | "fresh read because insufficient geometry"
      | "fresh read because identity mismatch / no matching rows"
      | "reused labels-only mode"
      | "cache miss without room-read"
      | null = null;
    const geometryStatsForLog = hasSufficientGeometry(storedObjects);
    if (storedObjects.length > 0) {
      const geometryFound = hasGeometry(storedObjects);
      const geometryStats = geometryStatsForLog;
      const canUseStoredGeometry =
        mode !== "geometry" || geometryStats.sufficient || !allowRoomReadOnMiss;
      console.log("[room-image-objects] persisted lookup", {
        roomId: roomId ?? null,
        assetId: assetId ?? null,
        versionId: versionId ?? null,
        identityHash: effectiveImageHash?.slice(0, 12) ?? null,
        rows: storedObjects.length,
        geometryCount: geometryStats.geometryCount,
        geometryCoverage: Number(geometryStats.coverage.toFixed(3)),
        mode,
        allowRoomReadOnMiss,
      });
      if (canUseStoredGeometry) {
        geometryLookupDecision =
          mode === "geometry" ? "reused persisted geometry" : "reused labels-only mode";
        const responseObjects = mode === "geometry" ? storedObjects : normalizedExisting;
        console.log("[room-image-objects] fetched from Supabase", {
          count: responseObjects.length,
          roomId,
          assetId,
          versionId,
          purpose,
          mode,
          geometryFound,
          geometryCount: geometryStats.geometryCount,
          geometryCoverage: Number(geometryStats.coverage.toFixed(3)),
        });
        console.log("[room-image-objects] returned labels", {
          labels: responseObjects.map((item) => item.label),
        });
        return NextResponse.json({ objects: responseObjects });
      }
      geometryLookupDecision = "fresh read because insufficient geometry";
      console.log("[room-image-objects] geometry missing in stored rows; running room-read", {
        roomId,
        assetId,
        versionId,
        purpose,
        rows: storedObjects.length,
        geometryCount: geometryStats.geometryCount,
        geometryCoverage: Number(geometryStats.coverage.toFixed(3)),
      });
    } else {
      geometryLookupDecision = allowRoomReadOnMiss
        ? "fresh read because identity mismatch / no matching rows"
        : "cache miss without room-read";
      console.log("[room-image-objects] persisted lookup miss", {
        roomId: roomId ?? null,
        assetId: assetId ?? null,
        versionId: versionId ?? null,
        identityHash: effectiveImageHash?.slice(0, 12) ?? null,
        mode,
        allowRoomReadOnMiss,
      });
    }
    if (mode === "geometry") {
      console.log({
        event: "room_image_objects_geometry_lookup",
        purpose,
        mode,
        allowRoomReadOnMiss,
        ...identityLog,
        rowCount: storedObjects.length,
        geometryRowCount: geometryStatsForLog.geometryCount,
        geometryCoverage: Number(geometryStatsForLog.coverage.toFixed(3)),
        reuseDecision:
          geometryLookupDecision ??
          (allowRoomReadOnMiss
            ? "fresh read because missing rows"
            : "cache miss without room-read"),
      });
    }
    if (mode === "labels_only" && normalizedExisting.length > 0) {
      console.log("[room-image-objects] fetched from Supabase", {
        count: normalizedExisting.length,
        roomId,
        assetId,
        versionId,
        purpose,
      });
      console.log("[room-image-objects] returned labels", {
        labels: normalizedExisting.map((item) => item.label),
      });
      return NextResponse.json({ objects: normalizedExisting });
    }

    if (!allowRoomReadOnMiss) {
      console.log("[room-image-objects] cache miss without room-read", {
        roomId,
        assetId,
        versionId,
        purpose,
      });
      return NextResponse.json({ objects: [] as DetectedRoomObjectLabel[] });
    }

    if (!imageUrl) {
      console.log("[room-image-objects] cache miss and no image URL", {
        roomId,
        assetId,
        versionId,
        purpose,
      });
      return NextResponse.json({ objects: [] as DetectedRoomObjectLabel[] });
    }

    console.log("[room-image-objects] cache miss / running room-read", {
      roomId,
      assetId,
      versionId,
      modelVersion,
      purpose,
    });

    const roomReadObjects = await runGeminiRoomReadFromImageUrl({
      imageUrl,
      modelVersion,
      mode,
      purpose,
      accounting: {
        requestId,
        route: "/api/vibode/room-image-objects",
        sourceTrigger,
        workflowType: "room-read",
        actionType: "room-image-objects",
        userId,
        roomId: roomId ?? null,
        versionId: versionId ?? null,
        assetId: assetId ?? null,
      },
    });
    const normalizedRoomReadObjects = normalizeFreshRoomReadObjects(mode, roomReadObjects);
    const normalizedGeometryCount = countGeometryObjects(normalizedRoomReadObjects);
    if (normalizedRoomReadObjects.length > 0) {
      const rowsToInsertRaw: RoomImageObjectUpsertRow[] = normalizedRoomReadObjects.map((item) => ({
        user_id: userId,
        room_id: roomId ?? null,
        asset_id: assetId ?? null,
        version_id: versionId ?? null,
        image_url: imageUrl ?? null,
        image_hash: effectiveImageHash,
        label: item.label,
        confidence: item.confidence,
        center_x: typeof item.centerX === "number" && Number.isFinite(item.centerX) ? item.centerX : null,
        center_y: typeof item.centerY === "number" && Number.isFinite(item.centerY) ? item.centerY : null,
        bbox:
          item.bbox &&
          Number.isFinite(item.bbox.x) &&
          Number.isFinite(item.bbox.y) &&
          Number.isFinite(item.bbox.w) &&
          Number.isFinite(item.bbox.h)
            ? {
                x: item.bbox.x,
                y: item.bbox.y,
                w: item.bbox.w,
                h: item.bbox.h,
              }
            : null,
        source,
      }));
      const deduped = dedupeRoomImageObjectUpsertRows(rowsToInsertRaw);
      const rowsToInsert = deduped.dedupedRows;
      if (deduped.removedCount > 0) {
        console.log({
          event: "room_image_objects_upsert_deduped",
          originalCount: rowsToInsertRaw.length,
          dedupedCount: rowsToInsert.length,
          removedCount: deduped.removedCount,
          duplicateLabels: deduped.duplicateLabels,
          geometryCountBefore: deduped.geometryCountBefore,
          geometryCountAfter: deduped.geometryCountAfter,
        });
      }
      const { error: insertError } = await supabase.from("room_image_objects").upsert(rowsToInsert, {
        onConflict: "user_id,room_id,asset_id,version_id,image_hash,label,source",
      });
      if (insertError) {
        console.warn("[room-image-objects] store failed", { message: insertError.message });
      } else {
        console.log("[room-image-objects] stored labels", {
          count: rowsToInsert.length,
          geometryCount: normalizedGeometryCount,
          labels: rowsToInsert.map((item) => item.label),
        });
        if (mode === "geometry") {
          console.log({
            event: "room_image_objects_geometry_upsert",
            ...identityLog,
            labels: rowsToInsert.map((item) => item.label),
            rowCount: rowsToInsert.length,
            geometryRowCount: normalizedGeometryCount,
            conflictKeyColumns: [
              "user_id",
              "room_id",
              "asset_id",
              "version_id",
              "image_hash",
              "label",
              "source",
            ],
          });
        }
      }
    }

    if (mode === "geometry") {
      return NextResponse.json({ objects: roomReadObjects });
    }
    console.log("[room-image-objects] returned labels", {
      labels: normalizedRoomReadObjects.map((item) => item.label),
    });
    return NextResponse.json({ objects: normalizedRoomReadObjects });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[room-image-objects] failed", { message });
    return NextResponse.json({ error: "Room image object retrieval failed.", message }, { status: 500 });
  }
}
