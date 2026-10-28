import { cleanupWorkerProcessingEnabled } from "@/lib/vibode-stage/remove-cleanup-jobs/worker-enabled";

export type CleanupWorkerStartup =
  | Readonly<{ ok: false; missing: string }>
  | Readonly<{
    ok: true;
    providerMode: "google" | "fake";
    processingEnabled: boolean;
    port: number;
  }>;

/**
 * Reads process configuration only. It does not open a socket, claim a job,
 * or contact a provider. Processing stays off unless the enable flag is
 * exactly `1`, even when a provider key is present.
 */
export function evaluateCleanupWorkerStartup(
  env: Readonly<Record<string, string | undefined>>,
  argv: readonly string[],
): CleanupWorkerStartup {
  const providerMode = readProviderMode(argv);
  if (!providerMode) return { ok: false, missing: "--provider google|fake" };
  if (providerMode === "fake" && env.NODE_ENV === "production") {
    return { ok: false, missing: "fake provider is refused in production" };
  }
  if (providerMode === "google" && !providerKey(env)) return { ok: false, missing: "GEMINI_API_KEY" };
  const supabase = missingSupabase(env);
  if (supabase) return { ok: false, missing: supabase };
  const port = readCleanupWorkerHealthPort(env);
  if (port == null) return { ok: false, missing: "PORT" };
  return {
    ok: true,
    providerMode,
    processingEnabled: cleanupWorkerProcessingEnabled(env),
    port,
  };
}

export function readCleanupWorkerHealthPort(
  env: Readonly<Record<string, string | undefined>>,
): number | null {
  const raw = env.PORT?.trim() ?? "";
  if (!raw) return 8080;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function readProviderMode(argv: readonly string[]): "google" | "fake" | null {
  const index = argv.indexOf("--provider");
  const mode = index >= 0 ? argv[index + 1] : "";
  return mode === "google" || mode === "fake" ? mode : null;
}

function providerKey(env: Readonly<Record<string, string | undefined>>): string {
  return env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || "";
}

function missingSupabase(env: Readonly<Record<string, string | undefined>>): string | null {
  const url = env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim() || "";
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  if (!url) return "SUPABASE_URL";
  if (!key) return "SUPABASE_SERVICE_ROLE_KEY";
  return null;
}
