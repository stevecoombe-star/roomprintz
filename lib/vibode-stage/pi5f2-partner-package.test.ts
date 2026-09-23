import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { detectFurnitureAssetDrift } from "@/lib/afc-v2-runtime/furniture-asset-drift";
import {
  loadFurnitureAssetManifest,
  renderFurnitureAssetManifestJson,
} from "@/lib/afc-v2-runtime/furniture-asset-manifest";
import { renderGeneratedFurnitureAssetRegistry } from "@/lib/afc-v2-runtime/furniture-asset-generate";
import { FURNITURE_ASSET_INTAKE_MAX_BYTES } from "@/lib/afc-v2-runtime/furniture-asset-policy";
import { planFurnitureAssetBatch, registerFurnitureAsset } from "@/lib/afc-v2-runtime/furniture-asset-register";
import { exportDeterministicGlb } from "@/lib/afc-v2-runtime/furniture-glb-export";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";
import { encodeGlb } from "@/lib/afc-v2-runtime/glb-binary";
import {
  createPi5f2DemoCoffeeTableObject3D,
  PI5F2_COFFEE_TABLE_ASSET_ID,
  PI5F2_COFFEE_TABLE_AUTHORED_DEPTH_M,
  PI5F2_COFFEE_TABLE_AUTHORED_HEIGHT_M,
  PI5F2_COFFEE_TABLE_AUTHORED_WIDTH_M,
  PI5F2_COFFEE_TABLE_GLB_PUBLIC_PATH,
} from "@/lib/afc-v2-runtime/pi5f2-demo-coffee-table-geometry";
import {
  createPi5f2DemoSideTableObject3D,
  PI5F2_SIDE_TABLE_ASSET_ID,
  PI5F2_SIDE_TABLE_AUTHORED_DEPTH_M,
  PI5F2_SIDE_TABLE_AUTHORED_HEIGHT_M,
  PI5F2_SIDE_TABLE_AUTHORED_WIDTH_M,
  PI5F2_SIDE_TABLE_GLB_PUBLIC_PATH,
} from "@/lib/afc-v2-runtime/pi5f2-demo-side-table-geometry";
import { addSceneObject } from "@/lib/afc-v2-runtime/scene-crud";
import { sha256Hex, validateFurnitureAsset } from "@/lib/afc-v2-runtime/furniture-asset-validate";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
} from "@/lib/afc-v2-runtime/types";

import {
  STAGE_SEED_ASSETS,
  STAGE_SEED_CATALOG,
  STAGE_SEED_PRODUCTS,
} from "./catalog";
import { GENERATED_REGISTERED_PRODUCTS } from "./catalog-commercial.generated";
import { detectPartnerCatalogDrift } from "./partner-catalog-drift";
import {
  DEMO_FURNITURE_PARTNER_ID,
  DEMO_LIVING_ROOM_COLLECTION_ID,
  DEMO_LOUNGE_CHAIR_PRODUCT_ID,
  DEMO_SOFA_PRODUCT_ID,
  parsePartnerCatalogSql,
  PARTNER_CATALOG_JSON_RELATIVE_PATH,
} from "./partner-catalog";
import {
  PI5F2_PACKAGE_RELATIVE_PATH,
} from "./partner-catalog-documents";
import { detectPartnerPackageDrift } from "./partner-package-drift";
import {
  DEMO_COFFEE_TABLE_BLACK_VARIANT_ID,
  DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID,
  DEMO_COFFEE_TABLE_PRODUCT_ID,
  DEMO_SIDE_TABLE_PRODUCT_ID,
  DEMO_SIDE_TABLE_VARIANT_ID,
  importPartnerPackage,
  loadPartnerPackageFromDirectory,
  parsePartnerAssetsJson,
} from "./partner-package";
import { detectProductVariantRegistrationDrift } from "./product-variant-drift";
import { COMMERCIAL_SEED_RELATIVE_PATH } from "./product-variant-register";
import { detectVariantAssetAssociationDrift, VARIANT_ASSOCIATION_MAP_RELATIVE_PATH } from "./variant-asset-association";

const ROOT = process.cwd();
const PACKAGE_DIR = PI5F2_PACKAGE_RELATIVE_PATH;
const F1_JSON = PARTNER_CATALOG_JSON_RELATIVE_PATH;
const F1_SQL = "supabase/migrations/20260915050000_vibode_stage_partner_catalog_demo_furniture_co.sql";
const COFFEE_SRC = path.join(PACKAGE_DIR, "glbs/demo-coffee-table-v1.glb");
const SIDE_SRC = path.join(PACKAGE_DIR, "glbs/demo-side-table-v1.glb");

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function hasCode(
  result: { issues: readonly { code: string }[] },
  code: string,
): boolean {
  return result.issues.some((item) => item.code === code);
}

function snapshotFrozenTree() {
  return {
    f1: source(F1_JSON),
    commercial: source(COMMERCIAL_SEED_RELATIVE_PATH),
    map: source(VARIANT_ASSOCIATION_MAP_RELATIVE_PATH),
    viewer: source("components/afc-3d/AfcProductionRoomViewer.tsx"),
    crud: source("lib/afc-v2-runtime/scene-crud.ts"),
    persisted: source("lib/afc-v2-runtime/persisted-scene.ts"),
  };
}

function seedPreF2Repo(repoRoot: string): void {
  const loaded = loadFurnitureAssetManifest(ROOT);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) throw new Error("ROOT manifest invalid");
  const pre = {
    schemaVersion: 1 as const,
    assets: loaded.manifest.assets.filter((asset) => (
      asset.assetId === AFC_V2_RUNTIME_FURNITURE_ASSET_ID
      || asset.assetId === AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID
      || asset.assetId === "afc-v2-runtime/test-fixtures/pi5d2-side-table"
    )),
  };
  mkdirSync(path.join(repoRoot, "lib/afc-v2-runtime"), { recursive: true });
  mkdirSync(path.join(repoRoot, "supabase/migrations"), { recursive: true });
  mkdirSync(path.join(repoRoot, "public/afc-v2-runtime/test-fixtures"), { recursive: true });
  writeFileSync(
    path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-manifest.json"),
    renderFurnitureAssetManifestJson(pre),
  );
  writeFileSync(
    path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-registry.generated.ts"),
    renderGeneratedFurnitureAssetRegistry(pre.assets),
  );
  writeFileSync(path.join(repoRoot, F1_SQL), source(F1_SQL));
  cpSync(path.join(ROOT, PACKAGE_DIR), path.join(repoRoot, PACKAGE_DIR), { recursive: true });
  for (const name of ["pi4a-sofa.glb", "pi5d-lounge-chair.glb", "pi5d2-side-table.glb"]) {
    cpSync(
      path.join(ROOT, "public/afc-v2-runtime/test-fixtures", name),
      path.join(repoRoot, "public/afc-v2-runtime/test-fixtures", name),
    );
  }
}

function mutatePackage(
  repoRoot: string,
  mutator: (packageDir: string) => void,
): string {
  const packageDir = path.join(repoRoot, PACKAGE_DIR);
  mutator(packageDir);
  return packageDir;
}

function runCli(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", path.join(ROOT, "scripts/vibode-partner-package.ts"), ...args],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env } },
  );
}

function runRegisterCli(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", path.join(ROOT, "scripts/vibode-asset.ts"), "register", ...args],
    { cwd: ROOT, encoding: "utf8" },
  );
}

test("PI-5F2A frozen baseline keeps F1 identities, viewer, and Assets A/B/C", () => {
  const f1 = JSON.parse(source(F1_JSON)) as { products: Array<{ product: { productId: string } }> };
  assert.deepEqual(f1.products.map((item) => item.product.productId).sort(), [
    DEMO_LOUNGE_CHAIR_PRODUCT_ID,
    DEMO_SOFA_PRODUCT_ID,
  ].sort());
  assert.equal(source(F1_JSON).includes("demo-coffee-table"), false);
  const sofa = furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  const chair = furnitureAssetDefinition(AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.ok(sofa && chair);
  assert.equal(
    loadFurnitureAssetManifest(ROOT).ok
      ? loadFurnitureAssetManifest(ROOT).ok && true
      : false,
    true,
  );
  const loaded = loadFurnitureAssetManifest(ROOT);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.manifest.assets[0]?.sha256, "b4843b011fc2506b8b34ddead7571698df91b4ed7e4bde640dfec38e3de02e55");
  assert.equal(loaded.manifest.assets[1]?.sha256, "d5eab07dc73bfd104d2dd8f31ff130676682978e3d9518762dbaa917ff02ee00");
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const persisted = source("lib/afc-v2-runtime/persisted-scene.ts");
  assert.doesNotMatch(viewer, /partner-package|demo-coffee-table-v1|partnerId/);
  assert.doesNotMatch(persisted, /glbUrl|checksum|partnerId|packageId/);
  assert.doesNotMatch(source("lib/afc-v2-runtime/furniture-assets.ts"), /demo-coffee-table-v1/);
});

test("PI-5F2A proof Asset IDs pass D2A validation and URLs are derived", async () => {
  const coffeeBytes = new Uint8Array(readFileSync(path.join(ROOT, COFFEE_SRC)));
  const sideBytes = new Uint8Array(readFileSync(path.join(ROOT, SIDE_SRC)));
  const coffee = await validateFurnitureAsset({
    bytes: coffeeBytes,
    glbPath: COFFEE_SRC,
    assetId: PI5F2_COFFEE_TABLE_ASSET_ID,
    declaredWidthM: PI5F2_COFFEE_TABLE_AUTHORED_WIDTH_M,
    declaredHeightM: PI5F2_COFFEE_TABLE_AUTHORED_HEIGHT_M,
    declaredDepthM: PI5F2_COFFEE_TABLE_AUTHORED_DEPTH_M,
  });
  const side = await validateFurnitureAsset({
    bytes: sideBytes,
    glbPath: SIDE_SRC,
    assetId: PI5F2_SIDE_TABLE_ASSET_ID,
    declaredWidthM: PI5F2_SIDE_TABLE_AUTHORED_WIDTH_M,
    declaredHeightM: PI5F2_SIDE_TABLE_AUTHORED_HEIGHT_M,
    declaredDepthM: PI5F2_SIDE_TABLE_AUTHORED_DEPTH_M,
  });
  assert.equal(coffee.accepted, true, JSON.stringify(coffee.errors));
  assert.equal(side.accepted, true, JSON.stringify(side.errors));
  assert.equal(coffee.sha256, sha256Hex(coffeeBytes));
  assert.equal(side.sha256, sha256Hex(sideBytes));
  assert.equal(Math.abs((coffee.measured?.widthM ?? 0) - 1.2) < 0.02, true);
  assert.equal(Math.abs((coffee.measured?.heightM ?? 0) - 0.4) < 0.02, true);
  assert.equal(Math.abs((coffee.measured?.depthM ?? 0) - 0.6) < 0.02, true);
  assert.equal(Math.abs((side.measured?.widthM ?? 0) - 0.45) < 0.02, true);
  assert.equal(Math.abs((side.measured?.heightM ?? 0) - 0.55) < 0.02, true);
  assert.equal(PI5F2_COFFEE_TABLE_GLB_PUBLIC_PATH, `/${PI5F2_COFFEE_TABLE_ASSET_ID}.glb`);
  assert.equal(PI5F2_SIDE_TABLE_GLB_PUBLIC_PATH, `/${PI5F2_SIDE_TABLE_ASSET_ID}.glb`);
  const againCoffee = await exportDeterministicGlb(createPi5f2DemoCoffeeTableObject3D());
  const againSide = await exportDeterministicGlb(createPi5f2DemoSideTableObject3D());
  assert.equal(sha256Hex(againCoffee), coffee.sha256);
  assert.equal(sha256Hex(againSide), side.sha256);
});

test("PI-5F2A valid package --check writes nothing and overlays planned Assets", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f2-check-"));
  seedPreF2Repo(repoRoot);
  const beforeManifest = readFileSync(path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-manifest.json"), "utf8");
  const beforeMigrations = readdirSync(path.join(repoRoot, "supabase/migrations")).sort();
  const result = await importPartnerPackage({
    packageDir: PACKAGE_DIR,
    repoRoot,
    check: true,
    migrationTimestamp: "20260915100000",
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(result.written, null);
  assert.equal(result.assetPlans.length, 2);
  assert.equal(result.assetPlans.every((item) => item.action === "create"), true);
  assert.equal(result.catalogPlan?.productCount, 2);
  assert.equal(result.catalogPlan?.variantCount, 3);
  assert.equal(result.catalogPlan?.collectionCount, 0);
  assert.equal(
    readFileSync(path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-manifest.json"), "utf8"),
    beforeManifest,
  );
  assert.deepEqual(readdirSync(path.join(repoRoot, "supabase/migrations")).sort(), beforeMigrations);
  assert.equal(existsSync(path.join(repoRoot, "public", PI5F2_COFFEE_TABLE_GLB_PUBLIC_PATH.slice(1))), false);
  assert.equal(result.migrationOrder.length, 3);
  assert.match(path.basename(result.migrationOrder[0] ?? ""), /demo_coffee_table_v1/);
  assert.match(path.basename(result.migrationOrder[1] ?? ""), /demo_side_table_v1/);
  assert.match(path.basename(result.migrationOrder[2] ?? ""), /demo_furniture_co_pi5f2_tables/);
});

test("PI-5F2A package fail-closed: GLB, path, partner, and catalog errors write nothing", async () => {
  async function expectFail(code: string, mutator: (packageDir: string) => void): Promise<void> {
    const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f2-fail-"));
    seedPreF2Repo(repoRoot);
    mutatePackage(repoRoot, mutator);
    const before = readdirSync(path.join(repoRoot, "supabase/migrations")).sort();
    const result = await importPartnerPackage({
      packageDir: PACKAGE_DIR,
      repoRoot,
      migrationTimestamp: "20260915100000",
    });
    assert.equal(result.ok, false, code);
    assert.equal(result.written, null);
    assert.equal(hasCode(result, code), true, `${code}: ${JSON.stringify(result.issues)}`);
    assert.deepEqual(readdirSync(path.join(repoRoot, "supabase/migrations")).sort(), before);
    assert.equal(existsSync(path.join(repoRoot, "public", PI5F2_COFFEE_TABLE_GLB_PUBLIC_PATH.slice(1))), false);
  }

  await expectFail("DUPLICATE_ASSET_ID", (packageDir) => {
    const raw = JSON.parse(readFileSync(path.join(packageDir, "partner-assets.json"), "utf8"));
    raw.assets.push(raw.assets[0]);
    writeFileSync(path.join(packageDir, "partner-assets.json"), `${JSON.stringify(raw, null, 2)}\n`);
  });

  await expectFail("FILE_MISSING", (packageDir) => {
    const raw = JSON.parse(readFileSync(path.join(packageDir, "partner-assets.json"), "utf8"));
    raw.assets[0].file = "glbs/does-not-exist.glb";
    writeFileSync(path.join(packageDir, "partner-assets.json"), `${JSON.stringify(raw, null, 2)}\n`);
  });

  await expectFail("PATH_ESCAPE", (packageDir) => {
    const raw = JSON.parse(readFileSync(path.join(packageDir, "partner-assets.json"), "utf8"));
    raw.assets[0].file = "../demo-furniture-co.partner.json";
    writeFileSync(path.join(packageDir, "partner-assets.json"), `${JSON.stringify(raw, null, 2)}\n`);
  });

  await expectFail("PATH_ESCAPE", (packageDir) => {
    const raw = JSON.parse(readFileSync(path.join(packageDir, "partner-assets.json"), "utf8"));
    const abs = path.join(path.dirname(packageDir), "outside-escape.glb");
    writeFileSync(abs, readFileSync(path.join(packageDir, "glbs/demo-coffee-table-v1.glb")));
    raw.assets[0].file = abs;
    writeFileSync(path.join(packageDir, "partner-assets.json"), `${JSON.stringify(raw, null, 2)}\n`);
  });

  await expectFail("PARTNER_MISMATCH", (packageDir) => {
    const raw = JSON.parse(readFileSync(path.join(packageDir, "partner-assets.json"), "utf8"));
    raw.partnerId = "partner-other-co";
    writeFileSync(path.join(packageDir, "partner-assets.json"), `${JSON.stringify(raw, null, 2)}\n`);
  });

  await expectFail("MALFORMED_GLB", (packageDir) => {
    writeFileSync(path.join(packageDir, "glbs/demo-coffee-table-v1.glb"), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  await expectFail("FILE_TOO_LARGE", (packageDir) => {
    writeFileSync(
      path.join(packageDir, "glbs/demo-coffee-table-v1.glb"),
      Buffer.alloc(FURNITURE_ASSET_INTAKE_MAX_BYTES + 1),
    );
  });

  await expectFail("EXTERNAL_URI", (packageDir) => {
    writeFileSync(path.join(packageDir, "glbs/demo-coffee-table-v1.glb"), Buffer.from(encodeGlb({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      images: [{ uri: "https://example.test/texture.png" }],
      buffers: [{ byteLength: 0 }],
    })));
  });

  await expectFail("NEGATIVE_SCALE", (packageDir) => {
    writeFileSync(path.join(packageDir, "glbs/demo-coffee-table-v1.glb"), Buffer.from(encodeGlb({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ scale: [1, -1, 1] }],
    })));
  });

  await expectFail("EMPTY_SCENE", (packageDir) => {
    writeFileSync(path.join(packageDir, "glbs/demo-coffee-table-v1.glb"), Buffer.from(encodeGlb({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: "Empty" }],
    })));
  });

  await expectFail("DIMENSION_MISMATCH", (packageDir) => {
    const raw = JSON.parse(readFileSync(path.join(packageDir, "partner-assets.json"), "utf8"));
    raw.assets[0].authoredWidthM = 9;
    writeFileSync(path.join(packageDir, "partner-assets.json"), `${JSON.stringify(raw, null, 2)}\n`);
  });

  await expectFail("UNKNOWN_ASSET", (packageDir) => {
    const catalog = JSON.parse(readFileSync(path.join(packageDir, "partner-catalog.json"), "utf8"));
    catalog.products[0].defaultVariant.currentAssetId = "afc-v2-runtime/partners/demo-furniture-co/missing";
    writeFileSync(path.join(packageDir, "partner-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  });

  await expectFail("UNKNOWN_CATEGORY", (packageDir) => {
    const catalog = JSON.parse(readFileSync(path.join(packageDir, "partner-catalog.json"), "utf8"));
    catalog.products[0].product.categoryId = "not-a-category";
    writeFileSync(path.join(packageDir, "partner-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  });

  await expectFail("DUPLICATE_COLLECTION_ID", (packageDir) => {
    const catalog = JSON.parse(readFileSync(path.join(packageDir, "partner-catalog.json"), "utf8"));
    catalog.collections = [{
      collectionId: DEMO_LIVING_ROOM_COLLECTION_ID,
      name: "Demo Living Room",
      slug: "demo-living-room",
    }];
    writeFileSync(path.join(packageDir, "partner-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  });
});

test("PI-5F2A symlink escape fails where testable", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f2-symlink-"));
  seedPreF2Repo(repoRoot);
  const packageDir = path.join(repoRoot, PACKAGE_DIR);
  const outside = path.join(repoRoot, "outside.glb");
  writeFileSync(outside, readFileSync(path.join(ROOT, COFFEE_SRC)));
  const link = path.join(packageDir, "glbs/escape.glb");
  try {
    symlinkSync(outside, link);
  } catch {
    return;
  }
  const raw = JSON.parse(readFileSync(path.join(packageDir, "partner-assets.json"), "utf8"));
  raw.assets[0].file = "glbs/escape.glb";
  writeFileSync(path.join(packageDir, "partner-assets.json"), `${JSON.stringify(raw, null, 2)}\n`);
  const result = await importPartnerPackage({
    packageDir: PACKAGE_DIR,
    repoRoot,
    check: true,
    migrationTimestamp: "20260915100000",
  });
  assert.equal(result.ok, false);
  assert.equal(hasCode(result, "PATH_ESCAPE"), true);
});

test("PI-5F2A duplicate bytes warn, unused Asset warns, existing ready Asset is allowed", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f2-warn-"));
  seedPreF2Repo(repoRoot);
  mutatePackage(repoRoot, (packageDir) => {
    const assets = JSON.parse(readFileSync(path.join(packageDir, "partner-assets.json"), "utf8"));
    assets.assets.push({
      assetId: "afc-v2-runtime/partners/demo-furniture-co/demo-coffee-table-copy",
      file: "glbs/demo-coffee-table-v1.glb",
      authoredWidthM: 1.2,
      authoredHeightM: 0.4,
      authoredDepthM: 0.6,
    });
    writeFileSync(path.join(packageDir, "partner-assets.json"), `${JSON.stringify(assets, null, 2)}\n`);
    const catalog = JSON.parse(readFileSync(path.join(packageDir, "partner-catalog.json"), "utf8"));
    catalog.products[1].defaultVariant.currentAssetId = AFC_V2_RUNTIME_FURNITURE_ASSET_ID;
    writeFileSync(path.join(packageDir, "partner-catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  });
  const result = await importPartnerPackage({
    packageDir: PACKAGE_DIR,
    repoRoot,
    check: true,
    migrationTimestamp: "20260915100000",
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.equal(hasCode(result, "DUPLICATE_BYTES"), true);
  assert.equal(hasCode(result, "UNUSED_ASSET"), true);
});

test("PI-5F2A same published Asset ID + different checksum fails closed", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f2-immutable-"));
  seedPreF2Repo(repoRoot);
  const first = await importPartnerPackage({
    packageDir: PACKAGE_DIR,
    repoRoot,
    migrationTimestamp: "20260915100000",
  });
  assert.equal(first.ok, true, JSON.stringify(first.issues, null, 2));
  const recolored = createPi5f2DemoCoffeeTableObject3D();
  recolored.traverse((child) => {
    const mesh = child as { isMesh?: boolean; material?: { color?: { setHex: (value: number) => void } } };
    if (mesh.isMesh) mesh.material?.color?.setHex(0x111111);
  });
  const differentBytes = await exportDeterministicGlb(recolored);
  assert.notEqual(
    sha256Hex(differentBytes),
    sha256Hex(new Uint8Array(readFileSync(path.join(repoRoot, PACKAGE_DIR, "glbs/demo-coffee-table-v1.glb")))),
  );
  writeFileSync(
    path.join(repoRoot, PACKAGE_DIR, "glbs/demo-coffee-table-v1.glb"),
    Buffer.from(differentBytes),
  );
  const second = await importPartnerPackage({
    packageDir: PACKAGE_DIR,
    repoRoot,
    check: true,
    migrationTimestamp: "20260915110000",
  });
  assert.equal(second.ok, false, JSON.stringify(second.issues, null, 2));
  assert.equal(hasCode(second, "CHECKSUM_MISMATCH"), true);
});

test("PI-5F2A apply writes two GLBs, two Asset SQLs, one catalog SQL, and rewrites registry once", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f2-apply-"));
  seedPreF2Repo(repoRoot);
  const before = snapshotFrozenTree();
  const result = await importPartnerPackage({
    packageDir: PACKAGE_DIR,
    repoRoot,
    migrationTimestamp: "20260915100000",
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues, null, 2));
  assert.ok(result.written);
  assert.equal(result.written?.glbs.length, 2);
  assert.equal(result.written?.assetSqls.length, 2);
  assert.equal(existsSync(path.join(repoRoot, "public", PI5F2_COFFEE_TABLE_GLB_PUBLIC_PATH.slice(1))), true);
  assert.equal(existsSync(path.join(repoRoot, "public", PI5F2_SIDE_TABLE_GLB_PUBLIC_PATH.slice(1))), true);
  const sqlDir = readdirSync(path.join(repoRoot, "supabase/migrations")).sort();
  const assetSqls = sqlDir.filter((name) => name.includes("_vibode_stage_asset_"));
  const catalogSqls = sqlDir.filter((name) => name.includes("_vibode_stage_partner_catalog_"));
  assert.equal(assetSqls.length, 2);
  assert.equal(catalogSqls.length, 2);
  assert.equal(catalogSqls.some((name) => name.includes("pi5f2_tables")), true);
  const manifest = JSON.parse(readFileSync(
    path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-manifest.json"),
    "utf8",
  ));
  assert.equal(manifest.assets.some((asset: { assetId: string }) => asset.assetId === PI5F2_COFFEE_TABLE_ASSET_ID), true);
  assert.equal(manifest.assets.some((asset: { assetId: string }) => asset.assetId === PI5F2_SIDE_TABLE_ASSET_ID), true);
  assert.equal(JSON.stringify(manifest).includes("partnerId"), false);
  assert.equal(JSON.stringify(manifest).includes("productId"), false);
  const registry = readFileSync(
    path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-registry.generated.ts"),
    "utf8",
  );
  assert.match(registry, /demo-coffee-table-v1/);
  assert.match(registry, /demo-side-table-v1/);
  const catalogSql = readFileSync(result.written!.catalogSql, "utf8");
  const parsed = parsePartnerCatalogSql(catalogSql);
  assert.equal(parsed.insertsPartner, false);
  assert.equal(parsed.insertsCollection, false);
  assert.equal(parsed.insertsProduct, true);
  assert.equal(parsed.updatesProduct, false);
  assert.equal(parsed.updatesVariant, false);
  assert.equal(parsed.mutatesAssets, false);
  assert.equal(parsed.touchesScenes, false);
  assert.equal(parsed.productIds.includes(DEMO_COFFEE_TABLE_PRODUCT_ID), true);
  assert.equal(parsed.productIds.includes(DEMO_SIDE_TABLE_PRODUCT_ID), true);
  assert.equal(parsed.variantIds.includes(DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID), true);
  assert.equal(parsed.variantIds.includes(DEMO_COFFEE_TABLE_BLACK_VARIANT_ID), true);
  assert.equal(parsed.variantIds.includes(DEMO_SIDE_TABLE_VARIANT_ID), true);
  assert.equal(parsed.assetIds.includes(PI5F2_COFFEE_TABLE_ASSET_ID), true);
  assert.equal(parsed.assetIds.includes(PI5F2_SIDE_TABLE_ASSET_ID), true);
  assert.equal(existsSync(path.join(repoRoot, COMMERCIAL_SEED_RELATIVE_PATH)), false);
  assert.equal(existsSync(path.join(repoRoot, VARIANT_ASSOCIATION_MAP_RELATIVE_PATH)), false);
  assert.deepEqual(snapshotFrozenTree(), before);
  assert.equal(detectPartnerPackageDrift({ repoRoot }).length, 0);
});

test("PI-5F2A catalog SQL reuses Partner/Collection and keeps two Coffee Table Variants on Asset D", async () => {
  const loaded = loadPartnerPackageFromDirectory({ packageDir: path.join(ROOT, PACKAGE_DIR) });
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.partnerAssets.partnerId, DEMO_FURNITURE_PARTNER_ID);
  const coffee = loaded.catalogDocument.products.find((item) => (
    item.product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID
  ));
  const side = loaded.catalogDocument.products.find((item) => (
    item.product.productId === DEMO_SIDE_TABLE_PRODUCT_ID
  ));
  assert.ok(coffee && side);
  assert.equal(coffee?.defaultVariant.currentAssetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  assert.equal(coffee?.variants[0]?.currentAssetId, PI5F2_COFFEE_TABLE_ASSET_ID);
  assert.equal(side?.defaultVariant.currentAssetId, PI5F2_SIDE_TABLE_ASSET_ID);
  assert.deepEqual([...coffee?.product.collectionIds ?? []], [DEMO_LIVING_ROOM_COLLECTION_ID]);
  assert.equal(loaded.catalogDocument.collections.length, 0);
  const parsedAssets = parsePartnerAssetsJson(JSON.parse(source(path.join(PACKAGE_DIR, "partner-assets.json"))));
  assert.equal(parsedAssets.ok, true);
});

test("PI-5F2A live artifacts, drift, seed fallback, and runtime lookup", () => {
  const coffeeDef = furnitureAssetDefinition(PI5F2_COFFEE_TABLE_ASSET_ID);
  const sideDef = furnitureAssetDefinition(PI5F2_SIDE_TABLE_ASSET_ID);
  assert.ok(coffeeDef && sideDef);
  assert.equal(coffeeDef?.glbUrl, PI5F2_COFFEE_TABLE_GLB_PUBLIC_PATH);
  assert.equal(sideDef?.glbUrl, PI5F2_SIDE_TABLE_GLB_PUBLIC_PATH);
  assert.equal(STAGE_SEED_ASSETS.some((asset) => asset.assetId === PI5F2_COFFEE_TABLE_ASSET_ID), true);
  assert.equal(STAGE_SEED_ASSETS.some((asset) => asset.assetId === PI5F2_SIDE_TABLE_ASSET_ID), true);
  assert.equal(STAGE_SEED_PRODUCTS.some((product) => product.productId === DEMO_COFFEE_TABLE_PRODUCT_ID), false);
  assert.equal(STAGE_SEED_CATALOG.products.some((product) => product.source === "partner_catalog"), false);
  assert.equal(GENERATED_REGISTERED_PRODUCTS.some((product) => product.source === "partner_catalog"), false);
  assert.deepEqual(detectFurnitureAssetDrift(), []);
  assert.deepEqual(detectPartnerCatalogDrift(), []);
  assert.deepEqual(detectPartnerPackageDrift(), []);
  assert.deepEqual(detectVariantAssetAssociationDrift(), []);
  assert.deepEqual(detectProductVariantRegistrationDrift(), []);
  const added = addSceneObject({
    objects: [],
    assetId: PI5F2_COFFEE_TABLE_ASSET_ID,
    identity: {
      productId: DEMO_COFFEE_TABLE_PRODUCT_ID,
      variantId: DEMO_COFFEE_TABLE_NATURAL_VARIANT_ID,
    },
    createObjectId: () => "so-f2-coffee",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.deepEqual(
    Object.keys(added.object).sort(),
    ["assetId", "objectId", "productId", "transform", "variantId"].sort(),
  );
  assert.equal("glbUrl" in added.object, false);
  assert.equal("partnerId" in added.object, false);
  const cache = source("lib/afc-v2-runtime/furniture-template-cache.ts");
  assert.match(cache, /furnitureAssetDefinition/);
  assert.match(cache, /templates\.get\(assetId\)/);
});

test("PI-5F2A retry fails closed when catalog SQL already exists", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f2-retry-"));
  seedPreF2Repo(repoRoot);
  const first = await importPartnerPackage({
    packageDir: PACKAGE_DIR,
    repoRoot,
    migrationTimestamp: "20260915100000",
  });
  assert.equal(first.ok, true, JSON.stringify(first.issues, null, 2));
  const second = await importPartnerPackage({
    packageDir: PACKAGE_DIR,
    repoRoot,
    migrationTimestamp: "20260915100000",
  });
  assert.equal(second.ok, false);
  assert.equal(second.written, null);
  assert.equal(hasCode(second, "MIGRATION_EXISTS"), true);
});

test("PI-5F2A generic batch planner does not write and single-Asset CLI still works", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f2-batch-"));
  seedPreF2Repo(repoRoot);
  const bytes = new Uint8Array(readFileSync(path.join(ROOT, COFFEE_SRC)));
  const plan = await planFurnitureAssetBatch({
    assets: [{
      assetId: PI5F2_COFFEE_TABLE_ASSET_ID,
      bytes,
      authoredWidthM: PI5F2_COFFEE_TABLE_AUTHORED_WIDTH_M,
      authoredHeightM: PI5F2_COFFEE_TABLE_AUTHORED_HEIGHT_M,
      authoredDepthM: PI5F2_COFFEE_TABLE_AUTHORED_DEPTH_M,
    }],
    repoRoot,
    existingAssetPolicy: "fail-duplicate",
    migrationTimestamp: "20990101000000",
  });
  assert.equal(plan.ok, true);
  assert.equal(existsSync(path.join(repoRoot, "public", PI5F2_COFFEE_TABLE_GLB_PUBLIC_PATH.slice(1))), false);
  const registered = await registerFurnitureAsset({
    repoRoot,
    glbPath: path.join(ROOT, COFFEE_SRC),
    assetId: "afc-v2-runtime/test-fixtures/pi5f2-cli-register",
    declaredWidthM: PI5F2_COFFEE_TABLE_AUTHORED_WIDTH_M,
    declaredHeightM: PI5F2_COFFEE_TABLE_AUTHORED_HEIGHT_M,
    declaredDepthM: PI5F2_COFFEE_TABLE_AUTHORED_DEPTH_M,
    migrationTimestamp: "20990101000000",
  });
  assert.equal(registered.ok, true, JSON.stringify(registered.ok ? null : registered.validation.errors));
  const cli = runRegisterCli([
    "--repo-root",
    repoRoot,
    "--glb",
    path.join(ROOT, SIDE_SRC),
    "--asset-id",
    "afc-v2-runtime/test-fixtures/pi5f2-cli-side",
    "--width",
    String(PI5F2_SIDE_TABLE_AUTHORED_WIDTH_M),
    "--height",
    String(PI5F2_SIDE_TABLE_AUTHORED_HEIGHT_M),
    "--depth",
    String(PI5F2_SIDE_TABLE_AUTHORED_DEPTH_M),
    "--migration-timestamp",
    "20990101000001",
  ]);
  assert.equal(cli.status, 0, cli.stderr + cli.stdout);
});

test("PI-5F2A CLI --check on a pre-F2 repo writes nothing", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5f2-cli-"));
  seedPreF2Repo(repoRoot);
  const before = readdirSync(path.join(repoRoot, "supabase/migrations")).sort();
  const check = runCli([
    "--input",
    PACKAGE_DIR,
    "--check",
    "--repo-root",
    repoRoot,
    "--migration-timestamp",
    "20260915100000",
  ]);
  assert.equal(check.status, 0, check.stderr + check.stdout);
  const payload = JSON.parse(check.stdout) as { ok: boolean; written: null };
  assert.equal(payload.ok, true);
  assert.equal(payload.written, null);
  assert.deepEqual(readdirSync(path.join(repoRoot, "supabase/migrations")).sort(), before);
});

test("PI-5F2A package JSON forbids glbUrl and commercial Asset keys", () => {
  const parsed = parsePartnerAssetsJson({
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    assets: [{
      assetId: PI5F2_COFFEE_TABLE_ASSET_ID,
      file: "glbs/demo-coffee-table-v1.glb",
      authoredWidthM: 1.2,
      authoredHeightM: 0.4,
      authoredDepthM: 0.6,
      glbUrl: "/nope.glb",
      productId: "nope",
    }],
  });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.errors.some((item) => item.code === "UNEXPECTED_GLB_URL"), true);
  assert.equal(parsed.errors.some((item) => item.code === "FORBIDDEN_COMMERCIAL_KEY"), true);
});
