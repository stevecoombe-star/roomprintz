/**
 * PI-5G5B2 dynamic Partner runtime Asset lookup and activation.
 *
 * Room runtime: static-miss → batch private provenance lookup → mint
 * ephemeral signed GET. Partner mapping is not a room-load gate.
 * Activation: mapped Partner + signed GET proof → unavailable → ready.
 *
 * This module does not import commercial catalog, picker, or publish
 * executors. Storage bucket/path never appear on runtime DTOs.
 */

import {
  furnitureAssetDefinition,
} from "@/lib/afc-v2-runtime/furniture-assets";
import {
  PI4C_MAX_ASSET_ID_LENGTH,
  PI4C_MAX_SCENE_OBJECTS,
} from "@/lib/afc-v2-runtime/persisted-scene";
import {
  createRuntimeAssetIssue,
  furnitureAssetDefinitionFromRuntime,
  overlayFromRuntimeDefinitions,
  parseRuntimeFurnitureAssetDefinition,
  RUNTIME_ASSET_SIGNED_GET_EXPIRES_SEC,
  uniqueSceneAssetIds,
  type RuntimeAssetIssue,
  type RuntimeFurnitureAssetDefinition,
} from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import type { FurnitureAssetDefinition, SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";

import {
  isPositiveFiniteMetres,
  mapPartnerAssetCatalogRow,
  mapPartnerAssetMappingRow,
  mapPartnerAssetStorageRow,
  type PartnerAssetCatalogRow,
  type PartnerAssetMappingRow,
  type PartnerAssetStorageRow,
  type MemoryPartnerAssetRegistry,
} from "./partner-asset-register";
import { httpFromIntakeAuth } from "./partner-asset-intake";
import type { PartnerPortalAuthResult } from "./partner-portal-auth";
import type { PartnerPortalHttpResponse } from "./partner-portal-http";
import { PARTNER_INTAKE_ASSET_SOURCE } from "./partner-runtime-asset-id";
import { asNonEmptyString, isPlainObject } from "./product-variant-register";

export const STAGE_ACTIVATE_PARTNER_ASSET_RPC = "vibode_stage_activate_partner_asset";

export const PARTNER_RUNTIME_ASSET_ACTIVATE_ERROR_CODES = Object.freeze([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "ASSET_NOT_FOUND",
  "ASSET_INCOMPATIBLE",
  "TRANSPORT_PROOF_FAILED",
  "ACTIVATION_CONFLICT",
  "SERVICE_UNAVAILABLE",
  "INVALID_REQUEST",
] as const);

export type PartnerRuntimeAssetActivateErrorCode =
  (typeof PARTNER_RUNTIME_ASSET_ACTIVATE_ERROR_CODES)[number];

export type DynamicRuntimeLookupRow = Readonly<{
  assetId: string;
  status: "ready" | "unavailable";
  source: typeof PARTNER_INTAKE_ASSET_SOURCE;
  authoredWidthM: number;
  authoredHeightM: number;
  authoredDepthM: number;
  storageBucket: string;
  storageObjectPath: string;
}>;

export type SignedGetMintResult =
  | Readonly<{ ok: true; signedUrl: string; expiresAt: string }>
  | Readonly<{ ok: false }>;

export type SignedGetProofResult =
  | Readonly<{ ok: true; status: number; byteLength: number }>
  | Readonly<{ ok: false }>;

export type SceneRuntimeAssetResolution = Readonly<{
  assetDefinitions: RuntimeFurnitureAssetDefinition[];
  assetIssues: RuntimeAssetIssue[];
  queriedIds: readonly string[] | null;
}>;

export type PartnerAssetActivationDto = Readonly<{
  assetId: string;
  status: "ready";
  originalFileName: string | null;
  measuredWidthM: number;
  measuredHeightM: number;
  measuredDepthM: number;
}>;

export type PartnerAssetActivateRpcPayload = Readonly<{
  partnerId: string;
  assetId: string;
}>;

export type PartnerAssetActivateRpcResult = Readonly<{
  ok: true;
  idempotent: boolean;
  assetId: string;
  status: "ready";
}>;

export type PartnerRuntimeActivationStore = Readonly<{
  loadAsset(assetId: string): Promise<PartnerAssetCatalogRow | null>;
  loadStorage(assetId: string): Promise<PartnerAssetStorageRow | null>;
  loadMapping(partnerId: string, assetId: string): Promise<PartnerAssetMappingRow | null>;
  activate(payload: PartnerAssetActivateRpcPayload): Promise<
    | { ok: true; result: PartnerAssetActivateRpcResult }
    | { ok: false; code: PartnerRuntimeAssetActivateErrorCode }
  >;
}>;

const RESOLVE_BODY_KEYS = Object.freeze([
  "roomId",
  "versionId",
  "afcGenerationId",
  "assetIds",
] as const);

function jsonError(
  status: number,
  errorCode: PartnerRuntimeAssetActivateErrorCode,
  extra: Record<string, unknown> = {},
): PartnerPortalHttpResponse {
  return {
    status,
    body: {
      ok: false,
      error: merchantMessageForActivateErrorCode(errorCode),
      errorCode,
      ...extra,
    },
  };
}

export function merchantMessageForActivateErrorCode(code: string): string {
  switch (code) {
    case "UNAUTHORIZED":
      return "Unauthorized";
    case "FORBIDDEN":
      return "Forbidden";
    case "ASSET_NOT_FOUND":
      return "Asset not found.";
    case "TRANSPORT_PROOF_FAILED":
      return "This Asset could not be activated for room runtime.";
    case "ASSET_INCOMPATIBLE":
      return "This Asset cannot be activated.";
    case "SERVICE_UNAVAILABLE":
      return "Partner Portal is unavailable.";
    case "INVALID_REQUEST":
      return "Invalid request.";
    default:
      return "The Asset could not be activated.";
  }
}

export function httpStatusForActivateError(code: PartnerRuntimeAssetActivateErrorCode): number {
  if (code === "UNAUTHORIZED") return 401;
  if (code === "FORBIDDEN") return 403;
  if (code === "ASSET_NOT_FOUND") return 404;
  if (code === "SERVICE_UNAVAILABLE") return 500;
  if (code === "INVALID_REQUEST") return 400;
  return 409;
}

export function isPartnerRuntimeAssetActivateErrorCode(
  value: string,
): value is PartnerRuntimeAssetActivateErrorCode {
  return (PARTNER_RUNTIME_ASSET_ACTIVATE_ERROR_CODES as readonly string[]).includes(value);
}

export function activateErrorFromRpcMessage(message: string): PartnerRuntimeAssetActivateErrorCode {
  const match = message.match(/VIBODE_STAGE_ASSET:([A-Z0-9_]+)/);
  const code = match?.[1];
  if (code && isPartnerRuntimeAssetActivateErrorCode(code)) return code;
  return "ACTIVATION_CONFLICT";
}

export function warnRuntimeAssetIssue(issue: RuntimeAssetIssue): void {
  if (typeof console === "undefined") return;
  console.warn("[vibode-runtime-assets]", {
    assetId: issue.assetId,
    issueCode: issue.code,
    objectId: issue.objectId ?? null,
  });
}

export function collectSceneAssetIds(
  objects: readonly SceneObjectDefinition[],
): string[] {
  return uniqueSceneAssetIds(objects.map((object) => object.assetId));
}

export function splitStaticAndDynamicAssetIds(
  assetIds: readonly string[],
): Readonly<{
  staticIds: string[];
  dynamicMisses: string[];
}> {
  const staticIds: string[] = [];
  const dynamicMisses: string[] = [];
  const seen = new Set<string>();
  for (const assetId of assetIds) {
    if (seen.has(assetId)) continue;
    seen.add(assetId);
    if (furnitureAssetDefinition(assetId)) {
      staticIds.push(assetId);
      continue;
    }
    dynamicMisses.push(assetId);
  }
  return { staticIds, dynamicMisses };
}

export function isValidDynamicTechnicalRow(
  row: DynamicRuntimeLookupRow,
): boolean {
  return (
    row.source === PARTNER_INTAKE_ASSET_SOURCE &&
    isPositiveFiniteMetres(row.authoredWidthM) &&
    isPositiveFiniteMetres(row.authoredHeightM) &&
    isPositiveFiniteMetres(row.authoredDepthM) &&
    row.storageBucket.trim().length > 0 &&
    row.storageObjectPath.trim().length > 0 &&
    !row.storageObjectPath.includes("..")
  );
}

export function runtimeDefinitionFromLookup(
  row: DynamicRuntimeLookupRow,
  signedUrl: string,
  expiresAt: string,
): RuntimeFurnitureAssetDefinition {
  return {
    assetId: row.assetId,
    glbUrl: signedUrl,
    authoredWidthM: row.authoredWidthM,
    authoredHeightM: row.authoredHeightM,
    authoredDepthM: row.authoredDepthM,
    expiresAt,
  };
}

export async function resolveSceneRuntimeAssets(input: Readonly<{
  assetIds: readonly string[];
  lookupDynamicAssets: (
    ids: readonly string[],
  ) => Promise<readonly DynamicRuntimeLookupRow[]>;
  mintSignedGet: (row: DynamicRuntimeLookupRow) => Promise<SignedGetMintResult>;
  maxIds?: number;
  readyOnly?: boolean;
}>): Promise<SceneRuntimeAssetResolution> {
  const unique = uniqueSceneAssetIds(input.assetIds, input.maxIds ?? PI4C_MAX_SCENE_OBJECTS);
  const { dynamicMisses } = splitStaticAndDynamicAssetIds(unique);
  if (dynamicMisses.length === 0) {
    return { assetDefinitions: [], assetIssues: [], queriedIds: null };
  }

  const rows = await input.lookupDynamicAssets(dynamicMisses);
  const byId = new Map(rows.map((row) => [row.assetId, row]));
  const assetDefinitions: RuntimeFurnitureAssetDefinition[] = [];
  const assetIssues: RuntimeAssetIssue[] = [];
  const readyOnly = input.readyOnly !== false;

  for (const assetId of dynamicMisses) {
    if (furnitureAssetDefinition(assetId)) {
      assetIssues.push(createRuntimeAssetIssue(assetId, "RUNTIME_ASSET_COLLISION"));
      continue;
    }
    const row = byId.get(assetId) ?? null;
    if (!row) {
      assetIssues.push(createRuntimeAssetIssue(assetId, "RUNTIME_ASSET_NOT_FOUND"));
      continue;
    }
    if (!isValidDynamicTechnicalRow(row) || row.source !== PARTNER_INTAKE_ASSET_SOURCE) {
      assetIssues.push(createRuntimeAssetIssue(assetId, "RUNTIME_ASSET_NOT_FOUND"));
      continue;
    }
    if (row.status !== "ready") {
      if (readyOnly) {
        assetIssues.push(createRuntimeAssetIssue(assetId, "RUNTIME_ASSET_NOT_READY"));
      }
      continue;
    }
    const minted = await input.mintSignedGet(row);
    if (!minted.ok) {
      const issue = createRuntimeAssetIssue(assetId, "RUNTIME_ASSET_URL_MINT_FAILED");
      assetIssues.push(issue);
      warnRuntimeAssetIssue(issue);
      continue;
    }
    const dto = runtimeDefinitionFromLookup(row, minted.signedUrl, minted.expiresAt);
    if (runtimeDefinitionLeaksProvenance(dto)) {
      const issue = createRuntimeAssetIssue(assetId, "RUNTIME_ASSET_URL_MINT_FAILED");
      assetIssues.push(issue);
      warnRuntimeAssetIssue(issue);
      continue;
    }
    assetDefinitions.push(dto);
  }

  return { assetDefinitions, assetIssues, queriedIds: dynamicMisses };
}

export function runtimeDefinitionLeaksProvenance(
  dto: RuntimeFurnitureAssetDefinition,
): boolean {
  const json = JSON.stringify(dto);
  return (
    "storageBucket" in dto ||
    "storageObjectPath" in dto ||
    "sha256" in dto ||
    "partnerId" in dto ||
    "intakeId" in dto ||
    "source" in dto ||
    json.includes("storage_object_path") ||
    json.includes("storage_bucket")
  );
}

export function intersectRequestedSceneAssetIds(input: Readonly<{
  requestedAssetIds: readonly string[];
  sceneAssetIds: readonly string[];
  maxIds?: number;
}>): string[] {
  const scene = new Set(input.sceneAssetIds);
  const allowed: string[] = [];
  const seen = new Set<string>();
  for (const raw of input.requestedAssetIds) {
    const assetId = raw.trim();
    if (!assetId || seen.has(assetId) || !scene.has(assetId)) continue;
    seen.add(assetId);
    allowed.push(assetId);
    if (allowed.length >= (input.maxIds ?? PI4C_MAX_SCENE_OBJECTS)) break;
  }
  return allowed;
}

export function parseRuntimeAssetResolveBody(body: unknown):
  | {
      ok: true;
      roomId: string;
      versionId: string;
      afcGenerationId: string;
      assetIds: string[];
    }
  | { ok: false; error: string } {
  if (!isPlainObject(body)) {
    return { ok: false, error: "Invalid request." };
  }
  const extra = Object.keys(body).filter(
    (key) => !(RESOLVE_BODY_KEYS as readonly string[]).includes(key),
  );
  if (extra.length > 0) {
    return { ok: false, error: "Invalid request." };
  }
  const roomId = asNonEmptyString(body.roomId);
  const versionId = asNonEmptyString(body.versionId);
  const afcGenerationId = asNonEmptyString(body.afcGenerationId);
  if (!roomId || !versionId || !afcGenerationId) {
    return { ok: false, error: "roomId, versionId, and afcGenerationId are required." };
  }
  if (!Array.isArray(body.assetIds)) {
    return { ok: false, error: "assetIds must be an array." };
  }
  if (body.assetIds.length === 0 || body.assetIds.length > PI4C_MAX_SCENE_OBJECTS) {
    return { ok: false, error: "assetIds is invalid." };
  }
  const assetIds: string[] = [];
  const seen = new Set<string>();
  for (const item of body.assetIds) {
    if (typeof item !== "string") {
      return { ok: false, error: "assetIds is invalid." };
    }
    const assetId = item.trim();
    if (
      !assetId ||
      assetId.length > PI4C_MAX_ASSET_ID_LENGTH ||
      assetId.includes("..") ||
      seen.has(assetId)
    ) {
      return { ok: false, error: "assetIds is invalid." };
    }
    seen.add(assetId);
    assetIds.push(assetId);
  }
  return { ok: true, roomId, versionId, afcGenerationId, assetIds };
}

export function parsePartnerAssetActivateBody(body: unknown):
  | { ok: true }
  | { ok: false; errorCode: "INVALID_REQUEST" } {
  if (body == null) return { ok: true };
  if (!isPlainObject(body)) return { ok: false, errorCode: "INVALID_REQUEST" };
  if (Object.keys(body).length > 0) return { ok: false, errorCode: "INVALID_REQUEST" };
  return { ok: true };
}

export function parseActivateAssetIdParam(raw: string | undefined): string | null {
  if (!raw) return null;
  let assetId = raw.trim();
  try {
    assetId = decodeURIComponent(assetId).trim();
  } catch {
    return null;
  }
  if (
    !assetId ||
    assetId.length > PI4C_MAX_ASSET_ID_LENGTH ||
    assetId.includes("..") ||
    assetId.includes("\\")
  ) {
    return null;
  }
  return assetId;
}

export function lookupRowFromCatalogAndStorage(
  asset: PartnerAssetCatalogRow,
  storage: PartnerAssetStorageRow,
): DynamicRuntimeLookupRow | null {
  if (storage.source !== PARTNER_INTAKE_ASSET_SOURCE) return null;
  if (storage.assetId !== asset.assetId) return null;
  const row: DynamicRuntimeLookupRow = {
    assetId: asset.assetId,
    status: asset.status,
    source: PARTNER_INTAKE_ASSET_SOURCE,
    authoredWidthM: asset.authoredWidthM,
    authoredHeightM: asset.authoredHeightM,
    authoredDepthM: asset.authoredDepthM,
    storageBucket: storage.storageBucket,
    storageObjectPath: storage.storageObjectPath,
  };
  if (!isValidDynamicTechnicalRow(row)) return null;
  return row;
}

export function applyPartnerAssetActivation(input: Readonly<{
  payload: PartnerAssetActivateRpcPayload;
  assets: PartnerAssetCatalogRow[];
  storage: PartnerAssetStorageRow[];
  mappings: PartnerAssetMappingRow[];
}>):
  | { ok: true; result: PartnerAssetActivateRpcResult }
  | { ok: false; code: PartnerRuntimeAssetActivateErrorCode } {
  const partnerId = input.payload.partnerId.trim();
  const assetId = input.payload.assetId.trim();
  if (!partnerId || !assetId) return { ok: false, code: "INVALID_REQUEST" };

  const mapping = input.mappings.find((item) => (
    item.partnerId === partnerId && item.assetId === assetId
  ));
  if (!mapping) return { ok: false, code: "FORBIDDEN" };

  const asset = input.assets.find((item) => item.assetId === assetId) ?? null;
  const storageRow = input.storage.find((item) => item.assetId === assetId) ?? null;
  if (!asset || !storageRow) return { ok: false, code: "ASSET_NOT_FOUND" };
  if (storageRow.source !== PARTNER_INTAKE_ASSET_SOURCE) {
    return { ok: false, code: "ASSET_INCOMPATIBLE" };
  }
  if (asset.status !== "unavailable" && asset.status !== "ready") {
    return { ok: false, code: "ASSET_INCOMPATIBLE" };
  }

  const idempotent = asset.status === "ready";
  if (!idempotent) {
    const index = input.assets.indexOf(asset);
    input.assets[index] = { ...asset, status: "ready" };
  }
  return {
    ok: true,
    result: {
      ok: true,
      idempotent,
      assetId,
      status: "ready",
    },
  };
}

export function createMemoryPartnerRuntimeActivationStore(
  registry: MemoryPartnerAssetRegistry,
): PartnerRuntimeActivationStore {
  return {
    async loadAsset(assetId) {
      return registry.assets.find((item) => item.assetId === assetId) ?? null;
    },
    async loadStorage(assetId) {
      return registry.storage.find((item) => item.assetId === assetId) ?? null;
    },
    async loadMapping(partnerId, assetId) {
      return registry.mappings.find((item) => (
        item.partnerId === partnerId && item.assetId === assetId
      )) ?? null;
    },
    async activate(payload) {
      return applyPartnerAssetActivation({
        payload,
        assets: registry.assets,
        storage: registry.storage,
        mappings: registry.mappings,
      });
    },
  };
}

export async function activatePartnerAsset(input: Readonly<{
  auth: PartnerPortalAuthResult;
  store: PartnerRuntimeActivationStore;
  assetId: string;
  mintSignedGet: (row: DynamicRuntimeLookupRow) => Promise<SignedGetMintResult>;
  proveSignedGet: (signedUrl: string) => Promise<SignedGetProofResult>;
}>): Promise<PartnerPortalHttpResponse> {
  if (!input.auth.ok) return httpFromIntakeAuth(input.auth)!;
  const assetId = parseActivateAssetIdParam(input.assetId);
  if (!assetId) return jsonError(404, "ASSET_NOT_FOUND");
  const partnerId = input.auth.context.partnerId;

  const mapping = await input.store.loadMapping(partnerId, assetId);
  if (!mapping) return jsonError(403, "FORBIDDEN");

  const asset = await input.store.loadAsset(assetId);
  const storageRow = await input.store.loadStorage(assetId);
  if (!asset || !storageRow) return jsonError(404, "ASSET_NOT_FOUND");
  const row = lookupRowFromCatalogAndStorage(asset, storageRow);
  if (!row) return jsonError(409, "ASSET_INCOMPATIBLE");
  if (asset.status !== "unavailable" && asset.status !== "ready") {
    return jsonError(409, "ASSET_INCOMPATIBLE");
  }

  const minted = await input.mintSignedGet(row);
  if (!minted.ok) return jsonError(409, "TRANSPORT_PROOF_FAILED");
  const proved = await input.proveSignedGet(minted.signedUrl);
  if (!proved.ok || proved.status !== 200 || proved.byteLength <= 0) {
    return jsonError(409, "TRANSPORT_PROOF_FAILED");
  }

  const rpc = await input.store.activate({ partnerId, assetId });
  if (!rpc.ok) {
    return jsonError(httpStatusForActivateError(rpc.code), rpc.code);
  }
  if (rpc.result.status !== "ready") {
    return jsonError(409, "ACTIVATION_CONFLICT");
  }

  return {
    status: 200,
    body: {
      ok: true,
      idempotent: rpc.result.idempotent,
      asset: {
        assetId: asset.assetId,
        status: "ready" as const,
        originalFileName: null,
        measuredWidthM: asset.authoredWidthM,
        measuredHeightM: asset.authoredHeightM,
        measuredDepthM: asset.authoredDepthM,
      } satisfies PartnerAssetActivationDto,
    },
  };
}

export function memoryLookupFromRegistry(
  registry: MemoryPartnerAssetRegistry,
): (ids: readonly string[]) => Promise<readonly DynamicRuntimeLookupRow[]> {
  return async (ids) => {
    const rows: DynamicRuntimeLookupRow[] = [];
    for (const assetId of ids) {
      const asset = registry.assets.find((item) => item.assetId === assetId);
      const storageRow = registry.storage.find((item) => item.assetId === assetId);
      if (!asset || !storageRow) continue;
      const row = lookupRowFromCatalogAndStorage(asset, storageRow);
      if (row) rows.push(row);
    }
    return rows;
  };
}

export function expiresAtFromNow(
  nowMs: number = Date.now(),
  ttlSec: number = RUNTIME_ASSET_SIGNED_GET_EXPIRES_SEC,
): string {
  return new Date(nowMs + ttlSec * 1000).toISOString();
}

export function overlayDefinitionsForViewer(
  definitions: readonly RuntimeFurnitureAssetDefinition[],
): ReadonlyMap<string, FurnitureAssetDefinition> {
  return overlayFromRuntimeDefinitions(definitions);
}

export function runtimeDefinitionAsFurniture(
  dto: RuntimeFurnitureAssetDefinition,
): FurnitureAssetDefinition {
  return furnitureAssetDefinitionFromRuntime(dto);
}

export { parseRuntimeFurnitureAssetDefinition, mapPartnerAssetCatalogRow, mapPartnerAssetStorageRow };
