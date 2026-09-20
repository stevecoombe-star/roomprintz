import { handleAfcQaReadyRerunPost } from "@/lib/afc-v2-diagnostics/qa-rerun.server";
import { attachAfcDiagnosticSessionBestEffort } from "@/lib/afc-v2-diagnostics/session-attach.server";
import { runProductionAfcAnalysis } from "@/lib/afc-v2-production/production-adapter.server";
import {
  authorizeProductionAfcUser,
  productionAfcJson,
} from "@/lib/afc-v2-production/production-http";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";

export const runtime = "nodejs";

async function startQaReadyRerunProductionAnalysis(input: {
  userId: string;
  roomId: string;
  intent: "run_again";
}) {
  const store = createProductionAfcStoreFromEnv();
  const service = getServiceRoleSupabaseClient();
  if (!store || !service) {
    throw new Error("Server misconfigured.");
  }

  const room = await store.getRoom(input.roomId);
  if (!room || room.userId !== input.userId) {
    return {
      status: "failed" as const,
      generationId: null,
      currentGenerationId: null,
      authority: null,
      failureReason: "Room not found.",
      frame: null,
    };
  }

  const original = await loadOwnedOriginalForProductionAnalysis(service, {
    userId: input.userId,
    room,
  });
  if (!original.ok) {
    return {
      status: "failed" as const,
      generationId: null,
      currentGenerationId: null,
      authority: null,
      failureReason: "ORIGINAL image is unavailable.",
      frame: null,
    };
  }

  return runProductionAfcAnalysis({
    roomId: input.roomId,
    userId: input.userId,
    intent: input.intent,
    store,
    original: {
      bytes: original.bytes,
      sourceImageUrl: original.sourceImageUrl,
    },
    onGenerationCreated: attachAfcDiagnosticSessionBestEffort,
  });
}

export async function POST(request: Request) {
  try {
    return await handleAfcQaReadyRerunPost({
      request,
      authorize: authorizeProductionAfcUser,
      startProductionAnalysis: startQaReadyRerunProductionAnalysis,
    });
  } catch {
    return productionAfcJson({ error: "Server misconfigured." }, 500);
  }
}
