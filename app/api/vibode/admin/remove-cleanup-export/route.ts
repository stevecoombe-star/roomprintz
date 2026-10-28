import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";
import { handleRemoveCleanupExport } from "@/lib/vibode-stage/remove-cleanup-export.server";
import { readRemoveActor } from "@/lib/vibode-stage/remove-access.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRemoveCleanupExport(request, {
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
  });
}
