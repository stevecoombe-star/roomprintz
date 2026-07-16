// app/api/stage-room/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callCompositorEngine } from "@/lib/callCompositorEngine";
import { convertHeicBufferToJpeg, HeicConversionError } from "@/lib/heicServerConversion";
import {
  buildVibodeCompositorContextHeaders,
  resolveVibodeOperationIdFromHeaders,
  resolveVibodeRequestIdFromHeaders,
} from "@/lib/vibodeCompositorContextHeaders";
import {
  isHeicLikeFile,
  isLivePhotoMovCompanion,
  isSupportedStillImageFile,
} from "@/lib/uploadImageFileTypes";
import {
  chargeVibodeTokensForOperation,
  canAffordTokens,
  getTokenCostForOperation,
  getUserTokenWallet,
  recordTokenChargeFailure,
} from "@/lib/vibodeTokenDomain";
import type { TokenActionKey } from "@/lib/vibodeTokenConstants";
import { TOKEN_DEFAULT_COSTS } from "@/lib/vibodeTokenConstants";

// Ensure we run on the Node.js runtime (needed for Buffer, larger payloads, etc.)
export const runtime = "nodejs";

type ModelVersion = "gemini-3" | "gemini-2.5";
type AspectRatio = "auto" | "4:3" | "3:2" | "16:9" | "1:1";
type AnySupabaseClient = SupabaseClient;

const ALLOWED_ASPECT_RATIOS: Set<string> = new Set([
  "auto",
  "4:3",
  "3:2",
  "16:9",
  "1:1",
]);

function mustEnv(...names: string[]) {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.length > 0) return v;
  }
  throw new Error(`Missing env var (tried: ${names.join(", ")})`);
}

const SUPABASE_URL = mustEnv("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_ANON_KEY = mustEnv(
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY"
);
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

/**
 * Creates a user-scoped Supabase client using the Authorization Bearer token.
 * This is required so RPCs run as the actual user (auth.uid()).
 */
function getUserSupabaseClient(
  req: NextRequest
): { supabase: AnySupabaseClient | null; token: string | null } {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : null;

  if (!token) return { supabase: null, token: null };

  const supabase: AnySupabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return { supabase, token };
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status });
}

function getAdminSupabaseClient(): AnySupabaseClient | null {
  if (!SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
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
  try {
    const { supabase, token } = getUserSupabaseClient(req);

    if (!token || !supabase) {
      return json(401, {
        error:
          "Unauthorized: missing Authorization Bearer token. (Send Supabase access_token in the request.)",
      });
    }

    // Verify user
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return json(401, { error: "Unauthorized" });
    }
    const user = userData.user;
    const requestId = resolveVibodeRequestIdFromHeaders(req.headers);
    const operationId = resolveVibodeOperationIdFromHeaders(req.headers);
    const adminSupabase = getAdminSupabaseClient();
    if (!adminSupabase) {
      return json(500, {
        error: "Server configuration missing service role Supabase for token charging.",
      });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return json(400, {
        error: "Missing or invalid file in form-data (expected 'file').",
      });
    }

    const fileName =
      typeof (file as File).name === "string" && (file as File).name.trim().length > 0
        ? (file as File).name.trim()
        : "upload";
    const fileType = typeof file.type === "string" ? file.type : "";

    if (isLivePhotoMovCompanion({ name: fileName, type: fileType })) {
      return json(400, {
        error: "Live Photo video detected. Vibode needs the still image, not the video clip.",
      });
    }
    if (!isSupportedStillImageFile({ name: fileName, type: fileType })) {
      return json(400, {
        error: "Unsupported image format. Please upload JPG, PNG, WebP, or HEIC/HEIF still images.",
      });
    }

    // ✅ REQUIRED for idempotent token spend
    const jobIdRaw = formData.get("jobId");
    const jobId =
      typeof jobIdRaw === "string" && jobIdRaw.trim().length > 0
        ? jobIdRaw.trim()
        : null;

    if (!jobId) {
      return json(400, {
        error: "Missing jobId in form-data (required for token spend idempotency).",
      });
    }

    const styleIdRaw = formData.get("styleId");
    const styleId =
      typeof styleIdRaw === "string" && styleIdRaw.trim().length > 0
        ? styleIdRaw
        : null;

    const enhancePhoto =
      (formData.get("enhancePhoto") as string | null) === "true";
    const cleanupRoom =
      (formData.get("cleanupRoom") as string | null) === "true";
    const repairDamage =
      (formData.get("repairDamage") as string | null) === "true";
    const emptyRoom = (formData.get("emptyRoom") as string | null) === "true";
    const renovateRoom =
      (formData.get("renovateRoom") as string | null) === "true";
    const repaintWalls =
      (formData.get("repaintWalls") as string | null) === "true";

    const flooringPresetRaw =
      ((formData.get("flooringPreset") as string | null) || "").trim();
    const flooringPreset =
      flooringPresetRaw === "" || flooringPresetRaw === "none"
        ? null
        : flooringPresetRaw;

    const roomTypeRaw = formData.get("roomType");
    const roomType =
      typeof roomTypeRaw === "string" && roomTypeRaw.trim().length > 0
        ? roomTypeRaw.trim()
        : null;

    const modelVersionRaw = formData.get("modelVersion");
    const normalizedModelVersion: ModelVersion =
      typeof modelVersionRaw === "string" &&
      (modelVersionRaw === "gemini-3" || modelVersionRaw === "gemini-2.5")
        ? (modelVersionRaw as ModelVersion)
        : "gemini-3";

    const aspectRatioRaw = formData.get("aspectRatio");
    const parsedAspectRatio =
      typeof aspectRatioRaw === "string" ? aspectRatioRaw.trim() : "";

    let normalizedAspectRatio: AspectRatio = "auto";
    if (parsedAspectRatio && ALLOWED_ASPECT_RATIOS.has(parsedAspectRatio)) {
      normalizedAspectRatio = parsedAspectRatio as AspectRatio;
    }

    const isContinuationRaw = formData.get("isContinuation");
    const isContinuation =
      typeof isContinuationRaw === "string" && isContinuationRaw === "true";

    // legacy: intentionally ignored
    const sameInputSessionRaw = formData.get("sameInputSession");
    const _sameInputSession =
      typeof sameInputSessionRaw === "string" && sameInputSessionRaw === "true";
    void _sameInputSession;

    const propertyIdRaw = formData.get("propertyId");
    const propertyId =
      typeof propertyIdRaw === "string" && propertyIdRaw.trim().length > 0
        ? propertyIdRaw.trim()
        : null;

    if (!propertyId) {
      return json(400, {
        error: "Missing propertyId in form-data (required for room assignment).",
      });
    }

    const roomNameRaw = formData.get("roomName");
    const roomName =
      typeof roomNameRaw === "string" && roomNameRaw.trim().length > 0
        ? roomNameRaw.trim()
        : "Untitled room";

    if (
      !styleId &&
      !enhancePhoto &&
      !cleanupRoom &&
      !repairDamage &&
      !emptyRoom &&
      !renovateRoom &&
      !repaintWalls &&
      !flooringPreset
    ) {
      return json(400, {
        error:
          "No styleId and no photo tools selected. Nothing to do for stage-room.",
      });
    }

    /**
     * ✅ Room = storage folder
     * We DO NOT block when a room name already exists.
     * Fresh uploads and continuations are both allowed to target any existing room label.
     */

    const actionType: TokenActionKey = "STAGE_1";
    const operationKey = "SETUP_PREPARE_ROOM";
    const tokenCost = await getTokenCostForOperation(
      supabase,
      operationKey,
      TOKEN_DEFAULT_COSTS[actionType]
    );
    const walletBeforeSpend = await getUserTokenWallet(adminSupabase, user.id);
    const affordability = canAffordTokens({
      balanceTokens: walletBeforeSpend.balance_tokens,
      requiredTokens: tokenCost,
    });

    if (!affordability.allowed) {
      return json(402, {
        error: "Insufficient tokens",
        required: tokenCost,
        tokenBalance: affordability.balanceTokens,
      });
    }

    const arrayBuffer = await file.arrayBuffer();
    let bytes = Buffer.from(arrayBuffer);
    if (isHeicLikeFile({ name: fileName, type: fileType })) {
      try {
        const converted = await convertHeicBufferToJpeg({ inputBuffer: bytes });
        bytes = Buffer.from(converted.outputBuffer);
      } catch (error) {
        const conversionCode = error instanceof HeicConversionError ? error.code : "UNKNOWN";
        const conversionCause =
          error instanceof HeicConversionError
            ? error.causeMessage
            : error instanceof Error
            ? error.message
            : String(error);
        console.error("[stage-room] heic conversion failed", {
          fileName,
          fileType,
          conversionCode,
          conversionCause,
        });
        return json(422, {
          error:
            "This iPhone photo format could not be converted. Please try exporting it as JPEG and upload again.",
        });
      }
    }

    const result = await callCompositorEngine({
      imageBytes: bytes,
      styleId,
      enhancePhoto,
      cleanupRoom,
      repairDamage,
      emptyRoom,
      renovateRoom,
      repaintWalls,
      flooringPreset,
      roomType,
      modelVersion: normalizedModelVersion,
      aspectRatio: normalizedAspectRatio,
      isContinuation,
      headers: buildVibodeCompositorContextHeaders({
        requestId,
        operationId,
        userId: user.id,
        userEmail: user.email ?? null,
        workflowType: "stage",
        actionType: "stage-room",
        sourceTrigger: "update-room",
      }),
    });

    const imageUrl = result?.imageUrl ?? null;
    const originalImageUrl = result?.originalImageUrl ?? null;

    if (!imageUrl) {
      return json(500, { error: "Compositor did not return an imageUrl." });
    }

    let tokensCharged = 0;
    let tokenBalanceAfterCharge = walletBeforeSpend.balance_tokens;
    try {
      const chargeResult = await chargeVibodeTokensForOperation({
        supabase: adminSupabase,
        userId: user.id,
        operationKey,
        idempotencyKey: buildOperationIdempotencyKey({
          userId: user.id,
          operationKey,
          routeKey: "/api/stage-room",
          operationId,
          requestId,
          fallbackId: jobId,
        }),
        operationId,
        requestId,
        modelVersion: normalizedModelVersion,
        chargePhase: "success",
        metadata: {
          source: "api_stage_room",
          jobId,
          reason: `room_generation:${normalizedModelVersion}`,
          propertyId,
          roomName,
          legacyActionKey: actionType,
        },
      });
      tokensCharged = chargeResult.skipped ? 0 : chargeResult.chargedTokens;
      tokenBalanceAfterCharge = chargeResult.balanceTokens ?? tokenBalanceAfterCharge;
    } catch (chargeErr) {
      console.error("[stage-room] token charge failed after successful generation:", chargeErr);
      await recordTokenChargeFailure({
        supabase: adminSupabase,
        userId: user.id,
        operationKey,
        operationId,
        requestId,
        idempotencyKey: buildOperationIdempotencyKey({
          userId: user.id,
          operationKey,
          routeKey: "/api/stage-room",
          operationId,
          requestId,
          fallbackId: jobId,
        }),
        route: "/api/stage-room",
        chargePhase: "success",
        expectedTokens: tokenCost,
        modelVersion: normalizedModelVersion,
        errorMessage: chargeErr instanceof Error ? chargeErr.message : String(chargeErr),
        metadata: {
          source: "api_stage_room",
          jobId,
          propertyId,
          roomName,
          legacyActionKey: actionType,
        },
      });
    }

    return json(200, {
      imageUrl,
      originalImageUrl,
      tokenCost: tokensCharged,
      tokenBalance: tokenBalanceAfterCharge,
      propertyId,
      roomName,
      actionKey: actionType,
      operationKey,
    });
  } catch (err: unknown) {
    console.error("[stage-room] unexpected error:", err);
    const message =
      err instanceof Error ? err.message : "Unexpected error in /api/stage-room";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
