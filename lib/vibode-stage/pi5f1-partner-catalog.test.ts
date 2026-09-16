import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { detectFurnitureAssetDrift } from "@/lib/afc-v2-runtime/furniture-asset-drift";
import { addSceneObject } from "@/lib/afc-v2-runtime/scene-crud";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
} from "@/lib/afc-v2-runtime/types";

import {
  createStageCatalogSnapshot,
  favoriteKey,
  resolveStagePlacement,
  STAGE_SEED_CATALOG,
  STAGE_SEED_PRODUCTS,
  stageVariantsForProduct,
} from "./catalog";
import { filterStageCatalogProducts, rememberRecentlyUsed } from "./catalog-query";
import { GENERATED_REGISTERED_PRODUCTS } from "./catalog-commercial.generated";
import {
  assembleStageCatalogFromRows,
  FORBIDDEN_STAGE_CATALOG_TABLES,
  resolveLoadedStageCatalog,
  stageCatalogRowsFromSnapshot,
} from "./catalog-store";
import { toggleFavoriteKeys } from "./favorites";
import { detectPartnerCatalogDrift } from "./partner-catalog-drift";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_FURNITURE_PARTNER_NAME,
  DEMO_FURNITURE_PARTNER_SLUG,
  DEMO_LIVING_ROOM_COLLECTION_ID,
  DEMO_LOUNGE_CHAIR_PRODUCT_ID,
  DEMO_LOUNGE_CHAIR_VARIANT_ID,
  DEMO_SOFA_DEFAULT_VARIANT_ID,
  DEMO_SOFA_PRODUCT_ID,
  DEMO_SOFA_STONE_VARIANT_ID,
  emptyExistingPartnerCatalogState,
  forbiddenLegacyPartnerTableHits,
  importPartnerCatalog,
  isPartnerCatalogMigrationFileName,
  listPartnerCatalogMigrations,
  parsePartnerCatalogJson,
  parsePartnerCatalogSql,
  PARTNER_CATALOG_JSON_RELATIVE_PATH,
  partnerCatalogMigrationFileName,
  validatePartnerCatalog,
  validatePartnerIdentity,
  type PartnerCatalogDocument,
} from "./partner-catalog";
import { detectProductVariantRegistrationDrift } from "./product-variant-drift";
import {
  COMMERCIAL_SEED_RELATIVE_PATH,
  isProductRegistrationMigrationFileName,
  isVariantRegistrationMigrationFileName,
  registerProductVariant,
  validateProductVariantRegistration,
} from "./product-variant-register";
import { buildStageSummary } from "./summary";
import type { StagePartner } from "./types";
import {
  detectVariantAssetAssociationDrift,
  isVariantAssociationMigrationFileName,
  VARIANT_ASSOCIATION_MAP_RELATIVE_PATH,
} from "./variant-asset-association";

const ROOT = process.cwd();
const PARTNER_JSON = PARTNER_CATALOG_JSON_RELATIVE_PATH;
const PARTNER_SQL =
  "supabase/migrations/20260915050000_vibode_stage_partner_catalog_demo_furniture_co.sql";
const PARTNER_SCHEMA_SQL = "supabase/migrations/20260915040000_vibode_stage_partners.sql";
const ASSET_A = AFC_V2_RUNTIME_FURNITURE_ASSET_ID;
const ASSET_B = AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID;

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function proofDocument(): PartnerCatalogDocument {
  const parsed = parsePartnerCatalogJson(JSON.parse(source(PARTNER_JSON)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("proof partner JSON invalid");
  return parsed.document;
}

function cloneDocument(mutator: (document: PartnerCatalogDocument) => PartnerCatalogDocument): PartnerCatalogDocument {
  return mutator(structuredClone(proofDocument()));
}

function emptyGates(overrides: Parameters<typeof validatePartnerCatalog>[1] = {}) {
  return {
    catalog: STAGE_SEED_CATALOG,
    existingState: emptyExistingPartnerCatalogState(),
    manifestRepoRoot: ROOT,
    ...overrides,
  };
}

function hasCode(
  result: { errors: readonly { code: string }[] },
  code: string,
): boolean {
  return result.errors.some((error) => error.code === code);
}

function tmpRepo(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f1-partner-"));
  mkdirSync(path.join(repoRoot, "lib/vibode-stage"), { recursive: true });
  mkdirSync(path.join(repoRoot, "supabase/migrations"), { recursive: true });
  return repoRoot;
}

function runCli(args: string[], cwd = ROOT) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/vibode-partner-catalog.ts", ...args],
    { cwd, encoding: "utf8" },
  );
}

function snapshotFrozenTree() {
  return {
    commercial: source(COMMERCIAL_SEED_RELATIVE_PATH),
    map: source(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH),
    json: source(PARTNER_JSON),
    schema: source(PARTNER_SCHEMA_SQL),
    viewer: source("components/afc-3d/AfcProductionRoomViewer.tsx"),
    crud: source("lib/afc-v2-runtime/scene-crud.ts"),
    persisted: source("lib/afc-v2-runtime/persisted-scene.ts"),
    migrations: readdirSync(path.join(ROOT, "supabase/migrations")).sort(),
  };
}

function validatedProof() {
  const validated = validatePartnerCatalog(proofDocument(), emptyGates());
  if (!validated.ok) {
    throw new Error(validated.errors.map((item) => item.message).join("; "));
  }
  return validated.parsed;
}

function durablePartnerCatalog() {
  const parsed = validatedProof();
  const products = parsed.products.map((item) => item.product);
  const variants = parsed.products.flatMap((item) => [
    item.defaultVariant,
    ...item.additionalVariants,
  ]);
  const collections = parsed.collections.map((item) => ({
    ...item.collection,
    productIds: Object.freeze(
      products
        .filter((product) => product.collectionIds.includes(item.collection.collectionId))
        .map((product) => product.productId),
    ),
  }));
  return createStageCatalogSnapshot({
    authority: "durable",
    products: [...STAGE_SEED_CATALOG.products, ...products],
    variants: [...STAGE_SEED_CATALOG.variants, ...variants],
    assets: STAGE_SEED_CATALOG.assets,
    collections: [...STAGE_SEED_CATALOG.collections, ...collections],
    partners: [parsed.partner],
  });
}

function catalogQuery(
  catalog: ReturnType<typeof durablePartnerCatalog>,
  input: Partial<Parameters<typeof filterStageCatalogProducts>[0]> = {},
) {
  return filterStageCatalogProducts({
    products: catalog.products,
    variants: catalog.variants,
    partners: catalog.partners,
    catalog,
    mode: "browse",
    query: "",
    categoryId: "living-room",
    subcategoryId: null,
    collectionId: null,
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
    ...input,
  });
}

test("PI-5F1 valid Partner JSON is accepted and UUID/invalid IDs fail closed", () => {
  const parsed = parsePartnerCatalogJson(JSON.parse(source(PARTNER_JSON)));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.document.partner.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(parsed.document.partner.slug, DEMO_FURNITURE_PARTNER_SLUG);
  assert.equal(parsed.document.partner.status, "active");

  const accepted = validatePartnerCatalog(parsed.document, emptyGates());
  assert.equal(accepted.ok, true);

  const uuid = validatePartnerIdentity({
    partnerId: "550e8400-e29b-41d4-a716-446655440000",
    name: "UUID Co.",
    slug: "uuid-co",
    status: "active",
    websiteUrl: null,
    logoUrl: null,
  }, []);
  assert.equal(uuid.some((error) => error.code === "INVALID_PARTNER_ID"), true);

  const invalid = validatePartnerIdentity({
    partnerId: "demo-furniture-co",
    name: DEMO_FURNITURE_PARTNER_NAME,
    slug: DEMO_FURNITURE_PARTNER_SLUG,
    status: "active",
    websiteUrl: "https://example.test",
    logoUrl: null,
  }, []);
  assert.equal(invalid.some((error) => error.code === "INVALID_PARTNER_ID" || error.code === "PARTNER_ID_SLUG_MISMATCH"), true);
});

test("PI-5F1 duplicate Partner ID, duplicate slug, and ID/slug mismatch fail", () => {
  const existing: StagePartner = {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    name: DEMO_FURNITURE_PARTNER_NAME,
    slug: DEMO_FURNITURE_PARTNER_SLUG,
    status: "active",
    websiteUrl: "https://example.test",
    logoUrl: null,
  };
  const conflict = validatePartnerIdentity({
    ...existing,
    slug: "other-slug",
  }, [existing]);
  assert.equal(conflict.some((error) => error.code === "PARTNER_ID_CONFLICT"), true);

  const duplicateSlug = validatePartnerIdentity({
    partnerId: "partner-other-co",
    name: "Other Co.",
    slug: DEMO_FURNITURE_PARTNER_SLUG,
    status: "active",
    websiteUrl: null,
    logoUrl: null,
  }, [existing]);
  assert.equal(duplicateSlug.some((error) => error.code === "DUPLICATE_PARTNER_SLUG"), true);

  const mismatch = validatePartnerIdentity({
    partnerId: "partner-demo-furniture-co",
    name: DEMO_FURNITURE_PARTNER_NAME,
    slug: "not-the-slug",
    status: "active",
    websiteUrl: null,
    logoUrl: null,
  }, []);
  assert.equal(mismatch.some((error) => error.code === "PARTNER_ID_SLUG_MISMATCH"), true);
});

test("PI-5F1 inactive Partner parses but proof import uses active", () => {
  const inactiveRaw = JSON.parse(source(PARTNER_JSON)) as { partner: { status: string } };
  inactiveRaw.partner.status = "inactive";
  const parsed = parsePartnerCatalogJson(inactiveRaw);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.document.partner.status, "inactive");
  const validated = validatePartnerCatalog(parsed.document, emptyGates());
  assert.equal(validated.ok, false);
  assert.equal(hasCode(validated, "PARTNER_INACTIVE"), true);
  assert.equal(proofDocument().partner.status, "active");
});

test("PI-5F1 partner_catalog requires partnerId and curated Products reject it", () => {
  const missing = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: document.products.map((item, index) => (
      index === 0
        ? { ...item, product: { ...item.product, partnerId: null } }
        : item
    )),
  })), emptyGates());
  assert.equal(missing.ok, false);
  assert.equal(hasCode(missing, "MISSING_PARTNER_ID") || hasCode(missing, "PRODUCT_PARTNER_MISMATCH"), true);

  const curated = validateProductVariantRegistration({
    product: {
      ...proofDocument().products[0]!.product,
      source: "vibode_curated",
      partnerId: DEMO_FURNITURE_PARTNER_ID,
      imageUrl: "/vibode-stage/studio-sofa.svg",
      productUrl: null,
      collectionIds: ["col-vibode-picks"],
    },
    defaultVariant: proofDocument().products[0]!.defaultVariant,
  }, { catalog: STAGE_SEED_CATALOG, repoRoot: ROOT, manifestRepoRoot: ROOT });
  assert.equal(curated.ok, false);
  assert.equal(curated.errors.some((error) => error.code === "UNEXPECTED_PARTNER_ID"), true);
});

test("PI-5F1 Product/Variant/Collection namespaces must match Partner slug", () => {
  const otherProduct = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: [
      {
        ...document.products[0]!,
        product: {
          ...document.products[0]!.product,
          productId: "prod-other-partner-sofa",
        },
      },
      document.products[1]!,
    ],
  })), emptyGates());
  assert.equal(otherProduct.ok, false);
  assert.equal(hasCode(otherProduct, "PRODUCT_NAMESPACE_MISMATCH"), true);

  const otherVariant = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: [
      {
        ...document.products[0]!,
        defaultVariant: {
          ...document.products[0]!.defaultVariant,
          variantId: "var-other-partner-sofa-natural",
        },
        product: {
          ...document.products[0]!.product,
          defaultVariantId: "var-other-partner-sofa-natural",
        },
      },
      document.products[1]!,
    ],
  })), emptyGates());
  assert.equal(otherVariant.ok, false);
  assert.equal(hasCode(otherVariant, "VARIANT_NAMESPACE_MISMATCH"), true);

  const otherCollection = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    collections: [{
      collectionId: "col-other-partner-living",
      name: "Other",
      slug: "living",
    }],
    products: document.products.map((item) => ({
      ...item,
      product: { ...item.product, collectionIds: ["col-other-partner-living"] },
    })),
  })), emptyGates());
  assert.equal(otherCollection.ok, false);
  assert.equal(hasCode(otherCollection, "COLLECTION_NAMESPACE_MISMATCH"), true);
});

test("PI-5F1 partner Collection requires partnerId; Vibode Collections forbid it", () => {
  const parsed = validatedProof();
  assert.equal(parsed.collections[0]?.collection.owner, "partner");
  assert.equal(parsed.collections[0]?.collection.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(parsed.collections[0]?.collection.partnerName, DEMO_FURNITURE_PARTNER_NAME);

  const vibode = STAGE_SEED_CATALOG.collections.find((item) => item.collectionId === "col-vibode-picks");
  assert.equal(vibode?.owner, "vibode");
  assert.equal(vibode?.partnerId, null);

  const mixed = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: [
      {
        ...document.products[0]!,
        product: {
          ...document.products[0]!.product,
          collectionIds: ["col-vibode-picks"],
        },
      },
      document.products[1]!,
    ],
  })), emptyGates());
  assert.equal(mixed.ok, false);
  assert.equal(hasCode(mixed, "COLLECTION_OWNER_MISMATCH"), true);
});

test("PI-5F1 partner Product URL is required HTTPS and image URL is validated", () => {
  const missingUrl = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: [
      {
        ...document.products[0]!,
        product: { ...document.products[0]!.product, productUrl: null },
      },
      document.products[1]!,
    ],
  })), emptyGates());
  assert.equal(missingUrl.ok, false);
  assert.equal(hasCode(missingUrl, "MISSING_PRODUCT_URL"), true);

  const httpUrl = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: [
      {
        ...document.products[0]!,
        product: { ...document.products[0]!.product, productUrl: "http://example.test/sofa" },
      },
      document.products[1]!,
    ],
  })), emptyGates());
  assert.equal(httpUrl.ok, false);
  assert.equal(hasCode(httpUrl, "INVALID_PRODUCT_URL"), true);

  const javascriptUrl = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: [
      {
        ...document.products[0]!,
        product: { ...document.products[0]!.product, productUrl: "javascript:alert(1)" },
      },
      document.products[1]!,
    ],
  })), emptyGates());
  assert.equal(javascriptUrl.ok, false);
  assert.equal(hasCode(javascriptUrl, "INVALID_PRODUCT_URL"), true);

  const httpsImage = validatedProof();
  assert.match(httpsImage.products[0]!.product.imageUrl, /^https:\/\//);

  const badImage = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: [
      {
        ...document.products[0]!,
        product: { ...document.products[0]!.product, imageUrl: "ftp://example.test/sofa.jpg" },
      },
      document.products[1]!,
    ],
  })), emptyGates());
  assert.equal(badImage.ok, false);
  assert.equal(hasCode(badImage, "INVALID_IMAGE_URL"), true);
});

test("PI-5F1 SKU is unique within a Partner and allowed across Partners", () => {
  const duplicate = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: [
      document.products[0]!,
      {
        ...document.products[1]!,
        defaultVariant: {
          ...document.products[1]!.defaultVariant,
          sku: document.products[0]!.defaultVariant.sku,
        },
      },
    ],
  })), emptyGates());
  assert.equal(duplicate.ok, false);
  assert.equal(hasCode(duplicate, "DUPLICATE_SKU"), true);

  const otherPartner = {
    partnerId: "partner-other-furniture-co",
    name: "Other Furniture Co.",
    slug: "other-furniture-co",
    status: "active" as const,
    websiteUrl: "https://example.test",
    logoUrl: null,
  };
  const sharedSku = proofDocument().products[0]!.defaultVariant.sku;
  const catalog = createStageCatalogSnapshot({
    authority: "durable",
    products: [
      ...STAGE_SEED_CATALOG.products,
      {
        productId: "prod-other-furniture-co-item",
        brand: otherPartner.name,
        name: "Other Item",
        retailer: otherPartner.name,
        categoryId: "living-room",
        subcategoryId: "sofas",
        productUrl: "https://example.test/other",
        imageUrl: "https://example.test/other.jpg",
        priceAmount: 10,
        priceCurrency: "USD",
        defaultVariantId: "var-other-furniture-co-item-default",
        collectionIds: ["col-other-furniture-co-items"],
        source: "partner_catalog",
        partnerId: otherPartner.partnerId,
      },
    ],
    variants: [
      ...STAGE_SEED_CATALOG.variants,
      {
        variantId: "var-other-furniture-co-item-default",
        productId: "prod-other-furniture-co-item",
        assetId: ASSET_A,
        finishLabel: "Oak",
        sku: sharedSku,
        priceAmount: 10,
        priceCurrency: "USD",
        productUrl: null,
      },
    ],
    assets: STAGE_SEED_CATALOG.assets,
    collections: [
      ...STAGE_SEED_CATALOG.collections,
      {
        collectionId: "col-other-furniture-co-items",
        name: "Other Items",
        owner: "partner",
        partnerName: otherPartner.name,
        partnerId: otherPartner.partnerId,
        productIds: ["prod-other-furniture-co-item"],
      },
    ],
    partners: [otherPartner],
  });
  const crossPartner = validatePartnerCatalog(proofDocument(), emptyGates({ catalog }));
  assert.equal(crossPartner.ok, true);
});

test("PI-5F1 unknown, unavailable, and runtime-missing Assets fail; ready A/B are accepted", () => {
  const unknown = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: [
      {
        ...document.products[0]!,
        defaultVariant: {
          ...document.products[0]!.defaultVariant,
          currentAssetId: "afc-v2-runtime/test-fixtures/not-an-asset",
        },
      },
      document.products[1]!,
    ],
  })), emptyGates());
  assert.equal(unknown.ok, false);
  assert.equal(hasCode(unknown, "UNKNOWN_ASSET"), true);

  const unavailable = validatePartnerCatalog(proofDocument(), emptyGates({
    seedAssets: STAGE_SEED_CATALOG.assets.map((asset) => (
      asset.assetId === ASSET_A ? { ...asset, status: "unavailable" } : asset
    )),
  }));
  assert.equal(unavailable.ok, false);
  assert.equal(hasCode(unavailable, "UNAVAILABLE_ASSET"), true);

  const runtimeMissing = validatePartnerCatalog(proofDocument(), emptyGates({
    runtimeAssetIds: STAGE_SEED_CATALOG.assets
      .map((asset) => asset.assetId)
      .filter((assetId) => assetId !== ASSET_A),
  }));
  assert.equal(runtimeMissing.ok, false);
  assert.equal(hasCode(runtimeMissing, "RUNTIME_MISSING_ASSET"), true);

  const parsed = validatedProof();
  assert.equal(parsed.products[0]?.defaultVariant.assetId, ASSET_A);
  assert.equal(parsed.products[0]?.additionalVariants[0]?.assetId, ASSET_A);
  assert.equal(parsed.products[1]?.defaultVariant.assetId, ASSET_B);
});

test("PI-5F1 malformed JSON and one invalid Product fail the whole plan", () => {
  const malformed = parsePartnerCatalogJson("{");
  assert.equal(malformed.ok, false);
  assert.equal(hasCode(malformed, "INVALID_JSON"), true);

  const parsedJson = parsePartnerCatalogJson(null);
  assert.equal(parsedJson.ok, false);

  const oneInvalid = validatePartnerCatalog(cloneDocument((document) => ({
    ...document,
    products: [
      {
        ...document.products[0]!,
        product: { ...document.products[0]!.product, categoryId: "not-a-category" },
      },
      document.products[1]!,
    ],
  })), emptyGates());
  assert.equal(oneInvalid.ok, false);
  assert.equal(oneInvalid.parsed, null);
  assert.equal(hasCode(oneInvalid, "UNKNOWN_CATEGORY"), true);

  const valid = validatePartnerCatalog(proofDocument(), emptyGates());
  assert.equal(valid.ok, true);
  if (!valid.ok) return;
  assert.equal(valid.parsed.products.length, 2);
  assert.equal(valid.parsed.products[0]?.additionalVariants.length, 1);
  assert.equal(valid.parsed.collections.length, 1);
});

test("PI-5F1 --check writes nothing and write emits one partner catalog SQL file", () => {
  const before = snapshotFrozenTree();
  const repoRoot = tmpRepo();
  const check = importPartnerCatalog({
    document: proofDocument(),
    repoRoot,
    check: true,
    migrationTimestamp: "20990101000000",
    ...emptyGates({ repoRoot }),
  });
  assert.equal(check.ok, true);
  if (!check.ok) return;
  assert.equal(check.written, null);
  assert.equal(existsSync(check.plan.migration), false);
  assert.equal(check.productCount, 2);
  assert.equal(check.variantCount, 3);
  assert.equal(check.collectionCount, 1);

  const written = importPartnerCatalog({
    document: proofDocument(),
    repoRoot,
    migrationTimestamp: "20990101000000",
    ...emptyGates({ repoRoot }),
  });
  assert.equal(written.ok, true);
  if (!written.ok) return;
  assert.ok(written.written);
  assert.equal(existsSync(written.written.migration), true);
  assert.equal(
    path.basename(written.written.migration),
    partnerCatalogMigrationFileName("20990101000000", DEMO_FURNITURE_PARTNER_SLUG),
  );
  const sqlFiles = readdirSync(path.join(repoRoot, "supabase/migrations"))
    .filter((name) => name.endsWith(".sql"));
  assert.deepEqual(sqlFiles, [
    partnerCatalogMigrationFileName("20990101000000", DEMO_FURNITURE_PARTNER_SLUG),
  ]);
  assert.equal(existsSync(path.join(repoRoot, COMMERCIAL_SEED_RELATIVE_PATH)), false);
  assert.equal(existsSync(path.join(repoRoot, VARIANT_ASSOCIATION_MAP_RELATIVE_PATH)), false);
  assert.deepEqual(snapshotFrozenTree(), before);
});

test("PI-5F1 repeat import fails closed and PI-5E write path rejects partner_catalog", () => {
  const repoRoot = tmpRepo();
  const first = importPartnerCatalog({
    document: proofDocument(),
    repoRoot,
    migrationTimestamp: "20990101000000",
    ...emptyGates({ repoRoot }),
  });
  assert.equal(first.ok, true);
  const second = importPartnerCatalog({
    document: proofDocument(),
    repoRoot,
    migrationTimestamp: "20990101000001",
    catalog: STAGE_SEED_CATALOG,
    manifestRepoRoot: ROOT,
  });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.written, null);
  assert.equal(
    hasCode(second, "DUPLICATE_PRODUCT_ID")
      || hasCode(second, "DUPLICATE_COLLECTION_ID")
      || hasCode(second, "DUPLICATE_VARIANT_ID"),
    true,
  );

  const rejected = registerProductVariant({
    input: {
      product: proofDocument().products[0]!.product,
      defaultVariant: proofDocument().products[0]!.defaultVariant,
    },
    repoRoot,
    check: true,
    ...emptyGates({ repoRoot }),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.errors.some((error) => error.code === "PARTNER_CATALOG_DURABLE_ONLY"), true);
});

test("PI-5F1 generated SQL inserts Partner/Collection/Products/Variants/memberships without mutation", () => {
  const sql = source(PARTNER_SQL);
  const parsed = parsePartnerCatalogSql(sql);
  assert.equal(isPartnerCatalogMigrationFileName(path.basename(PARTNER_SQL)), true);
  assert.equal(isProductRegistrationMigrationFileName(path.basename(PARTNER_SQL)), false);
  assert.equal(isVariantRegistrationMigrationFileName(path.basename(PARTNER_SQL)), false);
  assert.equal(isVariantAssociationMigrationFileName(path.basename(PARTNER_SQL)), false);
  assert.equal(parsed.insertsPartner, true);
  assert.equal(parsed.insertsCollection, true);
  assert.equal(parsed.insertsProduct, true);
  assert.equal(parsed.insertsVariant, true);
  assert.equal(parsed.insertsMembership, true);
  assert.equal(parsed.updatesProduct, false);
  assert.equal(parsed.updatesVariant, false);
  assert.equal(parsed.mutatesAssets, false);
  assert.equal(parsed.touchesObjectsJson, false);
  assert.equal(parsed.touchesScenes, false);
  assert.equal(parsed.usesUpsert, false);
  assert.deepEqual([...parsed.forbiddenTables], []);
  assert.equal(parsed.productIds.includes(DEMO_SOFA_PRODUCT_ID), true);
  assert.equal(parsed.productIds.includes(DEMO_LOUNGE_CHAIR_PRODUCT_ID), true);
  assert.equal(parsed.variantIds.includes(DEMO_SOFA_DEFAULT_VARIANT_ID), true);
  assert.equal(parsed.variantIds.includes(DEMO_SOFA_STONE_VARIANT_ID), true);
  assert.equal(parsed.variantIds.includes(DEMO_LOUNGE_CHAIR_VARIANT_ID), true);
  assert.equal(parsed.collectionIds.includes(DEMO_LIVING_ROOM_COLLECTION_ID), true);
  assert.equal(parsed.partnerIds.includes(DEMO_FURNITURE_PARTNER_ID), true);
  assert.match(sql, /source = 'partner_catalog'|partner_catalog/);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.vibode_stage_assets/i);
  assert.doesNotMatch(sql, /update\s+public\.vibode_stage_assets/i);
  assert.doesNotMatch(sql, /update\s+public\.vibode_stage_products/i);
  assert.doesNotMatch(sql, /update\s+public\.vibode_stage_variants/i);
  assert.equal(listPartnerCatalogMigrations(ROOT).includes(path.basename(PARTNER_SQL)), true);
});

test("PI-5F1 durable catalog maps partner Products once; seed fallback stays curated-only", () => {
  const durable = durablePartnerCatalog();
  const sofaHits = durable.products.filter((product) => product.productId === DEMO_SOFA_PRODUCT_ID);
  assert.equal(sofaHits.length, 1);
  assert.equal(sofaHits[0]?.source, "partner_catalog");
  assert.equal(sofaHits[0]?.partnerId, DEMO_FURNITURE_PARTNER_ID);
  assert.equal(
    durable.products.some((product) => product.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID),
    true,
  );
  const collection = durable.collections.find((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID);
  assert.ok(collection);
  assert.equal(collection?.name, "Demo Living Room");
  assert.deepEqual([...collection?.productIds ?? []].sort(), [
    DEMO_LOUNGE_CHAIR_PRODUCT_ID,
    DEMO_SOFA_PRODUCT_ID,
  ].sort());

  const assembled = assembleStageCatalogFromRows(stageCatalogRowsFromSnapshot(durable));
  assert.ok(assembled);
  assert.equal(assembled.products.some((product) => product.productId === DEMO_SOFA_PRODUCT_ID), true);
  assert.equal(assembled.partners[0]?.partnerId, DEMO_FURNITURE_PARTNER_ID);

  const fallback = resolveLoadedStageCatalog({ durable: null, reason: "durable_empty" });
  assert.equal(fallback.authority, "seed_fixture");
  assert.equal(fallback.catalog.products.some((product) => product.source === "partner_catalog"), false);
  assert.equal(fallback.catalog.products.length, STAGE_SEED_PRODUCTS.length);
  assert.equal(
    fallback.catalog.collections.some((item) => item.collectionId === DEMO_LIVING_ROOM_COLLECTION_ID),
    false,
  );
});

test("PI-5F1 Browse, Collections, search, selector, Summary, Favorites, and Recent stay generic", () => {
  const durable = durablePartnerCatalog();
  const search = catalogQuery(durable, { query: "Demo Furniture Co." });
  assert.equal(search.some((product) => product.productId === DEMO_SOFA_PRODUCT_ID), true);
  assert.equal(search.some((product) => product.productId === DEMO_LOUNGE_CHAIR_PRODUCT_ID), true);

  const collection = catalogQuery(durable, {
    mode: "collections",
    collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
    categoryId: null,
  });
  assert.equal(collection.length, 2);

  const sofaVariants = stageVariantsForProduct(DEMO_SOFA_PRODUCT_ID, [], durable);
  assert.equal(sofaVariants.length, 2);
  const chairVariants = stageVariantsForProduct(DEMO_LOUNGE_CHAIR_PRODUCT_ID, [], durable);
  assert.equal(chairVariants.length, 1);

  const detail = source("components/stage/StageProductDetail.tsx");
  const drawer = source("components/stage/StageCatalogDrawer.tsx");
  const card = source("components/stage/StageProductCard.tsx");
  assert.match(detail, /stageVariantsForProduct/);
  assert.match(detail, /variants\.length > 1/);
  assert.doesNotMatch(detail, /partnerId|Demo Furniture/);
  assert.doesNotMatch(card, /partnerId|Demo Furniture/);
  assert.match(drawer, /collection\.name/);
  assert.doesNotMatch(drawer, /partner-demo-furniture-co|Partner tab/);

  const stone = resolveStagePlacement({
    productId: DEMO_SOFA_PRODUCT_ID,
    variantId: DEMO_SOFA_STONE_VARIANT_ID,
    catalog: durable,
  });
  assert.ok(stone);
  const added = addSceneObject({
    objects: [],
    assetId: stone!.assetId,
    identity: {
      productId: stone!.product.productId,
      variantId: stone!.variant.variantId,
    },
    createObjectId: () => "so-demo-sofa-stone",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.object.productId, DEMO_SOFA_PRODUCT_ID);
  assert.equal(added.object.variantId, DEMO_SOFA_STONE_VARIANT_ID);
  assert.equal(added.object.assetId, ASSET_A);
  assert.equal("partnerId" in added.object, false);

  const summary = buildStageSummary({ catalog: durable, objects: [added.object] });
  assert.equal(summary.lines[0]?.brand, DEMO_FURNITURE_PARTNER_NAME);
  assert.equal(summary.lines[0]?.name, "Demo Sofa");
  assert.equal(summary.lines[0]?.variantLabel, "Stone linen");
  assert.equal(summary.lines[0]?.unitPrice, 1399);
  assert.equal(summary.shoppable, true);

  const favorites = toggleFavoriteKeys(new Set(), DEMO_SOFA_PRODUCT_ID, DEMO_SOFA_STONE_VARIANT_ID);
  assert.equal(favorites.has(favoriteKey(DEMO_SOFA_PRODUCT_ID, DEMO_SOFA_STONE_VARIANT_ID)), true);
  assert.deepEqual(rememberRecentlyUsed([], DEMO_SOFA_PRODUCT_ID), [DEMO_SOFA_PRODUCT_ID]);
});

test("PI-5F1 Scene identity, viewer, History, and curated seed stay frozen", () => {
  const durable = durablePartnerCatalog();
  const placement = resolveStagePlacement({
    productId: DEMO_LOUNGE_CHAIR_PRODUCT_ID,
    catalog: durable,
  });
  assert.ok(placement);
  const added = addSceneObject({
    objects: [],
    assetId: placement!.assetId,
    identity: {
      productId: placement!.product.productId,
      variantId: placement!.variant.variantId,
    },
    createObjectId: () => "so-demo-chair",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.deepEqual(
    Object.keys(added.object).sort(),
    ["assetId", "objectId", "productId", "transform", "variantId"].sort(),
  );
  assert.equal(added.object.assetId, ASSET_B);

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const crud = source("lib/afc-v2-runtime/scene-crud.ts");
  const persisted = source("lib/afc-v2-runtime/persisted-scene.ts");
  assert.doesNotMatch(viewer, /partner-catalog|vibode_stage_partners/);
  assert.doesNotMatch(crud, /partnerId/);
  assert.doesNotMatch(persisted, /partnerId/);
  assert.equal(GENERATED_REGISTERED_PRODUCTS.some((product) => product.source === "partner_catalog"), false);
  assert.equal(GENERATED_REGISTERED_PRODUCTS.some((product) => product.partnerId != null), false);
  assert.equal(STAGE_SEED_CATALOG.products.some((product) => product.source === "partner_catalog"), false);
});

test("PI-5F1 partner, Asset, association, and curated commercial drift stay clean", () => {
  assert.deepEqual(detectPartnerCatalogDrift(), []);
  assert.deepEqual(detectPartnerCatalogDrift({ catalog: durablePartnerCatalog() }), []);
  assert.deepEqual(detectFurnitureAssetDrift(), []);
  assert.deepEqual(detectVariantAssetAssociationDrift(), []);
  assert.deepEqual(detectProductVariantRegistrationDrift(), []);
});

test("PI-5F1 schema and import code do not reference forbidden partner systems", () => {
  const files = [
    "lib/vibode-stage/partner-catalog.ts",
    "lib/vibode-stage/partner-catalog-drift.ts",
    "scripts/vibode-partner-catalog.ts",
    PARTNER_SCHEMA_SQL,
    PARTNER_SQL,
  ];
  for (const relative of files) {
    const contents = source(relative);
    const hits = forbiddenLegacyPartnerTableHits(contents).filter((table) => {
      if (relative.endsWith("partner-catalog.ts") && table === "vibode_partners") {
        return /from public\.vibode_partners|references public\.vibode_partners/.test(contents);
      }
      return contents.includes(`public.${table}`) || contents.includes(`from("${table}")`);
    });
    assert.deepEqual(hits, [], relative);
  }
  const schema = source(PARTNER_SCHEMA_SQL);
  assert.match(schema, /create table public.vibode_stage_partners/);
  assert.match(schema, /on delete restrict/);
  assert.match(schema, /vibode_stage_products_partner_source_pairing/);
  assert.match(schema, /vibode_stage_collections_partner_owner_pairing/);
  assert.match(schema, /status = 'active'/);
  assert.match(schema, /to service_role/);
  for (const forbidden of FORBIDDEN_STAGE_CATALOG_TABLES) {
    assert.equal(schema.includes(`public.${forbidden}`), false);
  }
});

test("PI-5F1 CLI exists and live --check of the imported catalog writes nothing", () => {
  const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  assert.equal(
    pkg.scripts["vibode:import-partner-catalog"],
    "node --import tsx scripts/vibode-partner-catalog.ts",
  );
  const before = snapshotFrozenTree();
  const check = runCli(["--input", PARTNER_JSON, "--check"]);
  assert.notEqual(check.status, 0);
  const payload = JSON.parse(check.stdout) as { ok: boolean; written: null };
  assert.equal(payload.ok, false);
  assert.equal(payload.written, null);
  assert.deepEqual(snapshotFrozenTree(), before);
});
