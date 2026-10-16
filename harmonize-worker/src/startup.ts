import { readHarmonizeNbpApiKey } from "@/lib/vibode-stage/harmonize-nbp-proof";
import { readHarmonizeWorkerProviderMode } from "@/lib/vibode-stage/harmonize-jobs/provider";
import { harmonizeWorkerProcessingEnabled } from "@/lib/vibode-stage/harmonize-jobs/worker-enabled";

import { parseHarmonizeWorkerArgs, type HarmonizeWorkerSelection } from "./args";
import { readHarmonizeWorkerProcessEnv, type HarmonizeWorkerProcessEnv } from "./http-api";

export type HarmonizeWorkerStartup =
  | Readonly<{ ok: false; missing: string }>
  | Readonly<{
    ok: true;
    selection: HarmonizeWorkerSelection;
    providerMode: "google" | "fake";
    apiKey: string | null;
    env: HarmonizeWorkerProcessEnv;
    processingEnabled: boolean;
    port: number;
  }>;

/**
 * Reads process configuration only. It does not claim a job, contact a
 * provider, or open a socket. Processing stays off unless the enable flag
 * is exactly `1`, even when a provider key is present.
 * A disabled production worker still needs the app URL, worker secret, and
 * Google credential before the process stays up. A missing credential exits
 * before any claim. Fake mode never falls through to Google.
 */
export function evaluateHarmonizeWorkerStartup(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): HarmonizeWorkerStartup {
  const args = parseHarmonizeWorkerArgs(argv);
  if (!args.ok) return { ok: false, missing: args.code };
  const providerMode = readHarmonizeWorkerProviderMode(env);
  if (!providerMode.ok) return { ok: false, missing: providerMode.code };
  const parsed = readHarmonizeWorkerProcessEnv(env, {
    requireProviderCredentials: providerMode.mode === "google",
  });
  if (!parsed.ok) return { ok: false, missing: parsed.missing.join(",") };
  const apiKey = providerMode.mode === "google" ? readHarmonizeNbpApiKey(env) : null;
  if (providerMode.mode === "google" && !apiKey) return { ok: false, missing: "GEMINI_API_KEY" };
  const port = readHarmonizeWorkerHealthPort(env);
  if (port == null) return { ok: false, missing: "PORT" };
  return {
    ok: true,
    selection: args.selection,
    providerMode: providerMode.mode,
    apiKey,
    env: parsed.env,
    processingEnabled: harmonizeWorkerProcessingEnabled(env),
    port,
  };
}

export function readHarmonizeWorkerHealthPort(
  env: Readonly<Record<string, string | undefined>>,
): number | null {
  const raw = env.PORT?.trim() ?? "";
  if (!raw) return 8080;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}
