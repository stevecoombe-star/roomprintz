import { collapseWhitespace, decodeHtmlEntities, getMetaContent } from "@/lib/productUrlMetadata/html";

type UnknownRecord = Record<string, unknown>;

type ExtractedPriceCandidate = {
  source: string;
  rawPriceText: string;
  normalizedPriceText: string | null;
};

export type PriceExtractionDiagnostics = {
  jsonLdBlockCount: number;
  jsonLdCandidateFound: boolean;
  metaTagCandidateFound: boolean;
  scriptEmbeddedCandidateFound: boolean;
  visibleHtmlCandidateFound: boolean;
  selectedPriceSource: string | null;
};

export type PriceExtractionResult = {
  candidate: ExtractedPriceCandidate | null;
  diagnostics: PriceExtractionDiagnostics;
};

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

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

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

      const candidate = createPriceCandidate("script_embedded", effectivePriceText, currency, rawPriceText);
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

  const priceWithCurrency = compactText.match(/(CA\$|C\$|US\$|USD|CAD|\$)\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i);
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

export function extractPriceCandidateFromHtml(html: string): PriceExtractionResult {
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
