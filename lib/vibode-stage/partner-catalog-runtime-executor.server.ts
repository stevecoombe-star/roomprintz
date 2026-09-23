import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { PARTNER_RUNTIME_PLAN_VERSION_2 } from "./partner-catalog-runtime-executor-v2";
import { PARTNER_RUNTIME_PLAN_VERSION_3 } from "./partner-catalog-runtime-executor-v3";
import { PARTNER_RUNTIME_PLAN_VERSION_4 } from "./partner-catalog-runtime-executor-v4";
import { PARTNER_RUNTIME_PLAN_VERSION_5 } from "./partner-catalog-runtime-executor-v5";
import {
  parseRuntimeApplyRpcError,
  STAGE_PARTNER_APPLY_RPC,
  STAGE_PARTNER_APPLY_RPC_V2,
  STAGE_PARTNER_APPLY_RPC_V3,
  STAGE_PARTNER_APPLY_RPC_V4,
  STAGE_PARTNER_APPLY_RPC_V5,
  type PartnerRuntimeApplyFn,
  type PartnerRuntimeApplyResult,
} from "./partner-catalog-publish";
import {
  mapPartnerPublishAuditRow,
  persistablePartnerPublishAuditInsert,
  STAGE_PARTNER_PUBLISHES_TABLE,
  type PartnerPublishAuditInsert,
  type PartnerPublishAuditRow,
  type PartnerPublishAuditStore,
} from "./partner-publish-audit";

function isUniqueConflict(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

const AUDIT_SELECT =
  "publish_id, partner_id, user_id, draft_id, draft_revision, source, mode, document, plan, status, error_code, error_detail, base_catalog_hash, pre_publish_catalog_hash, post_publish_catalog_hash, created_at";

export function createSupabasePartnerPublishAuditStore(supabase: SupabaseClient): PartnerPublishAuditStore {
  return {
    async findSuccessful(draftId, draftRevision) {
      const { data, error } = await supabase
        .from(STAGE_PARTNER_PUBLISHES_TABLE)
        .select(AUDIT_SELECT)
        .eq("draft_id", draftId)
        .eq("draft_revision", draftRevision)
        .in("status", ["accepted", "noop"])
        .maybeSingle();
      if (error || !data) return null;
      return mapPartnerPublishAuditRow(data as Record<string, unknown>);
    },
    async insert(row: PartnerPublishAuditInsert) {
      const payload = persistablePartnerPublishAuditInsert(row);
      if (!payload.publish_id) delete payload.publish_id;
      const { data, error } = await supabase
        .from(STAGE_PARTNER_PUBLISHES_TABLE)
        .insert(payload)
        .select(AUDIT_SELECT)
        .maybeSingle();
      if (isUniqueConflict(error)) return { ok: false, code: "unique_conflict" };
      if (error || !data) return { ok: false, code: "failed" };
      const mapped = mapPartnerPublishAuditRow(data as Record<string, unknown>);
      if (!mapped) return { ok: false, code: "failed" };
      return { ok: true, row: mapped };
    },
  };
}

export function createSupabasePartnerRuntimeApply(supabase: SupabaseClient): PartnerRuntimeApplyFn {
  return async (payload) => {
    if (payload.planVersion === PARTNER_RUNTIME_PLAN_VERSION_5) {
      const { data, error } = await supabase.rpc(STAGE_PARTNER_APPLY_RPC_V5, { p_apply: payload });
      if (error) {
        const errorCode = parseRuntimeApplyRpcError(error.message) ?? "FAILED";
        return { ok: false, errorCode };
      }
      return parseRuntimeApplyResult(data);
    }
    if (payload.planVersion === PARTNER_RUNTIME_PLAN_VERSION_4) {
      const { data, error } = await supabase.rpc(STAGE_PARTNER_APPLY_RPC_V4, { p_apply: payload });
      if (error) {
        const errorCode = parseRuntimeApplyRpcError(error.message) ?? "FAILED";
        return { ok: false, errorCode };
      }
      return parseRuntimeApplyResult(data);
    }
    if (payload.planVersion === PARTNER_RUNTIME_PLAN_VERSION_3) {
      const { data, error } = await supabase.rpc(STAGE_PARTNER_APPLY_RPC_V3, { p_apply: payload });
      if (error) {
        const errorCode = parseRuntimeApplyRpcError(error.message) ?? "FAILED";
        return { ok: false, errorCode };
      }
      return parseRuntimeApplyResult(data);
    }
    if (payload.planVersion === PARTNER_RUNTIME_PLAN_VERSION_2) {
      const { data, error } = await supabase.rpc(STAGE_PARTNER_APPLY_RPC_V2, { p_apply: payload });
      if (error) {
        const errorCode = parseRuntimeApplyRpcError(error.message) ?? "FAILED";
        return { ok: false, errorCode };
      }
      return parseRuntimeApplyResult(data);
    }
    const { data, error } = await supabase.rpc(STAGE_PARTNER_APPLY_RPC, { p_apply: payload });
    if (error) {
      const errorCode = parseRuntimeApplyRpcError(error.message) ?? "FAILED";
      return { ok: false, errorCode };
    }
    return parseRuntimeApplyResult(data);
  };
}

export function parseRuntimeApplyResult(value: unknown): PartnerRuntimeApplyResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errorCode: "FAILED" };
  }
  const record = value as Record<string, unknown>;
  if (record.ok === true && (record.status === "accepted" || record.status === "noop")) {
    const publishId = typeof record.publishId === "string" ? record.publishId : null;
    if (!publishId) return { ok: false, errorCode: "FAILED" };
    return {
      ok: true,
      status: record.status,
      publishId,
      idempotent: record.idempotent === true,
    };
  }
  const errorCode = typeof record.errorCode === "string" ? record.errorCode : "FAILED";
  return { ok: false, errorCode };
}

export type { PartnerPublishAuditRow };
