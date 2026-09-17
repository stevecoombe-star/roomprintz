/**
 * PI-5G2 merchant presentation of a persisted-draft preview DTO.
 * Does not call the planner or mutate catalog state.
 */

export type PartnerDraftPreviewIssue = Readonly<{
  code: string;
  message: string;
}>;

export type PartnerDraftPreviewChange = Readonly<{
  column: string;
  label: string;
  previous: string;
  next: string;
}>;

export type PartnerDraftPreviewView = Readonly<{
  ok: boolean;
  noOp: boolean;
  partnerId: string | null;
  issues: readonly PartnerDraftPreviewIssue[];
  productUpdates: readonly Readonly<{
    productId: string;
    changes: readonly PartnerDraftPreviewChange[];
  }>[];
  variantUpdates: readonly Readonly<{
    variantId: string;
    productId: string;
    changes: readonly PartnerDraftPreviewChange[];
  }>[];
  collectionUpdates: readonly Readonly<{
    collectionId: string;
    previous: string;
    next: string;
  }>[];
  membershipAdds: readonly Readonly<{ productId: string; collectionId: string }>[];
  membershipRemoves: readonly Readonly<{ productId: string; collectionId: string }>[];
  productDeactivations: readonly string[];
  productReactivations: readonly string[];
  variantDeactivations: readonly string[];
  variantReactivations: readonly string[];
}>;

const COLUMN_LABELS: Readonly<Record<string, string>> = Object.freeze({
  name: "Name",
  image_url: "Image URL",
  product_url: "Product URL",
  price_amount: "Price",
  price_currency: "Currency",
  finish_label: "Finish",
  sku: "SKU",
});

function displayValue(value: unknown): string {
  if (value == null || value === "") return "—";
  return String(value);
}

function columnLabel(column: string): string {
  return COLUMN_LABELS[column] ?? column.replace(/_/g, " ");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asChanges(value: unknown): PartnerDraftPreviewChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const column = asString(record.column);
    if (!column) return [];
    return [{
      column,
      label: columnLabel(column),
      previous: displayValue(record.previous),
      next: displayValue(record.next),
    }];
  });
}

function asIdentityList(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return asString(item) ? [item] : [];
    const record = asRecord(item);
    const id = record ? asString(record[key]) : null;
    return id ? [id] : [];
  });
}

function asMembership(value: unknown): Readonly<{ productId: string; collectionId: string }>[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    const productId = record ? asString(record.productId) : null;
    const collectionId = record ? asString(record.collectionId) : null;
    return productId && collectionId ? [{ productId, collectionId }] : [];
  });
}

export function presentPartnerDraftPreview(body: unknown): PartnerDraftPreviewView | Readonly<{ error: string }> {
  const record = asRecord(body);
  if (!record) return { error: "Preview request failed." };
  if (typeof record.error === "string" && record.error.trim() && record.ok !== true) {
    return { error: record.error };
  }
  if (typeof record.ok !== "boolean" || typeof record.noOp !== "boolean") {
    if (typeof record.error === "string" && record.error.trim()) return { error: record.error };
    return { error: "Preview request failed." };
  }
  const issues = Array.isArray(record.issues)
    ? record.issues.flatMap((item) => {
      const issue = asRecord(item);
      const code = issue ? asString(issue.code) : null;
      const message = issue ? asString(issue.message) : null;
      return code || message ? [{ code: code ?? "ISSUE", message: message ?? code ?? "Issue" }] : [];
    })
    : [];
  const productUpdates = Array.isArray(record.productUpdates)
    ? record.productUpdates.flatMap((item) => {
      const next = asRecord(item);
      const productId = next ? asString(next.productId) : null;
      if (!productId) return [];
      return [{ productId, changes: asChanges(next?.changes) }];
    })
    : [];
  const variantUpdates = Array.isArray(record.variantUpdates)
    ? record.variantUpdates.flatMap((item) => {
      const next = asRecord(item);
      const variantId = next ? asString(next.variantId) : null;
      const productId = next ? asString(next.productId) : "";
      if (!variantId) return [];
      return [{ variantId, productId: productId ?? "", changes: asChanges(next?.changes) }];
    })
    : [];
  const collectionUpdates = Array.isArray(record.collectionUpdates)
    ? record.collectionUpdates.flatMap((item) => {
      const next = asRecord(item);
      const collectionId = next ? asString(next.collectionId) : null;
      if (!next || !collectionId) return [];
      return [{
        collectionId,
        previous: displayValue(next.previousName),
        next: displayValue(next.name),
      }];
    })
    : [];
  return {
    ok: record.ok,
    noOp: record.noOp,
    partnerId: asString(record.partnerId),
    issues,
    productUpdates,
    variantUpdates,
    collectionUpdates,
    membershipAdds: asMembership(record.membershipAdds),
    membershipRemoves: asMembership(record.membershipRemoves),
    productDeactivations: asIdentityList(record.productDeactivations, "productId"),
    productReactivations: asIdentityList(record.productReactivations, "productId"),
    variantDeactivations: asIdentityList(record.variantDeactivations, "variantId"),
    variantReactivations: asIdentityList(record.variantReactivations, "variantId"),
  };
}

export function partnerDraftPreviewHasChanges(view: PartnerDraftPreviewView): boolean {
  return (
    view.productUpdates.length > 0
    || view.variantUpdates.length > 0
    || view.collectionUpdates.length > 0
    || view.membershipAdds.length > 0
    || view.membershipRemoves.length > 0
    || view.productDeactivations.length > 0
    || view.productReactivations.length > 0
    || view.variantDeactivations.length > 0
    || view.variantReactivations.length > 0
  );
}
