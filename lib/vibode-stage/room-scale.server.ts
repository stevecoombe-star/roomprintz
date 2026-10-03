import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  authorizeProductionAfcUser,
  parseRoomId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";

import {
  ROOM_SCALE_RANGE_ERROR,
  parseRoomScaleMultiplier,
  type RoomScaleResult,
  type RoomScaleStore,
} from "./room-scale";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function createSupabaseRoomScaleStore(): RoomScaleStore | null {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return null;
  return {
    async read(userId, roomId) {
      const { data, error } = await supabase
        .from("vibode_rooms")
        .select("user_id, room_scale_multiplier")
        .eq("id", roomId)
        .maybeSingle();
      if (error) return { ok: false, status: 500, error: "Failed to load room scale." };
      if (!data || data.user_id !== userId) {
        return { ok: false, status: 404, error: "Room not found." };
      }
      const multiplier = parseRoomScaleMultiplier(data.room_scale_multiplier) ?? 1;
      return { ok: true, roomScaleMultiplier: multiplier };
    },
    async write(userId, roomId, roomScaleMultiplier) {
      const parsed = parseRoomScaleMultiplier(roomScaleMultiplier);
      if (parsed == null) {
        return { ok: false, status: 400, error: ROOM_SCALE_RANGE_ERROR };
      }
      const { data, error } = await supabase
        .from("vibode_rooms")
        .update({ room_scale_multiplier: parsed })
        .eq("id", roomId)
        .eq("user_id", userId)
        .select("room_scale_multiplier")
        .maybeSingle();
      if (error) return { ok: false, status: 500, error: "Failed to save room scale." };
      if (!data) return { ok: false, status: 404, error: "Room not found." };
      return { ok: true, roomScaleMultiplier: parsed };
    },
  };
}

function roomIdFromRequest(request: Request, body: unknown): string | null {
  const url = new URL(request.url);
  const record = isRecord(body) ? body : null;
  return parseRoomId(url.searchParams.get("roomId")) ?? parseRoomId(record?.roomId);
}

export async function readOwnedRoomScale(
  store: RoomScaleStore,
  userId: string,
  roomId: string,
): Promise<RoomScaleResult> {
  return store.read(userId, roomId);
}

export async function writeOwnedRoomScale(
  store: RoomScaleStore,
  userId: string,
  roomId: string,
  roomScaleMultiplier: number,
): Promise<RoomScaleResult> {
  return store.write(userId, roomId, roomScaleMultiplier);
}

export async function handleStageRoomScaleGet(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;
  const roomId = roomIdFromRequest(request, null);
  if (!roomId) return productionAfcJson({ error: "roomId is required." }, 400);
  const store = createSupabaseRoomScaleStore();
  if (!store) return productionAfcJson({ error: "Server misconfigured." }, 500);
  const result = await readOwnedRoomScale(store, auth.userId, roomId);
  if (!result.ok) return productionAfcJson({ error: result.error }, result.status);
  return productionAfcJson({ roomScaleMultiplier: result.roomScaleMultiplier }, 200);
}

export async function handleStageRoomScalePut(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const roomId = roomIdFromRequest(request, body);
  if (!roomId) return productionAfcJson({ error: "roomId is required." }, 400);
  const multiplier = parseRoomScaleMultiplier(
    isRecord(body) ? body.roomScaleMultiplier : null,
  );
  if (multiplier == null) {
    return productionAfcJson({ error: ROOM_SCALE_RANGE_ERROR }, 400);
  }
  const store = createSupabaseRoomScaleStore();
  if (!store) return productionAfcJson({ error: "Server misconfigured." }, 500);
  const result = await writeOwnedRoomScale(store, auth.userId, roomId, multiplier);
  if (!result.ok) return productionAfcJson({ error: result.error }, result.status);
  return productionAfcJson({ roomScaleMultiplier: result.roomScaleMultiplier }, 200);
}
