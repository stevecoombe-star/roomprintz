import { getAuthenticatedAdminUser, getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";
import { handleRemoveCleanupExport } from "@/lib/vibode-stage/remove-cleanup-export.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleRemoveCleanupExport(request, {
    getAdmin: async () => {
      const user = await getAuthenticatedAdminUser();
      if (!user?.id) return null;
      return { id: user.id };
    },
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
