import {
  authorizeProductionAfcUser,
  parseAfcGenerationId,
  parseRoomId,
  parseVersionId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { authorizeOwnedVersionScene } from "@/lib/afc-v2-runtime/scene-persistence.server";
import { personalFurnitureServices } from "@/lib/vibode-furniture/furniture-store.server";
import { placePersonalFurniture } from "@/lib/vibode-furniture/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  const roomId = parseRoomId(record?.roomId);
  const versionId = parseVersionId(record?.versionId);
  const afcGenerationId = parseAfcGenerationId(record?.afcGenerationId);
  const assetId = typeof record?.assetId === "string" ? record.assetId : "";
  if (!roomId || !versionId || !afcGenerationId || !assetId) {
    return productionAfcJson({
      ok: false,
      error: "roomId, versionId, and afcGenerationId are required.",
      errorCode: "INVALID_REQUEST",
    }, 400);
  }
  const authorized = await authorizeOwnedVersionScene({
    userId: auth.userId,
    roomId,
    versionId,
    afcGenerationId,
  });
  if (!authorized.ok) {
    return productionAfcJson({
      ok: false,
      error: authorized.error,
      errorCode: "ROOM_FORBIDDEN",
    }, authorized.status);
  }
  const services = personalFurnitureServices();
  if (!services.ok) return productionAfcJson({ ok: false, error: services.error }, 500);
  try {
    const placed = await placePersonalFurniture({
      userId: auth.userId,
      assetId,
      store: services.records,
      objects: services.objects,
    });
    if (!placed.ok) {
      return productionAfcJson({
        ok: false,
        error: placed.error,
        errorCode: placed.errorCode,
      }, placed.status);
    }
    return productionAfcJson({
      ok: true,
      assetId: placed.assetId,
      runtimeAsset: placed.runtimeAsset,
    }, 200);
  } catch {
    return productionAfcJson({
      ok: false,
      error: "This model could not be opened.",
      errorCode: "PREVIEW_UNAVAILABLE",
    }, 500);
  }
}
