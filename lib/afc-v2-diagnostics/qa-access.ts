/**
 * Pure AFC QA access decision.
 *
 * Global QA Mode and the auth-user allowlist are both required.
 * Email is never an authorization key.
 */

const AFC_QA_USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AfcQaAccessConfig = Readonly<{
  qaModeEnabled: boolean;
  allowlist: ReadonlySet<string>;
}>;

export type AfcQaCapabilityDecision = Readonly<{
  enabled: boolean;
}>;

export function normalizeAfcQaUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return AFC_QA_USER_ID.test(id) ? id : null;
}

export function normalizeAfcQaEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length < 3 || email.length > 320) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function afcQaAccessConfig(
  qaModeEnabled: boolean,
  ...userIds: string[]
): AfcQaAccessConfig {
  const allowlist = new Set<string>();
  for (const userId of userIds) {
    const id = normalizeAfcQaUserId(userId);
    if (id) allowlist.add(id);
  }
  return Object.freeze({
    qaModeEnabled: qaModeEnabled === true,
    allowlist,
  });
}

export function disabledAfcQaAccessConfig(): AfcQaAccessConfig {
  return afcQaAccessConfig(false);
}

/**
 * QA access is granted only when QA Mode is enabled and the authenticated
 * user id is on the allowlist. An invalid user id is denied.
 */
export function resolveAfcQaCapabilityForConfig(
  userId: string,
  config: AfcQaAccessConfig,
): AfcQaCapabilityDecision {
  const id = normalizeAfcQaUserId(userId);
  if (!id || config.qaModeEnabled !== true) return { enabled: false };
  return { enabled: config.allowlist.has(id) };
}
