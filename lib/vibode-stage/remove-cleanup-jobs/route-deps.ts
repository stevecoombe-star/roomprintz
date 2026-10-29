import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";
import { readRemoveActor } from "@/lib/vibode-stage/remove-access.server";
import type { RemoveCleanupExportDeps } from "@/lib/vibode-stage/remove-cleanup-snapshot.server";

import type { CleanupHttpDeps } from "./http";
import { createSupabaseCleanupControl } from "./production.server";
import { createCleanupServiceClient } from "./service-client";

export function createRemoveCleanupRouteDeps(): CleanupHttpDeps | null {
  const client = createCleanupServiceClient();
  if (!client) return null;
  const getAdmin = readRemoveActor;
  const prepareDeps: RemoveCleanupExportDeps = {
    getAdmin,
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
  };
  return {
    getAdmin,
    prepareDeps,
    control: createSupabaseCleanupControl(client),
    currentGenerationId: async (roomId, userId) => {
      const { data, error } = await client
        .from("vibode_rooms")
        .select("current_afc_generation_id")
        .eq("id", roomId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error || !data || typeof data.current_afc_generation_id !== "string") return null;
      return data.current_afc_generation_id;
    },
  };
}
