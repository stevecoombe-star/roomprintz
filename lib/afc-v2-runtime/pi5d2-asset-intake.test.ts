import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import { detectFurnitureAssetDrift } from "./furniture-asset-drift";
import {
  renderFurnitureAssetInsertSql,
  renderGeneratedFurnitureAssetRegistry,
} from "./furniture-asset-generate";
import {
  loadFurnitureAssetManifest,
  parseFurnitureAssetManifest,
  publicFilePathFromGlbUrl,
  renderFurnitureAssetManifestJson,
} from "./furniture-asset-manifest";
import { seedAssetFromCanonical, runtimeDefinitionFromCanonical } from "./furniture-asset-map";
import { FURNITURE_ASSET_LIFECYCLE, FURNITURE_ASSET_INTAKE_MAX_BYTES } from "./furniture-asset-policy";
import { registerFurnitureAsset } from "./furniture-asset-register";
import {
  sha256Hex,
  validateFurnitureAsset,
  validateFurnitureAssetFile,
} from "./furniture-asset-validate";
import {
  furnitureAssetDefinition,
  registeredFurnitureAssetIds,
} from "./furniture-assets";
import { encodeGlb } from "./glb-binary";
import { installNodeGltfFileReader } from "./node-gltf-file-reader";
import {
  PI4A_SOFA_AUTHORED_DEPTH_M,
  PI4A_SOFA_AUTHORED_HEIGHT_M,
  PI4A_SOFA_AUTHORED_WIDTH_M,
} from "./pi4a-sofa-geometry";
import {
  PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M,
  PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M,
  PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M,
} from "./pi5d-lounge-chair-geometry";
import {
  PI5D2_SIDE_TABLE_ASSET_ID,
  PI5D2_SIDE_TABLE_AUTHORED_DEPTH_M,
  PI5D2_SIDE_TABLE_AUTHORED_HEIGHT_M,
  PI5D2_SIDE_TABLE_AUTHORED_WIDTH_M,
  PI5D2_SIDE_TABLE_GLB_PUBLIC_PATH,
  createPi5d2SideTableObject3D,
} from "./pi5d2-side-table-geometry";
import { addSceneObject } from "./scene-crud";
import { validatePersistedSceneObjects } from "./persisted-scene";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
  AFC_V2_RUNTIME_LOUNGE_CHAIR_GLB_PUBLIC_PATH,
} from "./types";
import { isStageAssetReady, STAGE_SEED_ASSETS } from "@/lib/vibode-stage/catalog";

const ROOT = process.cwd();
const SOFA_GLB = path.join(ROOT, "public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb");
const CHAIR_GLB = path.join(ROOT, "public/afc-v2-runtime/test-fixtures/pi5d-lounge-chair.glb");
const TABLE_GLB = path.join(ROOT, "public/afc-v2-runtime/test-fixtures/pi5d2-side-table.glb");
const C_MIGRATION =
  "supabase/migrations/20260914220000_vibode_stage_asset_pi5d2_side_table.sql";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

installNodeGltfFileReader();

async function exportGlb(object: THREE.Object3D): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error("expected binary GLB");
  }
  return new Uint8Array(result);
}

function runCli(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/vibode-asset.ts", ...args],
    { cwd: ROOT, encoding: "utf8" },
  );
}

test("PI-5D2A valid self-contained metre GLBs pass validation and emit SHA-256", async () => {
  const sofa = await validateFurnitureAssetFile({
    glbPath: SOFA_GLB,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    declaredWidthM: PI4A_SOFA_AUTHORED_WIDTH_M,
    declaredHeightM: PI4A_SOFA_AUTHORED_HEIGHT_M,
    declaredDepthM: PI4A_SOFA_AUTHORED_DEPTH_M,
  });
  const chair = await validateFurnitureAssetFile({
    glbPath: CHAIR_GLB,
    assetId: AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID,
    declaredWidthM: PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M,
    declaredHeightM: PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M,
    declaredDepthM: PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M,
  });
  const table = await validateFurnitureAssetFile({
    glbPath: TABLE_GLB,
    assetId: PI5D2_SIDE_TABLE_ASSET_ID,
    declaredWidthM: PI5D2_SIDE_TABLE_AUTHORED_WIDTH_M,
    declaredHeightM: PI5D2_SIDE_TABLE_AUTHORED_HEIGHT_M,
    declaredDepthM: PI5D2_SIDE_TABLE_AUTHORED_DEPTH_M,
  });
  for (const result of [sofa, chair, table]) {
    assert.equal(result.accepted, true);
    assert.equal(result.parseOk, true);
    assert.equal(result.placementScale, 1);
    assert.equal(result.errors.length, 0);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(sofa.sha256, sha256Hex(new Uint8Array(readFileSync(SOFA_GLB))));
  assert.equal(chair.sha256, sha256Hex(new Uint8Array(readFileSync(CHAIR_GLB))));
  assert.equal(table.sha256, sha256Hex(new Uint8Array(readFileSync(TABLE_GLB))));
});

test("PI-5D2A malformed GLB fails", async () => {
  const result = await validateFurnitureAsset({
    bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
    glbPath: "malformed.glb",
    assetId: "afc-v2-runtime/test-fixtures/malformed",
    declaredWidthM: 1,
    declaredHeightM: 1,
    declaredDepthM: 1,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.errors.some((item) => item.code === "MALFORMED_GLB"), true);
});

test("PI-5D2A empty scene fails", async () => {
  const bytes = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Empty" }],
  });
  const result = await validateFurnitureAsset({
    bytes,
    glbPath: "empty.glb",
    assetId: "afc-v2-runtime/test-fixtures/empty",
    declaredWidthM: 1,
    declaredHeightM: 1,
    declaredDepthM: 1,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.errors.some((item) => item.code === "EMPTY_SCENE"), true);
});

test("PI-5D2A implausible dimensions fail", async () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.02, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x111111 }),
  );
  const bytes = await exportGlb(mesh);
  const result = await validateFurnitureAsset({
    bytes,
    glbPath: "tiny.glb",
    assetId: "afc-v2-runtime/test-fixtures/tiny",
    declaredWidthM: 0.02,
    declaredHeightM: 0.02,
    declaredDepthM: 0.02,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.errors.some((item) => item.code === "IMPLAUSIBLE_SIZE"), true);
});

test("PI-5D2A external URI fails", async () => {
  const bytes = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    images: [{ uri: "https://example.test/texture.png" }],
    buffers: [{ byteLength: 0 }],
  });
  const result = await validateFurnitureAsset({
    bytes,
    glbPath: "external.glb",
    assetId: "afc-v2-runtime/test-fixtures/external",
    declaredWidthM: 1,
    declaredHeightM: 1,
    declaredDepthM: 1,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.errors.some((item) => item.code === "EXTERNAL_URI"), true);
});

test("PI-5D2A unsupported required extension fails", async () => {
  const bytes = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "draco" }],
    extensionsRequired: ["KHR_draco_mesh_compression"],
  });
  const result = await validateFurnitureAsset({
    bytes,
    glbPath: "draco.glb",
    assetId: "afc-v2-runtime/test-fixtures/draco",
    declaredWidthM: 1,
    declaredHeightM: 1,
    declaredDepthM: 1,
  });
  assert.equal(result.accepted, false);
  assert.equal(
    result.errors.some((item) => item.code === "UNSUPPORTED_REQUIRED_EXTENSION"),
    true,
  );
});

test("PI-5D2A measured vs declared mismatch fails and slight drift warns", async () => {
  const mismatch = await validateFurnitureAssetFile({
    glbPath: SOFA_GLB,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    declaredWidthM: 1,
    declaredHeightM: 1,
    declaredDepthM: 1,
  });
  assert.equal(mismatch.accepted, false);
  assert.equal(mismatch.errors.some((item) => item.code === "DIMENSION_MISMATCH"), true);

  const drift = await validateFurnitureAssetFile({
    glbPath: SOFA_GLB,
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    declaredWidthM: 2.22,
    declaredHeightM: PI4A_SOFA_AUTHORED_HEIGHT_M,
    declaredDepthM: PI4A_SOFA_AUTHORED_DEPTH_M,
  });
  assert.equal(drift.accepted, true);
  assert.equal(drift.warnings.some((item) => item.code === "DIMENSION_DRIFT"), true);
});

test("PI-5D2A missing file is detected", async () => {
  const result = await validateFurnitureAssetFile({
    glbPath: path.join(ROOT, "public/afc-v2-runtime/test-fixtures/does-not-exist.glb"),
    assetId: "afc-v2-runtime/test-fixtures/missing",
    declaredWidthM: 1,
    declaredHeightM: 1,
    declaredDepthM: 1,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.errors.some((item) => item.code === "FILE_MISSING"), true);
});

test("PI-5D2A duplicate Asset ID is rejected and checksum replacement cannot reuse an ID", async () => {
  const parsed = parseFurnitureAssetManifest({
    schemaVersion: 1,
    assets: [
      {
        assetId: "dup",
        glbUrl: "/a.glb",
        authoredWidthM: 1,
        authoredHeightM: 1,
        authoredDepthM: 1,
        status: "ready",
        sha256: "a".repeat(64),
      },
      {
        assetId: "dup",
        glbUrl: "/b.glb",
        authoredWidthM: 1,
        authoredHeightM: 1,
        authoredDepthM: 1,
        status: "ready",
        sha256: "b".repeat(64),
      },
    ],
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.equal(parsed.errors.some((item) => item.code === "DUPLICATE_ASSET_ID"), true);

  const before = source("lib/afc-v2-runtime/furniture-asset-manifest.json");
  const duplicate = await registerFurnitureAsset({
    repoRoot: ROOT,
    glbPath: TABLE_GLB,
    assetId: PI5D2_SIDE_TABLE_ASSET_ID,
    declaredWidthM: PI5D2_SIDE_TABLE_AUTHORED_WIDTH_M,
    declaredHeightM: PI5D2_SIDE_TABLE_AUTHORED_HEIGHT_M,
    declaredDepthM: PI5D2_SIDE_TABLE_AUTHORED_DEPTH_M,
    migrationTimestamp: "20990101000000",
  });
  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.equal(duplicate.validation.errors.some((item) => item.code === "DUPLICATE_ASSET_ID"), true);
  assert.equal(source("lib/afc-v2-runtime/furniture-asset-manifest.json"), before);
  assert.equal(
    source("supabase/migrations/20260914220000_vibode_stage_asset_pi5d2_side_table.sql").includes("20990101000000"),
    false,
  );

  const replaced = await registerFurnitureAsset({
    repoRoot: ROOT,
    glbPath: SOFA_GLB,
    assetId: PI5D2_SIDE_TABLE_ASSET_ID,
    declaredWidthM: PI4A_SOFA_AUTHORED_WIDTH_M,
    declaredHeightM: PI4A_SOFA_AUTHORED_HEIGHT_M,
    declaredDepthM: PI4A_SOFA_AUTHORED_DEPTH_M,
    migrationTimestamp: "20990101000001",
  });
  assert.equal(replaced.ok, false);
  if (replaced.ok) return;
  assert.equal(
    replaced.validation.errors.some((item) => (
      item.code === "CHECKSUM_MISMATCH" || item.code === "DUPLICATE_ASSET_ID"
    )),
    true,
  );
  assert.equal(source("lib/afc-v2-runtime/furniture-asset-manifest.json"), before);
});

test("PI-5D2A failed validation does not write artifacts", async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "pi5d2-register-"));
  mkdirSync(path.join(repoRoot, "lib/afc-v2-runtime"), { recursive: true });
  mkdirSync(path.join(repoRoot, "supabase/migrations"), { recursive: true });
  mkdirSync(path.join(repoRoot, "public/afc-v2-runtime/test-fixtures"), { recursive: true });
  const loaded = loadFurnitureAssetManifest(ROOT);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  writeFileSync(
    path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-manifest.json"),
    renderFurnitureAssetManifestJson(loaded.manifest),
  );
  writeFileSync(
    path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-registry.generated.ts"),
    "export const GENERATED_FURNITURE_ASSETS = Object.freeze([]);\n",
  );
  const manifestBefore = readFileSync(
    path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-manifest.json"),
    "utf8",
  );
  const bad = path.join(repoRoot, "broken.glb");
  writeFileSync(bad, Buffer.from("not-a-glb"));
  const result = await registerFurnitureAsset({
    repoRoot,
    glbPath: bad,
    assetId: "afc-v2-runtime/test-fixtures/should-not-write",
    declaredWidthM: 1,
    declaredHeightM: 1,
    declaredDepthM: 1,
    migrationTimestamp: "20260914235959",
  });
  assert.equal(result.ok, false);
  assert.equal(
    readFileSync(path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-manifest.json"), "utf8"),
    manifestBefore,
  );
  assert.equal(
    readFileSync(
      path.join(repoRoot, "lib/afc-v2-runtime/furniture-asset-registry.generated.ts"),
      "utf8",
    ),
    "export const GENERATED_FURNITURE_ASSETS = Object.freeze([]);\n",
  );
});

test("PI-5D2A generated registry is deterministic", () => {
  const loaded = loadFurnitureAssetManifest(ROOT);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const first = renderGeneratedFurnitureAssetRegistry(loaded.manifest.assets);
  const second = renderGeneratedFurnitureAssetRegistry(loaded.manifest.assets);
  assert.equal(first, second);
  assert.equal(first, source("lib/afc-v2-runtime/furniture-asset-registry.generated.ts"));
});

test("PI-5D2A CLI validate/register scripts exist and validate published Assets", () => {
  const pkg = JSON.parse(source("package.json")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["vibode:validate-asset"]?.includes("scripts/vibode-asset.ts validate"), true);
  assert.equal(pkg.scripts["vibode:register-asset"]?.includes("scripts/vibode-asset.ts register"), true);
  assert.equal(pkg.scripts["vibode:generate-assets"]?.includes("scripts/vibode-asset.ts generate"), true);
  const sofa = runCli(["validate", "--asset-id", AFC_V2_RUNTIME_FURNITURE_ASSET_ID]);
  assert.equal(sofa.status, 0, sofa.stderr);
  const payload = JSON.parse(sofa.stdout) as { accepted: boolean; sha256: string };
  assert.equal(payload.accepted, true);
  assert.match(payload.sha256, /^[a-f0-9]{64}$/);
});

test("PI-5D2A intake rejects oversized files and negative scale", async () => {
  const oversized = await validateFurnitureAsset({
    bytes: new Uint8Array(FURNITURE_ASSET_INTAKE_MAX_BYTES + 1),
    glbPath: "huge.glb",
    assetId: "afc-v2-runtime/test-fixtures/huge",
    declaredWidthM: 1,
    declaredHeightM: 1,
    declaredDepthM: 1,
  });
  assert.equal(oversized.accepted, false);
  assert.equal(oversized.errors.some((item) => item.code === "FILE_TOO_LARGE"), true);

  const bytes = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ scale: [1, -1, 1] }],
  });
  const negative = await validateFurnitureAsset({
    bytes,
    glbPath: "neg.glb",
    assetId: "afc-v2-runtime/test-fixtures/negative-scale",
    declaredWidthM: 1,
    declaredHeightM: 1,
    declaredDepthM: 1,
  });
  assert.equal(negative.accepted, false);
  assert.equal(negative.errors.some((item) => item.code === "NEGATIVE_SCALE"), true);
});

test("PI-5D2A lifecycle rules keep unavailable Assets in runtime and forbid ID reuse", () => {
  assert.equal(FURNITURE_ASSET_LIFECYCLE.publishedAssetIdsArePermanent, true);
  assert.equal(FURNITURE_ASSET_LIFECYCLE.publishedFilesAreImmutable, true);
  assert.equal(FURNITURE_ASSET_LIFECYCLE.supersedeRequiresNewAssetId, true);
  assert.equal(FURNITURE_ASSET_LIFECYCLE.catalogMayMarkUnavailable, true);
  assert.equal(FURNITURE_ASSET_LIFECYCLE.unavailableKeepsRuntimeSupport, true);
  assert.equal(FURNITURE_ASSET_LIFECYCLE.doNotDeletePublishedFiles, true);
  assert.equal(FURNITURE_ASSET_LIFECYCLE.doNotReuseAssetIds, true);
  assert.equal(FURNITURE_ASSET_LIFECYCLE.noDeleteAutomation, true);
  const unavailable = seedAssetFromCanonical({
    assetId: "afc-v2-runtime/test-fixtures/unavailable-example",
    glbUrl: "/afc-v2-runtime/test-fixtures/unavailable-example.glb",
    authoredWidthM: 1,
    authoredHeightM: 1,
    authoredDepthM: 1,
    status: "unavailable",
    sha256: "c".repeat(64),
  });
  assert.equal(isStageAssetReady(unavailable), false);
  const runtime = runtimeDefinitionFromCanonical({
    assetId: unavailable.assetId,
    glbUrl: unavailable.glbUrl,
    authoredWidthM: unavailable.authoredWidthM,
    authoredHeightM: unavailable.authoredHeightM,
    authoredDepthM: unavailable.authoredDepthM,
    status: "unavailable",
    sha256: "c".repeat(64),
  });
  assert.equal(runtime.assetId, unavailable.assetId);
  assert.doesNotMatch(source("lib/afc-v2-runtime/furniture-assets.ts"), /status === ["']ready["']/);
  assert.doesNotMatch(source("scripts/vibode-asset.ts"), /\bdelete\b/);
});

test("PI-5D2A commercial fields are forbidden in the canonical manifest", () => {
  const parsed = parseFurnitureAssetManifest({
    schemaVersion: 1,
    assets: [
      {
        assetId: "x",
        glbUrl: "/x.glb",
        authoredWidthM: 1,
        authoredHeightM: 1,
        authoredDepthM: 1,
        status: "ready",
        sha256: "d".repeat(64),
        productId: "nope",
      },
    ],
  });
  assert.equal(parsed.ok, false);
});

test("PI-5D2A Asset C is a distinct generated fixture realized without a viewer registry edit", () => {
  const asset = furnitureAssetDefinition(PI5D2_SIDE_TABLE_ASSET_ID);
  assert.ok(asset);
  assert.equal(asset.glbUrl, PI5D2_SIDE_TABLE_GLB_PUBLIC_PATH);
  assert.equal(asset.authoredWidthM, PI5D2_SIDE_TABLE_AUTHORED_WIDTH_M);
  assert.notEqual(asset.glbUrl, AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH);
  assert.notEqual(asset.glbUrl, AFC_V2_RUNTIME_LOUNGE_CHAIR_GLB_PUBLIC_PATH);
  assert.equal(registeredFurnitureAssetIds().includes(PI5D2_SIDE_TABLE_ASSET_ID), true);
  assert.equal(STAGE_SEED_ASSETS.some((item) => item.assetId === PI5D2_SIDE_TABLE_ASSET_ID), true);
  const added = addSceneObject({
    objects: [],
    assetId: PI5D2_SIDE_TABLE_ASSET_ID,
    createObjectId: () => "so-pi5d2-c",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal(added.object.assetId, PI5D2_SIDE_TABLE_ASSET_ID);
  assert.equal(added.object.transform.uniformScale, 1);
  assert.doesNotMatch(source("lib/afc-v2-runtime/furniture-assets.ts"), /pi5d2-side-table/);
  assert.doesNotMatch(source("components/afc-3d/AfcProductionRoomViewer.tsx"), /pi5d2-side-table/);
  assert.match(source("lib/afc-v2-runtime/furniture-asset-registry.generated.ts"), /pi5d2-side-table/);
  assert.match(source("lib/afc-v2-runtime/furniture-asset-manifest.json"), /pi5d2-side-table/);
  const table = createPi5d2SideTableObject3D();
  assert.equal(table.name, "pi5d2SideTable");
});

test("PI-5D2A Scene Objects still exclude GLB URL and checksum", () => {
  const added = addSceneObject({
    objects: [],
    assetId: PI5D2_SIDE_TABLE_ASSET_ID,
    createObjectId: () => "so-pi5d2-persist",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const validated = validatePersistedSceneObjects(added.objects);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  const json = JSON.stringify(validated.objects);
  assert.doesNotMatch(json, /glbUrl|authoredWidthM|sha256|checksum/);
  assert.equal("glbUrl" in (validated.objects[0] ?? {}), false);
  assert.equal("sha256" in (validated.objects[0] ?? {}), false);
});

test("PI-5D2A repo drift detector is clean and catches checksum/file/URL/dimension failures", () => {
  assert.deepEqual(detectFurnitureAssetDrift(), []);
  const loaded = loadFurnitureAssetManifest(ROOT);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const sofa = loaded.manifest.assets[0];
  assert.ok(sofa);

  const missingRuntime = detectFurnitureAssetDrift({
    runtimeAssets: furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID)
      ? [furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID)!]
      : [],
  });
  assert.equal(missingRuntime.some((item) => item.code === "MANIFEST_MISSING_RUNTIME"), true);

  const extraRuntime = detectFurnitureAssetDrift({
    runtimeAssets: [
      ...registeredFurnitureAssetIds().map((id) => furnitureAssetDefinition(id)!),
      {
        assetId: "not-in-manifest",
        glbUrl: "/missing.glb",
        authoredWidthM: 1,
        authoredHeightM: 1,
        authoredDepthM: 1,
      },
    ],
  });
  assert.equal(extraRuntime.some((item) => item.code === "RUNTIME_MISSING_MANIFEST"), true);

  const seedReady = detectFurnitureAssetDrift({
    seedAssets: [
      ...STAGE_SEED_ASSETS,
      {
        assetId: "seed-only-ready",
        glbUrl: "/seed-only.glb",
        authoredWidthM: 1,
        authoredHeightM: 1,
        authoredDepthM: 1,
        status: "ready",
      },
    ],
  });
  assert.equal(seedReady.some((item) => item.code === "SEED_READY_UNKNOWN_TO_RUNTIME"), true);

  const checksum = detectFurnitureAssetDrift({
    manifest: {
      schemaVersion: 1,
      assets: loaded.manifest.assets.map((asset, index) => (
        index === 0 ? { ...asset, sha256: "e".repeat(64) } : asset
      )),
    },
  });
  assert.equal(checksum.some((item) => item.code === "CHECKSUM_MISMATCH"), true);

  const url = detectFurnitureAssetDrift({
    runtimeAssets: registeredFurnitureAssetIds().map((id) => {
      const asset = furnitureAssetDefinition(id)!;
      if (id !== sofa.assetId) return asset;
      return { ...asset, glbUrl: "/changed.glb" };
    }),
  });
  assert.equal(url.some((item) => item.code === "URL_MISMATCH"), true);

  const dims = detectFurnitureAssetDrift({
    runtimeAssets: registeredFurnitureAssetIds().map((id) => {
      const asset = furnitureAssetDefinition(id)!;
      if (id !== sofa.assetId) return asset;
      return { ...asset, authoredWidthM: 9 };
    }),
  });
  assert.equal(dims.some((item) => item.code === "DIMENSION_MISMATCH"), true);

  const missingFile = detectFurnitureAssetDrift({
    manifest: {
      schemaVersion: 1,
      assets: [
        ...loaded.manifest.assets,
        {
          assetId: "afc-v2-runtime/test-fixtures/missing-file",
          glbUrl: "/afc-v2-runtime/test-fixtures/does-not-exist.glb",
          authoredWidthM: 1,
          authoredHeightM: 1,
          authoredDepthM: 1,
          status: "ready",
          sha256: "f".repeat(64),
        },
      ],
    },
    runtimeAssets: [
      ...registeredFurnitureAssetIds().map((id) => furnitureAssetDefinition(id)!),
      {
        assetId: "afc-v2-runtime/test-fixtures/missing-file",
        glbUrl: "/afc-v2-runtime/test-fixtures/does-not-exist.glb",
        authoredWidthM: 1,
        authoredHeightM: 1,
        authoredDepthM: 1,
      },
    ],
    seedAssets: [
      ...STAGE_SEED_ASSETS,
      {
        assetId: "afc-v2-runtime/test-fixtures/missing-file",
        glbUrl: "/afc-v2-runtime/test-fixtures/does-not-exist.glb",
        authoredWidthM: 1,
        authoredHeightM: 1,
        authoredDepthM: 1,
        status: "ready",
      },
    ],
  });
  assert.equal(missingFile.some((item) => item.code === "FILE_MISSING"), true);
  assert.equal(
    publicFilePathFromGlbUrl(ROOT, sofa.glbUrl).endsWith("public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb"),
    true,
  );
});

test("PI-5D2A certified Assets A and B are unchanged", () => {
  const sofa = furnitureAssetDefinition(AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  const chair = furnitureAssetDefinition(AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.ok(sofa && chair);
  assert.equal(sofa.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(chair.assetId, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.equal(sofa.glbUrl, AFC_V2_RUNTIME_FURNITURE_GLB_PUBLIC_PATH);
  assert.equal(chair.glbUrl, AFC_V2_RUNTIME_LOUNGE_CHAIR_GLB_PUBLIC_PATH);
  assert.equal(sofa.authoredWidthM, PI4A_SOFA_AUTHORED_WIDTH_M);
  assert.equal(sofa.authoredHeightM, PI4A_SOFA_AUTHORED_HEIGHT_M);
  assert.equal(sofa.authoredDepthM, PI4A_SOFA_AUTHORED_DEPTH_M);
  assert.equal(chair.authoredWidthM, PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M);
  assert.equal(chair.authoredHeightM, PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M);
  assert.equal(chair.authoredDepthM, PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M);
  const loaded = loadFurnitureAssetManifest(ROOT);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.equal(loaded.manifest.assets[0]?.assetId, AFC_V2_RUNTIME_FURNITURE_ASSET_ID);
  assert.equal(loaded.manifest.assets[1]?.assetId, AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID);
  assert.equal(
    loaded.manifest.assets[0]?.sha256,
    "b4843b011fc2506b8b34ddead7571698df91b4ed7e4bde640dfec38e3de02e55",
  );
  assert.equal(
    loaded.manifest.assets[1]?.sha256,
    "d5eab07dc73bfd104d2dd8f31ff130676682978e3d9518762dbaa917ff02ee00",
  );
});

test("PI-5D2A manifest/runtime/seed/SQL parity holds for Asset C without Product records", () => {
  const loaded = loadFurnitureAssetManifest(ROOT);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  const canonical = loaded.manifest.assets.find((asset) => asset.assetId === PI5D2_SIDE_TABLE_ASSET_ID);
  assert.ok(canonical);
  const runtime = furnitureAssetDefinition(PI5D2_SIDE_TABLE_ASSET_ID);
  const seed = STAGE_SEED_ASSETS.find((asset) => asset.assetId === PI5D2_SIDE_TABLE_ASSET_ID);
  assert.ok(runtime && seed);
  assert.equal(runtime.glbUrl, canonical.glbUrl);
  assert.equal(seed.glbUrl, canonical.glbUrl);
  assert.equal(seed.status, "ready");
  const sql = source(C_MIGRATION);
  assert.equal(sql, renderFurnitureAssetInsertSql(canonical));
  assert.doesNotMatch(sql, /vibode_stage_products|vibode_stage_variants|current_asset_id/);
  assert.match(sql, /status\n\) values/);
  const certified = loaded.manifest.assets.filter((asset) => (
    asset.assetId === AFC_V2_RUNTIME_FURNITURE_ASSET_ID
    || asset.assetId === AFC_V2_RUNTIME_LOUNGE_CHAIR_ASSET_ID
    || asset.assetId === PI5D2_SIDE_TABLE_ASSET_ID
  ));
  for (const asset of certified) {
    const haystack = [
      source("supabase/migrations/20260914120000_vibode_stage_catalog.sql"),
      source("supabase/migrations/20260914140000_vibode_stage_catalog_lounge_chair_asset.sql"),
      sql,
    ].join("\n");
    assert.match(haystack, new RegExp(asset.assetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(haystack, new RegExp(asset.glbUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("PI-5D2A viewer stays independent of Catalog/Supabase and still resolves assetId", () => {
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const cache = source("lib/afc-v2-runtime/furniture-template-cache.ts");
  const assets = source("lib/afc-v2-runtime/furniture-assets.ts");
  assert.match(viewer, /furnitureAssetDefinition/);
  assert.match(viewer, /templateCache\.template\(definition\.assetId\)/);
  assert.doesNotMatch(viewer, /from "@\/lib\/supabase/);
  assert.doesNotMatch(viewer, /stage-catalog|vibode_stage_assets/);
  assert.doesNotMatch(cache, /vibode_stage_assets|stage-catalog/);
  assert.doesNotMatch(assets, /vibode_stage_assets|stage-catalog|createClient/);
  assert.match(assets, /GENERATED_FURNITURE_ASSETS/);
  assert.match(assets, /PI4A_SOFA_FURNITURE_ASSET/);
  assert.match(assets, /PI5D_LOUNGE_CHAIR_FURNITURE_ASSET/);
});
