// app/api/rooms/move/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

type Body = {
  fromPropertyId: string;
  toPropertyId: string;
  roomName: string;
};

type IdRow = {
  id: string;
};

type RoomNameRow = {
  room_name: string | null;
};
type AnySupabaseClient = SupabaseClient<any, "public", any>;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function computeRenamedRoomName(base: string, existingNames: string[]) {
  const trimmedBase = base.trim();
  if (!trimmedBase) return "Room";

  const baseExists = existingNames.includes(trimmedBase);
  if (!baseExists) return trimmedBase;

  const re = new RegExp(`^${escapeRegex(trimmedBase)} \\((\\d+)\\)$`);
  let maxN = 1; // base exists, so next should be at least (2)

  for (const name of existingNames) {
    const m = name.match(re);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (!Number.isNaN(n)) maxN = Math.max(maxN, n);
    }
  }

  return `${trimmedBase} (${maxN + 1})`;
}

export async function POST(req: Request) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonError(
      "Server misconfigured: missing Supabase URL/Anon Key env vars.",
      500
    );
  }

  // Expect Bearer token
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) return jsonError("Missing Authorization bearer token.", 401);

  let body: Body;
  try {
    const parsed: unknown = await req.json();
    body = parsed as Body;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const fromPropertyId = body.fromPropertyId?.trim();
  const toPropertyId = body.toPropertyId?.trim();
  const roomName = body.roomName?.trim();

  if (!fromPropertyId) return jsonError("fromPropertyId is required.");
  if (!toPropertyId) return jsonError("toPropertyId is required.");
  if (!roomName) return jsonError("roomName is required.");
  if (fromPropertyId === toPropertyId) {
    return jsonError("fromPropertyId and toPropertyId must be different.");
  }

  const supabase: AnySupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  // Validate user
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonError("Unauthorized.", 401);
  }
  const userId = userData.user.id;

  // Validate both properties belong to the user
  const { data: props, error: propsErr } = await supabase
    .from("properties")
    .select("id")
    .eq("user_id", userId)
    .in("id", [fromPropertyId, toPropertyId]);

  if (propsErr) {
    console.error("[rooms/move] properties lookup error:", propsErr);
    return jsonError("Failed to validate properties.", 500);
  }

  const propIds = new Set((props ?? []).map((p: IdRow) => p.id));

  if (!propIds.has(fromPropertyId)) {
    return jsonError("Source property not found (or not owned by user).", 404);
  }
  if (!propIds.has(toPropertyId)) {
    return jsonError(
      "Destination property not found (or not owned by user).",
      404
    );
  }

  // Ensure there are jobs to move
  const { data: toMove, error: toMoveErr } = await supabase
    .from("jobs")
    .select("id")
    .eq("user_id", userId)
    .eq("property_id", fromPropertyId)
    .eq("room_name", roomName)
    .limit(1);

  if (toMoveErr) {
    console.error("[rooms/move] source room lookup error:", toMoveErr);
    return jsonError("Failed to locate source room jobs.", 500);
  }
  if (!toMove || toMove.length === 0) {
    return jsonError("No jobs found for that room in the source property.", 404);
  }

  // Find destination room name collisions
  const { data: destNamesRows, error: destNamesErr } = await supabase
    .from("jobs")
    .select("room_name")
    .eq("user_id", userId)
    .eq("property_id", toPropertyId)
    .like("room_name", `${roomName}%`)
    .limit(5000);

  if (destNamesErr) {
    console.error(
      "[rooms/move] destination names lookup error:",
      destNamesErr
    );
    return jsonError("Failed to check destination room name collisions.", 500);
  }

  const existingNames = Array.from(
    new Set(
      (destNamesRows ?? [])
        .map((r: RoomNameRow) => r.room_name?.trim())
        .filter((v): v is string => Boolean(v))
    )
  );

  const newRoomName = computeRenamedRoomName(roomName, existingNames);

  // Perform the move (DB-only)
  const { data: updated, error: updateErr, count } = await supabase
    .from("jobs")
    .update(
      { property_id: toPropertyId, room_name: newRoomName },
      { count: "exact" }
    )
    .eq("user_id", userId)
    .eq("property_id", fromPropertyId)
    .eq("room_name", roomName)
    .select("id");

  if (updateErr) {
    console.error("[rooms/move] update error:", updateErr);
    return jsonError("Failed to move room jobs.", 500);
  }

  const movedCount =
    typeof count === "number" ? count : updated?.length ?? 0;

  return NextResponse.json({
    ok: true,
    movedCount,
    fromPropertyId,
    toPropertyId,
    oldRoomName: roomName,
    newRoomName,
  });
}
