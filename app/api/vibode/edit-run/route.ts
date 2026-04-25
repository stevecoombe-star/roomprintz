import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getVibodeRoomById } from "@/lib/vibodePersistence";
import {
  finalizeVibodeOutputAsset,
  resolveVibodeOutputDimensions,
  resolveVibodeOutputStorage,
} from "@/lib/vibodeAssetFinalization";
import {
  canAffordTokens,
  getTokenCostForAction,
  getUserTokenWallet,
  refundTokens,
  spendTokens,
} from "@/lib/vibodeTokenDomain";
import { buildTokenLedgerMetadata, getEditTokenActionKey } from "@/lib/vibodeTokenPolicy";
import type { TokenActionKey } from "@/lib/vibodeTokenConstants";
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

type AnySupabaseClient = SupabaseClient<any, "public", any>;

type EditRunCompositorResult = {
  imageUrl?: string;
} & Record<string, unknown>;

function safeStr(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function parseOptionalStageNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (n < 0 || n > 32767) return null;
  return n;
}

function parseFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
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

function resolveEditActionType(action: string | null): TokenActionKey | null {
  if (!action) return null;
  const normalized = action.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "add") return "EDIT_SWAP";
  return getEditTokenActionKey(normalized);
}

export async function POST(req: NextRequest) {
  let spendContext:
    | {
        supabase: AnySupabaseClient;
        userId: string;
        tokenCost: number;
        actionType: TokenActionKey;
        stageNumber: number | null;
        modelVersion: string;
        roomId: string | null;
        vibodeRoomId: string | null;
      }
    | null = null;
  let tokensCharged = 0;
  let remainingTokens: number | null = null;

  try {
    const bodyRaw = (await req.json()) as unknown;
    const body =
      bodyRaw && typeof bodyRaw === "object" ? (bodyRaw as Record<string, unknown>) : {};
    const vibodeRoomId = safeStr(body.vibodeRoomId);
    const requestedStageNumber =
      parseOptionalStageNumber(body.stageNumber) ?? parseOptionalStageNumber(body.stage);
    const modelVersion =
      typeof body.modelVersion === "string" && body.modelVersion.trim().length > 0
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

    const endpointBase = process.env.ROOMPRINTZ_COMPOSITOR_URL?.trim();
    if (!endpointBase) {
      throw new Error(
        "ROOMPRINTZ_COMPOSITOR_URL is not set in env (RoomPrintz compositor endpoint)."
      );
    }

    const endpointBaseNormalized = endpointBase
      .replace(/\/stage-room\/?$/, "")
      .replace(/\/api\/vibode\/stage-run\/?$/, "")
      .replace(/\/vibode\/stage-run\/?$/, "")
      .replace(/\/vibode\/compose\/?$/, "")
      .replace(/\/vibode\/remove\/?$/, "")
      .replace(/\/vibode\/swap\/?$/, "")
      .replace(/\/vibode\/rotate\/?$/, "")
      .replace(/\/vibode\/full_vibe\/?$/, "")
      .replace(/\/$/, "");
    const endpoint = `${endpointBaseNormalized}/api/vibode/edit-run`;
    const apiKey = process.env.ROOMPRINTZ_COMPOSITOR_API_KEY;
    const payloadForCompositor = { ...body };
    delete payloadForCompositor.vibodeRoomId;
    delete payloadForCompositor.stageNumber;
    delete payloadForCompositor.pasteToPlaceControl;

    const action =
      typeof payloadForCompositor.action === "string"
        ? payloadForCompositor.action.trim().toLowerCase()
        : null;
    const tokenActionType = resolveEditActionType(action);
    if (!tokenActionType) {
      return Response.json(
        {
          errorCode: "UNSUPPORTED_EDIT_ACTION",
          message: "Unsupported edit action for token accounting.",
          action,
        },
        { status: 400 }
      );
    }

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

    const tokenCost = await getTokenCostForAction(supabase, tokenActionType);
    const walletBeforeSpend = await getUserTokenWallet(supabase, authenticatedUserId);
    const affordability = canAffordTokens({
      balanceTokens: walletBeforeSpend.balance_tokens,
      requiredTokens: tokenCost,
    });
    if (!affordability.allowed) {
      return Response.json(
        {
          errorCode: "INSUFFICIENT_TOKENS",
          message: "Insufficient internal token balance for this edit action.",
          requiredTokens: affordability.requiredTokens,
          balanceTokens: affordability.balanceTokens,
          shortfallTokens: affordability.shortfallTokens,
          actionKey: tokenActionType,
        },
        { status: 402 }
      );
    }

    const spendResult = await spendTokens({
      supabase,
      userId: authenticatedUserId,
      spendTokens: tokenCost,
      eventType: "generation_spend",
      actionType: tokenActionType,
      stageNumber: requestedStageNumber ?? existingRoom?.current_stage ?? null,
      modelVersion,
      roomId: existingRoom?.id ?? null,
      generationRunId: null,
      metadata: buildTokenLedgerMetadata({
        modelVersion,
        stageNumber: requestedStageNumber ?? existingRoom?.current_stage ?? null,
        endpoint: "/api/vibode/edit-run",
        requestKind: "edit_generation",
      }),
    });
    if (!spendResult.ok) {
      return Response.json(
        {
          errorCode: "INSUFFICIENT_TOKENS",
          message: "Insufficient internal token balance for this edit action.",
          requiredTokens: tokenCost,
          balanceTokens: spendResult.balanceTokens,
          shortfallTokens: spendResult.shortfallTokens,
          actionKey: tokenActionType,
        },
        { status: 402 }
      );
    }
    tokensCharged = spendResult.spentTokens;
    remainingTokens = spendResult.balanceTokens;
    spendContext = {
      supabase,
      userId: authenticatedUserId,
      tokenCost,
      actionType: tokenActionType,
      stageNumber: requestedStageNumber ?? existingRoom?.current_stage ?? null,
      modelVersion,
      roomId: existingRoom?.id ?? null,
      vibodeRoomId,
    };
    if (action === "remove") {
      const targetRecord = isRecord(payloadForCompositor.target)
        ? ({ ...payloadForCompositor.target } as Record<string, unknown>)
        : {};
      const paramsRecord = isRecord(payloadForCompositor.params)
        ? ({ ...payloadForCompositor.params } as Record<string, unknown>)
        : {};
      const xNormRaw =
        parseFiniteNumber(targetRecord.xNorm) ??
        parseFiniteNumber(targetRecord.x) ??
        parseFiniteNumber(paramsRecord.xNorm) ??
        parseFiniteNumber(paramsRecord.x);
      const yNormRaw =
        parseFiniteNumber(targetRecord.yNorm) ??
        parseFiniteNumber(targetRecord.y) ??
        parseFiniteNumber(paramsRecord.yNorm) ??
        parseFiniteNumber(paramsRecord.y);
      if (xNormRaw === null || yNormRaw === null) {
        return Response.json(
          { message: "remove requires finite target.xNorm and target.yNorm." },
          { status: 400 }
        );
      }

      const xNorm = clampUnit(xNormRaw);
      const yNorm = clampUnit(yNormRaw);

      payloadForCompositor.target = {
        xNorm,
        yNorm,
        x: xNorm,
        y: yNorm,
      };
      payloadForCompositor.params = {
        ...paramsRecord,
        xNorm,
        yNorm,
        x: xNorm,
        y: yNorm,
      };
    } else if (action === "rotate") {
      const targetRecord = isRecord(payloadForCompositor.target)
        ? ({ ...payloadForCompositor.target } as Record<string, unknown>)
        : {};
      const paramsRecord = isRecord(payloadForCompositor.params)
        ? ({ ...payloadForCompositor.params } as Record<string, unknown>)
        : {};
      const xNormRaw =
        parseFiniteNumber(payloadForCompositor.xNorm) ??
        parseFiniteNumber(targetRecord.xNorm) ??
        parseFiniteNumber(targetRecord.x) ??
        parseFiniteNumber(paramsRecord.xNorm) ??
        parseFiniteNumber(paramsRecord.x);
      const yNormRaw =
        parseFiniteNumber(payloadForCompositor.yNorm) ??
        parseFiniteNumber(targetRecord.yNorm) ??
        parseFiniteNumber(targetRecord.y) ??
        parseFiniteNumber(paramsRecord.yNorm) ??
        parseFiniteNumber(paramsRecord.y);
      const rotationDegreesRaw =
        parseFiniteNumber(payloadForCompositor.rotationDegrees) ??
        parseFiniteNumber(targetRecord.rotationDegrees) ??
        parseFiniteNumber(paramsRecord.rotationDegrees) ??
        parseFiniteNumber(paramsRecord.rotationDeg);
      if (xNormRaw === null || yNormRaw === null || rotationDegreesRaw === null) {
        return Response.json(
          { message: "rotate requires finite xNorm, yNorm, and rotationDegrees." },
          { status: 400 }
        );
      }

      payloadForCompositor.xNorm = clampUnit(xNormRaw);
      payloadForCompositor.yNorm = clampUnit(yNormRaw);
      payloadForCompositor.rotationDegrees = rotationDegreesRaw;
      delete payloadForCompositor.target;
      delete payloadForCompositor.params;
      delete payloadForCompositor.placementId;
    } else if (action === "add" || action === "swap") {
      const targetRecord = isRecord(payloadForCompositor.target)
        ? ({ ...payloadForCompositor.target } as Record<string, unknown>)
        : {};
      const paramsRecord = isRecord(payloadForCompositor.params)
        ? ({ ...payloadForCompositor.params } as Record<string, unknown>)
        : {};
      const x = parseFiniteNumber(paramsRecord.x);
      const y = parseFiniteNumber(paramsRecord.y);

      if (x === null || y === null) {
        return Response.json(
          { message: `${action} requires finite params.x and params.y.` },
          { status: 400 }
        );
      }

      const targetSkuId =
        safeStr(targetRecord.skuId) ?? (action === "swap" ? safeStr(paramsRecord.newSkuId) : null);
      if (!targetSkuId) {
        return Response.json({ message: `${action} requires target.skuId.` }, { status: 400 });
      }

      targetRecord.skuId = targetSkuId;
      if (Object.prototype.hasOwnProperty.call(targetRecord, "placementId")) {
        delete targetRecord.placementId;
      }
      paramsRecord.x = x;
      paramsRecord.y = y;
      if (action === "swap") {
        paramsRecord.newSkuId = targetSkuId;
      }
      payloadForCompositor.target = targetRecord;
      payloadForCompositor.params = paramsRecord;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    if (pasteToPlaceControl) {
      headers[PASTE_TO_PLACE_JOB_ID_HEADER] = pasteToPlaceControl.jobId;
      headers[PASTE_TO_PLACE_SCOPE_ID_HEADER] = pasteToPlaceControl.scopeId;
    }

    const preCompositorCancellation = cancelledResponse();
    if (preCompositorCancellation) {
      console.info("[vibode/edit-run] exiting early before compositor (paste-to-place stale/cancelled)", {
        scopeId: pasteToPlaceControl?.scopeId,
        jobId: pasteToPlaceControl?.jobId,
      });
      return preCompositorCancellation;
    }

    const upstreamRes = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ...payloadForCompositor,
        modelVersion,
      }),
    });

    const upstreamStatus = upstreamRes.status;
    const upstreamResult = (await upstreamRes.json().catch(() => ({}))) as unknown;
    const responseRecord = isRecord(upstreamResult)
      ? ({ ...upstreamResult } as EditRunCompositorResult)
      : ({} as EditRunCompositorResult);
    if (!upstreamRes.ok) {
      if (spendContext) {
        try {
          const refundResult = await refundTokens({
            supabase: spendContext.supabase,
            userId: spendContext.userId,
            refundTokens: spendContext.tokenCost,
            actionType: spendContext.actionType,
            stageNumber: spendContext.stageNumber,
            modelVersion: spendContext.modelVersion,
            roomId: spendContext.roomId,
            generationRunId: null,
            metadata: {
              ...buildTokenLedgerMetadata({
                modelVersion: spendContext.modelVersion,
                stageNumber: spendContext.stageNumber,
                endpoint: "/api/vibode/edit-run",
                requestKind: "edit_generation",
              }),
              reason: "upstream_error",
              upstreamStatus,
            },
          });
          tokensCharged = 0;
          remainingTokens = refundResult.balanceTokens;
        } catch (refundErr) {
          console.error("[vibode/edit-run] refund failed after upstream error:", refundErr);
        } finally {
          spendContext = null;
        }
      }
      return Response.json(responseRecord, { status: upstreamStatus });
    }
    if (!isPasteToPlaceJobActive()) {
      console.info("[vibode/edit-run] dropping compositor result before finalization (paste-to-place stale/cancelled)", {
        scopeId: pasteToPlaceControl?.scopeId,
        jobId: pasteToPlaceControl?.jobId,
      });
      return cancelledResponse() ?? buildPasteToPlaceCancelledResponse("stale");
    }
    const responseImageUrl = safeStr(responseRecord.imageUrl);
    if (!responseImageUrl) {
      if (spendContext) {
        try {
          const refundResult = await refundTokens({
            supabase: spendContext.supabase,
            userId: spendContext.userId,
            refundTokens: spendContext.tokenCost,
            actionType: spendContext.actionType,
            stageNumber: spendContext.stageNumber,
            modelVersion: spendContext.modelVersion,
            roomId: spendContext.roomId,
            generationRunId: null,
            metadata: {
              ...buildTokenLedgerMetadata({
                modelVersion: spendContext.modelVersion,
                stageNumber: spendContext.stageNumber,
                endpoint: "/api/vibode/edit-run",
                requestKind: "edit_generation",
              }),
              reason: "missing_image_url",
            },
          });
          tokensCharged = 0;
          remainingTokens = refundResult.balanceTokens;
        } catch (refundErr) {
          console.error("[vibode/edit-run] refund failed after missing imageUrl:", refundErr);
        } finally {
          spendContext = null;
        }
      }
      console.warn("[vibode/edit-run] persistence skipped: successful response missing imageUrl");
      return Response.json(responseRecord, { status: upstreamStatus });
    }

    let persistenceSupabase: AnySupabaseClient | null = null;
    let persistenceRoomId: string | null = null;
    let persistenceUserId: string | null = null;
    let roomStageForPersistence: number | null = null;

    if (!spendContext?.vibodeRoomId) {
      console.info("[vibode/edit-run] persistence skipped: missing vibodeRoomId");
    } else {
      persistenceSupabase = spendContext.supabase;
      persistenceRoomId = spendContext.roomId;
      persistenceUserId = spendContext.userId;
      roomStageForPersistence = spendContext.stageNumber;
    }

    const hintedStorage = resolveVibodeOutputStorage(responseRecord);
    const hintedDimensions = resolveVibodeOutputDimensions(responseRecord);
    const finalization = await finalizeVibodeOutputAsset({
      logPrefix: "[vibode/edit-run]",
      adminSupabase: getAdminSupabaseClient(),
      persistenceSupabase,
      roomId: persistenceRoomId ?? vibodeRoomId,
      userId: persistenceUserId,
      assetType: "stage_output",
      stageNumber: requestedStageNumber ?? roomStageForPersistence,
      modelVersion,
      responseImageUrl,
      responseStorageBucket: hintedStorage.storageBucket,
      responseStoragePath: hintedStorage.storagePath,
      responseWidth: hintedDimensions.width,
      responseHeight: hintedDimensions.height,
      sourceImageUrlForThumbnail: responseImageUrl,
      markAssetActive: Boolean(persistenceSupabase && persistenceRoomId && persistenceUserId),
      updateRoomCurrentStage: requestedStageNumber ?? roomStageForPersistence,
      updateRoomSortKey: new Date().toISOString(),
    });
    if (finalization.assetFinalizationError) {
      console.error("[vibode/edit-run] persistence failed (non-blocking):", finalization.assetFinalizationError);
    }
    if (!isPasteToPlaceJobActive()) {
      console.info("[vibode/edit-run] dropping finalized response before return (paste-to-place stale/cancelled)", {
        scopeId: pasteToPlaceControl?.scopeId,
        jobId: pasteToPlaceControl?.jobId,
      });
      return cancelledResponse() ?? buildPasteToPlaceCancelledResponse("stale");
    }

    const responsePayload = {
      ...responseRecord,
      ...(finalization.imageUrl ? { imageUrl: finalization.imageUrl } : {}),
      ...(finalization.storageBucket ? { storageBucket: finalization.storageBucket } : {}),
      ...(finalization.storagePath ? { storagePath: finalization.storagePath } : {}),
      tokensCharged,
      remainingTokens,
      actionKey: tokenActionType,
    };
    spendContext = null;

    return Response.json(responsePayload, { status: upstreamStatus });
  } catch (err: any) {
    if (spendContext) {
      try {
        const refundResult = await refundTokens({
          supabase: spendContext.supabase,
          userId: spendContext.userId,
          refundTokens: spendContext.tokenCost,
          actionType: spendContext.actionType,
          stageNumber: spendContext.stageNumber,
          modelVersion: spendContext.modelVersion,
          roomId: spendContext.roomId,
          generationRunId: null,
          metadata: {
            ...buildTokenLedgerMetadata({
              modelVersion: spendContext.modelVersion,
              stageNumber: spendContext.stageNumber,
              endpoint: "/api/vibode/edit-run",
              requestKind: "edit_generation",
            }),
            reason: "internal_exception",
            error: String(err?.message || err),
          },
        });
        tokensCharged = 0;
        remainingTokens = refundResult.balanceTokens;
      } catch (refundErr) {
        console.error("[vibode/edit-run] refund failed after internal exception:", refundErr);
      } finally {
        spendContext = null;
      }
    }

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
