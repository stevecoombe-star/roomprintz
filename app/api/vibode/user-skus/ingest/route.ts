import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectSourceType,
  extractDomain,
  parseDimensions,
  parsePrice,
} from "@/lib/attribution/parsers";
import { normalizeSupplier } from "@/lib/attribution/normalizers";
import { upsertVibodeUserFurniture } from "@/lib/vibodeMyFurniture";
import {
  buildVibodeCompositorContextHeaders,
  resolveVibodeOperationIdFromHeaders,
  resolveVibodeRequestIdFromHeaders,
} from "@/lib/vibodeCompositorContextHeaders";
import { convertHeicBufferToJpeg, HeicConversionError } from "@/lib/heicServerConversion";
import {
  isHeicLikeExtension,
  isHeicLikeMimeType,
  isLivePhotoMovCompanion,
} from "@/lib/uploadImageFileTypes";
import {
  canAffordTokens,
  chargeVibodeTokensForOperation,
  getTokenCostForOperation,
  getUserTokenWallet,
  recordTokenChargeFailure,
} from "@/lib/vibodeTokenDomain";

export const runtime = "nodejs";

type IngestBody = {
  imageUrl?: string;
  imageBase64?: string;
  imageFilename?: string;
  label?: string;
};

type AnySupabaseClient = SupabaseClient;

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";
const INGEST_SOURCE_HEADER = "x-roomprintz-ingest-source";
const INGEST_SKIP_MY_FURNITURE_AUTOSAVE_HEADER = "x-roomprintz-skip-my-furniture-autosave";
const INGEST_IMAGE_MODEL_HEADER = "x-roomprintz-ingest-image-model";
const NORMALIZED_PREVIEW_BG_RGB = [237, 237, 237] as const;
const NORMALIZED_PREVIEW_BG_HEADER = "x-roomprintz-normalized-preview-bg-rgb";
const NORMALIZED_PREVIEW_BG_MODE_HEADER = "x-roomprintz-normalized-preview-bg-mode";
const INGEST_ROUTE = "/api/vibode/user-skus/ingest";
const DEFAULT_VIBODE_INGEST_IMAGE_MODEL = "gemini-3.1-flash-image-preview";

function safeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const parsed = safeString(value);
    if (parsed) return parsed;
  }
  return null;
}

function firstVariantImageUrl(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null;
  for (const variant of raw) {
    if (typeof variant === "string") {
      const imageUrl = safeString(variant);
      if (imageUrl) return imageUrl;
      continue;
    }
    if (!isRecord(variant)) continue;
    const imageUrl = firstString(variant.imageUrl, variant.url, variant.src, variant.pngUrl);
    if (imageUrl) return imageUrl;
  }
  return null;
}

function extractAutosaveCandidate(raw: unknown): {
  userSkuId: string;
  status: string | null;
  displayName: string | null;
  previewImageUrl: string | null;
  sourceUrl: string | null;
  category: string | null;
  priceText: string | null;
  dimensionsText: string | null;
} | null {
  if (!isRecord(raw)) return null;
  const userSkuId = firstString(raw.user_sku_id, raw.userSkuId, raw.id, raw.skuId);
  if (!userSkuId) return null;

  return {
    userSkuId,
    status: safeString(raw.status)?.toLowerCase() ?? null,
    displayName: firstString(raw.display_name, raw.displayName, raw.label, raw.name),
    previewImageUrl: firstString(
      raw.preview_image_url,
      raw.previewImageUrl,
      raw.normalized_preview_url,
      raw.normalizedPreviewUrl,
      firstVariantImageUrl(raw.variants)
    ),
    sourceUrl: firstString(raw.source_url, raw.sourceUrl, raw.productUrl, raw.url),
    category: firstString(raw.category, raw.item_type, raw.itemType, raw.type),
    priceText: firstString(raw.price_text, raw.priceText, raw.price, raw.amountText),
    dimensionsText: firstString(raw.dimensions_text, raw.dimensionsText, raw.dimensions, raw.sizeText),
  };
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

async function getCookieAccessToken(): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const cookieStore = await cookies();
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // No-op in this route; auth refresh writes are not required here.
      },
    },
  });
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return safeString(data.session?.access_token) ?? null;
}

function getUserSupabaseClient(token: string): AnySupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as AnySupabaseClient;
}

function getAdminSupabaseClient(): AnySupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) as AnySupabaseClient;
}

function resolveMimeType(body: IngestBody): string | null {
  const imageBase64 = safeString(body.imageBase64);
  if (!imageBase64) return null;
  const dataUrlMatch = imageBase64.match(/^data:([^;,]*);base64,/i);
  const mimeType = dataUrlMatch?.[1]?.toLowerCase() ?? "";
  return mimeType.length > 0 ? mimeType : null;
}

function resolveFilename(body: IngestBody): string | null {
  const explicitName = safeString(body.imageFilename);
  if (explicitName) return explicitName;
  const imageUrl = safeString(body.imageUrl);
  if (!imageUrl) return null;
  try {
    const parsed = new URL(imageUrl);
    const basename = parsed.pathname.split("/").filter(Boolean).pop();
    return basename ? decodeURIComponent(basename) : null;
  } catch {
    return null;
  }
}

function resolveBase64Payload(body: IngestBody): string | null {
  const imageBase64 = safeString(body.imageBase64);
  if (!imageBase64) return null;
  const dataPrefixMatch = imageBase64.match(/^data:[^;]*;base64,/i);
  if (dataPrefixMatch?.[0]) {
    return imageBase64.slice(dataPrefixMatch[0].length).replace(/\s+/g, "");
  }
  return imageBase64.replace(/\s+/g, "");
}

function toDataUrl(mimeType: string, base64Payload: string): string {
  return `data:${mimeType};base64,${base64Payload}`;
}

function logIngestEvent(
  level: "info" | "warn" | "error",
  event: string,
  requestId: string,
  fields: Record<string, unknown> = {}
): void {
  const payload: Record<string, unknown> = {
    event,
    request_id: requestId,
    route: INGEST_ROUTE,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) payload[key] = value;
  }
  const message = `[vibode/user-skus/ingest] ${JSON.stringify(payload)}`;
  if (level === "warn") {
    console.warn(message);
    return;
  }
  if (level === "error") {
    console.error(message);
    return;
  }
  console.info(message);
}

function resolveIngestSourceType(req: NextRequest, body: IngestBody): string {
  const sourceFromHeader = safeString(req.headers.get(INGEST_SOURCE_HEADER));
  if (sourceFromHeader) return sourceFromHeader.toLowerCase();
  if (safeString(body.imageBase64)) return "upload";
  if (safeString(body.imageUrl)) return "product_url";
  return "unknown";
}

function resolveIngestOperationKey(sourceKind: string): string {
  return sourceKind === "product_url" ? "INGEST_PRODUCT_URL" : "INGEST_IMAGE";
}

function resolveIngestOperationFallbackCost(sourceKind: string): number {
  return sourceKind === "product_url" ? 1 : 1;
}

function buildOperationIdempotencyKey(args: {
  userId: string;
  operationKey: string;
  routeKey: string;
  chargeAnchor: string;
}) {
  return [args.userId, args.operationKey, args.routeKey, args.chargeAnchor].join(":");
}

function shouldSkipMyFurnitureAutosave(req: NextRequest): boolean {
  const flag = safeString(req.headers.get(INGEST_SKIP_MY_FURNITURE_AUTOSAVE_HEADER));
  if (!flag) return false;
  return flag === "1" || flag.toLowerCase() === "true";
}

function resolveVibodeIngestImageModel(): string {
  const envModel = safeString(process.env.VIBODE_INGEST_IMAGE_MODEL)?.trim();
  return envModel && envModel.length > 0 ? envModel : DEFAULT_VIBODE_INGEST_IMAGE_MODEL;
}

export async function POST(req: NextRequest) {
  const requestId = resolveVibodeRequestIdFromHeaders(req.headers);
  const operationId = resolveVibodeOperationIdFromHeaders(req.headers);
  const startedAtMs = Date.now();
  const accessToken = getBearerToken(req) ?? (await getCookieAccessToken());
  let authenticatedUserId: string | null = null;
  let authenticatedUserEmail: string | null = null;

  if (accessToken) {
    const contextSupabase = getUserSupabaseClient(accessToken);
    if (contextSupabase) {
      try {
        const { data: userData, error: userErr } = await contextSupabase.auth.getUser();
        if (!userErr && userData?.user) {
          authenticatedUserId = safeString(userData.user.id);
          authenticatedUserEmail = safeString(userData.user.email);
        }
      } catch {
        // Best-effort context resolution only; ingest flow should proceed without this metadata.
      }
    }
  }

  logIngestEvent("info", "request_received", requestId, {
    user_id_present: Boolean(authenticatedUserId),
  });

  try {
    const body = (await req.json()) as IngestBody;
    const sourceKind = resolveIngestSourceType(req, body);
    const operationKey = resolveIngestOperationKey(sourceKind);
    const operationFallbackCost = resolveIngestOperationFallbackCost(sourceKind);
    const skipMyFurnitureAutosave = shouldSkipMyFurnitureAutosave(req);
    const mimeType = resolveMimeType(body);
    const filename = resolveFilename(body);
    const label = safeString(body.label);
    const hasImageUrl = Boolean(safeString(body.imageUrl));
    const hasImageData = Boolean(safeString(body.imageBase64));
    const ingestImageModel = resolveVibodeIngestImageModel();

    logIngestEvent("info", "input_resolved", requestId, {
      user_id_present: Boolean(authenticatedUserId),
      source_kind: sourceKind,
      mime_type: mimeType,
      filename,
      label,
      has_image_url: hasImageUrl,
      has_image_data: hasImageData,
      skip_my_furniture_autosave: skipMyFurnitureAutosave,
      ingest_image_model: ingestImageModel,
    });
    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userSupabase = getUserSupabaseClient(accessToken);
    if (!userSupabase) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const adminSupabase = getAdminSupabaseClient();
    if (!adminSupabase) {
      return NextResponse.json(
        { error: "Server misconfigured: missing service role Supabase for token charging." },
        { status: 500 }
      );
    }
    let resolvedUserId = authenticatedUserId;
    if (!resolvedUserId) {
      const { data: verifiedUserData, error: verifiedUserErr } = await userSupabase.auth.getUser();
      if (verifiedUserErr || !verifiedUserData?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      resolvedUserId = verifiedUserData.user.id;
    }
    if (!resolvedUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const tokenCost = await getTokenCostForOperation(userSupabase, operationKey, operationFallbackCost);
    const wallet = await getUserTokenWallet(adminSupabase, resolvedUserId);
    const affordability = canAffordTokens({
      balanceTokens: wallet.balance_tokens,
      requiredTokens: tokenCost,
    });
    if (!affordability.allowed) {
      return NextResponse.json(
        {
          errorCode: "INSUFFICIENT_TOKENS",
          message: "Insufficient token balance for ingest.",
          requiredTokens: affordability.requiredTokens,
          balanceTokens: affordability.balanceTokens,
          shortfallTokens: affordability.shortfallTokens,
          operationKey,
        },
        { status: 402 }
      );
    }

    if (isLivePhotoMovCompanion({ name: filename, type: mimeType })) {
      return NextResponse.json(
        {
          error: "Live Photo video detected. Vibode needs the still image, not the video clip.",
        },
        { status: 400 }
      );
    }

    let normalizedImageBase64 = safeString(body.imageBase64);
    if (normalizedImageBase64 && (isHeicLikeMimeType(mimeType) || isHeicLikeExtension(filename))) {
      const encodedPayload = resolveBase64Payload(body);
      if (!encodedPayload) {
        logIngestEvent("warn", "heic_payload_parse_failed", requestId, {
          source_kind: sourceKind,
          mime_type: mimeType,
          filename,
        });
        return NextResponse.json(
          {
            error:
              "This iPhone photo format could not be converted. Please try exporting it as JPEG and upload again.",
          },
          { status: 422 }
        );
      }

      try {
        const converted = await convertHeicBufferToJpeg({
          inputBuffer: Buffer.from(encodedPayload, "base64"),
        });
        normalizedImageBase64 = toDataUrl(
          "image/jpeg",
          Buffer.from(converted.outputBuffer).toString("base64")
        );
      } catch (error) {
        const conversionCode = error instanceof HeicConversionError ? error.code : "UNKNOWN";
        const conversionCause =
          error instanceof HeicConversionError
            ? error.causeMessage
            : error instanceof Error
            ? error.message
            : String(error);
        logIngestEvent("error", "heic_conversion_failed", requestId, {
          source_kind: sourceKind,
          mime_type: mimeType,
          filename,
          conversion_code: conversionCode,
          conversion_cause: conversionCause,
        });
        return NextResponse.json(
          {
            error:
              "This iPhone photo format could not be converted. Please try exporting it as JPEG and upload again.",
          },
          { status: 422 }
        );
      }
    }

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
    const upstream = `${endpointBaseNormalized}/api/vibode/user-skus/ingest`;

    logIngestEvent("info", "forwarding_request_to_compositor", requestId, {
      source_kind: sourceKind,
      mime_type: mimeType,
      filename,
      label,
      has_image_url: hasImageUrl,
      has_image_data: hasImageData,
      skip_my_furniture_autosave: skipMyFurnitureAutosave,
      ingest_image_model: ingestImageModel,
    });

    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
        [NORMALIZED_PREVIEW_BG_HEADER]: NORMALIZED_PREVIEW_BG_RGB.join(","),
        [NORMALIZED_PREVIEW_BG_MODE_HEADER]: "fixed",
        [INGEST_IMAGE_MODEL_HEADER]: ingestImageModel,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...buildVibodeCompositorContextHeaders({
          requestId,
          operationId,
          userId: authenticatedUserId,
          userEmail: authenticatedUserEmail,
          workflowType: "set",
          actionType: "user-sku-ingest",
          sourceTrigger: "user-sku-upload",
        }),
      },
      body: JSON.stringify({
        imageUrl: body.imageUrl,
        imageBase64: normalizedImageBase64,
        label: body.label,
        model: ingestImageModel,
        normalization: {
          // Explicitly request a fixed neutral canvas for normalized previews.
          previewBackgroundMode: "fixed",
          previewBackgroundRgb: [...NORMALIZED_PREVIEW_BG_RGB],
          disableSampledBackground: true,
          disableDominantBackground: true,
        },
      }),
    });

    logIngestEvent("info", "compositor_response_received", requestId, {
      compositor_status: upstreamRes.status,
    });

    const raw = await upstreamRes.text();
    let parsed: unknown = null;

    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!upstreamRes.ok) {
      logIngestEvent("warn", "failed", requestId, {
        compositor_status: upstreamRes.status,
        duration_ms: Date.now() - startedAtMs,
        error: "upstream_non_ok",
      });
      return NextResponse.json(
        {
          error: "Failed to ingest user SKU.",
          detail: parsed ?? raw ?? "Unknown upstream error",
        },
        { status: upstreamRes.status }
      );
    }

    let savedFurniture: Record<string, unknown> | null =
      isRecord(parsed) && isRecord(parsed.savedFurniture) ? (parsed.savedFurniture as Record<string, unknown>) : null;
    let preparedUserSku: ReturnType<typeof extractAutosaveCandidate> | null = null;
    let tokensCharged = 0;
    let remainingTokens: number | null = wallet.balance_tokens;
    const parsedUserSkuCandidate =
      isRecord(parsed) && isRecord(parsed.userSku) ? extractAutosaveCandidate(parsed.userSku) : null;
    const isUsableUserSku =
      Boolean(parsedUserSkuCandidate?.userSkuId) &&
      (parsedUserSkuCandidate?.status?.trim().toLowerCase() ?? null) === "ready";
    if (isUsableUserSku && parsedUserSkuCandidate) {
      try {
        const chargeAnchor =
          operationId ??
          requestId ??
          parsedUserSkuCandidate.userSkuId ??
          safeString(body.imageUrl) ??
          "ingest-success";
        const chargeResult = await chargeVibodeTokensForOperation({
          supabase: adminSupabase,
          userId: resolvedUserId,
          operationKey,
          idempotencyKey: buildOperationIdempotencyKey({
            userId: resolvedUserId,
            operationKey,
            routeKey: INGEST_ROUTE,
            chargeAnchor,
          }),
          operationId,
          requestId,
          modelVersion: ingestImageModel,
          chargePhase: "success",
          metadata: {
            sourceKind,
            userSkuId: parsedUserSkuCandidate.userSkuId,
          },
        });
        tokensCharged = chargeResult.skipped ? 0 : chargeResult.chargedTokens;
        remainingTokens = chargeResult.balanceTokens ?? remainingTokens;
      } catch (chargeErr) {
        logIngestEvent("error", "token_charge_failed", requestId, {
          operation_key: operationKey,
          error: chargeErr instanceof Error ? chargeErr.message : String(chargeErr),
        });
        await recordTokenChargeFailure({
          supabase: adminSupabase,
          userId: resolvedUserId,
          operationKey,
          operationId,
          requestId,
          idempotencyKey: buildOperationIdempotencyKey({
            userId: resolvedUserId,
            operationKey,
            routeKey: INGEST_ROUTE,
            chargeAnchor:
              operationId ??
              requestId ??
              parsedUserSkuCandidate.userSkuId ??
              safeString(body.imageUrl) ??
              "ingest-success",
          }),
          route: INGEST_ROUTE,
          chargePhase: "success",
          expectedTokens: tokenCost,
          modelVersion: ingestImageModel,
          errorMessage: chargeErr instanceof Error ? chargeErr.message : String(chargeErr),
          metadata: {
            sourceKind,
            userSkuId: parsedUserSkuCandidate.userSkuId,
          },
        });
      }
    }

    let preparedUserSkuPresent = false;
    let eligibleSkuPresent = false;

    if (accessToken && !skipMyFurnitureAutosave) {
      const userSupabase = getUserSupabaseClient(accessToken);
      if (userSupabase && isRecord(parsed)) {
        const userSkuRaw = parsed.userSku;
        preparedUserSku = extractAutosaveCandidate(userSkuRaw);
        preparedUserSkuPresent = Boolean(preparedUserSku);
        const userSkuStatus =
          preparedUserSku?.status?.trim().toLowerCase() ??
          safeString((isRecord(userSkuRaw) ? userSkuRaw.status : null))?.toLowerCase() ??
          null;
        eligibleSkuPresent = Boolean(preparedUserSku && userSkuStatus === "ready");
        if (preparedUserSku && userSkuStatus === "ready") {
          try {
            const { data: userData, error: userErr } = await userSupabase.auth.getUser();
            if (!userErr && userData?.user?.id) {
              const parsedDisplayName = preparedUserSku.displayName ?? label;
              const parsedSourceUrl = preparedUserSku.sourceUrl ?? safeString(body.imageUrl);
              const parsedSourceDomain = extractDomain(parsedSourceUrl);
              const parsedSupplierName = normalizeSupplier(parsedSourceDomain);
              const parsedPrice = parsePrice(preparedUserSku.priceText);
              const parsedDimensions = parseDimensions(preparedUserSku.dimensionsText);

              const saved = await upsertVibodeUserFurniture(userSupabase, {
                userId: userData.user.id,
                userSkuId: preparedUserSku.userSkuId,
                sourceType: sourceKind === "upload" ? "uploaded_image" : "pasted_image",
                displayName: parsedDisplayName,
                previewImageUrl: preparedUserSku.previewImageUrl,
                sourceUrl: parsedSourceUrl,
                category: preparedUserSku.category,
                parsedDisplayName,
                parsedSourceUrl,
                parsedSourceDomain,
                parsedSupplierName,
                parsedPriceText: preparedUserSku.priceText,
                parsedPriceAmount: parsedPrice.amount,
                parsedPriceCurrency: parsedPrice.currency,
                parsedDimensionsText: preparedUserSku.dimensionsText,
                parsedWidthValue: parsedDimensions.width,
                parsedDepthValue: parsedDimensions.depth,
                parsedHeightValue: parsedDimensions.height,
                parsedDimensionUnit: parsedDimensions.unit,
                parsedCategory: preparedUserSku.category,
                priceSourceType: detectSourceType(parsedSourceDomain),
                priceConfidence: parsedPrice.confidence,
              });
              savedFurniture = {
                id: saved.id,
                userSkuId: saved.user_sku_id,
                displayName: saved.display_name,
                previewImageUrl: saved.preview_image_url,
                sourceUrl: saved.source_url,
                category: saved.category,
                parsedSupplierName: saved.parsed_supplier_name,
                parsedPriceText: saved.parsed_price_text,
                parsedPriceAmount: saved.parsed_price_amount,
                parsedPriceCurrency: saved.parsed_price_currency,
                timesUsed: saved.times_used,
                lastUsedAt: saved.last_used_at,
              };
              logIngestEvent("info", "saved_to_my_furniture", requestId, {
                prepared_user_sku_present: preparedUserSkuPresent,
                eligible_sku_present: eligibleSkuPresent,
                saved_furniture_id: savedFurniture.id,
              });
            }
          } catch (saveErr) {
            logIngestEvent("warn", "my_furniture_save_failed", requestId, {
              prepared_user_sku_present: preparedUserSkuPresent,
              eligible_sku_present: eligibleSkuPresent,
              error: saveErr instanceof Error ? saveErr.message : String(saveErr),
            });
          }
        }
      }
    }

    logIngestEvent("info", "completed", requestId, {
      compositor_status: upstreamRes.status,
      prepared_user_sku_present: preparedUserSkuPresent,
      eligible_sku_present: eligibleSkuPresent,
      saved_furniture_id: savedFurniture?.id,
      ingest_image_model: ingestImageModel,
      duration_ms: Date.now() - startedAtMs,
    });

    if (savedFurniture && isRecord(parsed)) {
      return NextResponse.json({ ...parsed, savedFurniture, tokensCharged, remainingTokens, operationKey });
    }

    if (isRecord(parsed)) {
      return NextResponse.json({ ...parsed, tokensCharged, remainingTokens, operationKey });
    }
    return NextResponse.json(parsed ?? {});
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    logIngestEvent("error", "failed", requestId, {
      duration_ms: Date.now() - startedAtMs,
      error: message,
    });
    return NextResponse.json(
      {
        error: "Failed to ingest user SKU.",
        detail: message,
      },
      { status: 500 }
    );
  }
}
