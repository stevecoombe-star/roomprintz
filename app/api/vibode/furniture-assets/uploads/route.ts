import { randomUUID } from "node:crypto";

import {
  authorizeProductionAfcUser,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { createPersonalFurnitureAssetId } from "@/lib/vibode-furniture/asset-id";
import { personalFurnitureServices } from "@/lib/vibode-furniture/furniture-store.server";
import { createPersonalFurnitureUpload } from "@/lib/vibode-furniture/operations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;
  const services = personalFurnitureServices();
  if (!services.ok) return productionAfcJson({ ok: false, error: services.error }, 500);
  const uploadId = randomUUID();
  const assetId = createPersonalFurnitureAssetId(randomUUID());
  if (!assetId) {
    return productionAfcJson({ ok: false, error: "The upload could not be started." }, 500);
  }
  try {
    const created = await createPersonalFurnitureUpload({
      userId: auth.userId,
      uploadId,
      assetId,
      now: new Date(),
      store: services.records,
      objects: services.objects,
    });
    if (!created.ok) {
      return productionAfcJson({
        ok: false,
        error: created.error,
        errorCode: created.errorCode,
      }, created.status);
    }
    return productionAfcJson({
      ok: true,
      uploadId: created.uploadId,
      signedUrl: created.signedUrl,
      expiresAt: created.expiresAt,
    }, 200);
  } catch {
    return productionAfcJson({ ok: false, error: "The upload could not be started." }, 500);
  }
}
