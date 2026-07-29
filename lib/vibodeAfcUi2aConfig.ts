import "server-only";

/** UI visibility only; the UI2A routes repeat this exact hard gate. */
export function isAfcUi2aPreparationEnabled(): boolean {
  return process.env.AFC_UI2A_PREPARATION_ENABLED === "true";
}

/** Gates only a newly authorized live Empty-Room compositor call. */
export function isAfcUi2aEmptyGenerationEnabled(): boolean {
  return process.env.AFC_UI2A_EMPTY_GENERATION_ENABLED === "true";
}
