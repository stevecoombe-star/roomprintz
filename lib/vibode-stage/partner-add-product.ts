/**
 * Guided Partner product creation.
 *
 * Live Product and Variant rows stay unpublished until the existing
 * catalog publish route runs. The open Partner draft stores product.create
 * and its default variant.create only after the Product, first Variant,
 * and a ready 3D model are all valid. Until that save, the form is local:
 * reloading clears it. A GLB uploaded before that save can still be chosen
 * from existing models.
 *
 * After the create is saved, later edits use product.create_edit and
 * variant.create_edit. Reloading resumes the open draft when it contains
 * exactly one pending Product. More than one pending Product is left
 * untouched and this form starts another Product.
 *
 * Discard removes only that pending Product via product.create_remove.
 * Default Variant price stays coupled to the Product price.
 */

import {
  commercialSlugFromLabel,
  partnerSlugFromPartnerId,
  productCreationSlugFor,
  productIdForCreate,
  variantCreationSlugFor,
  variantIdForCreate,
} from "./partner-catalog-ids";
import type { PartnerDraftMutation } from "./partner-draft-mutations";
import type { PartnerCatalogSyncDocument } from "./partner-catalog-sync";
import type { StageCategory, StageCollection, StageProduct, StageVariant } from "./types";

export type PartnerAddProductMutation = Extract<
  PartnerDraftMutation,
  { type: "product.create" | "product.create_edit" | "product.create_remove" | "variant.create_edit" }
>;

export const PARTNER_ADD_PRODUCT_CURRENCIES = Object.freeze(["USD", "CAD", "EUR", "GBP", "AUD"] as const);

export const PARTNER_ADD_PRODUCT_CURRENCY_CONFLICT =
  "This catalog uses more than one currency. New products cannot be added until the catalog currency is resolved.";

export const PARTNER_ADD_PRODUCT_STEPS = Object.freeze([
  Object.freeze({ id: "product", label: "Product" }),
  Object.freeze({ id: "variant", label: "Variant" }),
  Object.freeze({ id: "model", label: "3D Model" }),
  Object.freeze({ id: "review", label: "Review & Publish" }),
] as const);

export type PartnerAddProductStep = (typeof PARTNER_ADD_PRODUCT_STEPS)[number]["id"];

export type PartnerAddProductCurrencyChoice =
  | Readonly<{ mode: "inherited"; currency: string }>
  | Readonly<{ mode: "choose" }>
  | Readonly<{ mode: "conflict" }>;

export type PartnerAddProductFields = Readonly<{
  name: string;
  price: string;
  currency: string;
  imageUrl: string;
  productUrl: string;
  categoryId: string;
  subcategoryId: string;
  collectionIds: readonly string[];
  finish: string;
  sku: string;
  variantProductUrl: string;
  productShortName: string;
  variantShortName: string;
  assetId: string;
  assetFileName: string | null;
}>;

export type PartnerAddProductSummary = Readonly<{
  productName: string;
  priceLabel: string;
  categoryLabel: string;
  subcategoryLabel: string | null;
  finish: string;
  sku: string;
  modelLabel: "Ready";
  modelFileName: string | null;
}>;

export type PartnerAddProductResume =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "many"; count: number }>
  | Readonly<{ kind: "unavailable" }>
  | Readonly<{
    kind: "one";
    productId: string;
    variantId: string;
    fields: PartnerAddProductFields;
  }>;

const PRICE_MESSAGE = "Enter a price of zero or more.";
const PRODUCT_SHORT_NAME = "Enter a short name so this product can be identified.";
const VARIANT_SHORT_NAME = "Enter a short name so this variant can be identified.";
const PRODUCT_IDENTITY = "A product with this name is already in your catalog.";
const VARIANT_IDENTITY = "A variant with this finish is already in your catalog.";
const SKU_REQUIRED = "Enter a SKU.";
const SKU_DUPLICATE = "This SKU is already used.";
const MODEL_REQUIRED = "Upload a GLB or choose an existing 3D model.";
const CURRENCY_REQUIRED = "Choose a currency.";
const IMAGE_URL = "Enter an image URL that starts with https://.";
const PRODUCT_URL = "Enter a product page URL that starts with https://.";
const VARIANT_URL = "Enter a variant page URL that starts with https://.";

export function partnerAddProductCurrencyChoice(
  status: "resolved" | "empty" | "conflict",
  currency: string | null,
): PartnerAddProductCurrencyChoice {
  if (status === "resolved" && currency) return { mode: "inherited", currency };
  if (status === "conflict") return { mode: "conflict" };
  return { mode: "choose" };
}

export function emptyPartnerAddProductFields(currency = ""): PartnerAddProductFields {
  return {
    name: "",
    price: "",
    currency,
    imageUrl: "",
    productUrl: "",
    categoryId: "",
    subcategoryId: "",
    collectionIds: [],
    finish: "",
    sku: "",
    variantProductUrl: "",
    productShortName: "",
    variantShortName: "",
    assetId: "",
    assetFileName: null,
  };
}

export function partnerProductNeedsShortName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  return productCreationSlugFor({ name: trimmed }) == null;
}

export function partnerVariantNeedsShortName(finish: string): boolean {
  const trimmed = finish.trim();
  if (!trimmed) return false;
  return variantCreationSlugFor({ finishLabel: trimmed }) == null;
}

export function partnerAddProductPublishLabel(otherChangeCount: number): "Publish product" | "Publish changes" {
  return otherChangeCount > 0 ? "Publish changes" : "Publish product";
}

export function partnerAddProductIssueStep(message: string): "product" | "variant" | "model" | null {
  const text = message.toLowerCase();
  if (/model|glb/.test(text)) return "model";
  if (/finish|sku|variant/.test(text)) return "variant";
  if (/name|price|currency|image|url|category|collection|identified/.test(text)) return "product";
  return null;
}

function blank(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isAbsoluteHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function isSameOriginPublicPath(imageUrl: string): boolean {
  if (
    imageUrl.includes("..")
    || imageUrl.includes("://")
    || imageUrl.includes("//")
    || !imageUrl.startsWith("/")
  ) {
    return false;
  }
  return /^\/[A-Za-z0-9][A-Za-z0-9._/-]*\.[A-Za-z0-9]+$/.test(imageUrl);
}

function parsePrice(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return amount;
}

function sortedIds(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function productSlug(fields: PartnerAddProductFields): string | null {
  const fromName = productCreationSlugFor({ name: fields.name.trim() });
  if (fromName) return fromName;
  return commercialSlugFromLabel(fields.productShortName);
}

function variantSlug(fields: PartnerAddProductFields): string | null {
  const finishLabel = blank(fields.finish);
  const fromFinish = variantCreationSlugFor({ finishLabel });
  if (fromFinish) return fromFinish;
  return variantCreationSlugFor({
    finishLabel,
    creationSlug: blank(fields.variantShortName),
  });
}

function derivedProductId(partnerId: string, fields: PartnerAddProductFields): string | null {
  const partnerSlug = partnerSlugFromPartnerId(partnerId);
  const slug = productSlug(fields);
  if (!partnerSlug || !slug) return null;
  return productIdForCreate(partnerSlug, slug);
}

function derivedVariantId(partnerId: string, fields: PartnerAddProductFields): string | null {
  const partnerSlug = partnerSlugFromPartnerId(partnerId);
  const slug = productSlug(fields);
  const finishSlug = variantSlug(fields);
  if (!partnerSlug || !slug || !finishSlug) return null;
  return variantIdForCreate(partnerSlug, slug, finishSlug);
}

function currencyIssues(
  fields: PartnerAddProductFields,
  currencyMode: PartnerAddProductCurrencyChoice["mode"],
): string[] {
  if (currencyMode === "conflict") return [PARTNER_ADD_PRODUCT_CURRENCY_CONFLICT];
  if (currencyMode === "inherited") return [];
  const currency = fields.currency.trim().toUpperCase();
  if (!PARTNER_ADD_PRODUCT_CURRENCIES.includes(currency as (typeof PARTNER_ADD_PRODUCT_CURRENCIES)[number])) {
    return [CURRENCY_REQUIRED];
  }
  return [];
}

export function validatePartnerAddProductStep(input: Readonly<{
  step: "product" | "variant" | "model";
  fields: PartnerAddProductFields;
  currencyMode: PartnerAddProductCurrencyChoice["mode"];
  categories: readonly StageCategory[];
  partnerId: string;
  products: readonly Pick<StageProduct, "productId" | "partnerId">[];
  variants: readonly Pick<StageVariant, "variantId" | "sku">[];
  pendingProductIds: readonly string[];
  pendingVariantIds: readonly string[];
  pendingSkus: readonly string[];
  ignoreProductId: string | null;
  ignoreVariantId: string | null;
  assetReady: boolean;
}>): readonly string[] {
  if (input.step === "product") return validateProductStep(input);
  if (input.step === "variant") return validateVariantStep(input);
  return input.assetReady ? [] : [MODEL_REQUIRED];
}

function validateProductStep(input: Readonly<{
  fields: PartnerAddProductFields;
  currencyMode: PartnerAddProductCurrencyChoice["mode"];
  categories: readonly StageCategory[];
  partnerId: string;
  products: readonly Pick<StageProduct, "productId" | "partnerId">[];
  pendingProductIds: readonly string[];
  ignoreProductId: string | null;
}>): string[] {
  const issues: string[] = [];
  const name = input.fields.name.trim();
  if (!name) issues.push("Enter a product name.");
  if (partnerProductNeedsShortName(name) && !productSlug(input.fields)) {
    issues.push(PRODUCT_SHORT_NAME);
  }
  if (parsePrice(input.fields.price) == null) issues.push(PRICE_MESSAGE);
  issues.push(...currencyIssues(input.fields, input.currencyMode));
  const imageUrl = input.fields.imageUrl.trim();
  if (!imageUrl || (!isAbsoluteHttpsUrl(imageUrl) && !isSameOriginPublicPath(imageUrl))) {
    issues.push(IMAGE_URL);
  }
  const productUrl = input.fields.productUrl.trim();
  if (!productUrl || !isAbsoluteHttpsUrl(productUrl)) issues.push(PRODUCT_URL);
  const category = input.categories.find((item) => item.id === input.fields.categoryId) ?? null;
  if (!category) {
    issues.push("Choose a category.");
  } else if (input.fields.subcategoryId.trim()) {
    const subcategory = category.subcategories.find((item) => item.id === input.fields.subcategoryId);
    if (!subcategory) issues.push("Choose a subcategory for this category.");
  }
  const productId = name ? derivedProductId(input.partnerId, input.fields) : null;
  if (productId && productId !== input.ignoreProductId) {
    const live = input.products.some((product) => (
      product.productId === productId && product.partnerId === input.partnerId
    ));
    const pending = input.pendingProductIds.includes(productId);
    if (live || pending) issues.push(PRODUCT_IDENTITY);
  }
  return issues;
}

function skuTaken(
  sku: string,
  variants: readonly Pick<StageVariant, "variantId" | "sku">[],
  pendingSkus: readonly string[],
  ignoreVariantId: string | null,
): boolean {
  const value = sku.trim();
  if (!value) return false;
  const live = variants.some((variant) => variant.variantId !== ignoreVariantId && variant.sku === value);
  if (live) return true;
  const pending = [...pendingSkus];
  return pending.includes(value);
}

function validateVariantStep(input: Readonly<{
  fields: PartnerAddProductFields;
  partnerId: string;
  variants: readonly Pick<StageVariant, "variantId" | "sku">[];
  pendingVariantIds: readonly string[];
  pendingSkus: readonly string[];
  ignoreVariantId: string | null;
}>): string[] {
  const issues: string[] = [];
  const finish = input.fields.finish.trim();
  if (!finish) issues.push("Enter a finish.");
  if (partnerVariantNeedsShortName(finish) && !variantSlug(input.fields)) {
    issues.push(VARIANT_SHORT_NAME);
  }
  const sku = input.fields.sku.trim();
  if (!sku) issues.push(SKU_REQUIRED);
  else if (skuTaken(sku, input.variants, input.pendingSkus, input.ignoreVariantId)) issues.push(SKU_DUPLICATE);
  const variantUrl = input.fields.variantProductUrl.trim();
  if (variantUrl && !isAbsoluteHttpsUrl(variantUrl)) issues.push(VARIANT_URL);
  const variantId = derivedVariantId(input.partnerId, input.fields);
  if (variantId && variantId !== input.ignoreVariantId) {
    const live = input.variants.some((variant) => variant.variantId === variantId);
    const pending = input.pendingVariantIds.includes(variantId);
    if (live || pending) issues.push(VARIANT_IDENTITY);
  }
  return issues;
}

export function partnerAddProductCollectionChoices(input: Readonly<{
  partnerId: string;
  collections: readonly Pick<StageCollection, "collectionId" | "name" | "owner" | "partnerId">[];
  pendingCollections: readonly Readonly<{ collectionId: string; name: string }>[];
  selectedIds: readonly string[];
}>): readonly Readonly<{
  collectionId: string;
  name: string;
  pending: boolean;
  checked: boolean;
}>[] {
  const selected = new Set(input.selectedIds);
  const choices = input.collections
    .filter((collection) => collection.owner === "partner" && collection.partnerId === input.partnerId)
    .map((collection) => ({
      collectionId: collection.collectionId,
      name: collection.name,
      pending: false,
      checked: selected.has(collection.collectionId),
    }));
  for (const collection of input.pendingCollections) {
    choices.push({
      collectionId: collection.collectionId,
      name: collection.name,
      pending: true,
      checked: selected.has(collection.collectionId),
    });
  }
  return choices.sort((left, right) => left.name.localeCompare(right.name) || left.collectionId.localeCompare(right.collectionId));
}

export function buildPartnerProductCreate(input: Readonly<{
  fields: PartnerAddProductFields;
  currencyMode: PartnerAddProductCurrencyChoice["mode"];
  categories: readonly StageCategory[];
  partnerId: string;
  products: readonly Pick<StageProduct, "productId" | "partnerId">[];
  variants: readonly Pick<StageVariant, "variantId" | "sku">[];
  pendingProductIds: readonly string[];
  pendingVariantIds: readonly string[];
  pendingSkus: readonly string[];
  ignoreProductId: string | null;
  ignoreVariantId: string | null;
  assetReady: boolean;
}>): Readonly<{ ok: true; mutation: Extract<PartnerAddProductMutation, { type: "product.create" }> } | { ok: false; issues: readonly string[] }> {
  const issues = [
    ...validatePartnerAddProductStep({ ...input, step: "product" }),
    ...validatePartnerAddProductStep({ ...input, step: "variant" }),
    ...validatePartnerAddProductStep({ ...input, step: "model" }),
  ];
  if (issues.length > 0) return { ok: false, issues };
  const priceAmount = parsePrice(input.fields.price);
  if (priceAmount == null) return { ok: false, issues: [PRICE_MESSAGE] };
  const fromName = productCreationSlugFor({ name: input.fields.name.trim() });
  const productCreationSlug = fromName ? null : commercialSlugFromLabel(input.fields.productShortName);
  const finishLabel = blank(input.fields.finish);
  const fromFinish = variantCreationSlugFor({ finishLabel });
  const creationSlug = fromFinish ? null : commercialSlugFromLabel(input.fields.variantShortName);
  const currency = input.fields.currency.trim().toUpperCase();
  return {
    ok: true,
    mutation: {
      type: "product.create",
      name: input.fields.name.trim(),
      imageUrl: input.fields.imageUrl.trim(),
      productUrl: input.fields.productUrl.trim(),
      priceAmount,
      categoryId: input.fields.categoryId,
      subcategoryId: input.fields.subcategoryId.trim() || null,
      ...(productCreationSlug ? { productCreationSlug } : {}),
      ...(currency ? { priceCurrency: currency } : {}),
      defaultVariant: {
        finishLabel,
        sku: input.fields.sku.trim(),
        productUrl: blank(input.fields.variantProductUrl),
        currentAssetId: input.fields.assetId.trim(),
        ...(creationSlug ? { creationSlug } : {}),
      },
      ...(input.fields.collectionIds.length > 0 ? { collectionIds: sortedIds(input.fields.collectionIds) } : {}),
    },
  };
}

export function diffPartnerAddProductMutations(input: Readonly<{
  productId: string;
  variantId: string;
  saved: PartnerAddProductFields;
  next: PartnerAddProductFields;
}>): readonly PartnerAddProductMutation[] {
  const mutations: PartnerAddProductMutation[] = [];
  const product: {
    type: "product.create_edit";
    productId: string;
    name?: string;
    imageUrl?: string;
    productUrl?: string;
    priceAmount?: number;
    categoryId?: string;
    subcategoryId?: string | null;
    collectionIds?: readonly string[];
  } = { type: "product.create_edit", productId: input.productId };
  let productChanged = false;
  if (input.next.name.trim() !== input.saved.name.trim()) {
    product.name = input.next.name.trim();
    productChanged = true;
  }
  if (input.next.imageUrl.trim() !== input.saved.imageUrl.trim()) {
    product.imageUrl = input.next.imageUrl.trim();
    productChanged = true;
  }
  if (input.next.productUrl.trim() !== input.saved.productUrl.trim()) {
    product.productUrl = input.next.productUrl.trim();
    productChanged = true;
  }
  const nextPrice = parsePrice(input.next.price);
  const savedPrice = parsePrice(input.saved.price);
  if (nextPrice != null && nextPrice !== savedPrice) {
    product.priceAmount = nextPrice;
    productChanged = true;
  }
  if (input.next.categoryId !== input.saved.categoryId) {
    product.categoryId = input.next.categoryId;
    productChanged = true;
  }
  if ((input.next.subcategoryId.trim() || null) !== (input.saved.subcategoryId.trim() || null)) {
    product.subcategoryId = input.next.subcategoryId.trim() || null;
    productChanged = true;
  }
  const nextCollections = sortedIds(input.next.collectionIds);
  const savedCollections = sortedIds(input.saved.collectionIds);
  if (nextCollections.join("\n") !== savedCollections.join("\n")) {
    product.collectionIds = nextCollections;
    productChanged = true;
  }
  if (productChanged) mutations.push(product);

  const variant: {
    type: "variant.create_edit";
    variantId: string;
    finishLabel?: string | null;
    sku?: string | null;
    productUrl?: string | null;
    currentAssetId?: string;
  } = { type: "variant.create_edit", variantId: input.variantId };
  let variantChanged = false;
  if (input.next.finish.trim() !== input.saved.finish.trim()) {
    variant.finishLabel = blank(input.next.finish);
    variantChanged = true;
  }
  if (input.next.sku.trim() !== input.saved.sku.trim()) {
    variant.sku = input.next.sku.trim();
    variantChanged = true;
  }
  if (input.next.variantProductUrl.trim() !== input.saved.variantProductUrl.trim()) {
    variant.productUrl = blank(input.next.variantProductUrl);
    variantChanged = true;
  }
  if (input.next.assetId.trim() !== input.saved.assetId.trim()) {
    variant.currentAssetId = input.next.assetId.trim();
    variantChanged = true;
  }
  if (variantChanged) mutations.push(variant);
  return mutations;
}

export function discardPartnerAddProductMutation(
  productId: string,
): Extract<PartnerAddProductMutation, { type: "product.create_remove" }> {
  return { type: "product.create_remove", productId };
}

function membershipIds(document: PartnerCatalogSyncDocument, productId: string): string[] {
  return sortedIds(
    (document.collections.membershipAdd ?? [])
      .filter((item) => item.productId === productId)
      .map((item) => item.collectionId),
  );
}

export function readPartnerAddProductFields(
  document: PartnerCatalogSyncDocument,
  productId: string,
): Readonly<{ variantId: string; fields: PartnerAddProductFields }> | null {
  const product = (document.products.create ?? []).find((item) => item.productId === productId) ?? null;
  if (!product) return null;
  const variant = document.variants.create.find((item) => (
    item.variantId === product.defaultVariantId && item.productId === product.productId
  )) ?? null;
  if (!variant) return null;
  return {
    variantId: variant.variantId,
    fields: {
      name: product.name,
      price: String(product.priceAmount),
      currency: product.priceCurrency,
      imageUrl: product.imageUrl,
      productUrl: product.productUrl,
      categoryId: product.categoryId,
      subcategoryId: product.subcategoryId ?? "",
      collectionIds: membershipIds(document, product.productId),
      finish: variant.finishLabel ?? "",
      sku: variant.sku ?? "",
      variantProductUrl: variant.productUrl ?? "",
      productShortName: "",
      variantShortName: "",
      assetId: variant.currentAssetId,
      assetFileName: null,
    },
  };
}

export function readPartnerAddProductResume(
  document: PartnerCatalogSyncDocument | null,
): PartnerAddProductResume {
  const creates = document?.products.create ?? [];
  if (creates.length === 0) return { kind: "none" };
  if (creates.length > 1) return { kind: "many", count: creates.length };
  const product = creates[0];
  if (!product || !document) return { kind: "unavailable" };
  const read = readPartnerAddProductFields(document, product.productId);
  if (!read) return { kind: "unavailable" };
  return {
    kind: "one",
    productId: product.productId,
    variantId: read.variantId,
    fields: read.fields,
  };
}

export function identifyCreatedPartnerProduct(
  previousIds: readonly string[],
  document: PartnerCatalogSyncDocument,
): Readonly<{ productId: string; variantId: string; fields: PartnerAddProductFields }> | null {
  const previous = new Set(previousIds);
  const added = (document.products.create ?? []).filter((item) => !previous.has(item.productId));
  if (added.length !== 1) return null;
  const product = added[0];
  if (!product) return null;
  const read = readPartnerAddProductFields(document, product.productId);
  if (!read) return null;
  return { productId: product.productId, variantId: read.variantId, fields: read.fields };
}

export function formatPartnerCreatePrice(amount: number, currency: string): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
  return `$${formatted} ${currency}`;
}

export function summarizePartnerAddProduct(input: Readonly<{
  fields: PartnerAddProductFields;
  categories: readonly StageCategory[];
}>): PartnerAddProductSummary {
  const category = input.categories.find((item) => item.id === input.fields.categoryId) ?? null;
  const subcategory = input.fields.subcategoryId
    ? category?.subcategories.find((item) => item.id === input.fields.subcategoryId) ?? null
    : null;
  const amount = parsePrice(input.fields.price);
  return {
    productName: input.fields.name.trim(),
    priceLabel: amount == null ? "" : formatPartnerCreatePrice(amount, input.fields.currency.trim().toUpperCase()),
    categoryLabel: category?.label ?? "",
    subcategoryLabel: subcategory?.label ?? null,
    finish: input.fields.finish.trim(),
    sku: input.fields.sku.trim(),
    modelLabel: "Ready",
    modelFileName: input.fields.assetFileName?.trim() || null,
  };
}

export function partnerAddProductFieldsMatch(
  left: PartnerAddProductFields,
  right: PartnerAddProductFields,
): boolean {
  return left.name.trim() === right.name.trim()
    && left.price.trim() === right.price.trim()
    && left.currency.trim().toUpperCase() === right.currency.trim().toUpperCase()
    && left.imageUrl.trim() === right.imageUrl.trim()
    && left.productUrl.trim() === right.productUrl.trim()
    && left.categoryId === right.categoryId
    && left.subcategoryId.trim() === right.subcategoryId.trim()
    && sortedIds(left.collectionIds).join("\n") === sortedIds(right.collectionIds).join("\n")
    && left.finish.trim() === right.finish.trim()
    && left.sku.trim() === right.sku.trim()
    && left.variantProductUrl.trim() === right.variantProductUrl.trim()
    && left.assetId.trim() === right.assetId.trim();
}

export function partnerAddProductOtherSkus(input: Readonly<{
  variants: readonly Pick<StageVariant, "variantId" | "sku">[];
  pendingVariants: readonly Readonly<{ variantId: string; sku: string | null }>[];
  ignoreVariantId: string | null;
}>): readonly string[] {
  const skus: string[] = [];
  for (const variant of input.variants) {
    if (variant.variantId === input.ignoreVariantId || !variant.sku) continue;
    skus.push(variant.sku);
  }
  for (const variant of input.pendingVariants) {
    if (variant.variantId === input.ignoreVariantId || !variant.sku) continue;
    skus.push(variant.sku);
  }
  return skus;
}
