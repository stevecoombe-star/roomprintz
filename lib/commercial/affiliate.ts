type OutboundResolvableFurnitureItem = {
  discountUrl?: string | null;
  discount_url?: string | null;
  affiliateUrl?: string | null;
  affiliate_url?: string | null;
  sourceUrl?: string | null;
  source_url?: string | null;
};

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveFurnitureOutboundUrl(item: OutboundResolvableFurnitureItem | null | undefined): string | null {
  if (!item) return null;
  return (
    asOptionalString(item.discountUrl ?? item.discount_url) ??
    asOptionalString(item.affiliateUrl ?? item.affiliate_url) ??
    asOptionalString(item.sourceUrl ?? item.source_url) ??
    null
  );
}

export function shouldTrackAffiliateClick(
  item: OutboundResolvableFurnitureItem | null | undefined
): boolean {
  return Boolean(resolveFurnitureOutboundUrl(item));
}
