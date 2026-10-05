import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { parseRoomId } from "@/lib/afc-v2-production/production-http";
import { refreshOwnedRoomThumbnail } from "@/lib/vibode-room-preview/refresh-room-thumbnail.server";
import {
  ROOM_THUMBNAIL_REFRESH_ERROR_MESSAGE,
  roomThumbnailRefreshHttpStatus,
} from "@/lib/vibode-room-preview/refresh-room-thumbnail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

const NO_STORE = { "Cache-Control": "private, no-store" };

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)/i.exec(authHeader);
  return match?.[1] ?? null;
}

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return jsonError("Server misconfigured: missing Supabase URL/anon key.", 500);
    }

    const token = getBearerToken(req);
    if (!token) {
      return jsonError("Unauthorized: missing Authorization Bearer token.", 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON body.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return jsonError("roomId is required.", 400);
    }
    const roomId = parseRoomId((body as { roomId?: unknown }).roomId);
    if (!roomId) {
      return jsonError("roomId is required.", 400);
    }

    const userSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: userData, error: userErr } = await userSupabase.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonError("Unauthorized.", 401);
    }

    const refreshed = await refreshOwnedRoomThumbnail({
      userSupabase,
      userId: userData.user.id,
      roomId,
    });
    if (!refreshed.ok) {
      console.warn("[vibode/room-thumbnail-refresh] failed", { roomId, code: refreshed.code });
      return jsonError(
        ROOM_THUMBNAIL_REFRESH_ERROR_MESSAGE,
        roomThumbnailRefreshHttpStatus(refreshed.code),
      );
    }

    return NextResponse.json(
      {
        ok: true,
        previewUrl: refreshed.previewUrl,
        cacheVersion: refreshed.cacheVersion,
      },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[vibode/room-thumbnail-refresh] unexpected error:", err);
    return jsonError(ROOM_THUMBNAIL_REFRESH_ERROR_MESSAGE, 500);
  }
}
