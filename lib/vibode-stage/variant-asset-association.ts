/**
 * PI-5D2B deterministic Variant → current Asset association.
 *
 * Node-only. Updates seed/SQL association artifacts. Does not rewrite
 * Scene Objects, History, Asset intake, or viewer runtime.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { GENERATED_FURNITURE_ASSETS } from "@/lib/afc-v2-runtime/furniture-asset-registry.generated";
import {
  findManifestAsset,
  loadFurnitureAssetManifest,
  writeFileAtomic,
} from "@/lib/afc-v2-runtime/furniture-asset-manifest";
import type { CanonicalFurnitureAssetManifest } from "@/lib/afc-v2-runtime/furniture-asset-manifest-types";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";

import {
  STAGE_SEED_ASSETS,
  STAGE_SEED_CATALOG,
} from "./catalog";
import { retargetVariantCurrentAsset } from "./catalog-store";
import type { StageAsset, StageCatalogSnapshot, StageVariant } from "./types";
import type { GeneratedVariantCurrentAsset } from "./variant-current-asset.map.generated";
import { GENERATED_VARIANT_CURRENT_ASSETS } from "./variant-current-asset.map.generated";

export const VARIANT_ASSOCIATION_MAP_RELATIVE_PATH =
  "lib/vibode-stage/variant-current-asset.map.generated.ts";

export type VariantAssociationIssue = Readonly<{
  code: string;
  message: string;
}>;

export type VariantCurrentAssetAssociation = GeneratedVariantCurrentAsset;

export type VariantAssociationValidationSuccess = Readonly<{
  ok: true;
  variant: StageVariant;
  productId: string;
  assetId: string;
  errors: readonly VariantAssociationIssue[];
}>;

export type VariantAssociationValidationFailure = Readonly<{
  ok: false;
  errors: readonly VariantAssociationIssue[];
}>;

export type VariantAssociationValidationResult =
  | VariantAssociationValidationSuccess
  | VariantAssociationValidationFailure;

export type VariantAssociationWritePlan = Readonly<{
  generatedMap: string;
  migration: string;
  sql: string;
  mapSource: string;
}>;

export type VariantAssociationRetargetSuccess = Readonly<{
  ok: true;
  noop: boolean;
  check: boolean;
  variantId: string;
  productId: string;
  assetId: string;
  previousAssetId: string | null;
  errors: readonly VariantAssociationIssue[];
  written: Readonly<{ generatedMap: string; migration: string }> | null;
  plan: VariantAssociationWritePlan | null;
}>;

export type VariantAssociationRetargetFailure = Readonly<{
  ok: false;
  noop: false;
  check: boolean;
  written: null;
  plan: null;
  errors: readonly VariantAssociationIssue[];
}>;

export type VariantAssociationRetargetResult =
  | VariantAssociationRetargetSuccess
  | VariantAssociationRetargetFailure;

export type VariantAssociationValidationInput = Readonly<{
  variantId: string;
  productId: string;
  assetId: string;
  catalog?: StageCatalogSnapshot;
  seedAssets?: readonly StageAsset[];
  manifest?: CanonicalFurnitureAssetManifest;
  repoRoot?: string;
  manifestRepoRoot?: string;
  runtimeAssetIds?: readonly string[];
  runtimeDefinitionKnown?: (assetId: string) => boolean;
}>;

function issue(code: string, message: string): VariantAssociationIssue {
  return { code, message };
}

function tsString(value: string): string {
  return JSON.stringify(value);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function utcTimestamp(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}` +
    `${pad(date.getUTCMonth() + 1)}` +
    `${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}` +
    `${pad(date.getUTCMinutes())}` +
    `${pad(date.getUTCSeconds())}`
  );
}

export function variantAssociationRepoPaths(repoRoot = process.cwd()) {
  return {
    repoRoot,
    generatedMap: path.join(repoRoot, VARIANT_ASSOCIATION_MAP_RELATIVE_PATH),
    migrationsDir: path.join(repoRoot, "supabase/migrations"),
  };
}

export function variantIdMigrationSlug(variantId: string): string {
  return variantId
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^var_vibode_/i, "")
    .replace(/^var_/i, "")
    .toLowerCase();
}

export function variantAssociationMigrationFileName(
  timestamp: string,
  variantId: string,
): string {
  return `${timestamp}_vibode_stage_variant_${variantIdMigrationSlug(variantId)}.sql`;
}

export function sortVariantAssociations(
  associations: readonly VariantCurrentAssetAssociation[],
): VariantCurrentAssetAssociation[] {
  return [...associations].sort((a, b) => a.variantId.localeCompare(b.variantId));
}

export function associationsFromVariants(
  variants: readonly StageVariant[],
): VariantCurrentAssetAssociation[] {
  return sortVariantAssociations(
    variants.flatMap((variant) => {
      if (!variant.assetId) return [];
      return [{
        variantId: variant.variantId,
        productId: variant.productId,
        currentAssetId: variant.assetId,
      }];
    }),
  );
}

export function renderGeneratedVariantCurrentAssetMap(
  associations: readonly VariantCurrentAssetAssociation[],
): string {
  const rows = sortVariantAssociations(associations).map((row) => (
    `    Object.freeze({\n` +
    `      variantId: ${tsString(row.variantId)},\n` +
    `      productId: ${tsString(row.productId)},\n` +
    `      currentAssetId: ${tsString(row.currentAssetId)},\n` +
    `    })`
  ));
  return (
    `/**\n` +
    ` * GENERATED by PI-5D2B Variant → current Asset association. Do not edit by hand.\n` +
    ` * Regenerator: npm run vibode:retarget-variant\n` +
    ` */\n` +
    `\n` +
    `export type GeneratedVariantCurrentAsset = Readonly<{\n` +
    `  variantId: string;\n` +
    `  productId: string;\n` +
    `  currentAssetId: string;\n` +
    `}>;\n` +
    `\n` +
    `export const GENERATED_VARIANT_CURRENT_ASSETS: readonly GeneratedVariantCurrentAsset[] =\n` +
    `  Object.freeze([\n` +
    `${rows.join(",\n")}${rows.length > 0 ? ",\n" : ""}` +
    `  ]);\n`
  );
}

export function renderVariantCurrentAssetUpdateSql(input: Readonly<{
  variantId: string;
  productId: string;
  assetId: string;
}>): string {
  return (
    `-- PI-5D2B: Variant → current Asset association.\n` +
    `--\n` +
    `-- Updates exactly one Variant.current_asset_id.\n` +
    `-- Does not insert Assets, Products, or Collections.\n` +
    `-- Existing Scene Objects are not rewritten.\n` +
    `\n` +
    `begin;\n` +
    `\n` +
    `do $$\n` +
    `declare\n` +
    `  target_count integer;\n` +
    `begin\n` +
    `  -- Verify target Asset exists and is ready.\n` +
    `  if not exists (\n` +
    `    select 1\n` +
    `    from public.vibode_stage_assets\n` +
    `    where asset_id = ${sqlString(input.assetId)}\n` +
    `      and status = 'ready'\n` +
    `  ) then\n` +
    `    raise exception 'Target Asset is missing or not ready';\n` +
    `  end if;\n` +
    `\n` +
    `  -- Verify exact Product/Variant row exists.\n` +
    `  select count(*)\n` +
    `  into target_count\n` +
    `  from public.vibode_stage_variants\n` +
    `  where variant_id = ${sqlString(input.variantId)}\n` +
    `    and product_id = ${sqlString(input.productId)};\n` +
    `\n` +
    `  if target_count <> 1 then\n` +
    `    raise exception 'Expected exactly one matching Variant';\n` +
    `  end if;\n` +
    `\n` +
    `  update public.vibode_stage_variants\n` +
    `  set current_asset_id = ${sqlString(input.assetId)}\n` +
    `  where variant_id = ${sqlString(input.variantId)}\n` +
    `    and product_id = ${sqlString(input.productId)};\n` +
    `end $$;\n` +
    `\n` +
    `commit;\n`
  );
}

export function validateVariantAssetAssociation(
  input: VariantAssociationValidationInput,
): VariantAssociationValidationResult {
  const errors: VariantAssociationIssue[] = [];
  const catalog = input.catalog ?? STAGE_SEED_CATALOG;
  const variant = catalog.variants.find((item) => item.variantId === input.variantId) ?? null;
  if (!variant) {
    errors.push(issue("UNKNOWN_VARIANT", `Unknown Variant ${input.variantId}.`));
  }

  const product = catalog.products.find((item) => item.productId === input.productId) ?? null;
  if (!product) {
    errors.push(issue("UNKNOWN_PRODUCT", `Unknown Product ${input.productId}.`));
  }

  if (variant && product && variant.productId !== product.productId) {
    errors.push(issue(
      "PRODUCT_VARIANT_MISMATCH",
      `Variant ${input.variantId} belongs to ${variant.productId}, not ${input.productId}.`,
    ));
  } else if (variant && variant.productId !== input.productId) {
    errors.push(issue(
      "PRODUCT_VARIANT_MISMATCH",
      `Variant ${input.variantId} belongs to ${variant.productId}, not ${input.productId}.`,
    ));
  }

  const loaded = input.manifest
    ? { ok: true as const, manifest: input.manifest }
    : loadFurnitureAssetManifest(input.manifestRepoRoot ?? process.cwd());
  if (!loaded.ok) {
    for (const item of loaded.errors) {
      errors.push(issue(item.code, item.message));
    }
  } else {
    const published = findManifestAsset(loaded.manifest, input.assetId);
    if (!published) {
      errors.push(issue("UNKNOWN_ASSET", `Unknown Asset ${input.assetId}.`));
    } else if (published.status !== "ready") {
      errors.push(issue("UNAVAILABLE_ASSET", `Asset ${input.assetId} is not ready.`));
    }
  }

  const runtimeAssetIds = input.runtimeAssetIds ??
    GENERATED_FURNITURE_ASSETS.map((asset) => asset.assetId);
  if (!runtimeAssetIds.includes(input.assetId)) {
    errors.push(issue(
      "RUNTIME_MISSING_ASSET",
      `Asset ${input.assetId} is missing from the generated runtime registry.`,
    ));
  }

  const seedAssets = input.seedAssets ?? catalog.assets ?? STAGE_SEED_ASSETS;
  const seedAsset = seedAssets.find((asset) => asset.assetId === input.assetId) ?? null;
  if (!seedAsset) {
    errors.push(issue("SEED_MISSING_ASSET", `Asset ${input.assetId} is missing from seed Assets.`));
  } else if (seedAsset.status !== "ready") {
    errors.push(issue("UNAVAILABLE_ASSET", `Seed Asset ${input.assetId} is not ready.`));
  }

  const runtimeKnown = input.runtimeDefinitionKnown ??
    ((assetId: string) => furnitureAssetDefinition(assetId) != null);
  if (!runtimeKnown(input.assetId)) {
    errors.push(issue(
      "UNKNOWN_RUNTIME_DEFINITION",
      `Asset ${input.assetId} is unknown to furnitureAssetDefinition.`,
    ));
  }

  if (errors.length > 0 || !variant) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    variant,
    productId: input.productId,
    assetId: input.assetId,
    errors: [],
  };
}

export function retargetVariantCurrentAssetStrict(
  catalog: StageCatalogSnapshot,
  input: Readonly<{
    variantId: string;
    productId: string;
    assetId: string;
  }>,
  gates?: Omit<VariantAssociationValidationInput, "variantId" | "productId" | "assetId" | "catalog">,
): Readonly<{
  ok: true;
  noop: boolean;
  catalog: StageCatalogSnapshot;
  errors: readonly VariantAssociationIssue[];
}> | Readonly<{
  ok: false;
  noop: false;
  catalog: null;
  errors: readonly VariantAssociationIssue[];
}> {
  const validation = validateVariantAssetAssociation({
    ...input,
    ...gates,
    catalog,
  });
  if (!validation.ok) {
    return { ok: false, noop: false, catalog: null, errors: validation.errors };
  }
  if (validation.variant.assetId === input.assetId) {
    return { ok: true, noop: true, catalog, errors: [] };
  }
  const next = retargetVariantCurrentAsset(catalog, input.variantId, input.assetId);
  if (!next) {
    return {
      ok: false,
      noop: false,
      catalog: null,
      errors: [issue("UNKNOWN_VARIANT", `Unknown Variant ${input.variantId}.`)],
    };
  }
  return { ok: true, noop: false, catalog: next, errors: [] };
}

function failRetarget(
  errors: readonly VariantAssociationIssue[],
  check: boolean,
): VariantAssociationRetargetFailure {
  return {
    ok: false,
    noop: false,
    check,
    written: null,
    plan: null,
    errors,
  };
}

export function planVariantCurrentAssetRetarget(input: Readonly<{
  variantId: string;
  productId: string;
  assetId: string;
  repoRoot?: string;
  migrationTimestamp?: string;
  currentAssociations?: readonly VariantCurrentAssetAssociation[];
}>): VariantAssociationWritePlan {
  const repoRoot = input.repoRoot ?? process.cwd();
  const paths = variantAssociationRepoPaths(repoRoot);
  const current = input.currentAssociations ?? GENERATED_VARIANT_CURRENT_ASSETS;
  const next = sortVariantAssociations([
    ...current.filter((row) => row.variantId !== input.variantId),
    {
      variantId: input.variantId,
      productId: input.productId,
      currentAssetId: input.assetId,
    },
  ]);
  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  const migration = path.join(
    paths.migrationsDir,
    variantAssociationMigrationFileName(timestamp, input.variantId),
  );
  return {
    generatedMap: paths.generatedMap,
    migration,
    sql: renderVariantCurrentAssetUpdateSql(input),
    mapSource: renderGeneratedVariantCurrentAssetMap(next),
  };
}

export function retargetVariantCurrentAssetAssociation(input: Readonly<{
  variantId: string;
  productId: string;
  assetId: string;
  repoRoot?: string;
  check?: boolean;
  migrationTimestamp?: string;
  catalog?: StageCatalogSnapshot;
  currentAssociations?: readonly VariantCurrentAssetAssociation[];
  seedAssets?: readonly StageAsset[];
  manifest?: CanonicalFurnitureAssetManifest;
  runtimeAssetIds?: readonly string[];
  runtimeDefinitionKnown?: (assetId: string) => boolean;
}>): VariantAssociationRetargetResult {
  const check = input.check === true;
  const validation = validateVariantAssetAssociation(input);
  if (!validation.ok) return failRetarget(validation.errors, check);

  const current = input.currentAssociations ?? GENERATED_VARIANT_CURRENT_ASSETS;
  const existing = current.find((row) => (
    row.variantId === input.variantId && row.productId === input.productId
  ));
  const previousAssetId = existing?.currentAssetId ?? validation.variant.assetId;
  if (previousAssetId === input.assetId) {
    return {
      ok: true,
      noop: true,
      check,
      variantId: input.variantId,
      productId: input.productId,
      assetId: input.assetId,
      previousAssetId,
      errors: [],
      written: null,
      plan: null,
    };
  }

  const timestamp = input.migrationTimestamp ?? utcTimestamp();
  if (!/^\d{14}$/.test(timestamp)) {
    return failRetarget([
      issue("INVALID_TIMESTAMP", "migration timestamp must be YYYYMMDDHHMMSS."),
    ], check);
  }

  const plan = planVariantCurrentAssetRetarget({
    variantId: input.variantId,
    productId: input.productId,
    assetId: input.assetId,
    repoRoot: input.repoRoot,
    migrationTimestamp: timestamp,
    currentAssociations: current,
  });

  if (check) {
    return {
      ok: true,
      noop: false,
      check: true,
      variantId: input.variantId,
      productId: input.productId,
      assetId: input.assetId,
      previousAssetId,
      errors: [],
      written: null,
      plan,
    };
  }

  if (existsSync(plan.migration)) {
    return failRetarget([
      issue("MIGRATION_EXISTS", `Association migration already exists: ${plan.migration}`),
    ], check);
  }

  try {
    writeFileAtomic(plan.generatedMap, plan.mapSource);
    writeFileAtomic(plan.migration, plan.sql);
  } catch (error) {
    return failRetarget([
      issue(
        "WRITE_FAILED",
        error instanceof Error ? error.message : "Unable to write association artifacts.",
      ),
    ], check);
  }

  return {
    ok: true,
    noop: false,
    check: false,
    variantId: input.variantId,
    productId: input.productId,
    assetId: input.assetId,
    previousAssetId,
    errors: [],
    written: {
      generatedMap: plan.generatedMap,
      migration: plan.migration,
    },
    plan,
  };
}

function sqlQuotedValues(sql: string, column: string): string[] {
  const pattern = new RegExp(`${column}\\s*=\\s*'((?:''|[^'])*)'`, "gi");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql))) {
    values.push((match[1] ?? "").replace(/''/g, "'"));
  }
  return values;
}

export type ParsedVariantAssociationSql = Readonly<{
  variantIds: readonly string[];
  productIds: readonly string[];
  assetIds: readonly string[];
  readyAssetIds: readonly string[];
}>;

export function parseVariantAssociationSql(sql: string): ParsedVariantAssociationSql {
  return {
    variantIds: sqlQuotedValues(sql, "variant_id"),
    productIds: sqlQuotedValues(sql, "product_id"),
    assetIds: sqlQuotedValues(sql, "current_asset_id"),
    readyAssetIds: sqlQuotedValues(sql, "asset_id"),
  };
}

export function isVariantAssociationMigrationFileName(fileName: string): boolean {
  return /^\d{14}_vibode_stage_variant_[a-z0-9_]+\.sql$/.test(fileName);
}

export function listVariantAssociationMigrations(repoRoot = process.cwd()): string[] {
  const dir = variantAssociationRepoPaths(repoRoot).migrationsDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => isVariantAssociationMigrationFileName(name))
    .sort();
}

export function detectVariantAssetAssociationDrift(input: Readonly<{
  repoRoot?: string;
  catalog?: StageCatalogSnapshot;
  associations?: readonly VariantCurrentAssetAssociation[];
  seedAssets?: readonly StageAsset[];
  manifest?: CanonicalFurnitureAssetManifest;
  runtimeAssetIds?: readonly string[];
  runtimeDefinitionKnown?: (assetId: string) => boolean;
}> = {}): VariantAssociationIssue[] {
  const repoRoot = input.repoRoot ?? process.cwd();
  const catalog = input.catalog ?? STAGE_SEED_CATALOG;
  const associations = sortVariantAssociations(
    input.associations ?? GENERATED_VARIANT_CURRENT_ASSETS,
  );
  const issues: VariantAssociationIssue[] = [];
  const associationByVariant = new Map(
    associations.map((row) => [row.variantId, row]),
  );

  for (const variant of catalog.variants) {
    const row = associationByVariant.get(variant.variantId);
    if (!row || !variant.assetId) {
      issues.push(issue(
        "SEED_ASSOCIATION_MISSING",
        `Seed Variant ${variant.variantId} is missing a current Asset association.`,
      ));
      continue;
    }
    if (row.productId !== variant.productId) {
      issues.push(issue(
        "PRODUCT_VARIANT_MISMATCH",
        `Generated association for ${variant.variantId} has product ${row.productId}, seed has ${variant.productId}.`,
      ));
    }
    if (row.currentAssetId !== variant.assetId) {
      issues.push(issue(
        "MAP_SEED_DRIFT",
        `Generated map Asset for ${variant.variantId} is ${row.currentAssetId}, seed has ${variant.assetId}.`,
      ));
    }
    const product = catalog.products.find((item) => item.productId === variant.productId);
    if (!product) {
      issues.push(issue(
        "PRODUCT_VARIANT_MISMATCH",
        `Seed Variant ${variant.variantId} references unknown Product ${variant.productId}.`,
      ));
    }
    const validation = validateVariantAssetAssociation({
      variantId: variant.variantId,
      productId: variant.productId,
      assetId: variant.assetId,
      catalog,
      seedAssets: input.seedAssets,
      manifest: input.manifest,
      repoRoot,
      runtimeAssetIds: input.runtimeAssetIds,
      runtimeDefinitionKnown: input.runtimeDefinitionKnown,
    });
    if (!validation.ok) {
      for (const item of validation.errors) {
        if (item.code === "UNKNOWN_ASSET") {
          issues.push(issue("SEED_UNKNOWN_ASSET", item.message));
        } else if (item.code === "UNAVAILABLE_ASSET") {
          issues.push(issue("SEED_UNAVAILABLE_ASSET", item.message));
        } else if (item.code === "RUNTIME_MISSING_ASSET" || item.code === "UNKNOWN_RUNTIME_DEFINITION") {
          issues.push(issue("SEED_RUNTIME_MISSING", item.message));
        } else {
          issues.push(item);
        }
      }
    }
  }

  const latestByVariant = new Map<string, { fileName: string; sql: string }>();
  for (const fileName of listVariantAssociationMigrations(repoRoot)) {
    const sql = readFileSync(path.join(
      variantAssociationRepoPaths(repoRoot).migrationsDir,
      fileName,
    ), "utf8");
    if (/objects_json/i.test(sql)) {
      issues.push(issue(
        "SQL_TOUCHES_OBJECTS_JSON",
        `${fileName} mentions objects_json.`,
      ));
    }
    if (/vibode_3d_scenes/i.test(sql)) {
      issues.push(issue(
        "SQL_TOUCHES_SCENE_OBJECTS",
        `${fileName} mentions vibode_3d_scenes.`,
      ));
    }
    if (/vibode_stage_products/i.test(sql)) {
      issues.push(issue(
        "SQL_TOUCHES_PRODUCTS",
        `${fileName} modifies Product commercial tables.`,
      ));
    }
    if (/vibode_stage_collections/i.test(sql)) {
      issues.push(issue(
        "SQL_TOUCHES_COLLECTIONS",
        `${fileName} mentions Collections.`,
      ));
    }
    if (/\b(?:insert\s+into|update|delete\s+from)\s+public\.vibode_stage_assets\b/i.test(sql)) {
      issues.push(issue(
        "SQL_TOUCHES_ASSETS",
        `${fileName} inserts or updates technical Asset rows.`,
      ));
    }
    const parsed = parseVariantAssociationSql(sql);
    const variantId = parsed.variantIds[0] ?? null;
    const productId = parsed.productIds[0] ?? null;
    const assetId = parsed.assetIds[0] ?? parsed.readyAssetIds[0] ?? null;
    if (!variantId || !productId || !assetId) {
      issues.push(issue("SQL_WRONG_PRODUCT_OR_VARIANT", `${fileName} is missing association targets.`));
      continue;
    }
    const unique = (values: readonly string[]) => [...new Set(values)];
    if (unique(parsed.variantIds).length !== 1 || unique(parsed.productIds).length !== 1) {
      issues.push(issue(
        "SQL_WRONG_PRODUCT_OR_VARIANT",
        `${fileName} targets more than one Product/Variant.`,
      ));
    }
    const seedVariant = catalog.variants.find((item) => item.variantId === variantId);
    if (!seedVariant) {
      issues.push(issue(
        "SQL_WRONG_PRODUCT_OR_VARIANT",
        `${fileName} targets unknown Variant ${variantId}.`,
      ));
    } else if (seedVariant.productId !== productId) {
      issues.push(issue(
        "SQL_WRONG_PRODUCT_OR_VARIANT",
        `${fileName} targets Product ${productId} for Variant ${variantId}.`,
      ));
    }
    latestByVariant.set(variantId, { fileName, sql });
  }

  for (const [variantId, latest] of latestByVariant) {
    const seedVariant = catalog.variants.find((item) => item.variantId === variantId);
    if (!seedVariant?.assetId) continue;
    const parsed = parseVariantAssociationSql(latest.sql);
    const sqlAssetId = parsed.assetIds[0] ?? null;
    if (sqlAssetId && sqlAssetId !== seedVariant.assetId) {
      issues.push(issue(
        "SQL_ASSET_MISMATCH",
        `${latest.fileName} points at ${sqlAssetId}, seed has ${seedVariant.assetId}.`,
      ));
    }
  }

  const generatedMapPath = variantAssociationRepoPaths(repoRoot).generatedMap;
  if (existsSync(generatedMapPath)) {
    const onDisk = readFileSync(generatedMapPath, "utf8");
    const expected = renderGeneratedVariantCurrentAssetMap(associations);
    if (onDisk !== expected) {
      issues.push(issue(
        "MAP_SEED_DRIFT",
        "Generated Variant current Asset map is not renderer-identical.",
      ));
    }
  }

  return issues;
}
