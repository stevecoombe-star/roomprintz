import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runGeminiRoomReadFromImageUrl } from "@/lib/vibodeGeminiRoomRead";
import type { DetectedRoomObjectLabel } from "@/lib/vibodeRoomObjectLabels";

export const runtime = "nodejs";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

type AnySupabaseClient = SupabaseClient;

type RoomImageObjectRow = {
  label: string;
  confidence: number | null;
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
    const modelVersion = safeStr(body.modelVersion) ?? "gemini-3-flash-preview";
    const allowRoomReadOnMiss = body.allowRoomReadOnMiss === true;
    const source = "gemini_room_read";

    if (!roomId && !assetId && !versionId && !imageHash) {
      console.log("[room-image-objects] skipped because no stable image identity", {
        hasImageUrl: Boolean(imageUrl),
      });
      return NextResponse.json({ objects: [] as DetectedRoomObjectLabel[] });
    }

    let query = supabase
      .from("room_image_objects")
      .select("label, confidence")
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

    const normalizedExisting = normalizeObjects((existingRows ?? []) as RoomImageObjectRow[]);
    if (normalizedExisting.length > 0) {
      console.log("[room-image-objects] fetched from Supabase", {
        count: normalizedExisting.length,
        roomId,
        assetId,
        versionId,
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
      });
      return NextResponse.json({ objects: [] as DetectedRoomObjectLabel[] });
    }

    if (!imageUrl) {
      console.log("[room-image-objects] cache miss and no image URL", {
        roomId,
        assetId,
        versionId,
      });
      return NextResponse.json({ objects: [] as DetectedRoomObjectLabel[] });
    }

    console.log("[room-image-objects] cache miss / running room-read", {
      roomId,
      assetId,
      versionId,
      modelVersion,
    });

    const roomReadObjects = await runGeminiRoomReadFromImageUrl({ imageUrl, modelVersion });
    const normalizedRoomReadObjects = normalizeObjects(roomReadObjects);
    if (normalizedRoomReadObjects.length > 0) {
      const rowsToInsert = normalizedRoomReadObjects.map((item) => ({
        user_id: userId,
        room_id: roomId,
        asset_id: assetId,
        version_id: versionId,
        image_url: imageUrl,
        image_hash: effectiveImageHash,
        label: item.label,
        confidence: item.confidence,
        source,
      }));
      const { error: insertError } = await supabase.from("room_image_objects").upsert(rowsToInsert, {
        onConflict: "user_id,room_id,asset_id,version_id,image_hash,label,source",
        ignoreDuplicates: true,
      });
      if (insertError) {
        console.warn("[room-image-objects] store failed", { message: insertError.message });
      } else {
        console.log("[room-image-objects] stored labels", {
          count: rowsToInsert.length,
          labels: rowsToInsert.map((item) => item.label),
        });
      }
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
