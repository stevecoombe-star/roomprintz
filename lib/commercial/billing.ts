import { resolveFurnitureOutboundUrl } from "@/lib/commercial/affiliate";

type CommercialEventType = "added" | "swapped" | "outbound_clicked";

type CommercialAwareFurnitureItem = {
  partnerId?: string | null;
  partner_id?: string | null;
  discountUrl?: string | null;
  discount_url?: string | null;
  discountIsExclusive?: boolean | null;
  discount_is_exclusive?: boolean | null;
  affiliateUrl?: string | null;
  affiliate_url?: string | null;
  sourceUrl?: string | null;
  source_url?: string | null;
};

type BillablePartner = {
  defaultCommissionValue?: number | null;
  default_commission_value?: number | null;
};

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

export function buildCommercialEventMetadata(args: {
  item: CommercialAwareFurnitureItem;
  eventType: CommercialEventType;
}): {
  partnerId: string | null;
  commercialType: string | null;
  billableEventType: string | null;
  billableUnits: number | null;
  billableAmount: number | null;
  affiliateUrlUsed: string | null;
  discountApplied: boolean;
} {
  const partnerId = asOptionalString(args.item.partnerId ?? args.item.partner_id);
  const affiliateUrlUsed = resolveFurnitureOutboundUrl(args.item);
  const discountApplied = Boolean(
    asOptionalString(args.item.discountUrl ?? args.item.discount_url) ||
      asBoolean(args.item.discountIsExclusive ?? args.item.discount_is_exclusive)
  );

  if (args.eventType === "outbound_clicked") {
    return {
      partnerId,
      commercialType: "affiliate_click",
      billableEventType: "affiliate_click",
      billableUnits: 1,
      billableAmount: null,
      affiliateUrlUsed,
      discountApplied,
    };
  }

  return {
    partnerId,
    commercialType: "sku_engagement",
    billableEventType: "cpse",
    billableUnits: 1,
    billableAmount: null,
    affiliateUrlUsed: null,
    discountApplied: false,
  };
}

export function estimateBillableAmount(args: {
  commercialType: string | null;
  partner?: BillablePartner | null;
  eventType: CommercialEventType;
}): number | null {
  if (args.eventType !== "outbound_clicked" && args.commercialType !== "sku_engagement") return null;
  const rawValue = asOptionalNumber(
    args.partner?.defaultCommissionValue ?? args.partner?.default_commission_value
  );
  if (rawValue === null || rawValue < 0) return null;
  return rawValue;
}
