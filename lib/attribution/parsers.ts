export type PriceSourceType = "retail" | "used" | "unknown";
export type PriceConfidence = "high" | "medium" | "low" | "none";

export type ParsedPrice = {
  amount: number | null;
  currency: string | null;
  confidence: PriceConfidence;
};

export type ParsedDimensions = {
  width: number | null;
  depth: number | null;
  height: number | null;
  unit: string | null;
};

function normalizeUnit(rawUnit: string | null): string | null {
  if (!rawUnit) return null;
  const normalized = rawUnit.toLowerCase();
  if (normalized === "inch" || normalized === "inches" || normalized === "in") return "in";
  if (normalized === "centimeter" || normalized === "centimeters" || normalized === "cm") return "cm";
  if (normalized === "millimeter" || normalized === "millimeters" || normalized === "mm") return "mm";
  if (normalized === "meter" || normalized === "meters" || normalized === "m") return "m";
  if (normalized === "foot" || normalized === "feet" || normalized === "ft") return "ft";
  return normalized;
}

export function extractDomain(url?: string | null): string | null {
  try {
    if (!url) return null;
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

export function detectSourceType(domain: string | null): PriceSourceType {
  if (!domain) return "unknown";
  if (domain.includes("facebook.com") || domain.includes("craigslist.org") || domain.includes("kijiji.ca")) {
    return "used";
  }
  if (domain.includes("wayfair") || domain.includes("ikea") || domain.includes("amazon") || domain.includes("article")) {
    return "retail";
  }
  return "unknown";
}

export function parsePrice(text?: string | null): ParsedPrice {
  if (!text) return { amount: null, currency: null, confidence: "none" };

  const cleaned = text.replace(/,/g, "");
  const match = cleaned.match(/(CA\$|C\$|US\$|USD|CAD|\$)?\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (!match) return { amount: null, currency: null, confidence: "low" };

  const amount = Number.parseFloat(match[2]);
  if (!Number.isFinite(amount)) return { amount: null, currency: null, confidence: "low" };

  const symbol = match[1]?.toUpperCase() ?? null;
  let currency: string | null = null;
  if (symbol === "CA$" || symbol === "C$" || symbol === "CAD") currency = "CAD";
  else if (symbol === "US$" || symbol === "USD") currency = "USD";

  return {
    amount,
    currency,
    confidence: currency ? "medium" : "low",
  };
}

export function parseDimensions(text?: string | null): ParsedDimensions {
  if (!text) return { width: null, depth: null, height: null, unit: null };

  const cleaned = text
    .replace(/[x×]/gi, " x ")
    .replace(/\bby\b/gi, " x ")
    .replace(/\s+/g, " ")
    .trim();

  const values = [...cleaned.matchAll(/([0-9]+(?:\.[0-9]+)?)/g)]
    .map((match) => Number.parseFloat(match[1]))
    .filter((value) => Number.isFinite(value));
  // NOTE: Best-effort positional parsing (W, D, H).
  // Order may be incorrect depending on input format.
  // Safe for Phase 3; can be improved later.
  const width = values.length > 0 ? values[0] : null;
  const depth = values.length > 1 ? values[1] : null;
  const height = values.length > 2 ? values[2] : null;

  const unitMatch = cleaned.match(/\b(inches?|inch|in|cm|centimeters?|mm|millimeters?|meters?|meter|m|feet|foot|ft)\b/i);
  const unit = normalizeUnit(unitMatch?.[1] ?? null);

  return { width, depth, height, unit };
}
