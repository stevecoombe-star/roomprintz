/**
 * Partner Product editor view model.
 *
 * Presentation and mutation payloads for one existing Product. Persistence
 * remains the open Partner draft PATCH. Publish remains the existing
 * catalog-wide publish route.
 *
 * Currency: partnerCatalogCurrencyForCreate returns null for an empty
 * catalog and for a catalog with more than one currency. The guided add
 * product flow supplies priceCurrency on product.create when the catalog
 * is empty. This editor does not change that helper. An existing Product
 * inherits priceCurrency from its own row, and a new Variant on that
 * Product inherits the same currency.
 */

import { variantCreationSlugFor } from "./partner-catalog-ids";
import {
  shortenPartnerCommercialAssetId,
  type PartnerCommercialAssetOption,
} from "./partner-commercial-assets";
import type { PartnerDraftPreviewView } from "./partner-draft-preview-view";
import type { PartnerCatalogSyncDocument } from "./partner-catalog-sync";
import type { StageAsset, StageCategory, StageCollection, StageProduct, StageVariant } from "./types";

export const PARTNER_VARIANT_MODEL_REQUIRED =
  "A ready 3D model is needed before this Variant can be added.";

export const PARTNER_PUBLISHED_MODEL_NOTE =
  "This published Variant keeps its current 3D model.";

export const PARTNER_PUBLISHED_NO_MODEL_NOTE =
  "A 3D model cannot be added to this published Variant.";

export const PARTNER_PUBLISH_CONFIRMATION = "This updates your live Vibode catalog.";

export const PARTNER_PAGE_CHANGED =
  "This page has changed since you opened it. Reload before saving.";

export const PARTNER_SAVE_FAILED = "Save failed. Reload and try again.";

export const PARTNER_PUBLISH_FAILED = "The changes could not be published.";

export const PARTNER_DISCARD_CONFIRMATION =
  "This discards all unpublished Partner catalog changes, not only this product.";

export type PartnerEditorDraft = Readonly<{
  draftId: string;
  revision: number;
  document: PartnerCatalogSyncDocument;
}>;

export type PartnerEditorMutation =
  | Readonly<{ type: "product.set_name"; productId: string; name: string }>
  | Readonly<{ type: "product.set_image_url"; productId: string; imageUrl: string }>
  | Readonly<{ type: "product.set_product_url"; productId: string; productUrl: string | null }>
  | Readonly<{ type: "product.set_price"; productId: string; priceAmount: number }>
  | Readonly<{ type: "product.deactivate"; productId: string }>
  | Readonly<{ type: "product.reactivate"; productId: string }>
  | Readonly<{ type: "variant.set_finish_label"; variantId: string; finishLabel: string | null }>
  | Readonly<{ type: "variant.set_sku"; variantId: string; sku: string | null }>
  | Readonly<{ type: "variant.set_price"; variantId: string; priceAmount: number }>
  | Readonly<{ type: "variant.set_product_url"; variantId: string; productUrl: string | null }>
  | Readonly<{ type: "variant.deactivate"; variantId: string }>
  | Readonly<{ type: "variant.reactivate"; variantId: string }>
  | Readonly<{
    type: "variant.create";
    productId: string;
    finishLabel: string | null;
    sku: string | null;
    priceAmount: number;
    productUrl: string | null;
    currentAssetId: string;
    creationSlug?: string;
  }>
  | Readonly<{
    type: "variant.create_edit";
    variantId: string;
    finishLabel?: string | null;
    sku?: string | null;
    priceAmount?: number;
    productUrl?: string | null;
    currentAssetId?: string;
  }>
  | Readonly<{ type: "variant.create_remove"; variantId: string }>
  | Readonly<{ type: "collection.set_membership"; collectionId: string; productIds: readonly string[] }>
  | Readonly<{ type: "collection.create_edit"; collectionId: string; productIds: readonly string[] }>;

export type PartnerEditorCommit =
  | Readonly<{ state: "unchanged" }>
  | Readonly<{ state: "invalid"; message: string }>
  | Readonly<{ state: "mutation"; mutation: PartnerEditorMutation }>;

export type PartnerProductChangeLine = Readonly<{
  label: string;
  previous: string;
  next: string;
}>;

export type PartnerProductReview = Readonly<{
  publishable: boolean;
  issues: readonly string[];
  changes: readonly PartnerProductChangeLine[];
  otherLines: readonly string[];
}>;

export type PartnerVariantModelPresentation = Readonly<{
  stateLabel: "Ready" | "No 3D model" | "Needs attention";
  filename: string | null;
  detail: string | null;
  note: string | null;
  /** Set only when thumbnail metadata was loaded. Null means show the placeholder. */
  thumbnailUrl?: string | null;
}>;

export type PartnerModelThumbnailSlot = Readonly<{
  url: string | null;
  label: string;
}>;

export type PartnerEditorCollectionChoice = Readonly<{
  collectionId: string;
  name: string;
  checked: boolean;
  pending: boolean;
  liveProductIds: readonly string[];
}>;

export type PartnerEditorProductFields = Readonly<{
  name: string;
  imageUrl: string;
  productUrl: string;
  price: string;
}>;

export type PartnerEditorVariantFields = Readonly<{
  finish: string;
  sku: string;
  price: string;
  productUrl: string;
}>;

const PRICE_MESSAGE = "Enter a price of zero or more.";
const IDENTITY_MESSAGE = "Enter a finish so this variant can be identified.";

function blankToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function display(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const text = String(value).trim();
  return text.length > 0 ? text : "—";
}

function fieldCount(value: object, ignore: readonly string[]): number {
  return Object.entries(value).filter(([key, entry]) => (
    !ignore.includes(key) && entry !== undefined
  )).length;
}

function cleanName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function resolvePartnerProductEditor(input: Readonly<{
  partnerId: string;
  productId: string;
  products: readonly StageProduct[];
}>): Readonly<{ ok: true; product: StageProduct } | { ok: false; reason: "not_found" }> {
  const productId = input.productId.trim();
  const product = input.products.find((item) => item.productId === productId);
  if (!product || product.partnerId !== input.partnerId) {
    return { ok: false, reason: "not_found" };
  }
  return { ok: true, product };
}

export function partnerEditorDraftFromPortal(draft: Readonly<{
  draftId: string;
  status: string;
  revision: number;
  document: PartnerCatalogSyncDocument;
}> | null): PartnerEditorDraft | null {
  if (!draft || draft.status !== "open") return null;
  if (!draft.draftId || !Number.isInteger(draft.revision)) return null;
  return {
    draftId: draft.draftId,
    revision: draft.revision,
    document: draft.document,
  };
}

function isPartnerEditorDocument(value: unknown): value is PartnerCatalogSyncDocument {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<PartnerCatalogSyncDocument>;
  return Boolean(
    record.products
    && Array.isArray(record.products.update)
    && record.variants
    && Array.isArray(record.variants.update)
    && Array.isArray(record.variants.create)
    && record.collections
    && Array.isArray(record.collections.update)
    && Array.isArray(record.collections.membershipAdd)
    && Array.isArray(record.collections.membershipRemove),
  );
}

export function readPartnerEditorDraftResponse(value: unknown): PartnerEditorDraft | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { draftId?: unknown; revision?: unknown; status?: unknown; document?: unknown };
  if (typeof record.draftId !== "string" || !Number.isInteger(record.revision)) return null;
  if (record.status != null && record.status !== "open") return null;
  if (!isPartnerEditorDocument(record.document)) return null;
  return {
    draftId: record.draftId,
    revision: record.revision as number,
    document: record.document,
  };
}

export function partnerCategoryLabels(
  categories: readonly StageCategory[],
  categoryId: string,
  subcategoryId: string | null,
): Readonly<{ category: string; subcategory: string | null }> {
  const category = categories.find((item) => item.id === categoryId);
  const subcategory = subcategoryId
    ? category?.subcategories.find((item) => item.id === subcategoryId) ?? null
    : null;
  return {
    category: category?.label ?? "—",
    subcategory: subcategory?.label ?? null,
  };
}

function productPatch(document: PartnerCatalogSyncDocument | null, productId: string) {
  return document?.products.update.find((item) => item.productId === productId) ?? null;
}

function variantPatch(document: PartnerCatalogSyncDocument | null, variantId: string) {
  return document?.variants.update.find((item) => item.variantId === variantId) ?? null;
}

function effective<T>(live: T, override: T | undefined): T {
  return override !== undefined ? override : live;
}

export function readPartnerProductFields(
  product: StageProduct,
  document: PartnerCatalogSyncDocument | null,
): PartnerEditorProductFields {
  const patch = productPatch(document, product.productId);
  const price = effective(product.priceAmount, patch?.priceAmount);
  return {
    name: effective(product.name, patch?.name),
    imageUrl: effective(product.imageUrl, patch?.imageUrl),
    productUrl: effective(product.productUrl, patch?.productUrl) ?? "",
    price: price == null ? "" : String(price),
  };
}

export function readPartnerVariantFields(
  variant: StageVariant,
  document: PartnerCatalogSyncDocument | null,
): PartnerEditorVariantFields {
  const patch = variantPatch(document, variant.variantId);
  const price = effective(variant.priceAmount, patch?.priceAmount);
  return {
    finish: effective(variant.finishLabel, patch?.finishLabel) ?? "",
    sku: effective(variant.sku, patch?.sku) ?? "",
    price: price == null ? "" : String(price),
    productUrl: effective(variant.productUrl, patch?.productUrl) ?? "",
  };
}

export function readPendingVariantFields(
  create: PartnerCatalogSyncDocument["variants"]["create"][number],
): PartnerEditorVariantFields {
  return {
    finish: create.finishLabel ?? "",
    sku: create.sku ?? "",
    price: String(create.priceAmount ?? ""),
    productUrl: create.productUrl ?? "",
  };
}

function commitText(
  next: string,
  saved: string,
  empty: "null" | "reject",
  rejectMessage: string,
): Readonly<{ state: "unchanged" } | { state: "invalid"; message: string } | { state: "value"; value: string | null }> {
  if (empty === "null") {
    const value = blankToNull(next);
    if (value === blankToNull(saved)) return { state: "unchanged" };
    return { state: "value", value };
  }
  const value = next.trim();
  if (!value) return { state: "invalid", message: rejectMessage };
  if (value === saved.trim()) return { state: "unchanged" };
  return { state: "value", value };
}

function commitPrice(next: string, saved: string): PartnerEditorCommit | Readonly<{ state: "value"; priceAmount: number }> {
  const trimmed = next.trim();
  if (!trimmed) return { state: "invalid", message: PRICE_MESSAGE };
  const priceAmount = Number(trimmed);
  if (!Number.isFinite(priceAmount) || priceAmount < 0) {
    return { state: "invalid", message: PRICE_MESSAGE };
  }
  if (saved.trim() !== "") {
    const savedAmount = Number(saved);
    if (Number.isFinite(savedAmount) && priceAmount === savedAmount) return { state: "unchanged" };
  }
  return { state: "value", priceAmount };
}

export function commitPartnerProductName(productId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitText(next, saved, "reject", "Enter a product name.");
  if (parsed.state !== "value" || parsed.value == null) return parsed.state === "value" ? { state: "unchanged" } : parsed;
  return { state: "mutation", mutation: { type: "product.set_name", productId, name: parsed.value } };
}

export function commitPartnerProductImage(productId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitText(next, saved, "reject", "Enter an image URL.");
  if (parsed.state !== "value" || parsed.value == null) return parsed.state === "value" ? { state: "unchanged" } : parsed;
  return { state: "mutation", mutation: { type: "product.set_image_url", productId, imageUrl: parsed.value } };
}

export function commitPartnerProductUrl(productId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitText(next, saved, "null", "");
  if (parsed.state !== "value") return parsed;
  return { state: "mutation", mutation: { type: "product.set_product_url", productId, productUrl: parsed.value } };
}

export function partnerEditorPendingProductStatus(
  document: PartnerCatalogSyncDocument | null,
  productId: string,
): "active" | "inactive" | null {
  if (!document) return null;
  if ((document.products.deactivate ?? []).some((item) => item.productId === productId)) return "inactive";
  if ((document.products.reactivate ?? []).some((item) => item.productId === productId)) return "active";
  return null;
}

export function partnerProductStatusMutation(
  productId: string,
  next: "active" | "inactive",
): PartnerEditorMutation {
  return next === "inactive"
    ? { type: "product.deactivate", productId }
    : { type: "product.reactivate", productId };
}

export function partnerEditorPendingVariantStatus(
  document: PartnerCatalogSyncDocument | null,
  variantId: string,
): "active" | "inactive" | null {
  if (!document) return null;
  if ((document.variants.deactivate ?? []).some((item) => item.variantId === variantId)) return "inactive";
  if ((document.variants.reactivate ?? []).some((item) => item.variantId === variantId)) return "active";
  return null;
}

export function partnerVariantStatusMutation(
  variantId: string,
  next: "active" | "inactive",
): PartnerEditorMutation {
  return next === "inactive"
    ? { type: "variant.deactivate", variantId }
    : { type: "variant.reactivate", variantId };
}

export function partnerVariantStatusChangeLabel(identity: string): string {
  const name = identity.trim();
  if (!name || name === "Variant") return "Variant status";
  return `Variant "${name}" status`;
}

export function commitPartnerProductPrice(productId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitPrice(next, saved);
  if (parsed.state !== "value") return parsed;
  return { state: "mutation", mutation: { type: "product.set_price", productId, priceAmount: parsed.priceAmount } };
}

export function commitPartnerVariantFinish(variantId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitText(next, saved, "null", "");
  if (parsed.state !== "value") return parsed;
  return {
    state: "mutation",
    mutation: { type: "variant.set_finish_label", variantId, finishLabel: parsed.value },
  };
}

export function commitPartnerVariantSku(variantId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitText(next, saved, "null", "");
  if (parsed.state !== "value") return parsed;
  return { state: "mutation", mutation: { type: "variant.set_sku", variantId, sku: parsed.value } };
}

export function commitPartnerVariantPrice(variantId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitPrice(next, saved);
  if (parsed.state !== "value") return parsed;
  return { state: "mutation", mutation: { type: "variant.set_price", variantId, priceAmount: parsed.priceAmount } };
}

export function commitPartnerVariantUrl(variantId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitText(next, saved, "null", "");
  if (parsed.state !== "value") return parsed;
  return { state: "mutation", mutation: { type: "variant.set_product_url", variantId, productUrl: parsed.value } };
}

export function commitPendingVariantFinish(variantId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitText(next, saved, "null", "");
  if (parsed.state !== "value") return parsed;
  return { state: "mutation", mutation: { type: "variant.create_edit", variantId, finishLabel: parsed.value } };
}

export function commitPendingVariantSku(variantId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitText(next, saved, "null", "");
  if (parsed.state !== "value") return parsed;
  return { state: "mutation", mutation: { type: "variant.create_edit", variantId, sku: parsed.value } };
}

export function commitPendingVariantPrice(variantId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitPrice(next, saved);
  if (parsed.state !== "value") return parsed;
  return { state: "mutation", mutation: { type: "variant.create_edit", variantId, priceAmount: parsed.priceAmount } };
}

export function commitPendingVariantUrl(variantId: string, next: string, saved: string): PartnerEditorCommit {
  const parsed = commitText(next, saved, "null", "");
  if (parsed.state !== "value") return parsed;
  return { state: "mutation", mutation: { type: "variant.create_edit", variantId, productUrl: parsed.value } };
}

export function commitPendingVariantModel(variantId: string, nextAssetId: string, savedAssetId: string): PartnerEditorCommit {
  const next = nextAssetId.trim();
  if (!next || next === savedAssetId) return { state: "unchanged" };
  return { state: "mutation", mutation: { type: "variant.create_edit", variantId, currentAssetId: next } };
}

export function removePendingVariantMutation(variantId: string): PartnerEditorMutation {
  return { type: "variant.create_remove", variantId };
}

export function variantNeedsShortName(finish: string): boolean {
  return variantCreationSlugFor({ finishLabel: blankToNull(finish) }) == null;
}

export function buildPartnerVariantCreate(input: Readonly<{
  productId: string;
  currency: string;
  finish: string;
  shortName: string;
  sku: string;
  price: string;
  productUrl: string;
  assetId: string;
  hasReadyModel: boolean;
}>): PartnerEditorCommit {
  if (!input.currency.trim()) {
    return { state: "invalid", message: "A catalog currency is needed before this variant can be added." };
  }
  if (!input.hasReadyModel || !input.assetId.trim()) {
    return { state: "invalid", message: PARTNER_VARIANT_MODEL_REQUIRED };
  }
  const finishLabel = blankToNull(input.finish);
  const explicitSlug = blankToNull(input.shortName);
  const finishSlug = variantCreationSlugFor({ finishLabel });
  const creationSlug = finishSlug ? null : explicitSlug;
  if (!variantCreationSlugFor({ finishLabel, creationSlug })) {
    return { state: "invalid", message: IDENTITY_MESSAGE };
  }
  const price = commitPrice(input.price, "");
  if (price.state !== "value") {
    return price.state === "unchanged" ? { state: "invalid", message: PRICE_MESSAGE } : price;
  }
  return {
    state: "mutation",
    mutation: {
      type: "variant.create",
      productId: input.productId,
      finishLabel,
      sku: blankToNull(input.sku),
      priceAmount: price.priceAmount,
      productUrl: blankToNull(input.productUrl),
      currentAssetId: input.assetId.trim(),
      ...(creationSlug ? { creationSlug } : {}),
    },
  };
}

export function collectionProductIds(input: Readonly<{
  liveProductIds: readonly string[];
  addedProductIds: readonly string[];
  removedProductIds: readonly string[];
}>): string[] {
  const removed = new Set(input.removedProductIds);
  const ids = new Set(input.liveProductIds.filter((id) => !removed.has(id)));
  for (const id of input.addedProductIds) ids.add(id);
  return [...ids].sort((left, right) => left.localeCompare(right));
}

export function toggleProductInCollection(
  productIds: readonly string[],
  productId: string,
  checked: boolean,
): string[] {
  const next = new Set(productIds);
  if (checked) next.add(productId);
  else next.delete(productId);
  return [...next].sort((left, right) => left.localeCompare(right));
}

export function collectionMembershipMutation(input: Readonly<{
  collectionId: string;
  productIds: readonly string[];
  pending: boolean;
}>): PartnerEditorMutation {
  if (input.pending) {
    return {
      type: "collection.create_edit",
      collectionId: input.collectionId,
      productIds: input.productIds,
    };
  }
  return {
    type: "collection.set_membership",
    collectionId: input.collectionId,
    productIds: input.productIds,
  };
}

export function partnerEditorCollectionChoices(input: Readonly<{
  productId: string;
  collections: readonly StageCollection[];
  document: PartnerCatalogSyncDocument | null;
}>): readonly PartnerEditorCollectionChoice[] {
  const choices: PartnerEditorCollectionChoice[] = [];
  for (const collection of input.collections) {
    if (collection.owner !== "partner") continue;
    const added = (input.document?.collections.membershipAdd ?? [])
      .filter((item) => item.collectionId === collection.collectionId)
      .map((item) => item.productId);
    const removed = (input.document?.collections.membershipRemove ?? [])
      .filter((item) => item.collectionId === collection.collectionId)
      .map((item) => item.productId);
    const members = collectionProductIds({
      liveProductIds: collection.productIds,
      addedProductIds: added,
      removedProductIds: removed,
    });
    choices.push({
      collectionId: collection.collectionId,
      name: collection.name,
      checked: members.includes(input.productId),
      pending: false,
      liveProductIds: collection.productIds,
    });
  }
  for (const create of input.document?.collections.create ?? []) {
    const added = (input.document?.collections.membershipAdd ?? [])
      .filter((item) => item.collectionId === create.collectionId)
      .map((item) => item.productId);
    choices.push({
      collectionId: create.collectionId,
      name: create.name,
      checked: added.includes(input.productId),
      pending: true,
      liveProductIds: [],
    });
  }
  return choices.sort((left, right) => left.name.localeCompare(right.name) || left.collectionId.localeCompare(right.collectionId));
}

function partnerFacingAssetContext(option: PartnerCommercialAssetOption): string | null {
  const label = option.label.trim();
  if (!label) return null;
  if (label === option.assetId) return null;
  if (label === shortenPartnerCommercialAssetId(option.assetId)) return null;
  return label;
}

export function partnerEditorAssetOptionLabel(option: PartnerCommercialAssetOption): string {
  const fileName = option.originalFileName?.trim() || null;
  const context = partnerFacingAssetContext(option);
  const parts: string[] = [];
  if (fileName) parts.push(fileName);
  if (context && context !== fileName) parts.push(context);
  if (parts.length === 0) parts.push("3D model");
  parts.push("Ready");
  return parts.join(" · ");
}

export function partnerEditorAssetLabel(
  options: readonly PartnerCommercialAssetOption[],
  assetId: string,
): string {
  const option = options.find((item) => item.assetId === assetId);
  if (!option) return "Ready";
  return partnerEditorAssetOptionLabel(option);
}

export function partnerEditorModelAssetIds(input: Readonly<{
  optionAssetIds: readonly string[];
  variantAssetIds: readonly (string | null | undefined)[];
  pendingAssetIds?: readonly (string | null | undefined)[];
}>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of [
    ...input.optionAssetIds,
    ...input.variantAssetIds,
    ...(input.pendingAssetIds ?? []),
  ]) {
    const assetId = typeof value === "string" ? value.trim() : "";
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    ids.push(assetId);
  }
  return ids;
}

export function partnerVariantAssignedThumbnailUrl(
  assetId: string | null | undefined,
  thumbnailUrls: Readonly<Record<string, string | null>> | null | undefined,
): string | null | undefined {
  const id = assetId?.trim() ?? "";
  if (!id || !thumbnailUrls) return undefined;
  const value = thumbnailUrls[id];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function partnerDisplayedModelThumbnail(input: Readonly<{
  stateLabel: PartnerVariantModelPresentation["stateLabel"] | null;
  filename: string | null;
  thumbnailUrl?: string | null;
  replacingFileName?: string | null;
}>): PartnerModelThumbnailSlot | null {
  if (input.replacingFileName != null) {
    if (input.thumbnailUrl === undefined) return null;
    const label = input.replacingFileName.trim() || "3D model";
    return { url: null, label };
  }
  if (!input.stateLabel || input.stateLabel === "No 3D model") return null;
  if (input.thumbnailUrl === undefined) return null;
  return {
    url: input.thumbnailUrl,
    label: input.filename?.trim() || "3D model",
  };
}

export function presentPartnerVariantModel(input: Readonly<{
  assetId: string | null;
  assets: readonly Pick<StageAsset, "assetId" | "status">[];
  options: readonly PartnerCommercialAssetOption[];
  published: boolean;
  uploadedFileName?: string | null;
  thumbnailUrls?: Readonly<Record<string, string | null>> | null;
}>): PartnerVariantModelPresentation {
  const assetId = input.assetId?.trim() || null;
  const thumbnailUrl = partnerVariantAssignedThumbnailUrl(assetId, input.thumbnailUrls);
  const thumbnail = thumbnailUrl !== undefined ? { thumbnailUrl } : {};
  if (!assetId) {
    return {
      stateLabel: "No 3D model",
      filename: null,
      detail: null,
      note: input.published ? PARTNER_PUBLISHED_NO_MODEL_NOTE : null,
    };
  }
  const option = input.options.find((item) => item.assetId === assetId) ?? null;
  const asset = input.assets.find((item) => item.assetId === assetId) ?? null;
  const uploadedFileName = input.uploadedFileName?.trim() || null;
  const ready = option != null || asset?.status === "ready" || uploadedFileName != null;
  const filename = option?.originalFileName?.trim() || uploadedFileName;
  const context = option ? partnerFacingAssetContext(option) : null;
  return {
    stateLabel: ready ? "Ready" : "Needs attention",
    filename,
    detail: context && context !== filename ? context : null,
    note: input.published ? PARTNER_PUBLISHED_MODEL_NOTE : null,
    ...thumbnail,
  };
}

function variantHeading(
  variant: Pick<StageVariant, "finishLabel" | "sku">,
  patch: ReturnType<typeof variantPatch>,
): string {
  const finish = effective(variant.finishLabel, patch?.finishLabel);
  const sku = effective(variant.sku, patch?.sku);
  if (finish && sku) return `${finish} · ${sku}`;
  return finish || sku || "Variant";
}

function pushChange(
  lines: PartnerProductChangeLine[],
  label: string,
  previous: string,
  next: string,
) {
  if (previous === next) return;
  lines.push({ label, previous, next });
}

function pushProductStatusChange(
  lines: PartnerProductChangeLine[],
  pending: "active" | "inactive" | null,
) {
  if (pending === "inactive") lines.push({ label: "Product status", previous: "Active", next: "Inactive" });
  if (pending === "active") lines.push({ label: "Product status", previous: "Inactive", next: "Active" });
}

function pushVariantStatusChange(
  lines: PartnerProductChangeLine[],
  identity: string,
  pending: "active" | "inactive" | null,
) {
  if (pending === "inactive") {
    lines.push({ label: partnerVariantStatusChangeLabel(identity), previous: "Active", next: "Inactive" });
  }
  if (pending === "active") {
    lines.push({ label: partnerVariantStatusChangeLabel(identity), previous: "Inactive", next: "Active" });
  }
}

export function describeSavedPartnerProductChanges(input: Readonly<{
  product: StageProduct;
  variants: readonly StageVariant[];
  collections: readonly StageCollection[];
  document: PartnerCatalogSyncDocument | null;
  assetLabel?: (assetId: string) => string;
}>): readonly PartnerProductChangeLine[] {
  if (!input.document) return [];
  const lines: PartnerProductChangeLine[] = [];
  const patch = productPatch(input.document, input.product.productId);
  if (patch?.name !== undefined) pushChange(lines, "Name", display(input.product.name), display(patch.name));
  if (patch?.imageUrl !== undefined) pushChange(lines, "Image URL", display(input.product.imageUrl), display(patch.imageUrl));
  if (patch?.productUrl !== undefined) {
    pushChange(lines, "Product URL", display(input.product.productUrl), display(patch.productUrl));
  }
  if (patch?.priceAmount !== undefined) {
    pushChange(lines, "Price", display(input.product.priceAmount), display(patch.priceAmount));
  }
  pushProductStatusChange(
    lines,
    partnerEditorPendingProductStatus(input.document, input.product.productId),
  );

  for (const variant of input.variants) {
    if (variant.productId !== input.product.productId) continue;
    const variantUpdate = variantPatch(input.document, variant.variantId);
    const heading = variantHeading(variant, variantUpdate);
    pushVariantStatusChange(
      lines,
      heading,
      partnerEditorPendingVariantStatus(input.document, variant.variantId),
    );
    if (!variantUpdate) continue;
    if (variantUpdate.finishLabel !== undefined) {
      pushChange(lines, `${heading} · Finish`, display(variant.finishLabel), display(variantUpdate.finishLabel));
    }
    if (variantUpdate.sku !== undefined) {
      pushChange(lines, `${heading} · SKU`, display(variant.sku), display(variantUpdate.sku));
    }
    if (variantUpdate.priceAmount !== undefined) {
      pushChange(lines, `${heading} · Price`, display(variant.priceAmount), display(variantUpdate.priceAmount));
    }
    if (variantUpdate.productUrl !== undefined) {
      pushChange(lines, `${heading} · Product URL`, display(variant.productUrl), display(variantUpdate.productUrl));
    }
  }

  for (const create of input.document.variants.create ?? []) {
    if (create.productId !== input.product.productId) continue;
    const model = input.assetLabel?.(create.currentAssetId) ?? "Ready";
    const summary = [
      create.finishLabel,
      create.sku ? `SKU ${create.sku}` : null,
      display(create.priceAmount),
      model,
    ].filter((part) => part && part !== "—").join(" · ");
    lines.push({ label: "New variant", previous: "—", next: summary || "New variant" });
  }

  const liveNames = input.collections
    .filter((collection) => collection.productIds.includes(input.product.productId))
    .map((collection) => collection.name);
  const choices = partnerEditorCollectionChoices({
    productId: input.product.productId,
    collections: input.collections,
    document: input.document,
  });
  const nextNames = choices.filter((choice) => choice.checked).map((choice) => choice.name);
  const previous = liveNames.length > 0 ? [...liveNames].sort((left, right) => left.localeCompare(right)).join(", ") : "—";
  const next = nextNames.length > 0 ? [...nextNames].sort((left, right) => left.localeCompare(right)).join(", ") : "—";
  pushChange(lines, "Collections", previous, next);
  return lines;
}

type ProductChangeBucket = { name: string | null; count: number };

function formatProductChangeLine(count: number, name: string | null): string {
  const changes = count === 1 ? "change" : "changes";
  if (!name) {
    return count === 1 ? "1 change to another product" : `${count} changes to other products`;
  }
  return `${count} ${changes} to ${name}`;
}

function formatCollectionChangeLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 Collection change" : `${count} Collection changes`;
}

function pushBucket(
  buckets: Map<string, ProductChangeBucket>,
  productId: string,
  count: number,
  currentProductId: string,
  name: string | null,
) {
  if (count <= 0 || productId === currentProductId) return;
  const key = name ?? "__other__";
  const existing = buckets.get(key);
  if (existing) {
    existing.count += count;
    if (!existing.name && name) existing.name = name;
    return;
  }
  buckets.set(key, { name, count });
}

function linesFromBuckets(buckets: Map<string, ProductChangeBucket>, collectionChanges: number): string[] {
  const lines = [...buckets.values()]
    .filter((bucket) => bucket.count > 0)
    .sort((left, right) => (left.name ?? "zzz").localeCompare(right.name ?? "zzz"))
    .map((bucket) => formatProductChangeLine(bucket.count, bucket.name));
  const collectionLine = formatCollectionChangeLine(collectionChanges);
  if (collectionLine) lines.push(collectionLine);
  return lines;
}

export function describePartnerPublishInclusions(input: Readonly<{
  document: PartnerCatalogSyncDocument | null;
  productId: string;
  productNames: Readonly<Record<string, string>>;
  variantProductIds: Readonly<Record<string, string>>;
}>): readonly string[] {
  if (!input.document) return [];
  const buckets = new Map<string, ProductChangeBucket>();
  const add = (productId: string, count: number, name?: string | null) => {
    const label = cleanName(name) ?? cleanName(input.productNames[productId]);
    pushBucket(buckets, productId, count, input.productId, label);
  };

  for (const update of input.document.products.update) {
    add(update.productId, fieldCount(update, ["productId"]));
  }
  for (const create of input.document.products.create ?? []) {
    add(create.productId, 1, create.name);
  }
  for (const item of input.document.products.deactivate ?? []) add(item.productId, 1);
  for (const item of input.document.products.reactivate ?? []) add(item.productId, 1);

  for (const update of input.document.variants.update) {
    const owner = input.variantProductIds[update.variantId]
      ?? input.document.variants.create.find((item) => item.variantId === update.variantId)?.productId
      ?? "";
    if (!owner) {
      add("__unknown_variant__", fieldCount(update, ["variantId", "productId"]));
      continue;
    }
    add(owner, fieldCount(update, ["variantId", "productId"]));
  }
  for (const create of input.document.variants.create) add(create.productId, 1);
  for (const item of input.document.variants.deactivate ?? []) {
    const owner = input.variantProductIds[item.variantId] ?? "";
    add(owner || "__unknown_variant__", 1);
  }
  for (const item of input.document.variants.reactivate ?? []) {
    const owner = input.variantProductIds[item.variantId] ?? "";
    add(owner || "__unknown_variant__", 1);
  }

  let collectionChanges = 0;
  for (const update of input.document.collections.update) {
    collectionChanges += fieldCount(update, ["collectionId"]);
  }
  collectionChanges += (input.document.collections.create ?? []).length;
  for (const item of input.document.collections.membershipAdd) {
    if (item.productId !== input.productId) collectionChanges += 1;
  }
  for (const item of input.document.collections.membershipRemove) {
    if (item.productId !== input.productId) collectionChanges += 1;
  }
  return linesFromBuckets(buckets, collectionChanges);
}

function reviewIssueText(code: string, message: string): string {
  if (code === "DEFAULT_VARIANT_INACTIVE") {
    return "The default Variant stays active while this Product is active.";
  }
  if (code === "LAST_ACTIVE_VARIANT") {
    return "An active Product needs at least one active Variant.";
  }
  const text = message.trim();
  if (!text || text === code) return "This change needs attention before it can be published.";
  if (/planVersion|sqlPlan|patch|PI-5|current_asset/i.test(text)) {
    return "This change needs attention before it can be published.";
  }
  return text;
}

export function partnerEditorErrorMessage(
  error: string | null | undefined,
  fallback = PARTNER_SAVE_FAILED,
): string {
  const message = error?.trim() ?? "";
  if (!message) return fallback;
  if (/revision is stale|stale draft|\brevision\b/i.test(message)) return PARTNER_PAGE_CHANGED;
  if (/slug|patch|planVersion|current_asset|PI-5|asset id|sqlPlan/i.test(message)) return fallback;
  if (/\b(prod|var|col|partner|asset)-[a-z0-9-]{6,}/i.test(message)) return fallback;
  if (message.length > 180) return fallback;
  return message;
}

export function describePartnerProductReview(
  preview: PartnerDraftPreviewView | Readonly<{ error: string }>,
  input: Readonly<{
    productId: string;
    productNames: Readonly<Record<string, string>>;
    variantLabels: Readonly<Record<string, string>>;
    collectionNames: Readonly<Record<string, string>>;
    variantProductIds: Readonly<Record<string, string>>;
    assetLabel: (assetId: string) => string;
  }>,
): PartnerProductReview {
  if ("error" in preview) {
    return {
      publishable: false,
      issues: ["Changes could not be reviewed. Try again."],
      changes: [],
      otherLines: [],
    };
  }
  const issues = preview.issues.map((issue) => reviewIssueText(issue.code, issue.message));
  const changes: PartnerProductChangeLine[] = [];
  const buckets = new Map<string, ProductChangeBucket>();
  const add = (productId: string, count: number, name?: string | null) => {
    const label = cleanName(name) ?? cleanName(input.productNames[productId]);
    pushBucket(buckets, productId, count, input.productId, label);
  };

  for (const update of preview.productUpdates) {
    if (update.productId === input.productId) {
      for (const change of update.changes) {
        changes.push({ label: change.label, previous: change.previous, next: change.next });
      }
    } else {
      add(update.productId, update.changes.length);
    }
  }
  for (const productId of preview.productDeactivations) {
    if (productId === input.productId) {
      pushProductStatusChange(changes, "inactive");
    } else {
      add(productId, 1);
    }
  }
  for (const productId of preview.productReactivations) {
    if (productId === input.productId) {
      pushProductStatusChange(changes, "active");
    } else {
      add(productId, 1);
    }
  }
  for (const create of preview.productCreates) {
    if (create.productId === input.productId) {
      changes.push({ label: "New product", previous: "—", next: create.name });
    } else {
      add(create.productId, 1, create.name);
    }
  }
  for (const variantId of preview.variantDeactivations) {
    const owner = input.variantProductIds[variantId] || "";
    if (owner === input.productId) {
      pushVariantStatusChange(changes, input.variantLabels[variantId] || "Variant", "inactive");
    } else {
      add(owner || "__unknown_variant__", 1);
    }
  }
  for (const variantId of preview.variantReactivations) {
    const owner = input.variantProductIds[variantId] || "";
    if (owner === input.productId) {
      pushVariantStatusChange(changes, input.variantLabels[variantId] || "Variant", "active");
    } else {
      add(owner || "__unknown_variant__", 1);
    }
  }
  for (const update of preview.variantUpdates) {
    const owner = update.productId || input.variantProductIds[update.variantId] || "";
    if (owner === input.productId) {
      const heading = input.variantLabels[update.variantId] || "Variant";
      for (const change of update.changes) {
        changes.push({
          label: `${heading} · ${change.label}`,
          previous: change.previous,
          next: change.next,
        });
      }
    } else {
      add(owner || "__unknown_variant__", update.changes.length);
    }
  }
  for (const create of preview.variantCreates) {
    const summary = [
      create.finishLabel !== "—" ? create.finishLabel : null,
      create.sku !== "—" ? `SKU ${create.sku}` : null,
      create.price !== "—" ? create.price : null,
      input.assetLabel(create.currentAssetId),
    ].filter((part): part is string => Boolean(part)).join(" · ");
    if (create.productId === input.productId) {
      const ownedByNewProduct = preview.productCreates.some((item) => item.productId === create.productId && item.defaultVariantId === create.variantId);
      if (!ownedByNewProduct) {
        changes.push({ label: "New variant", previous: "—", next: summary || "New variant" });
      }
    } else {
      add(create.productId, 1);
    }
  }
  for (const item of preview.membershipAdds) {
    if (item.productId === input.productId) {
      const name = input.collectionNames[item.collectionId] || "a collection";
      changes.push({ label: "Collections", previous: "—", next: `Added to ${name}` });
    }
  }
  for (const item of preview.membershipRemoves) {
    if (item.productId === input.productId) {
      const name = input.collectionNames[item.collectionId] || "a collection";
      changes.push({ label: "Collections", previous: name, next: "Removed" });
    }
  }

  let collectionChanges = preview.collectionUpdates.length + preview.collectionCreates.length;
  for (const item of preview.membershipAdds) {
    if (item.productId !== input.productId) collectionChanges += 1;
  }
  for (const item of preview.membershipRemoves) {
    if (item.productId !== input.productId) collectionChanges += 1;
  }
  const otherLines = linesFromBuckets(buckets, collectionChanges);
  if (!preview.ok && issues.length === 0) {
    issues.push("This change needs attention before it can be published.");
  }
  const publishable = preview.ok && issues.length === 0 && (changes.length > 0 || otherLines.length > 0);
  return { publishable, issues, changes, otherLines };
}

export function partnerPublishConfirmation(
  otherLines: readonly string[],
  productChangeCount: number,
): string {
  if (otherLines.length === 0) return PARTNER_PUBLISH_CONFIRMATION;
  const lead = productChangeCount === 0
    ? `${PARTNER_PUBLISH_CONFIRMATION} This product has no unpublished changes. Publishing still includes other catalog changes:`
    : `${PARTNER_PUBLISH_CONFIRMATION} Other unpublished catalog changes are included:`;
  return `${lead}\n\n${otherLines.map((line) => `• ${line}`).join("\n")}`;
}

export function partnerEditorDocumentHasChanges(document: PartnerCatalogSyncDocument | null): boolean {
  if (!document) return false;
  return document.products.update.length > 0
    || (document.products.create?.length ?? 0) > 0
    || (document.products.deactivate?.length ?? 0) > 0
    || (document.products.reactivate?.length ?? 0) > 0
    || document.variants.update.length > 0
    || document.variants.create.length > 0
    || (document.variants.deactivate?.length ?? 0) > 0
    || (document.variants.reactivate?.length ?? 0) > 0
    || document.collections.update.length > 0
    || (document.collections.create?.length ?? 0) > 0
    || document.collections.membershipAdd.length > 0
    || document.collections.membershipRemove.length > 0;
}

export function partnerVariantHeading(finish: string | null, sku: string | null): string {
  if (finish && sku) return `${finish} · ${sku}`;
  return finish || sku || "Variant";
}
