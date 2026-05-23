import { NextRequest } from "next/server";

export const runtime = "nodejs";

const PREVIEW_ROUTE = "/api/vibode/product-url/preview";
const PRODUCT_PAGE_FETCH_TIMEOUT_MS = 6000;
const PRODUCT_PAGE_MAX_HTML_CHARS = 750_000;
const PRODUCT_PAGE_SUBSTANTIAL_HTML_CHARS = 2_000;

const METADATA_FETCH_PROFILES: Array<{ id: string; headers: Record<string, string> }> = [
  {
    id: "browser_like",
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
  },
  {
    id: "legacy_roomprintzbot",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RoomprintzBot/1.0; +https://roomprintz.com)",
      Accept: "text/html,application/xhtml+xml",
    },
  },
];

const TRACKING_QUERY_PARAM_PREFIXES = ["utm_", "mtm_", "pk_"];
const TRACKING_QUERY_PARAM_KEYS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "igshid",
  "srsltid",
  "ref",
  "ref_",
  "refid",
  "source",
  "sourceid",
  "campaign",
  "campaignid",
]);

type ProductPageMetadata = {
  title: string | null;
  previewImageUrl: string | null;
  fetchOk: boolean;
  resolvedUrl: string | null;
};

function createRequestId(): string {
  try {
    return `vibode-preview-${crypto.randomUUID()}`;
  } catch {
    return `vibode-preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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

function normalizeLikelyUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const prefixed = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const safeUrl = asHttpUrl(prefixed);
  if (!safeUrl) return null;
  try {
    const parsed = new URL(safeUrl);
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripTrackingParams(urlString: string): string {
  const parsed = new URL(urlString);
  parsed.hash = "";
  const keys = Array.from(parsed.searchParams.keys());
  for (const key of keys) {
    const normalizedKey = key.trim().toLowerCase();
    if (
      TRACKING_QUERY_PARAM_KEYS.has(normalizedKey) ||
      TRACKING_QUERY_PARAM_PREFIXES.some((prefix) => normalizedKey.startsWith(prefix))
    ) {
      parsed.searchParams.delete(key);
    }
  }
  return parsed.toString();
}

function getMetadataFetchUrlCandidates(sourceUrl: string): string[] {
  const safeSourceUrl = asHttpUrl(sourceUrl);
  if (!safeSourceUrl) return [];
  const candidates = [safeSourceUrl];
  try {
    const cleanedUrl = stripTrackingParams(safeSourceUrl);
    if (cleanedUrl !== safeSourceUrl) candidates.push(cleanedUrl);
  } catch {
    // Keep original URL as sole candidate.
  }
  return candidates;
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

function getMetaContent(
  html: string,
  checks: Array<{ key: "property" | "name" | "itemprop"; value: string }>
): string | null {
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

function logPreviewEvent(
  level: "info" | "warn" | "error",
  event: string,
  requestId: string,
  fields: Record<string, unknown> = {}
): void {
  const payload: Record<string, unknown> = {
    event,
    request_id: requestId,
    route: PREVIEW_ROUTE,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) payload[key] = value;
  }
  const message = `[vibode/product-url/preview] ${JSON.stringify(payload)}`;
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

async function fetchProductPageMetadata(sourceUrl: string, requestId: string): Promise<ProductPageMetadata> {
  const fetchCandidates = getMetadataFetchUrlCandidates(sourceUrl);
  if (fetchCandidates.length === 0) {
    logPreviewEvent("warn", "metadata_invalid_url", requestId, {
      source_url: sourceUrl,
    });
    return {
      title: null,
      previewImageUrl: null,
      fetchOk: false,
      resolvedUrl: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PRODUCT_PAGE_FETCH_TIMEOUT_MS);
  try {
    for (let attemptIndex = 0; attemptIndex < fetchCandidates.length; attemptIndex += 1) {
      const fetchUrl = fetchCandidates[attemptIndex];
      for (const profile of METADATA_FETCH_PROFILES) {
        const response = await fetch(fetchUrl, {
          method: "GET",
          redirect: "follow",
          signal: controller.signal,
          headers: profile.headers,
          cache: "no-store",
        });
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        const resolvedUrl = asOptionalString(response.url) ?? fetchUrl;
        logPreviewEvent("info", "metadata_fetch_response", requestId, {
          fetch_attempt_index: attemptIndex,
          fetch_attempt_count: fetchCandidates.length,
          fetch_profile: profile.id,
          fetch_input_url: fetchUrl,
          fetch_status: response.status,
          fetch_ok: response.ok,
          fetch_content_type: contentType,
          fetch_resolved_url: resolvedUrl,
        });
        if (!response.ok || !contentType.includes("text/html")) continue;

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
        const previewImageUrl = asHttpUrl(previewImageCandidate, resolvedUrl);
        logPreviewEvent("info", "metadata_fetch_extracted", requestId, {
          html_length: html.length,
          html_substantial: html.length >= PRODUCT_PAGE_SUBSTANTIAL_HTML_CHARS,
          has_title: Boolean(title),
          has_preview_image: Boolean(previewImageUrl),
          fetch_profile: profile.id,
        });
        return {
          title,
          previewImageUrl,
          fetchOk: true,
          resolvedUrl,
        };
      }
    }
    return {
      title: null,
      previewImageUrl: null,
      fetchOk: false,
      resolvedUrl: null,
    };
  } catch {
    logPreviewEvent("warn", "metadata_fetch_exception", requestId, {
      source_url: fetchCandidates[0] ?? sourceUrl,
    });
    return {
      title: null,
      previewImageUrl: null,
      fetchOk: false,
      resolvedUrl: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  const requestId = createRequestId();
  try {
    const body = (await req.json().catch(() => null)) as { sourceUrl?: unknown } | null;
    const sourceUrlRaw = asOptionalString(body?.sourceUrl);
    if (!sourceUrlRaw) {
      return Response.json(
        {
          ok: false,
          code: "product_url_blocked_or_unreadable",
          error: "We couldn't prepare that product link. Try copying the product image instead.",
          requestId,
        },
        { status: 422 }
      );
    }
    const normalizedUrl = normalizeLikelyUrl(sourceUrlRaw);
    if (!normalizedUrl) {
      return Response.json(
        {
          ok: false,
          code: "product_url_blocked_or_unreadable",
          error: "We couldn't prepare that product link. Try copying the product image instead.",
          requestId,
        },
        { status: 422 }
      );
    }

    const metadata = await fetchProductPageMetadata(normalizedUrl, requestId);
    if (!metadata.fetchOk || !metadata.previewImageUrl) {
      logPreviewEvent("warn", "preview_unavailable", requestId, {
        normalized_url: normalizedUrl,
        metadata_fetch_ok: metadata.fetchOk,
        has_preview_image: Boolean(metadata.previewImageUrl),
      });
      return Response.json(
        {
          ok: false,
          code: "product_url_blocked_or_unreadable",
          error: "We couldn't prepare that product link. Try copying the product image instead.",
          requestId,
        },
        { status: 422 }
      );
    }

    const domain = (() => {
      try {
        return new URL(metadata.resolvedUrl ?? normalizedUrl).hostname || null;
      } catch {
        return null;
      }
    })();

    logPreviewEvent("info", "preview_ready", requestId, {
      normalized_url: normalizedUrl,
      resolved_url: metadata.resolvedUrl,
      domain,
      has_title: Boolean(metadata.title),
      has_preview_image: Boolean(metadata.previewImageUrl),
    });
    return Response.json({
      ok: true,
      normalizedUrl,
      title: metadata.title,
      previewImageUrl: metadata.previewImageUrl,
      domain,
      requestId,
    });
  } catch (err: unknown) {
    logPreviewEvent("error", "failed", requestId, {
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json(
      {
        ok: false,
        code: "product_url_blocked_or_unreadable",
        error: "We couldn't prepare that product link. Try copying the product image instead.",
        requestId,
      },
      { status: 422 }
    );
  }
}
