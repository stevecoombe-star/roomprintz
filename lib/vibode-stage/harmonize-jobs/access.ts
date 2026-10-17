import { isAdminEmail } from "@/lib/adminAccess";

export type HarmonizeMode = "off" | "admin" | "shopper" | "public";

export type HarmonizeActorDecision = "ok" | "disabled" | "unauthenticated" | "forbidden";

const SHOPPER_USER_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Default off. Only `admin`, `shopper`, and `public` open intake.
 * Unset, empty, `off`, `on`, and every other value stay off.
 */
export function harmonizeMode(env: NodeJS.ProcessEnv = process.env): HarmonizeMode {
  const requested = env.VIBODE_HARMONIZE_MODE?.trim().toLowerCase() ?? "";
  if (requested === "admin") return "admin";
  if (requested === "shopper") return "shopper";
  if (requested === "public") return "public";
  return "off";
}

/** Closed-beta tester ids. Email is not an authorization key. An empty list admits nobody. */
export function harmonizeShopperUserIds(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const part of (env.VIBODE_HARMONIZE_SHOPPER_USER_IDS ?? "").split(",")) {
    const id = part.trim().toLowerCase();
    if (SHOPPER_USER_ID.test(id)) ids.add(id);
  }
  return ids;
}

export function harmonizeShopperEligible(
  userId: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!userId) return false;
  const id = userId.trim().toLowerCase();
  if (!SHOPPER_USER_ID.test(id)) return false;
  return harmonizeShopperUserIds(env).has(id);
}

export function harmonizeActorDecision(input: Readonly<{
  mode: HarmonizeMode;
  userId: string | null;
  email: string | null | undefined;
  shopperEligible?: boolean;
}>): HarmonizeActorDecision {
  if (input.mode === "off") return "disabled";
  if (!input.userId) return "unauthenticated";
  if (input.mode === "admin") {
    if (!isAdminEmail(input.email)) return "forbidden";
    return "ok";
  }
  if (input.mode === "shopper") {
    if (input.shopperEligible !== true) return "forbidden";
    return "ok";
  }
  if (input.mode === "public") return "ok";
  return "disabled";
}
