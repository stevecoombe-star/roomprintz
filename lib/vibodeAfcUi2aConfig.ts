import "server-only";

/** UI visibility only; the UI2A routes repeat this exact hard gate. */
export function isAfcUi2aPreparationEnabled(): boolean {
  return process.env.AFC_UI2A_PREPARATION_ENABLED === "true";
}
