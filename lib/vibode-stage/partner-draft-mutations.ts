/**
 * PI-5G2 structural Partner draft mutations.
 *
 * Upserts sparse canonical PI-5F patch deltas against live durable
 * catalog state. Does not publish, validate SKU uniqueness, or
 * duplicate certified planner rules. Preview remains authoritative.
 *
 * Inactive Collections are omitted by the durable assembler and are
 * not authorable in G2.
 */

import {
  partnerSlugFromPartnerId,
  productCreationSlugFor,
  productIdForCreate,
  productSlugFor,
  variantCreationSlugFor,
  variantIdForCreate,
} from "./partner-catalog-ids";
import {
  parsePartnerCatalogSyncJson,
  type PartnerCatalogCollectionPatch,
  type PartnerCatalogMembershipPatch,
  type PartnerCatalogProductCreate,
  type PartnerCatalogProductPatch,
  type PartnerCatalogSyncDocument,
  type PartnerCatalogVariantCreate,
  type PartnerCatalogVariantPatch,
} from "./partner-catalog-sync";
import { partnerReadyAssetIdSet } from "./partner-portal-assets";
import {
  asFiniteNumber,
  asNonEmptyString,
  isCommercialId,
  isPlainObject,
  isUuidLike,
  validateBrowseTaxonomy,
} from "./product-variant-register";
import type { StageCatalogSnapshot, StageCollection, StageProduct, StageVariant } from "./types";

export const PARTNER_DRAFT_MAX_JSON_BYTES = 256 * 1024;
export const PARTNER_DRAFT_MAX_OPERATIONS = 2000;

export const PARTNER_DRAFT_MUTATION_TYPES = Object.freeze([
  "product.set_name",
  "product.set_image_url",
  "product.set_product_url",
  "product.set_price",
  "product.create",
  "product.create_edit",
  "product.create_remove",
  "variant.set_finish_label",
  "variant.set_sku",
  "variant.set_price",
  "variant.set_product_url",
  "variant.create",
  "variant.create_edit",
  "variant.create_remove",
  "collection.set_name",
  "collection.set_membership",
] as const);

export type PartnerDraftMutationType = (typeof PARTNER_DRAFT_MUTATION_TYPES)[number];

export type PartnerDraftMutation =
  | Readonly<{ type: "product.set_name"; productId: string; name: string }>
  | Readonly<{ type: "product.set_image_url"; productId: string; imageUrl: string }>
  | Readonly<{ type: "product.set_product_url"; productId: string; productUrl: string | null }>
  | Readonly<{ type: "product.set_price"; productId: string; priceAmount: number }>
  | Readonly<{
      type: "product.create";
      name: string;
      imageUrl: string;
      productUrl: string;
      priceAmount: number;
      categoryId: string;
      subcategoryId?: string | null;
      productCreationSlug?: string | null;
      defaultVariant: Readonly<{
        finishLabel?: string | null;
        sku?: string | null;
        productUrl?: string | null;
        currentAssetId: string;
        creationSlug?: string | null;
      }>;
      collectionIds?: readonly string[];
    }>
  | Readonly<{
      type: "product.create_edit";
      productId: string;
      name?: string;
      imageUrl?: string;
      productUrl?: string;
      priceAmount?: number;
      categoryId?: string;
      subcategoryId?: string | null;
      collectionIds?: readonly string[];
    }>
  | Readonly<{ type: "product.create_remove"; productId: string }>
  | Readonly<{ type: "variant.set_finish_label"; variantId: string; finishLabel: string | null }>
  | Readonly<{ type: "variant.set_sku"; variantId: string; sku: string | null }>
  | Readonly<{ type: "variant.set_price"; variantId: string; priceAmount: number }>
  | Readonly<{ type: "variant.set_product_url"; variantId: string; productUrl: string | null }>
  | Readonly<{
      type: "variant.create";
      productId: string;
      finishLabel: string | null;
      sku: string | null;
      priceAmount: number;
      productUrl: string | null;
      currentAssetId: string;
      creationSlug?: string | null;
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
  | Readonly<{ type: "collection.set_name"; collectionId: string; name: string }>
  | Readonly<{
      type: "collection.set_membership";
      collectionId: string;
      productIds: readonly string[];
    }>;

export type PartnerDraftMutationFailure = Readonly<{
  ok: false;
  code: "invalid_mutation" | "unknown_id" | "forbidden" | "invalid_document";
  error: string;
}>;

export type PartnerDraftMutationSuccess = Readonly<{
  ok: true;
  document: PartnerCatalogSyncDocument;
}>;

export type PartnerDraftMutationResult = PartnerDraftMutationSuccess | PartnerDraftMutationFailure;

const FORBIDDEN_MUTATION_TYPES = Object.freeze([
  "product.set_status",
  "variant.set_status",
  "partner.set_status",
  "variant.set_asset",
  "variant.set_current_asset_id",
  "collection.create",
] as const);

type WritableProductPatch = {
  productId: string;
  name?: string;
  imageUrl?: string;
  productUrl?: string | null;
  priceAmount?: number;
  priceCurrency?: string;
  categoryId?: string;
  subcategoryId?: string | null;
  defaultVariantId?: string;
  brand?: string;
  retailer?: string;
  partnerId?: string;
  source?: string;
};

type WritableVariantPatch = {
  variantId: string;
  productId?: string;
  finishLabel?: string | null;
  sku?: string | null;
  priceAmount?: number;
  priceCurrency?: string;
  productUrl?: string | null;
  currentAssetId?: string;
};

type WritableCollectionPatch = {
  collectionId: string;
  name?: string;
  partnerId?: string;
  owner?: string;
  partnerName?: string;
  slug?: string;
};

type MutablePatchDocument = {
  partnerId: string;
  mode: "patch";
  products: {
    create: PartnerCatalogProductCreate[];
    update: WritableProductPatch[];
    deactivate: { productId: string }[];
    reactivate: { productId: string }[];
  };
  variants: {
    create: PartnerCatalogSyncDocument["variants"]["create"][number][];
    update: WritableVariantPatch[];
    deactivate: { variantId: string }[];
    reactivate: { variantId: string }[];
  };
  collections: {
    update: WritableCollectionPatch[];
    membershipAdd: PartnerCatalogMembershipPatch[];
    membershipRemove: PartnerCatalogMembershipPatch[];
  };
};

function fail(
  code: PartnerDraftMutationFailure["code"],
  error: string,
): PartnerDraftMutationFailure {
  return { ok: false, code, error };
}

function cloneDocument(document: PartnerCatalogSyncDocument): MutablePatchDocument {
  return {
    partnerId: document.partnerId,
    mode: "patch",
    products: {
      create: (document.products.create ?? []).map((item) => ({ ...item })),
      update: document.products.update.map((item) => ({ ...item })),
      deactivate: [...(document.products.deactivate ?? [])].map((item) => ({ ...item })),
      reactivate: [...(document.products.reactivate ?? [])].map((item) => ({ ...item })),
    },
    variants: {
      create: document.variants.create.map((item) => ({ ...item })),
      update: document.variants.update.map((item) => ({ ...item })),
      deactivate: [...(document.variants.deactivate ?? [])].map((item) => ({ ...item })),
      reactivate: [...(document.variants.reactivate ?? [])].map((item) => ({ ...item })),
    },
    collections: {
      update: document.collections.update.map((item) => ({ ...item })),
      membershipAdd: document.collections.membershipAdd.map((item) => ({ ...item })),
      membershipRemove: document.collections.membershipRemove.map((item) => ({ ...item })),
    },
  };
}

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  return Object.keys(value).filter((key) => !allowed.includes(key));
}

function nullableTrimmedString(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function emptyPartnerPatchDocument(partnerId: string): PartnerCatalogSyncDocument {
  const parsed = parsePartnerCatalogSyncJson({
    partnerId,
    mode: "patch",
    products: { create: [], update: [], deactivate: [], reactivate: [] },
    variants: { create: [], update: [], deactivate: [], reactivate: [] },
    collections: { update: [], membershipAdd: [], membershipRemove: [] },
  });
  if (!parsed.ok) {
    throw new Error("Empty Partner patch document must parse.");
  }
  return parsed.document;
}

export function persistablePartnerPatchDocument(document: PartnerCatalogSyncDocument): unknown {
  return JSON.parse(JSON.stringify(document)) as unknown;
}

export function parsePersistedPartnerPatchDocument(
  value: unknown,
  partnerId: string,
): PartnerCatalogSyncDocument | null {
  const stamped = isPlainObject(value) ? { ...value, partnerId } : { partnerId, mode: "patch" };
  const parsed = parsePartnerCatalogSyncJson(stamped);
  return parsed.ok ? parsed.document : null;
}

export function countPartnerDraftOperations(document: PartnerCatalogSyncDocument): number {
  return (
    (document.products.create ?? []).length +
    document.products.update.length +
    (document.products.deactivate?.length ?? 0) +
    (document.products.reactivate?.length ?? 0) +
    document.variants.create.length +
    document.variants.update.length +
    (document.variants.deactivate?.length ?? 0) +
    (document.variants.reactivate?.length ?? 0) +
    document.collections.update.length +
    document.collections.membershipAdd.length +
    document.collections.membershipRemove.length
  );
}

export function partnerDraftJsonByteLength(document: unknown): number {
  return Buffer.byteLength(JSON.stringify(document), "utf8");
}

export function parsePartnerDraftMutations(
  value: unknown,
): Readonly<{ ok: true; mutations: readonly PartnerDraftMutation[] }> | PartnerDraftMutationFailure {
  if (!Array.isArray(value)) return fail("invalid_mutation", "Invalid draft mutation.");
  if (value.length === 0) return fail("invalid_mutation", "Invalid draft mutation.");
  if (value.length > PARTNER_DRAFT_MAX_OPERATIONS) {
    return fail("invalid_mutation", "Draft is too large.");
  }
  const mutations: PartnerDraftMutation[] = [];
  for (const item of value) {
    const parsed = parsePartnerDraftMutation(item);
    if (!parsed.ok) return parsed;
    mutations.push(parsed.mutation);
  }
  return { ok: true, mutations };
}

export function parsePartnerDraftMutation(
  value: unknown,
): Readonly<{ ok: true; mutation: PartnerDraftMutation }> | PartnerDraftMutationFailure {
  if (!isPlainObject(value)) return fail("invalid_mutation", "Invalid draft mutation.");
  const type = asNonEmptyString(value.type);
  if (!type) return fail("invalid_mutation", "Invalid draft mutation.");
  if ((FORBIDDEN_MUTATION_TYPES as readonly string[]).includes(type)) {
    return fail("forbidden", "This catalog change is not allowed in draft authoring.");
  }
  if (!(PARTNER_DRAFT_MUTATION_TYPES as readonly string[]).includes(type)) {
    return fail("forbidden", "This catalog change is not allowed in draft authoring.");
  }

  switch (type) {
    case "product.set_name": {
      if (extraKeys(value, ["type", "productId", "name"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const productId = asNonEmptyString(value.productId);
      const name = asNonEmptyString(value.name);
      if (!productId || !name) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, productId, name } };
    }
    case "product.set_image_url": {
      if (extraKeys(value, ["type", "productId", "imageUrl"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const productId = asNonEmptyString(value.productId);
      const imageUrl = asNonEmptyString(value.imageUrl);
      if (!productId || !imageUrl) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, productId, imageUrl } };
    }
    case "product.set_product_url": {
      if (extraKeys(value, ["type", "productId", "productUrl"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const productId = asNonEmptyString(value.productId);
      const productUrl = nullableTrimmedString(value.productUrl);
      if (!productId || productUrl === undefined) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, productId, productUrl } };
    }
    case "product.set_price": {
      if (extraKeys(value, ["type", "productId", "priceAmount"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const productId = asNonEmptyString(value.productId);
      const priceAmount = asFiniteNumber(value.priceAmount);
      if (!productId || priceAmount == null) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, productId, priceAmount } };
    }
    case "product.create": {
      if (extraKeys(value, [
        "type",
        "name",
        "imageUrl",
        "productUrl",
        "priceAmount",
        "categoryId",
        "subcategoryId",
        "productCreationSlug",
        "defaultVariant",
        "collectionIds",
      ]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const name = asNonEmptyString(value.name);
      const imageUrl = asNonEmptyString(value.imageUrl);
      const productUrl = asNonEmptyString(value.productUrl);
      const priceAmount = asFiniteNumber(value.priceAmount);
      const categoryId = asNonEmptyString(value.categoryId);
      const subcategoryId = value.subcategoryId === undefined
        ? undefined
        : nullableTrimmedString(value.subcategoryId);
      const productCreationSlug = value.productCreationSlug === undefined
        ? undefined
        : nullableTrimmedString(value.productCreationSlug);
      if (
        !name
        || !imageUrl
        || !productUrl
        || priceAmount == null
        || priceAmount < 0
        || !categoryId
        || subcategoryId === undefined && "subcategoryId" in value
        || productCreationSlug === undefined && "productCreationSlug" in value
        || !isPlainObject(value.defaultVariant)
      ) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      if (extraKeys(value.defaultVariant, [
        "finishLabel",
        "sku",
        "productUrl",
        "currentAssetId",
        "creationSlug",
      ]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const finishLabel = value.defaultVariant.finishLabel === undefined
        ? undefined
        : nullableTrimmedString(value.defaultVariant.finishLabel);
      const sku = value.defaultVariant.sku === undefined
        ? undefined
        : nullableTrimmedString(value.defaultVariant.sku);
      const variantProductUrl = value.defaultVariant.productUrl === undefined
        ? undefined
        : nullableTrimmedString(value.defaultVariant.productUrl);
      const currentAssetId = asNonEmptyString(value.defaultVariant.currentAssetId);
      const creationSlug = value.defaultVariant.creationSlug === undefined
        ? undefined
        : nullableTrimmedString(value.defaultVariant.creationSlug);
      if (
        !currentAssetId
        || finishLabel === undefined && "finishLabel" in value.defaultVariant
        || sku === undefined && "sku" in value.defaultVariant
        || variantProductUrl === undefined && "productUrl" in value.defaultVariant
        || creationSlug === undefined && "creationSlug" in value.defaultVariant
      ) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      let collectionIds: string[] | undefined;
      if ("collectionIds" in value) {
        if (!Array.isArray(value.collectionIds)) return fail("invalid_mutation", "Invalid draft mutation.");
        collectionIds = [];
        for (const item of value.collectionIds) {
          const collectionId = asNonEmptyString(item);
          if (!collectionId) return fail("invalid_mutation", "Invalid draft mutation.");
          collectionIds.push(collectionId);
        }
      }
      return {
        ok: true,
        mutation: {
          type,
          name,
          imageUrl,
          productUrl,
          priceAmount,
          categoryId,
          ...(subcategoryId !== undefined ? { subcategoryId } : {}),
          ...(productCreationSlug !== undefined ? { productCreationSlug } : {}),
          defaultVariant: {
            ...(finishLabel !== undefined ? { finishLabel } : {}),
            ...(sku !== undefined ? { sku } : {}),
            ...(variantProductUrl !== undefined ? { productUrl: variantProductUrl } : {}),
            currentAssetId,
            ...(creationSlug !== undefined ? { creationSlug } : {}),
          },
          ...(collectionIds ? { collectionIds } : {}),
        },
      };
    }
    case "product.create_edit": {
      if (extraKeys(value, [
        "type",
        "productId",
        "name",
        "imageUrl",
        "productUrl",
        "priceAmount",
        "categoryId",
        "subcategoryId",
        "collectionIds",
      ]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const productId = asNonEmptyString(value.productId);
      if (!productId) return fail("invalid_mutation", "Invalid draft mutation.");
      const next: {
        type: "product.create_edit";
        productId: string;
        name?: string;
        imageUrl?: string;
        productUrl?: string;
        priceAmount?: number;
        categoryId?: string;
        subcategoryId?: string | null;
        collectionIds?: readonly string[];
      } = { type, productId };
      if ("name" in value) {
        const name = asNonEmptyString(value.name);
        if (!name) return fail("invalid_mutation", "Invalid draft mutation.");
        next.name = name;
      }
      if ("imageUrl" in value) {
        const imageUrl = asNonEmptyString(value.imageUrl);
        if (!imageUrl) return fail("invalid_mutation", "Invalid draft mutation.");
        next.imageUrl = imageUrl;
      }
      if ("productUrl" in value) {
        const productUrl = asNonEmptyString(value.productUrl);
        if (!productUrl) return fail("invalid_mutation", "Invalid draft mutation.");
        next.productUrl = productUrl;
      }
      if ("priceAmount" in value) {
        const priceAmount = asFiniteNumber(value.priceAmount);
        if (priceAmount == null || priceAmount < 0) return fail("invalid_mutation", "Invalid draft mutation.");
        next.priceAmount = priceAmount;
      }
      if ("categoryId" in value) {
        const categoryId = asNonEmptyString(value.categoryId);
        if (!categoryId) return fail("invalid_mutation", "Invalid draft mutation.");
        next.categoryId = categoryId;
      }
      if ("subcategoryId" in value) {
        const subcategoryId = nullableTrimmedString(value.subcategoryId);
        if (subcategoryId === undefined) return fail("invalid_mutation", "Invalid draft mutation.");
        next.subcategoryId = subcategoryId;
      }
      if ("collectionIds" in value) {
        if (!Array.isArray(value.collectionIds)) return fail("invalid_mutation", "Invalid draft mutation.");
        const collectionIds: string[] = [];
        for (const item of value.collectionIds) {
          const collectionId = asNonEmptyString(item);
          if (!collectionId) return fail("invalid_mutation", "Invalid draft mutation.");
          collectionIds.push(collectionId);
        }
        next.collectionIds = collectionIds;
      }
      if (
        next.name === undefined
        && next.imageUrl === undefined
        && next.productUrl === undefined
        && next.priceAmount === undefined
        && next.categoryId === undefined
        && next.subcategoryId === undefined
        && next.collectionIds === undefined
      ) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      return { ok: true, mutation: next };
    }
    case "product.create_remove": {
      if (extraKeys(value, ["type", "productId"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const productId = asNonEmptyString(value.productId);
      if (!productId) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, productId } };
    }
    case "variant.set_finish_label": {
      if (extraKeys(value, ["type", "variantId", "finishLabel"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const variantId = asNonEmptyString(value.variantId);
      const finishLabel = nullableTrimmedString(value.finishLabel);
      if (!variantId || finishLabel === undefined) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, variantId, finishLabel } };
    }
    case "variant.set_sku": {
      if (extraKeys(value, ["type", "variantId", "sku"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const variantId = asNonEmptyString(value.variantId);
      const sku = nullableTrimmedString(value.sku);
      if (!variantId || sku === undefined) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, variantId, sku } };
    }
    case "variant.set_price": {
      if (extraKeys(value, ["type", "variantId", "priceAmount"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const variantId = asNonEmptyString(value.variantId);
      const priceAmount = asFiniteNumber(value.priceAmount);
      if (!variantId || priceAmount == null) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, variantId, priceAmount } };
    }
    case "variant.set_product_url": {
      if (extraKeys(value, ["type", "variantId", "productUrl"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const variantId = asNonEmptyString(value.variantId);
      const productUrl = nullableTrimmedString(value.productUrl);
      if (!variantId || productUrl === undefined) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, variantId, productUrl } };
    }
    case "variant.create": {
      if (extraKeys(value, [
        "type",
        "productId",
        "finishLabel",
        "sku",
        "priceAmount",
        "productUrl",
        "currentAssetId",
        "creationSlug",
      ]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const productId = asNonEmptyString(value.productId);
      const finishLabel = nullableTrimmedString(value.finishLabel);
      const sku = nullableTrimmedString(value.sku);
      const priceAmount = asFiniteNumber(value.priceAmount);
      const productUrl = nullableTrimmedString(value.productUrl);
      const currentAssetId = asNonEmptyString(value.currentAssetId);
      const creationSlug = value.creationSlug === undefined
        ? undefined
        : nullableTrimmedString(value.creationSlug);
      if (
        !productId
        || finishLabel === undefined
        || sku === undefined
        || priceAmount == null
        || priceAmount < 0
        || productUrl === undefined
        || !currentAssetId
        || creationSlug === undefined && "creationSlug" in value
      ) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      return {
        ok: true,
        mutation: {
          type,
          productId,
          finishLabel,
          sku,
          priceAmount,
          productUrl,
          currentAssetId,
          ...(creationSlug !== undefined ? { creationSlug } : {}),
        },
      };
    }
    case "variant.create_edit": {
      if (extraKeys(value, [
        "type",
        "variantId",
        "finishLabel",
        "sku",
        "priceAmount",
        "productUrl",
        "currentAssetId",
      ]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const variantId = asNonEmptyString(value.variantId);
      if (!variantId) return fail("invalid_mutation", "Invalid draft mutation.");
      const next: {
        type: "variant.create_edit";
        variantId: string;
        finishLabel?: string | null;
        sku?: string | null;
        priceAmount?: number;
        productUrl?: string | null;
        currentAssetId?: string;
      } = { type, variantId };
      if ("finishLabel" in value) {
        const finishLabel = nullableTrimmedString(value.finishLabel);
        if (finishLabel === undefined) return fail("invalid_mutation", "Invalid draft mutation.");
        next.finishLabel = finishLabel;
      }
      if ("sku" in value) {
        const sku = nullableTrimmedString(value.sku);
        if (sku === undefined) return fail("invalid_mutation", "Invalid draft mutation.");
        next.sku = sku;
      }
      if ("priceAmount" in value) {
        const priceAmount = asFiniteNumber(value.priceAmount);
        if (priceAmount == null || priceAmount < 0) return fail("invalid_mutation", "Invalid draft mutation.");
        next.priceAmount = priceAmount;
      }
      if ("productUrl" in value) {
        const productUrl = nullableTrimmedString(value.productUrl);
        if (productUrl === undefined) return fail("invalid_mutation", "Invalid draft mutation.");
        next.productUrl = productUrl;
      }
      if ("currentAssetId" in value) {
        const currentAssetId = asNonEmptyString(value.currentAssetId);
        if (!currentAssetId) return fail("invalid_mutation", "Invalid draft mutation.");
        next.currentAssetId = currentAssetId;
      }
      if (
        next.finishLabel === undefined
        && next.sku === undefined
        && next.priceAmount === undefined
        && next.productUrl === undefined
        && next.currentAssetId === undefined
      ) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      return { ok: true, mutation: next };
    }
    case "variant.create_remove": {
      if (extraKeys(value, ["type", "variantId"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const variantId = asNonEmptyString(value.variantId);
      if (!variantId) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, variantId } };
    }
    case "collection.set_name": {
      if (extraKeys(value, ["type", "collectionId", "name"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const collectionId = asNonEmptyString(value.collectionId);
      const name = asNonEmptyString(value.name);
      if (!collectionId || !name) return fail("invalid_mutation", "Invalid draft mutation.");
      return { ok: true, mutation: { type, collectionId, name } };
    }
    case "collection.set_membership": {
      if (extraKeys(value, ["type", "collectionId", "productIds"]).length > 0) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const collectionId = asNonEmptyString(value.collectionId);
      if (!collectionId || !Array.isArray(value.productIds)) {
        return fail("invalid_mutation", "Invalid draft mutation.");
      }
      const productIds: string[] = [];
      for (const item of value.productIds) {
        const productId = asNonEmptyString(item);
        if (!productId) return fail("invalid_mutation", "Invalid draft mutation.");
        productIds.push(productId);
      }
      return { ok: true, mutation: { type, collectionId, productIds } };
    }
    default:
      return fail("forbidden", "This catalog change is not allowed in draft authoring.");
  }
}

function findProduct(catalog: StageCatalogSnapshot, productId: string): StageProduct | null {
  return catalog.products.find((item) => item.productId === productId) ?? null;
}

function findVariant(catalog: StageCatalogSnapshot, variantId: string): StageVariant | null {
  return catalog.variants.find((item) => item.variantId === variantId) ?? null;
}

function findCollection(catalog: StageCatalogSnapshot, collectionId: string): StageCollection | null {
  return catalog.collections.find((item) => item.collectionId === collectionId) ?? null;
}

function upsertById<T extends Record<string, unknown>>(
  items: T[],
  idKey: keyof T,
  id: string,
  fields: Partial<T>,
): T {
  const index = items.findIndex((item) => item[idKey] === id);
  const current = index >= 0 ? { ...items[index] } : ({ [idKey]: id } as T);
  const next = { ...current, ...fields };
  if (index >= 0) items[index] = next;
  else items.push(next);
  return next;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function sortMembership(
  items: readonly PartnerCatalogMembershipPatch[],
): PartnerCatalogMembershipPatch[] {
  return [...items].sort((left, right) => (
    left.collectionId.localeCompare(right.collectionId)
    || left.productId.localeCompare(right.productId)
  ));
}

function applyPriceCoupling(
  working: MutablePatchDocument,
  product: StageProduct,
  priceAmount: number,
): void {
  upsertById(working.products.update, "productId", product.productId, { priceAmount });
  upsertById(working.variants.update, "variantId", product.defaultVariantId, { priceAmount });
}

function findPendingCreate(
  working: MutablePatchDocument,
  variantId: string,
): PartnerCatalogVariantCreate | null {
  return working.variants.create.find((item) => item.variantId === variantId) ?? null;
}

function findPendingProduct(
  working: MutablePatchDocument,
  productId: string,
): PartnerCatalogProductCreate | null {
  return working.products.create.find((item) => item.productId === productId) ?? null;
}

function sortVariantCreates(
  items: PartnerCatalogVariantCreate[],
): PartnerCatalogVariantCreate[] {
  return [...items].sort((left, right) => left.variantId.localeCompare(right.variantId));
}

function sortProductCreates(
  items: PartnerCatalogProductCreate[],
): PartnerCatalogProductCreate[] {
  return [...items].sort((left, right) => left.productId.localeCompare(right.productId));
}

export function partnerCatalogCurrencyForCreate(
  catalog: StageCatalogSnapshot,
  partnerId: string,
): string | null {
  const currencies = new Set<string>();
  for (const product of catalog.products) {
    if (product.partnerId === partnerId && product.source === "partner_catalog") {
      if (!product.priceCurrency) continue;
      currencies.add(product.priceCurrency);
    }
  }
  if (currencies.size !== 1) return null;
  return [...currencies][0] ?? null;
}

function setPendingProductMemberships(
  working: MutablePatchDocument,
  productId: string,
  collectionIds: readonly string[],
): void {
  const desired = uniqueSorted(collectionIds);
  working.collections.membershipAdd = sortMembership([
    ...working.collections.membershipAdd.filter((item) => item.productId !== productId),
    ...desired.map((collectionId) => ({ productId, collectionId })),
  ]);
  working.collections.membershipRemove = sortMembership(
    working.collections.membershipRemove.filter((item) => item.productId !== productId),
  );
}

function pendingDefaultVariant(
  working: MutablePatchDocument,
  variantId: string,
): PartnerCatalogProductCreate | null {
  return working.products.create.find((item) => item.defaultVariantId === variantId) ?? null;
}

function deriveVariantCreateId(input: Readonly<{
  partnerId: string;
  productId: string;
  finishLabel: string | null;
  creationSlug?: string | null;
}>): string | PartnerDraftMutationFailure {
  const partnerSlug = partnerSlugFromPartnerId(input.partnerId);
  const productSlug = partnerSlug ? productSlugFor(partnerSlug, input.productId) : null;
  const variantSlug = variantCreationSlugFor({
    finishLabel: input.finishLabel,
    creationSlug: input.creationSlug,
  });
  if (!partnerSlug || !productSlug || !variantSlug) {
    return fail("invalid_mutation", "A stable variant identity slug is required.");
  }
  const variantId = variantIdForCreate(partnerSlug, productSlug, variantSlug);
  if (!isCommercialId(variantId) || isUuidLike(variantId)) {
    return fail("invalid_mutation", "A stable variant identity slug is required.");
  }
  return variantId;
}

function deriveProductCreateIds(input: Readonly<{
  partnerId: string;
  name: string;
  productCreationSlug?: string | null;
  finishLabel: string | null;
  variantCreationSlug?: string | null;
}>): Readonly<{ productId: string; variantId: string }> | PartnerDraftMutationFailure {
  const partnerSlug = partnerSlugFromPartnerId(input.partnerId);
  const productSlug = partnerSlug
    ? productCreationSlugFor({ name: input.name, creationSlug: input.productCreationSlug })
    : null;
  const variantSlug = variantCreationSlugFor({
    finishLabel: input.finishLabel,
    creationSlug: input.variantCreationSlug,
  });
  if (!partnerSlug || !productSlug) {
    return fail("invalid_mutation", "A stable product identity slug is required.");
  }
  if (!variantSlug) {
    return fail("invalid_mutation", "A stable variant identity slug is required.");
  }
  const productId = productIdForCreate(partnerSlug, productSlug);
  const variantId = variantIdForCreate(partnerSlug, productSlug, variantSlug);
  if (!isCommercialId(productId) || isUuidLike(productId)) {
    return fail("invalid_mutation", "A stable product identity slug is required.");
  }
  if (!isCommercialId(variantId) || isUuidLike(variantId)) {
    return fail("invalid_mutation", "A stable variant identity slug is required.");
  }
  return { productId, variantId };
}

function applyOne(
  working: MutablePatchDocument,
  catalog: StageCatalogSnapshot,
  mutation: PartnerDraftMutation,
  allowedAssetIds: ReadonlySet<string>,
): PartnerDraftMutationFailure | null {
  if (
    mutation.type !== "variant.create"
    && mutation.type !== "variant.create_edit"
    && mutation.type !== "product.create"
    && ("currentAssetId" in mutation || "assetId" in mutation || "status" in mutation)
  ) {
    return fail("forbidden", "This catalog change is not allowed in draft authoring.");
  }
  switch (mutation.type) {
    case "product.set_name": {
      if (findPendingProduct(working, mutation.productId)) {
        return fail("invalid_mutation", "Pending Product edits use create-edit semantics.");
      }
      const product = findProduct(catalog, mutation.productId);
      if (!product) return fail("unknown_id", "Unknown Product.");
      upsertById(working.products.update, "productId", mutation.productId, { name: mutation.name });
      return null;
    }
    case "product.set_image_url": {
      if (findPendingProduct(working, mutation.productId)) {
        return fail("invalid_mutation", "Pending Product edits use create-edit semantics.");
      }
      const product = findProduct(catalog, mutation.productId);
      if (!product) return fail("unknown_id", "Unknown Product.");
      upsertById(working.products.update, "productId", mutation.productId, { imageUrl: mutation.imageUrl });
      return null;
    }
    case "product.set_product_url": {
      if (findPendingProduct(working, mutation.productId)) {
        return fail("invalid_mutation", "Pending Product edits use create-edit semantics.");
      }
      const product = findProduct(catalog, mutation.productId);
      if (!product) return fail("unknown_id", "Unknown Product.");
      upsertById(working.products.update, "productId", mutation.productId, { productUrl: mutation.productUrl });
      return null;
    }
    case "product.set_price": {
      if (findPendingProduct(working, mutation.productId)) {
        return fail("invalid_mutation", "Pending Product edits use create-edit semantics.");
      }
      const product = findProduct(catalog, mutation.productId);
      if (!product) return fail("unknown_id", "Unknown Product.");
      applyPriceCoupling(working, product, mutation.priceAmount);
      return null;
    }
    case "product.create": {
      const currency = partnerCatalogCurrencyForCreate(catalog, working.partnerId);
      if (!currency) {
        return fail("invalid_mutation", "Partner catalog currency could not be resolved.");
      }
      const taxonomy = validateBrowseTaxonomy(mutation.categoryId, mutation.subcategoryId ?? null);
      if (taxonomy.length > 0) {
        return fail("invalid_mutation", taxonomy[0]?.message ?? "Invalid category.");
      }
      if (!allowedAssetIds.has(mutation.defaultVariant.currentAssetId)) {
        return fail("invalid_mutation", "Selected asset is not available for this partner.");
      }
      const collectionIds = uniqueSorted(mutation.collectionIds ?? []);
      for (const collectionId of collectionIds) {
        const collection = findCollection(catalog, collectionId);
        if (!collection || collection.partnerId !== working.partnerId || collection.owner !== "partner") {
          return fail("unknown_id", "Unknown Collection.");
        }
      }
      const derived = deriveProductCreateIds({
        partnerId: working.partnerId,
        name: mutation.name,
        productCreationSlug: mutation.productCreationSlug,
        finishLabel: mutation.defaultVariant.finishLabel ?? null,
        variantCreationSlug: mutation.defaultVariant.creationSlug,
      });
      if (!("productId" in derived)) return derived;
      if (findProduct(catalog, derived.productId) || findPendingProduct(working, derived.productId)) {
        return fail("invalid_mutation", "A product with this identity already exists.");
      }
      if (findVariant(catalog, derived.variantId) || findPendingCreate(working, derived.variantId)) {
        return fail("invalid_mutation", "A variant with this identity already exists.");
      }
      working.products.create.push({
        productId: derived.productId,
        name: mutation.name,
        imageUrl: mutation.imageUrl,
        productUrl: mutation.productUrl,
        priceAmount: mutation.priceAmount,
        priceCurrency: currency,
        categoryId: mutation.categoryId,
        subcategoryId: mutation.subcategoryId ?? null,
        defaultVariantId: derived.variantId,
      });
      working.products.create = sortProductCreates(working.products.create);
      working.variants.create.push({
        variantId: derived.variantId,
        productId: derived.productId,
        finishLabel: mutation.defaultVariant.finishLabel ?? null,
        sku: mutation.defaultVariant.sku ?? null,
        priceAmount: mutation.priceAmount,
        priceCurrency: currency,
        productUrl: mutation.defaultVariant.productUrl ?? null,
        currentAssetId: mutation.defaultVariant.currentAssetId,
      });
      working.variants.create = sortVariantCreates(working.variants.create);
      setPendingProductMemberships(working, derived.productId, collectionIds);
      return null;
    }
    case "product.create_edit": {
      const pending = findPendingProduct(working, mutation.productId);
      if (!pending) return fail("unknown_id", "Unknown pending Product.");
      if (mutation.categoryId !== undefined || mutation.subcategoryId !== undefined) {
        const taxonomy = validateBrowseTaxonomy(
          mutation.categoryId ?? pending.categoryId,
          mutation.subcategoryId !== undefined ? mutation.subcategoryId : pending.subcategoryId,
        );
        if (taxonomy.length > 0) {
          return fail("invalid_mutation", taxonomy[0]?.message ?? "Invalid category.");
        }
      }
      if (mutation.collectionIds) {
        for (const collectionId of mutation.collectionIds) {
          const collection = findCollection(catalog, collectionId);
          if (!collection || collection.partnerId !== working.partnerId || collection.owner !== "partner") {
            return fail("unknown_id", "Unknown Collection.");
          }
        }
      }
      const nextProduct: PartnerCatalogProductCreate = {
        ...pending,
        name: mutation.name ?? pending.name,
        imageUrl: mutation.imageUrl ?? pending.imageUrl,
        productUrl: mutation.productUrl ?? pending.productUrl,
        priceAmount: mutation.priceAmount ?? pending.priceAmount,
        categoryId: mutation.categoryId ?? pending.categoryId,
        subcategoryId: mutation.subcategoryId !== undefined ? mutation.subcategoryId : pending.subcategoryId,
      };
      working.products.create = sortProductCreates(
        working.products.create.map((item) => (item.productId === mutation.productId ? nextProduct : item)),
      );
      if (mutation.priceAmount !== undefined) {
        working.variants.create = sortVariantCreates(
          working.variants.create.map((item) => (
            item.variantId === pending.defaultVariantId
              ? { ...item, priceAmount: mutation.priceAmount! }
              : item
          )),
        );
      }
      if (mutation.collectionIds) {
        setPendingProductMemberships(working, mutation.productId, mutation.collectionIds);
      }
      return null;
    }
    case "product.create_remove": {
      const pending = findPendingProduct(working, mutation.productId);
      if (!pending) return fail("unknown_id", "Unknown pending Product.");
      working.products.create = working.products.create.filter((item) => item.productId !== mutation.productId);
      working.variants.create = working.variants.create.filter((item) => item.productId !== mutation.productId);
      working.products.update = working.products.update.filter((item) => item.productId !== mutation.productId);
      working.variants.update = working.variants.update.filter((item) => {
        const live = findVariant(catalog, item.variantId);
        return live?.productId !== mutation.productId;
      });
      working.collections.membershipAdd = sortMembership(
        working.collections.membershipAdd.filter((item) => item.productId !== mutation.productId),
      );
      working.collections.membershipRemove = sortMembership(
        working.collections.membershipRemove.filter((item) => item.productId !== mutation.productId),
      );
      return null;
    }
    case "variant.set_finish_label": {
      const variant = findVariant(catalog, mutation.variantId);
      if (!variant) return fail("unknown_id", "Unknown Variant.");
      upsertById(working.variants.update, "variantId", mutation.variantId, {
        finishLabel: mutation.finishLabel,
      });
      return null;
    }
    case "variant.set_sku": {
      const variant = findVariant(catalog, mutation.variantId);
      if (!variant) return fail("unknown_id", "Unknown Variant.");
      upsertById(working.variants.update, "variantId", mutation.variantId, { sku: mutation.sku });
      return null;
    }
    case "variant.set_price": {
      const variant = findVariant(catalog, mutation.variantId);
      if (!variant) return fail("unknown_id", "Unknown Variant.");
      const product = findProduct(catalog, variant.productId);
      if (!product) return fail("unknown_id", "Unknown Product.");
      upsertById(working.variants.update, "variantId", mutation.variantId, {
        priceAmount: mutation.priceAmount,
      });
      if (product.defaultVariantId === variant.variantId) {
        applyPriceCoupling(working, product, mutation.priceAmount);
      }
      return null;
    }
    case "variant.set_product_url": {
      const variant = findVariant(catalog, mutation.variantId);
      if (!variant) return fail("unknown_id", "Unknown Variant.");
      upsertById(working.variants.update, "variantId", mutation.variantId, {
        productUrl: mutation.productUrl,
      });
      return null;
    }
    case "variant.create": {
      if (findPendingProduct(working, mutation.productId)) {
        return fail("invalid_mutation", "Additional variants cannot target a pending Product.");
      }
      const product = findProduct(catalog, mutation.productId);
      if (!product) return fail("unknown_id", "Unknown Product.");
      const derived = deriveVariantCreateId({
        partnerId: working.partnerId,
        productId: mutation.productId,
        finishLabel: mutation.finishLabel,
        creationSlug: mutation.creationSlug,
      });
      if (typeof derived !== "string") return derived;
      if (findVariant(catalog, derived)) {
        return fail("invalid_mutation", "A variant with this identity already exists.");
      }
      if (findPendingCreate(working, derived)) {
        return fail("invalid_mutation", "A pending variant with this identity already exists.");
      }
      if (!allowedAssetIds.has(mutation.currentAssetId)) {
        return fail("invalid_mutation", "Selected asset is not available for this partner.");
      }
      working.variants.create.push({
        variantId: derived,
        productId: mutation.productId,
        finishLabel: mutation.finishLabel,
        sku: mutation.sku,
        priceAmount: mutation.priceAmount,
        priceCurrency: product.priceCurrency,
        productUrl: mutation.productUrl,
        currentAssetId: mutation.currentAssetId,
      });
      working.variants.create = sortVariantCreates(working.variants.create);
      return null;
    }
    case "variant.create_edit": {
      const pending = findPendingCreate(working, mutation.variantId);
      if (!pending) return fail("unknown_id", "Unknown pending Variant.");
      if (mutation.priceAmount !== undefined && pendingDefaultVariant(working, mutation.variantId)) {
        return fail("invalid_mutation", "Default variant price is edited through the Product.");
      }
      if (mutation.currentAssetId != null && !allowedAssetIds.has(mutation.currentAssetId)) {
        return fail("invalid_mutation", "Selected asset is not available for this partner.");
      }
      const next: PartnerCatalogVariantCreate = {
        ...pending,
        finishLabel: mutation.finishLabel !== undefined ? mutation.finishLabel : pending.finishLabel,
        sku: mutation.sku !== undefined ? mutation.sku : pending.sku,
        priceAmount: mutation.priceAmount !== undefined ? mutation.priceAmount : pending.priceAmount,
        productUrl: mutation.productUrl !== undefined ? mutation.productUrl : pending.productUrl,
        currentAssetId: mutation.currentAssetId ?? pending.currentAssetId,
      };
      working.variants.create = sortVariantCreates(
        working.variants.create.map((item) => (item.variantId === mutation.variantId ? next : item)),
      );
      return null;
    }
    case "variant.create_remove": {
      if (!findPendingCreate(working, mutation.variantId)) {
        return fail("unknown_id", "Unknown pending Variant.");
      }
      if (pendingDefaultVariant(working, mutation.variantId)) {
        return fail("invalid_mutation", "Remove the pending Product to remove its default Variant.");
      }
      working.variants.create = working.variants.create.filter((item) => item.variantId !== mutation.variantId);
      return null;
    }
    case "collection.set_name": {
      const collection = findCollection(catalog, mutation.collectionId);
      if (!collection) return fail("unknown_id", "Unknown Collection.");
      upsertById(working.collections.update, "collectionId", mutation.collectionId, {
        name: mutation.name,
      });
      return null;
    }
    case "collection.set_membership": {
      const collection = findCollection(catalog, mutation.collectionId);
      if (!collection) return fail("unknown_id", "Unknown Collection.");
      const pendingProductIds = new Set(working.products.create.map((item) => item.productId));
      const desired = uniqueSorted(mutation.productIds);
      for (const productId of desired) {
        if (pendingProductIds.has(productId)) continue;
        if (!findProduct(catalog, productId)) return fail("unknown_id", "Unknown Product.");
      }
      const liveIds = new Set(collection.productIds);
      const desiredLive = desired.filter((productId) => !pendingProductIds.has(productId));
      const desiredSet = new Set(desiredLive);
      const add = desiredLive
        .filter((productId) => !liveIds.has(productId))
        .map((productId) => ({ productId, collectionId: mutation.collectionId }));
      const remove = [...liveIds]
        .filter((productId) => !desiredSet.has(productId))
        .sort((left, right) => left.localeCompare(right))
        .map((productId) => ({ productId, collectionId: mutation.collectionId }));
      const preservedPending = working.collections.membershipAdd.filter((item) => (
        item.collectionId === mutation.collectionId && pendingProductIds.has(item.productId)
      ));
      working.collections.membershipAdd = sortMembership([
        ...working.collections.membershipAdd.filter((item) => item.collectionId !== mutation.collectionId),
        ...add,
        ...preservedPending,
      ]);
      working.collections.membershipRemove = sortMembership([
        ...working.collections.membershipRemove.filter((item) => item.collectionId !== mutation.collectionId),
        ...remove,
      ]);
      return null;
    }
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return left === right;
}

function normalizeProductPatch(
  patch: PartnerCatalogProductPatch,
  live: StageProduct | null,
): WritableProductPatch | null {
  if (!live) return Object.keys(patch).length > 1 ? { ...patch } : null;
  const next: WritableProductPatch = { productId: patch.productId };
  if (patch.name !== undefined && !sameValue(patch.name, live.name)) next.name = patch.name;
  if (patch.imageUrl !== undefined && !sameValue(patch.imageUrl, live.imageUrl)) next.imageUrl = patch.imageUrl;
  if (patch.productUrl !== undefined && !sameValue(patch.productUrl, live.productUrl)) next.productUrl = patch.productUrl;
  if (patch.priceAmount !== undefined && !sameValue(patch.priceAmount, live.priceAmount)) {
    next.priceAmount = patch.priceAmount;
  }
  if (patch.priceCurrency !== undefined && !sameValue(patch.priceCurrency, live.priceCurrency)) {
    next.priceCurrency = patch.priceCurrency;
  }
  if (patch.categoryId !== undefined && !sameValue(patch.categoryId, live.categoryId)) next.categoryId = patch.categoryId;
  if (patch.subcategoryId !== undefined && !sameValue(patch.subcategoryId, live.subcategoryId)) {
    next.subcategoryId = patch.subcategoryId;
  }
  if (patch.defaultVariantId !== undefined && !sameValue(patch.defaultVariantId, live.defaultVariantId)) {
    next.defaultVariantId = patch.defaultVariantId;
  }
  if (patch.brand !== undefined && !sameValue(patch.brand, live.brand)) next.brand = patch.brand;
  if (patch.retailer !== undefined && !sameValue(patch.retailer, live.retailer)) next.retailer = patch.retailer;
  if (patch.partnerId !== undefined && !sameValue(patch.partnerId, live.partnerId)) next.partnerId = patch.partnerId;
  if (patch.source !== undefined && !sameValue(patch.source, live.source)) next.source = patch.source;
  return Object.keys(next).length === 1 ? null : next;
}

function normalizeVariantPatch(
  patch: PartnerCatalogVariantPatch,
  live: StageVariant | null,
): WritableVariantPatch | null {
  if (!live) return Object.keys(patch).length > 1 ? { ...patch } : null;
  const next: WritableVariantPatch = { variantId: patch.variantId };
  if (patch.productId !== undefined && !sameValue(patch.productId, live.productId)) next.productId = patch.productId;
  if (patch.finishLabel !== undefined && !sameValue(patch.finishLabel, live.finishLabel)) {
    next.finishLabel = patch.finishLabel;
  }
  if (patch.sku !== undefined && !sameValue(patch.sku, live.sku)) next.sku = patch.sku;
  if (patch.priceAmount !== undefined && !sameValue(patch.priceAmount, live.priceAmount)) {
    next.priceAmount = patch.priceAmount;
  }
  if (patch.priceCurrency !== undefined && !sameValue(patch.priceCurrency, live.priceCurrency)) {
    next.priceCurrency = patch.priceCurrency;
  }
  if (patch.productUrl !== undefined && !sameValue(patch.productUrl, live.productUrl)) {
    next.productUrl = patch.productUrl;
  }
  if (patch.currentAssetId !== undefined && !sameValue(patch.currentAssetId, live.assetId)) {
    next.currentAssetId = patch.currentAssetId;
  }
  return Object.keys(next).length === 1 ? null : next;
}

function normalizeCollectionPatch(
  patch: PartnerCatalogCollectionPatch,
  live: StageCollection | null,
): WritableCollectionPatch | null {
  if (!live) return Object.keys(patch).length > 1 ? { ...patch } : null;
  const next: WritableCollectionPatch = { collectionId: patch.collectionId };
  if (patch.name !== undefined && !sameValue(patch.name, live.name)) next.name = patch.name;
  if (patch.partnerId !== undefined && !sameValue(patch.partnerId, live.partnerId)) next.partnerId = patch.partnerId;
  if (patch.owner !== undefined && !sameValue(patch.owner, live.owner)) next.owner = patch.owner;
  if (patch.partnerName !== undefined && !sameValue(patch.partnerName, live.partnerName)) {
    next.partnerName = patch.partnerName;
  }
  if (patch.slug !== undefined) next.slug = patch.slug;
  return Object.keys(next).length === 1 ? null : next;
}

export function normalizePartnerDraftDocument(
  document: PartnerCatalogSyncDocument,
  catalog: StageCatalogSnapshot,
  partnerId: string,
): PartnerCatalogSyncDocument {
  const working = cloneDocument(document);
  working.partnerId = partnerId;
  working.products.update = working.products.update
    .map((patch) => normalizeProductPatch(patch, findProduct(catalog, patch.productId)))
    .filter((item): item is WritableProductPatch => item != null)
    .sort((left, right) => left.productId.localeCompare(right.productId));
  working.variants.update = working.variants.update
    .map((patch) => normalizeVariantPatch(patch, findVariant(catalog, patch.variantId)))
    .filter((item): item is WritableVariantPatch => item != null)
    .sort((left, right) => left.variantId.localeCompare(right.variantId));
  working.collections.update = working.collections.update
    .map((patch) => normalizeCollectionPatch(patch, findCollection(catalog, patch.collectionId)))
    .filter((item): item is WritableCollectionPatch => item != null)
    .sort((left, right) => left.collectionId.localeCompare(right.collectionId));

  const liveMembership = new Set(
    catalog.collections.flatMap((collection) => (
      collection.productIds.map((productId) => `${collection.collectionId}\0${productId}`)
    )),
  );
  working.collections.membershipAdd = sortMembership(
    working.collections.membershipAdd.filter((item) => (
      !liveMembership.has(`${item.collectionId}\0${item.productId}`)
    )),
  );
  working.collections.membershipRemove = sortMembership(
    working.collections.membershipRemove.filter((item) => (
      liveMembership.has(`${item.collectionId}\0${item.productId}`)
    )),
  );

  const parsed = parsePartnerCatalogSyncJson(working);
  if (!parsed.ok) {
    throw new Error("Normalized Partner draft document must parse.");
  }
  return parsed.document;
}

function canonicalize(
  working: MutablePatchDocument,
  catalog: StageCatalogSnapshot,
  partnerId: string,
): PartnerDraftMutationResult {
  working.partnerId = partnerId;
  working.products.create = sortProductCreates(working.products.create);
  working.products.update.sort((left, right) => left.productId.localeCompare(right.productId));
  working.variants.create = sortVariantCreates(working.variants.create);
  working.variants.update.sort((left, right) => left.variantId.localeCompare(right.variantId));
  working.collections.update.sort((left, right) => left.collectionId.localeCompare(right.collectionId));
  working.collections.membershipAdd = sortMembership(working.collections.membershipAdd);
  working.collections.membershipRemove = sortMembership(working.collections.membershipRemove);
  const parsed = parsePartnerCatalogSyncJson(working);
  if (!parsed.ok) {
    return fail("invalid_document", parsed.issues[0]?.message ?? "Draft document is not parser-valid.");
  }
  try {
    return { ok: true, document: normalizePartnerDraftDocument(parsed.document, catalog, partnerId) };
  } catch {
    return fail("invalid_document", "Draft document is not parser-valid.");
  }
}

export function applyPartnerDraftMutation(
  document: PartnerCatalogSyncDocument,
  liveCatalog: StageCatalogSnapshot,
  mutation: PartnerDraftMutation,
  partnerId: string,
): PartnerDraftMutationResult {
  return applyPartnerDraftMutations(document, liveCatalog, [mutation], partnerId);
}

export function applyPartnerDraftMutations(
  document: PartnerCatalogSyncDocument,
  liveCatalog: StageCatalogSnapshot,
  mutations: readonly PartnerDraftMutation[],
  partnerId: string,
): PartnerDraftMutationResult {
  if (mutations.length === 0) return fail("invalid_mutation", "Invalid draft mutation.");
  const working = cloneDocument(document);
  working.partnerId = partnerId;
  const allowedAssetIds = partnerReadyAssetIdSet(liveCatalog);
  for (const mutation of mutations) {
    const error = applyOne(working, liveCatalog, mutation, allowedAssetIds);
    if (error) return error;
  }
  return canonicalize(working, liveCatalog, partnerId);
}
