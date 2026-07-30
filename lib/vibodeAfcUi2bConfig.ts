import "server-only";

/** Visibility only; UI2B routes repeat this hard server-side gate. */
export function isAfcUi2bProposalRunnerEnabled(): boolean {
  return process.env.AFC_UI2B_PROPOSAL_RUNNER_ENABLED === "true";
}

/**
 * UI2B owns neither provider credentials nor browser model selection. The
 * server resolves the same stable R3C model used by the committed research
 * fixtures unless an operator has configured an explicit server-only override.
 */
export function resolveAfcUi2bProposalRunnerModel(): string | null {
  const configured = process.env.AFC_UI2B_GEMINI_MODEL?.trim();
  if (configured !== undefined && configured.length === 0) return null;
  return configured ?? "gemini-3.5-flash";
}

export function resolveAfcUi2bGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}
