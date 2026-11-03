import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";
import type { AfcRoomPointer } from "@/lib/afc-v2-production/production-store";
import { readRemoveActor } from "@/lib/vibode-stage/remove-access.server";
import type { RemoveVocabularyChoice } from "@/lib/vibode-stage/remove-vocabulary-profile";
import {
  handleRemoveVocabularyProfileGet,
  handleRemoveVocabularyProfilePost,
  readStoredRemoveVocabularyProfile,
  writeStoredRemoveVocabularyProfile,
  type RemoveVocabularyProfileDeps,
} from "@/lib/vibode-stage/remove-vocabulary-profile.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function profileDeps(): RemoveVocabularyProfileDeps {
  return {
    getActor: readRemoveActor,
    createStore: createProductionAfcStoreFromEnv,
    loadOriginal: async (input: { userId: string; room: AfcRoomPointer }) => {
      const service = getServiceRoleSupabaseClient();
      if (!service) return { ok: false };
      const loaded = await loadOwnedOriginalForProductionAnalysis(service, input);
      if (!loaded.ok) return { ok: false };
      return { ok: true, bytes: loaded.bytes };
    },
    readProfile: async (input) => {
      const service = getServiceRoleSupabaseClient();
      if (!service) return { ok: false, code: "unavailable" };
      return readStoredRemoveVocabularyProfile(service, input);
    },
    writeProfile: async (input: {
      userId: string;
      roomId: string;
      generationId: string;
      profile: RemoveVocabularyChoice;
      originalSha256: string;
    }) => {
      const service = getServiceRoleSupabaseClient();
      if (!service) return { ok: false, code: "unavailable" };
      return writeStoredRemoveVocabularyProfile(service, input);
    },
  };
}

export async function GET(request: Request) {
  return handleRemoveVocabularyProfileGet(request, profileDeps());
}

export async function POST(request: Request) {
  return handleRemoveVocabularyProfilePost(request, profileDeps());
}
