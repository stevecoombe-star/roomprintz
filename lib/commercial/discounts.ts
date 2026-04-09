type DiscountAwareFurnitureItem = {
  discountIsExclusive?: boolean | null;
  discount_is_exclusive?: boolean | null;
  discountPercent?: number | null;
  discount_percent?: number | null;
  discountLabel?: string | null;
  discount_label?: string | null;
  overridePriceAmount?: number | null;
  override_price_amount?: number | null;
  parsedPriceAmount?: number | null;
  parsed_price_amount?: number | null;
  overridePriceCurrency?: string | null;
  override_price_currency?: string | null;
  parsedPriceCurrency?: string | null;
  parsed_price_currency?: string | null;
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

function formatCurrencyAmount(currency: string | null, amount: number): string {
  const rounded = amount.toFixed(2);
  if (!currency) return rounded;
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) return `${currency} ${rounded}`;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${normalizedCurrency} ${rounded}`;
  }
}

function getDiscountPercent(item: DiscountAwareFurnitureItem | null | undefined): number | null {
  if (!item) return null;
  const value = asOptionalNumber(item.discountPercent ?? item.discount_percent);
  if (value === null || value <= 0) return null;
  return value;
}

export function hasExclusiveDiscount(item: DiscountAwareFurnitureItem | null | undefined): boolean {
  if (!item) return false;
  return asBoolean(item.discountIsExclusive ?? item.discount_is_exclusive) && getDiscountPercent(item) !== null;
}

export function getDiscountLabel(item: DiscountAwareFurnitureItem | null | undefined): string | null {
  if (!hasExclusiveDiscount(item)) return null;
  return asOptionalString(item?.discountLabel ?? item?.discount_label) ?? "Exclusive Vibode Discount";
}

export function getDiscountedPriceText(item: DiscountAwareFurnitureItem | null | undefined): string | null {
  if (!hasExclusiveDiscount(item)) return null;
  const discountPercent = getDiscountPercent(item);
  if (discountPercent === null) return null;

  const amount = asOptionalNumber(item?.overridePriceAmount ?? item?.override_price_amount);
  const fallbackAmount = asOptionalNumber(item?.parsedPriceAmount ?? item?.parsed_price_amount);
  const baseAmount = amount ?? fallbackAmount;
  if (baseAmount === null || baseAmount <= 0) return null;

  const normalizedPercent = Math.min(Math.max(discountPercent, 0), 100);
  const discountedAmount = baseAmount * (1 - normalizedPercent / 100);
  if (!Number.isFinite(discountedAmount) || discountedAmount < 0) return null;

  const currency =
    asOptionalString(item?.overridePriceCurrency ?? item?.override_price_currency) ??
    asOptionalString(item?.parsedPriceCurrency ?? item?.parsed_price_currency);
  return formatCurrencyAmount(currency, discountedAmount);
}
