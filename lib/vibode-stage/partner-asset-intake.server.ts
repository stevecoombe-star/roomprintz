import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolvePartnerPortalContext } from "./partner-portal-auth.server";
import type { PartnerPortalHttpResponse } from "./partner-portal-http";
import {
  createPartnerAssetIntake,
  finalizePartnerAssetIntake,
  listPartnerAssetIntakes,
  mapPartnerAssetIntakeRow,
  PARTNER_ASSET_INTAKE_BUCKET,
  PARTNER_ASSET_SIGNED_UPLOAD_EXPIRES_SEC,
  STAGE_PARTNER_ASSET_INTAKES_TABLE,
  type PartnerAssetIntakeObjectStore,
  type PartnerAssetIntakeRow,
  type PartnerAssetIntakeStore,
} from "./partner-asset-intake";
import { isForbiddenBrowserUploadObjectPath } from "./partner-runtime-asset-id";

const INTAKE_SELECT =
  "intake_id, partner_id, created_by_user_id, status, object_path, original_filename, byte_size, sha256, dimension_source, authored_width_m, authored_height_m, authored_depth_m, measured_width_m, measured_height_m, measured_depth_m, placement_scale, validation_warnings, error_code, error_detail, asset_id, created_at, updated_at";

function isUniqueConflict(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

export function createSupabasePartnerAssetIntakeStore(supabase: SupabaseClient): PartnerAssetIntakeStore {
  return {
    async insertCreated(row) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_ASSET_INTAKES_TABLE)
        .insert({
          intake_id: row.intakeId,
          partner_id: row.partnerId,
          created_by_user_id: row.createdByUserId,
          status: row.status,
          object_path: row.objectPath,
          original_filename: row.originalFileName,
          byte_size: row.byteSize,
          dimension_source: row.dimensionSource,
          authored_width_m: row.authoredWidthM,
          authored_height_m: row.authoredHeightM,
          authored_depth_m: row.authoredDepthM,
          validation_warnings: row.validationWarnings,
        })
        .select(INTAKE_SELECT)
        .maybeSingle();
      if (isUniqueConflict(error)) return { ok: false, code: "unique_conflict" };
      if (error || !data) return { ok: false, code: "failed" };
      const mapped = mapPartnerAssetIntakeRow(data as Record<string, unknown>);
      if (!mapped) return { ok: false, code: "failed" };
      return { ok: true, row: mapped };
    },
    async findById(partnerId, intakeId) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_ASSET_INTAKES_TABLE)
        .select(INTAKE_SELECT)
        .eq("partner_id", partnerId)
        .eq("intake_id", intakeId)
        .maybeSingle();
      if (error || !data) return null;
      return mapPartnerAssetIntakeRow(data as Record<string, unknown>);
    },
    async findByIntakeId(intakeId) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_ASSET_INTAKES_TABLE)
        .select(INTAKE_SELECT)
        .eq("intake_id", intakeId)
        .maybeSingle();
      if (error || !data) return null;
      return mapPartnerAssetIntakeRow(data as Record<string, unknown>);
    },
    async listByPartner(partnerId) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_ASSET_INTAKES_TABLE)
        .select(INTAKE_SELECT)
        .eq("partner_id", partnerId)
        .order("created_at", { ascending: false });
      if (error || !Array.isArray(data)) return [];
      return data.flatMap((row) => {
        const mapped = mapPartnerAssetIntakeRow(row as Record<string, unknown>);
        return mapped ? [mapped] : [];
      });
    },
    async claimForValidation(partnerId, intakeId, nowIso) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_ASSET_INTAKES_TABLE)
        .update({ status: "validating", updated_at: nowIso })
        .eq("partner_id", partnerId)
        .eq("intake_id", intakeId)
        .in("status", ["created", "uploaded"])
        .select(INTAKE_SELECT)
        .maybeSingle();
      if (error) return { ok: false, code: "failed" };
      if (data) {
        const mapped = mapPartnerAssetIntakeRow(data as Record<string, unknown>);
        if (!mapped) return { ok: false, code: "failed" };
        return { ok: true, kind: "claimed", row: mapped };
      }
      const current = await this.findById(partnerId, intakeId);
      if (!current) return { ok: false, code: "not_found" };
      if (current.status === "validated") return { ok: true, kind: "already_validated", row: current };
      if (current.status === "failed") return { ok: true, kind: "already_failed", row: current };
      return { ok: false, code: "conflict" };
    },
    async completeValidation(input) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_ASSET_INTAKES_TABLE)
        .update({
          status: input.status,
          sha256: input.sha256,
          measured_width_m: input.measuredWidthM,
          measured_height_m: input.measuredHeightM,
          measured_depth_m: input.measuredDepthM,
          placement_scale: input.placementScale,
          validation_warnings: input.validationWarnings,
          error_code: input.errorCode,
          error_detail: input.errorDetail,
          updated_at: input.nowIso,
        })
        .eq("partner_id", input.partnerId)
        .eq("intake_id", input.intakeId)
        .eq("status", "validating")
        .select(INTAKE_SELECT)
        .maybeSingle();
      if (error || !data) return { ok: false, code: "failed" };
      const mapped = mapPartnerAssetIntakeRow(data as Record<string, unknown>);
      if (!mapped) return { ok: false, code: "failed" };
      return { ok: true, row: mapped };
    },
  };
}

function createSupabasePartnerAssetObjectStore(supabase: SupabaseClient): PartnerAssetIntakeObjectStore {
  const bucket = supabase.storage.from(PARTNER_ASSET_INTAKE_BUCKET);
  return {
    async createSignedUpload(input) {
      if (isForbiddenBrowserUploadObjectPath(input.objectPath)) return { ok: false };
      const { data, error } = await bucket.createSignedUploadUrl(input.objectPath, {
        upsert: input.upsert,
      });
      if (error || !data?.signedUrl || !data.token || !data.path) return { ok: false };
      return {
        ok: true,
        upload: {
          signedUrl: data.signedUrl,
          token: data.token,
          path: data.path,
          expiresInSec: PARTNER_ASSET_SIGNED_UPLOAD_EXPIRES_SEC,
        },
      };
    },
    async download(objectPath) {
      const { data, error } = await bucket.download(objectPath);
      if (error || !data) {
        const details = error as { message?: string; status?: number; statusCode?: string } | null;
        const message = (details?.message ?? "").toLowerCase();
        const missing =
          details?.status === 404 ||
          details?.statusCode === "404" ||
          message.includes("not found") ||
          message.includes("404");
        return { ok: false, code: missing ? "missing" : "failed" };
      }
      const buffer = await data.arrayBuffer();
      return { ok: true, bytes: new Uint8Array(buffer) };
    },
  };
}

async function intakeStores(): Promise<{
  store: PartnerAssetIntakeStore;
  objects: PartnerAssetIntakeObjectStore;
} | null> {
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) return null;
  return {
    store: createSupabasePartnerAssetIntakeStore(supabase),
    objects: createSupabasePartnerAssetObjectStore(supabase),
  };
}

function unavailable(): PartnerPortalHttpResponse {
  return { status: 500, body: { ok: false, error: "Partner Portal is unavailable.", errorCode: "SERVICE_UNAVAILABLE" } };
}

export async function partnerAssetIntakeCreateResponse(body: unknown): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const stores = await intakeStores();
  if (!stores) {
    if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error, errorCode: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" } };
    return unavailable();
  }
  return createPartnerAssetIntake({ auth, store: stores.store, objects: stores.objects, body });
}

export async function partnerAssetIntakeListResponse(): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const stores = await intakeStores();
  if (!stores) {
    if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error, errorCode: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" } };
    return unavailable();
  }
  return listPartnerAssetIntakes({ auth, store: stores.store });
}

export async function partnerAssetIntakeFinalizeResponse(
  intakeId: string,
  body: unknown,
): Promise<PartnerPortalHttpResponse> {
  const auth = await resolvePartnerPortalContext();
  const stores = await intakeStores();
  if (!stores) {
    if (!auth.ok) return { status: auth.status, body: { ok: false, error: auth.error, errorCode: auth.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN" } };
    return unavailable();
  }
  return finalizePartnerAssetIntake({
    auth,
    store: stores.store,
    objects: stores.objects,
    intakeId,
    body,
  });
}

export type { PartnerAssetIntakeRow };
