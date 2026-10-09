import { NextResponse } from "next/server";

import { getAuthenticatedAdminUser } from "@/lib/adminServer";
import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import {
  createProductionAfcStoreFromEnv,
} from "@/lib/afc-v2-production/production-persistence.server";
import {
  parseRoomId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { selectHarmonizeEmptyBytes } from "@/lib/vibode-stage/harmonize-empty";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(error: string, status: number) {
  const body = { error };
  assertProductionPayloadPrivacy(body);
  return productionAfcJson(body, status);
}

export async function GET(request: Request) {
  const roomId = parseRoomId(new URL(request.url).searchParams.get("roomId"));
  if (!roomId) return jsonError("roomId is required.", 400);

  const admin = await getAuthenticatedAdminUser();
  if (!admin) return jsonError("Admin access required.", 403);

  const store = createProductionAfcStoreFromEnv();
  if (!store) return jsonError("Server misconfigured.", 500);

  const room = await store.getRoom(roomId);
  const generation = room && room.userId === admin.id && room.currentAfcGenerationId
    ? await store.getGeneration(room.currentAfcGenerationId)
    : null;
  const bytes = generation
    && generation.userId === admin.id
    && generation.roomId === roomId
    && generation.emptyStoragePath
    ? await store.getArtifact(generation.emptyStoragePath)
    : null;

  const selected = selectHarmonizeEmptyBytes({
    callerIsAdmin: true,
    callerUserId: admin.id,
    roomId,
    room,
    generation,
    authority: generation?.productionAuthority ?? null,
    bytes,
  });
  if (!selected.ok) return jsonError(selected.error, selected.status);

  return new NextResponse(Buffer.from(selected.bytes), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(selected.bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
