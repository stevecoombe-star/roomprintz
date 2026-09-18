import {
  authorizeProductionAfcUser,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { placeOwnedStageRuntimeAsset } from "@/lib/vibode-stage/stage-runtime-placement.server";
import { stageRuntimePlacementFailure } from "@/lib/vibode-stage/stage-runtime-placement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeProductionAfcUser(request);
  if (!auth.ok) {
    if (auth.response.status === 401) {
      return productionAfcJson(stageRuntimePlacementFailure("UNAUTHORIZED"), 401);
    }
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  const placed = await placeOwnedStageRuntimeAsset(auth.userId, body);
  return productionAfcJson(placed.body, placed.status);
}
