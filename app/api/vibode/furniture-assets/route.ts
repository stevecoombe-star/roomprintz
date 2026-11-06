import {
  authorizeProductionAfcUser,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { personalFurnitureServices } from "@/lib/vibode-furniture/furniture-store.server";
import { listPersonalFurniture } from "@/lib/vibode-furniture/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;
  const services = personalFurnitureServices();
  if (!services.ok) return productionAfcJson({ ok: false, error: services.error }, 500);
  try {
    const items = await listPersonalFurniture({
      userId: auth.userId,
      store: services.records,
      objects: services.objects,
    });
    return productionAfcJson({ ok: true, items }, 200);
  } catch {
    return productionAfcJson({ ok: false, error: "Your furniture could not be loaded." }, 500);
  }
}
