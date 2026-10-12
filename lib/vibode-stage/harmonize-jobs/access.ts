import { isAdminEmail } from "@/lib/adminAccess";

export type HarmonizeMode = "off" | "admin";

export type HarmonizeActorDecision = "ok" | "disabled" | "unauthenticated" | "forbidden";

/** Default off. `admin` still requires the configured admin email. */
export function harmonizeMode(env: NodeJS.ProcessEnv = process.env): HarmonizeMode {
  return env.VIBODE_HARMONIZE_MODE?.trim().toLowerCase() === "admin" ? "admin" : "off";
}

export function harmonizeActorDecision(input: Readonly<{
  mode: HarmonizeMode;
  userId: string | null;
  email: string | null | undefined;
}>): HarmonizeActorDecision {
  if (input.mode !== "admin") return "disabled";
  if (!input.userId) return "unauthenticated";
  if (!isAdminEmail(input.email)) return "forbidden";
  return "ok";
}
