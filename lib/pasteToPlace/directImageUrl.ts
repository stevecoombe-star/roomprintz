const DIRECT_IMAGE_EXT_RE = /\.(?:avif|jpe?g|png|webp)$/i;

function normalizeLikelyUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const prefixed = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(prefixed);
    if (!parsed.hostname) return null;
    const protocol = parsed.protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isLikelyDirectImageUrl(url: string): boolean {
  const normalized = normalizeLikelyUrl(url);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    const pathname = decodeURIComponent(parsed.pathname || "").toLowerCase();
    return DIRECT_IMAGE_EXT_RE.test(pathname);
  } catch {
    return false;
  }
}

export function classifyPasteToPlaceUrl(url: string): {
  kind: "direct_image_url" | "product_page_url";
  normalizedUrl: string;
} | null {
  const normalizedUrl = normalizeLikelyUrl(url);
  if (!normalizedUrl) return null;
  if (isLikelyDirectImageUrl(normalizedUrl)) {
    return {
      kind: "direct_image_url",
      normalizedUrl,
    };
  }
  return {
    kind: "product_page_url",
    normalizedUrl,
  };
}
