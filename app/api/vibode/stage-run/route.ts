import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callCompositorVibodeStageRun } from "@/lib/callCompositorVibodeStageRun";
import {
  createVibodeGenerationRun,
  getVibodeRoomById,
} from "@/lib/vibodePersistence";
import {
  finalizeVibodeOutputAsset,
  resolveVibodeOutputDimensions,
  resolveVibodeOutputStorage,
} from "@/lib/vibodeAssetFinalization";
import {
  canAffordTokens,
  getTokenCostForAction,
  getUserTokenWallet,
  spendTokens,
} from "@/lib/vibodeTokenDomain";
import { buildTokenLedgerMetadata, getStageTokenActionKey } from "@/lib/vibodeTokenPolicy";
import {
  parsePasteToPlaceJobControlFromBody,
  PASTE_TO_PLACE_JOB_ID_HEADER,
  PASTE_TO_PLACE_SCOPE_ID_HEADER,
} from "@/lib/pasteToPlaceJobControl";
import {
  buildPasteToPlaceCancelledResponse,
  getPasteToPlaceJobState,
  markPasteToPlaceJobLatest,
} from "@/lib/pasteToPlaceJobRegistry";

export const runtime = "nodejs";
const VIBODE_DEFAULT_MODEL_VERSION = "NBP";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

type StageRunCompositorResult = {
  imageUrl: string;
  appliedAspectRatio?: string | null;
} & Record<string, unknown>;

type AnySupabaseClient = SupabaseClient<any, "public", any>;

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isDataUrl(value: string | null): boolean {
  if (!value) return false;
  return value.toLowerCase().startsWith("data:image/");
}

function parseOptionalStageNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (n < 0 || n > 32767) return null;
  return n;
}

function isUuidLike(value: string | null): value is string {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function getUserSupabaseClient(
  req: NextRequest
): { supabase: AnySupabaseClient | null; token: string | null } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { supabase: null, token: null };

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;
  if (!token) return { supabase: null, token: null };

  const supabase: AnySupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { supabase, token };
}

function getAdminSupabaseClient(): AnySupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function summarizeSafeRequestPayload(args: {
  body: Record<string, unknown>;
  stageNumber: number | null;
  modelVersion: string;
}) {
  const eligibleSkus = Array.isArray(args.body.eligibleSkus) ? args.body.eligibleSkus : [];
  return {
    stageNumber: args.stageNumber,
    modelVersion: args.modelVersion,
    aspectRatio: safeStr(args.body.aspectRatio),
    hasBaseImageUrl: typeof args.body.baseImageUrl === "string",
    hasRoomImageBase64: typeof args.body.roomImageBase64 === "string",
    isContinuation: args.body.isContinuation === true,
    targetCount:
      typeof args.body.targetCount === "number" && Number.isFinite(args.body.targetCount)
        ? args.body.targetCount
        : null,
    eligibleSkusCount: eligibleSkus.length,
    stage4Mode: safeStr(args.body.stage4Mode),
    stage1Mode: safeStr(args.body.stage1Mode),
  };
}

function summarizeSafeResponsePayload(args: {
  result: StageRunCompositorResult;
  durableImageUrl: string | null;
  storageBucket: string | null;
  storagePath: string | null;
}) {
  const imageUrl = safeStr(args.result.imageUrl);
  const durableImageUrl = safeStr(args.durableImageUrl);
  const imageUrlIsDataUrl = isDataUrl(imageUrl);
  const durableImageUrlIsDataUrl = isDataUrl(durableImageUrl);

  return {
    imageUrl: imageUrlIsDataUrl ? null : imageUrl,
    hasImageUrl: Boolean(imageUrl),
    ...(imageUrlIsDataUrl ? { imageUrlKind: "data_url" as const } : {}),
    durableImageUrl: durableImageUrlIsDataUrl ? null : durableImageUrl,
    appliedAspectRatio: safeStr(args.result.appliedAspectRatio),
    storageBucket: args.storageBucket,
    storagePath: args.storagePath,
  };
}

export async function POST(req: NextRequest) {
  try {
    const bodyRaw = (await req.json()) as unknown;
    const body =
      bodyRaw && typeof bodyRaw === "object" ? (bodyRaw as Record<string, unknown>) : {};
    const vibodeRoomId = safeStr(body.vibodeRoomId);
    const requestedStageNumber =
      parseOptionalStageNumber(body.stageNumber) ?? parseOptionalStageNumber(body.stage);
    const requestedAspectRatio = safeStr(body.aspectRatio);
    const modelVersion =
      typeof body?.modelVersion === "string" && body.modelVersion.trim().length > 0
        ? body.modelVersion
        : VIBODE_DEFAULT_MODEL_VERSION;
    const pasteToPlaceControl = parsePasteToPlaceJobControlFromBody(body);
    if (pasteToPlaceControl) {
      markPasteToPlaceJobLatest(pasteToPlaceControl.scopeId, pasteToPlaceControl.jobId);
    }
    const isPasteToPlaceJobActive = (): boolean => {
      if (!pasteToPlaceControl) return true;
      return (
        getPasteToPlaceJobState(pasteToPlaceControl.scopeId, pasteToPlaceControl.jobId) === "active"
      );
    };
    const cancelledResponse = (): Response | null => {
      if (!pasteToPlaceControl) return null;
      const state = getPasteToPlaceJobState(pasteToPlaceControl.scopeId, pasteToPlaceControl.jobId);
      if (state === "active" || state === "unknown") return null;
      return buildPasteToPlaceCancelledResponse(state === "cancelled" ? "cancelled" : "stale");
    };

    const payloadForCompositor = { ...body };
    delete payloadForCompositor.vibodeRoomId;
    delete payloadForCompositor.stageNumber;
    delete payloadForCompositor.pasteToPlaceControl;

    let stageRunContext:
      | {
          userId: string;
          room: NonNullable<Awaited<ReturnType<typeof getVibodeRoomById>>> | null;
          actionKey: NonNullable<ReturnType<typeof getStageTokenActionKey>>;
          tokenCost: number;
          walletBalanceBefore: number;
          resolvedStageNumber: number;
          supabase: AnySupabaseClient;
        }
      | null = null;

    const { supabase, token } = getUserSupabaseClient(req);
    if (!token || !supabase) {
      return Response.json(
        {
          error:
            "Unauthorized: missing Authorization Bearer token. (Send Supabase access_token in the request.)",
        },
        { status: 401 }
      );
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const authenticatedUserId = userData.user.id;

    let existingRoom: NonNullable<Awaited<ReturnType<typeof getVibodeRoomById>>> | null = null;
    if (vibodeRoomId) {
      if (!isUuidLike(vibodeRoomId)) {
        return Response.json({ error: "Invalid vibodeRoomId." }, { status: 400 });
      }
      existingRoom = await getVibodeRoomById(supabase, vibodeRoomId);
      if (!existingRoom) {
        return Response.json({ error: "Room not found" }, { status: 404 });
      }
      if (existingRoom.user_id !== authenticatedUserId) {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const preflightStageNumberCandidate = vibodeRoomId
      ? requestedStageNumber ?? existingRoom?.current_stage ?? 0
      : requestedStageNumber;
    const preflightStageNumber =
      typeof preflightStageNumberCandidate === "number" && Number.isFinite(preflightStageNumberCandidate)
        ? Math.trunc(preflightStageNumberCandidate)
        : null;
    const actionKey = getStageTokenActionKey(preflightStageNumber);
    if (!actionKey || preflightStageNumber === null) {
      return Response.json(
        {
          errorCode: "UNSUPPORTED_STAGE_ACTION",
          message: "Unsupported stage number for token accounting.",
          stageNumber: preflightStageNumber,
        },
        { status: 400 }
      );
    }
    const tokenStageNumber = preflightStageNumber;

    const wallet = await getUserTokenWallet(supabase, authenticatedUserId);
    const tokenCost = await getTokenCostForAction(supabase, actionKey);
    const affordability = canAffordTokens({
      balanceTokens: wallet.balance_tokens,
      requiredTokens: tokenCost,
    });
    if (!affordability.allowed) {
      return Response.json(
        {
          errorCode: "INSUFFICIENT_TOKENS",
          message: "Insufficient internal token balance for this stage generation.",
          requiredTokens: affordability.requiredTokens,
          balanceTokens: affordability.balanceTokens,
          shortfallTokens: affordability.shortfallTokens,
          actionKey,
          stageNumber: tokenStageNumber,
        },
        { status: 402 }
      );
    }

    stageRunContext = {
      userId: authenticatedUserId,
      room: existingRoom,
      actionKey,
      tokenCost,
      walletBalanceBefore: wallet.balance_tokens,
      resolvedStageNumber: tokenStageNumber,
      supabase,
    };

    const preCompositorCancellation = cancelledResponse();
    if (preCompositorCancellation) {
      console.info("[vibode/stage-run] exiting early before compositor (paste-to-place stale/cancelled)", {
        scopeId: pasteToPlaceControl?.scopeId,
        jobId: pasteToPlaceControl?.jobId,
      });
      return preCompositorCancellation;
    }

    const result = (await callCompositorVibodeStageRun({
      payload: {
        ...payloadForCompositor,
        modelVersion,
      },
      headers: pasteToPlaceControl
        ? {
            [PASTE_TO_PLACE_JOB_ID_HEADER]: pasteToPlaceControl.jobId,
            [PASTE_TO_PLACE_SCOPE_ID_HEADER]: pasteToPlaceControl.scopeId,
          }
        : undefined,
    })) as StageRunCompositorResult;

    if (!stageRunContext) {
      throw new Error("[vibode/stage-run] missing token preflight context");
    }
    if (!isPasteToPlaceJobActive()) {
      console.info("[vibode/stage-run] dropping compositor result before finalization (paste-to-place stale/cancelled)", {
        scopeId: pasteToPlaceControl?.scopeId,
        jobId: pasteToPlaceControl?.jobId,
      });
      return cancelledResponse() ?? buildPasteToPlaceCancelledResponse("stale");
    }

    const hintedStorage = resolveVibodeOutputStorage(result);
    const hintedDimensions = resolveVibodeOutputDimensions(result);
    const nowIso = new Date().toISOString();
    const hasRoomPersistenceContext = Boolean(vibodeRoomId && stageRunContext.room);
    const outputFinalization = await finalizeVibodeOutputAsset({
      logPrefix: "[vibode/stage-run]",
      adminSupabase: getAdminSupabaseClient(),
      persistenceSupabase: hasRoomPersistenceContext ? stageRunContext.supabase : null,
      roomId: hasRoomPersistenceContext ? stageRunContext.room!.id : vibodeRoomId,
      userId: stageRunContext.userId,
      assetType: "stage_output",
      stageNumber: stageRunContext.resolvedStageNumber,
      modelVersion,
      responseImageUrl: safeStr(result.imageUrl),
      responseStorageBucket: hintedStorage.storageBucket,
      responseStoragePath: hintedStorage.storagePath,
      responseWidth: hintedDimensions.width,
      responseHeight: hintedDimensions.height,
      sourceImageUrlForThumbnail: safeStr(result.imageUrl),
      markAssetActive: hasRoomPersistenceContext,
      updateRoomCurrentStage: hasRoomPersistenceContext ? stageRunContext.resolvedStageNumber : undefined,
      updateRoomSortKey: nowIso,
    });
    const responseResult: StageRunCompositorResult = {
      ...result,
      imageUrl: outputFinalization.imageUrl ?? safeStr(result.imageUrl) ?? "",
      storageBucket: outputFinalization.storageBucket ?? hintedStorage.storageBucket,
      storagePath: outputFinalization.storagePath ?? hintedStorage.storagePath,
    };
    if (!isPasteToPlaceJobActive()) {
      console.info("[vibode/stage-run] dropping finalized response before persistence (paste-to-place stale/cancelled)", {
        scopeId: pasteToPlaceControl?.scopeId,
        jobId: pasteToPlaceControl?.jobId,
      });
      return cancelledResponse() ?? buildPasteToPlaceCancelledResponse("stale");
    }

    if (!vibodeRoomId || !stageRunContext.room) {
      console.info("[vibode/stage-run] persistence skipped: missing vibodeRoomId");
      let tokensCharged = 0;
      let remainingTokens: number | null = stageRunContext.walletBalanceBefore;
      try {
        const spendResult = await spendTokens({
          supabase: stageRunContext.supabase,
          userId: stageRunContext.userId,
          spendTokens: stageRunContext.tokenCost,
          eventType: "generation_spend",
          actionType: stageRunContext.actionKey,
          stageNumber: stageRunContext.resolvedStageNumber,
          modelVersion,
          roomId: null,
          generationRunId: null,
          metadata: buildTokenLedgerMetadata({
            modelVersion,
            stageNumber: stageRunContext.resolvedStageNumber,
            endpoint: "/api/vibode/stage-run",
            requestKind: "stage_generation",
          }),
        });
        if (spendResult.ok) {
          tokensCharged = spendResult.spentTokens;
          remainingTokens = spendResult.balanceTokens;
        }
      } catch (tokenSpendErr) {
        console.error(
          "[vibode/stage-run] token spend failed after successful generation (no room context):",
          tokenSpendErr
        );
      }

      return Response.json({
        ...responseResult,
        tokensCharged,
        remainingTokens,
        actionKey: stageRunContext.actionKey,
      });
    }

    const room = stageRunContext.room;
    const userId = stageRunContext.userId;
    const resolvedStageNumber = stageRunContext.resolvedStageNumber;
    const resolvedAspectRatio =
      requestedAspectRatio ?? safeStr(responseResult.appliedAspectRatio) ?? room.aspect_ratio;
    const previousActiveAssetId = room.active_asset_id ?? null;
    const storageBucket = outputFinalization.storageBucket ?? null;
    const storagePath = outputFinalization.storagePath ?? null;
    const durableImageUrl = outputFinalization.durableImageUrl ?? null;
    let tokensCharged = 0;
    let remainingTokens: number | null = stageRunContext.walletBalanceBefore;

    try {
      if (outputFinalization.assetFinalizationError) {
        throw outputFinalization.assetFinalizationError;
      }
      if (!outputFinalization.outputAssetId) {
        throw new Error("[vibode/stage-run] persistence failed: missing output asset id");
      }

      const generationRun = await createVibodeGenerationRun(stageRunContext.supabase, {
        room_id: room.id,
        user_id: userId,
        run_type: "stage",
        stage_number: resolvedStageNumber,
        source_asset_id: previousActiveAssetId,
        output_asset_id: outputFinalization.outputAssetId,
        model_version: modelVersion,
        aspect_ratio: resolvedAspectRatio,
        status: "completed",
        request_payload: summarizeSafeRequestPayload({
          body,
          stageNumber: resolvedStageNumber,
          modelVersion,
        }),
        response_payload: summarizeSafeResponsePayload({
          result: responseResult,
          durableImageUrl,
          storageBucket,
          storagePath,
        }),
        completed_at: nowIso,
      });

      try {
        const spendResult = await spendTokens({
          supabase: stageRunContext.supabase,
          userId,
          spendTokens: stageRunContext.tokenCost,
          eventType: "generation_spend",
          actionType: stageRunContext.actionKey,
          stageNumber: resolvedStageNumber,
          modelVersion,
          roomId: room.id,
          generationRunId: generationRun.id,
          metadata: buildTokenLedgerMetadata({
            modelVersion,
            stageNumber: resolvedStageNumber,
            endpoint: "/api/vibode/stage-run",
            requestKind: "stage_generation",
          }),
        });
        if (spendResult.ok) {
          tokensCharged = spendResult.spentTokens;
          remainingTokens = spendResult.balanceTokens;
        }
      } catch (tokenSpendErr) {
        // TODO: move stage persistence + token spend into a transactional/compensation flow.
        console.error("[vibode/stage-run] token spend failed after successful generation:", tokenSpendErr);
      }
    } catch (persistErr) {
      console.error("[vibode/stage-run] persistence failed (non-blocking):", persistErr);
    }

    return Response.json({
      ...responseResult,
      tokensCharged,
      remainingTokens,
      actionKey: stageRunContext.actionKey,
    });
  } catch (err: any) {
    const message = String(err?.message || err);
    const status = message.includes(" 400 ")
      ? 400
      : message.includes(" 401 ")
      ? 401
      : message.includes(" 403 ")
      ? 403
      : 500;
    return Response.json({ error: message }, { status });
  }
}
