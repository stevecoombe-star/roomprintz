import "server-only";

import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";
import {
  productionAfcJson,
  type ProductionAfcAuth,
} from "@/lib/afc-v2-production/production-http";

import type { AfcQaCapabilityEnv } from "./qa-capability.server";
import {
  authorizeAfcQaReadyRerun,
  AfcQaReadyRerunGenerationError,
  AfcQaReadyRerunInputError,
  AfcQaReadyRerunIntegrityError,
  AfcQaReadyRerunMembershipError,
  AfcQaReadyRerunQaDisabledError,
  AfcQaReadyRerunRoomError,
  AfcQaReadyRerunSessionError,
  AfcQaReadyRerunStoreError,
  type AfcQaReadyRerunAnalysisResult,
  type AfcQaReadyRerunOptions,
  type AfcQaReadyRerunStore,
} from "./qa-rerun.server";
import type { AfcDiagnosticRetryEpisodeStore } from "./retry-episode-signal.server";

/**
 * QA-only production adapter for Lab "Re-read Room Perspective".
 *
 * Reuses the READY-rerun eligibility gate, then starts production analysis
 * with the certified `reread_perspective` intent. The browser cannot choose
 * that intent. This module does not create generations, Sessions, Cases, or
 * membership rows; production analysis and its existing attach hook do.
 */

export const AFC_QA_PERSPECTIVE_REREAD_INTENT = "reread_perspective" as const;

export type AfcQaPerspectiveRereadIntent =
  typeof AFC_QA_PERSPECTIVE_REREAD_INTENT;

export type AfcQaPerspectiveRereadStartInput = {
  userId: string;
  roomId: string;
  intent: AfcQaPerspectiveRereadIntent;
};

export type AfcQaPerspectiveRereadAnalysisResult = AfcQaReadyRerunAnalysisResult;

function freezeAnalysisResult(
  result: AfcQaPerspectiveRereadAnalysisResult,
): AfcQaPerspectiveRereadAnalysisResult {
  const payload = Object.freeze({
    status: result.status,
    generationId: result.generationId,
    currentGenerationId: result.currentGenerationId,
    authority: result.authority,
    failureReason: result.failureReason,
    frame: result.frame,
  });
  assertProductionPayloadPrivacy(payload);
  return payload;
}

function mapPublicPerspectiveRereadError(error: unknown) {
  if (error instanceof AfcQaReadyRerunQaDisabledError) {
    return productionAfcJson({ error: "Not available." }, 404);
  }
  if (error instanceof AfcQaReadyRerunInputError) {
    return productionAfcJson({ error: "Invalid request." }, 400);
  }
  if (error instanceof AfcQaReadyRerunRoomError) {
    return productionAfcJson({ error: "Room not found." }, 404);
  }
  if (
    error instanceof AfcQaReadyRerunGenerationError ||
    error instanceof AfcQaReadyRerunMembershipError ||
    error instanceof AfcQaReadyRerunSessionError
  ) {
    return productionAfcJson({ error: "Not available." }, 404);
  }
  if (
    error instanceof AfcQaReadyRerunIntegrityError ||
    error instanceof AfcQaReadyRerunStoreError
  ) {
    return productionAfcJson({ error: "Server misconfigured." }, 500);
  }
  return productionAfcJson({ error: "Server misconfigured." }, 500);
}

export async function handleAfcQaPerspectiveRereadPost(args: {
  request: Request;
  authorize: (request: Request) => Promise<ProductionAfcAuth>;
  startProductionAnalysis: (
    input: AfcQaPerspectiveRereadStartInput,
  ) => Promise<AfcQaPerspectiveRereadAnalysisResult>;
  env?: AfcQaCapabilityEnv | NodeJS.ProcessEnv;
  store?: AfcQaReadyRerunStore;
  retryStore?: AfcDiagnosticRetryEpisodeStore;
  retrySignal?: AfcQaReadyRerunOptions["retrySignal"];
}) {
  const auth = await args.authorize(args.request);
  if (!auth.ok) return auth.response;

  const body = await args.request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return productionAfcJson({ error: "Invalid request." }, 400);
  }
  const record = body as Record<string, unknown>;

  try {
    const authorized = await authorizeAfcQaReadyRerun(
      {
        userId: auth.userId,
        roomId: record.roomId,
        generationId: record.generationId,
      },
      {
        env: args.env ?? process.env,
        store: args.store,
        retryStore: args.retryStore,
        retrySignal: args.retrySignal,
      } satisfies AfcQaReadyRerunOptions,
    );
    const result = await args.startProductionAnalysis({
      userId: authorized.userId,
      roomId: authorized.roomId,
      intent: AFC_QA_PERSPECTIVE_REREAD_INTENT,
    });
    if (result.status === "failed" && result.generationId === null) {
      return productionAfcJson(
        { error: result.failureReason ?? "AFC analysis failed." },
        404,
      );
    }
    return productionAfcJson(
      freezeAnalysisResult(result),
      result.status === "ready" ? 200 : 422,
    );
  } catch (error) {
    return mapPublicPerspectiveRereadError(error);
  }
}
