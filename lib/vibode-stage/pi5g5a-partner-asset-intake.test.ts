import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import { FURNITURE_ASSET_INTAKE_MAX_BYTES } from "@/lib/afc-v2-runtime/furniture-asset-policy";
import {
  sha256Hex,
  validateFurnitureAsset,
  type AssetValidationResult,
} from "@/lib/afc-v2-runtime/furniture-asset-validate";
import { encodeGlb } from "@/lib/afc-v2-runtime/glb-binary";
import { installNodeGltfFileReader } from "@/lib/afc-v2-runtime/node-gltf-file-reader";
import {
  PI4A_SOFA_AUTHORED_DEPTH_M,
  PI4A_SOFA_AUTHORED_HEIGHT_M,
  PI4A_SOFA_AUTHORED_WIDTH_M,
} from "@/lib/afc-v2-runtime/pi4a-sofa-geometry";
import {
  encodeTexturedFurnitureProbeGlb,
  TEXTURED_FURNITURE_PROBE_DECLARED_M,
} from "@/lib/afc-v2-runtime/textured-furniture-probe-glb";
import { AFC_V2_RUNTIME_FURNITURE_ASSET_ID } from "@/lib/afc-v2-runtime/types";

import { DEMO_FURNITURE_PARTNER_ID } from "./partner-catalog";
import {
  canMintPartnerAssetIntakeUpload,
  createMemoryPartnerAssetIntakeStore,
  createMemoryPartnerAssetObjectStore,
  createPartnerAssetIntake,
  finalizePartnerAssetIntake,
  listPartnerAssetIntakes,
  merchantMessageForIntakeErrorCode,
  mintPartnerAssetIntakeUpload,
  PARTNER_ASSET_INTAKE_BUCKET,
  PARTNER_ASSET_INTAKE_DIMENSION_SOURCES,
  PARTNER_ASSET_INTAKE_MAX_BYTES,
  PARTNER_ASSET_INTAKE_OBJECT_NAME,
  PARTNER_ASSET_INTAKE_RETRY_POLICY,
  partnerAssetIntakeObjectPath,
  persistableIntakeFromValidation,
  sanitizeOriginalGlbFileName,
  STAGE_PARTNER_ASSET_INTAKES_TABLE,
  toPartnerAssetIntakeDto,
  validatorAssetIdForIntake,
  type PartnerAssetIntakeDto,
} from "./partner-asset-intake";
import {
  formatPartnerIntakeMetres,
  formatPartnerIntakeMetresTriple,
} from "./partner-asset-intake-display";
import {
  resolvePartnerPortalAuth,
  type PartnerPortalAuthResult,
  type PartnerPortalContext,
  type StagePartnerMembershipRow,
} from "./partner-portal-auth";
import type { StagePartner } from "./types";

const ROOT = process.cwd();
const INTAKE_SQL = "supabase/migrations/20260918100000_vibode_stage_partner_asset_intakes.sql";
const INTAKE_SQL_50MIB = "supabase/migrations/20260918110000_vibode_stage_partner_asset_intake_50mib.sql";
const INTAKE_SQL_DIMENSION_SOURCE =
  "supabase/migrations/20260918120000_vibode_stage_partner_asset_intake_dimension_source.sql";
const SOFA_GLB = path.join(ROOT, "public/afc-v2-runtime/test-fixtures/pi4a-sofa.glb");
const OTHER_PARTNER_ID = "partner-other-furniture-co";
const USER_A = "22222222-2222-2222-2222-222222222222";
const USER_B = "44444444-4444-4444-4444-444444444444";
const INTAKE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const INTAKE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const PI5G5A_FILES = [
  INTAKE_SQL,
  INTAKE_SQL_50MIB,
  INTAKE_SQL_DIMENSION_SOURCE,
  "lib/vibode-stage/partner-asset-intake.ts",
  "lib/vibode-stage/partner-asset-intake.server.ts",
  "app/api/vibode/partner/assets/intakes/route.ts",
  "app/api/vibode/partner/assets/intakes/[intakeId]/finalize/route.ts",
  "app/partner/assets/page.tsx",
  "app/partner/assets/PartnerAssetWorkspaceClient.tsx",
  "lib/vibode-stage/partner-asset-intake-display.ts",
  "app/partner/layout.tsx",
  "app/partner/page.tsx",
  "package.json",
];

const FROZEN_EXECUTORS = [
  "lib/vibode-stage/partner-catalog-runtime-executor.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v2.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v3.ts",
  "lib/vibode-stage/partner-catalog-runtime-executor-v4.ts",
];

const LIVE_CATALOG_TABLES = [
  "vibode_stage_partners",
  "vibode_stage_products",
  "vibode_stage_variants",
  "vibode_stage_collections",
  "vibode_stage_product_collections",
  "vibode_stage_assets",
];

installNodeGltfFileReader();

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function sofaBytes(): Uint8Array {
  return new Uint8Array(readFileSync(SOFA_GLB));
}

function sofaDeclared(overrides: Partial<{
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
}> = {}) {
  return {
    authoredWidthM: overrides.authoredWidthM ?? PI4A_SOFA_AUTHORED_WIDTH_M,
    authoredHeightM: overrides.authoredHeightM ?? PI4A_SOFA_AUTHORED_HEIGHT_M,
    authoredDepthM: overrides.authoredDepthM ?? PI4A_SOFA_AUTHORED_DEPTH_M,
  };
}

function bytesWithDeclaredLength(length: number): Uint8Array {
  const bytes = new Uint8Array(1);
  Object.defineProperty(bytes, "byteLength", { value: length });
  return bytes;
}

function demoPartner(status: StagePartner["status"] = "active"): StagePartner {
  return {
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    name: "Demo Furniture Co.",
    slug: "demo-furniture-co",
    status,
    websiteUrl: null,
    logoUrl: null,
  };
}

function otherPartner(): StagePartner {
  return {
    partnerId: OTHER_PARTNER_ID,
    name: "Other Furniture Co.",
    slug: "other-furniture-co",
    status: "active",
    websiteUrl: null,
    logoUrl: null,
  };
}

function membership(overrides: Partial<StagePartnerMembershipRow> = {}): StagePartnerMembershipRow {
  return {
    membershipId: "11111111-1111-1111-1111-111111111111",
    userId: USER_A,
    partnerId: DEMO_FURNITURE_PARTNER_ID,
    role: "owner",
    status: "active",
    ...overrides,
  };
}

function context(partner = demoPartner(), userId = USER_A): PartnerPortalContext {
  return {
    userId,
    partnerId: partner.partnerId,
    role: "owner",
    membershipId: userId === USER_A ? "11111111-1111-1111-1111-111111111111" : "33333333-3333-3333-3333-333333333333",
    partner,
  };
}

function authOk(partner = demoPartner(), userId = USER_A): PartnerPortalAuthResult {
  return { ok: true, context: context(partner, userId) };
}

function authFail(
  code: "unauthenticated" | "forbidden" | "membership_revoked",
  status: 401 | 403,
): PartnerPortalAuthResult {
  return { ok: false, code, status, error: status === 401 ? "Unauthorized" : "Forbidden" };
}

async function exportGlb(object: THREE.Object3D): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(object, { binary: true });
  if (!(result instanceof ArrayBuffer)) throw new Error("expected binary GLB");
  return new Uint8Array(result);
}

function intakeFrom(body: unknown): PartnerAssetIntakeDto {
  const record = body as { ok?: boolean; intake?: PartnerAssetIntakeDto };
  assert.ok(record.intake);
  return record.intake;
}

async function createUploadedIntake(input: Readonly<{
  bytes: Uint8Array;
  originalFileName?: string;
  intakeId?: string;
  auth?: PartnerPortalAuthResult;
  declared?: ReturnType<typeof sofaDeclared>;
  dimensionSource?: "product" | "glb";
  byteSize?: number;
}>) {
  const store = createMemoryPartnerAssetIntakeStore();
  const objects = createMemoryPartnerAssetObjectStore();
  const auth = input.auth ?? authOk();
  const dimensionSource = input.dimensionSource ?? "product";
  const created = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    intakeId: input.intakeId ?? INTAKE_A,
    body: dimensionSource === "glb"
      ? {
          originalFileName: input.originalFileName ?? "sofa.glb",
          byteSize: input.byteSize ?? input.bytes.byteLength,
          dimensionSource: "glb",
        }
      : {
          originalFileName: input.originalFileName ?? "sofa.glb",
          byteSize: input.byteSize ?? input.bytes.byteLength,
          ...(input.declared ?? sofaDeclared()),
        },
  });
  const record = created.body as { objectPath?: string; intakeId?: string };
  if (created.status === 201 && record.objectPath) {
    objects.put(record.objectPath, input.bytes);
  }
  return { store, objects, auth, created };
}

test("PI-5G5A intake schema is Partner-owned, service-role DML, and has a private GLB bucket", () => {
  const sql = source(INTAKE_SQL);
  assert.match(sql, /create table public\.vibode_stage_partner_asset_intakes/);
  assert.match(sql, /partner_id text not null references public\.vibode_stage_partners/);
  assert.match(sql, /created_by_user_id uuid references auth\.users/);
  assert.match(sql, /status in \('created', 'uploaded', 'validating', 'validated', 'failed'\)/);
  assert.match(sql, /byte_size > 0 and byte_size <= 26214400/);
  assert.match(sql, /authored_width_m > 0/);
  assert.match(sql, /unique index vibode_stage_partner_asset_intakes_object_path_uidx/);
  assert.match(sql, /vibode_stage_partner_asset_intakes_partner_id_idx/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table public\.vibode_stage_partner_asset_intakes/);
  assert.match(sql, /from public, anon, authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.vibode_stage_partner_asset_intakes\s+to service_role/);
  assert.doesNotMatch(sql, /create policy[\s\S]*on public\.vibode_stage_partner_asset_intakes/);
  assert.doesNotMatch(sql, /insert into public\.vibode_stage_partner_asset_intakes/i);
  assert.doesNotMatch(sql, /create table public\.vibode_stage_partner_assets/);
  assert.doesNotMatch(sql, /insert into public\.vibode_stage_assets/i);
  assert.doesNotMatch(sql, /processing/);
  assert.match(sql, /insert into storage\.buckets/);
  assert.match(sql, /'vibode-stage-assets'/);
  assert.match(sql, /false,/);
  assert.match(sql, /26214400/);
  assert.match(sql, /model\/gltf-binary/);
  assert.match(sql, /Do not reuse vibode-base-images/);
  assert.match(sql, /vibode_stage_asset_intake_deny_anon/);
  assert.match(sql, /vibode_stage_asset_intake_deny_authenticated/);
  assert.match(sql, /to anon/);
  assert.match(sql, /to authenticated/);
  assert.equal(STAGE_PARTNER_ASSET_INTAKES_TABLE, "vibode_stage_partner_asset_intakes");
  assert.equal(PARTNER_ASSET_INTAKE_BUCKET, "vibode-stage-assets");
  assert.equal(FURNITURE_ASSET_INTAKE_MAX_BYTES, 25 * 1024 * 1024);
  assert.equal(PARTNER_ASSET_INTAKE_MAX_BYTES, 50 * 1024 * 1024);
  const sql50 = source(INTAKE_SQL_50MIB);
  assert.match(sql50, /file_size_limit = 52428800/);
  assert.match(sql50, /byte_size > 0 and byte_size <= 52428800/);
  assert.match(sql50, /drop constraint vibode_stage_partner_asset_intakes_byte_size_positive/);
  assert.doesNotMatch(sql50, /26214400/);
  assert.doesNotMatch(source(INTAKE_SQL), /52428800/);
  const sqlDim = source(INTAKE_SQL_DIMENSION_SOURCE);
  assert.match(sqlDim, /add column dimension_source text not null default 'product'/);
  assert.match(sqlDim, /dimension_source in \('product', 'glb'\)/);
  assert.match(sqlDim, /alter column authored_width_m drop not null/);
  assert.match(sqlDim, /alter column authored_height_m drop not null/);
  assert.match(sqlDim, /alter column authored_depth_m drop not null/);
  assert.match(sqlDim, /authored_width_m is null or authored_width_m > 0/);
  assert.match(sqlDim, /dimension_source = 'product'/);
  assert.match(sqlDim, /dimension_source = 'glb'/);
  assert.match(sqlDim, /authored_width_m is null/);
  assert.match(sqlDim, /authored_height_m is null/);
  assert.match(sqlDim, /authored_depth_m is null/);
  assert.doesNotMatch(sqlDim, /\bgrant\b/);
  assert.doesNotMatch(sqlDim, /\brevoke\b/);
  assert.doesNotMatch(sqlDim, /enable row level security/);
  assert.doesNotMatch(sqlDim, /create policy/);
  assert.doesNotMatch(source(INTAKE_SQL), /dimension_source/);
  assert.doesNotMatch(source(INTAKE_SQL_50MIB), /dimension_source/);
  assert.equal(PARTNER_ASSET_INTAKE_DIMENSION_SOURCES.includes("product"), true);
  assert.equal(PARTNER_ASSET_INTAKE_DIMENSION_SOURCES.includes("glb"), true);
  assert.equal(PARTNER_ASSET_INTAKE_RETRY_POLICY.failedIntakeRemainsFailed, true);
  assert.equal(PARTNER_ASSET_INTAKE_RETRY_POLICY.changedBytesRequireNewIntake, true);
  assert.equal(PARTNER_ASSET_INTAKE_RETRY_POLICY.noRuntimeAssetRegistration, true);
});

test("PI-5G5A create rejects unauthenticated, membership, and browser authority fields", async () => {
  const store = createMemoryPartnerAssetIntakeStore();
  const objects = createMemoryPartnerAssetObjectStore();
  const body = {
    originalFileName: "sofa.glb",
    byteSize: 128,
    ...sofaDeclared(),
  };

  const unauthenticated = await createPartnerAssetIntake({
    auth: authFail("unauthenticated", 401),
    store,
    objects,
    body,
  });
  assert.equal(unauthenticated.status, 401);
  assert.equal((unauthenticated.body as { errorCode?: string }).errorCode, "UNAUTHORIZED");

  const none = await createPartnerAssetIntake({
    auth: resolvePartnerPortalAuth({
      userId: USER_A,
      memberships: { ok: true, rows: [] },
      partner: demoPartner(),
    }),
    store,
    objects,
    body,
  });
  assert.equal(none.status, 403);

  const revoked = await createPartnerAssetIntake({
    auth: authFail("membership_revoked", 403),
    store,
    objects,
    body,
  });
  assert.equal(revoked.status, 403);

  const override = await createPartnerAssetIntake({
    auth: authOk(),
    store,
    objects,
    body: { ...body, partnerId: OTHER_PARTNER_ID },
  });
  assert.equal(override.status, 400);
  assert.equal((override.body as { errorCode?: string }).errorCode, "INVALID_REQUEST");

  const created = await createPartnerAssetIntake({
    auth: authOk(),
    store,
    objects,
    intakeId: INTAKE_A,
    body,
  });
  assert.equal(created.status, 201);
  const createdBody = created.body as {
    intakeId?: string;
    objectPath?: string;
    signedUrl?: string;
    token?: string;
    intake?: { status?: string };
  };
  assert.equal(createdBody.intakeId, INTAKE_A);
  assert.equal(createdBody.intake?.status, "created");
  assert.equal((created.body as { intake?: { dimensionSource?: string } }).intake?.dimensionSource, "product");
  assert.equal(createdBody.objectPath, partnerAssetIntakeObjectPath(DEMO_FURNITURE_PARTNER_ID, INTAKE_A));
  assert.match(createdBody.signedUrl ?? "", new RegExp(DEMO_FURNITURE_PARTNER_ID));
  assert.equal((created.body as { maxBytes?: number }).maxBytes, PARTNER_ASSET_INTAKE_MAX_BYTES);
  assert.equal((createdBody.signedUrl ?? "").includes("My Sofa"), false);
  assert.doesNotMatch(JSON.stringify(created.body), /service_role|SERVICE_ROLE|SUPABASE_SERVICE/);
});

test("PI-5G5A create validates filename, size, dimensions, and server path", async () => {
  const store = createMemoryPartnerAssetIntakeStore();
  const objects = createMemoryPartnerAssetObjectStore();
  const auth = authOk();

  const notGlb = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: { originalFileName: "sofa.gltf", byteSize: 12, ...sofaDeclared() },
  });
  assert.equal(notGlb.status, 400);
  assert.equal((notGlb.body as { errorCode?: string }).errorCode, "INVALID_FILENAME");

  const zero = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: { originalFileName: "sofa.glb", byteSize: 0, ...sofaDeclared() },
  });
  assert.equal(zero.status, 400);
  assert.equal((zero.body as { errorCode?: string }).errorCode, "INVALID_BYTE_SIZE");

  const overCertified = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: {
      originalFileName: "sofa.glb",
      byteSize: FURNITURE_ASSET_INTAKE_MAX_BYTES + 1,
      ...sofaDeclared(),
    },
  });
  assert.equal(overCertified.status, 201);
  assert.equal((overCertified.body as { maxBytes?: number }).maxBytes, 52428800);

  const atPortalCap = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: {
      originalFileName: "sofa.glb",
      byteSize: PARTNER_ASSET_INTAKE_MAX_BYTES,
      ...sofaDeclared(),
    },
  });
  assert.equal(atPortalCap.status, 201);

  const huge = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: {
      originalFileName: "sofa.glb",
      byteSize: PARTNER_ASSET_INTAKE_MAX_BYTES + 1,
      ...sofaDeclared(),
    },
  });
  assert.equal(huge.status, 400);
  assert.equal((huge.body as { errorCode?: string }).errorCode, "FILE_TOO_LARGE");
  assert.match(merchantMessageForIntakeErrorCode("FILE_TOO_LARGE"), /50 MiB/);

  const badDim = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: { originalFileName: "sofa.glb", byteSize: 12, authoredWidthM: 0, authoredHeightM: 1, authoredDepthM: 1 },
  });
  assert.equal(badDim.status, 400);
  assert.equal((badDim.body as { errorCode?: string }).errorCode, "INVALID_DIMENSIONS");

  const millimetreDeclared = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: {
      originalFileName: "sofa.glb",
      byteSize: 12,
      authoredWidthM: 2200,
      authoredHeightM: 800,
      authoredDepthM: 900,
    },
  });
  assert.equal(millimetreDeclared.status, 400);
  assert.equal((millimetreDeclared.body as { errorCode?: string }).errorCode, "INVALID_DIMENSIONS");

  const pathBody = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    intakeId: INTAKE_A,
    body: { originalFileName: "../../My Sofa.glb", byteSize: 12, ...sofaDeclared() },
  });
  assert.equal(pathBody.status, 201);
  const created = pathBody.body as { objectPath?: string; intake?: { originalFileName?: string } };
  assert.equal(created.objectPath, `partners/${DEMO_FURNITURE_PARTNER_ID}/intakes/${INTAKE_A}/${PARTNER_ASSET_INTAKE_OBJECT_NAME}`);
  assert.equal(created.intake?.originalFileName, "My Sofa.glb");
  assert.equal((created.objectPath ?? "").includes("My Sofa"), false);
  assert.equal(sanitizeOriginalGlbFileName("C:\\\\uploads\\\\table.GLB").ok, true);

  const second = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    intakeId: INTAKE_B,
    body: { originalFileName: "chair.glb", byteSize: 12, ...sofaDeclared() },
  });
  assert.equal(second.status, 201);
  const secondBody = second.body as { intakeId?: string; objectPath?: string };
  assert.equal(secondBody.intakeId, INTAKE_B);
  assert.notEqual(secondBody.objectPath, created.objectPath);

  const extraFinalize = await finalizePartnerAssetIntake({
    auth: authOk(),
    store,
    objects,
    intakeId: INTAKE_A,
    body: { sha256: "abc" },
  });
  assert.equal(extraFinalize.status, 400);
  assert.equal((extraFinalize.body as { errorCode?: string }).errorCode, "INVALID_REQUEST");

  const clientPath = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: {
      originalFileName: "sofa.glb",
      byteSize: 12,
      ...sofaDeclared(),
      objectPath: "partners/evil/intakes/x/model.glb",
    },
  });
  assert.equal(clientPath.status, 400);
});

test("PI-5G5A signed upload is path-scoped and is not reminted after validation", { timeout: 60_000 }, async () => {
  const bytes = sofaBytes();
  const { store, objects, auth, created } = await createUploadedIntake({ bytes, intakeId: INTAKE_A });
  assert.equal(created.status, 201);
  const createdBody = created.body as { signedUrl?: string; token?: string; objectPath?: string };
  assert.match(createdBody.signedUrl ?? "", /\/object\/upload\/sign\/vibode-stage-assets\//);
  assert.match(createdBody.token ?? "", new RegExp(createdBody.objectPath ?? "missing-path"));
  assert.doesNotMatch(createdBody.token ?? "", /^[a-z]+$/);

  const finalized = await finalizePartnerAssetIntake({
    auth,
    store,
    objects,
    intakeId: INTAKE_A,
  });
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  assert.equal(canMintPartnerAssetIntakeUpload("validated"), false);
  const remint = await mintPartnerAssetIntakeUpload({
    auth,
    store,
    objects,
    intakeId: INTAKE_A,
  });
  assert.equal(remint.status, 409);
  assert.equal((remint.body as { errorCode?: string }).errorCode, "FINALIZE_CONFLICT");
});

test("PI-5G5A finalize reuses certified GLB validation", { timeout: 60_000 }, async () => {
  const bytes = sofaBytes();
  const good = await createUploadedIntake({ bytes, intakeId: INTAKE_A });
  const accepted = await finalizePartnerAssetIntake({
    auth: good.auth,
    store: good.store,
    objects: good.objects,
    intakeId: INTAKE_A,
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  const dto = intakeFrom(accepted.body);
  assert.equal(dto.status, "validated");
  assert.equal(dto.sha256, sha256Hex(bytes));
  assert.ok(dto.measuredWidthM && dto.measuredWidthM > 0);
  assert.equal(validatorAssetIdForIntake(INTAKE_A).startsWith("intake:"), true);

  async function failCase(label: string, failBytes: Uint8Array, code: string) {
    const seeded = await createUploadedIntake({
      bytes: failBytes,
      intakeId: INTAKE_B,
      originalFileName: `${label}.glb`,
    });
    const result = await finalizePartnerAssetIntake({
      auth: seeded.auth,
      store: seeded.store,
      objects: seeded.objects,
      intakeId: INTAKE_B,
    });
    assert.equal(result.status, 400, label);
    assert.equal((result.body as { errorCode?: string }).errorCode, code, label);
    assert.equal(intakeFrom(result.body).status, "failed", label);
  }

  const magic = sofaBytes();
  magic[0] = 0;
  await failCase("magic", magic, "MALFORMED_GLB");

  const version = sofaBytes();
  version[4] = 1;
  const versionResult = await (async () => {
    const seeded = await createUploadedIntake({ bytes: version, intakeId: "cccccccc-cccc-cccc-cccc-cccccccccccc" });
    return finalizePartnerAssetIntake({
      auth: seeded.auth,
      store: seeded.store,
      objects: seeded.objects,
      intakeId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    });
  })();
  assert.equal(versionResult.status, 400);
  assert.equal((versionResult.body as { errorCode?: string }).errorCode, "MALFORMED_GLB");

  await failCase("truncated", sofaBytes().slice(0, 24), "MALFORMED_GLB");

  const external = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    images: [{ uri: "https://example.test/texture.png" }],
    buffers: [{ byteLength: 0 }],
  });
  const externalSeed = await createUploadedIntake({
    bytes: external,
    intakeId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  });
  const externalResult = await finalizePartnerAssetIntake({
    auth: externalSeed.auth,
    store: externalSeed.store,
    objects: externalSeed.objects,
    intakeId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  });
  assert.equal(externalResult.status, 400);
  assert.equal((externalResult.body as { errorCode?: string }).errorCode, "EXTERNAL_URI");

  const empty = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Empty" }],
  });
  const emptySeed = await createUploadedIntake({
    bytes: empty,
    intakeId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  });
  const emptyResult = await finalizePartnerAssetIntake({
    auth: emptySeed.auth,
    store: emptySeed.store,
    objects: emptySeed.objects,
    intakeId: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  });
  assert.equal(emptyResult.status, 400);
  assert.equal((emptyResult.body as { errorCode?: string }).errorCode, "EMPTY_SCENE");

  const negative = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ scale: [1, -1, 1] }],
  });
  const negativeSeed = await createUploadedIntake({
    bytes: negative,
    intakeId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  });
  const negativeResult = await finalizePartnerAssetIntake({
    auth: negativeSeed.auth,
    store: negativeSeed.store,
    objects: negativeSeed.objects,
    intakeId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  });
  assert.equal(negativeResult.status, 400);
  assert.equal((negativeResult.body as { errorCode?: string }).errorCode, "NEGATIVE_SCALE");
});

test("PI-5G5A dimension mismatch uses certified metre policy and keeps warnings as warnings", { timeout: 60_000 }, async () => {
  const bytes = sofaBytes();
  const exact = await createUploadedIntake({ bytes, intakeId: INTAKE_A });
  const exactResult = await finalizePartnerAssetIntake({
    auth: exact.auth,
    store: exact.store,
    objects: exact.objects,
    intakeId: INTAKE_A,
  });
  assert.equal(exactResult.status, 200);
  const exactDto = intakeFrom(exactResult.body);
  assert.equal(exactDto.status, "validated");
  assert.equal(exactDto.dimensionSource, "product");
  assert.ok(exactDto.authoredWidthM && exactDto.authoredWidthM > 0);

  const within = await createUploadedIntake({
    bytes,
    intakeId: INTAKE_B,
    declared: sofaDeclared({ authoredWidthM: 2.22 }),
  });
  const withinResult = await finalizePartnerAssetIntake({
    auth: within.auth,
    store: within.store,
    objects: within.objects,
    intakeId: INTAKE_B,
  });
  assert.equal(withinResult.status, 200, JSON.stringify(withinResult.body));
  const withinDto = intakeFrom(withinResult.body);
  assert.equal(withinDto.status, "validated");
  assert.equal(withinDto.warnings.some((item) => item.code === "DIMENSION_DRIFT"), true);

  const mismatch = await createUploadedIntake({
    bytes,
    intakeId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    declared: sofaDeclared({ authoredWidthM: 1, authoredHeightM: 1, authoredDepthM: 1 }),
  });
  const mismatchResult = await finalizePartnerAssetIntake({
    auth: mismatch.auth,
    store: mismatch.store,
    objects: mismatch.objects,
    intakeId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  });
  assert.equal(mismatchResult.status, 400);
  assert.equal((mismatchResult.body as { errorCode?: string }).errorCode, "DIMENSION_MISMATCH");
  assert.match(
    merchantMessageForIntakeErrorCode("DIMENSION_MISMATCH"),
    /actual product dimensions/,
  );
  assert.doesNotMatch(
    merchantMessageForIntakeErrorCode("DIMENSION_MISMATCH"),
    /copy these numbers|adjust until validation/i,
  );
  assert.equal(intakeFrom(mismatchResult.body).status, "failed");

  const millimetreMesh = new THREE.Mesh(
    new THREE.BoxGeometry(2200, 800, 900),
    new THREE.MeshStandardMaterial({ color: 0x333333 }),
  );
  const millimetreBytes = await exportGlb(millimetreMesh);
  const millimetre = await createUploadedIntake({
    bytes: millimetreBytes,
    intakeId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    declared: sofaDeclared(),
  });
  const millimetreResult = await finalizePartnerAssetIntake({
    auth: millimetre.auth,
    store: millimetre.store,
    objects: millimetre.objects,
    intakeId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  });
  assert.equal(millimetreResult.status, 400);
  const millimetreCode = (millimetreResult.body as { errorCode?: string }).errorCode;
  assert.ok(millimetreCode === "IMPLAUSIBLE_SIZE" || millimetreCode === "DIMENSION_MISMATCH");

  const tiny = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 0.02, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x111111 }),
  );
  const tinyBytes = await exportGlb(tiny);
  const tinyCreate = await createPartnerAssetIntake({
    auth: authOk(),
    store: createMemoryPartnerAssetIntakeStore(),
    objects: createMemoryPartnerAssetObjectStore(),
    body: {
      originalFileName: "tiny.glb",
      byteSize: tinyBytes.byteLength,
      authoredWidthM: 0.02,
      authoredHeightM: 0.02,
      authoredDepthM: 0.02,
    },
  });
  assert.equal(tinyCreate.status, 400);
  assert.equal((tinyCreate.body as { errorCode?: string }).errorCode, "INVALID_DIMENSIONS");

  const fakeNonUnit: AssetValidationResult = {
    accepted: false,
    assetId: validatorAssetIdForIntake(INTAKE_A),
    glbPath: "partners/x/intakes/y/model.glb",
    fileSizeBytes: 10,
    sha256: "a".repeat(64),
    parseOk: true,
    measured: { widthM: 1, heightM: 1, depthM: 1 },
    declared: { widthM: 1, heightM: 1, depthM: 1 },
    placementScale: 0.5,
    warnings: [],
    errors: [{ code: "NON_UNIT_PLACEMENT_SCALE", message: "scale 0.5" }],
  };
  const mapped = persistableIntakeFromValidation(fakeNonUnit);
  assert.equal(mapped.status, "failed");
  assert.equal(mapped.errorCode, "NON_UNIT_PLACEMENT_SCALE");
  assert.match(merchantMessageForIntakeErrorCode("NON_UNIT_PLACEMENT_SCALE"), /does not automatically resize/);
  assert.match(merchantMessageForIntakeErrorCode("FILE_TOO_LARGE"), /50 MiB/);
  assert.doesNotMatch(merchantMessageForIntakeErrorCode("FILE_TOO_LARGE"), /25 MiB/);
});

test("PI-5G5A SHA-256 is provenance only and duplicate bytes do not collapse intakes", { timeout: 60_000 }, async () => {
  const bytes = sofaBytes();
  const shared = createMemoryPartnerAssetIntakeStore();
  const sharedObjects = createMemoryPartnerAssetObjectStore();
  const one = await createPartnerAssetIntake({
    auth: authOk(),
    store: shared,
    objects: sharedObjects,
    intakeId: INTAKE_A,
    body: { originalFileName: "a.glb", byteSize: bytes.byteLength, ...sofaDeclared() },
  });
  const two = await createPartnerAssetIntake({
    auth: authOk(),
    store: shared,
    objects: sharedObjects,
    intakeId: INTAKE_B,
    body: { originalFileName: "b.glb", byteSize: bytes.byteLength, ...sofaDeclared() },
  });
  const pathA = (one.body as { objectPath?: string }).objectPath!;
  const pathB = (two.body as { objectPath?: string }).objectPath!;
  sharedObjects.put(pathA, bytes);
  sharedObjects.put(pathB, bytes);
  const firstResult = await finalizePartnerAssetIntake({
    auth: authOk(),
    store: shared,
    objects: sharedObjects,
    intakeId: INTAKE_A,
  });
  const secondResult = await finalizePartnerAssetIntake({
    auth: authOk(),
    store: shared,
    objects: sharedObjects,
    intakeId: INTAKE_B,
  });
  assert.equal(firstResult.status, 200);
  assert.equal(secondResult.status, 200);
  assert.equal(intakeFrom(firstResult.body).sha256, sha256Hex(bytes));
  assert.equal(intakeFrom(secondResult.body).sha256, sha256Hex(bytes));
  assert.equal(shared.rows.length, 2);
  assert.notEqual(shared.rows[0]?.intakeId, shared.rows[1]?.intakeId);

  const changed = sofaBytes();
  changed[changed.byteLength - 1] = (changed[changed.byteLength - 1] ?? 0) ^ 1;
  assert.notEqual(sha256Hex(bytes), sha256Hex(changed));
});

test("PI-5G5A finalize is idempotent and does not register an Asset", { timeout: 60_000 }, async () => {
  const bytes = sofaBytes();
  const seeded = await createUploadedIntake({ bytes, intakeId: INTAKE_A });
  const first = await finalizePartnerAssetIntake({
    auth: seeded.auth,
    store: seeded.store,
    objects: seeded.objects,
    intakeId: INTAKE_A,
  });
  const second = await finalizePartnerAssetIntake({
    auth: seeded.auth,
    store: seeded.store,
    objects: seeded.objects,
    intakeId: INTAKE_A,
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((second.body as { idempotent?: boolean }).idempotent, true);
  assert.deepEqual(intakeFrom(first.body), intakeFrom(second.body));
  assert.equal(seeded.store.rows.length, 1);
  assert.equal(seeded.objects.objects.size, 1);
  assert.equal(seeded.store.rows.some((row) => "assetId" in row), false);

  seeded.store.rows[0] = { ...seeded.store.rows[0]!, status: "validating" };
  const inFlight = await finalizePartnerAssetIntake({
    auth: seeded.auth,
    store: seeded.store,
    objects: seeded.objects,
    intakeId: INTAKE_A,
  });
  assert.equal(inFlight.status, 409);
  assert.equal((inFlight.body as { errorCode?: string }).errorCode, "FINALIZE_IN_PROGRESS");

  const unknown = await finalizePartnerAssetIntake({
    auth: authOk(),
    store: createMemoryPartnerAssetIntakeStore(),
    objects: createMemoryPartnerAssetObjectStore(),
    intakeId: INTAKE_B,
  });
  assert.equal(unknown.status, 404);
});

test("PI-5G5A cross-Partner isolation, failure persistence, and missing object retry", async () => {
  const bytes = sofaBytes();
  const store = createMemoryPartnerAssetIntakeStore();
  const objects = createMemoryPartnerAssetObjectStore();
  const created = await createPartnerAssetIntake({
    auth: authOk(),
    store,
    objects,
    intakeId: INTAKE_A,
    body: { originalFileName: "sofa.glb", byteSize: 8, ...sofaDeclared() },
  });
  assert.equal(created.status, 201);
  const objectPath = (created.body as { objectPath?: string }).objectPath!;

  const missing = await finalizePartnerAssetIntake({
    auth: authOk(),
    store,
    objects,
    intakeId: INTAKE_A,
  });
  assert.equal(missing.status, 409);
  assert.equal((missing.body as { errorCode?: string }).errorCode, "OBJECT_MISSING");
  assert.equal(store.rows[0]?.status, "created");

  const foreignList = await listPartnerAssetIntakes({
    auth: authOk(otherPartner(), USER_B),
    store,
  });
  assert.equal(foreignList.status, 200);
  assert.deepEqual((foreignList.body as { intakes?: unknown[] }).intakes, []);

  const foreignFinalize = await finalizePartnerAssetIntake({
    auth: authOk(otherPartner(), USER_B),
    store,
    objects,
    intakeId: INTAKE_A,
  });
  assert.equal(foreignFinalize.status, 404);

  const foreignMint = await mintPartnerAssetIntakeUpload({
    auth: authOk(otherPartner(), USER_B),
    store,
    objects,
    intakeId: INTAKE_A,
  });
  assert.equal(foreignMint.status, 404);

  objects.put(objectPath, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  const sizeMismatch = await createPartnerAssetIntake({
    auth: authOk(),
    store,
    objects,
    intakeId: INTAKE_B,
    body: { originalFileName: "sofa.glb", byteSize: bytes.byteLength, ...sofaDeclared() },
  });
  const mismatchPath = (sizeMismatch.body as { objectPath?: string }).objectPath!;
  objects.put(mismatchPath, new Uint8Array(16));
  const mismatchFinalize = await finalizePartnerAssetIntake({
    auth: authOk(),
    store,
    objects,
    intakeId: INTAKE_B,
  });
  assert.equal(mismatchFinalize.status, 400);
  assert.equal((mismatchFinalize.body as { errorCode?: string }).errorCode, "BYTE_SIZE_MISMATCH");

  const failed = await finalizePartnerAssetIntake({
    auth: authOk(),
    store,
    objects,
    intakeId: INTAKE_A,
  });
  assert.equal(failed.status, 400);
  const failedDto = intakeFrom(failed.body);
  assert.equal(failedDto.status, "failed");
  assert.equal(failedDto.errorCode, "MALFORMED_GLB");
  assert.ok(failedDto.error);
  assert.equal(objects.objects.has(objectPath), true);
  const retryFailed = await finalizePartnerAssetIntake({
    auth: authOk(),
    store,
    objects,
    intakeId: INTAKE_A,
  });
  assert.equal((retryFailed.body as { idempotent?: boolean }).idempotent, true);
  assert.equal(intakeFrom(retryFailed.body).status, "failed");

  const ownList = await listPartnerAssetIntakes({ auth: authOk(), store });
  assert.equal(((ownList.body as { intakes?: PartnerAssetIntakeDto[] }).intakes ?? []).length, 2);
});

test("PI-5G5A merchant UX distinguishes product dimensions from GLB measurement", async () => {
  const client = source("app/partner/assets/PartnerAssetWorkspaceClient.tsx");
  const page = source("app/partner/assets/page.tsx");
  const display = source("lib/vibode-stage/partner-asset-intake-display.ts");
  const validator = source("lib/afc-v2-runtime/furniture-asset-validate.ts");
  assert.match(client, /Actual product dimensions/);
  assert.match(client, /real-world dimensions of the furniture product/);
  assert.match(client, /measure the uploaded GLB automatically/);
  assert.match(client, /reasonably match/);
  assert.match(client, /Enter the real-world dimensions[\s\S]*in metres/);
  assert.match(client, /Width \(m\)/);
  assert.match(client, /Height \(m\)/);
  assert.match(client, /Depth \(m\)/);
  assert.match(client, /does not automatically\s+resize/);
  assert.match(client, /Scale verified/);
  assert.match(client, /Use GLB dimensions/);
  assert.match(client, /Using GLB dimensions/);
  assert.match(client, /GLB dimensions used/);
  assert.match(client, /For testing, use the dimensions measured directly from the uploaded GLB/);
  assert.match(client, /skips the independent product-dimension scale check/);
  assert.match(client, /const \[useGlbDimensions, setUseGlbDimensions\] = useState\(false\)/);
  assert.match(client, /dimensionSource: "glb"/);
  assert.match(client, /dimensionSource: "product"/);
  assert.match(client, /disabled=\{busy \|\| useGlbDimensions\}/);
  assert.match(client, /Product:/);
  assert.match(client, /GLB measured/);
  assert.match(client, /formatPartnerIntakeMetresTriple/);
  assert.doesNotMatch(client, /Authored /);
  assert.doesNotMatch(client, /copy these numbers|adjust until validation/i);
  assert.match(page, /actual product dimensions in metres/);
  assert.match(page, /does not automatically\s+resize/);
  assert.match(
    merchantMessageForIntakeErrorCode("DIMENSION_MISMATCH"),
    /Confirm the product dimensions and make sure the GLB is modeled at real-world scale/,
  );
  assert.equal(formatPartnerIntakeMetres(0.7567431032657623), "0.757");
  assert.equal(formatPartnerIntakeMetresTriple(2, 1, 1), "2.000 × 1.000 × 1.000 m");
  assert.equal(
    formatPartnerIntakeMetresTriple(0.7567, 0.9977, 0.6599),
    "0.757 × 0.998 × 0.660 m",
  );
  const rawMeasured = 0.7567431032657623;
  assert.equal(formatPartnerIntakeMetres(rawMeasured), "0.757");
  assert.equal(rawMeasured, 0.7567431032657623);
  assert.doesNotMatch(source("lib/vibode-stage/partner-asset-intake.ts"), /toFixed\(/);
  assert.doesNotMatch(source("lib/afc-v2-runtime/furniture-asset-validate.ts"), /toFixed\(/);
  assert.match(display, /Display rounding only/);
  assert.doesNotMatch(display, /classifyAuthoredAxisMismatch|validateFurnitureAsset/);
  assert.match(validator, /classifyAuthoredAxisMismatch/);
  assert.match(source("lib/afc-v2-runtime/furniture-asset-policy.ts"), /FURNITURE_ASSET_DIMENSION_HARD/);
  assert.doesNotMatch(source("lib/afc-v2-runtime/furniture-asset-policy.ts"), /PARTNER_ASSET_INTAKE_MAX_BYTES/);
});

test("PI-5G5A GLB dimension source is an explicit testing shortcut", { timeout: 60_000 }, async () => {
  const store = createMemoryPartnerAssetIntakeStore();
  const objects = createMemoryPartnerAssetObjectStore();
  const auth = authOk();

  const missingProductDims = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: { originalFileName: "sofa.glb", byteSize: 12, dimensionSource: "product" },
  });
  assert.equal(missingProductDims.status, 400);
  assert.equal((missingProductDims.body as { errorCode?: string }).errorCode, "INVALID_DIMENSIONS");

  const silentBlank = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: { originalFileName: "sofa.glb", byteSize: 12 },
  });
  assert.equal(silentBlank.status, 400);
  assert.equal((silentBlank.body as { errorCode?: string }).errorCode, "INVALID_DIMENSIONS");

  const unknownSource = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: { originalFileName: "sofa.glb", byteSize: 12, dimensionSource: "product_catalog" },
  });
  assert.equal(unknownSource.status, 400);
  assert.equal((unknownSource.body as { errorCode?: string }).errorCode, "INVALID_REQUEST");

  const contradictory = await createPartnerAssetIntake({
    auth,
    store,
    objects,
    body: {
      originalFileName: "sofa.glb",
      byteSize: 12,
      dimensionSource: "glb",
      authoredWidthM: 2,
      authoredHeightM: 1,
      authoredDepthM: 1,
    },
  });
  assert.equal(contradictory.status, 400);
  assert.equal((contradictory.body as { errorCode?: string }).errorCode, "INVALID_REQUEST");

  const bytes = sofaBytes();
  const good = await createUploadedIntake({
    bytes,
    intakeId: INTAKE_A,
    dimensionSource: "glb",
  });
  assert.equal(good.created.status, 201);
  const createdDto = intakeFrom(good.created.body);
  assert.equal(createdDto.dimensionSource, "glb");
  assert.equal(createdDto.authoredWidthM, null);
  assert.equal(createdDto.authoredHeightM, null);
  assert.equal(createdDto.authoredDepthM, null);

  let seenAuthority: string | undefined;
  let seenDeclared: number | undefined;
  const accepted = await finalizePartnerAssetIntake({
    auth: good.auth,
    store: good.store,
    objects: good.objects,
    intakeId: INTAKE_A,
    validate: async (input) => {
      seenAuthority = input.dimensionAuthority;
      seenDeclared = input.declaredWidthM;
      return validateFurnitureAsset(input);
    },
  });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(seenAuthority, "measured");
  assert.equal(seenDeclared, undefined);
  const dto = intakeFrom(accepted.body);
  assert.equal(dto.status, "validated");
  assert.equal(dto.dimensionSource, "glb");
  assert.equal(dto.authoredWidthM, null);
  assert.equal(dto.authoredHeightM, null);
  assert.equal(dto.authoredDepthM, null);
  assert.ok(dto.measuredWidthM && dto.measuredWidthM > 0);
  assert.ok(dto.measuredHeightM && dto.measuredHeightM > 0);
  assert.ok(dto.measuredDepthM && dto.measuredDepthM > 0);
  assert.equal(dto.warnings.some((item) => item.code === "DIMENSION_DRIFT"), false);
  assert.equal(dto.errorCode, null);
  assert.equal(good.store.rows[0]?.authoredWidthM, null);
  assert.equal(good.store.rows[0]?.dimensionSource, "glb");

  const magic = sofaBytes();
  magic[0] = 0;
  const malformed = await createUploadedIntake({
    bytes: magic,
    intakeId: INTAKE_B,
    dimensionSource: "glb",
    originalFileName: "broken.glb",
  });
  const malformedResult = await finalizePartnerAssetIntake({
    auth: malformed.auth,
    store: malformed.store,
    objects: malformed.objects,
    intakeId: INTAKE_B,
  });
  assert.equal(malformedResult.status, 400);
  assert.equal((malformedResult.body as { errorCode?: string }).errorCode, "MALFORMED_GLB");

  const external = encodeGlb({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    images: [{ uri: "https://example.test/texture.png" }],
    buffers: [{ byteLength: 0 }],
  });
  const externalSeed = await createUploadedIntake({
    bytes: external,
    intakeId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
    dimensionSource: "glb",
  });
  const externalResult = await finalizePartnerAssetIntake({
    auth: externalSeed.auth,
    store: externalSeed.store,
    objects: externalSeed.objects,
    intakeId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  });
  assert.equal(externalResult.status, 400);
  assert.equal((externalResult.body as { errorCode?: string }).errorCode, "EXTERNAL_URI");

  const millimetreMesh = new THREE.Mesh(
    new THREE.BoxGeometry(2200, 800, 900),
    new THREE.MeshStandardMaterial({ color: 0x333333 }),
  );
  const millimetreBytes = await exportGlb(millimetreMesh);
  const millimetre = await createUploadedIntake({
    bytes: millimetreBytes,
    intakeId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    dimensionSource: "glb",
  });
  const millimetreResult = await finalizePartnerAssetIntake({
    auth: millimetre.auth,
    store: millimetre.store,
    objects: millimetre.objects,
    intakeId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  });
  assert.equal(millimetreResult.status, 400);
  assert.equal((millimetreResult.body as { errorCode?: string }).errorCode, "IMPLAUSIBLE_SIZE");
  assert.notEqual((millimetreResult.body as { errorCode?: string }).errorCode, "DIMENSION_MISMATCH");

  const oversizedStore = createMemoryPartnerAssetIntakeStore();
  const oversizedObjects = createMemoryPartnerAssetObjectStore();
  const oversizedBytes = bytesWithDeclaredLength(PARTNER_ASSET_INTAKE_MAX_BYTES + 1);
  const oversizedCreate = await createPartnerAssetIntake({
    auth: authOk(),
    store: oversizedStore,
    objects: oversizedObjects,
    intakeId: INTAKE_A,
    body: {
      originalFileName: "huge.glb",
      byteSize: sofaBytes().byteLength,
      dimensionSource: "glb",
    },
  });
  assert.equal(oversizedCreate.status, 201);
  const oversizedPath = (oversizedCreate.body as { objectPath?: string }).objectPath!;
  const current = oversizedStore.rows[0]!;
  oversizedStore.rows[0] = { ...current, byteSize: oversizedBytes.byteLength };
  oversizedObjects.put(oversizedPath, oversizedBytes);
  const oversizedFinalize = await finalizePartnerAssetIntake({
    auth: authOk(),
    store: oversizedStore,
    objects: oversizedObjects,
    intakeId: INTAKE_A,
  });
  assert.equal(oversizedFinalize.status, 400);
  assert.equal((oversizedFinalize.body as { errorCode?: string }).errorCode, "FILE_TOO_LARGE");

  const client = source("app/partner/assets/PartnerAssetWorkspaceClient.tsx");
  assert.match(client, /Using GLB dimensions/);
  assert.match(client, /Scale verified/);
  assert.match(client, /intakeUsesGlbDimensions/);
});

test("PI-5G5A textured GLB finalizes in Node and uses the Portal 50 MiB cap", { timeout: 60_000 }, async () => {
  const bytes = encodeTexturedFurnitureProbeGlb();
  const { store, objects, auth, created } = await createUploadedIntake({
    bytes,
    originalFileName: "textured.glb",
    intakeId: INTAKE_A,
    declared: {
      authoredWidthM: TEXTURED_FURNITURE_PROBE_DECLARED_M.widthM,
      authoredHeightM: TEXTURED_FURNITURE_PROBE_DECLARED_M.heightM,
      authoredDepthM: TEXTURED_FURNITURE_PROBE_DECLARED_M.depthM,
    },
  });
  assert.equal(created.status, 201);

  let seenMaxBytes: number | undefined;
  const finalized = await finalizePartnerAssetIntake({
    auth,
    store,
    objects,
    intakeId: INTAKE_A,
    validate: async (input) => {
      seenMaxBytes = input.maxBytes;
      assert.equal(input.dimensionAuthority, undefined);
      return validateFurnitureAsset(input);
    },
  });
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  assert.equal(seenMaxBytes, PARTNER_ASSET_INTAKE_MAX_BYTES);
  const dto = intakeFrom(finalized.body);
  assert.equal(dto.status, "validated");
  assert.equal(dto.errorCode, null);
  assert.ok(dto.measuredWidthM);
  assert.ok(dto.sha256);

  const mismatch = await createUploadedIntake({
    bytes,
    originalFileName: "textured.glb",
    intakeId: INTAKE_B,
    declared: { authoredWidthM: 2, authoredHeightM: 1, authoredDepthM: 1 },
  });
  assert.equal(mismatch.created.status, 201);
  const mismatchFinalize = await finalizePartnerAssetIntake({
    auth: mismatch.auth,
    store: mismatch.store,
    objects: mismatch.objects,
    intakeId: INTAKE_B,
  });
  assert.equal(mismatchFinalize.status, 400);
  assert.equal((mismatchFinalize.body as { errorCode?: string }).errorCode, "DIMENSION_MISMATCH");
  assert.equal(intakeFrom(mismatchFinalize.body).status, "failed");

  const oversizedStore = createMemoryPartnerAssetIntakeStore();
  const oversizedObjects = createMemoryPartnerAssetObjectStore();
  const oversizedBytes = bytesWithDeclaredLength(PARTNER_ASSET_INTAKE_MAX_BYTES + 1);
  const oversizedCreate = await createPartnerAssetIntake({
    auth: authOk(),
    store: oversizedStore,
    objects: oversizedObjects,
    intakeId: INTAKE_A,
    body: {
      originalFileName: "huge.glb",
      byteSize: sofaBytes().byteLength,
      ...sofaDeclared(),
    },
  });
  assert.equal(oversizedCreate.status, 201);
  const oversizedPath = (oversizedCreate.body as { objectPath?: string }).objectPath!;
  const current = oversizedStore.rows[0]!;
  oversizedStore.rows[0] = { ...current, byteSize: oversizedBytes.byteLength };
  oversizedObjects.put(oversizedPath, oversizedBytes);
  const oversizedFinalize = await finalizePartnerAssetIntake({
    auth: authOk(),
    store: oversizedStore,
    objects: oversizedObjects,
    intakeId: INTAKE_A,
  });
  assert.equal(oversizedFinalize.status, 400);
  assert.equal((oversizedFinalize.body as { errorCode?: string }).errorCode, "FILE_TOO_LARGE");
});

test("PI-5G5A does not register runtime Assets or mutate commercial/runtime surfaces", () => {
  const joined = PI5G5A_FILES.map((file) => source(file)).join("\n");
  assert.match(joined, /validateFurnitureAsset/);
  assert.match(joined, /PARTNER_ASSET_INTAKE_MAX_BYTES/);
  assert.match(joined, /maxBytes: PARTNER_ASSET_INTAKE_MAX_BYTES/);
  assert.match(joined, /resolvePartnerPortalContext/);
  assert.match(source("lib/vibode-stage/partner-asset-intake.ts"), /sha256Hex/);
  assert.match(source("lib/vibode-stage/partner-asset-intake.ts"), /resolvePartnerPortalContext|createPartnerAssetIntake/);
  assert.match(source("lib/afc-v2-runtime/furniture-glb-loader.ts"), /ensureNodeGltfHostGlobals/);
  assert.match(source("lib/vibode-stage/partner-asset-intake.ts"), /dimensionAuthority: "measured"/);
  assert.match(source("lib/afc-v2-runtime/furniture-asset-validate.ts"), /dimensionAuthority\?: FurnitureAssetDimensionAuthority/);
  assert.doesNotMatch(source("lib/afc-v2-runtime/furniture-asset-register.ts"), /dimensionAuthority/);
  assert.match(source("app/partner/assets/PartnerAssetWorkspaceClient.tsx"), /intake\.errorCode/);
  assert.doesNotMatch(joined, /importPartnerPackage/);
  assert.doesNotMatch(joined, /defaultGlbUrlForAssetId/);
  assert.doesNotMatch(joined, /furniture-asset-registry\.generated/);
  assert.doesNotMatch(joined, /furniture-asset-manifest\.json/);
  assert.doesNotMatch(joined, /planVersion['":\s]*5/);
  assert.doesNotMatch(joined, /vibode_stage_apply_partner_patch/);
  assert.doesNotMatch(joined, /partner-catalog-runtime-executor/);
  assert.doesNotMatch(joined, /from\("vibode_stage_assets"\)/);
  assert.doesNotMatch(joined, /from\("vibode_stage_partner_assets"\)/);
  assert.doesNotMatch(joined, /from\("vibode_stage_products"\)/);
  assert.doesNotMatch(joined, /from\("vibode_stage_variants"\)/);
  assert.doesNotMatch(joined, /from\("vibode_3d_scenes"\)/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-asset-intake.ts"), /writeFileAtomic|public\/afc-v2-runtime/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-asset-intake.server.ts"), /writeFileAtomic|importPartnerPackage/);
  assert.match(source("lib/vibode-stage/partner-asset-intake.server.ts"), /import "server-only"/);
  assert.match(source("lib/vibode-stage/partner-asset-intake.server.ts"), /getServiceRoleSupabaseClient/);
  assert.match(source("lib/vibode-stage/partner-asset-intake.server.ts"), /createSignedUploadUrl/);
  assert.match(source("app/api/vibode/partner/assets/intakes/[intakeId]/finalize/route.ts"), /runtime = "nodejs"/);
  assert.match(source("app/partner/assets/page.tsx"), /metres/);
  assert.match(source("app/partner/assets/page.tsx"), /does not automatically\s+resize/);
  assert.match(source("app/partner/assets/PartnerAssetWorkspaceClient.tsx"), /Width \(m\)/);
  assert.doesNotMatch(source("app/partner/assets/PartnerAssetWorkspaceClient.tsx"), /productId|variantId|collectionId|planVersion/);
  assert.doesNotMatch(source("app/partner/catalog/drafts/[draftId]/PartnerDraftWorkspaceClient.tsx"), /\/api\/vibode\/partner\/assets\/intakes/);
  assert.match(source("app/partner/layout.tsx"), /href="\/partner\/assets"/);
  assert.match(source("package.json"), /test:afc-v2-pi5g5a/);
  for (const table of LIVE_CATALOG_TABLES) {
    assert.doesNotMatch(source("lib/vibode-stage/partner-asset-intake.server.ts"), new RegExp(`from\\("${table}"\\)`));
  }
  for (const file of FROZEN_EXECUTORS) {
    assert.doesNotMatch(source(file), /vibode_stage_partner_asset_intakes|partner-asset-intake/);
  }
  assert.doesNotMatch(source("lib/afc-v2-runtime/furniture-asset-validate.ts"), /partner-asset-intake|vibode_stage_partner_asset_intakes/);
  assert.doesNotMatch(source("lib/vibode-stage/partner-portal-assets.ts"), /partner_asset_intake|validated intake/);
  assert.equal(AFC_V2_RUNTIME_FURNITURE_ASSET_ID.length > 0, true);
  assert.ok(toPartnerAssetIntakeDto);
  assert.equal(PARTNER_ASSET_INTAKE_OBJECT_NAME, "model.glb");
});
