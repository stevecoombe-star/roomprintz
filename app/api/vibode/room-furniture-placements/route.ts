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
  furniture_id: string | null;
  thumbnail_url: string | null;
  source_image_url: string;
  // x/y are normalized canvas coordinates in [0, 1], not pixel positions.
  x: number;
  y: number;
  scale: number;
  rotation: number;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
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
  if (value === null || value === undefined) return null;
  return safeStr(value);
}

function safeFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function safeOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function clampNormalizedCoordinate(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isDurableImageUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  return !/^(https?:\/\/localhost|https?:\/\/127\.0\.0\.1|https?:\/\/0\.0\.0\.0)/i.test(trimmed);
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

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if ("errorResponse" in auth) return auth.errorResponse;

    const roomId = safeStr(req.nextUrl.searchParams.get("roomId"));
    if (!roomId) {
      return jsonError("roomId is required.", 400);
    }

    const { data, error } = await auth.supabase
      .from("room_furniture_placements")
      .select("*")
      .eq("user_id", auth.userId)
      .eq("room_id", roomId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[room-furniture-placements][GET] failed", { message: error.message, roomId });
      return jsonError("Failed to load placement nodes.", 500);
    }

    return NextResponse.json({ nodes: (data ?? []) as PlacementRow[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[room-furniture-placements][GET] unexpected error", { message });
    return jsonError("Unexpected placement fetch error.", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if ("errorResponse" in auth) return auth.errorResponse;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonError("Invalid JSON body.", 400);

    const roomId = safeStr(body.roomId);
    const sourceImageUrl = safeStr(body.sourceImageUrl);
    const x = safeFiniteNumber(body.x);
    const y = safeFiniteNumber(body.y);

    if (!roomId || !sourceImageUrl || x === null || y === null) {
      return jsonError("roomId, sourceImageUrl, x, and y are required.", 400);
    }
    if (!isDurableImageUrl(sourceImageUrl)) {
      return jsonError("sourceImageUrl must be a durable http(s) URL.", 400);
    }

    const furnitureId = safeOptionalStr(body.furnitureId);
    const thumbnailUrl = safeOptionalStr(body.thumbnailUrl);
    const scale = safeFiniteNumber(body.scale) ?? 1;
    const rotation = safeFiniteNumber(body.rotation) ?? 0;
    const isVisible = safeOptionalBoolean(body.isVisible) ?? true;
    const normalizedX = clampNormalizedCoordinate(x);
    const normalizedY = clampNormalizedCoordinate(y);

    const insertPayload = {
      user_id: auth.userId,
      room_id: roomId,
      furniture_id: furnitureId,
      thumbnail_url: thumbnailUrl,
      source_image_url: sourceImageUrl,
      x: normalizedX,
      y: normalizedY,
      scale,
      rotation,
      is_visible: isVisible,
    };

    const { data, error } = await auth.supabase
      .from("room_furniture_placements")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      console.error("[room-furniture-placements][POST] failed", { message: error.message, roomId });
      return jsonError("Failed to create placement node.", 500);
    }

    return NextResponse.json({ node: data as PlacementRow }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[room-furniture-placements][POST] unexpected error", { message });
    return jsonError("Unexpected placement create error.", 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if ("errorResponse" in auth) return auth.errorResponse;

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return jsonError("Invalid JSON body.", 400);

    const id = safeStr(body.id);
    if (!id) return jsonError("id is required.", 400);
    if ("roomId" in body || "room_id" in body) {
      return jsonError("roomId/room_id is immutable and cannot be patched.", 400);
    }

    const patch: Record<string, unknown> = {};
    const furnitureId = safeOptionalStr(body.furnitureId);
    const thumbnailUrl = safeOptionalStr(body.thumbnailUrl);
    const sourceImageUrl = safeOptionalStr(body.sourceImageUrl);
    const x = safeFiniteNumber(body.x);
    const y = safeFiniteNumber(body.y);
    const scale = safeFiniteNumber(body.scale);
    const rotation = safeFiniteNumber(body.rotation);
    const isVisible = safeOptionalBoolean(body.isVisible);

    if (furnitureId !== null) patch.furniture_id = furnitureId;
    if (thumbnailUrl !== null) patch.thumbnail_url = thumbnailUrl;
    if (sourceImageUrl !== null) {
      if (!isDurableImageUrl(sourceImageUrl)) {
        return jsonError("sourceImageUrl must be a durable http(s) URL.", 400);
      }
      patch.source_image_url = sourceImageUrl;
    }
    if (x !== null) patch.x = clampNormalizedCoordinate(x);
    if (y !== null) patch.y = clampNormalizedCoordinate(y);
    if (scale !== null) patch.scale = scale;
    if (rotation !== null) patch.rotation = rotation;
    if (isVisible !== null) patch.is_visible = isVisible;

    if (Object.keys(patch).length === 0) {
      return jsonError("No valid updatable fields provided.", 400);
    }

    const { data, error } = await auth.supabase
      .from("room_furniture_placements")
      .update(patch)
      .eq("id", id)
      .eq("user_id", auth.userId)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("[room-furniture-placements][PATCH] failed", { message: error.message, id });
      return jsonError("Failed to update placement node.", 500);
    }
    if (!data) {
      return jsonError("Placement node not found.", 404);
    }

    return NextResponse.json({ node: data as PlacementRow });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[room-furniture-placements][PATCH] unexpected error", { message });
    return jsonError("Unexpected placement update error.", 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireUser(req);
    if ("errorResponse" in auth) return auth.errorResponse;

    const idFromQuery = safeStr(req.nextUrl.searchParams.get("id"));
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const id = idFromQuery ?? safeStr(body?.id);
    if (!id) {
      return jsonError("id is required.", 400);
    }

    const { data, error } = await auth.supabase
      .from("room_furniture_placements")
      .delete()
      .eq("id", id)
      .eq("user_id", auth.userId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[room-furniture-placements][DELETE] failed", { message: error.message, id });
      return jsonError("Failed to delete placement node.", 500);
    }
    if (!data) {
      return jsonError("Placement node not found.", 404);
    }

    return NextResponse.json({ success: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[room-furniture-placements][DELETE] unexpected error", { message });
    return jsonError("Unexpected placement delete error.", 500);
  }
}
