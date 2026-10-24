import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runGeminiRoomReadFromImageBytes } from "@/lib/vibodeGeminiRoomRead";
import { getRequestIdFromHeaders } from "@/lib/vibodeGeminiUsageAccounting";
import type { DetectedRoomObjectLabel } from "@/lib/vibodeRoomObjectLabels";
import {
  detectRoomImage,
  downloadSupabaseStorageObject,
  isUuid,
  parseRoomImageReadCompletion,
  parseRoomImageReadReservation,
  resolveOwnedRoomImageLocation,
  sameUuid,
  type CompletionDecision,
  type ReservationDecision,
  type StorageDownloadResult,
} from "@/lib/vibodeRoomImageObjectSecurity";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;

const ROOM_IMAGE_READ_OPERATION = "room_image_read";

type OwnedAssetLoad =
  | {
      ok: true;
      storageBucket: string | null;
      storagePath: string | null;
      imageUrl: string | null;
    }
  | { ok: false; reason: "not_found" | "unavailable" };

export type RoomImageObjectsDependencies = {
  authenticate(req: NextRequest): Promise<{ userId: string } | null>;
  fetchCachedObjects(args: {
    userId: string;
    roomId: string | null;
    assetId: string | null;
    versionId: string | null;
    imageHash: string | null;
    source: string;
  }): Promise<{ ok: true; rows: RoomImageObjectRow[] } | { ok: false }>;
  loadOwnedAsset(args: { userId: string; roomId: string; assetId: string }): Promise<OwnedAssetLoad>;
  reserve(args: {
    userId: string;
    roomId: string;
    assetId: string;
    mode: RoomReadMode;
  }): Promise<ReservationDecision>;
  complete(args: {
    userId: string;
    attemptId: string;
    outcome: "succeeded" | "failed";
  }): Promise<CompletionDecision>;
  downloadOwnedImage(args: {
    userId: string;
    roomId: string;
    bucket: string;
    objectPath: string;
  }): Promise<StorageDownloadResult>;
  readRoom(args: {
    imageBytes: Uint8Array;
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    mode: RoomReadMode;
    purpose: RoomImageObjectsPurpose;
    userId: string;
    roomId: string;
    assetId: string;
    versionId: string;
    attemptId: string;
    requestId: string;
    sourceTrigger: string;
  }): Promise<DetectedRoomObjectLabel[]>;
  storeObjects(rows: RoomImageObjectUpsertRow[]): Promise<void>;
};

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

function supabaseBrowserEnv(): { url: string; anonKey: string } {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  };
}

function supabaseServiceEnv(): { url: string; serviceRoleKey: string } {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "",
  };
}

function getUserSupabaseClient(
  req: NextRequest
): { supabase: AnySupabaseClient | null; token: string | null } {
  const { url, anonKey } = supabaseBrowserEnv();
  if (!url || !anonKey) return { supabase: null, token: null };
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  if (!token) return { supabase: null, token: null };
  const supabase: AnySupabaseClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { supabase, token };
}

function createServiceRoleClient(): AnySupabaseClient | null {
  const { url, serviceRoleKey } = supabaseServiceEnv();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function logProviderDiagnostic(event: string, fields: Record<string, string | number | boolean | null>): void {
  console.warn("[room-image-objects]", { event, ...fields });
}

function hashImageIdentity(value: string | null): string | null {
  if (!value) return null;
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(req: NextRequest) {
  return handleRoomImageObjectsRequest(req, createProductionRoomImageObjectsDependencies());
}

export async function handleRoomImageObjectsRequest(
  req: NextRequest,
  deps: RoomImageObjectsDependencies,
) {
  try {
    const auth = await deps.authenticate(req);
    if (!auth) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = auth.userId;

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return NextResponse.json({ error: "Invalid request." }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const roomId = safeStr(body.roomId) ?? safeStr(body.vibodeRoomId);
    const assetId = safeStr(body.assetId);
    const suppliedVersionId = safeStr(body.versionId);
    const versionId = suppliedVersionId ?? assetId;
    const imageUrl = safeStr(body.imageUrl);
    const imageHash = safeStr(body.imageHash) ?? hashImageIdentity(imageUrl);
    const hasVersionIdentity = Boolean(roomId || assetId || versionId);
    const effectiveImageHash = hasVersionIdentity
      ? hashImageIdentity(`${roomId ?? ""}|${assetId ?? ""}|${versionId ?? ""}`)
      : imageHash;
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

    const cached = await deps.fetchCachedObjects({
      userId,
      roomId,
      assetId,
      versionId,
      imageHash: effectiveImageHash,
      source,
    });
    if (!cached.ok) {
      console.warn("[room-image-objects] fetch failed", { reason: "cache_read" });
      return NextResponse.json({ error: "Failed to fetch room image objects." }, { status: 500 });
    }

    const storedObjects = normalizeStoredObjects(cached.rows);
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

    const authorized = resolveProviderIdentity({ roomId, assetId, suppliedVersionId });
    if (!authorized) {
      logProviderDiagnostic("provider_denied", { reason: "identity", purpose, mode });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const owned = await deps.loadOwnedAsset({
      userId,
      roomId: authorized.roomId,
      assetId: authorized.assetId,
    });
    if (!owned.ok) {
      if (owned.reason === "unavailable") {
        logProviderDiagnostic("provider_denied", { reason: "ownership_unavailable", purpose, mode });
        return NextResponse.json({ error: "Room image object retrieval failed." }, { status: 503 });
      }
      logProviderDiagnostic("provider_denied", { reason: "ownership", purpose, mode });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const location = resolveOwnedRoomImageLocation({
      userId,
      roomId: authorized.roomId,
      storageBucket: owned.storageBucket,
      storagePath: owned.storagePath,
      imageUrl: owned.imageUrl,
      supabaseUrl: supabaseBrowserEnv().url,
    });
    if (!location) {
      console.log("[room-image-objects] cache miss and no authorized image", {
        roomId: authorized.roomId,
        assetId: authorized.assetId,
        versionId: authorized.versionId,
        purpose,
      });
      return NextResponse.json({ objects: [] as DetectedRoomObjectLabel[] });
    }

    const downloaded = await deps.downloadOwnedImage({
      userId,
      roomId: authorized.roomId,
      bucket: location.bucket,
      objectPath: location.objectPath,
    });
    if (!downloaded.ok) {
      logProviderDiagnostic("image_rejected", { reason: downloaded.reason, purpose, mode });
      if (downloaded.reason === "not_found") {
        return NextResponse.json({ objects: [] as DetectedRoomObjectLabel[] });
      }
      if (downloaded.reason === "unavailable") {
        return NextResponse.json({ error: "Room image object retrieval failed." }, { status: 503 });
      }
      return NextResponse.json({ error: "Invalid image." }, { status: 400 });
    }
    const detected = detectRoomImage(downloaded.bytes, downloaded.contentType);
    if (!detected.ok) {
      logProviderDiagnostic("image_rejected", { reason: detected.reason, purpose, mode });
      return NextResponse.json({ error: "Invalid image." }, { status: 400 });
    }

    const reservation = await deps.reserve({
      userId,
      roomId: authorized.roomId,
      assetId: authorized.assetId,
      mode,
    });
    if (reservation.status === "busy" || reservation.status === "quota") {
      logProviderDiagnostic("reservation_rejected", { reason: reservation.status, purpose, mode });
      return NextResponse.json({ error: "Too many requests." }, { status: 429 });
    }
    if (reservation.status === "forbidden") {
      logProviderDiagnostic("reservation_rejected", { reason: "forbidden", purpose, mode });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (reservation.status !== "reserved") {
      logProviderDiagnostic("reservation_rejected", { reason: reservation.status, purpose, mode });
      return NextResponse.json({ error: "Room image object retrieval failed." }, { status: 503 });
    }

    console.log("[room-image-objects] cache miss / running room-read", {
      roomId: authorized.roomId,
      assetId: authorized.assetId,
      versionId: authorized.versionId,
      purpose,
      mode,
      bucket: location.bucket,
    });

    let providerOutcome: "succeeded" | "failed" = "failed";
    try {
    const roomReadObjects = await deps.readRoom({
      imageBytes: downloaded.bytes,
      mimeType: detected.mime,
      mode,
      purpose,
      userId,
      roomId: authorized.roomId,
      assetId: authorized.assetId,
      versionId: authorized.versionId,
      attemptId: reservation.attemptId,
      requestId,
      sourceTrigger,
    });
    providerOutcome = "succeeded";
    const normalizedRoomReadObjects = normalizeFreshRoomReadObjects(mode, roomReadObjects);
    const normalizedGeometryCount = countGeometryObjects(normalizedRoomReadObjects);
    const authorizedImageHash = hashImageIdentity(
      `${authorized.roomId}|${authorized.assetId}|${authorized.versionId}`,
    );
    if (normalizedRoomReadObjects.length > 0) {
      const rowsToInsertRaw: RoomImageObjectUpsertRow[] = normalizedRoomReadObjects.map((item) => ({
        user_id: userId,
        room_id: authorized.roomId,
        asset_id: authorized.assetId,
        version_id: authorized.versionId,
        // image_url is nullable and is not part of the conflict key. Never store a signed URL.
        image_url: null,
        image_hash: authorizedImageHash,
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
      let stored = false;
      try {
        await deps.storeObjects(rowsToInsert);
        stored = true;
      } catch {
        console.warn("[room-image-objects] store failed", { reason: "upsert" });
      }
      if (stored) {
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
    } finally {
      try {
        const completed = await deps.complete({
          userId,
          attemptId: reservation.attemptId,
          outcome: providerOutcome,
        });
        if (completed.status !== "completed" && completed.status !== "already_terminal") {
          logProviderDiagnostic("completion_failed", { reason: completed.status, purpose, mode });
        }
      } catch {
        logProviderDiagnostic("completion_failed", { reason: "exception", purpose, mode });
      }
    }
  } catch (err: unknown) {
    console.warn("[room-image-objects] failed", { reason: safeErrorCode(err) });
    return NextResponse.json({ error: "Room image object retrieval failed." }, { status: 500 });
  }
}

function safeErrorCode(err: unknown): string {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code)) return code;
  }
  if (err instanceof Error && /^[A-Za-z][A-Za-z0-9_]*$/.test(err.name)) return err.name;
  return "unknown";
}

function resolveProviderIdentity(args: {
  roomId: string | null;
  assetId: string | null;
  suppliedVersionId: string | null;
}): { roomId: string; assetId: string; versionId: string } | null {
  if (!args.roomId || !args.assetId) return null;
  if (!isUuid(args.roomId) || !isUuid(args.assetId)) return null;
  if (args.suppliedVersionId !== null && args.suppliedVersionId !== args.assetId) return null;
  return { roomId: args.roomId, assetId: args.assetId, versionId: args.assetId };
}

export async function readAuthorizedRoomImage(args: {
  imageBytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  mode: RoomReadMode;
  purpose: RoomImageObjectsPurpose;
  userId: string;
  roomId: string;
  assetId: string;
  versionId: string;
  attemptId: string;
  requestId: string;
  sourceTrigger: string;
}): Promise<DetectedRoomObjectLabel[]> {
  return runGeminiRoomReadFromImageBytes({
    imageBytes: args.imageBytes,
    mimeType: args.mimeType,
    mode: args.mode,
    purpose: args.purpose,
    accounting: {
      requestId: args.requestId,
      attemptId: args.attemptId,
      route: "/api/vibode/room-image-objects",
      sourceTrigger: args.sourceTrigger,
      workflowType: "room-read",
      actionType: "room-image-objects",
      userId: args.userId,
      roomId: args.roomId,
      versionId: args.versionId,
      assetId: args.assetId,
    },
  });
}

function createProductionRoomImageObjectsDependencies(): RoomImageObjectsDependencies {
  let userClient: AnySupabaseClient | null = null;
  return {
    async authenticate(req) {
      try {
        const { supabase, token } = getUserSupabaseClient(req);
        if (!supabase || !token) return null;
        userClient = supabase;
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user?.id || !isUuid(data.user.id)) return null;
        return { userId: data.user.id };
      } catch {
        logProviderDiagnostic("auth_failed", { reason: "exception" });
        return null;
      }
    },
    async fetchCachedObjects(args) {
      if (!userClient) return { ok: false };
      let query = userClient
        .from("room_image_objects")
        .select("label, confidence, center_x, center_y, bbox")
        .eq("user_id", args.userId)
        .eq("source", args.source);
      if (args.roomId) query = query.eq("room_id", args.roomId);
      if (args.assetId) query = query.eq("asset_id", args.assetId);
      if (args.versionId) query = query.eq("version_id", args.versionId);
      if (args.imageHash) query = query.eq("image_hash", args.imageHash);
      const { data, error } = await query;
      if (error) return { ok: false };
      return { ok: true, rows: (data ?? []) as RoomImageObjectRow[] };
    },
    async loadOwnedAsset(args) {
      const admin = createServiceRoleClient();
      if (!admin) return { ok: false, reason: "unavailable" };
      try {
        const room = await admin
          .from("vibode_rooms")
          .select("id,user_id")
          .eq("id", args.roomId)
          .eq("user_id", args.userId)
          .maybeSingle();
        if (room.error) return { ok: false, reason: "unavailable" };
        if (
          !room.data ||
          !sameUuid(String(room.data.id), args.roomId) ||
          !sameUuid(String(room.data.user_id), args.userId)
        ) {
          return { ok: false, reason: "not_found" };
        }
        const asset = await admin
          .from("vibode_room_assets")
          .select("id,room_id,user_id,storage_bucket,storage_path,image_url")
          .eq("id", args.assetId)
          .eq("room_id", args.roomId)
          .eq("user_id", args.userId)
          .maybeSingle();
        if (asset.error) return { ok: false, reason: "unavailable" };
        if (
          !asset.data ||
          !sameUuid(String(asset.data.id), args.assetId) ||
          !sameUuid(String(asset.data.room_id), args.roomId) ||
          !sameUuid(String(asset.data.user_id), args.userId)
        ) {
          return { ok: false, reason: "not_found" };
        }
        return {
          ok: true,
          storageBucket: typeof asset.data.storage_bucket === "string" ? asset.data.storage_bucket : null,
          storagePath: typeof asset.data.storage_path === "string" ? asset.data.storage_path : null,
          imageUrl: typeof asset.data.image_url === "string" ? asset.data.image_url : null,
        };
      } catch {
        return { ok: false, reason: "unavailable" };
      }
    },
    async reserve(args) {
      const admin = createServiceRoleClient();
      if (!admin) return { status: "unavailable" };
      try {
        const { data, error } = await admin.rpc("reserve_vibode_room_image_read", {
          p_user_id: args.userId,
          p_room_id: args.roomId,
          p_asset_id: args.assetId,
          p_mode: args.mode,
          p_operation: ROOM_IMAGE_READ_OPERATION,
        });
        if (error) {
          const code =
            typeof error.code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(error.code) ? error.code : "rpc_error";
          logProviderDiagnostic("reservation_failed", { reason: code });
          return { status: "unavailable" };
        }
        const parsed = parseRoomImageReadReservation(data);
        if (parsed.status === "unavailable") {
          logProviderDiagnostic("reservation_failed", { reason: "invalid_result" });
        }
        return parsed;
      } catch {
        logProviderDiagnostic("reservation_failed", { reason: "exception" });
        return { status: "unavailable" };
      }
    },
    async complete(args) {
      const admin = createServiceRoleClient();
      if (!admin) return { status: "unavailable" };
      try {
        const { data, error } = await admin.rpc("complete_vibode_room_image_read", {
          p_user_id: args.userId,
          p_attempt_id: args.attemptId,
          p_outcome: args.outcome,
        });
        if (error) return { status: "unavailable" };
        return parseRoomImageReadCompletion(data);
      } catch {
        return { status: "unavailable" };
      }
    },
    async downloadOwnedImage(args) {
      const { url, serviceRoleKey } = supabaseServiceEnv();
      return downloadSupabaseStorageObject({
        supabaseUrl: url,
        serviceRoleKey,
        bucket: args.bucket,
        objectPath: args.objectPath,
        userId: args.userId,
        roomId: args.roomId,
      });
    },
    readRoom: readAuthorizedRoomImage,
    async storeObjects(rows) {
      if (!userClient) throw new Error("store_unavailable");
      const { error } = await userClient.from("room_image_objects").upsert(rows, {
        onConflict: "user_id,room_id,asset_id,version_id,image_hash,label,source",
      });
      if (error) throw new Error("store_failed");
    },
  };
}
