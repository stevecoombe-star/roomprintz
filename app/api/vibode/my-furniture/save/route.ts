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
  priceRawText: string | null;
  priceNormalizedText: string | null;
  priceSource: string | null;
};

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const PRODUCT_PAGE_FETCH_TIMEOUT_MS = 6000;
const PRODUCT_PAGE_MAX_HTML_CHARS = 750_000;
const PRODUCT_PAGE_SUBSTANTIAL_HTML_CHARS = 2_000;
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

function asOptionalNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
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

function normalizeCurrencyCode(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "$") return null;
  if (normalized === "US$") return "USD";
  if (normalized === "CA$" || normalized === "C$") return "CAD";
  if (/^[A-Z]{3}$/.test(normalized)) return normalized;
  return null;
}

function normalizePriceNumber(raw: string | number | null | undefined): string | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return String(raw);
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/,/g, "");
  const match = cleaned.match(/[0-9]+(?:\.[0-9]+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return match[0];
}

function formatPriceText(
  amount: string | null,
  currency: string | null,
  fallbackRawText?: string | null
): string | null {
  const normalizedAmount = normalizePriceNumber(amount);
  const normalizedCurrency = normalizeCurrencyCode(currency);
  if (normalizedAmount && normalizedCurrency) return `${normalizedCurrency} ${normalizedAmount}`;
  if (normalizedAmount) return normalizedAmount;
  return asOptionalString(fallbackRawText) ?? null;
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

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

type ExtractedPriceCandidate = {
  source: string;
  rawPriceText: string;
  normalizedPriceText: string | null;
};

type PriceExtractionDiagnostics = {
  jsonLdBlockCount: number;
  jsonLdCandidateFound: boolean;
  metaTagCandidateFound: boolean;
  scriptEmbeddedCandidateFound: boolean;
  visibleHtmlCandidateFound: boolean;
  selectedPriceSource: string | null;
};

function createPriceCandidate(
  source: string,
  amount: string | number | null | undefined,
  currency: string | null | undefined,
  rawPriceText?: string | null
): ExtractedPriceCandidate | null {
  const numericAmount = normalizePriceNumber(typeof amount === "number" ? String(amount) : amount ?? null);
  const raw = asOptionalString(rawPriceText) ?? numericAmount;
  if (!raw) return null;
  const normalizedPriceText = formatPriceText(numericAmount, currency ?? null, raw);
  return {
    source,
    rawPriceText: raw,
    normalizedPriceText,
  };
}

function findJsonLdPriceCandidate(html: string): ExtractedPriceCandidate | null {
  const jsonLdRegex =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null = null;

  while ((match = jsonLdRegex.exec(html))) {
    const scriptPayload = asOptionalString(decodeHtmlEntities(match[1] ?? ""));
    if (!scriptPayload) continue;
    const parsed = parseJsonSafe(scriptPayload);
    if (!parsed) continue;
    const queue: unknown[] = [parsed];

    while (queue.length > 0) {
      const current = queue.shift();
      if (Array.isArray(current)) {
        queue.push(...current);
        continue;
      }
      const record = safeRecord(current);
      if (!record) continue;

      const offersRaw = record.offers;
      if (Array.isArray(offersRaw)) queue.push(...offersRaw);
      else if (offersRaw) queue.push(offersRaw);
      if (record.priceSpecification) queue.push(record.priceSpecification);
      if (record["@graph"]) queue.push(record["@graph"]);
      if (record.mainEntity) queue.push(record.mainEntity);

      const candidate =
        createPriceCandidate(
          "json_ld",
          asOptionalString(record.price) ?? asOptionalNumber(record.price),
          asOptionalString(record.priceCurrency),
          asOptionalString(record.price)
        ) ??
        createPriceCandidate(
          "json_ld",
          asOptionalString(record.lowPrice) ?? asOptionalNumber(record.lowPrice),
          asOptionalString(record.priceCurrency) ?? asOptionalString(record.currency),
          asOptionalString(record.lowPrice)
        ) ??
        createPriceCandidate(
          "json_ld",
          asOptionalString(record.highPrice) ?? asOptionalNumber(record.highPrice),
          asOptionalString(record.priceCurrency) ?? asOptionalString(record.currency),
          asOptionalString(record.highPrice)
        );
      if (candidate) return candidate;
    }
  }
  return null;
}

function countJsonLdBlocks(html: string): number {
  const jsonLdRegex =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let count = 0;
  while (jsonLdRegex.exec(html)) count += 1;
  return count;
}

function findMetaTagPriceCandidate(html: string): ExtractedPriceCandidate | null {
  const amount =
    getMetaContent(html, [{ key: "property", value: "product:price:amount" }]) ??
    getMetaContent(html, [{ key: "property", value: "og:price:amount" }]) ??
    getMetaContent(html, [{ key: "itemprop", value: "price" }]) ??
    getMetaContent(html, [{ key: "name", value: "twitter:data1" }]) ??
    getMetaContent(html, [{ key: "name", value: "price" }]);

  if (!amount) return null;

  const currency =
    getMetaContent(html, [{ key: "property", value: "product:price:currency" }]) ??
    getMetaContent(html, [{ key: "property", value: "og:price:currency" }]) ??
    getMetaContent(html, [{ key: "itemprop", value: "priceCurrency" }]);

  return createPriceCandidate("meta_tag", amount, currency, amount);
}

function findScriptEmbeddedPriceCandidate(html: string): ExtractedPriceCandidate | null {
  const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null = null;
  while ((scriptMatch = scriptRegex.exec(html))) {
    const scriptContent = scriptMatch[1] ?? "";
    if (!scriptContent || /ld\+json/i.test(scriptMatch[0])) continue;

    const currencyMatch = scriptContent.match(
      /["']?(?:priceCurrency|currencyCode|currency|currency_code|currencyCodeString)["']?\s*[:=]\s*["']([A-Za-z$]{1,5})["']/i
    );
    const fallbackCurrencyMatch = scriptContent.match(/\b(USD|CAD|US\$|CA\$|C\$)\b/i);
    const currency =
      asOptionalString(currencyMatch?.[1] ?? null) ?? asOptionalString(fallbackCurrencyMatch?.[1] ?? null);

    const pricePattern =
      /["']?(price|salePrice|sale_price|currentPrice|current_price|offerPrice|offer_price|finalPrice|final_price|listPrice|list_price|priceValue|price_value|priceAmount|price_amount|amount|value|priceCents|price_cents|amountMicros|amount_micros)["']?\s*[:=]\s*["']?([0-9][0-9,]*(?:\.[0-9]+)?)["']?/gi;
    let priceMatch: RegExpExecArray | null = null;
    while ((priceMatch = pricePattern.exec(scriptContent))) {
      const rawKey = asOptionalString(priceMatch[1])?.toLowerCase() ?? "";
      const rawPriceText = asOptionalString(priceMatch[2]);
      if (!rawPriceText) continue;

      let effectivePriceText = rawPriceText;
      const parsedNumeric = Number(rawPriceText.replace(/,/g, ""));
      if (Number.isFinite(parsedNumeric) && parsedNumeric > 0) {
        if (rawKey.includes("micros")) {
          effectivePriceText = String(parsedNumeric / 1_000_000);
        } else if (rawKey.includes("cents")) {
          effectivePriceText = String(parsedNumeric / 100);
        }
      }

      const candidate = createPriceCandidate(
        "script_embedded",
        effectivePriceText,
        currency,
        rawPriceText
      );
      if (candidate) return candidate;
    }
  }
  return null;
}

function findVisibleHtmlPriceCandidate(html: string): ExtractedPriceCandidate | null {
  const htmlWithoutScripts = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const compactText = collapseWhitespace(decodeHtmlEntities(htmlWithoutScripts.replace(/<[^>]+>/g, " ")));

  const priceWithCurrency = compactText.match(
    /(CA\$|C\$|US\$|USD|CAD|\$)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i
  );
  if (priceWithCurrency) {
    const candidate = createPriceCandidate(
      "visible_html",
      asOptionalString(priceWithCurrency[2]),
      asOptionalString(priceWithCurrency[1]),
      asOptionalString(priceWithCurrency[0])
    );
    if (candidate) return candidate;
  }

  const labeledPrice = compactText.match(
    /\b(?:price|our price|sale price|now)\b[:\s]*([0-9][0-9,]*(?:\.[0-9]+)?)/i
  );
  if (labeledPrice) {
    return createPriceCandidate("visible_html", asOptionalString(labeledPrice[1]), null, labeledPrice[1]);
  }

  return null;
}

function extractPriceCandidateFromHtml(html: string): {
  candidate: ExtractedPriceCandidate | null;
  diagnostics: PriceExtractionDiagnostics;
} {
  const jsonLdBlockCount = countJsonLdBlocks(html);
  const jsonLdCandidate = findJsonLdPriceCandidate(html);
  const metaTagCandidate = findMetaTagPriceCandidate(html);
  const scriptEmbeddedCandidate = findScriptEmbeddedPriceCandidate(html);
  const visibleHtmlCandidate = findVisibleHtmlPriceCandidate(html);
  const candidate = jsonLdCandidate ?? metaTagCandidate ?? scriptEmbeddedCandidate ?? visibleHtmlCandidate;
  return {
    candidate,
    diagnostics: {
      jsonLdBlockCount,
      jsonLdCandidateFound: Boolean(jsonLdCandidate),
      metaTagCandidateFound: Boolean(metaTagCandidate),
      scriptEmbeddedCandidateFound: Boolean(scriptEmbeddedCandidate),
      visibleHtmlCandidateFound: Boolean(visibleHtmlCandidate),
      selectedPriceSource: candidate?.source ?? null,
    },
  };
}

function getTitleFromHtml(html: string): string | null {
  const ogTitle = getMetaContent(html, [{ key: "property", value: "og:title" }]);
  if (ogTitle) return collapseWhitespace(decodeHtmlEntities(ogTitle));
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = asOptionalString(titleMatch?.[1] ?? null);
  return title ? collapseWhitespace(decodeHtmlEntities(title)) : null;
}

async function fetchProductPageMetadata(sourceUrl: string, requestId: string): Promise<ProductPageMetadata> {
  const safeSourceUrl = asHttpUrl(sourceUrl);
  if (!safeSourceUrl) {
    logSaveEvent("warn", "product_url_metadata_invalid_url", requestId, {
      source_url: sourceUrl,
    });
    return { title: null, previewImageUrl: null, priceRawText: null, priceNormalizedText: null, priceSource: null };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRODUCT_PAGE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(safeSourceUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        "Upgrade-Insecure-Requests": "1",
      },
      cache: "no-store",
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const resolvedUrl = asOptionalString(response.url) ?? safeSourceUrl;
    logSaveEvent("info", "product_url_metadata_fetch_response", requestId, {
      fetch_status: response.status,
      fetch_ok: response.ok,
      fetch_content_type: contentType,
      fetch_resolved_url: resolvedUrl,
    });
    if (!response.ok) {
      return { title: null, previewImageUrl: null, priceRawText: null, priceNormalizedText: null, priceSource: null };
    }
    if (!contentType.includes("text/html")) {
      return { title: null, previewImageUrl: null, priceRawText: null, priceNormalizedText: null, priceSource: null };
    }

    const html = (await response.text()).slice(0, PRODUCT_PAGE_MAX_HTML_CHARS);
    const htmlLength = html.length;
    const htmlSubstantial = htmlLength >= PRODUCT_PAGE_SUBSTANTIAL_HTML_CHARS;
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
    const extraction = extractPriceCandidateFromHtml(html);
    const extractedPrice = extraction.candidate;
    logSaveEvent("info", "product_url_metadata_price_extraction_diagnostics", requestId, {
      html_length: htmlLength,
      html_substantial: htmlSubstantial,
      json_ld_blocks_found: extraction.diagnostics.jsonLdBlockCount > 0,
      json_ld_block_count: extraction.diagnostics.jsonLdBlockCount,
      json_ld_price_candidate_found: extraction.diagnostics.jsonLdCandidateFound,
      meta_tag_price_candidate_found: extraction.diagnostics.metaTagCandidateFound,
      script_embedded_price_candidate_found: extraction.diagnostics.scriptEmbeddedCandidateFound,
      visible_html_price_candidate_found: extraction.diagnostics.visibleHtmlCandidateFound,
      selected_price_source: extraction.diagnostics.selectedPriceSource,
      extracted_price_raw: extractedPrice?.rawPriceText ?? null,
      extracted_price_normalized: extractedPrice?.normalizedPriceText ?? null,
    });
    return {
      title,
      previewImageUrl,
      priceRawText: extractedPrice?.rawPriceText ?? null,
      priceNormalizedText: extractedPrice?.normalizedPriceText ?? null,
      priceSource: extractedPrice?.source ?? null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

type IngestedImageResult = {
  userSkuId: string | null;
  previewImageUrl: string | null;
};

type IngestPreviewCallResult = {
  ok: boolean;
  status: number;
  ingested: IngestedImageResult | null;
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

function getIngestedImageResult(payload: unknown): IngestedImageResult {
  const record = safeRecord(payload);
  if (!record) return { userSkuId: null, previewImageUrl: null };

  const userSku = safeRecord(record.userSku);
  const ingestedUserSkuId = asOptionalString(
    userSku?.user_sku_id ?? userSku?.userSkuId ?? userSku?.id ?? userSku?.skuId
  );
  const userSkuStatus = asOptionalString(userSku?.status)?.toLowerCase();
  if (userSkuStatus === "ready" && Array.isArray(userSku?.variants)) {
    for (const variant of userSku.variants) {
      const imageUrl = asHttpUrl(asOptionalString(variant));
      if (imageUrl) return { userSkuId: ingestedUserSkuId, previewImageUrl: imageUrl };
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
  };
}

async function ingestPreviewImageViaExistingFlow(
  req: NextRequest,
  imageUrl: string,
  label?: string | null
): Promise<IngestPreviewCallResult> {
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
      imageUrl,
      ...(label ? { label } : {}),
    }),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  return {
    ok: response.ok,
    status: response.status,
    ingested: response.ok ? getIngestedImageResult(payload) : null,
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
    let nextUserSkuId = userSkuId;
    let parsedDisplayName = displayName;
    let metadataPriceRawText: string | null = null;
    let metadataPriceNormalizedText: string | null = null;
    let metadataPriceSource: string | null = null;
    let metadataPriceFound = false;
    let ingestCalled = false;
    let ingestOk: boolean | null = null;
    let ingestedUserSkuId: string | null = null;
    let usedIngestedUserSkuId = false;
    let usedPreviewFallback = false;

    const isProductUrlFlow = sourceType === "product_url" && Boolean(sourceUrl);
    if (isProductUrlFlow && sourceUrl) {
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
        logSaveEvent("info", "product_url_price_extraction", requestId, {
          price_found: metadataPriceFound,
          extracted_price_raw: metadataPriceRawText,
          extracted_price_normalized: metadataPriceNormalizedText,
          extracted_price_source: metadataPriceSource,
        });
        if (!nextDisplayName && metadataTitle) {
          nextDisplayName = metadataTitle;
        }
        parsedDisplayName = nextDisplayName;

        if (metadataImageUrl) {
          ingestCalled = true;
          logSaveEvent("info", "product_url_ingest_attempt", requestId, {
            metadata_image_present: true,
          });
          try {
            const ingestResult = await ingestPreviewImageViaExistingFlow(
              req,
              metadataImageUrl,
              metadataTitle ?? nextDisplayName ?? null
            );
            logSaveEvent("info", "product_url_ingest_result", requestId, {
              ingest_called: true,
              ingest_ok: ingestResult.ok,
              ingest_status: ingestResult.status,
              ingested_user_sku_id: ingestResult.ingested?.userSkuId ?? null,
            });
            ingestOk = ingestResult.ok;
            ingestedUserSkuId = ingestResult.ingested?.userSkuId ?? null;
            if (ingestResult.ingested?.userSkuId) {
              nextUserSkuId = ingestResult.ingested.userSkuId;
              usedIngestedUserSkuId = true;
            }
            usedPreviewFallback = !ingestResult.ingested?.previewImageUrl;
            nextPreviewImageUrl = ingestResult.ingested?.previewImageUrl ?? metadataImageUrl;
          } catch {
            // Fallback to raw metadata image; save should still succeed.
            ingestOk = false;
            logSaveEvent("warn", "product_url_ingest_failed", requestId, {
              ingest_called: true,
            });
            usedPreviewFallback = true;
            nextPreviewImageUrl = metadataImageUrl;
          }
        } else {
          logSaveEvent("info", "product_url_metadata_no_image", requestId, {
            ingest_called: false,
          });
        }
      } catch {
        // Metadata extraction is best-effort only.
        logSaveEvent("warn", "product_url_metadata_failed", requestId, {
          has_source_url: Boolean(sourceUrl),
        });
      }
    }

    const parsedSourceUrl = nextSourceUrl;
    const parsedSourceDomain = extractDomain(parsedSourceUrl);
    const parsedSupplierName = normalizeSupplier(parsedSourceDomain);
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
      initial_user_sku_id: userSkuId,
      final_user_sku_id: nextUserSkuId,
      ingest_called: isProductUrlFlow ? ingestCalled : false,
      ingest_ok: ingestOk,
      ingested_user_sku_id: ingestedUserSkuId,
      used_ingested_user_sku_id: isProductUrlFlow && usedIngestedUserSkuId,
      used_preview_fallback: isProductUrlFlow && usedPreviewFallback,
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
