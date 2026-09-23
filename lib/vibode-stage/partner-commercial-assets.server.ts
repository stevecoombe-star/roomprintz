import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type { SupabaseClient } from "@supabase/supabase-js";

import { STAGE_PARTNER_ASSET_INTAKES_TABLE } from "./partner-asset-intake";
import {
  mapPartnerAssetCatalogRow,
  mapPartnerAssetMappingRow,
  STAGE_PARTNER_ASSETS_TABLE,
} from "./partner-asset-register";
import {
  createPartnerCommercialEligibilityContext,
  listPartnerCommercialAssets,
  type PartnerCommercialAssetOption,
  type PartnerCommercialEligibilityContext,
} from "./partner-commercial-assets";
import type { StageAsset, StageCatalogSnapshot } from "./types";

const MAPPING_SELECT = "partner_id, asset_id, intake_id, created_at";
const ASSET_SELECT =
  "asset_id, glb_url, authored_width_m, authored_height_m, authored_depth_m, status, created_at";
const INTAKE_SELECT = "intake_id, original_filename";

export type PartnerCommercialAssetLoadResult =
  | Readonly<{ ok: true; context: PartnerCommercialEligibilityContext; options: readonly PartnerCommercialAssetOption[] }>
  | Readonly<{ ok: false; code: "service_unavailable" | "query_failed" }>;

function toStageAsset(row: ReturnType<typeof mapPartnerAssetCatalogRow>): StageAsset | null {
  if (!row) return null;
  return {
    assetId: row.assetId,
    glbUrl: row.glbUrl,
    authoredWidthM: row.authoredWidthM,
    authoredHeightM: row.authoredHeightM,
    authoredDepthM: row.authoredDepthM,
    status: row.status,
  };
}

export async function loadPartnerCommercialEligibility(
  supabase: SupabaseClient,
  partnerId: string,
  catalog?: StageCatalogSnapshot,
  extraAssetIds: readonly string[] = [],
): Promise<PartnerCommercialAssetLoadResult> {
  const { data: mappingData, error: mappingError } = await supabase
    .from(STAGE_PARTNER_ASSETS_TABLE)
    .select(MAPPING_SELECT)
    .eq("partner_id", partnerId);
  if (mappingError) return { ok: false, code: "query_failed" };
  const mappings = (Array.isArray(mappingData) ? mappingData : []).flatMap((raw) => {
    const mapped = mapPartnerAssetMappingRow(raw as Record<string, unknown>);
    return mapped ? [mapped] : [];
  });

  const assetIds = [...new Set([
    ...mappings.map((item) => item.assetId),
    ...extraAssetIds.filter((id) => id.trim().length > 0),
  ])];
  let assets: StageAsset[] = [];
  if (assetIds.length > 0) {
    const { data: assetData, error: assetError } = await supabase
      .from("vibode_stage_assets")
      .select(ASSET_SELECT)
      .in("asset_id", assetIds);
    if (assetError) return { ok: false, code: "query_failed" };
    assets = (Array.isArray(assetData) ? assetData : []).flatMap((raw) => {
      const mapped = toStageAsset(mapPartnerAssetCatalogRow(raw as Record<string, unknown>));
      return mapped ? [mapped] : [];
    });
  }

  const intakeIds = mappings.flatMap((item) => (item.intakeId ? [item.intakeId] : []));
  const originalFileNames: Record<string, string | null> = {};
  if (intakeIds.length > 0) {
    const { data: intakeData, error: intakeError } = await supabase
      .from(STAGE_PARTNER_ASSET_INTAKES_TABLE)
      .select(INTAKE_SELECT)
      .in("intake_id", intakeIds);
    if (intakeError) return { ok: false, code: "query_failed" };
    const fileByIntake = new Map<string, string>();
    for (const raw of Array.isArray(intakeData) ? intakeData : []) {
      const row = raw as Record<string, unknown>;
      const intakeId = typeof row.intake_id === "string" ? row.intake_id : "";
      const fileName = typeof row.original_filename === "string" ? row.original_filename.trim() : "";
      if (intakeId && fileName) fileByIntake.set(intakeId, fileName);
    }
    for (const mapping of mappings) {
      if (!mapping.intakeId) continue;
      originalFileNames[mapping.assetId] = fileByIntake.get(mapping.intakeId) ?? null;
    }
  }

  const context = createPartnerCommercialEligibilityContext({
    partnerId,
    mappings,
    assets,
    originalFileNames,
  });
  const options = listPartnerCommercialAssets({
    partnerId,
    mappings,
    assets,
    originalFileNames,
    products: catalog?.products,
    variants: catalog?.variants,
  });
  return { ok: true, context, options };
}

export async function loadPartnerCommercialAssetsForPortal(
  partnerId: string,
  catalog?: StageCatalogSnapshot,
  extraAssetIds: readonly string[] = [],
): Promise<PartnerCommercialAssetLoadResult> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return { ok: false, code: "service_unavailable" };
  return loadPartnerCommercialEligibility(supabase, partnerId, catalog, extraAssetIds);
}
