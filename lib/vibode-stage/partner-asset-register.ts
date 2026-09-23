/**
 * PI-5G5B1 Partner runtime Asset registration authority.
 *
 * Authorized Partner → validated G5A intake → explicit Register Asset →
 * re-download + SHA/size re-check → deterministic Asset ID → write verified
 * bytes to a brand-new final private object path → destination SHA verify →
 * atomic DB Asset + Partner mapping + intake link. Asset status is
 * `unavailable`. This is not runtime overlay, not ready, and not a picker
 * integration.
 *
 * Storage provenance lives in private vibode_stage_asset_storage so public
 * vibode_stage_assets SELECT does not expose object paths or SHA.
 */

import { sha256Hex } from "@/lib/afc-v2-runtime/furniture-asset-validate";

import {
  httpFromIntakeAuth,
  PARTNER_ASSET_INTAKE_BUCKET,
  PARTNER_ASSET_INTAKE_MAX_BYTES,
  type PartnerAssetIntakeRow,
  type PartnerAssetIntakeStore,
} from "./partner-asset-intake";
import type { PartnerPortalAuthResult } from "./partner-portal-auth";
import type { PartnerPortalHttpResponse } from "./partner-portal-http";
import {
  CERTIFIED_STATIC_ASSET_SOURCE,
  isForbiddenBrowserUploadObjectPath,
  isPartnerIntakeRuntimeAssetId,
  isValidatorIntakeAssetId,
  PARTNER_INTAKE_ASSET_SOURCE,
  partnerIntakeRuntimeAssetId,
  partnerRuntimeAssetGlbRoute,
  partnerRuntimeAssetObjectPath,
} from "./partner-runtime-asset-id";
import { formatSha256Prefix } from "./partner-asset-intake-display";
import { asNonEmptyString, isPlainObject } from "./product-variant-register";
import type { StageAssetStatus } from "./types";

export const STAGE_PARTNER_ASSETS_TABLE = "vibode_stage_partner_assets";
export const STAGE_ASSET_STORAGE_TABLE = "vibode_stage_asset_storage";
export const STAGE_REGISTER_PARTNER_ASSET_RPC = "vibode_stage_register_partner_asset";
export const PARTNER_RUNTIME_ASSET_CONTENT_TYPE = "model/gltf-binary";
export const PARTNER_INTAKE_REGISTRATION_STATUS = "unavailable" as const;
export const SHA256_HEX_SHAPE = /^[a-f0-9]{64}$/;
export const PLACEMENT_SCALE_UNIT = 1;
const MEASURED_DIM_EPSILON = 1e-9;

export const PARTNER_ASSET_REGISTER_ERROR_CODES = Object.freeze([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INTAKE_NOT_FOUND",
  "INTAKE_NOT_VALIDATED",
  "INTAKE_MISSING_SHA",
  "INTAKE_MISSING_MEASURED_DIMENSIONS",
  "INVALID_PLACEMENT_SCALE",
  "SOURCE_OBJECT_MISSING",
  "SOURCE_BYTE_SIZE_MISMATCH",
  "SOURCE_SHA_MISMATCH",
  "FINAL_OBJECT_CONFLICT",
  "FINAL_OBJECT_SHA_MISMATCH",
  "REGISTRATION_CONFLICT",
  "ASSET_INCOMPATIBLE",
  "SERVICE_UNAVAILABLE",
  "INVALID_REQUEST",
  "ASSET_UNAVAILABLE",
] as const);

export type PartnerAssetRegisterErrorCode = (typeof PARTNER_ASSET_REGISTER_ERROR_CODES)[number];

export type PartnerRegisteredAssetDto = Readonly<{
  assetId: string;
  status: StageAssetStatus;
  originalFileName: string | null;
  measuredWidthM: number;
  measuredHeightM: number;
  measuredDepthM: number;
  sha256: string | null;
  registeredAt: string;
  origin: "partner_intake" | "catalog_linked";
}>;

export type PartnerAssetRegistrationDto = Readonly<{
  assetId: string;
  status: typeof PARTNER_INTAKE_REGISTRATION_STATUS;
  originalFileName: string;
  measuredWidthM: number;
  measuredHeightM: number;
  measuredDepthM: number;
  sha256: string;
  registeredAt: string;
}>;

export type PartnerAssetStorageRow = Readonly<{
  assetId: string;
  storageBucket: string;
  storageObjectPath: string;
  sha256: string;
  source: typeof PARTNER_INTAKE_ASSET_SOURCE | typeof CERTIFIED_STATIC_ASSET_SOURCE;
  createdAt: string;
}>;

export type PartnerAssetMappingRow = Readonly<{
  partnerId: string;
  assetId: string;
  intakeId: string | null;
  createdAt: string;
}>;

export type PartnerAssetCatalogRow = Readonly<{
  assetId: string;
  glbUrl: string;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  status: StageAssetStatus;
  createdAt: string;
}>;

export type PartnerAssetRegisterRpcPayload = Readonly<{
  partnerId: string;
  intakeId: string;
  assetId: string;
  glbUrl: string;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  status: typeof PARTNER_INTAKE_REGISTRATION_STATUS;
  storageBucket: string;
  storageObjectPath: string;
  sha256: string;
  source: typeof PARTNER_INTAKE_ASSET_SOURCE;
  placementScale: typeof PLACEMENT_SCALE_UNIT;
}>;

export type PartnerAssetRegisterRpcResult = Readonly<{
  ok: true;
  idempotent: boolean;
  assetId: string;
  status: typeof PARTNER_INTAKE_REGISTRATION_STATUS;
  originalFileName: string;
  measuredWidthM: number;
  measuredHeightM: number;
  measuredDepthM: number;
  sha256: string;
  registeredAt: string;
}>;

export type PartnerAssetBinaryStore = Readonly<{
  download(objectPath: string): Promise<
    | { ok: true; bytes: Uint8Array }
    | { ok: false; code: "missing" | "failed" }
  >;
  uploadFinal(input: Readonly<{
    objectPath: string;
    bytes: Uint8Array;
    contentType: string;
    upsert: false;
  }>): Promise<
    | { ok: true; kind: "written" | "exists" }
    | { ok: false; code: "failed" }
  >;
}>;

export type PartnerAssetRegistry = Readonly<{
  register(payload: PartnerAssetRegisterRpcPayload): Promise<
    | { ok: true; result: PartnerAssetRegisterRpcResult }
    | { ok: false; code: PartnerAssetRegisterErrorCode }
  >;
  loadAsset(assetId: string): Promise<PartnerAssetCatalogRow | null>;
  loadStorage(assetId: string): Promise<PartnerAssetStorageRow | null>;
  listPartnerAssets(partnerId: string): Promise<readonly PartnerRegisteredAssetDto[]>;
}>;

function jsonError(
  status: number,
  errorCode: PartnerAssetRegisterErrorCode,
  extra: Record<string, unknown> = {},
): PartnerPortalHttpResponse {
  return {
    status,
    body: {
      ok: false,
      error: merchantMessageForRegisterErrorCode(errorCode),
      errorCode,
      ...extra,
    },
  };
}

export function merchantMessageForRegisterErrorCode(code: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Unauthorized";
    case "FORBIDDEN":
      return "Forbidden";
    case "INTAKE_NOT_FOUND":
      return "Intake not found.";
    case "INTAKE_NOT_VALIDATED":
      return "This GLB intake has not passed validation.";
    case "INTAKE_MISSING_SHA":
      return "This intake is missing a validated SHA-256.";
    case "INTAKE_MISSING_MEASURED_DIMENSIONS":
      return "This intake is missing measured GLB dimensions.";
    case "INVALID_PLACEMENT_SCALE":
      return "The GLB is not authored at real-world scale. Vibode does not automatically resize furniture.";
    case "SOURCE_OBJECT_MISSING":
      return "The validated GLB object was not found.";
    case "SOURCE_BYTE_SIZE_MISMATCH":
      return "The current GLB file size does not match the validated intake.";
    case "SOURCE_SHA_MISMATCH":
      return "The current GLB bytes do not match the validated intake.";
    case "FINAL_OBJECT_CONFLICT":
      return "A different GLB already exists at the runtime Asset path.";
    case "FINAL_OBJECT_SHA_MISMATCH":
      return "The runtime Asset object could not be verified.";
    case "REGISTRATION_CONFLICT":
      return "Asset registration could not be completed.";
    case "ASSET_INCOMPATIBLE":
      return "A conflicting Asset already exists for this intake.";
    case "ASSET_UNAVAILABLE":
      return "This Asset is not runtime-ready.";
    case "SERVICE_UNAVAILABLE":
      return "Partner Portal is unavailable.";
    default:
      return "The Asset could not be registered.";
  }
}

export function httpStatusForRegisterError(code: PartnerAssetRegisterErrorCode): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "INTAKE_NOT_FOUND") return 404;
  if (code === "SERVICE_UNAVAILABLE") return 500;
  if (code === "INVALID_REQUEST") return 400;
  return 409;
}

export function isPartnerAssetRegisterErrorCode(value: string): value is PartnerAssetRegisterErrorCode {
  return (PARTNER_ASSET_REGISTER_ERROR_CODES as readonly string[]).includes(value);
}

export function registerErrorFromRpcMessage(message: string): PartnerAssetRegisterErrorCode {
  const match = message.match(/VIBODE_STAGE_ASSET:([A-Z0-9_]+)/);
  const code = match?.[1];
  if (code && isPartnerAssetRegisterErrorCode(code)) return code;
  return "REGISTRATION_CONFLICT";
}

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX_SHAPE.test(value);
}

export function isUnitPlacementScale(value: number | null | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value - PLACEMENT_SCALE_UNIT) <= MEASURED_DIM_EPSILON;
}

export function sameMeasuredMetres(left: number, right: number): boolean {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= MEASURED_DIM_EPSILON;
}

export function isPositiveFiniteMetres(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export { formatSha256Prefix };

export function registrationPreconditions(intake: PartnerAssetIntakeRow):
  | { ok: true }
  | { ok: false; errorCode: PartnerAssetRegisterErrorCode } {
  if (intake.status !== "validated") {
    return { ok: false, errorCode: "INTAKE_NOT_VALIDATED" };
  }
  if (!intake.sha256 || !isSha256Hex(intake.sha256)) {
    return { ok: false, errorCode: "INTAKE_MISSING_SHA" };
  }
  if (
    !isPositiveFiniteMetres(intake.measuredWidthM) ||
    !isPositiveFiniteMetres(intake.measuredHeightM) ||
    !isPositiveFiniteMetres(intake.measuredDepthM)
  ) {
    return { ok: false, errorCode: "INTAKE_MISSING_MEASURED_DIMENSIONS" };
  }
  if (!isUnitPlacementScale(intake.placementScale)) {
    return { ok: false, errorCode: "INVALID_PLACEMENT_SCALE" };
  }
  if (intake.dimensionSource === "product") {
    if (
      !isPositiveFiniteMetres(intake.authoredWidthM) ||
      !isPositiveFiniteMetres(intake.authoredHeightM) ||
      !isPositiveFiniteMetres(intake.authoredDepthM)
    ) {
      return { ok: false, errorCode: "INTAKE_NOT_VALIDATED" };
    }
  } else if (intake.dimensionSource === "glb") {
    if (intake.authoredWidthM != null || intake.authoredHeightM != null || intake.authoredDepthM != null) {
      return { ok: false, errorCode: "INTAKE_NOT_VALIDATED" };
    }
  } else {
    return { ok: false, errorCode: "INTAKE_NOT_VALIDATED" };
  }
  return { ok: true };
}

export function buildPartnerAssetRegisterRpcPayload(input: Readonly<{
  partnerId: string;
  intake: PartnerAssetIntakeRow;
  sha256: string;
}>): PartnerAssetRegisterRpcPayload | { ok: false; errorCode: PartnerAssetRegisterErrorCode } {
  const pre = registrationPreconditions(input.intake);
  if (!pre.ok) return pre;
  if (input.intake.partnerId !== input.partnerId) {
    return { ok: false, errorCode: "FORBIDDEN" };
  }
  const assetId = partnerIntakeRuntimeAssetId(input.intake.intakeId);
  const glbUrl = assetId ? partnerRuntimeAssetGlbRoute(assetId) : null;
  const storageObjectPath = assetId ? partnerRuntimeAssetObjectPath(assetId) : null;
  if (!assetId || !glbUrl || !storageObjectPath || isValidatorIntakeAssetId(assetId)) {
    return { ok: false, errorCode: "INVALID_REQUEST" };
  }
  if (!isSha256Hex(input.sha256) || input.sha256 !== input.intake.sha256) {
    return { ok: false, errorCode: "SOURCE_SHA_MISMATCH" };
  }
  return {
    partnerId: input.partnerId,
    intakeId: input.intake.intakeId,
    assetId,
    glbUrl,
    authoredWidthM: input.intake.measuredWidthM as number,
    authoredHeightM: input.intake.measuredHeightM as number,
    authoredDepthM: input.intake.measuredDepthM as number,
    status: PARTNER_INTAKE_REGISTRATION_STATUS,
    storageBucket: PARTNER_ASSET_INTAKE_BUCKET,
    storageObjectPath,
    sha256: input.sha256,
    source: PARTNER_INTAKE_ASSET_SOURCE,
    placementScale: PLACEMENT_SCALE_UNIT,
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

export type MemoryPartnerAssetRegistry = PartnerAssetRegistry & {
  assets: PartnerAssetCatalogRow[];
  storage: PartnerAssetStorageRow[];
  mappings: PartnerAssetMappingRow[];
  intakes: PartnerAssetIntakeStore & { rows: PartnerAssetIntakeRow[] };
  failNextRegister: boolean;
  registerCalls: number;
};

export function createMemoryPartnerAssetRegistry(
  intakes: PartnerAssetIntakeStore & { rows: PartnerAssetIntakeRow[] },
  seed: Readonly<{
    assets?: readonly PartnerAssetCatalogRow[];
    storage?: readonly PartnerAssetStorageRow[];
    mappings?: readonly PartnerAssetMappingRow[];
  }> = {},
): MemoryPartnerAssetRegistry {
  const assets = [...(seed.assets ?? [])];
  const storage = [...(seed.storage ?? [])];
  const mappings = [...(seed.mappings ?? [])];
  let chain = Promise.resolve();
  const registry: MemoryPartnerAssetRegistry = {
    assets,
    storage,
    mappings,
    intakes,
    failNextRegister: false,
    registerCalls: 0,
    async register(payload) {
      const run = chain.then(() => applyPartnerAssetRegistration({
        payload,
        assets,
        storage,
        mappings,
        intakes,
        failOnce: () => {
          if (!registry.failNextRegister) return false;
          registry.failNextRegister = false;
          return true;
        },
      }));
      chain = run.then(() => undefined, () => undefined);
      registry.registerCalls += 1;
      return run;
    },
    async loadAsset(assetId) {
      return assets.find((item) => item.assetId === assetId) ?? null;
    },
    async loadStorage(assetId) {
      return storage.find((item) => item.assetId === assetId) ?? null;
    },
    async listPartnerAssets(partnerId) {
      return listRegisteredAssetsFromRows({ partnerId, assets, storage, mappings, intakes: intakes.rows });
    },
  };
  return registry;
}

export function listRegisteredAssetsFromRows(input: Readonly<{
  partnerId: string;
  assets: readonly PartnerAssetCatalogRow[];
  storage: readonly PartnerAssetStorageRow[];
  mappings: readonly PartnerAssetMappingRow[];
  intakes: readonly PartnerAssetIntakeRow[];
}>): PartnerRegisteredAssetDto[] {
  const dtos: PartnerRegisteredAssetDto[] = [];
  for (const mapping of input.mappings) {
    if (mapping.partnerId !== input.partnerId) continue;
    const asset = input.assets.find((item) => item.assetId === mapping.assetId);
    if (!asset) continue;
    const storageRow = input.storage.find((item) => item.assetId === mapping.assetId) ?? null;
    const intake = mapping.intakeId
      ? input.intakes.find((item) => item.intakeId === mapping.intakeId) ?? null
      : null;
    dtos.push({
      assetId: asset.assetId,
      status: asset.status,
      originalFileName: intake?.originalFileName ?? null,
      measuredWidthM: asset.authoredWidthM,
      measuredHeightM: asset.authoredHeightM,
      measuredDepthM: asset.authoredDepthM,
      sha256: storageRow?.sha256 ?? null,
      registeredAt: mapping.createdAt,
      origin: mapping.intakeId ? "partner_intake" : "catalog_linked",
    });
  }
  return dtos.sort((left, right) => (
    right.registeredAt.localeCompare(left.registeredAt) || left.assetId.localeCompare(right.assetId)
  ));
}

export function backfillPartnerAssetMappings(input: Readonly<{
  products: readonly Readonly<{
    partnerId: string | null;
    source: string;
    productId: string;
  }>[];
  variants: readonly Readonly<{
    productId: string;
    currentAssetId: string | null;
  }>[];
}>): Array<{ partnerId: string; assetId: string; intakeId: null }> {
  const seen = new Set<string>();
  const rows: Array<{ partnerId: string; assetId: string; intakeId: null }> = [];
  for (const product of input.products) {
    if (product.source !== "partner_catalog" || !product.partnerId) continue;
    for (const variant of input.variants) {
      if (variant.productId !== product.productId || !variant.currentAssetId) continue;
      const key = `${product.partnerId}\0${variant.currentAssetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        partnerId: product.partnerId,
        assetId: variant.currentAssetId,
        intakeId: null,
      });
    }
  }
  return rows;
}

function immutableFieldsMatch(
  payload: PartnerAssetRegisterRpcPayload,
  asset: PartnerAssetCatalogRow,
  storageRow: PartnerAssetStorageRow,
): boolean {
  return (
    asset.assetId === payload.assetId &&
    asset.glbUrl === payload.glbUrl &&
    sameMeasuredMetres(asset.authoredWidthM, payload.authoredWidthM) &&
    sameMeasuredMetres(asset.authoredHeightM, payload.authoredHeightM) &&
    sameMeasuredMetres(asset.authoredDepthM, payload.authoredDepthM) &&
    storageRow.storageBucket === payload.storageBucket &&
    storageRow.storageObjectPath === payload.storageObjectPath &&
    storageRow.sha256 === payload.sha256 &&
    storageRow.source === payload.source &&
    !isValidatorIntakeAssetId(asset.assetId)
  );
}

export async function applyPartnerAssetRegistration(input: Readonly<{
  payload: PartnerAssetRegisterRpcPayload;
  assets: PartnerAssetCatalogRow[];
  storage: PartnerAssetStorageRow[];
  mappings: PartnerAssetMappingRow[];
  intakes: PartnerAssetIntakeStore & { rows: PartnerAssetIntakeRow[] };
  failOnce?: () => boolean;
  nowIso?: string;
}>): Promise<
  | { ok: true; result: PartnerAssetRegisterRpcResult }
  | { ok: false; code: PartnerAssetRegisterErrorCode }
> {
  const payload = input.payload;
  const expectedAssetId = partnerIntakeRuntimeAssetId(payload.intakeId);
  const expectedGlb = expectedAssetId ? partnerRuntimeAssetGlbRoute(expectedAssetId) : null;
  const expectedPath = expectedAssetId ? partnerRuntimeAssetObjectPath(expectedAssetId) : null;
  if (
    !expectedAssetId ||
    !expectedGlb ||
    !expectedPath ||
    payload.assetId !== expectedAssetId ||
    payload.glbUrl !== expectedGlb ||
    payload.storageObjectPath !== expectedPath ||
    payload.storageBucket !== PARTNER_ASSET_INTAKE_BUCKET ||
    payload.source !== PARTNER_INTAKE_ASSET_SOURCE ||
    payload.status !== PARTNER_INTAKE_REGISTRATION_STATUS ||
    payload.placementScale !== PLACEMENT_SCALE_UNIT ||
    !isSha256Hex(payload.sha256) ||
    isValidatorIntakeAssetId(payload.assetId) ||
    isForbiddenBrowserUploadObjectPath(payload.storageObjectPath) === false
  ) {
    return { ok: false, code: "INVALID_REQUEST" };
  }

  const intake = await input.intakes.findByIntakeId(payload.intakeId);
  if (!intake) return { ok: false, code: "INTAKE_NOT_FOUND" };
  if (intake.partnerId !== payload.partnerId) return { ok: false, code: "FORBIDDEN" };

  if (intake.assetId) {
    if (intake.assetId !== expectedAssetId) return { ok: false, code: "ASSET_INCOMPATIBLE" };
    const asset = input.assets.find((item) => item.assetId === expectedAssetId);
    const storageRow = input.storage.find((item) => item.assetId === expectedAssetId);
    if (!asset || !storageRow || !immutableFieldsMatch(payload, asset, storageRow)) {
      return { ok: false, code: "ASSET_INCOMPATIBLE" };
    }
    const mapping = input.mappings.find((item) => (
      item.partnerId === payload.partnerId && item.assetId === expectedAssetId
    ));
    if (mapping && mapping.intakeId && mapping.intakeId !== payload.intakeId) {
      return { ok: false, code: "ASSET_INCOMPATIBLE" };
    }
    if (!mapping) {
      input.mappings.push({
        partnerId: payload.partnerId,
        assetId: expectedAssetId,
        intakeId: payload.intakeId,
        createdAt: input.nowIso ?? nowIso(),
      });
    } else if (!mapping.intakeId) {
      const index = input.mappings.indexOf(mapping);
      input.mappings[index] = { ...mapping, intakeId: payload.intakeId };
    }
    return {
      ok: true,
      result: {
        ok: true,
        idempotent: true,
        assetId: asset.assetId,
        status: PARTNER_INTAKE_REGISTRATION_STATUS,
        originalFileName: intake.originalFileName,
        measuredWidthM: asset.authoredWidthM,
        measuredHeightM: asset.authoredHeightM,
        measuredDepthM: asset.authoredDepthM,
        sha256: storageRow.sha256,
        registeredAt: asset.createdAt,
      },
    };
  }

  const pre = registrationPreconditions(intake);
  if (!pre.ok) return { ok: false, code: pre.errorCode };
  if (intake.sha256 !== payload.sha256) return { ok: false, code: "SOURCE_SHA_MISMATCH" };
  if (
    !sameMeasuredMetres(intake.measuredWidthM as number, payload.authoredWidthM) ||
    !sameMeasuredMetres(intake.measuredHeightM as number, payload.authoredHeightM) ||
    !sameMeasuredMetres(intake.measuredDepthM as number, payload.authoredDepthM)
  ) {
    return { ok: false, code: "ASSET_INCOMPATIBLE" };
  }

  const existingAsset = input.assets.find((item) => item.assetId === expectedAssetId) ?? null;
  const existingStorage = input.storage.find((item) => item.assetId === expectedAssetId) ?? null;
  if (existingAsset || existingStorage) {
    if (
      !existingAsset ||
      !existingStorage ||
      existingAsset.status === "ready" ||
      !immutableFieldsMatch(payload, existingAsset, existingStorage)
    ) {
      return { ok: false, code: "ASSET_INCOMPATIBLE" };
    }
  }

  if (input.failOnce?.()) return { ok: false, code: "REGISTRATION_CONFLICT" };

  const stamp = input.nowIso ?? nowIso();
  if (!existingAsset) {
    input.assets.push({
      assetId: expectedAssetId,
      glbUrl: payload.glbUrl,
      authoredWidthM: payload.authoredWidthM,
      authoredHeightM: payload.authoredHeightM,
      authoredDepthM: payload.authoredDepthM,
      status: PARTNER_INTAKE_REGISTRATION_STATUS,
      createdAt: stamp,
    });
  }
  if (!existingStorage) {
    input.storage.push({
      assetId: expectedAssetId,
      storageBucket: payload.storageBucket,
      storageObjectPath: payload.storageObjectPath,
      sha256: payload.sha256,
      source: PARTNER_INTAKE_ASSET_SOURCE,
      createdAt: stamp,
    });
  }
  const existingMapping = input.mappings.find((item) => (
    item.partnerId === payload.partnerId && item.assetId === expectedAssetId
  ));
  if (existingMapping && existingMapping.intakeId && existingMapping.intakeId !== payload.intakeId) {
    return { ok: false, code: "ASSET_INCOMPATIBLE" };
  }
  if (!existingMapping) {
    input.mappings.push({
      partnerId: payload.partnerId,
      assetId: expectedAssetId,
      intakeId: payload.intakeId,
      createdAt: stamp,
    });
  } else if (!existingMapping.intakeId) {
    const index = input.mappings.indexOf(existingMapping);
    input.mappings[index] = { ...existingMapping, intakeId: payload.intakeId };
  }
  const intakeIndex = input.intakes.rows.findIndex((item) => item.intakeId === payload.intakeId);
  if (intakeIndex < 0) return { ok: false, code: "INTAKE_NOT_FOUND" };
  const current = input.intakes.rows[intakeIndex]!;
  if (current.assetId && current.assetId !== expectedAssetId) {
    return { ok: false, code: "ASSET_INCOMPATIBLE" };
  }
  input.intakes.rows[intakeIndex] = { ...current, assetId: expectedAssetId, updatedAt: stamp };

  const asset = input.assets.find((item) => item.assetId === expectedAssetId)!;
  const storageRow = input.storage.find((item) => item.assetId === expectedAssetId)!;
  return {
    ok: true,
    result: {
      ok: true,
      idempotent: Boolean(existingAsset),
      assetId: asset.assetId,
      status: PARTNER_INTAKE_REGISTRATION_STATUS,
      originalFileName: current.originalFileName,
      measuredWidthM: asset.authoredWidthM,
      measuredHeightM: asset.authoredHeightM,
      measuredDepthM: asset.authoredDepthM,
      sha256: storageRow.sha256,
      registeredAt: asset.createdAt,
    },
  };
}

async function verifyFinalObjectSha(input: Readonly<{
  objects: PartnerAssetBinaryStore;
  objectPath: string;
  expectedSha256: string;
}>): Promise<
  | { ok: true; sha256: string; bytes: Uint8Array }
  | { ok: false; code: PartnerAssetRegisterErrorCode }
> {
  const downloaded = await input.objects.download(input.objectPath);
  if (!downloaded.ok) {
    return { ok: false, code: downloaded.code === "missing" ? "FINAL_OBJECT_SHA_MISMATCH" : "SERVICE_UNAVAILABLE" };
  }
  const sha256 = sha256Hex(downloaded.bytes);
  if (sha256 !== input.expectedSha256) {
    return { ok: false, code: "FINAL_OBJECT_SHA_MISMATCH" };
  }
  return { ok: true, sha256, bytes: downloaded.bytes };
}

function toRegistrationDto(result: PartnerAssetRegisterRpcResult): PartnerAssetRegistrationDto {
  return {
    assetId: result.assetId,
    status: PARTNER_INTAKE_REGISTRATION_STATUS,
    originalFileName: result.originalFileName,
    measuredWidthM: result.measuredWidthM,
    measuredHeightM: result.measuredHeightM,
    measuredDepthM: result.measuredDepthM,
    sha256: result.sha256,
    registeredAt: result.registeredAt,
  };
}

function isFailedPayload(
  payload: PartnerAssetRegisterRpcPayload | { ok: false; errorCode: PartnerAssetRegisterErrorCode },
): payload is { ok: false; errorCode: PartnerAssetRegisterErrorCode } {
  return "ok" in payload && payload.ok === false;
}

export async function registerPartnerAsset(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerAssetIntakeStore;
  objects: PartnerAssetBinaryStore;
  registry: PartnerAssetRegistry;
  intakeId: string;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return httpFromIntakeAuth(input.auth)!;
  const intakeId = input.intakeId.trim().toLowerCase();
  if (!partnerIntakeRuntimeAssetId(intakeId)) {
    return jsonError(404, "INTAKE_NOT_FOUND");
  }
  const partnerId = input.auth.context.partnerId;
  const intake = await input.store.findByIntakeId(intakeId);
  if (!intake) return jsonError(404, "INTAKE_NOT_FOUND");
  if (intake.partnerId !== partnerId) return jsonError(403, "FORBIDDEN");

  const expectedAssetId = partnerIntakeRuntimeAssetId(intake.intakeId);
  const finalPath = expectedAssetId ? partnerRuntimeAssetObjectPath(expectedAssetId) : null;
  if (!expectedAssetId || !finalPath) {
    return jsonError(500, "SERVICE_UNAVAILABLE");
  }

  if (intake.assetId) {
    if (intake.assetId !== expectedAssetId) {
      return jsonError(409, "ASSET_INCOMPATIBLE");
    }
    const asset = await input.registry.loadAsset(expectedAssetId);
    const storageRow = await input.registry.loadStorage(expectedAssetId);
    if (!asset || !storageRow) return jsonError(409, "ASSET_INCOMPATIBLE");
    if (storageRow.source !== PARTNER_INTAKE_ASSET_SOURCE) {
      return jsonError(409, "ASSET_INCOMPATIBLE");
    }
    if (!isSha256Hex(storageRow.sha256)) return jsonError(409, "ASSET_INCOMPATIBLE");
    const verified = await verifyFinalObjectSha({
      objects: input.objects,
      objectPath: storageRow.storageObjectPath,
      expectedSha256: storageRow.sha256,
    });
    if (!verified.ok) return jsonError(httpStatusForRegisterError(verified.code), verified.code);
    const payload = buildPartnerAssetRegisterRpcPayload({
      partnerId,
      intake,
      sha256: storageRow.sha256,
    });
    if (isFailedPayload(payload)) {
      return jsonError(httpStatusForRegisterError(payload.errorCode), payload.errorCode);
    }
    const rpc = await input.registry.register(payload);
    if (!rpc.ok) return jsonError(httpStatusForRegisterError(rpc.code), rpc.code);
    return {
      status: 200,
      body: {
        ok: true,
        idempotent: true,
        asset: toRegistrationDto(rpc.result),
      },
    };
  }

  const pre = registrationPreconditions(intake);
  if (!pre.ok) return jsonError(httpStatusForRegisterError(pre.errorCode), pre.errorCode);

  const source = await input.objects.download(intake.objectPath);
  if (!source.ok) {
    if (source.code === "missing") return jsonError(409, "SOURCE_OBJECT_MISSING");
    return jsonError(500, "SERVICE_UNAVAILABLE");
  }
  const sourceBytes = copyBytes(source.bytes);
  const actualSize = sourceBytes.byteLength;
  if (actualSize > PARTNER_ASSET_INTAKE_MAX_BYTES || actualSize !== intake.byteSize) {
    return jsonError(409, "SOURCE_BYTE_SIZE_MISMATCH");
  }
  const sourceSha = sha256Hex(sourceBytes);
  if (sourceSha !== intake.sha256) {
    return jsonError(409, "SOURCE_SHA_MISMATCH");
  }

  const uploaded = await input.objects.uploadFinal({
    objectPath: finalPath,
    bytes: sourceBytes,
    contentType: PARTNER_RUNTIME_ASSET_CONTENT_TYPE,
    upsert: false,
  });
  if (!uploaded.ok) return jsonError(500, "SERVICE_UNAVAILABLE");

  const destination = await verifyFinalObjectSha({
    objects: input.objects,
    objectPath: finalPath,
    expectedSha256: sourceSha,
  });
  if (!destination.ok) {
    if (uploaded.kind === "exists" && destination.code === "FINAL_OBJECT_SHA_MISMATCH") {
      return jsonError(409, "FINAL_OBJECT_CONFLICT");
    }
    return jsonError(httpStatusForRegisterError(destination.code), destination.code);
  }

  const payload = buildPartnerAssetRegisterRpcPayload({
    partnerId,
    intake,
    sha256: sourceSha,
  });
  if (isFailedPayload(payload)) {
    return jsonError(httpStatusForRegisterError(payload.errorCode), payload.errorCode);
  }
  const rpc = await input.registry.register(payload);
  if (!rpc.ok) return jsonError(httpStatusForRegisterError(rpc.code), rpc.code);
  if (rpc.result.status !== PARTNER_INTAKE_REGISTRATION_STATUS) {
    return jsonError(409, "ASSET_INCOMPATIBLE");
  }
  return {
    status: 200,
    body: {
      ok: true,
      idempotent: rpc.result.idempotent,
      asset: toRegistrationDto(rpc.result),
    },
  };
}

export async function listPartnerRegisteredAssets(input: Readonly<{
  auth: PartnerPortalAuthResult;
  registry: PartnerAssetRegistry;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return httpFromIntakeAuth(input.auth)!;
  const assets = await input.registry.listPartnerAssets(input.auth.context.partnerId);
  return {
    status: 200,
    body: {
      ok: true,
      assets,
    },
  };
}

export function parsePartnerAssetRegisterBody(body: unknown):
  | { ok: true }
  | { ok: false; errorCode: "INVALID_REQUEST" } {
  if (body == null) return { ok: true };
  if (!isPlainObject(body)) return { ok: false, errorCode: "INVALID_REQUEST" };
  if (Object.keys(body).length > 0) return { ok: false, errorCode: "INVALID_REQUEST" };
  return { ok: true };
}

export function parseGlbPlaceholderAssetPath(segments: readonly string[]):
  | { ok: true; assetId: string }
  | { ok: false } {
  if (segments.length < 2) return { ok: false };
  if (segments[segments.length - 1] !== "glb") return { ok: false };
  const assetId = segments.slice(0, -1).join("/");
  if (!assetId || assetId.includes("..")) return { ok: false };
  if (isPartnerIntakeRuntimeAssetId(assetId) || assetId.length > 0) {
    return { ok: true, assetId };
  }
  return { ok: false };
}

export function partnerAssetGlbPlaceholderResponse(): PartnerPortalHttpResponse {
  return jsonError(409, "ASSET_UNAVAILABLE");
}

export function mapPartnerAssetStorageRow(row: Record<string, unknown>): PartnerAssetStorageRow | null {
  const assetId = asNonEmptyString(row.asset_id);
  const storageBucket = asNonEmptyString(row.storage_bucket);
  const storageObjectPath = asNonEmptyString(row.storage_object_path);
  const sha256 = asNonEmptyString(row.sha256);
  const source = asNonEmptyString(row.source);
  const createdAt = asNonEmptyString(row.created_at);
  if (
    !assetId ||
    !storageBucket ||
    !storageObjectPath ||
    !sha256 ||
    !isSha256Hex(sha256) ||
    (source !== PARTNER_INTAKE_ASSET_SOURCE && source !== CERTIFIED_STATIC_ASSET_SOURCE) ||
    !createdAt
  ) {
    return null;
  }
  return {
    assetId,
    storageBucket,
    storageObjectPath,
    sha256,
    source,
    createdAt,
  };
}

export function mapPartnerAssetMappingRow(row: Record<string, unknown>): PartnerAssetMappingRow | null {
  const partnerId = asNonEmptyString(row.partner_id);
  const assetId = asNonEmptyString(row.asset_id);
  const createdAt = asNonEmptyString(row.created_at);
  if (!partnerId || !assetId || !createdAt) return null;
  return {
    partnerId,
    assetId,
    intakeId: asNonEmptyString(row.intake_id),
    createdAt,
  };
}

export function mapPartnerAssetCatalogRow(row: Record<string, unknown>): PartnerAssetCatalogRow | null {
  const assetId = asNonEmptyString(row.asset_id);
  const glbUrl = asNonEmptyString(row.glb_url);
  const authoredWidthM = typeof row.authored_width_m === "number" ? row.authored_width_m : Number(row.authored_width_m);
  const authoredHeightM = typeof row.authored_height_m === "number" ? row.authored_height_m : Number(row.authored_height_m);
  const authoredDepthM = typeof row.authored_depth_m === "number" ? row.authored_depth_m : Number(row.authored_depth_m);
  const status = asNonEmptyString(row.status);
  const createdAt = asNonEmptyString(row.created_at);
  if (
    !assetId ||
    !glbUrl ||
    !Number.isFinite(authoredWidthM) ||
    !Number.isFinite(authoredHeightM) ||
    !Number.isFinite(authoredDepthM) ||
    (status !== "ready" && status !== "unavailable") ||
    !createdAt
  ) {
    return null;
  }
  return {
    assetId,
    glbUrl,
    authoredWidthM,
    authoredHeightM,
    authoredDepthM,
    status,
    createdAt,
  };
}
