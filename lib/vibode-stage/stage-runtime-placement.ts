/**
 * PI-5G5C2 customer STAGE commercial runtime placement.
 *
 * Browser-safe. Request/response types, parsers, customer-safe errors,
 * and pure commercial evaluation. Does not import server-only modules,
 * service-role Supabase, Node filesystem, furniture-manifest IO,
 * product-variant-register, or Partner runtime server code.
 */

import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";
import {
  PI4C_MAX_ASSET_ID_LENGTH,
  sceneIdentitiesEqual,
  type PersistedSceneIdentity,
} from "@/lib/afc-v2-runtime/persisted-scene";
import {
  parseRuntimeFurnitureAssetDefinition,
  runtimeDtoPrivacyViolations,
  type RuntimeFurnitureAssetDefinition,
} from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import { isValidatorIntakeAssetId } from "./partner-runtime-asset-id";

export const STAGE_RUNTIME_PLACEMENT_PATH = "/api/vibode/stage/runtime-placement";

export const STAGE_RUNTIME_PLACEMENT_REQUEST_KEYS = Object.freeze([
  "roomId",
  "versionId",
  "afcGenerationId",
  "productId",
  "variantId",
  "expectedAssetId",
] as const);

export const STAGE_RUNTIME_PLACEMENT_ERROR_CODES = Object.freeze([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "ROOM_NOT_FOUND",
  "VERSION_NOT_FOUND",
  "PRODUCT_NOT_FOUND",
  "PRODUCT_INACTIVE",
  "VARIANT_NOT_FOUND",
  "VARIANT_INACTIVE",
  "VARIANT_PRODUCT_MISMATCH",
  "PARTNER_INACTIVE",
  "ASSET_NOT_FOUND",
  "ASSET_NOT_READY",
  "STALE_VARIANT_ASSET",
  "RUNTIME_DEFINITION_UNAVAILABLE",
] as const);

export type StageRuntimePlacementErrorCode =
  (typeof STAGE_RUNTIME_PLACEMENT_ERROR_CODES)[number];

export type StageRuntimePlacementKind = "static" | "dynamic";

export type StageRuntimePlacementRequest = Readonly<{
  roomId: string;
  versionId: string;
  afcGenerationId: string;
  productId: string;
  variantId: string;
  expectedAssetId: string;
}>;

export type StageRuntimePlacementSuccess = Readonly<{
  ok: true;
  productId: string;
  variantId: string;
  assetId: string;
  placementKind: StageRuntimePlacementKind;
  runtimeAsset?: RuntimeFurnitureAssetDefinition;
}>;

export type StageRuntimePlacementFailure = Readonly<{
  ok: false;
  errorCode: StageRuntimePlacementErrorCode;
  error: string;
}>;

export type StageRuntimePlacementResult =
  | StageRuntimePlacementSuccess
  | StageRuntimePlacementFailure;

export type StageRuntimePlacementClientFailure = StageRuntimePlacementFailure & Readonly<{
  cancelled?: boolean;
  message: string;
}>;

export type StageRuntimePlacementClientResult =
  | (StageRuntimePlacementSuccess & Readonly<{ message?: undefined; cancelled?: undefined }>)
  | StageRuntimePlacementClientFailure;

export type EnsureStageCommercialPlacementInput = Readonly<{
  productId: string;
  variantId: string;
  expectedAssetId: string;
}>;

export type EnsureStageCommercialPlacement = (
  input: EnsureStageCommercialPlacementInput,
) => Promise<StageRuntimePlacementClientResult>;

export type StageCommercialProductSnapshot = Readonly<{
  productId: string;
  status: "active" | "inactive";
  partnerId: string | null;
}>;

export type StageCommercialVariantSnapshot = Readonly<{
  variantId: string;
  productId: string;
  status: "active" | "inactive";
  currentAssetId: string | null;
}>;

export type StageCommercialAssetSnapshot = Readonly<{
  assetId: string;
  status: "ready" | "unavailable";
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
}>;

export type StageCommercialPartnerSnapshot = Readonly<{
  partnerId: string;
  status: "active" | "inactive";
}>;

export type StageCommercialPlacementEvaluation =
  | Readonly<{
      ok: true;
      productId: string;
      variantId: string;
      assetId: string;
      partnerId: string | null;
    }>
  | Readonly<{
      ok: false;
      errorCode:
        | "PRODUCT_NOT_FOUND"
        | "PRODUCT_INACTIVE"
        | "VARIANT_NOT_FOUND"
        | "VARIANT_INACTIVE"
        | "VARIANT_PRODUCT_MISMATCH"
        | "PARTNER_INACTIVE"
        | "ASSET_NOT_FOUND"
        | "ASSET_NOT_READY";
    }>;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const STAGE_RUNTIME_PLACEMENT_COMMERCIAL_ID_SHAPE =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const SUCCESS_KEYS = Object.freeze([
  "ok",
  "productId",
  "variantId",
  "assetId",
  "placementKind",
  "runtimeAsset",
] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUuid(value: string): boolean {
  return UUID.test(value);
}

export function isStageRuntimePlacementErrorCode(
  value: string,
): value is StageRuntimePlacementErrorCode {
  return (STAGE_RUNTIME_PLACEMENT_ERROR_CODES as readonly string[]).includes(value);
}

export function isValidStageRuntimePlacementAssetId(assetId: string): boolean {
  const trimmed = assetId.trim();
  if (!trimmed) return false;
  if (trimmed.length > PI4C_MAX_ASSET_ID_LENGTH) return false;
  if (trimmed.includes("..") || trimmed.includes("\\") || trimmed.includes("\0")) {
    return false;
  }
  if (isValidatorIntakeAssetId(trimmed)) return false;
  return true;
}

export function isValidStageRuntimePlacementCommercialId(value: string): boolean {
  return STAGE_RUNTIME_PLACEMENT_COMMERCIAL_ID_SHAPE.test(value);
}

export function customerMessageForStageRuntimePlacementError(
  code: StageRuntimePlacementErrorCode,
): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Unauthorized.";
    case "ROOM_NOT_FOUND":
    case "VERSION_NOT_FOUND":
      return "Furniture isn't ready yet.";
    case "STALE_VARIANT_ASSET":
      return "Refresh the catalog and try again.";
    case "INVALID_REQUEST":
    case "RUNTIME_DEFINITION_UNAVAILABLE":
      return "This furniture model is temporarily unavailable.";
    case "ASSET_NOT_READY":
      return "This furniture model is temporarily unavailable.";
    case "PRODUCT_NOT_FOUND":
    case "PRODUCT_INACTIVE":
    case "VARIANT_NOT_FOUND":
    case "VARIANT_INACTIVE":
    case "VARIANT_PRODUCT_MISMATCH":
    case "PARTNER_INACTIVE":
    case "ASSET_NOT_FOUND":
      return "This item is no longer available.";
    default:
      return "This furniture model is temporarily unavailable.";
  }
}

export function httpStatusForStageRuntimePlacementError(
  code: StageRuntimePlacementErrorCode,
): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "ROOM_NOT_FOUND":
    case "VERSION_NOT_FOUND":
    case "PRODUCT_NOT_FOUND":
    case "VARIANT_NOT_FOUND":
    case "ASSET_NOT_FOUND":
      return 404;
    case "INVALID_REQUEST":
      return 400;
    case "RUNTIME_DEFINITION_UNAVAILABLE":
      return 409;
    default:
      return 409;
  }
}

export function stageRuntimePlacementFailure(
  errorCode: StageRuntimePlacementErrorCode,
): StageRuntimePlacementFailure {
  return {
    ok: false,
    errorCode,
    error: customerMessageForStageRuntimePlacementError(errorCode),
  };
}

export function parseStageRuntimePlacementRequest(
  body: unknown,
): { ok: true; request: StageRuntimePlacementRequest } | { ok: false } {
  if (!isRecord(body)) return { ok: false };
  const extra = Object.keys(body).filter(
    (key) => !(STAGE_RUNTIME_PLACEMENT_REQUEST_KEYS as readonly string[]).includes(key),
  );
  if (extra.length > 0) return { ok: false };
  for (const key of STAGE_RUNTIME_PLACEMENT_REQUEST_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) return { ok: false };
  }
  const roomId = asNonEmptyString(body.roomId);
  const versionId = asNonEmptyString(body.versionId);
  const afcGenerationId = asNonEmptyString(body.afcGenerationId);
  const productId = asNonEmptyString(body.productId);
  const variantId = asNonEmptyString(body.variantId);
  const expectedAssetId = asNonEmptyString(body.expectedAssetId);
  if (!roomId || !versionId || !afcGenerationId || !productId || !variantId || !expectedAssetId) {
    return { ok: false };
  }
  if (!isUuid(roomId) || !isUuid(versionId) || !isUuid(afcGenerationId)) {
    return { ok: false };
  }
  if (
    !isValidStageRuntimePlacementCommercialId(productId) ||
    !isValidStageRuntimePlacementCommercialId(variantId)
  ) {
    return { ok: false };
  }
  if (!isValidStageRuntimePlacementAssetId(expectedAssetId)) {
    return { ok: false };
  }
  return {
    ok: true,
    request: {
      roomId,
      versionId,
      afcGenerationId,
      productId,
      variantId,
      expectedAssetId,
    },
  };
}

export function parseStageRuntimePlacementSuccess(
  value: unknown,
): StageRuntimePlacementSuccess | null {
  if (!isRecord(value) || value.ok !== true) return null;
  const extra = Object.keys(value).filter(
    (key) => !(SUCCESS_KEYS as readonly string[]).includes(key),
  );
  if (extra.length > 0) return null;
  const productId = asNonEmptyString(value.productId);
  const variantId = asNonEmptyString(value.variantId);
  const assetId = asNonEmptyString(value.assetId);
  const placementKind = value.placementKind;
  if (
    !productId ||
    !variantId ||
    !assetId ||
    !isValidStageRuntimePlacementCommercialId(productId) ||
    !isValidStageRuntimePlacementCommercialId(variantId) ||
    !isValidStageRuntimePlacementAssetId(assetId)
  ) {
    return null;
  }
  if (placementKind !== "static" && placementKind !== "dynamic") return null;
  if (placementKind === "static") {
    if ("runtimeAsset" in value && value.runtimeAsset != null) return null;
    return { ok: true, productId, variantId, assetId, placementKind: "static" };
  }
  const runtimeAsset = parseRuntimeFurnitureAssetDefinition(value.runtimeAsset);
  if (!runtimeAsset || runtimeAsset.assetId !== assetId) return null;
  if (runtimeDtoPrivacyViolations(runtimeAsset).length > 0) return null;
  if (furnitureAssetDefinition(runtimeAsset.assetId)) return null;
  return {
    ok: true,
    productId,
    variantId,
    assetId,
    placementKind: "dynamic",
    runtimeAsset,
  };
}

export function parseStageRuntimePlacementFailure(
  value: unknown,
): StageRuntimePlacementFailure | null {
  if (!isRecord(value) || value.ok !== false) return null;
  const errorCode = typeof value.errorCode === "string" ? value.errorCode : "";
  if (!isStageRuntimePlacementErrorCode(errorCode)) return null;
  return stageRuntimePlacementFailure(errorCode);
}

export function interpretStageRuntimePlacementResponse(
  payload: unknown,
): StageRuntimePlacementResult {
  const success = parseStageRuntimePlacementSuccess(payload);
  if (success) return success;
  const failure = parseStageRuntimePlacementFailure(payload);
  if (failure) return failure;
  return stageRuntimePlacementFailure("INVALID_REQUEST");
}

export function interpretStageRuntimePlacementHttp(input: Readonly<{
  ok: boolean;
  status: number;
  payload: unknown;
}>): StageRuntimePlacementClientResult {
  const interpreted = interpretStageRuntimePlacementResponse(input.payload);
  if (interpreted.ok) {
    if (!input.ok) {
      return clientFailure("RUNTIME_DEFINITION_UNAVAILABLE");
    }
    return interpreted;
  }
  if (!input.ok && input.status === 401 && interpreted.errorCode === "INVALID_REQUEST") {
    return clientFailure("UNAUTHORIZED");
  }
  return {
    ...interpreted,
    message: interpreted.error,
  };
}

function clientFailure(
  errorCode: StageRuntimePlacementErrorCode,
  cancelled = false,
): StageRuntimePlacementClientFailure {
  const error = customerMessageForStageRuntimePlacementError(errorCode);
  return cancelled
    ? { ok: false, errorCode, error, message: error, cancelled: true }
    : { ok: false, errorCode, error, message: error };
}

export function classifyStagePlacementKind(assetId: string): StageRuntimePlacementKind {
  return furnitureAssetDefinition(assetId) ? "static" : "dynamic";
}

export function evaluateStageCommercialPlacement(input: Readonly<{
  product: StageCommercialProductSnapshot | null;
  variant: StageCommercialVariantSnapshot | null;
  asset: StageCommercialAssetSnapshot | null;
  partner?: StageCommercialPartnerSnapshot | null;
}>): StageCommercialPlacementEvaluation {
  const product = input.product;
  if (!product) return { ok: false, errorCode: "PRODUCT_NOT_FOUND" };
  if (product.status !== "active") return { ok: false, errorCode: "PRODUCT_INACTIVE" };

  const variant = input.variant;
  if (!variant) return { ok: false, errorCode: "VARIANT_NOT_FOUND" };
  if (variant.productId !== product.productId) {
    return { ok: false, errorCode: "VARIANT_PRODUCT_MISMATCH" };
  }
  if (variant.status !== "active") return { ok: false, errorCode: "VARIANT_INACTIVE" };

  const assetId = variant.currentAssetId?.trim() ?? "";
  if (!assetId) return { ok: false, errorCode: "ASSET_NOT_FOUND" };

  const asset = input.asset;
  if (!asset || asset.assetId !== assetId) return { ok: false, errorCode: "ASSET_NOT_FOUND" };
  if (asset.status !== "ready") return { ok: false, errorCode: "ASSET_NOT_READY" };

  const partnerId = product.partnerId?.trim() || null;
  if (partnerId) {
    const partner = input.partner;
    if (!partner || partner.partnerId !== partnerId || partner.status !== "active") {
      return { ok: false, errorCode: "PARTNER_INACTIVE" };
    }
  }

  return {
    ok: true,
    productId: product.productId,
    variantId: variant.variantId,
    assetId,
    partnerId,
  };
}

export function isCurrentStageSceneGuard(input: Readonly<{
  capturedIdentity: PersistedSceneIdentity | null;
  currentIdentity: PersistedSceneIdentity | null;
  capturedRevision: number;
  currentRevision: number;
}>): boolean {
  if (!input.capturedIdentity || !input.currentIdentity) return false;
  if (input.capturedRevision !== input.currentRevision) return false;
  return sceneIdentitiesEqual(input.capturedIdentity, input.currentIdentity);
}

export function shouldRetryStageDynamicFirstLoad(failedAttempts: number): boolean {
  return failedAttempts === 1;
}

export function acquireStageAddLock(lock: Set<string>, key: string): boolean {
  if (lock.has(key)) return false;
  lock.add(key);
  return true;
}

export function releaseStageAddLock(lock: Set<string>, key: string): void {
  lock.delete(key);
}

export function stageAddLockKey(productId: string, variantId: string): string {
  return `${productId}::${variantId}`;
}

export function returnedAssetMatchesExpected(
  expectedAssetId: string,
  returnedAssetId: string,
): boolean {
  return expectedAssetId.trim() === returnedAssetId.trim();
}

export async function fetchStageRuntimePlacement(input: Readonly<{
  request: StageRuntimePlacementRequest;
  token: string;
  fetchImpl?: typeof fetch;
}>): Promise<StageRuntimePlacementClientResult> {
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(STAGE_RUNTIME_PLACEMENT_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify(input.request),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    return interpretStageRuntimePlacementHttp({
      ok: response.ok,
      status: response.status,
      payload,
    });
  } catch {
    return clientFailure("RUNTIME_DEFINITION_UNAVAILABLE");
  }
}
