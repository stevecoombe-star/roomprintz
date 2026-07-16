import type { G0NoAuthorityCheckStatus } from "./observed-run-record";
import type { NonPStaleProbeId } from "./non-p-stale-provenance-resolver";

type NoAuthorityProfile = {
  readonly qualification_refusal_result: G0NoAuthorityCheckStatus;
  readonly restore_or_import_result: G0NoAuthorityCheckStatus;
  readonly route_response_result: G0NoAuthorityCheckStatus;
  readonly apply_gate_defense_in_depth: G0NoAuthorityCheckStatus;
  readonly client_discard_predicate: G0NoAuthorityCheckStatus;
  readonly live_snapshot_state_observation: G0NoAuthorityCheckStatus;
  readonly state_transition_predicate: G0NoAuthorityCheckStatus;
};

export const NON_P_STALE_NO_AUTHORITY_PROFILES: Record<NonPStaleProbeId, NoAuthorityProfile> = {
  "P-crop": {
    qualification_refusal_result: "pass",
    restore_or_import_result: "not_run",
    route_response_result: "not_run",
    apply_gate_defense_in_depth: "pass",
    client_discard_predicate: "not_run",
    live_snapshot_state_observation: "not_run",
    state_transition_predicate: "not_run",
  },
  "P-empty": {
    qualification_refusal_result: "pass",
    restore_or_import_result: "not_run",
    route_response_result: "pass",
    apply_gate_defense_in_depth: "pass",
    client_discard_predicate: "not_run",
    live_snapshot_state_observation: "not_run",
    state_transition_predicate: "not_run",
  },
  "P-gen": {
    qualification_refusal_result: "pass",
    restore_or_import_result: "not_run",
    route_response_result: "not_run",
    apply_gate_defense_in_depth: "pass",
    client_discard_predicate: "not_run",
    live_snapshot_state_observation: "not_run",
    state_transition_predicate: "not_run",
  },
  "P-url-drift": {
    qualification_refusal_result: "not_run",
    restore_or_import_result: "pass",
    route_response_result: "pass",
    apply_gate_defense_in_depth: "pass",
    client_discard_predicate: "pass",
    live_snapshot_state_observation: "not_run",
    state_transition_predicate: "not_run",
  },
  "P-dimension-mismatch": {
    qualification_refusal_result: "pass",
    restore_or_import_result: "not_run",
    route_response_result: "not_run",
    apply_gate_defense_in_depth: "pass",
    client_discard_predicate: "not_run",
    live_snapshot_state_observation: "not_run",
    state_transition_predicate: "not_run",
  },
  "P-coordinate-space-drift": {
    qualification_refusal_result: "pass",
    restore_or_import_result: "pass",
    route_response_result: "not_run",
    apply_gate_defense_in_depth: "pass",
    client_discard_predicate: "not_run",
    live_snapshot_state_observation: "not_run",
    state_transition_predicate: "not_run",
  },
  "P-legacy": {
    qualification_refusal_result: "not_run",
    restore_or_import_result: "pass",
    route_response_result: "not_run",
    apply_gate_defense_in_depth: "pass",
    client_discard_predicate: "not_run",
    live_snapshot_state_observation: "not_run",
    state_transition_predicate: "not_run",
  },
  X4: {
    qualification_refusal_result: "pass",
    restore_or_import_result: "not_run",
    route_response_result: "not_run",
    apply_gate_defense_in_depth: "pass",
    client_discard_predicate: "not_run",
    live_snapshot_state_observation: "not_run",
    state_transition_predicate: "not_run",
  },
};

export function getNonPStaleNoAuthorityProfile(probeId: NonPStaleProbeId): NoAuthorityProfile {
  const profile = NON_P_STALE_NO_AUTHORITY_PROFILES[probeId];
  if (!profile) {
    throw new Error(`missing_no_authority_profile:${probeId}`);
  }
  return profile;
}
