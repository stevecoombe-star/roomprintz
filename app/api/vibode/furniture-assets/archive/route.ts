import {
  authorizeProductionAfcUser,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { personalFurnitureServices } from "@/lib/vibode-furniture/furniture-store.server";
import { archivePersonalFurniture } from "@/lib/vibode-furniture/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const assetId = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { assetId?: unknown }).assetId
    : null;
  if (typeof assetId !== "string") {
    return productionAfcJson({ ok: false, error: "That model isn't in your library." }, 404);
  }
  const services = personalFurnitureServices();
  if (!services.ok) return productionAfcJson({ ok: false, error: services.error }, 500);
  try {
    const archived = await archivePersonalFurniture({
      userId: auth.userId,
      assetId,
      store: services.records,
    });
    if (!archived.ok) {
      return productionAfcJson({
        ok: false,
        error: archived.error,
        errorCode: archived.errorCode,
      }, archived.status);
    }
    return productionAfcJson({ ok: true }, 200);
  } catch {
    return productionAfcJson({ ok: false, error: "That model could not be archived." }, 500);
  }
}
