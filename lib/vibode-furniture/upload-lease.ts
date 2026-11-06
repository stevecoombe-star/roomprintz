import { PERSONAL_FURNITURE_FINALIZE_LEASE_MS } from "./asset-id";

export type PersonalUploadLeaseView = Readonly<{
  status: string;
  expiresAt: string;
  updatedAt: string;
}>;

export function personalFinalizeLeaseBefore(nowIso: string): string {
  return new Date(Date.parse(nowIso) - PERSONAL_FURNITURE_FINALIZE_LEASE_MS).toISOString();
}

export function personalUploadLeaseIsFresh(updatedAtIso: string, nowIso: string): boolean {
  const updatedAt = Date.parse(updatedAtIso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(updatedAt) || !Number.isFinite(now)) return false;
  return now - updatedAt < PERSONAL_FURNITURE_FINALIZE_LEASE_MS;
}

function stillWithinUploadTtl(upload: PersonalUploadLeaseView, nowIso: string): boolean {
  const expiresAt = Date.parse(upload.expiresAt);
  const now = Date.parse(nowIso);
  return Number.isFinite(expiresAt) && Number.isFinite(now) && expiresAt > now;
}

export function personalUploadClaimOutcome(
  upload: PersonalUploadLeaseView | null,
  nowIso: string,
): "claim" | "lost" | "expired" {
  if (!upload) return "expired";
  if (personalUploadCanClaim(upload, nowIso)) return "claim";
  if (upload.status === "finalizing" && personalUploadLeaseIsFresh(upload.updatedAt, nowIso)) {
    return "lost";
  }
  const expiresAt = Date.parse(upload.expiresAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now) || expiresAt <= now) return "expired";
  return "lost";
}

/** Pending work, or a finalizing claim whose owner has stopped making progress. */
export function personalUploadCanClaim(upload: PersonalUploadLeaseView, nowIso: string): boolean {
  if (!stillWithinUploadTtl(upload, nowIso)) return false;
  if (upload.status === "pending") return true;
  if (upload.status === "finalizing") return !personalUploadLeaseIsFresh(upload.updatedAt, nowIso);
  return false;
}

/**
 * Abandoned pending uploads expire at the TTL. A finalizing upload expires only
 * after both the TTL and the lease, so cleanup cannot take an active finalize.
 */
export function personalUploadShouldExpire(upload: PersonalUploadLeaseView, nowIso: string): boolean {
  if (stillWithinUploadTtl(upload, nowIso)) return false;
  if (upload.status === "pending") return true;
  if (upload.status === "finalizing") return !personalUploadLeaseIsFresh(upload.updatedAt, nowIso);
  return false;
}
