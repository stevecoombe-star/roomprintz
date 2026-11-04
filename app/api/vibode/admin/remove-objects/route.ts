import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";
import { readRemoveActor } from "@/lib/vibode-stage/remove-access.server";
import { handleRemoveObjectsAdmin } from "@/lib/vibode-stage/remove-segmentation-admin";
import { persistValidatedSegmentationSnapshot } from "@/lib/vibode-stage/bring-forward-store.server";
import { reserveRemoveSegmentation } from "@/lib/vibode-stage/remove-segmentation-quota.server";
import { createRoboflowRemoveSegmentationProvider } from "@/lib/vibode-stage/remove-segmentation-roboflow.server";
import { readStoredRemoveVocabularyProfile } from "@/lib/vibode-stage/remove-vocabulary-profile.server";

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
    readVocabularyProfile: async (input) => {
      const service = getServiceRoleSupabaseClient();
      if (!service) return { ok: false, code: "unavailable" };
      return readStoredRemoveVocabularyProfile(service, input);
    },
    reserveSegmentation: reserveRemoveSegmentation,
    provider: createRoboflowRemoveSegmentationProvider(),
    storeScan: persistValidatedSegmentationSnapshot,
  });
}
