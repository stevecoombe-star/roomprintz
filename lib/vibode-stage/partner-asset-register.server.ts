import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolvePartnerPortalContext } from "./partner-portal-auth.server";
import type { PartnerPortalHttpResponse } from "./partner-portal-http";
import {
  mapPartnerAssetIntakeRow,
  PARTNER_ASSET_INTAKE_BUCKET,
  STAGE_PARTNER_ASSET_INTAKES_TABLE,
  type PartnerAssetIntakeRow,
  type PartnerAssetIntakeStore,
} from "./partner-asset-intake";
import {
  createSupabasePartnerAssetIntakeStore,
} from "./partner-asset-intake.server";
import {
  listPartnerRegisteredAssets,
  listRegisteredAssetsFromRows,
  mapPartnerAssetCatalogRow,
  mapPartnerAssetMappingRow,
  mapPartnerAssetStorageRow,
  parsePartnerAssetRegisterBody,
  PARTNER_RUNTIME_ASSET_CONTENT_TYPE,
  registerErrorFromRpcMessage,
  registerPartnerAsset,
  STAGE_ASSET_STORAGE_TABLE,
  STAGE_PARTNER_ASSETS_TABLE,
  STAGE_REGISTER_PARTNER_ASSET_RPC,
  type PartnerAssetBinaryStore,
  type PartnerAssetCatalogRow,
  type PartnerAssetMappingRow,
  type PartnerAssetRegisterErrorCode,
  type PartnerAssetRegisterRpcPayload,
  type PartnerAssetRegisterRpcResult,
  type PartnerAssetRegistry,
  type PartnerAssetStorageRow,
  type PartnerRegisteredAssetDto,
} from "./partner-asset-register";
import { isForbiddenBrowserUploadObjectPath } from "./partner-runtime-asset-id";

const INTAKE_SELECT =
  "intake_id, partner_id, created_by_user_id, status, object_path, original_filename, byte_size, sha256, dimension_source, authored_width_m, authored_height_m, authored_depth_m, measured_width_m, measured_height_m, measured_depth_m, placement_scale, validation_warnings, error_code, error_detail, asset_id, created_at, updated_at";

const ASSET_SELECT =
  "asset_id, glb_url, authored_width_m, authored_height_m, authored_depth_m, status, created_at";

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

function isAlreadyExists(error: { message?: string; status?: number; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  const status = String(error.status ?? error.statusCode ?? "");
  return (
    status === "409" ||
    message.includes("already exists") ||
    message.includes("duplicate") ||
    message.includes("resource already exists")
  );
}

function isMissingObject(error: { message?: string; status?: number; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  const status = String(error.status ?? error.statusCode ?? "");
  return status === "404" || message.includes("not found") || message.includes("404");
}

function mapRpcResult(value: unknown): PartnerAssetRegisterRpcResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.ok !== true) return null;
  const assetId = typeof row.assetId === "string" ? row.assetId : null;
  const status = row.status === "unavailable" ? "unavailable" as const : null;
  const originalFileName = typeof row.originalFileName === "string" ? row.originalFileName : null;
  const sha256 = typeof row.sha256 === "string" ? row.sha256 : null;
  const registeredAt = typeof row.registeredAt === "string"
    ? row.registeredAt
    : row.registeredAt instanceof Date
      ? row.registeredAt.toISOString()
      : null;
  const measuredWidthM = Number(row.measuredWidthM);
  const measuredHeightM = Number(row.measuredHeightM);
  const measuredDepthM = Number(row.measuredDepthM);
  if (
    !assetId ||
    !status ||
    !originalFileName ||
    !sha256 ||
    !registeredAt ||
    !Number.isFinite(measuredWidthM) ||
    !Number.isFinite(measuredHeightM) ||
    !Number.isFinite(measuredDepthM)
  ) {
    return null;
  }
  return {
    ok: true,
    idempotent: row.idempotent === true,
    assetId,
    status,
    originalFileName,
    measuredWidthM,
    measuredHeightM,
    measuredDepthM,
    sha256,
    registeredAt,
  };
}

export function createSupabasePartnerAssetBinaryStore(supabase: SupabaseClient): PartnerAssetBinaryStore {
  const bucket = supabase.storage.from(PARTNER_ASSET_INTAKE_BUCKET);
  return {
    async download(objectPath) {
      const { data, error } = await bucket.download(objectPath);
      if (error || !data) {
        return { ok: false, code: isMissingObject(error) ? "missing" : "failed" };
      }
      const buffer = await data.arrayBuffer();
      return { ok: true, bytes: new Uint8Array(buffer) };
    },
    async uploadFinal(input) {
      if (input.upsert !== false) return { ok: false, code: "failed" };
      if (input.contentType !== PARTNER_RUNTIME_ASSET_CONTENT_TYPE) return { ok: false, code: "failed" };
      if (!isForbiddenBrowserUploadObjectPath(input.objectPath)) return { ok: false, code: "failed" };
      const { error } = await bucket.upload(input.objectPath, Buffer.from(input.bytes), {
        upsert: false,
        contentType: PARTNER_RUNTIME_ASSET_CONTENT_TYPE,
      });
      if (!error) return { ok: true, kind: "written" };
      if (isAlreadyExists(error)) return { ok: true, kind: "exists" };
      return { ok: false, code: "failed" };
    },
  };
}

function createSupabasePartnerAssetRegistry(
  supabase: SupabaseClient,
): PartnerAssetRegistry {
  return {
    async register(payload: PartnerAssetRegisterRpcPayload) {
      const { data, error } = await supabase.rpc(STAGE_REGISTER_PARTNER_ASSET_RPC, {
        p_register: payload,
      });
      if (error) {
        const code: PartnerAssetRegisterErrorCode = registerErrorFromRpcMessage(error.message ?? "");
        return { ok: false, code };
      }
      const mapped = mapRpcResult(data);
      if (!mapped) return { ok: false, code: "REGISTRATION_CONFLICT" };
      return { ok: true, result: mapped };
    },
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
        .select("asset_id, storage_bucket, storage_object_path, sha256, source, created_at")
        .eq("asset_id", assetId)
        .maybeSingle();
      if (error || !data) return null;
      return mapPartnerAssetStorageRow(data as Record<string, unknown>);
    },
    async listPartnerAssets(partnerId) {
      const { data: mappingData, error: mappingError } = await supabase
        .from(STAGE_PARTNER_ASSETS_TABLE)
        .select("partner_id, asset_id, intake_id, created_at")
        .eq("partner_id", partnerId)
        .order("created_at", { ascending: false });
      if (mappingError || !Array.isArray(mappingData)) return [];
      const mappings: PartnerAssetMappingRow[] = mappingData.flatMap((row) => {
        const mapped = mapPartnerAssetMappingRow(row as Record<string, unknown>);
        return mapped ? [mapped] : [];
      });
      const assetIds = [...new Set(mappings.map((item) => item.assetId))];
      const intakeIds = [...new Set(mappings.flatMap((item) => item.intakeId ? [item.intakeId] : []))];
      const assets: PartnerAssetCatalogRow[] = [];
      const storage: PartnerAssetStorageRow[] = [];
      const intakes: PartnerAssetIntakeRow[] = [];
      if (assetIds.length > 0) {
        const { data: assetData } = await supabase
          .from("vibode_stage_assets")
          .select(ASSET_SELECT)
          .in("asset_id", assetIds);
        if (Array.isArray(assetData)) {
          for (const row of assetData) {
            const mapped = mapPartnerAssetCatalogRow(row as Record<string, unknown>);
            if (mapped) assets.push(mapped);
          }
        }
        const { data: storageData } = await supabase
          .from(STAGE_ASSET_STORAGE_TABLE)
          .select("asset_id, storage_bucket, storage_object_path, sha256, source, created_at")
          .in("asset_id", assetIds);
        if (Array.isArray(storageData)) {
          for (const row of storageData) {
            const mapped = mapPartnerAssetStorageRow(row as Record<string, unknown>);
            if (mapped) storage.push(mapped);
          }
        }
      }
      if (intakeIds.length > 0) {
        const { data: intakeData } = await supabase
          .from(STAGE_PARTNER_ASSET_INTAKES_TABLE)
          .select(INTAKE_SELECT)
          .in("intake_id", intakeIds)
          .eq("partner_id", partnerId);
        if (Array.isArray(intakeData)) {
          for (const row of intakeData) {
            const mapped = mapPartnerAssetIntakeRow(row as Record<string, unknown>);
            if (mapped) intakes.push(mapped);
          }
        }
      }
      return listRegisteredAssetsFromRows({
        partnerId,
        assets,
        storage,
        mappings,
        intakes,
      });
    },
  };
}

async function registrationStores(): Promise<{
  store: PartnerAssetIntakeStore;
  objects: PartnerAssetBinaryStore;
  registry: PartnerAssetRegistry;
} | null> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return null;
  return {
    store: createSupabasePartnerAssetIntakeStore(supabase),
    objects: createSupabasePartnerAssetBinaryStore(supabase),
    registry: createSupabasePartnerAssetRegistry(supabase),
  };
}

export async function partnerAssetRegisterResponse(
  intakeId: string,
  body: unknown,
): Promise<PartnerPortalHttpResponse> {
  const parsed = parsePartnerAssetRegisterBody(body);
  if (!parsed.ok) {
    return {
      status: 400,
      body: { ok: false, error: "Invalid request.", errorCode: "INVALID_REQUEST" },
    };
  }
  const auth = await resolvePartnerPortalContext();
  const stores = await registrationStores();
  if (!stores) {
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
  return registerPartnerAsset({
    auth,
    store: stores.store,
    objects: stores.objects,
    registry: stores.registry,
    intakeId,
  });
}

export async function partnerRegisteredAssetListResponse(): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const stores = await registrationStores();
  if (!stores) {
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
  return listPartnerRegisteredAssets({ auth, registry: stores.registry });
}

export type { PartnerRegisteredAssetDto };
