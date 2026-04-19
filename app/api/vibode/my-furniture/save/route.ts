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
import { upsertVibodeUserFurniture } from "@/lib/vibodeMyFurniture";

export const runtime = "nodejs";

type AnySupabaseClient = SupabaseClient<any, "public", any>;
type UnknownRecord = Record<string, unknown>;
type ProductPageMetadata = {
  title: string | null;
  previewImageUrl: string | null;
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const PRODUCT_PAGE_FETCH_TIMEOUT_MS = 6000;
const PRODUCT_PAGE_MAX_HTML_CHARS = 750_000;
const INGEST_SOURCE_HEADER = "x-roomprintz-ingest-source";
const INGEST_SKIP_MY_FURNITURE_AUTOSAVE_HEADER = "x-roomprintz-skip-my-furniture-autosave";

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

function safeRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
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

function parseMetaTagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null = null;
  while ((match = attrRegex.exec(tag))) {
    const key = match[1].toLowerCase();
    const raw = match[3] ?? match[4] ?? match[5] ?? "";
    attrs[key] = raw.trim();
  }
  return attrs;
}

function getMetaContent(html: string, checks: Array<{ key: "property" | "name" | "itemprop"; value: string }>): string | null {
  const metaRegex = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = metaRegex.exec(html))) {
    const attrs = parseMetaTagAttributes(match[0]);
    const content = asOptionalString(attrs.content);
    if (!content) continue;
    const isMatch = checks.some(({ key, value }) => (attrs[key] ?? "").toLowerCase() === value);
    if (isMatch) return content;
  }
  return null;
}

function getTitleFromHtml(html: string): string | null {
  const ogTitle = getMetaContent(html, [{ key: "property", value: "og:title" }]);
  if (ogTitle) return collapseWhitespace(decodeHtmlEntities(ogTitle));
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = asOptionalString(titleMatch?.[1] ?? null);
  return title ? collapseWhitespace(decodeHtmlEntities(title)) : null;
}

async function fetchProductPageMetadata(sourceUrl: string): Promise<ProductPageMetadata> {
  const safeSourceUrl = asHttpUrl(sourceUrl);
  if (!safeSourceUrl) {
    return { title: null, previewImageUrl: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRODUCT_PAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(safeSourceUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        // Lightweight browser-like UA improves compatibility for basic metadata fetches.
        "User-Agent": "Mozilla/5.0 (compatible; RoomprintzBot/1.0; +https://roomprintz.com)",
        Accept: "text/html,application/xhtml+xml",
      },
      cache: "no-store",
    });
    if (!response.ok) {
      return { title: null, previewImageUrl: null };
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/html")) {
      return { title: null, previewImageUrl: null };
    }

    const html = (await response.text()).slice(0, PRODUCT_PAGE_MAX_HTML_CHARS);
    const title = getTitleFromHtml(html);
    const previewImageCandidate =
      getMetaContent(html, [{ key: "property", value: "og:image" }]) ??
      getMetaContent(html, [{ key: "name", value: "twitter:image" }]) ??
      getMetaContent(html, [
        { key: "property", value: "og:image:url" },
        { key: "name", value: "twitter:image:src" },
        { key: "itemprop", value: "image" },
      ]);
    const previewImageUrl = asHttpUrl(previewImageCandidate, safeSourceUrl);
    return {
      title,
      previewImageUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getIngestedPreviewImageUrl(payload: unknown): string | null {
  const record = safeRecord(payload);
  if (!record) return null;

  const userSku = safeRecord(record.userSku);
  const userSkuStatus = asOptionalString(userSku?.status)?.toLowerCase();
  if (userSkuStatus === "ready" && Array.isArray(userSku?.variants)) {
    for (const variant of userSku.variants) {
      const imageUrl = asHttpUrl(asOptionalString(variant));
      if (imageUrl) return imageUrl;
    }
  }

  const savedFurniture = safeRecord(record.savedFurniture);
  return asHttpUrl(
    asOptionalString(savedFurniture?.previewImageUrl) ??
      asOptionalString(savedFurniture?.preview_image_url) ??
      null
  );
}

async function ingestPreviewImageViaExistingFlow(
  req: NextRequest,
  imageUrl: string,
  label?: string | null
): Promise<string | null> {
  const ingestUrl = new URL("/api/vibode/user-skus/ingest", req.url).toString();
  const authorization = asOptionalString(req.headers.get("authorization"));
  const response = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [INGEST_SOURCE_HEADER]: "product_url",
      [INGEST_SKIP_MY_FURNITURE_AUTOSAVE_HEADER]: "1",
      ...(authorization ? { Authorization: authorization } : {}),
    },
    body: JSON.stringify({
      imageUrl,
      ...(label ? { label } : {}),
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) return null;
  return getIngestedPreviewImageUrl(payload);
}

export async function POST(req: NextRequest) {
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
    const userSkuId = asOptionalString((body as { userSkuId?: unknown } | null)?.userSkuId);
    if (!userSkuId) {
      return Response.json({ error: "userSkuId is required." }, { status: 400 });
    }

    const displayName = asOptionalString((body as { displayName?: unknown } | null)?.displayName);
    const previewImageUrl = asOptionalString((body as { previewImageUrl?: unknown } | null)?.previewImageUrl);
    const sourceUrl = asOptionalString((body as { sourceUrl?: unknown } | null)?.sourceUrl);
    const sourceType = asOptionalString((body as { sourceType?: unknown } | null)?.sourceType);
    const folderId = asOptionalString((body as { folderId?: unknown } | null)?.folderId);
    const category = asOptionalString((body as { category?: unknown } | null)?.category);
    const priceText = asOptionalString((body as { priceText?: unknown } | null)?.priceText);
    const dimensionsText = asOptionalString((body as { dimensionsText?: unknown } | null)?.dimensionsText);

    let nextDisplayName = displayName;
    let nextPreviewImageUrl = previewImageUrl;
    let nextSourceUrl = sourceUrl;
    let parsedDisplayName = displayName;

    const isProductUrlFlow = sourceType === "product_url" && Boolean(sourceUrl);
    if (isProductUrlFlow && sourceUrl) {
      try {
        const metadata = await fetchProductPageMetadata(sourceUrl);
        const metadataTitle = asOptionalString(metadata.title);
        const metadataImageUrl = asOptionalString(metadata.previewImageUrl);
        if (!nextDisplayName && metadataTitle) {
          nextDisplayName = metadataTitle;
        }
        parsedDisplayName = nextDisplayName;

        if (metadataImageUrl) {
          try {
            const ingestedPreview = await ingestPreviewImageViaExistingFlow(
              req,
              metadataImageUrl,
              metadataTitle ?? nextDisplayName ?? null
            );
            nextPreviewImageUrl = ingestedPreview ?? metadataImageUrl;
          } catch {
            // Fallback to raw metadata image; save should still succeed.
            nextPreviewImageUrl = metadataImageUrl;
          }
        }
      } catch {
        // Metadata extraction is best-effort only.
      }
    }

    const parsedSourceUrl = nextSourceUrl;
    const parsedSourceDomain = extractDomain(parsedSourceUrl);
    const parsedSupplierName = normalizeSupplier(parsedSourceDomain);
    const parsedPrice = parsePrice(priceText);
    const parsedDimensions = parseDimensions(dimensionsText);

    const row = await upsertVibodeUserFurniture(supabase, {
      userId: userData.user.id,
      userSkuId,
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
      parsedPriceText: priceText,
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
    return Response.json({ error: message }, { status: 500 });
  }
}
