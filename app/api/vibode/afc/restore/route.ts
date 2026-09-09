import {
  restoreProductionAfcRoom,
} from "@/lib/afc-v2-production/production-adapter.server";
import {
  authorizeProductionAfcUser,
  parseRoomId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { createProductionAfcStoreFromEnv } from "@/lib/afc-v2-production/production-persistence.server";

export const runtime = "nodejs";

function roomIdFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  const queryRoomId = parseRoomId(url.searchParams.get("roomId"));
  return queryRoomId;
}

export async function GET(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;

  const roomId = roomIdFromRequest(request);
  if (!roomId) {
    return productionAfcJson({ error: "roomId is required." }, 400);
  }

  const store = createProductionAfcStoreFromEnv();
  if (!store) {
    return productionAfcJson({ error: "Server misconfigured." }, 500);
  }

  const room = await store.getRoom(roomId);
  if (!room || room.userId !== auth.userId) {
    return productionAfcJson({ error: "Room not found." }, 404);
  }

  const result = await restoreProductionAfcRoom({
    roomId,
    userId: auth.userId,
    store,
  });
  return productionAfcJson(result, 200);
}

export async function POST(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const roomId = body && typeof body === "object" && !Array.isArray(body)
    ? parseRoomId((body as Record<string, unknown>).roomId)
    : null;
  if (!roomId) {
    return productionAfcJson({ error: "roomId is required." }, 400);
  }

  const store = createProductionAfcStoreFromEnv();
  if (!store) {
    return productionAfcJson({ error: "Server misconfigured." }, 500);
  }

  const room = await store.getRoom(roomId);
  if (!room || room.userId !== auth.userId) {
    return productionAfcJson({ error: "Room not found." }, 404);
  }

  const result = await restoreProductionAfcRoom({
    roomId,
    userId: auth.userId,
    store,
  });
  return productionAfcJson(result, 200);
}
