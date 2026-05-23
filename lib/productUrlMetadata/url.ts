import { TRACKING_QUERY_PARAM_KEYS, TRACKING_QUERY_PARAM_PREFIXES } from "@/lib/productUrlMetadata/constants";

export function asHttpUrl(value: string | null, baseUrl?: string): string | null {
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

export function normalizeLikelyUrl(raw: string): string | null {
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

export function stripTrackingParams(urlString: string): string {
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

export function getMetadataFetchUrlCandidates(sourceUrl: string): string[] {
  const safeSourceUrl = asHttpUrl(sourceUrl);
  if (!safeSourceUrl) return [];
  const candidates = [safeSourceUrl];
  try {
    const cleanedUrl = stripTrackingParams(safeSourceUrl);
    if (cleanedUrl !== safeSourceUrl) candidates.push(cleanedUrl);
  } catch {
    // Best-effort cleaning; keep original URL as the only candidate.
  }
  return candidates;
}

export function normalizeHost(host: string): string {
  const lower = host.trim().toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

export function resolveDomainFromUrl(urlString: string | null): string | null {
  if (!urlString) return null;
  try {
    const parsed = new URL(urlString);
    return parsed.hostname || null;
  } catch {
    return null;
  }
}
