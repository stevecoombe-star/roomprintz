/**
 * PI-5G1 Partner Portal authorization.
 *
 * Authenticated Vibode user → active STAGE Partner membership →
 * server-derived Partner ID. Portal access is membership status,
 * not commercial Partner availability. Admin email is not authority.
 */

import type { StagePartner } from "./types";

export const STAGE_PARTNER_MEMBERSHIPS_TABLE = "vibode_stage_partner_memberships";

export const PARTNER_PORTAL_ROLES = Object.freeze(["owner"] as const);
export const PARTNER_PORTAL_MEMBERSHIP_STATUSES = Object.freeze(["active", "revoked"] as const);

export type PartnerPortalRole = (typeof PARTNER_PORTAL_ROLES)[number];
export type PartnerPortalMembershipStatus = (typeof PARTNER_PORTAL_MEMBERSHIP_STATUSES)[number];

export type StagePartnerMembershipRow = Readonly<{
  membershipId: string;
  userId: string;
  partnerId: string;
  role: string;
  status: string;
}>;

export type PartnerPortalContext = Readonly<{
  userId: string;
  partnerId: string;
  role: PartnerPortalRole;
  membershipId: string;
  partner: StagePartner;
}>;

export type PartnerPortalAuthErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "membership_revoked"
  | "partner_missing"
  | "multiple_memberships"
  | "service_unavailable";

export type PartnerPortalAuthSuccess = Readonly<{
  ok: true;
  context: PartnerPortalContext;
}>;

export type PartnerPortalAuthFailure = Readonly<{
  ok: false;
  code: PartnerPortalAuthErrorCode;
  status: 401 | 403 | 409 | 500;
  error: string;
}>;

export type PartnerPortalAuthResult = PartnerPortalAuthSuccess | PartnerPortalAuthFailure;

export type PartnerMembershipLookup =
  | Readonly<{ ok: true; rows: readonly StagePartnerMembershipRow[] }>
  | Readonly<{ ok: false; reason: "unavailable" | "failed" }>;

export type PartnerPortalMembershipSelection =
  | Readonly<{
      ok: true;
      membership: StagePartnerMembershipRow & { role: PartnerPortalRole };
    }>
  | PartnerPortalAuthFailure;

export type LoadedPartnerRecord = StagePartner | null | "failed";

function fail(
  code: PartnerPortalAuthErrorCode,
  status: PartnerPortalAuthFailure["status"],
  error: string,
): PartnerPortalAuthFailure {
  return { ok: false, code, status, error };
}

export function isPartnerPortalRole(value: string): value is PartnerPortalRole {
  return (PARTNER_PORTAL_ROLES as readonly string[]).includes(value);
}

function unauthenticated(): PartnerPortalAuthFailure {
  return fail("unauthenticated", 401, "Unauthorized");
}

function forbidden(code: "forbidden" | "membership_revoked" | "partner_missing"): PartnerPortalAuthFailure {
  return fail(code, 403, "Forbidden");
}

function serviceUnavailable(): PartnerPortalAuthFailure {
  return fail("service_unavailable", 500, "Partner Portal is unavailable.");
}

export function resolvePartnerPortalMembership(input: Readonly<{
  userId: string | null;
  memberships: PartnerMembershipLookup;
}>): PartnerPortalMembershipSelection {
  if (!input.userId) return unauthenticated();
  if (!input.memberships.ok) return serviceUnavailable();

  const rows = input.memberships.rows.filter((row) => row.userId === input.userId);
  const active = rows.filter((row) => row.status === "active");
  if (active.length === 0) {
    if (rows.some((row) => row.status === "revoked")) {
      return forbidden("membership_revoked");
    }
    return forbidden("forbidden");
  }
  if (active.length > 1) {
    return fail(
      "multiple_memberships",
      409,
      "Multiple Partner memberships are not supported.",
    );
  }
  const membership = active[0]!;
  if (!isPartnerPortalRole(membership.role)) return forbidden("forbidden");
  return { ok: true, membership: { ...membership, role: membership.role } };
}

export function bindPartnerPortalContext(
  membership: StagePartnerMembershipRow & { role: PartnerPortalRole },
  partner: LoadedPartnerRecord,
): PartnerPortalAuthResult {
  if (partner === "failed") return serviceUnavailable();
  if (!partner) return forbidden("partner_missing");
  if (partner.partnerId !== membership.partnerId) return forbidden("partner_missing");
  return {
    ok: true,
    context: {
      userId: membership.userId,
      partnerId: membership.partnerId,
      role: membership.role,
      membershipId: membership.membershipId,
      partner,
    },
  };
}

export function resolvePartnerPortalAuth(input: Readonly<{
  userId: string | null;
  memberships: PartnerMembershipLookup;
  partner: LoadedPartnerRecord;
}>): PartnerPortalAuthResult {
  const selected = resolvePartnerPortalMembership({
    userId: input.userId,
    memberships: input.memberships,
  });
  if (!selected.ok) return selected;
  return bindPartnerPortalContext(selected.membership, input.partner);
}
