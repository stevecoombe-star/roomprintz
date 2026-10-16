/**
 * Autonomous Harmonize processing is off unless this is exactly `1`.
 * Intake mode (`VIBODE_HARMONIZE_MODE`) is a separate switch.
 */
export function harmonizeWorkerProcessingEnabled(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.VIBODE_HARMONIZE_WORKER_ENABLED?.trim() === "1";
}
