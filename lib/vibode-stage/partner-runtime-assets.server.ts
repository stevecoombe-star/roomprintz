import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type { SceneObjectDefinition } from "@/lib/afc-v2-runtime/types";
import {
  createRuntimeAssetIssue,
  RUNTIME_ASSET_SIGNED_GET_EXPIRES_SEC,
  type RuntimeAssetIssue,
  type RuntimeFurnitureAssetDefinition,
} from "@/lib/afc-v2-runtime/runtime-furniture-assets";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolvePartnerPortalContext } from "./partner-portal-auth.server";
import type { PartnerPortalHttpResponse } from "./partner-portal-http";
import {
  mapPartnerAssetCatalogRow,
  mapPartnerAssetMappingRow,
  mapPartnerAssetStorageRow,
  STAGE_ASSET_STORAGE_TABLE,
  STAGE_PARTNER_ASSETS_TABLE,
  type PartnerAssetCatalogRow,
  type PartnerAssetMappingRow,
  type PartnerAssetStorageRow,
} from "./partner-asset-register";
import {
  activateErrorFromRpcMessage,
  activatePartnerAsset,
  collectSceneAssetIds,
  expiresAtFromNow,
  parseActivateAssetIdParam,
  parsePartnerAssetActivateBody,
  resolveSceneRuntimeAssets,
  splitStaticAndDynamicAssetIds,
  STAGE_ACTIVATE_PARTNER_ASSET_RPC,
  warnRuntimeAssetIssue,
  type DynamicRuntimeLookupRow,
  type PartnerAssetActivateRpcPayload,
  type PartnerAssetActivateRpcResult,
  type PartnerRuntimeActivationStore,
  type PartnerRuntimeAssetActivateErrorCode,
  type SignedGetMintResult,
  type SignedGetProofResult,
} from "./partner-runtime-assets";
import { PARTNER_INTAKE_ASSET_SOURCE } from "./partner-runtime-asset-id";

const ASSET_SELECT =
  "asset_id, glb_url, authored_width_m, authored_height_m, authored_depth_m, status, created_at";
const STORAGE_SELECT =
  "asset_id, storage_bucket, storage_object_path, sha256, source, created_at";

function unavailable(): PartnerPortalHttpResponse {
  return {
    status: 500,
    body: {
      ok: false,
      error: "Partner Portal is unavailable.",
      errorCode: "SERVICE_UNAVAILABLE",
    },
  };
}

function mapActivateRpcResult(value: unknown): PartnerAssetActivateRpcResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.ok !== true) return null;
  const assetId = typeof row.assetId === "string" ? row.assetId : null;
  if (!assetId || row.status !== "ready") return null;
  return {
    ok: true,
    idempotent: row.idempotent === true,
    assetId,
    status: "ready",
  };
}

export async function mintPartnerRuntimeSignedGet(
  supabase: SupabaseClient,
  row: DynamicRuntimeLookupRow,
): Promise<SignedGetMintResult> {
  try {
    const { data, error } = await supabase.storage
      .from(row.storageBucket)
      .createSignedUrl(row.storageObjectPath, RUNTIME_ASSET_SIGNED_GET_EXPIRES_SEC);
    const signedUrl = typeof data?.signedUrl === "string" ? data.signedUrl.trim() : "";
    if (error || !signedUrl) return { ok: false };
    return {
      ok: true,
      signedUrl,
      expiresAt: expiresAtFromNow(),
    };
  } catch {
    return { ok: false };
  }
}

export async function provePartnerRuntimeSignedGet(
  signedUrl: string,
): Promise<SignedGetProofResult> {
  try {
    const response = await fetch(signedUrl, { method: "GET" });
    if (response.status !== 200) {
      return { ok: false };
    }
    const buffer = await response.arrayBuffer();
    const byteLength = buffer.byteLength;
    if (byteLength <= 0) return { ok: false };
    return { ok: true, status: 200, byteLength };
  } catch {
    return { ok: false };
  }
}

export async function lookupPartnerRuntimeAssets(
  supabase: SupabaseClient,
  assetIds: readonly string[],
): Promise<readonly DynamicRuntimeLookupRow[]> {
  if (assetIds.length === 0) return [];
  const { data: storageData, error: storageError } = await supabase
    .from(STAGE_ASSET_STORAGE_TABLE)
    .select(STORAGE_SELECT)
    .in("asset_id", [...assetIds])
    .eq("source", PARTNER_INTAKE_ASSET_SOURCE);
  if (storageError) {
    throw storageError;
  }
  if (!Array.isArray(storageData) || storageData.length === 0) {
    return [];
  }
  const storageById = new Map<string, PartnerAssetStorageRow>();
  for (const raw of storageData) {
    const mapped = mapPartnerAssetStorageRow(raw as Record<string, unknown>);
    if (mapped) storageById.set(mapped.assetId, mapped);
  }
  const foundIds = [...storageById.keys()];
  if (foundIds.length === 0) return [];
  const { data: assetData, error: assetError } = await supabase
    .from("vibode_stage_assets")
    .select(ASSET_SELECT)
    .in("asset_id", foundIds);
  if (assetError) {
    throw assetError;
  }
  if (!Array.isArray(assetData)) return [];
  const rows: DynamicRuntimeLookupRow[] = [];
  for (const raw of assetData) {
    const asset = mapPartnerAssetCatalogRow(raw as Record<string, unknown>);
    if (!asset) continue;
    const storageRow = storageById.get(asset.assetId);
    if (!storageRow || storageRow.source !== PARTNER_INTAKE_ASSET_SOURCE) continue;
    rows.push({
      assetId: asset.assetId,
      status: asset.status,
      source: PARTNER_INTAKE_ASSET_SOURCE,
      authoredWidthM: asset.authoredWidthM,
      authoredHeightM: asset.authoredHeightM,
      authoredDepthM: asset.authoredDepthM,
      storageBucket: storageRow.storageBucket,
      storageObjectPath: storageRow.storageObjectPath,
    });
  }
  return rows;
}

function mintFailedIssues(assetIds: readonly string[]): RuntimeAssetIssue[] {
  return assetIds.map((assetId) => {
    const issue = createRuntimeAssetIssue(assetId, "RUNTIME_ASSET_URL_MINT_FAILED");
    warnRuntimeAssetIssue(issue);
    return issue;
  });
}

export async function enrichOwnedSceneRuntimeAssets(
  objects: readonly SceneObjectDefinition[],
): Promise<{
  assetDefinitions: RuntimeFurnitureAssetDefinition[];
  assetIssues: RuntimeAssetIssue[];
}> {
  const { dynamicMisses } = splitStaticAndDynamicAssetIds(
    collectSceneAssetIds(objects),
  );
  if (dynamicMisses.length === 0) {
    return { assetDefinitions: [], assetIssues: [] };
  }
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    return { assetDefinitions: [], assetIssues: mintFailedIssues(dynamicMisses) };
  }
  try {
    const resolved = await resolveSceneRuntimeAssets({
      assetIds: objects.map((object) => object.assetId),
      lookupDynamicAssets: (ids) => lookupPartnerRuntimeAssets(supabase, ids),
      mintSignedGet: (row) => mintPartnerRuntimeSignedGet(supabase, row),
    });
    return {
      assetDefinitions: resolved.assetDefinitions,
      assetIssues: resolved.assetIssues,
    };
  } catch {
    return { assetDefinitions: [], assetIssues: mintFailedIssues(dynamicMisses) };
  }
}

function createSupabasePartnerRuntimeActivationStore(
  supabase: SupabaseClient,
): PartnerRuntimeActivationStore {
  return {
    async loadAsset(assetId) {
      const { data, error } = await supabase
        .from("vibode_stage_assets")
        .select(ASSET_SELECT)
        .eq("asset_id", assetId)
        .maybeSingle();
      if (error || !data) return null;
      return mapPartnerAssetCatalogRow(data as Record<string, unknown>);
    },
    async loadStorage(assetId) {
      const { data, error } = await supabase
        .from(STAGE_ASSET_STORAGE_TABLE)
        .select(STORAGE_SELECT)
        .eq("asset_id", assetId)
        .maybeSingle();
      if (error || !data) return null;
      return mapPartnerAssetStorageRow(data as Record<string, unknown>);
    },
    async loadMapping(partnerId, assetId) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_ASSETS_TABLE)
        .select("partner_id, asset_id, intake_id, created_at")
        .eq("partner_id", partnerId)
        .eq("asset_id", assetId)
        .maybeSingle();
      if (error || !data) return null;
      return mapPartnerAssetMappingRow(data as Record<string, unknown>);
    },
    async activate(payload: PartnerAssetActivateRpcPayload) {
      const { data, error } = await supabase.rpc(STAGE_ACTIVATE_PARTNER_ASSET_RPC, {
        p_activate: payload,
      });
      if (error) {
        const code: PartnerRuntimeAssetActivateErrorCode =
          activateErrorFromRpcMessage(error.message ?? "");
        return { ok: false, code };
      }
      const mapped = mapActivateRpcResult(data);
      if (!mapped) return { ok: false, code: "ACTIVATION_CONFLICT" };
      return { ok: true, result: mapped };
    },
  };
}

export async function partnerAssetActivateResponse(
  assetIdParam: string,
  body: unknown,
): Promise<PartnerPortalHttpResponse> {
  const parsed = parsePartnerAssetActivateBody(body);
  if (!parsed.ok) {
    return {
      status: 400,
      body: { ok: false, error: "Invalid request.", errorCode: "INVALID_REQUEST" },
    };
  }
  const assetId = parseActivateAssetIdParam(assetIdParam);
  if (!assetId) {
    return {
      status: 404,
      body: { ok: false, error: "Asset not found.", errorCode: "ASSET_NOT_FOUND" },
    };
  }
  const auth = await resolvePartnerPortalContext();
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    if (!auth.ok) {
      return {
        status: auth.status,
        body: {
          ok: false,
          error: auth.error,
          errorCode: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN",
        },
      };
    }
    return unavailable();
  }
  return activatePartnerAsset({
    auth,
    store: createSupabasePartnerRuntimeActivationStore(supabase),
    assetId,
    mintSignedGet: (row) => mintPartnerRuntimeSignedGet(supabase, row),
    proveSignedGet: (signedUrl) => provePartnerRuntimeSignedGet(signedUrl),
  });
}

export type { PartnerAssetCatalogRow, PartnerAssetMappingRow, PartnerAssetStorageRow };
