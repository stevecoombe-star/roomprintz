import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callCompositorVibodeStageRun } from "@/lib/callCompositorVibodeStageRun";
import {
  createVibodeGenerationRun,
  createVibodeRoomAsset,
  getVibodeRoomById,
  updateVibodeRoomAsset,
  updateVibodeRoom,
} from "@/lib/vibodePersistence";
import { createVibodeAssetThumbnail } from "@/lib/vibodeAssetThumbnails";
import {
  canAffordTokens,
  getTokenCostForAction,
  getUserTokenWallet,
  spendTokens,
} from "@/lib/vibodeTokenDomain";
import { buildTokenLedgerMetadata, getStageTokenActionKey } from "@/lib/vibodeTokenPolicy";

export const runtime = "nodejs";
const VIBODE_DEFAULT_MODEL_VERSION = "NBP";
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const VIBODE_STAGED_BUCKET = (process.env.VIBODE_STAGED_BUCKET || "vibode-generations").trim();

type StageRunCompositorResult = {
  imageUrl: string;
  appliedAspectRatio?: string | null;
} & Record<string, unknown>;

type AnySupabaseClient = SupabaseClient<any, "public", any>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

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

function parseOptionalPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const n = Math.trunc(value);
  if (n <= 0) return null;
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

function isLikelyExpiringSignedUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes("/storage/v1/object/sign/")) return true;
    if (parsed.searchParams.has("token")) return true;
    if (parsed.searchParams.has("X-Amz-Signature")) return true;
    if (parsed.searchParams.has("X-Amz-Credential")) return true;
    return false;
  } catch {
    return false;
  }
}

function getDurableImageUrl(args: { candidateUrl?: string | null; storageBucket?: string | null }) {
  const url = typeof args.candidateUrl === "string" ? args.candidateUrl.trim() : "";
  if (!url) return null;
  const bucket = typeof args.storageBucket === "string" ? args.storageBucket.trim() : "";
  const isPrivateBucket =
    bucket === "vibode-generations" || bucket === VIBODE_STAGED_BUCKET || bucket === "vibode-base-images";
  if (isPrivateBucket && isLikelyExpiringSignedUrl(url)) return null;
  return url;
}

function parseStorageLocationFromImageUrl(
  imageUrl: string | null
): { storageBucket: string | null; storagePath: string | null } {
  if (!imageUrl) return { storageBucket: null, storagePath: null };

  try {
    const parsed = new URL(imageUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const objectIndex = parts.indexOf("object");
    if (objectIndex < 0) return { storageBucket: null, storagePath: null };

    let bucketIndex = objectIndex + 1;
    const mode = parts[objectIndex + 1];
    if (mode === "sign" || mode === "public" || mode === "authenticated") {
      bucketIndex = objectIndex + 2;
    }

    const bucket = parts[bucketIndex];
    const keyParts = parts.slice(bucketIndex + 1);
    if (!bucket || keyParts.length === 0) {
      return { storageBucket: null, storagePath: null };
    }

    return {
      storageBucket: decodeURIComponent(bucket),
      storagePath: decodeURIComponent(keyParts.join("/")),
    };
  } catch {
    return { storageBucket: null, storagePath: null };
  }
}

function resolveOutputStorage(result: StageRunCompositorResult): {
  storageBucket: string | null;
  storagePath: string | null;
} {
  const output = isRecord(result.output) ? result.output : null;

  const storageBucket =
    safeStr(result.storageBucket) ??
    safeStr(result.storage_bucket) ??
    safeStr(result.bucket) ??
    safeStr(output?.storageBucket) ??
    safeStr(output?.storage_bucket) ??
    safeStr(output?.bucket);

  const storagePath =
    safeStr(result.storagePath) ??
    safeStr(result.storage_path) ??
    safeStr(result.storageKey) ??
    safeStr(result.storage_key) ??
    safeStr(result.key) ??
    safeStr(output?.storagePath) ??
    safeStr(output?.storage_path) ??
    safeStr(output?.storageKey) ??
    safeStr(output?.storage_key) ??
    safeStr(output?.key);

  if (storageBucket && storagePath) {
    return { storageBucket, storagePath };
  }

  return parseStorageLocationFromImageUrl(safeStr(result.imageUrl));
}

function parseDataUrlImage(dataUrl: string): { mime: string; buf: Buffer } {
  const matched = dataUrl.trim().match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (!matched) {
    throw new Error("Invalid stage output data URL.");
  }
  return {
    mime: matched[1].toLowerCase(),
    buf: Buffer.from(matched[2], "base64"),
  };
}

function inferExtFromContentType(contentType: string) {
  const c = (contentType || "").toLowerCase();
  if (c.includes("jpeg") || c.includes("jpg")) return { ext: "jpg", contentType: "image/jpeg" };
  if (c.includes("webp")) return { ext: "webp", contentType: "image/webp" };
  if (c.includes("png")) return { ext: "png", contentType: "image/png" };
  return { ext: "png", contentType: "image/png" };
}

function sanitizeStoragePathPart(value: string | null | undefined, fallback: string) {
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = raw.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function buildStageRunStoragePath(args: {
  vibodeRoomId: string | null;
  stageNumber: number | null;
  ext: string;
}) {
  const roomPart = sanitizeStoragePathPart(args.vibodeRoomId, "room");
  const stagePart =
    typeof args.stageNumber === "number" && Number.isFinite(args.stageNumber)
      ? `stage_${Math.trunc(args.stageNumber)}`
      : "stage_unknown";
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return `${roomPart}/${stagePart}/${nonce}.${args.ext}`;
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

async function persistStageRunDataUrlToStorage(args: {
  admin: AnySupabaseClient;
  dataUrl: string;
  vibodeRoomId: string | null;
  stageNumber: number | null;
  storageBucketHint: string | null;
  storagePathHint: string | null;
}) {
  const { mime, buf } = parseDataUrlImage(args.dataUrl);
  const inferred = inferExtFromContentType(mime);
  const storageBucket = safeStr(args.storageBucketHint) ?? VIBODE_STAGED_BUCKET;
  const storagePath =
    safeStr(args.storagePathHint) ??
    buildStageRunStoragePath({
      vibodeRoomId: args.vibodeRoomId,
      stageNumber: args.stageNumber,
      ext: inferred.ext,
    });
  const expiresInSec = Math.max(
    60,
    Number(process.env.VIBODE_STAGED_SIGNED_URL_EXPIRES_IN ?? 60 * 60 * 24 * 7)
  );

  const { error: uploadErr } = await args.admin.storage
    .from(storageBucket)
    .upload(storagePath, buf, { contentType: inferred.contentType, upsert: true });
  if (uploadErr) {
    throw new Error(`Failed to upload stage output image: ${uploadErr.message}`);
  }

  const { data: signed, error: signErr } = await args.admin.storage
    .from(storageBucket)
    .createSignedUrl(storagePath, expiresInSec);
  if (signErr || !signed?.signedUrl) {
    throw new Error(`Failed to sign stage output image URL: ${signErr?.message ?? "unknown error"}`);
  }

  return {
    imageUrl: signed.signedUrl,
    storageBucket,
    storagePath,
  };
}

function resolveOutputDimensions(result: StageRunCompositorResult): { width: number | null; height: number | null } {
  const output = isRecord(result.output) ? result.output : null;
  const width =
    parseOptionalPositiveInt(result.widthPx) ??
    parseOptionalPositiveInt(result.width) ??
    parseOptionalPositiveInt(output?.widthPx) ??
    parseOptionalPositiveInt(output?.width);
  const height =
    parseOptionalPositiveInt(result.heightPx) ??
    parseOptionalPositiveInt(result.height) ??
    parseOptionalPositiveInt(output?.heightPx) ??
    parseOptionalPositiveInt(output?.height);
  return { width, height };
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

    const payloadForCompositor = { ...body };
    delete payloadForCompositor.vibodeRoomId;
    delete payloadForCompositor.stageNumber;

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

    const result = (await callCompositorVibodeStageRun({
      payload: {
        ...payloadForCompositor,
        modelVersion,
      },
    })) as StageRunCompositorResult;
    let responseResult: StageRunCompositorResult = result;

    const resultImageUrl = safeStr(result.imageUrl);
    if (resultImageUrl && isDataUrl(resultImageUrl)) {
      const adminClient = getAdminSupabaseClient();
      if (!adminClient) {
        console.warn("[vibode/stage-run] output storage skipped: missing service role key");
      } else {
        try {
          const hintedStorage = resolveOutputStorage(result);
          const persistedOutput = await persistStageRunDataUrlToStorage({
            admin: adminClient,
            dataUrl: resultImageUrl,
            vibodeRoomId,
            stageNumber: requestedStageNumber,
            storageBucketHint: hintedStorage.storageBucket,
            storagePathHint: hintedStorage.storagePath,
          });
          responseResult = {
            ...result,
            imageUrl: persistedOutput.imageUrl,
            storageBucket: persistedOutput.storageBucket,
            storagePath: persistedOutput.storagePath,
          };
        } catch (storageErr) {
          console.warn(
            "[vibode/stage-run] output storage failed; returning base64 fallback",
            getErrorMessage(storageErr)
          );
        }
      }
    }

    if (!stageRunContext) {
      throw new Error("[vibode/stage-run] missing token preflight context");
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
    const { storageBucket, storagePath } = resolveOutputStorage(responseResult);
    const durableImageUrl = getDurableImageUrl({
      candidateUrl: safeStr(responseResult.imageUrl),
      storageBucket,
    });
    const { width, height } = resolveOutputDimensions(responseResult);
    const previousActiveAssetId = room.active_asset_id ?? null;
    const nowIso = new Date().toISOString();
    let tokensCharged = 0;
    let remainingTokens: number | null = stageRunContext.walletBalanceBefore;

    try {
      const { supabase: persistenceClient, token } = getUserSupabaseClient(req);
      if (!token || !persistenceClient) {
        throw new Error("[vibode/stage-run] persistence failed: missing bearer token");
      }

      const outputAsset = await createVibodeRoomAsset(persistenceClient, {
        room_id: room.id,
        user_id: userId,
        asset_type: "stage_output",
        stage_number: resolvedStageNumber,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        image_url: durableImageUrl ?? "",
        model_version: modelVersion,
        width,
        height,
        is_active: true,
      });

      try {
        const adminSupabase = getAdminSupabaseClient();
        if (adminSupabase) {
          const thumbnailLocation = await createVibodeAssetThumbnail({
            adminSupabase,
            roomId: room.id,
            assetId: outputAsset.id,
            sourceStorageBucket: storageBucket,
            sourceStoragePath: storagePath,
            sourceImageUrl: durableImageUrl ?? safeStr(responseResult.imageUrl),
          });
          if (thumbnailLocation) {
            await updateVibodeRoomAsset(persistenceClient, outputAsset.id, thumbnailLocation);
          }
        }
      } catch (thumbnailErr) {
        console.warn("[vibode/stage-run] thumbnail generation failed (non-blocking):", thumbnailErr);
      }

      const { error: deactivateErr } = await persistenceClient
        .from("vibode_room_assets")
        .update({ is_active: false })
        .eq("room_id", room.id)
        .eq("user_id", userId)
        .eq("is_active", true)
        .neq("id", outputAsset.id);
      if (deactivateErr) {
        throw new Error(`[vibode] failed to deactivate prior room assets: ${deactivateErr.message}`);
      }

      await updateVibodeRoom(persistenceClient, room.id, {
        active_asset_id: outputAsset.id,
        current_stage: resolvedStageNumber,
        cover_image_url: durableImageUrl,
        sort_key: nowIso,
      });

      const generationRun = await createVibodeGenerationRun(persistenceClient, {
        room_id: room.id,
        user_id: userId,
        run_type: "stage",
        stage_number: resolvedStageNumber,
        source_asset_id: previousActiveAssetId,
        output_asset_id: outputAsset.id,
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
          supabase: persistenceClient,
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
