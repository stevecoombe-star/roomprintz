import { restoreProductionAfcRoom } from "@/lib/afc-v2-production/production-adapter.server";
import {
  authorizeProductionAfcUser,
  parseRoomId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import {
  createProductionAfcStoreFromEnv,
  signOwnedOriginalDisplayUrl,
} from "@/lib/afc-v2-production/production-persistence.server";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { validateProductionRuntimeAuthority } from "@/lib/afc-v2-runtime/runtime-authority";

export const runtime = "nodejs";

function roomIdFromRequest(request: Request, body: unknown): string | null {
  const url = new URL(request.url);
  const queryRoomId = parseRoomId(url.searchParams.get("roomId"));
  if (queryRoomId) return queryRoomId;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return parseRoomId((body as Record<string, unknown>).roomId);
}

async function restoreRuntime(request: Request, body: unknown) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;

  const roomId = roomIdFromRequest(request, body);
  if (!roomId) {
    return productionAfcJson({ error: "roomId is required." }, 400);
  }

  const store = createProductionAfcStoreFromEnv();
  const service = getServiceRoleSupabaseClient();
  if (!store || !service) {
    return productionAfcJson({ error: "Server misconfigured." }, 500);
  }

  const room = await store.getRoom(roomId);
  if (!room || room.userId !== auth.userId) {
    return productionAfcJson({ error: "Room not found." }, 404);
  }

  const restored = await restoreProductionAfcRoom({
    roomId,
    userId: auth.userId,
    store,
  });

  if (restored.status !== "ready" || !restored.authority) {
    return productionAfcJson({
      ...restored,
      originalImageUrl: null,
    }, 200);
  }

  const validated = validateProductionRuntimeAuthority(restored.authority);
  if (!validated.ok) {
    return productionAfcJson({
      status: "none",
      generationId: restored.generationId,
      currentGenerationId: restored.currentGenerationId,
      authority: null,
      failureReason: validated.reason,
      frame: restored.frame,
      originalImageUrl: null,
    }, 200);
  }

  const originalImageUrl = await signOwnedOriginalDisplayUrl(service, {
    userId: auth.userId,
    room,
  });
  if (!originalImageUrl) {
    return productionAfcJson({
      status: "none",
      generationId: restored.generationId,
      currentGenerationId: restored.currentGenerationId,
      authority: null,
      failureReason: "ORIGINAL image URL is unavailable.",
      frame: restored.frame,
      originalImageUrl: null,
    }, 200);
  }

  return productionAfcJson({
    ...restored,
    authority: validated.authority,
    originalImageUrl,
  }, 200);
}

export async function GET(request: Request) {
  return restoreRuntime(request, null);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  return restoreRuntime(request, body);
}
