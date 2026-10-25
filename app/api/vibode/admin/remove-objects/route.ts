import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";
import { readRemoveActor } from "@/lib/vibode-stage/remove-access.server";
import { handleRemoveObjectsAdmin } from "@/lib/vibode-stage/remove-segmentation-admin";
import { reserveRemoveSegmentation } from "@/lib/vibode-stage/remove-segmentation-quota.server";
import { createRoboflowRemoveSegmentationProvider } from "@/lib/vibode-stage/remove-segmentation-roboflow.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRemoveObjectsAdmin(request, {
    getAdmin: readRemoveActor,
    createStore: createProductionAfcStoreFromEnv,
    createService: getServiceRoleSupabaseClient,
    loadOriginal: async (service, input) => {
      if (!service || typeof service !== "object") return { ok: false };
      const loaded = await loadOwnedOriginalForProductionAnalysis(
        service as Parameters<typeof loadOwnedOriginalForProductionAnalysis>[0],
        input,
      );
      if (!loaded.ok) return { ok: false };
      return { ok: true, bytes: loaded.bytes };
    },
    reserveSegmentation: reserveRemoveSegmentation,
    provider: createRoboflowRemoveSegmentationProvider(),
  });
}
