import {
  PRODUCT_PAGE_MAX_HTML_CHARS,
  PRODUCT_PAGE_SUBSTANTIAL_HTML_CHARS,
} from "@/lib/productUrlMetadata/constants";
import { resolveDomainAdaptersForHost } from "@/lib/productUrlMetadata/adapters/registry";
import type { ProductMetadataResultCandidate } from "@/lib/productUrlMetadata/adapters/types";
import { extractGenericMetadata } from "@/lib/productUrlMetadata/extractors/generic";
import { extractPriceCandidateFromHtml } from "@/lib/productUrlMetadata/extractors/price";
import { fetchProductPageHtml } from "@/lib/productUrlMetadata/fetch";
import type {
  ProductUrlMetadataResolveArgs,
  ProductUrlMetadataResult,
} from "@/lib/productUrlMetadata/types";
import {
  getMetadataFetchUrlCandidates,
  normalizeLikelyUrl,
  resolveDomainFromUrl,
} from "@/lib/productUrlMetadata/url";

function emptyResult(sourceUrl: string): ProductUrlMetadataResult {
  const normalizedSourceUrl = normalizeLikelyUrl(sourceUrl);
  const finalDomain = resolveDomainFromUrl(normalizedSourceUrl);
  return {
    normalizedSourceUrl,
    resolvedUrl: null,
    finalDomain,
    title: null,
    previewImageUrl: null,
    priceRawText: null,
    priceNormalizedText: null,
    priceSource: null,
    fetchOk: false,
    blockedReason: normalizedSourceUrl ? "fetch_failed" : "invalid_url",
    diagnostics: {
      attempts: [],
      htmlLength: null,
      htmlSubstantial: null,
      jsonLdBlockCount: 0,
      jsonLdCandidateFound: false,
      metaTagCandidateFound: false,
      scriptEmbeddedCandidateFound: false,
      visibleHtmlCandidateFound: false,
      selectedPriceSource: null,
      selectedAdapterId: null,
    },
  };
}

export async function resolveProductUrlMetadata(
  args: ProductUrlMetadataResolveArgs
): Promise<ProductUrlMetadataResult> {
  args.logEvent?.("info", "resolver_started", {
    mode: args.mode,
    request_id: args.requestId,
  });
  const normalizedSourceUrl = normalizeLikelyUrl(args.sourceUrl);
  if (!normalizedSourceUrl) {
    args.logEvent?.("warn", "resolver_invalid_url", {
      mode: args.mode,
      request_id: args.requestId,
    });
    return emptyResult(args.sourceUrl);
  }

  const fetchCandidates = getMetadataFetchUrlCandidates(normalizedSourceUrl);
  const fetchResult = await fetchProductPageHtml(fetchCandidates, PRODUCT_PAGE_MAX_HTML_CHARS);

  if (!fetchResult.ok || !fetchResult.success) {
    args.logEvent?.("warn", "resolver_fetch_unavailable", {
      mode: args.mode,
      request_id: args.requestId,
      blocked_reason: fetchResult.blockedReason,
    });
    return {
      ...emptyResult(normalizedSourceUrl),
      normalizedSourceUrl,
      blockedReason: fetchResult.blockedReason ?? "fetch_failed",
      diagnostics: {
        ...emptyResult(normalizedSourceUrl).diagnostics,
        attempts: fetchResult.attempts,
      },
    };
  }

  const { html, resolvedUrl } = fetchResult.success;
  const generic = extractGenericMetadata(html, resolvedUrl);
  const extractedPrice = args.includePrice ? extractPriceCandidateFromHtml(html) : null;

  let selectedAdapterId: string | null = null;
  let current: ProductMetadataResultCandidate = {
    title: generic.title,
    previewImageUrl: generic.previewImageUrl,
    priceRawText: extractedPrice?.candidate?.rawPriceText ?? null,
    priceNormalizedText: extractedPrice?.candidate?.normalizedPriceText ?? null,
    priceSource: extractedPrice?.candidate?.source ?? null,
  };

  const resolvedDomain = resolveDomainFromUrl(resolvedUrl);
  const adapters = resolveDomainAdaptersForHost(resolvedDomain, normalizedSourceUrl);
  for (const adapter of adapters) {
    if (!adapter.extract) continue;
    const output = await adapter.extract({
      sourceUrl: normalizedSourceUrl,
      resolvedUrl,
      html,
      current,
      includePrice: args.includePrice,
    });
    if (!output) continue;
    // Adapter output is intentionally conservative in Step 1: only fill missing fields.
    current = {
      title: current.title ?? output.title ?? null,
      previewImageUrl: current.previewImageUrl ?? output.previewImageUrl ?? null,
      priceRawText: current.priceRawText ?? output.priceRawText ?? null,
      priceNormalizedText: current.priceNormalizedText ?? output.priceNormalizedText ?? null,
      priceSource: current.priceSource ?? output.priceSource ?? null,
    };
    if (
      output.title !== undefined ||
      output.previewImageUrl !== undefined ||
      output.priceRawText !== undefined ||
      output.priceNormalizedText !== undefined ||
      output.priceSource !== undefined
    ) {
      selectedAdapterId = adapter.id;
    }
  }

  args.logEvent?.("info", "resolver_completed", {
    mode: args.mode,
    request_id: args.requestId,
    fetch_ok: true,
    selected_adapter_id: selectedAdapterId,
  });
  return {
    normalizedSourceUrl,
    resolvedUrl,
    finalDomain: resolvedDomain,
    title: current.title,
    previewImageUrl: current.previewImageUrl,
    priceRawText: current.priceRawText,
    priceNormalizedText: current.priceNormalizedText,
    priceSource: current.priceSource,
    fetchOk: true,
    blockedReason: null,
    diagnostics: {
      attempts: fetchResult.attempts,
      htmlLength: html.length,
      htmlSubstantial: html.length >= PRODUCT_PAGE_SUBSTANTIAL_HTML_CHARS,
      jsonLdBlockCount: extractedPrice?.diagnostics.jsonLdBlockCount ?? 0,
      jsonLdCandidateFound: extractedPrice?.diagnostics.jsonLdCandidateFound ?? false,
      metaTagCandidateFound: extractedPrice?.diagnostics.metaTagCandidateFound ?? false,
      scriptEmbeddedCandidateFound: extractedPrice?.diagnostics.scriptEmbeddedCandidateFound ?? false,
      visibleHtmlCandidateFound: extractedPrice?.diagnostics.visibleHtmlCandidateFound ?? false,
      selectedPriceSource: extractedPrice?.diagnostics.selectedPriceSource ?? null,
      selectedAdapterId,
    },
  };
}
