import { extractDomain } from "@/lib/attribution/parsers";

type PartnerRecord = {
  id: string;
  name: string;
  slug?: string | null;
  domain?: string | null;
  is_active?: boolean | null;
  isActive?: boolean | null;
};

type PartnerResolvableItem = {
  parsedSourceDomain?: string | null;
  parsed_source_domain?: string | null;
  sourceUrl?: string | null;
  source_url?: string | null;
  parsedSupplierName?: string | null;
  parsed_supplier_name?: string | null;
};

function asOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePartnerSlug(input: string | null | undefined): string | null {
  const normalized = asOptionalString(input)?.toLowerCase() ?? null;
  if (!normalized) return null;
  const slug = normalized
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug.length > 0 ? slug : null;
}

export function partnerSlugFromDomain(domain: string | null | undefined): string | null {
  const normalizedDomain = asOptionalString(domain)?.toLowerCase() ?? null;
  if (!normalizedDomain) return null;
  const withoutWww = normalizedDomain.replace(/^www\./i, "");
  const labels = withoutWww.split(".").filter(Boolean);
  if (labels.length === 0) return null;
  const primary = labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  return normalizePartnerSlug(primary);
}

export function matchPartnerByDomain(
  domain: string | null | undefined,
  partners: PartnerRecord[]
): PartnerRecord | null {
  const normalizedDomain = asOptionalString(domain)?.toLowerCase() ?? null;
  if (!normalizedDomain) return null;
  return (
    partners.find((partner) => {
      const partnerDomain = asOptionalString(partner.domain)?.toLowerCase();
      if (!partnerDomain) return false;
      return normalizedDomain === partnerDomain || normalizedDomain.endsWith(`.${partnerDomain}`);
    }) ?? null
  );
}

export function matchPartnerBySupplierName(
  name: string | null | undefined,
  partners: PartnerRecord[]
): PartnerRecord | null {
  const normalizedName = normalizePartnerSlug(name ?? null);
  if (!normalizedName) return null;

  return (
    partners.find((partner) => {
      const partnerSlug = normalizePartnerSlug(partner.slug ?? null);
      if (partnerSlug && partnerSlug === normalizedName) return true;
      const nameSlug = normalizePartnerSlug(partner.name);
      return Boolean(nameSlug && nameSlug === normalizedName);
    }) ?? null
  );
}

export function resolvePartnerForFurnitureItem(
  item: PartnerResolvableItem,
  partners: PartnerRecord[]
): PartnerRecord | null {
  const parsedSourceDomain = asOptionalString(item.parsedSourceDomain ?? item.parsed_source_domain);
  const sourceUrl = asOptionalString(item.sourceUrl ?? item.source_url);
  const domain = parsedSourceDomain ?? extractDomain(sourceUrl);
  const byDomain = matchPartnerByDomain(domain, partners);
  if (byDomain) return byDomain;

  const parsedSupplierName = asOptionalString(item.parsedSupplierName ?? item.parsed_supplier_name);
  return matchPartnerBySupplierName(parsedSupplierName, partners);
}
