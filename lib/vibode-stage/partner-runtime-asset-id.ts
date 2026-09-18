/**
 * PI-5G5B1 deterministic Partner-intake runtime Asset IDs.
 *
 * Server-derived only. Same intake → same Asset ID. New intake → new ID.
 * Partner ID is not encoded. This is not a public git path and is not the
 * G5A validator identity `intake:{intakeId}`.
 */

import { isUuidLike } from "./asset-id";

export const PARTNER_INTAKE_RUNTIME_ASSET_ID_PREFIX = "vibode-stage/partner-intake/";
export const PARTNER_RUNTIME_ASSET_OBJECT_PREFIX = "assets/";
export const PARTNER_RUNTIME_ASSET_OBJECT_NAME = "model.glb";
export const PARTNER_RUNTIME_ASSET_GLB_ROUTE_PREFIX = "/api/vibode/assets/";
export const PARTNER_RUNTIME_ASSET_GLB_ROUTE_SUFFIX = "/glb";
export const PARTNER_INTAKE_ASSET_SOURCE = "partner_intake";
export const CERTIFIED_STATIC_ASSET_SOURCE = "certified_static";

const VALIDATOR_INTAKE_ASSET_PREFIX = "intake:";

export function normalizeIntakeUuid(intakeId: string): string | null {
  const trimmed = intakeId.trim().toLowerCase();
  if (!isUuidLike(trimmed)) return null;
  return trimmed;
}

export function partnerIntakeRuntimeAssetId(intakeId: string): string | null {
  const uuid = normalizeIntakeUuid(intakeId);
  if (!uuid) return null;
  return `${PARTNER_INTAKE_RUNTIME_ASSET_ID_PREFIX}${uuid}`;
}

export function isPartnerIntakeRuntimeAssetId(assetId: string): boolean {
  if (!assetId.startsWith(PARTNER_INTAKE_RUNTIME_ASSET_ID_PREFIX)) return false;
  const suffix = assetId.slice(PARTNER_INTAKE_RUNTIME_ASSET_ID_PREFIX.length);
  return normalizeIntakeUuid(suffix) === suffix;
}

export function intakeIdFromPartnerIntakeRuntimeAssetId(assetId: string): string | null {
  if (!isPartnerIntakeRuntimeAssetId(assetId)) return null;
  return assetId.slice(PARTNER_INTAKE_RUNTIME_ASSET_ID_PREFIX.length);
}

export function isValidatorIntakeAssetId(assetId: string): boolean {
  return assetId.startsWith(VALIDATOR_INTAKE_ASSET_PREFIX);
}

export function partnerRuntimeAssetObjectPath(assetId: string): string | null {
  if (!assetId || assetId.includes("..") || assetId.startsWith("/") || assetId.includes("\\")) {
    return null;
  }
  if (assetId.length < 1 || assetId.length > 256) return null;
  return `${PARTNER_RUNTIME_ASSET_OBJECT_PREFIX}${assetId}/${PARTNER_RUNTIME_ASSET_OBJECT_NAME}`;
}

export function partnerRuntimeAssetGlbRoute(assetId: string): string | null {
  if (!assetId || assetId.includes("..") || assetId.startsWith("/") || assetId.includes("\\")) {
    return null;
  }
  if (assetId.length < 1 || assetId.length > 256) return null;
  return `${PARTNER_RUNTIME_ASSET_GLB_ROUTE_PREFIX}${assetId}${PARTNER_RUNTIME_ASSET_GLB_ROUTE_SUFFIX}`;
}

export function isForbiddenBrowserUploadObjectPath(objectPath: string): boolean {
  const normalized = objectPath.trim().replace(/^\/+/, "");
  if (!normalized || normalized.includes("..")) return true;
  return normalized === "assets" || normalized.startsWith(`${PARTNER_RUNTIME_ASSET_OBJECT_PREFIX}`);
}

export function isPartnerRuntimeFinalObjectPath(objectPath: string, assetId: string): boolean {
  const expected = partnerRuntimeAssetObjectPath(assetId);
  return expected != null && objectPath === expected;
}
