import {
  runProductionAfcAnalysis,
} from "@/lib/afc-v2-production/production-adapter.server";
import {
  authorizeProductionAfcUser,
  parseProductionAfcIntent,
  parseRoomId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return productionAfcJson({ error: "Invalid request." }, 400);
  }
  const record = body as Record<string, unknown>;
  const roomId = parseRoomId(record.roomId);
  if (!roomId) {
    return productionAfcJson({ error: "roomId is required." }, 400);
  }
  const intent = parseProductionAfcIntent(record.intent);
  if (intent === "invalid") {
    return productionAfcJson({ error: "Invalid AFC intent." }, 400);
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

  const original = await loadOwnedOriginalForProductionAnalysis(service, {
    userId: auth.userId,
    room,
  });
  if (!original.ok) {
    return productionAfcJson({ error: "ORIGINAL image is unavailable." }, 422);
  }

  const result = await runProductionAfcAnalysis({
    roomId,
    userId: auth.userId,
    intent,
    store,
    original: {
      bytes: original.bytes,
      sourceImageUrl: original.sourceImageUrl,
    },
  });

  if (result.status === "failed" && result.generationId === null) {
    return productionAfcJson(
      { error: result.failureReason ?? "AFC analysis failed." },
      404,
    );
  }

  return productionAfcJson(result, result.status === "ready" ? 200 : 422);
}
