import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callCompositorVibodeStageRun } from "@/lib/callCompositorVibodeStageRun";
import {
  buildVibodeCompositorContextHeaders,
  resolveVibodeOperationIdFromHeaders,
  resolveVibodeRequestIdFromHeaders,
} from "@/lib/vibodeCompositorContextHeaders";
import {
  createVibodeGenerationRun,
  getVibodeRoomById,
} from "@/lib/vibodePersistence";
import {
  finalizeVibodeOutputAsset,
  resolveVibodeOutputDimensions,
  resolveVibodeOutputStorage,
} from "@/lib/vibodeAssetFinalization";
import { inferPersistedVibodeVersionKindFromStageNumber } from "@/lib/vibode/version-kind";
import {
  chargeVibodeTokensForOperation,
  canAffordTokens,
  getTokenCostForOperation,
  getUserTokenWallet,
  recordTokenChargeFailure,
} from "@/lib/vibodeTokenDomain";
import {
  buildTokenLedgerMetadata,
  getStageTokenActionKey,
  getStageTokenOperationKey,
} from "@/lib/vibodeTokenPolicy";
import { TOKEN_DEFAULT_COSTS } from "@/lib/vibodeTokenConstants";
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
const STAGE4_STYLE_MODE_ORDER = [
  "style_room",
  "accessories",
  "wall_art",
  "shelves",
  "curtains",
  "ceiling_light",
] as const;
type Stage4StyleIntent = (typeof STAGE4_STYLE_MODE_ORDER)[number];
const STAGE4_STYLE_MODES = new Set<Stage4StyleIntent>(STAGE4_STYLE_MODE_ORDER);
const STAGE4_DEFAULT_STYLE_MODE: Stage4StyleIntent = "style_room";
const STAGE4_INTENT_LABELS: Record<Stage4StyleIntent, string> = {
  style_room: "Overall room style",
  accessories: "Accessories",
  wall_art: "Wall art",
  shelves: "Shelves",
  curtains: "Curtains",
  ceiling_light: "Ceiling light",
};
const STAGE4_INTENT_PROMPT_LINES: Record<Stage4StyleIntent, string> = {
  style_room:
    "Apply a cohesive overall interior design style and vibe to the room while preserving architecture, camera angle, and core layout.",
  accessories:
    "Add or refine tasteful decor accessories such as cushions, throws, rugs, tabletop items, plants, books, trays, and small decorative accents where appropriate.",
  wall_art: "Add or refine wall art that fits the room style, scale, and natural wall placement.",
  shelves:
    "Add or refine shelving or shelf styling where architecturally plausible, including naturally styled objects on shelves.",
  curtains:
    "Add or refine curtains or window treatments where windows are present or clearly implied, matching the overall style.",
  ceiling_light:
    "Add or refine a ceiling light or overhead fixture where architecturally plausible, with lighting that stays coherent with the scene.",
};

type StageRunCompositorResult = {
  imageUrl: string;
  appliedAspectRatio?: string | null;
} & Record<string, unknown>;

type AnySupabaseClient = SupabaseClient;

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

function isStage4StyleIntent(value: unknown): value is Stage4StyleIntent {
  return typeof value === "string" && STAGE4_STYLE_MODES.has(value as Stage4StyleIntent);
}

function parseStage4Modes(value: unknown): Stage4StyleIntent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<Stage4StyleIntent>();
  for (const candidate of value) {
    const normalized = safeStr(candidate);
    if (!isStage4StyleIntent(normalized)) continue;
    seen.add(normalized);
  }
  return Array.from(seen);
}

function resolveStage4SelectedIntents(body: Record<string, unknown>): Stage4StyleIntent[] {
  const selectedFromIntents = parseStage4Modes(body.stage4Intents);
  if (selectedFromIntents.length > 0) return selectedFromIntents;
  const selectedFromModes = parseStage4Modes(body.stage4Modes);
  if (selectedFromModes.length > 0) return selectedFromModes;
  const singleMode = safeStr(body.stage4Mode);
  if (isStage4StyleIntent(singleMode)) return [singleMode];
  return [STAGE4_DEFAULT_STYLE_MODE];
}

function buildStage4CombinedPrompt(selectedIntents: Stage4StyleIntent[]): string {
  const sections = selectedIntents.map((intent, idx) => {
    const label = STAGE4_INTENT_LABELS[intent];
    const detail = STAGE4_INTENT_PROMPT_LINES[intent];
    return `${idx + 1}. ${label}: ${detail}`;
  });
  return [
    "Apply the selected STYLE updates in one cohesive interior design pass.",
    "Do not treat these as separate edits. Integrate all requested changes into a single natural result.",
    "Preserve the room's architecture, camera angle, perspective, core layout, scene realism, and existing furniture placement.",
    "Keep lighting coherent and physically plausible across all changes.",
    "",
    "Selected STYLE updates:",
    ...sections,
    "",
    "The final image should feel like one professionally styled room, not separate unrelated edits.",
  ].join("\n");
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const candidate = err as { name?: unknown; message?: unknown };
  if (candidate.name === "AbortError") return true;
  if (typeof candidate.message !== "string") return false;
  return candidate.message.toLowerCase().includes("abort");
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
  resolvedStage4Intents: Stage4StyleIntent[];
  stage4CombinedPrompt: string | null;
}) {
  const eligibleSkus = Array.isArray(args.body.eligibleSkus) ? args.body.eligibleSkus : [];
  const stage4Modes = parseStage4Modes(args.body.stage4Modes);
  const stage4Intents = parseStage4Modes(args.body.stage4Intents);
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
    stage4Modes,
    stage4Intents,
    stage4ResolvedIntents: args.resolvedStage4Intents,
    stage4PromptMode: args.stage4CombinedPrompt ? "combined" : "single_or_legacy",
    stage4PromptChars: args.stage4CombinedPrompt?.length ?? 0,
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

function resolveStageRunWorkflowContext(args: {
  stageNumber: number | null;
  stage4Mode: string | null;
  stage4Modes: Stage4StyleIntent[];
  enhancePhoto: boolean;
  repairDamage: boolean;
  repaintWalls: boolean;
  flooringPreset: string | null;
  flooring: string | null;
  flooringType: string | null;
  selectedFlooring: string | null;
}): { workflowType: string; actionType: string; sourceTrigger: string } {
  const hasStyleSelection =
    (args.stage4Mode ? isStage4StyleIntent(args.stage4Mode) : false) ||
    args.stage4Modes.some((mode) => STAGE4_STYLE_MODES.has(mode));
  if (hasStyleSelection) {
    return {
      workflowType: "style",
      actionType: "stage-run",
      sourceTrigger: "style-room",
    };
  }
  const hasModifyRoomFlooring =
    (args.flooringPreset !== null && args.flooringPreset !== "none") ||
    (args.flooring !== null && args.flooring !== "none") ||
    (args.flooringType !== null && args.flooringType !== "none") ||
    (args.selectedFlooring !== null && args.selectedFlooring !== "none");
  const hasModifyRoomSelection =
    args.stageNumber === 2 && (args.repairDamage || args.repaintWalls || hasModifyRoomFlooring);
  if (hasModifyRoomSelection) {
    return {
      workflowType: "set",
      actionType: "stage-run",
      sourceTrigger: "modify-room",
    };
  }
  if (args.stageNumber === 1 && args.enhancePhoto) {
    return {
      workflowType: "set",
      actionType: "stage-run",
      sourceTrigger: "enhance-run-stage",
    };
  }
  return {
    workflowType: "stage",
    actionType: "stage-run",
    sourceTrigger: "update-room",
  };
}

function buildOperationIdempotencyKey(args: {
  userId: string;
  operationKey: string;
  routeKey: string;
  operationId: string | null;
  requestId: string | null;
  fallbackId: string;
}) {
  return [
    args.userId,
    args.operationKey,
    args.routeKey,
    args.operationId ?? "no-operation-id",
    args.requestId ?? "no-request-id",
    args.fallbackId,
  ].join(":");
}

export async function POST(req: NextRequest) {
  let pasteToPlaceControl: ReturnType<typeof parsePasteToPlaceJobControlFromBody> = null;
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
    const requestId = resolveVibodeRequestIdFromHeaders(req.headers);
    const operationId = resolveVibodeOperationIdFromHeaders(req.headers);
    pasteToPlaceControl = parsePasteToPlaceJobControlFromBody(body);
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
          operationKey: NonNullable<ReturnType<typeof getStageTokenOperationKey>>;
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
    const tokenAdminSupabase = getAdminSupabaseClient();
    if (!tokenAdminSupabase) {
      return Response.json(
        { error: "Server configuration missing service role Supabase for token charging." },
        { status: 500 }
      );
    }
    const authenticatedUserId = userData.user.id;
    const authenticatedUserEmail = userData.user.email ?? null;

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
    const operationKey = getStageTokenOperationKey(preflightStageNumber);
    if (!actionKey || !operationKey || preflightStageNumber === null) {
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
    const resolvedStage4Intents =
      tokenStageNumber === 4 ? resolveStage4SelectedIntents(body) : [];
    const stage4Mode =
      tokenStageNumber === 4
        ? (resolvedStage4Intents[0] ?? STAGE4_DEFAULT_STYLE_MODE)
        : safeStr(body.stage4Mode);
    const stage4Modes =
      tokenStageNumber === 4 ? resolvedStage4Intents : parseStage4Modes(body.stage4Modes);
    const stage4CombinedPrompt =
      tokenStageNumber === 4 && resolvedStage4Intents.length > 1
        ? buildStage4CombinedPrompt(resolvedStage4Intents)
        : null;
    if (tokenStageNumber === 4) {
      payloadForCompositor.stage4Mode = stage4Mode;
      payloadForCompositor.stage4Modes = stage4Modes;
      payloadForCompositor.stage4Intents = resolvedStage4Intents;
      payloadForCompositor.stage4IntentLabels = resolvedStage4Intents.map(
        (intent) => STAGE4_INTENT_LABELS[intent]
      );
      if (stage4CombinedPrompt) {
        payloadForCompositor.stage4Prompt = stage4CombinedPrompt;
        payloadForCompositor.prompt = stage4CombinedPrompt;
        payloadForCompositor.instruction = stage4CombinedPrompt;
      }
      console.info("[vibode/stage-run] resolved Stage 4 style intents", {
        stage4Mode,
        stage4Modes,
        stage4Intents: resolvedStage4Intents,
        promptMode: stage4CombinedPrompt ? "combined" : "single_or_legacy",
      });
    }
    const stageRunContextHeaders = resolveStageRunWorkflowContext({
      stageNumber: tokenStageNumber,
      stage4Mode,
      stage4Modes,
      enhancePhoto: body.enhancePhoto === true,
      repairDamage: body.repairDamage === true,
      repaintWalls: body.repaintWalls === true,
      flooringPreset: safeStr(body.flooringPreset),
      flooring: safeStr(body.flooring),
      flooringType: safeStr(body.flooringType),
      selectedFlooring: safeStr(body.selectedFlooring),
    });
    const sourceVersionId =
      safeStr(body.versionId) ??
      safeStr(body.assetId) ??
      safeStr(body.sourceVersionId) ??
      existingRoom?.active_asset_id ??
      null;
    const sourceAssetId = safeStr(body.assetId) ?? sourceVersionId;

    const wallet = await getUserTokenWallet(tokenAdminSupabase, authenticatedUserId);
    const tokenCost = await getTokenCostForOperation(
      supabase,
      operationKey,
      TOKEN_DEFAULT_COSTS[actionKey]
    );
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
          operationKey,
          stageNumber: tokenStageNumber,
        },
        { status: 402 }
      );
    }

    stageRunContext = {
      userId: authenticatedUserId,
      room: existingRoom,
      actionKey,
      operationKey,
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
      signal: req.signal,
      headers: pasteToPlaceControl
        ? {
            [PASTE_TO_PLACE_JOB_ID_HEADER]: pasteToPlaceControl.jobId,
            [PASTE_TO_PLACE_SCOPE_ID_HEADER]: pasteToPlaceControl.scopeId,
            ...buildVibodeCompositorContextHeaders({
              requestId,
              operationId,
              userId: authenticatedUserId,
              userEmail: authenticatedUserEmail,
              roomId: vibodeRoomId ?? existingRoom?.id ?? null,
              versionId: sourceVersionId,
              assetId: sourceAssetId,
              workflowType: stageRunContextHeaders.workflowType,
              actionType: stageRunContextHeaders.actionType,
              sourceTrigger: stageRunContextHeaders.sourceTrigger,
            }),
          }
        : buildVibodeCompositorContextHeaders({
            requestId,
            operationId,
            userId: authenticatedUserId,
            userEmail: authenticatedUserEmail,
            roomId: vibodeRoomId ?? existingRoom?.id ?? null,
            versionId: sourceVersionId,
            assetId: sourceAssetId,
            workflowType: stageRunContextHeaders.workflowType,
            actionType: stageRunContextHeaders.actionType,
            sourceTrigger: stageRunContextHeaders.sourceTrigger,
          }),
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
      versionKind: inferPersistedVibodeVersionKindFromStageNumber(stageRunContext.resolvedStageNumber),
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
      const roomlessChargeFallbackId =
        outputFinalization.outputAssetId ??
        outputFinalization.storagePath ??
        outputFinalization.durableImageUrl ??
        safeStr(responseResult.imageUrl) ??
        `stage-run:${stageRunContext.resolvedStageNumber}:${sourceVersionId ?? "no-source-version"}`;
      try {
        const adminSupabase = getAdminSupabaseClient();
        if (!adminSupabase) {
          throw new Error("[vibode/stage-run] service role Supabase unavailable for token charge.");
        }
        const chargeResult = await chargeVibodeTokensForOperation({
          supabase: adminSupabase,
          userId: stageRunContext.userId,
          operationKey: stageRunContext.operationKey,
          idempotencyKey: buildOperationIdempotencyKey({
            userId: stageRunContext.userId,
            operationKey: stageRunContext.operationKey,
            routeKey: "/api/vibode/stage-run",
            operationId,
            requestId,
            fallbackId: roomlessChargeFallbackId,
          }),
          operationId,
          requestId,
          modelVersion,
          chargePhase: "success",
          metadata: buildTokenLedgerMetadata({
            modelVersion,
            stageNumber: stageRunContext.resolvedStageNumber,
            endpoint: "/api/vibode/stage-run",
            requestKind: "stage_generation",
          }),
        });
        tokensCharged = chargeResult.skipped ? 0 : chargeResult.chargedTokens;
        remainingTokens = chargeResult.balanceTokens ?? remainingTokens;
      } catch (tokenSpendErr) {
        console.error(
          "[vibode/stage-run] token charge failed after successful generation (no room context):",
          tokenSpendErr
        );
        const failureSupabase = getAdminSupabaseClient();
        if (failureSupabase) {
          await recordTokenChargeFailure({
            supabase: failureSupabase,
            userId: stageRunContext.userId,
            operationKey: stageRunContext.operationKey,
            operationId,
            requestId,
            idempotencyKey: buildOperationIdempotencyKey({
              userId: stageRunContext.userId,
              operationKey: stageRunContext.operationKey,
              routeKey: "/api/vibode/stage-run",
              operationId,
              requestId,
              fallbackId: roomlessChargeFallbackId,
            }),
            route: "/api/vibode/stage-run",
            chargePhase: "success",
            expectedTokens: stageRunContext.tokenCost,
            modelVersion,
            roomId: stageRunContext.room?.id ?? null,
            outputAssetId: outputFinalization.outputAssetId,
            errorMessage: tokenSpendErr instanceof Error ? tokenSpendErr.message : String(tokenSpendErr),
            metadata: {
              stageNumber: stageRunContext.resolvedStageNumber,
              requestKind: "stage_generation_no_room_context",
              fallbackId: roomlessChargeFallbackId,
            },
          });
        }
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
          resolvedStage4Intents,
          stage4CombinedPrompt,
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
        const adminSupabase = getAdminSupabaseClient();
        if (!adminSupabase) {
          throw new Error("[vibode/stage-run] service role Supabase unavailable for token charge.");
        }
        const chargeResult = await chargeVibodeTokensForOperation({
          supabase: adminSupabase,
          userId,
          operationKey: stageRunContext.operationKey,
          idempotencyKey: buildOperationIdempotencyKey({
            userId,
            operationKey: stageRunContext.operationKey,
            routeKey: "/api/vibode/stage-run",
            operationId,
            requestId,
            fallbackId: generationRun.id,
          }),
          operationId,
          requestId,
          modelVersion,
          chargePhase: "success",
          roomId: room.id,
          generationRunId: generationRun.id,
          metadata: buildTokenLedgerMetadata({
            modelVersion,
            stageNumber: resolvedStageNumber,
            endpoint: "/api/vibode/stage-run",
            requestKind: "stage_generation",
          }),
        });
        tokensCharged = chargeResult.skipped ? 0 : chargeResult.chargedTokens;
        remainingTokens = chargeResult.balanceTokens ?? remainingTokens;
      } catch (tokenSpendErr) {
        // TODO: move stage persistence + token charge into a transactional/compensation flow.
        console.error("[vibode/stage-run] token charge failed after successful generation:", tokenSpendErr);
        const failureSupabase = getAdminSupabaseClient();
        if (failureSupabase) {
          await recordTokenChargeFailure({
            supabase: failureSupabase,
            userId,
            operationKey: stageRunContext.operationKey,
            operationId,
            requestId,
            idempotencyKey: buildOperationIdempotencyKey({
              userId,
              operationKey: stageRunContext.operationKey,
              routeKey: "/api/vibode/stage-run",
              operationId,
              requestId,
              fallbackId: generationRun.id,
            }),
            route: "/api/vibode/stage-run",
            chargePhase: "success",
            expectedTokens: stageRunContext.tokenCost,
            modelVersion,
            roomId: room.id,
            generationRunId: generationRun.id,
            outputAssetId: outputFinalization.outputAssetId,
            errorMessage: tokenSpendErr instanceof Error ? tokenSpendErr.message : String(tokenSpendErr),
            metadata: {
              stageNumber: resolvedStageNumber,
              requestKind: "stage_generation",
            },
          });
        }
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
  } catch (err: unknown) {
    if (pasteToPlaceControl && (req.signal.aborted || isAbortError(err))) {
      console.info("[vibode/stage-run] request aborted by client (paste-to-place)", {
        scopeId: pasteToPlaceControl.scopeId,
        jobId: pasteToPlaceControl.jobId,
      });
      const state = getPasteToPlaceJobState(pasteToPlaceControl.scopeId, pasteToPlaceControl.jobId);
      return buildPasteToPlaceCancelledResponse(state === "stale" ? "stale" : "cancelled");
    }

    const message = err instanceof Error ? err.message : String(err);
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
