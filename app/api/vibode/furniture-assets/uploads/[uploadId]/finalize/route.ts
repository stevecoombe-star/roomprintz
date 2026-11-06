import {
  authorizeProductionAfcUser,
  parseUuid,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { personalFurnitureServices } from "@/lib/vibode-furniture/furniture-store.server";
import { finalizePersonalFurnitureUpload } from "@/lib/vibode-furniture/operations";
import { validatePersonalFurnitureGlb } from "@/lib/vibode-furniture/validate.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ uploadId: string }> },
) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;
  const params = await context.params;
  const uploadId = parseUuid(params.uploadId);
  if (!uploadId) {
    return productionAfcJson({ ok: false, error: "That upload could not be found." }, 404);
  }
  const body = await request.json().catch(() => null);
  const record = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  const displayName = typeof record?.displayName === "string" ? record.displayName : "";
  const category = typeof record?.category === "string" ? record.category : null;
  const services = personalFurnitureServices();
  if (!services.ok) return productionAfcJson({ ok: false, error: services.error }, 500);
  try {
    const saved = await finalizePersonalFurnitureUpload({
      userId: auth.userId,
      uploadId,
      displayName,
      category,
      now: new Date(),
      store: services.records,
      objects: services.objects,
      validate: validatePersonalFurnitureGlb,
    });
    if (!saved.ok) {
      return productionAfcJson({
        ok: false,
        error: saved.error,
        errorCode: saved.errorCode,
      }, saved.status);
    }
    return productionAfcJson({ ok: true, item: saved.item, idempotent: saved.idempotent }, 200);
  } catch {
    return productionAfcJson({ ok: false, error: "The model could not be saved." }, 500);
  }
}
