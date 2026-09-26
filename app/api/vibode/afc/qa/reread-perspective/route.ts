import { handleAfcQaPerspectiveRereadPost } from "@/lib/afc-v2-diagnostics/qa-reread-perspective.server";
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

async function startQaPerspectiveRereadProductionAnalysis(input: {
  userId: string;
  roomId: string;
  intent: "reread_perspective";
}) {
  if (input.intent !== "reread_perspective") {
    throw new Error("Perspective re-read intent mismatch.");
  }
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
    return await handleAfcQaPerspectiveRereadPost({
      request,
      authorize: authorizeProductionAfcUser,
      startProductionAnalysis: startQaPerspectiveRereadProductionAnalysis,
    });
  } catch {
    return productionAfcJson({ error: "Server misconfigured." }, 500);
  }
}
