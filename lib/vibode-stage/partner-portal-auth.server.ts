import "server-only";

import { getCookieSupabaseClient, getServiceRoleSupabaseClient, hasSupabaseAuthEnv, hasSupabaseServiceEnv } from "@/lib/adminServer";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  bindPartnerPortalContext,
  resolvePartnerPortalMembership,
  STAGE_PARTNER_MEMBERSHIPS_TABLE,
  type LoadedPartnerRecord,
  type PartnerPortalAuthResult,
  type StagePartnerMembershipRow,
} from "./partner-portal-auth";
import type { StagePartner, StagePartnerStatus } from "./types";

type AnySupabase = SupabaseClient;

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asPartnerStatus(value: unknown): StagePartnerStatus | null {
  if (value === "active" || value === "inactive") return value;
  return null;
}

function mapMembershipRow(row: Record<string, unknown>): StagePartnerMembershipRow | null {
  const membershipId = asTrimmedString(row.membership_id);
  const userId = asTrimmedString(row.user_id);
  const partnerId = asTrimmedString(row.partner_id);
  const role = asTrimmedString(row.role);
  const status = asTrimmedString(row.status);
  if (!membershipId || !userId || !partnerId || !role || !status) return null;
  return { membershipId, userId, partnerId, role, status };
}

function mapPartnerRow(row: Record<string, unknown>): StagePartner | null {
  const partnerId = asTrimmedString(row.partner_id);
  const name = asTrimmedString(row.name);
  const slug = asTrimmedString(row.slug);
  const status = asPartnerStatus(row.status);
  if (!partnerId || !name || !slug || !status) return null;
  return {
    partnerId,
    name,
    slug,
    status,
    websiteUrl: asTrimmedString(row.website_url),
    logoUrl: asTrimmedString(row.logo_url),
  };
}

function serviceUnavailable(): PartnerPortalAuthResult {
  return {
    ok: false,
    code: "service_unavailable",
    status: 500,
    error: "Partner Portal is unavailable.",
  };
}

async function loadPartnerById(
  supabase: AnySupabase,
  partnerId: string,
): Promise<LoadedPartnerRecord> {
  const { data, error } = await supabase
    .from("vibode_stage_partners")
    .select("partner_id, name, slug, status, website_url, logo_url")
    .eq("partner_id", partnerId)
    .maybeSingle();
  if (error) return "failed";
  if (!data) return null;
  const partner = mapPartnerRow(data as Record<string, unknown>);
  return partner ?? "failed";
}

export async function resolvePartnerPortalContext(): Promise<PartnerPortalAuthResult> {
  if (!hasSupabaseAuthEnv() || !hasSupabaseServiceEnv()) {
    return serviceUnavailable();
  }
  const authClient = await getCookieSupabaseClient();
  const service = getServiceRoleSupabaseClient();
  if (!authClient || !service) return serviceUnavailable();

  const { data, error } = await authClient.auth.getUser();
  const userId = error || !data?.user?.id ? null : data.user.id;
  if (!userId) {
    return {
      ok: false,
      code: "unauthenticated",
      status: 401,
      error: "Unauthorized",
    };
  }

  const { data: rows, error: membershipError } = await service
    .from(STAGE_PARTNER_MEMBERSHIPS_TABLE)
    .select("membership_id, user_id, partner_id, role, status")
    .eq("user_id", userId);
  if (membershipError) {
    return serviceUnavailable();
  }

  const mapped = (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const membership = mapMembershipRow(row as Record<string, unknown>);
    return membership ? [membership] : [];
  });
  const selected = resolvePartnerPortalMembership({
    userId,
    memberships: { ok: true, rows: mapped },
  });
  if (!selected.ok) return selected;
  const partner = await loadPartnerById(service, selected.membership.partnerId);
  return bindPartnerPortalContext(selected.membership, partner);
}
