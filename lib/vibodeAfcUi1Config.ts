import "server-only";

/** UI visibility only; the research route repeats this exact hard gate. */
export function isAfcUi1ProposalOverlayEnabled(): boolean {
  return process.env.AFC_UI1_PROPOSAL_OVERLAY_ENABLED === "true";
}
