import {
  authorizeProductionAfcUser,
  parseRoomId,
  parseVersionId,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { readHarmonizeHistoryView } from "@/lib/vibode-stage/harmonize-jobs/presentation.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const roomId = parseRoomId(url.searchParams.get("roomId"));
  const assetId = parseVersionId(url.searchParams.get("assetId"));
  if (!roomId || !assetId) {
    return productionAfcJson({ error: "roomId and assetId are required." }, 400);
  }
  const loaded = await readHarmonizeHistoryView({
    userId: auth.userId,
    roomId,
    assetId,
  });
  if (!loaded.ok) {
    return productionAfcJson({ error: "Harmonize history could not be read." }, 500);
  }
  if (loaded.access.status === "hidden") {
    return productionAfcJson({ error: "Not found." }, 404);
  }
  if (loaded.access.status === "ordinary") {
    return productionAfcJson({ harmonized: false, assetId }, 200);
  }
  const view = loaded.access.view;
  return productionAfcJson({
    harmonized: true,
    assetId: view.assetId,
    sourceVersionId: view.sourceVersionId,
    afcGenerationId: view.afcGenerationId,
    backdropKind: view.backdropKind,
    outputActive: view.outputActive,
  }, 200);
}
