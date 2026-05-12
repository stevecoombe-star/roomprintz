import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

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

type RevertSnapshotRow = {
  id: string;
  furnitureId: string | null;
  thumbnailUrl: string | null;
  thumbnailPath: string | null;
  sourceImageUrl: string;
  sourceImagePath: string | null;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  isVisible: boolean;
};

function jsonError(message: string, status: number, details?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(details ? { details } : {}) }, { status });
}

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeOptionalStr(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return safeStr(value);
}

function safeFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

function getUserSupabaseClient(token: string): AnySupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function requireUser(req: NextRequest): Promise<
  | { supabase: AnySupabaseClient; userId: string }
  | { errorResponse: NextResponse }
> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return { errorResponse: jsonError("Server misconfigured: missing Supabase env.", 500) };
  }
  const token = getBearerToken(req);
  if (!token) {
    return { errorResponse: jsonError("Unauthorized: missing Authorization Bearer token.", 401) };
  }
  const supabase = getUserSupabaseClient(token);
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return { errorResponse: jsonError("Unauthorized.", 401) };
  }
  return { supabase, userId: userData.user.id };
}

function parseSnapshotRow(value: unknown): RevertSnapshotRow | null {
  if (!isRecord(value)) return null;
  const id = safeStr(value.id);
  const sourceImageUrl = safeStr(value.sourceImageUrl) ?? safeStr(value.source_image_url);
  const x = safeFiniteNumber(value.x);
  const y = safeFiniteNumber(value.y);
  if (!id || !sourceImageUrl || x === null || y === null) return null;
  const scale = safeFiniteNumber(value.scale) ?? 1;
  const rotation = safeFiniteNumber(value.rotation) ?? 0;
  const isVisibleRaw = value.isVisible ?? value.is_visible;
  return {
    id,
    furnitureId: safeOptionalStr(value.furnitureId) ?? safeOptionalStr(value.furniture_id),
    thumbnailUrl: safeOptionalStr(value.thumbnailUrl) ?? safeOptionalStr(value.thumbnail_url),
    thumbnailPath: safeOptionalStr(value.thumbnailPath) ?? safeOptionalStr(value.thumbnail_path),
    sourceImageUrl,
    sourceImagePath: safeOptionalStr(value.sourceImagePath) ?? safeOptionalStr(value.source_image_path),
    x,
    y,
    scale,
    rotation,
    isVisible: typeof isVisibleRaw === "boolean" ? isVisibleRaw : true,
  };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if ("errorResponse" in auth) return auth.errorResponse;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonError("Invalid JSON body.", 400);

    const roomId = safeStr(body.roomId);
    const versionId = safeStr(body.versionId);
    const snapshotRaw = body.snapshot;
    if (!roomId || !versionId || !Array.isArray(snapshotRaw)) {
      return jsonError("roomId, versionId, and snapshot array are required.", 400);
    }

    const snapshot = snapshotRaw.map((entry) => parseSnapshotRow(entry));
    if (snapshot.some((entry) => !entry)) {
      return jsonError("snapshot contains invalid placement rows.", 400);
    }
    const typedSnapshot = snapshot as RevertSnapshotRow[];

    const { data: roomData, error: roomErr } = await auth.supabase
      .from("vibode_rooms")
      .select("id")
      .eq("id", roomId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (roomErr) {
      return jsonError("Failed to load room.", 500);
    }
    if (!roomData) {
      return jsonError("Room not found.", 404);
    }

    const { data: versionData, error: versionErr } = await auth.supabase
      .from("vibode_room_assets")
      .select("id")
      .eq("id", versionId)
      .eq("room_id", roomId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (versionErr) {
      return jsonError("Failed to load room version.", 500);
    }
    if (!versionData) {
      return jsonError("Version not found.", 404);
    }

    const { error: deleteErr } = await auth.supabase
      .from("room_furniture_placements")
      .delete()
      .eq("user_id", auth.userId)
      .eq("room_id", roomId)
      .eq("version_id", versionId);
    if (deleteErr) {
      return jsonError("Failed to clear placement nodes for revert.", 500);
    }

    if (typedSnapshot.length === 0) {
      return NextResponse.json({ nodes: [] as PlacementRow[] });
    }

    const rowsToInsert = typedSnapshot.map((row) => ({
      id: row.id,
      user_id: auth.userId,
      room_id: roomId,
      version_id: versionId,
      furniture_id: row.furnitureId,
      thumbnail_url: row.thumbnailUrl,
      thumbnail_path: row.thumbnailPath,
      source_image_url: row.sourceImageUrl,
      source_image_path: row.sourceImagePath,
      x: row.x,
      y: row.y,
      scale: row.scale,
      rotation: row.rotation,
      is_visible: row.isVisible,
    }));

    const { data: insertedRows, error: insertErr } = await auth.supabase
      .from("room_furniture_placements")
      .insert(rowsToInsert)
      .select("*");
    if (insertErr) {
      return jsonError("Failed to restore placement nodes from snapshot.", 500);
    }

    const sortedRows = ((insertedRows ?? []) as PlacementRow[]).sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );
    return NextResponse.json({ nodes: sortedRows });
  } catch {
    return jsonError("Unexpected placement revert error.", 500);
  }
}
