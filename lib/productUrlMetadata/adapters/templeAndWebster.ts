import type {
  DomainAdapter,
  DomainAdapterExtractContext,
  DomainAdapterExtractResult,
  DomainAdapterMatchContext,
} from "@/lib/productUrlMetadata/adapters/types";
import { collapseWhitespace, decodeHtmlEntities } from "@/lib/productUrlMetadata/html";
import { asHttpUrl, normalizeHost } from "@/lib/productUrlMetadata/url";

const TEMPLE_AND_WEBSTER_DOMAIN = "templeandwebster.com.au";
const URL_SKU_SUFFIX_REGEX = /-([A-Z]{2,}\d{3,}[A-Z0-9]*)\.html$/i;
const SKU_LABEL_REGEX = /\bSKU\s*#\s*:?\s*([A-Z0-9-]{4,})\b/i;
const NON_PRODUCT_PATH_SEGMENTS = ["/collections", "/search", "/help", "/blog", "/inspiration", "/brands"];
const NOISE_IMAGE_MARKERS = [
  "afterpay",
  "zip",
  "payment",
  "logo",
  "icon",
  "sprite",
  "review",
  "trustpilot",
  "banner",
  "shop-the-look",
];
const INSTALLMENT_PRICE_MARKERS = /(payment|payments|afterpay|zip|klarna|humm|laybuy|per week|per month)/i;
const TITLE_SITE_SUFFIX_REGEX = /\s*[-|]\s*Temple\s*&\s*Webster.*$/i;

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function htmlToText(html: string): string {
  const withoutScriptsAndStyles = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  return collapseWhitespace(decodeHtmlEntities(stripTags(withoutScriptsAndStyles)));
}

function getTagAttribute(tag: string, attribute: string): string | null {
  const regex = new RegExp(`\\b${attribute}\\s*=\\s*(\"([^\"]*)\"|'([^']*)'|([^\\s\"'=<>]+))`, "i");
  const match = tag.match(regex);
  return asOptionalString(match?.[2] ?? match?.[3] ?? match?.[4] ?? null);
}

function cleanTitle(value: string | null): string | null {
  if (!value) return null;
  const decoded = collapseWhitespace(decodeHtmlEntities(value));
  if (!decoded) return null;
  const withoutSuffix = decoded.replace(TITLE_SITE_SUFFIX_REGEX, "").trim();
  return withoutSuffix || decoded || null;
}

function extractTitleFromHeading(html: string): string | null {
  const headingMatch = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return cleanTitle(asOptionalString(headingMatch?.[1] ?? null));
}

function extractTitleFromHtmlTitle(html: string): string | null {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return cleanTitle(asOptionalString(titleMatch?.[1] ?? null));
}

function extractSkuFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname || "";
    const match = pathname.match(URL_SKU_SUFFIX_REGEX);
    return asOptionalString(match?.[1] ?? null)?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

function extractSkuFromHtml(html: string): string | null {
  const text = htmlToText(html);
  const match = text.match(SKU_LABEL_REGEX);
  return asOptionalString(match?.[1] ?? null)?.toUpperCase() ?? null;
}

export function extractTempleAndWebsterSku(html: string, url: string): string | null {
  return extractSkuFromHtml(html) ?? extractSkuFromUrl(url);
}

export function isLikelyTempleAndWebsterProductPath(pathname: string): boolean {
  const normalizedPath = pathname.trim().toLowerCase();
  if (!normalizedPath || !normalizedPath.endsWith(".html")) return false;
  if (NON_PRODUCT_PATH_SEGMENTS.some((segment) => normalizedPath.includes(segment))) return false;
  return URL_SKU_SUFFIX_REGEX.test(pathname);
}

function isTempleAndWebsterHost(host: string): boolean {
  const normalized = normalizeHost(host);
  return normalized === TEMPLE_AND_WEBSTER_DOMAIN;
}

function doesMatchTempleAndWebsterProduct(ctx: DomainAdapterMatchContext): boolean {
  if (!isTempleAndWebsterHost(ctx.normalizedHost)) return false;
  if (!ctx.sourceUrl) return true;
  const safeSourceUrl = asHttpUrl(ctx.sourceUrl);
  if (!safeSourceUrl) return false;
  try {
    const parsed = new URL(safeSourceUrl);
    if (!isTempleAndWebsterHost(parsed.hostname)) return false;
    return isLikelyTempleAndWebsterProductPath(parsed.pathname || "");
  } catch {
    return false;
  }
}

type ImageCandidate = {
  url: string;
  label: string | null;
};

function collectImageCandidates(html: string, baseUrl: string): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const imgTagRegex = /<img\b[^>]*>/gi;
  let tagMatch: RegExpExecArray | null = null;

  while ((tagMatch = imgTagRegex.exec(html))) {
    const tag = tagMatch[0];
    const srcMatch = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const srcsetMatch = tag.match(/\bsrcset\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const dataSrcMatch = tag.match(/\bdata-src\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i);
    const rawSrc =
      asOptionalString(srcMatch?.[2] ?? srcMatch?.[3] ?? srcMatch?.[4] ?? null) ??
      asOptionalString(dataSrcMatch?.[2] ?? dataSrcMatch?.[3] ?? dataSrcMatch?.[4] ?? null) ??
      null;
    const label = asOptionalString(
      collapseWhitespace(decodeHtmlEntities(getTagAttribute(tag, "alt") ?? getTagAttribute(tag, "title") ?? ""))
    );
    const src = asHttpUrl(rawSrc, baseUrl);
    if (src) candidates.push({ url: src, label });

    const rawSrcset = asOptionalString(srcsetMatch?.[2] ?? srcsetMatch?.[3] ?? srcsetMatch?.[4] ?? null);
    if (rawSrcset) {
      for (const entry of rawSrcset.split(",")) {
        const candidatePart = asOptionalString(entry.split(/\s+/)[0] ?? null);
        const candidateUrl = asHttpUrl(candidatePart, baseUrl);
        if (candidateUrl) candidates.push({ url: candidateUrl, label });
      }
    }
  }

  return candidates;
}

function selectBestImageUrl(html: string, resolvedUrl: string, title: string | null, sku: string | null): string | null {
  const titleTokens = (title ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
  const titleRegex =
    titleTokens.length > 1 ? new RegExp(titleTokens.map((token) => escapeRegExp(token)).join(".*"), "i") : null;

  const dedupedByUrl = new Map<string, ImageCandidate>();
  for (const candidate of collectImageCandidates(html, resolvedUrl)) {
    if (!dedupedByUrl.has(candidate.url)) dedupedByUrl.set(candidate.url, candidate);
  }
  const uniqueCandidates = Array.from(dedupedByUrl.values());
  let best: { url: string; score: number } | null = null;
  for (const candidate of uniqueCandidates) {
    const normalized = candidate.url.toLowerCase();
    const normalizedLabel = (candidate.label ?? "").toLowerCase();
    if (NOISE_IMAGE_MARKERS.some((marker) => normalized.includes(marker))) continue;
    if (NOISE_IMAGE_MARKERS.some((marker) => normalizedLabel.includes(marker))) continue;

    let score = 0;
    if (normalized.startsWith("https://")) score += 10;
    if (normalized.includes(TEMPLE_AND_WEBSTER_DOMAIN)) score += 20;
    if (sku && normalized.includes(sku.toLowerCase())) score += 20;
    if (titleRegex && titleRegex.test(normalized)) score += 25;
    if (titleRegex && titleRegex.test(normalizedLabel)) score += 35;
    if (/\.(?:avif|jpe?g|png|webp)(?:$|\?)/i.test(candidate.url)) score += 5;
    if (/(\/products?\/|\/media\/|\/images?\/)/i.test(candidate.url)) score += 5;

    if (!best || score > best.score) {
      best = { url: candidate.url, score };
    }
  }

  return best?.url ?? null;
}

function extractTempleAndWebsterPrice(html: string): { rawPriceText: string; normalizedPriceText: string } | null {
  const text = htmlToText(html);
  const priceRegex = /\$ ?([0-9][0-9,]*(?:\.[0-9]{2})?)/g;
  let match: RegExpExecArray | null = null;
  while ((match = priceRegex.exec(text))) {
    const fullMatch = asOptionalString(match[0]);
    const amount = asOptionalString(match[1]);
    if (!fullMatch || !amount) continue;
    const start = Math.max(0, match.index - 40);
    const end = Math.min(text.length, priceRegex.lastIndex + 40);
    const context = text.slice(start, end);
    if (INSTALLMENT_PRICE_MARKERS.test(context)) continue;

    const numericAmount = Number(amount.replace(/,/g, ""));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) continue;
    if (numericAmount < 50) continue;

    return {
      rawPriceText: fullMatch,
      normalizedPriceText: `AUD ${String(numericAmount)}`,
    };
  }
  return null;
}

function isLikelyProductUrl(urlString: string): boolean {
  const safeUrl = asHttpUrl(urlString);
  if (!safeUrl) return false;
  try {
    const parsed = new URL(safeUrl);
    if (!isTempleAndWebsterHost(parsed.hostname)) return false;
    return isLikelyTempleAndWebsterProductPath(parsed.pathname || "");
  } catch {
    return false;
  }
}

async function extractTempleAndWebsterMetadata(
  ctx: DomainAdapterExtractContext
): Promise<DomainAdapterExtractResult> {
  if (!isLikelyProductUrl(ctx.resolvedUrl)) return {};

  const detectedSku = extractTempleAndWebsterSku(ctx.html, ctx.resolvedUrl);
  const title = extractTitleFromHeading(ctx.html) ?? extractTitleFromHtmlTitle(ctx.html);
  const previewImageUrl = selectBestImageUrl(ctx.html, ctx.resolvedUrl, title ?? ctx.current.title, detectedSku);
  const price = ctx.includePrice ? extractTempleAndWebsterPrice(ctx.html) : null;

  return {
    title: title ?? undefined,
    previewImageUrl: previewImageUrl ?? undefined,
    priceRawText: price?.rawPriceText ?? undefined,
    priceNormalizedText: price?.normalizedPriceText ?? undefined,
    priceSource: price ? "adapter_templeandwebster_visible_html" : undefined,
  };
}

export const templeAndWebsterAdapter: DomainAdapter = {
  id: "templeandwebster",
  domains: [TEMPLE_AND_WEBSTER_DOMAIN],
  matches: doesMatchTempleAndWebsterProduct,
  extract: extractTempleAndWebsterMetadata,
};
