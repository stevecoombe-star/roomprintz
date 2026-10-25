export const REMOVE_CLEANUP_ADMIN_ACCESS_PATH = "/api/auth/admin-access";

/** True only for a trusted admin-access payload whose `isAdmin` flag is boolean true. */
export function cleanupAdminAccessConfirmed(payload: unknown): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  return (payload as { isAdmin?: unknown }).isAdmin === true;
}

/**
 * Ask the existing admin-access endpoint whether this browser session is an
 * administrator. Network, HTTP, and payload failures stay closed.
 */
export async function readCleanupAdminAccess(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(REMOVE_CLEANUP_ADMIN_ACCESS_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: "{}",
    });
    if (!response.ok) return false;
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return false;
    }
    return cleanupAdminAccessConfirmed(payload);
  } catch {
    return false;
  }
}
