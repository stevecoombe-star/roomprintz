/**
 * Clean Up processing is on only when the value is the exact string `1`.
 * Missing, empty, `0`, `true`, `01`, and surrounding whitespace or a
 * trailing newline stay off, including when a provider key is present.
 */
export function cleanupWorkerProcessingEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.VIBODE_CLEANUP_WORKER_ENABLED === "1";
}
