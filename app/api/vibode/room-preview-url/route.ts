import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

const PREVIEW_SIGNED_URL_EXPIRES_IN_SEC = Math.max(
  60,
  Number(process.env.VIBODE_PREVIEW_SIGNED_URL_EXPIRES_IN ?? 60 * 60 * 8)
);

type AnySupabaseClient = SupabaseClient<any, "public", any>;

type RoomRow = {
  id: string;
  user_id: string;
  cover_image_url: string | null;
  active_asset_id: string | null;
};

type RoomAssetRow = {
  id: string;
  image_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  created_at: string | null;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeText(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function isLikelyExpiringSignedUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/storage/v1/object/sign/")) return true;
    if (parsed.searchParams.has("token")) return true;
    if (parsed.searchParams.has("X-Amz-Signature")) return true;
    if (parsed.searchParams.has("X-Amz-Credential")) return true;
    return false;
  } catch {
    return false;
  }
}

function getDurablePreviewUrl(candidateUrl: string | null | undefined): string | null {
  const url = normalizeText(candidateUrl);
  if (!url) return null;
  if (url.toLowerCase().startsWith("data:image/")) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  if (isLikelyExpiringSignedUrl(url)) return null;
  return url;
}

function parseRoomId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const maybeRoomId = (body as { roomId?: unknown }).roomId;
  if (typeof maybeRoomId !== "string") return null;
  const roomId = maybeRoomId.trim();
  return roomId.length > 0 ? roomId : null;
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
  }
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice("bearer ".length).trim();
    return token.length > 0 ? token : null;
  }
  return null;
}

function getUserSupabaseClient(token: string): AnySupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function getAdminSupabaseClient(): AnySupabaseClient | null {
  if (!SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function getActiveAssetForRoom(
  supabase: AnySupabaseClient,
  args: {
    roomId: string;
    userId: string;
    activeAssetId: string | null;
  }
): Promise<RoomAssetRow | null> {
  const columns = "id,image_url,storage_bucket,storage_path,created_at";

  if (args.activeAssetId) {
    const { data, error } = await supabase
      .from("vibode_room_assets")
      .select(columns)
      .eq("id", args.activeAssetId)
      .eq("room_id", args.roomId)
      .eq("user_id", args.userId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to fetch active room asset: ${error.message}`);
    }
    if (data) return data as RoomAssetRow;
  }

  const { data, error } = await supabase
    .from("vibode_room_assets")
    .select(columns)
    .eq("room_id", args.roomId)
    .eq("user_id", args.userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to fetch fallback active room asset: ${error.message}`);
  }
  return (data as RoomAssetRow | null) ?? null;
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

    const roomId = parseRoomId(body);
    if (!roomId) {
      return jsonError("roomId is required.", 400);
    }

    const userSupabase = getUserSupabaseClient(token);
    const { data: userData, error: userErr } = await userSupabase.auth.getUser();
    if (userErr || !userData?.user) {
      return jsonError("Unauthorized.", 401);
    }
    const userId = userData.user.id;

    const { data: roomData, error: roomErr } = await userSupabase
      .from("vibode_rooms")
      .select("id,user_id,cover_image_url,active_asset_id")
      .eq("id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (roomErr) {
      console.error("[vibode/room-preview-url] room lookup failed:", roomErr);
      return jsonError("Failed to load room preview.", 500);
    }
    if (!roomData) {
      return jsonError("Room not found.", 404);
    }
    const room = roomData as RoomRow;

    // a) trusted durable room cover image URL
    const coverPreviewUrl = getDurablePreviewUrl(room.cover_image_url);
    if (coverPreviewUrl) {
      return NextResponse.json({ previewUrl: coverPreviewUrl });
    }

    const activeAsset = await getActiveAssetForRoom(userSupabase, {
      roomId: room.id,
      userId,
      activeAssetId: room.active_asset_id,
    });
    if (!activeAsset) {
      return NextResponse.json({ previewUrl: null });
    }

    // b) durable direct URL on active room asset
    const assetPreviewUrl = getDurablePreviewUrl(activeAsset.image_url);
    if (assetPreviewUrl) {
      return NextResponse.json({ previewUrl: assetPreviewUrl });
    }

    // c) storage bucket/path on active room asset -> server-side signed URL
    const bucket = normalizeText(activeAsset.storage_bucket);
    const storagePath = normalizeText(activeAsset.storage_path);
    if (!bucket || !storagePath) {
      return NextResponse.json({ previewUrl: null });
    }

    const adminSupabase = getAdminSupabaseClient();
    if (!adminSupabase) {
      console.warn("[vibode/room-preview-url] service role key missing; cannot sign preview URL.");
      return NextResponse.json({ previewUrl: null });
    }

    const { data: signed, error: signErr } = await adminSupabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, PREVIEW_SIGNED_URL_EXPIRES_IN_SEC);
    if (signErr || !signed?.signedUrl) {
      console.warn("[vibode/room-preview-url] failed to sign storage preview URL:", signErr);
      return NextResponse.json({ previewUrl: null });
    }

    return NextResponse.json({ previewUrl: signed.signedUrl });
  } catch (err) {
    console.error("[vibode/room-preview-url] unexpected error:", err);
    return jsonError("Unexpected room preview error.", 500);
  }
}
