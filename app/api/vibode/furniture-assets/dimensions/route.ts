import {
  authorizeProductionAfcUser,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { personalFurnitureServices } from "@/lib/vibode-furniture/furniture-store.server";
import { updatePersonalFurnitureDimensions } from "@/lib/vibode-furniture/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  const assetId = typeof record?.assetId === "string" ? record.assetId : "";
  const widthM = finite(record?.widthM);
  const heightM = finite(record?.heightM);
  const depthM = finite(record?.depthM);
  const sizingMode = record?.sizingMode === "exact" ? "exact" : record?.sizingMode === "uniform" ? "uniform" : "";
  if (!assetId || widthM == null || heightM == null || depthM == null || !sizingMode) {
    return productionAfcJson({
      ok: false,
      error: "Enter a size between 5 cm and 8 m.",
      errorCode: "INVALID_DIMENSIONS",
    }, 400);
  }
  const services = personalFurnitureServices();
  if (!services.ok) return productionAfcJson({ ok: false, error: services.error }, 500);
  try {
    const saved = await updatePersonalFurnitureDimensions({
      userId: auth.userId,
      assetId,
      widthM,
      heightM,
      depthM,
      sizingMode,
      store: services.records,
      objects: services.objects,
    });
    if (!saved.ok) {
      return productionAfcJson({
        ok: false,
        error: saved.error,
        errorCode: saved.errorCode,
      }, saved.status);
    }
    return productionAfcJson({
      ok: true,
      assetId: saved.item.assetId,
      dimensions: {
        widthM: saved.item.widthM,
        heightM: saved.item.heightM,
        depthM: saved.item.depthM,
        sizingMode: saved.item.sizingMode,
      },
    }, 200);
  } catch {
    return productionAfcJson({
      ok: false,
      error: "The model dimensions could not be saved.",
      errorCode: "DIMENSIONS_UNAVAILABLE",
    }, 500);
  }
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
