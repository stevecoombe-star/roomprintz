import type { G0ProbeId } from "./package";

export type G0SupportingCheckDefinition = {
  readonly checkId: string;
  readonly required: true;
};

export const APPLY_GATE_DEFENSE_CHECK_ID = "apply_gate_defense_in_depth";

export const G0_SUPPORTING_CHECKS: Record<G0ProbeId, readonly G0SupportingCheckDefinition[]> = {
  "P-crop": [
    { checkId: "restore_comparison_changed_byte_crop", required: true },
    { checkId: APPLY_GATE_DEFENSE_CHECK_ID, required: true },
  ],
  "P-empty": [
    { checkId: "empty_room_route_containment_behavior", required: true },
    { checkId: "restore_lineage_check", required: true },
    { checkId: APPLY_GATE_DEFENSE_CHECK_ID, required: true },
  ],
  "P-gen": [{ checkId: APPLY_GATE_DEFENSE_CHECK_ID, required: true }],
  "P-stale": [
    { checkId: "shouldDropAuthorityOnFrameChange_predicate", required: true },
    { checkId: "precondition_artifact_readouts", required: true },
  ],
  "P-url-drift": [
    { checkId: "vision_route_mismatch_discard", required: true },
    { checkId: "empty_room_route_mismatch_discard", required: true },
    { checkId: "client_discard_predicate", required: true },
    { checkId: APPLY_GATE_DEFENSE_CHECK_ID, required: true },
  ],
  "P-dimension-mismatch": [
    { checkId: "vision_route_pre_model_dimension_verification", required: true },
    { checkId: APPLY_GATE_DEFENSE_CHECK_ID, required: true },
  ],
  "P-coordinate-space-drift": [
    { checkId: "qualification_equality_key_check", required: true },
    { checkId: APPLY_GATE_DEFENSE_CHECK_ID, required: true },
  ],
  "P-legacy": [{ checkId: "defensive_apply_gate_check", required: true }],
  X4: [
    { checkId: "vision_route_pre_model_orientation_refusal", required: true },
    { checkId: APPLY_GATE_DEFENSE_CHECK_ID, required: true },
  ],
};
