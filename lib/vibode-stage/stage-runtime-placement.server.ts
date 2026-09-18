import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { furnitureAssetDefinition } from "@/lib/afc-v2-runtime/furniture-assets";
import type { Owned3dSceneAuthorization } from "@/lib/afc-v2-runtime/persisted-scene";
import { authorizeOwnedVersionScene } from "@/lib/afc-v2-runtime/scene-persistence.server";
import { STAGE_CATALOG_TABLES } from "./catalog-store";
import {
  isValidDynamicTechnicalRow,
  runtimeDefinitionFromLookup,
  runtimeDefinitionLeaksProvenance,
  type DynamicRuntimeLookupRow,
  type SignedGetMintResult,
} from "./partner-runtime-assets";
import { PARTNER_INTAKE_ASSET_SOURCE } from "./partner-runtime-asset-id";
import {
  lookupPartnerRuntimeAssets,
  mintPartnerRuntimeSignedGet,
} from "./partner-runtime-assets.server";
import {
  classifyStagePlacementKind,
  evaluateStageCommercialPlacement,
  httpStatusForStageRuntimePlacementError,
  parseStageRuntimePlacementRequest,
  stageRuntimePlacementFailure,
  type StageCommercialAssetSnapshot,
  type StageCommercialPartnerSnapshot,
  type StageCommercialProductSnapshot,
  type StageCommercialVariantSnapshot,
  type StageRuntimePlacementErrorCode,
  type StageRuntimePlacementFailure,
  type StageRuntimePlacementRequest,
  type StageRuntimePlacementResult,
  type StageRuntimePlacementSuccess,
} from "./stage-runtime-placement";

const PRODUCT_SELECT = "product_id, partner_id, status";
const VARIANT_SELECT = "variant_id, product_id, current_asset_id, status";
const ASSET_SELECT =
  "asset_id, authored_width_m, authored_height_m, authored_depth_m, status";
const PARTNER_SELECT = "partner_id, status";

export type StageCommercialPlacementRows = Readonly<{
  product: StageCommercialProductSnapshot | null;
  variant: StageCommercialVariantSnapshot | null;
  asset: StageCommercialAssetSnapshot | null;
  partner: StageCommercialPartnerSnapshot | null;
}>;

export type PlaceStageRuntimeAssetInput = Readonly<{
  body: unknown;
  userId: string | null;
  authorizeOwned: (input: {
    roomId: string;
    versionId: string;
    afcGenerationId: string;
  }) => Promise<Owned3dSceneAuthorization>;
  loadCommercialRows: (
    productId: string,
    variantId: string,
  ) => Promise<StageCommercialPlacementRows>;
  lookupProvenance: (
    assetId: string,
  ) => Promise<DynamicRuntimeLookupRow | null>;
  mintSignedGet: (row: DynamicRuntimeLookupRow) => Promise<SignedGetMintResult>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asTrimmed(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asCommercialStatus(value: unknown): "active" | "inactive" | null {
  if (value == null) return "active";
  if (typeof value === "string" && value.trim() === "") return "active";
  if (value === "active" || value === "inactive") return value;
  return null;
}

function asAssetStatus(value: unknown): "ready" | "unavailable" | null {
  if (value === "ready" || value === "unavailable") return value;
  return null;
}

function asPartnerStatus(value: unknown): "active" | "inactive" | null {
  if (value === "active" || value === "inactive") return value;
  return null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function mapStageCommercialProductRow(
  row: Record<string, unknown> | null,
): StageCommercialProductSnapshot | null {
  if (!row) return null;
  const productId = asTrimmed(row.product_id);
  const status = asCommercialStatus(row.status);
  if (!productId || !status) return null;
  return {
    productId,
    status,
    partnerId: asTrimmed(row.partner_id),
  };
}

export function mapStageCommercialVariantRow(
  row: Record<string, unknown> | null,
): StageCommercialVariantSnapshot | null {
  if (!row) return null;
  const variantId = asTrimmed(row.variant_id);
  const productId = asTrimmed(row.product_id);
  const status = asCommercialStatus(row.status);
  if (!variantId || !productId || !status) return null;
  return {
    variantId,
    productId,
    status,
    currentAssetId: asTrimmed(row.current_asset_id),
  };
}

export function mapStageCommercialAssetRow(
  row: Record<string, unknown> | null,
): StageCommercialAssetSnapshot | null {
  if (!row) return null;
  const assetId = asTrimmed(row.asset_id);
  const status = asAssetStatus(row.status);
  const authoredWidthM = asFiniteNumber(row.authored_width_m);
  const authoredHeightM = asFiniteNumber(row.authored_height_m);
  const authoredDepthM = asFiniteNumber(row.authored_depth_m);
  if (
    !assetId ||
    !status ||
    authoredWidthM == null ||
    authoredHeightM == null ||
    authoredDepthM == null
  ) {
    return null;
  }
  return {
    assetId,
    status,
    authoredWidthM,
    authoredHeightM,
    authoredDepthM,
  };
}

export function mapStageCommercialPartnerRow(
  row: Record<string, unknown> | null,
): StageCommercialPartnerSnapshot | null {
  if (!row) return null;
  const partnerId = asTrimmed(row.partner_id);
  const status = asPartnerStatus(row.status);
  if (!partnerId || !status) return null;
  return { partnerId, status };
}

export function errorCodeFromOwnedSceneAuthorization(
  auth: Extract<Owned3dSceneAuthorization, { ok: false }>,
): StageRuntimePlacementErrorCode {
  if (auth.status === 401) return "UNAUTHORIZED";
  if (auth.status === 500) return "RUNTIME_DEFINITION_UNAVAILABLE";
  if (auth.error === "Room not found.") return "ROOM_NOT_FOUND";
  if (auth.error === "Version not found.") return "VERSION_NOT_FOUND";
  if (auth.error === "AFC generation not found.") return "VERSION_NOT_FOUND";
  if (auth.error === "AFC generation is not production-ready.") {
    return "VERSION_NOT_FOUND";
  }
  if (auth.error === "AFC generation is not the room's current spatial authority.") {
    return "VERSION_NOT_FOUND";
  }
  if (auth.status === 404) return "ROOM_NOT_FOUND";
  return "RUNTIME_DEFINITION_UNAVAILABLE";
}

function warnPlacement(input: Readonly<{
  errorCode: StageRuntimePlacementErrorCode;
  productId?: string;
  variantId?: string;
  assetId?: string;
}>): void {
  if (typeof console === "undefined") return;
  console.warn("[vibode-stage-runtime-placement]", {
    errorCode: input.errorCode,
    productId: input.productId ?? null,
    variantId: input.variantId ?? null,
    assetId: input.assetId ?? null,
  });
}

function fail(
  errorCode: StageRuntimePlacementErrorCode,
  ids?: Readonly<{ productId?: string; variantId?: string; assetId?: string }>,
): { status: number; body: StageRuntimePlacementFailure } {
  if (
    errorCode === "RUNTIME_DEFINITION_UNAVAILABLE" ||
    errorCode === "STALE_VARIANT_ASSET"
  ) {
    warnPlacement({ errorCode, ...ids });
  }
  return {
    status: httpStatusForStageRuntimePlacementError(errorCode),
    body: stageRuntimePlacementFailure(errorCode),
  };
}

export async function loadStageCommercialPlacementRows(
  supabase: SupabaseClient,
  productId: string,
  variantId: string,
): Promise<StageCommercialPlacementRows> {
  const [{ data: productData }, { data: variantData }] = await Promise.all([
    supabase
      .from(STAGE_CATALOG_TABLES.products)
      .select(PRODUCT_SELECT)
      .eq("product_id", productId)
      .maybeSingle(),
    supabase
      .from(STAGE_CATALOG_TABLES.variants)
      .select(VARIANT_SELECT)
      .eq("variant_id", variantId)
      .maybeSingle(),
  ]);
  const product = mapStageCommercialProductRow(
    isRecord(productData) ? productData : null,
  );
  const variant = mapStageCommercialVariantRow(
    isRecord(variantData) ? variantData : null,
  );
  const assetId = variant?.currentAssetId ?? null;
  const partnerId = product?.partnerId ?? null;
  const [assetData, partnerData] = await Promise.all([
    assetId
      ? supabase
        .from(STAGE_CATALOG_TABLES.assets)
        .select(ASSET_SELECT)
        .eq("asset_id", assetId)
        .maybeSingle()
      : Promise.resolve({ data: null }),
    partnerId
      ? supabase
        .from(STAGE_CATALOG_TABLES.partners)
        .select(PARTNER_SELECT)
        .eq("partner_id", partnerId)
        .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  return {
    product,
    variant,
    asset: mapStageCommercialAssetRow(isRecord(assetData.data) ? assetData.data : null),
    partner: mapStageCommercialPartnerRow(
      isRecord(partnerData.data) ? partnerData.data : null,
    ),
  };
}

async function mintDynamicRuntimeAsset(input: Readonly<{
  assetId: string;
  lookupProvenance: (assetId: string) => Promise<DynamicRuntimeLookupRow | null>;
  mintSignedGet: (row: DynamicRuntimeLookupRow) => Promise<SignedGetMintResult>;
  productId: string;
  variantId: string;
}>): Promise<
  | { ok: true; success: StageRuntimePlacementSuccess }
  | { ok: false; errorCode: "RUNTIME_DEFINITION_UNAVAILABLE" }
> {
  const row = await input.lookupProvenance(input.assetId);
  if (
    !row ||
    row.assetId !== input.assetId ||
    row.source !== PARTNER_INTAKE_ASSET_SOURCE ||
    row.status !== "ready" ||
    !isValidDynamicTechnicalRow(row)
  ) {
    return { ok: false, errorCode: "RUNTIME_DEFINITION_UNAVAILABLE" };
  }
  const minted = await input.mintSignedGet(row);
  if (!minted.ok) {
    return { ok: false, errorCode: "RUNTIME_DEFINITION_UNAVAILABLE" };
  }
  const runtimeAsset = runtimeDefinitionFromLookup(row, minted.signedUrl, minted.expiresAt);
  if (runtimeDefinitionLeaksProvenance(runtimeAsset)) {
    return { ok: false, errorCode: "RUNTIME_DEFINITION_UNAVAILABLE" };
  }
  if (furnitureAssetDefinition(runtimeAsset.assetId)) {
    return { ok: false, errorCode: "RUNTIME_DEFINITION_UNAVAILABLE" };
  }
  return {
    ok: true,
    success: {
      ok: true,
      productId: input.productId,
      variantId: input.variantId,
      assetId: input.assetId,
      placementKind: "dynamic",
      runtimeAsset,
    },
  };
}

export async function placeStageRuntimeAsset(
  input: PlaceStageRuntimeAssetInput,
): Promise<{ status: number; body: StageRuntimePlacementResult }> {
  const parsed = parseStageRuntimePlacementRequest(input.body);
  if (!parsed.ok) {
    return fail("INVALID_REQUEST");
  }
  const request: StageRuntimePlacementRequest = parsed.request;
  if (!input.userId) {
    return fail("UNAUTHORIZED");
  }
  const authorized = await input.authorizeOwned({
    roomId: request.roomId,
    versionId: request.versionId,
    afcGenerationId: request.afcGenerationId,
  });
  if (!authorized.ok) {
    return fail(errorCodeFromOwnedSceneAuthorization(authorized));
  }

  const rows = await input.loadCommercialRows(request.productId, request.variantId);
  const evaluated = evaluateStageCommercialPlacement(rows);
  if (!evaluated.ok) {
    return fail(evaluated.errorCode, {
      productId: request.productId,
      variantId: request.variantId,
    });
  }
  if (evaluated.assetId !== request.expectedAssetId) {
    return fail("STALE_VARIANT_ASSET", {
      productId: evaluated.productId,
      variantId: evaluated.variantId,
      assetId: evaluated.assetId,
    });
  }

  const placementKind = classifyStagePlacementKind(evaluated.assetId);
  if (placementKind === "static") {
    return {
      status: 200,
      body: {
        ok: true,
        productId: evaluated.productId,
        variantId: evaluated.variantId,
        assetId: evaluated.assetId,
        placementKind: "static",
      },
    };
  }

  const minted = await mintDynamicRuntimeAsset({
    assetId: evaluated.assetId,
    lookupProvenance: input.lookupProvenance,
    mintSignedGet: input.mintSignedGet,
    productId: evaluated.productId,
    variantId: evaluated.variantId,
  });
  if (!minted.ok) {
    return fail("RUNTIME_DEFINITION_UNAVAILABLE", {
      productId: evaluated.productId,
      variantId: evaluated.variantId,
      assetId: evaluated.assetId,
    });
  }
  return { status: 200, body: minted.success };
}

export async function placeOwnedStageRuntimeAsset(
  userId: string,
  body: unknown,
): Promise<{ status: number; body: StageRuntimePlacementResult }> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) {
    return fail("RUNTIME_DEFINITION_UNAVAILABLE");
  }
  return placeStageRuntimeAsset({
    body,
    userId,
    authorizeOwned: (ids) => authorizeOwnedVersionScene({
      userId,
      roomId: ids.roomId,
      versionId: ids.versionId,
      afcGenerationId: ids.afcGenerationId,
    }),
    loadCommercialRows: (productId, variantId) =>
      loadStageCommercialPlacementRows(supabase, productId, variantId),
    lookupProvenance: async (assetId) => {
      const rows = await lookupPartnerRuntimeAssets(supabase, [assetId]);
      return rows.find((row) => row.assetId === assetId) ?? null;
    },
    mintSignedGet: (row) => mintPartnerRuntimeSignedGet(supabase, row),
  });
}
