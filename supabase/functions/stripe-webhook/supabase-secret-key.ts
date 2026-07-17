const NAMED_SECRET_KEY = "vibode_ui_production";

export function resolveSupabaseSecretKey(
  secretKeysJson: string | undefined,
): string {
  if (secretKeysJson === undefined) {
    throw new Error(
      "Missing required SUPABASE_SECRET_KEYS environment variable for stripe-webhook.",
    );
  }

  let secretKeys: unknown;
  try {
    secretKeys = JSON.parse(secretKeysJson);
  } catch {
    throw new Error(
      "SUPABASE_SECRET_KEYS must contain valid JSON for stripe-webhook.",
    );
  }

  if (
    secretKeys === null ||
    typeof secretKeys !== "object" ||
    Array.isArray(secretKeys) ||
    Object.getPrototypeOf(secretKeys) !== Object.prototype
  ) {
    throw new Error(
      "SUPABASE_SECRET_KEYS must be a JSON object for stripe-webhook.",
    );
  }

  const namedKey = (secretKeys as Record<string, unknown>)[NAMED_SECRET_KEY];
  if (typeof namedKey !== "string" || namedKey.trim().length === 0) {
    throw new Error(
      `SUPABASE_SECRET_KEYS must include a non-empty string named "${NAMED_SECRET_KEY}" for stripe-webhook.`,
    );
  }

  return namedKey;
}
