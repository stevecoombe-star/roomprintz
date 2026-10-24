import { isAdminEmail } from "@/lib/adminAccess";

/**
 * Service-role lookup of the queued user's current email.
 * A transport error, a missing user, or a missing email fails closed.
 */
export type CleanupWorkerUserLookup = (userId: string) => Promise<{
  data: { user: { email?: string | null } | null } | null;
  error: unknown;
}>;

/**
 * Independently authorize one claimed Clean Up job.
 * Missing administrator configuration denies before the lookup.
 * The comparison uses the existing `VIBODE_ADMIN_EMAIL` allowlist.
 */
export async function authorizeCleanupWorkerClaim(
  lookup: CleanupWorkerUserLookup,
  userId: string,
): Promise<boolean> {
  if (!isAdminEmailConfigured()) return false;
  if (!userId.trim()) return false;
  try {
    const result = await lookup(userId);
    if (result.error || !result.data?.user) return false;
    return isAdminEmail(result.data.user.email);
  } catch {
    return false;
  }
}

function isAdminEmailConfigured(): boolean {
  return (process.env.VIBODE_ADMIN_EMAIL ?? "").trim().length > 0;
}
