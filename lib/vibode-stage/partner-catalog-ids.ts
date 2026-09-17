/**
 * Shared Partner commercial identity helpers.
 *
 * Lifted from certified PI-5F namespace rules so G4a can derive Variant
 * IDs without duplicating parser/planner semantics or using migration
 * filename slug helpers.
 */

export const STAGE_PARTNER_SLUG_SHAPE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function partnerIdForSlug(slug: string): string {
  return `partner-${slug}`;
}

export function isPartnerSlug(value: string): boolean {
  return STAGE_PARTNER_SLUG_SHAPE.test(value);
}

export function namespacedId(kind: "prod" | "var" | "col", partnerSlug: string, rest: string): string {
  return `${kind}-${partnerSlug}-${rest}`;
}

export function partnerSlugFromPartnerId(partnerId: string): string | null {
  const prefix = "partner-";
  if (!partnerId.startsWith(prefix)) return null;
  const slug = partnerId.slice(prefix.length);
  return slug.length > 0 && isPartnerSlug(slug) ? slug : null;
}

export function productSlugFor(partnerSlug: string, productId: string): string | null {
  const prefix = `prod-${partnerSlug}-`;
  if (!productId.startsWith(prefix)) return null;
  const slug = productId.slice(prefix.length);
  return slug.length > 0 ? slug : null;
}

export function commercialSlugFromLabel(value: string | null | undefined): string | null {
  if (value == null) return null;
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 && isPartnerSlug(slug) ? slug : null;
}

export function variantCreationSlugFor(input: Readonly<{
  finishLabel: string | null;
  creationSlug?: string | null;
}>): string | null {
  const explicit = input.creationSlug != null && input.creationSlug.trim().length > 0
    ? commercialSlugFromLabel(input.creationSlug)
    : null;
  if (input.creationSlug != null && input.creationSlug.trim().length > 0) {
    return explicit;
  }
  return commercialSlugFromLabel(input.finishLabel);
}

export function productCreationSlugFor(input: Readonly<{
  name: string;
  creationSlug?: string | null;
}>): string | null {
  const explicit = input.creationSlug != null && input.creationSlug.trim().length > 0
    ? commercialSlugFromLabel(input.creationSlug)
    : null;
  if (input.creationSlug != null && input.creationSlug.trim().length > 0) {
    return explicit;
  }
  return commercialSlugFromLabel(input.name);
}

export function productIdForCreate(partnerSlug: string, productSlug: string): string {
  return namespacedId("prod", partnerSlug, productSlug);
}

export function variantIdForCreate(
  partnerSlug: string,
  productSlug: string,
  variantSlug: string,
): string {
  return namespacedId("var", partnerSlug, `${productSlug}-${variantSlug}`);
}
