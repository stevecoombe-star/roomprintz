import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  detectSourceType,
  extractDomain,
  parseDimensions,
  parsePrice,
} from "@/lib/attribution/parsers";
import { normalizeSupplier } from "@/lib/attribution/normalizers";
import { resolveProductUrlMetadata } from "@/lib/productUrlMetadata/resolver";
import { upsertVibodeUserFurniture } from "@/lib/vibodeMyFurniture";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient;
type UnknownRecord = Record<string, unknown>;
type ProductPageMetadata = {
  title: string | null;
  previewImageUrl: string | null;
  priceRawText: string | null;
  priceNormalizedText: string | null;
  priceSource: string | null;
  fetchOk: boolean;
  blockedReason: string | null;
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const DEFAULT_PASTED_PRODUCT_NAME = "Pasted Product";
const INGEST_SOURCE_HEADER = "x-roomprintz-ingest-source";
const INGEST_SKIP_MY_FURNITURE_AUTOSAVE_HEADER = "x-roomprintz-skip-my-furniture-autosave";
const SAVE_ROUTE = "/api/vibode/my-furniture/save";
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

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "1" || trimmed === "true") return true;
    if (trimmed === "0" || trimmed === "false") return false;
  }
  return null;
}

function safeRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function asHttpUrl(value: string | null, baseUrl?: string): string | null {
  if (!value) return null;
  try {
    const parsed = baseUrl ? new URL(value, baseUrl) : new URL(value);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function asImageDataUrl(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(trimmed)) return null;
  return trimmed;
}

function toTitleCaseToken(token: string): string {
  if (!token) return token;
  if (/^\d+$/.test(token)) return token;
  return token[0].toUpperCase() + token.slice(1).toLowerCase();
}

function isSkuLikeSlugToken(token: string): boolean {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return false;
  return (
    /^[a-z]{0,3}\d{6,}$/.test(normalized) ||
    /^\d{6,}$/.test(normalized) ||
    /^[a-z]{1,3}\d{5,}[a-z0-9]*$/.test(normalized)
  );
}

function deriveDisplayNameFromProductUrl(sourceUrl: string): string | null {
  const safeSourceUrl = asHttpUrl(sourceUrl);
  if (!safeSourceUrl) return null;
  try {
    const parsed = new URL(safeSourceUrl);
    const pathSegments = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (pathSegments.length === 0) return null;
    const rawSlug = decodeURIComponent(pathSegments[pathSegments.length - 1] ?? "")
      .replace(/\.[a-z0-9]+$/i, "")
      .trim();
    if (!rawSlug) return null;
    const slugTokens = rawSlug.split(/[-_]+/).map((token) => token.trim()).filter(Boolean);
    if (slugTokens.length === 0) return null;

    while (slugTokens.length > 0 && isSkuLikeSlugToken(slugTokens[slugTokens.length - 1] ?? "")) {
      slugTokens.pop();
    }
    if (slugTokens.length === 0) return null;

    const humanized = collapseWhitespace(slugTokens.map((token) => toTitleCaseToken(token)).join(" "));
    return humanized || null;
  } catch {
    return null;
  }
}

type FallbackImageResolution = {
  imageUrl: string | null;
  source: string | null;
};

function resolveFallbackImageUrl(
  sourceUrl: string | null,
  clientPreviewImageUrl: string | null
): FallbackImageResolution {
  const clientImage = asHttpUrl(clientPreviewImageUrl);
  if (clientImage) {
    return {
      imageUrl: clientImage,
      source: "client_preview_image",
    };
  }

  const safeSourceUrl = asHttpUrl(sourceUrl);
  if (!safeSourceUrl) return { imageUrl: null, source: null };

  try {
    const parsed = new URL(safeSourceUrl);
    const queryKeys = [
      "img",
      "image",
      "image_url",
      "imageurl",
      "preview_image",
      "previewimage",
      "photo",
      "photo_url",
    ];
    for (const key of queryKeys) {
      const raw = asOptionalString(parsed.searchParams.get(key));
      const candidate = asHttpUrl(raw, safeSourceUrl);
      if (candidate) {
        return {
          imageUrl: candidate,
          source: `source_url_query_param:${key}`,
        };
      }
    }

    if (/\.(?:avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(parsed.pathname)) {
      return {
        imageUrl: safeSourceUrl,
        source: "source_url_direct_image",
      };
    }
  } catch {
    return { imageUrl: null, source: null };
  }

  return { imageUrl: null, source: null };
}

async function fetchProductPageMetadata(sourceUrl: string, requestId: string): Promise<ProductPageMetadata> {
  const resolved = await resolveProductUrlMetadata({
    sourceUrl,
    includePrice: true,
    mode: "save",
    requestId,
  });

  if (!resolved.normalizedSourceUrl) {
    logSaveEvent("warn", "product_url_metadata_invalid_url", requestId, {
      source_url: sourceUrl,
    });
    return {
      title: null,
      previewImageUrl: null,
      priceRawText: null,
      priceNormalizedText: null,
      priceSource: null,
      fetchOk: false,
      blockedReason: resolved.blockedReason,
    };
  }

  const attemptCount = resolved.diagnostics.attempts.length;
  resolved.diagnostics.attempts.forEach((attempt, index) => {
    logSaveEvent("info", "product_url_metadata_fetch_response", requestId, {
      fetch_attempt_index: index,
      fetch_attempt_count: attemptCount,
      fetch_profile: attempt.fetchProfile,
      fetch_input_url: attempt.inputUrl,
      fetch_status: attempt.status,
      fetch_ok: attempt.ok,
      fetch_content_type: attempt.contentType ?? "",
      fetch_resolved_url: attempt.resolvedUrl ?? attempt.inputUrl,
    });
  });

  if (!resolved.fetchOk) {
    if (resolved.diagnostics.attempts.some((attempt) => attempt.errorCode)) {
      logSaveEvent("warn", "product_url_metadata_fetch_exception", requestId, {
        source_url: resolved.normalizedSourceUrl ?? sourceUrl,
        blocked_reason: resolved.blockedReason,
      });
    }
    return {
      title: null,
      previewImageUrl: null,
      priceRawText: null,
      priceNormalizedText: null,
      priceSource: null,
      fetchOk: false,
      blockedReason: resolved.blockedReason,
    };
  }

  const successfulAttempt =
    resolved.diagnostics.attempts.find(
      (attempt) => attempt.ok && (attempt.contentType ?? "").toLowerCase().includes("text/html")
    ) ?? null;

  logSaveEvent("info", "product_url_metadata_price_extraction_diagnostics", requestId, {
    html_length: resolved.diagnostics.htmlLength,
    html_substantial: resolved.diagnostics.htmlSubstantial,
    fetch_profile: successfulAttempt?.fetchProfile ?? null,
    json_ld_blocks_found: resolved.diagnostics.jsonLdBlockCount > 0,
    json_ld_block_count: resolved.diagnostics.jsonLdBlockCount,
    json_ld_price_candidate_found: resolved.diagnostics.jsonLdCandidateFound,
    meta_tag_price_candidate_found: resolved.diagnostics.metaTagCandidateFound,
    script_embedded_price_candidate_found: resolved.diagnostics.scriptEmbeddedCandidateFound,
    visible_html_price_candidate_found: resolved.diagnostics.visibleHtmlCandidateFound,
    selected_price_source: resolved.diagnostics.selectedPriceSource,
    extracted_price_raw: resolved.priceRawText,
    extracted_price_normalized: resolved.priceNormalizedText,
  });

  return {
    title: resolved.title,
    previewImageUrl: resolved.previewImageUrl,
    priceRawText: resolved.priceRawText,
    priceNormalizedText: resolved.priceNormalizedText,
    priceSource: resolved.priceSource,
    fetchOk: true,
    blockedReason: null,
  };
}

type IngestedImageResult = {
  userSkuId: string | null;
  previewImageUrl: string | null;
  displayName: string | null;
};

type IngestPreviewCallResult = {
  ok: boolean;
  status: number;
  ingested: IngestedImageResult | null;
  failureDetail: Record<string, unknown> | string | null;
};

function createRequestId(): string {
  try {
    return `vibode-save-${crypto.randomUUID()}`;
  } catch {
    return `vibode-save-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function logSaveEvent(
  level: "info" | "warn" | "error",
  event: string,
  requestId: string,
  fields: Record<string, unknown> = {}
): void {
  const payload: Record<string, unknown> = {
    event,
    request_id: requestId,
    route: SAVE_ROUTE,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) payload[key] = value;
  }
  const message = `[vibode/my-furniture/save] ${JSON.stringify(payload)}`;
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

function sanitizeIngestFailureDetail(payload: unknown): Record<string, unknown> | string | null {
  if (!payload) return null;
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    return trimmed.slice(0, 600);
  }
  const record = safeRecord(payload);
  if (!record) {
    return {
      kind: typeof payload,
    };
  }
  const detailRecord = safeRecord(record.detail);
  const detail =
    typeof record.detail === "string"
      ? record.detail.slice(0, 600)
      : detailRecord
      ? {
          code: asOptionalString(detailRecord.code),
          error: asOptionalString(detailRecord.error),
          message: asOptionalString(detailRecord.message),
        }
      : null;
  return {
    code: asOptionalString(record.code),
    error: asOptionalString(record.error),
    message: asOptionalString(record.message),
    detail,
  };
}

function shouldSkipMyFurnitureAutosave(req: NextRequest): boolean {
  const flag = asOptionalString(req.headers.get(INGEST_SKIP_MY_FURNITURE_AUTOSAVE_HEADER));
  if (!flag) return false;
  return flag === "1" || flag.toLowerCase() === "true";
}

function getIngestedImageResult(payload: unknown): IngestedImageResult {
  const record = safeRecord(payload);
  if (!record) return { userSkuId: null, previewImageUrl: null, displayName: null };

  const userSku = safeRecord(record.userSku);
  const ingestedUserSkuId = asOptionalString(
    userSku?.user_sku_id ?? userSku?.userSkuId ?? userSku?.id ?? userSku?.skuId
  );
  const ingestedDisplayName = asOptionalString(
    userSku?.display_name ?? userSku?.displayName ?? userSku?.label ?? userSku?.name
  );
  const userSkuStatus = asOptionalString(userSku?.status)?.toLowerCase();
  if (userSkuStatus === "ready" && Array.isArray(userSku?.variants)) {
    for (const variant of userSku.variants) {
      const imageUrl = asHttpUrl(asOptionalString(variant));
      if (imageUrl) {
        return { userSkuId: ingestedUserSkuId, previewImageUrl: imageUrl, displayName: ingestedDisplayName };
      }
    }
  }

  const savedFurniture = safeRecord(record.savedFurniture);
  return {
    userSkuId: ingestedUserSkuId ?? asOptionalString(savedFurniture?.userSkuId),
    previewImageUrl: asHttpUrl(
    asOptionalString(savedFurniture?.previewImageUrl) ??
      asOptionalString(savedFurniture?.preview_image_url) ??
      null
    ),
    displayName:
      ingestedDisplayName ??
      asOptionalString(savedFurniture?.displayName) ??
      asOptionalString(savedFurniture?.display_name) ??
      null,
  };
}

async function ingestPreviewImageViaExistingFlow(
  req: NextRequest,
  args: {
    imageUrl?: string | null;
    imageBase64?: string | null;
    label?: string | null;
  }
): Promise<IngestPreviewCallResult> {
  const imageUrl = asHttpUrl(args.imageUrl ?? null);
  const imageBase64 = asImageDataUrl(args.imageBase64 ?? null);
  const label = asOptionalString(args.label ?? null);
  if (!imageUrl && !imageBase64) {
    return {
      ok: false,
      status: 400,
      ingested: null,
      failureDetail: null,
    };
  }
  const ingestUrl = new URL("/api/vibode/user-skus/ingest", req.url).toString();
  const authorization = asOptionalString(req.headers.get("authorization"));
  const cookieHeader = asOptionalString(req.headers.get("cookie"));
  const response = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [INGEST_SOURCE_HEADER]: "product_url",
      [INGEST_SKIP_MY_FURNITURE_AUTOSAVE_HEADER]: "1",
      ...(authorization ? { Authorization: authorization } : {}),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
    body: JSON.stringify({
      ...(imageUrl ? { imageUrl } : {}),
      ...(imageBase64 ? { imageBase64 } : {}),
      ...(label ? { label } : {}),
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  return {
    ok: response.ok,
    status: response.status,
    ingested: response.ok ? getIngestedImageResult(payload) : null,
    failureDetail: response.ok ? null : sanitizeIngestFailureDetail(payload),
  };
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  try {
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

    const body = await req.json().catch(() => null);
    const userSkuIdFromBody = asOptionalString((body as { userSkuId?: unknown } | null)?.userSkuId);
    const prepareOnlyFromBody = asOptionalBoolean((body as { prepareOnly?: unknown } | null)?.prepareOnly) ?? false;
    const skipMyFurnitureAutosave = shouldSkipMyFurnitureAutosave(req);
    const prepareOnly = skipMyFurnitureAutosave || prepareOnlyFromBody;

    const displayName = asOptionalString((body as { displayName?: unknown } | null)?.displayName);
    const previewImageUrl = asOptionalString((body as { previewImageUrl?: unknown } | null)?.previewImageUrl);
    const clientPreviewImageDataUrl = asImageDataUrl(
      asOptionalString((body as { clientPreviewImageDataUrl?: unknown } | null)?.clientPreviewImageDataUrl)
    );
    const sourceUrl = asOptionalString((body as { sourceUrl?: unknown } | null)?.sourceUrl);
    const sourceType = asOptionalString((body as { sourceType?: unknown } | null)?.sourceType);
    const folderId = asOptionalString((body as { folderId?: unknown } | null)?.folderId);
    const category = asOptionalString((body as { category?: unknown } | null)?.category);
    const priceText = asOptionalString((body as { priceText?: unknown } | null)?.priceText);
    const dimensionsText = asOptionalString((body as { dimensionsText?: unknown } | null)?.dimensionsText);

    let nextDisplayName = displayName;
    let nextPreviewImageUrl = previewImageUrl;
    let nextSourceUrl = sourceUrl;
    let nextUserSkuId = userSkuIdFromBody;
    let parsedDisplayName = displayName;
    let metadataPriceRawText: string | null = null;
    let metadataPriceNormalizedText: string | null = null;
    let metadataPriceSource: string | null = null;
    let metadataPriceFound = false;
    let metadataFetchFailed = false;
    let ingestCalled = false;
    let ingestOk: boolean | null = null;
    let ingestStatus: number | null = null;
    let ingestedUserSkuId: string | null = null;
    let ingestedDisplayName: string | null = null;
    let usedIngestedUserSkuId = false;
    let usedPreviewFallback = false;
    let ingestTriggeredFromClientFallbackImage = false;

    logSaveEvent("info", "client_preview_candidate_received", requestId, {
      has_client_preview_image_url: Boolean(asHttpUrl(previewImageUrl)),
      has_client_preview_image_data: Boolean(clientPreviewImageDataUrl),
    });

    const isProductUrlFlow = sourceType === "product_url" && Boolean(sourceUrl);
    const canPromotePreparedProductUrl =
      isProductUrlFlow &&
      !prepareOnly &&
      Boolean(userSkuIdFromBody) &&
      Boolean(asHttpUrl(previewImageUrl));
    if (canPromotePreparedProductUrl) {
      logSaveEvent("info", "product_url_promote_prepared_without_reingest", requestId, {
        has_user_sku_id: Boolean(userSkuIdFromBody),
        has_preview_image_url: Boolean(asHttpUrl(previewImageUrl)),
        has_source_url: Boolean(sourceUrl),
        prepare_only: prepareOnly,
      });
      nextUserSkuId = userSkuIdFromBody;
      nextPreviewImageUrl = previewImageUrl;
      nextSourceUrl = sourceUrl;
      if (!nextDisplayName && sourceUrl) {
        const fallbackTitle = deriveDisplayNameFromProductUrl(sourceUrl);
        if (fallbackTitle) {
          nextDisplayName = fallbackTitle;
          logSaveEvent("info", "fallback_title_generated", requestId, {
            fallback_title: fallbackTitle,
            source: "source_url_slug",
          });
        }
      }
      parsedDisplayName = nextDisplayName;
    } else if (isProductUrlFlow && sourceUrl) {
      logSaveEvent("info", "product_url_flow_started", requestId, {
        has_source_url: Boolean(sourceUrl),
      });
      try {
        const metadata = await fetchProductPageMetadata(sourceUrl, requestId);
        const metadataTitle = asOptionalString(metadata.title);
        const metadataImageUrl = asOptionalString(metadata.previewImageUrl);
        metadataPriceRawText = asOptionalString(metadata.priceRawText);
        metadataPriceNormalizedText = asOptionalString(metadata.priceNormalizedText);
        metadataPriceSource = asOptionalString(metadata.priceSource);
        metadataPriceFound = Boolean(metadataPriceRawText);
        metadataFetchFailed = !metadata.fetchOk;
        logSaveEvent("info", "product_url_price_extraction", requestId, {
          metadata_fetch_ok: metadata.fetchOk,
          price_found: metadataPriceFound,
          extracted_price_raw: metadataPriceRawText,
          extracted_price_normalized: metadataPriceNormalizedText,
          extracted_price_source: metadataPriceSource,
        });
        if (!nextDisplayName && metadataTitle) {
          nextDisplayName = metadataTitle;
        }
        if (!nextDisplayName && !metadataTitle) {
          const fallbackTitle = deriveDisplayNameFromProductUrl(sourceUrl);
          if (fallbackTitle) {
            nextDisplayName = fallbackTitle;
            logSaveEvent("info", "fallback_title_generated", requestId, {
              fallback_title: fallbackTitle,
              source: "source_url_slug",
            });
          }
        }
        parsedDisplayName = nextDisplayName;

        const fallbackImageResolution =
          !metadataImageUrl && sourceUrl
            ? resolveFallbackImageUrl(sourceUrl, previewImageUrl)
            : { imageUrl: null, source: null };
        const resolvedImageUrl = metadataImageUrl ?? fallbackImageResolution.imageUrl;
        const resolvedImageDataUrl =
          !metadataImageUrl && !fallbackImageResolution.imageUrl ? clientPreviewImageDataUrl : null;
        const ingestImageSource = metadataImageUrl
          ? "metadata"
          : fallbackImageResolution.source ?? (resolvedImageDataUrl ? "client_preview_image_data" : null);
        if (!metadataImageUrl) {
          logSaveEvent("info", "fallback_image_attempted", requestId, {
            has_metadata_image: false,
            fallback_image_source: ingestImageSource,
            fallback_image_found: Boolean(fallbackImageResolution.imageUrl || resolvedImageDataUrl),
          });
          if (fallbackImageResolution.imageUrl || resolvedImageDataUrl) {
            logSaveEvent("info", "fallback_image_success", requestId, {
              fallback_image_source: ingestImageSource,
              fallback_image_url: fallbackImageResolution.imageUrl,
              fallback_image_data_url_present: Boolean(resolvedImageDataUrl),
            });
          }
        }

        if (resolvedImageUrl || resolvedImageDataUrl) {
          ingestCalled = true;
          if (!metadataImageUrl) {
            ingestTriggeredFromClientFallbackImage =
              fallbackImageResolution.source === "client_preview_image" || Boolean(resolvedImageDataUrl);
            logSaveEvent("info", "ingest_called_from_fallback", requestId, {
              fallback_image_source: ingestImageSource,
            });
            if (ingestTriggeredFromClientFallbackImage) {
              logSaveEvent("info", "ingest_triggered_from_client_fallback_image", requestId, {
                fallback_image_source: ingestImageSource,
                fallback_image_data_url: Boolean(resolvedImageDataUrl),
              });
            }
          }
          logSaveEvent("info", "product_url_ingest_attempt", requestId, {
            metadata_image_present: Boolean(metadataImageUrl),
            ingest_image_source: ingestImageSource,
            ingest_image_data_url_present: Boolean(resolvedImageDataUrl),
          });
          try {
            const ingestResult = await ingestPreviewImageViaExistingFlow(
              req,
              {
                imageUrl: resolvedImageUrl,
                imageBase64: resolvedImageDataUrl,
                label: metadataTitle ?? nextDisplayName ?? null,
              }
            );
            logSaveEvent("info", "product_url_ingest_result", requestId, {
              ingest_called: true,
              ingest_ok: ingestResult.ok,
              ingest_status: ingestResult.status,
              ingested_user_sku_id: ingestResult.ingested?.userSkuId ?? null,
              ingest_failure_detail: ingestResult.failureDetail,
            });
            ingestOk = ingestResult.ok;
            ingestStatus = ingestResult.status;
            ingestedUserSkuId = ingestResult.ingested?.userSkuId ?? null;
            ingestedDisplayName = ingestResult.ingested?.displayName ?? null;
            if (ingestResult.ingested?.userSkuId) {
              nextUserSkuId = ingestResult.ingested.userSkuId;
              usedIngestedUserSkuId = true;
            }
            usedPreviewFallback = !ingestResult.ingested?.previewImageUrl;
            nextPreviewImageUrl = ingestResult.ingested?.previewImageUrl ?? resolvedImageUrl;
          } catch {
            // Fallback to raw metadata image; save should still succeed.
            ingestOk = false;
            ingestStatus = null;
            logSaveEvent("warn", "product_url_ingest_failed", requestId, {
              ingest_called: true,
            });
            usedPreviewFallback = true;
            nextPreviewImageUrl = resolvedImageUrl;
          }
        } else {
          logSaveEvent("info", "product_url_metadata_no_image", requestId, {
            ingest_called: false,
          });
        }
      } catch {
        // Metadata extraction is best-effort only.
        metadataFetchFailed = true;
        logSaveEvent("warn", "product_url_metadata_failed", requestId, {
          has_source_url: Boolean(sourceUrl),
        });
      }
    }

    if (isProductUrlFlow && !nextDisplayName) {
      nextDisplayName = ingestedDisplayName ?? DEFAULT_PASTED_PRODUCT_NAME;
      if (!parsedDisplayName) {
        parsedDisplayName = nextDisplayName;
      }
    }

    const parsedSourceUrl = nextSourceUrl;
    const parsedSourceDomain = extractDomain(parsedSourceUrl);
    const parsedSupplierName = normalizeSupplier(parsedSourceDomain);
    const hasUsablePreviewImage = Boolean(asHttpUrl(nextPreviewImageUrl));
    const hasIngestBackedSku = Boolean(ingestedUserSkuId);
    const hasMeaningfulFallbackItemData =
      Boolean(asOptionalString(nextDisplayName)) ||
      Boolean(asOptionalString(parsedSupplierName)) ||
      Boolean(asOptionalString(parsedSourceDomain));
    const shouldBlockProductUrlSave =
      isProductUrlFlow &&
      !hasUsablePreviewImage &&
      !hasIngestBackedSku &&
      !hasMeaningfulFallbackItemData;

    if (shouldBlockProductUrlSave) {
      logSaveEvent("warn", "product_url_prepare_422", requestId, {
        code: "product_url_blocked_or_unreadable",
        source_url_domain: parsedSourceDomain,
        metadata_fetch_failed: metadataFetchFailed,
        has_preview_image: hasUsablePreviewImage,
        ingest_called: ingestCalled,
        ingest_ok: ingestOk,
        ingest_status: ingestStatus,
        has_next_user_sku_id: Boolean(nextUserSkuId),
      });
      logSaveEvent("warn", "product_url_blocked_or_unreadable", requestId, {
        metadata_fetch_failed: metadataFetchFailed,
        has_usable_preview_image: hasUsablePreviewImage,
        has_ingest_backed_sku: hasIngestBackedSku,
        has_meaningful_fallback_item_data: hasMeaningfulFallbackItemData,
        ingest_called: ingestCalled,
        ingest_ok: ingestOk,
      });
      return Response.json(
        {
          requestId,
          code: "product_url_blocked_or_unreadable",
          error: "We couldn't read that product page right now. Try copying the product image instead.",
        },
        { status: 422 }
      );
    }

    const effectivePriceText = priceText ?? metadataPriceNormalizedText;
    logSaveEvent("info", "product_url_parse_price_input", requestId, {
      input_price_text: priceText,
      metadata_price_raw_text: metadataPriceRawText,
      metadata_price_normalized_text: metadataPriceNormalizedText,
      effective_price_text: effectivePriceText,
    });
    const parsedPrice = parsePrice(effectivePriceText);
    logSaveEvent("info", "product_url_parse_price_result", requestId, {
      effective_price_text: effectivePriceText,
      parsed_price_amount: parsedPrice.amount,
      parsed_price_currency: parsedPrice.currency,
      parsed_price_confidence: parsedPrice.confidence,
    });
    const parsedDimensions = parseDimensions(dimensionsText);

    if (!nextUserSkuId) {
      if (prepareOnly && isProductUrlFlow) {
        logSaveEvent("warn", "product_url_prepare_422", requestId, {
          code: "product_url_prepare_missing_user_sku_id",
          source_url_domain: parsedSourceDomain,
          metadata_fetch_failed: metadataFetchFailed,
          has_preview_image: hasUsablePreviewImage,
          ingest_called: ingestCalled,
          ingest_ok: ingestOk,
          ingest_status: ingestStatus,
          has_next_user_sku_id: Boolean(nextUserSkuId),
        });
        logSaveEvent("warn", "product_url_prepare_missing_user_sku_id", requestId, {
          prepare_only: true,
        });
        return Response.json(
          {
            requestId,
            code: "product_url_prepare_missing_user_sku_id",
            error: "We couldn't prepare that product link. Try copying the product image instead.",
          },
          { status: 422 }
        );
      }
      return Response.json({ error: "userSkuId is required." }, { status: 400 });
    }

    if (prepareOnly) {
      logSaveEvent("info", "product_url_prepare_only_completed", requestId, {
        prepare_only: true,
        final_user_sku_id: nextUserSkuId,
        has_preview_image_url: Boolean(asHttpUrl(nextPreviewImageUrl)),
      });
      return Response.json({
        prepared: {
          userSkuId: nextUserSkuId,
          previewImageUrl: asHttpUrl(nextPreviewImageUrl),
          displayName: asOptionalString(nextDisplayName) ?? DEFAULT_PASTED_PRODUCT_NAME,
          sourceUrl: asOptionalString(nextSourceUrl),
          sourceDomain: asOptionalString(parsedSourceDomain),
          parsedSourceDomain: asOptionalString(parsedSourceDomain),
          supplierName: asOptionalString(parsedSupplierName),
          parsedSupplierName: asOptionalString(parsedSupplierName),
        },
      });
    }

    if (isProductUrlFlow) {
      logSaveEvent("info", "product_url_durable_save_requested", requestId, {
        prepare_only: prepareOnly,
        has_user_sku_id: Boolean(nextUserSkuId),
        has_preview_image_url: Boolean(asHttpUrl(nextPreviewImageUrl)),
        has_source_url: Boolean(asOptionalString(nextSourceUrl)),
      });
    }

    logSaveEvent("info", "product_url_upsert_payload", requestId, {
      upsert_user_sku_id: nextUserSkuId,
      upsert_parsed_price_text: effectivePriceText,
      upsert_parsed_price_amount: parsedPrice.amount,
      upsert_parsed_price_currency: parsedPrice.currency,
      upsert_price_confidence: parsedPrice.confidence,
    });
    const row = await upsertVibodeUserFurniture(supabase, {
      userId: userData.user.id,
      userSkuId: nextUserSkuId,
      folderId,
      sourceType,
      displayName: nextDisplayName,
      previewImageUrl: nextPreviewImageUrl,
      sourceUrl: nextSourceUrl,
      category,
      parsedDisplayName,
      parsedSourceUrl,
      parsedSourceDomain,
      parsedSupplierName,
      parsedPriceText: effectivePriceText,
      parsedPriceAmount: parsedPrice.amount,
      parsedPriceCurrency: parsedPrice.currency,
      parsedDimensionsText: dimensionsText,
      parsedWidthValue: parsedDimensions.width,
      parsedDepthValue: parsedDimensions.depth,
      parsedHeightValue: parsedDimensions.height,
      parsedDimensionUnit: parsedDimensions.unit,
      parsedCategory: category,
      priceSourceType: detectSourceType(parsedSourceDomain),
      priceConfidence: parsedPrice.confidence,
    });

    logSaveEvent("info", "product_url_final_save", requestId, {
      is_product_url_flow: isProductUrlFlow,
      initial_user_sku_id: userSkuIdFromBody,
      final_user_sku_id: nextUserSkuId,
      ingest_called: isProductUrlFlow ? ingestCalled : false,
      ingest_ok: ingestOk,
      metadata_fetch_failed: isProductUrlFlow ? metadataFetchFailed : null,
      ingested_user_sku_id: ingestedUserSkuId,
      used_ingested_user_sku_id: isProductUrlFlow && usedIngestedUserSkuId,
      used_preview_fallback: isProductUrlFlow && usedPreviewFallback,
      ingest_triggered_from_client_fallback_image:
        isProductUrlFlow && ingestTriggeredFromClientFallbackImage,
      effective_price_text: effectivePriceText,
      parsed_price_amount: parsedPrice.amount,
      parsed_price_currency: parsedPrice.currency,
      parsed_price_confidence: parsedPrice.confidence,
      price_fields_persisted:
        Boolean(row.parsed_price_text) || row.parsed_price_amount !== null || Boolean(row.parsed_price_currency),
      persisted_parsed_price_text: row.parsed_price_text,
      persisted_parsed_price_amount: row.parsed_price_amount,
      persisted_parsed_price_currency: row.parsed_price_currency,
    });

    return Response.json({
      item: {
        id: row.id,
        user_sku_id: row.user_sku_id,
        folder_id: row.folder_id,
        source_type: row.source_type,
        display_name: row.display_name,
        preview_image_url: row.preview_image_url,
        source_url: row.source_url,
        category: row.category,
        parsed_display_name: row.parsed_display_name,
        parsed_source_url: row.parsed_source_url,
        parsed_source_domain: row.parsed_source_domain,
        parsed_supplier_name: row.parsed_supplier_name,
        parsed_price_text: row.parsed_price_text,
        parsed_price_amount: row.parsed_price_amount,
        parsed_price_currency: row.parsed_price_currency,
        parsed_dimensions_text: row.parsed_dimensions_text,
        parsed_width_value: row.parsed_width_value,
        parsed_depth_value: row.parsed_depth_value,
        parsed_height_value: row.parsed_height_value,
        parsed_dimension_unit: row.parsed_dimension_unit,
        parsed_category: row.parsed_category,
        price_source_type: row.price_source_type,
        price_confidence: row.price_confidence,
        times_used: row.times_used,
        last_used_at: row.last_used_at,
        created_at: row.created_at,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    logSaveEvent("error", "failed", requestId, {
      error: message,
    });
    return Response.json({ error: message }, { status: 500 });
  }
}
