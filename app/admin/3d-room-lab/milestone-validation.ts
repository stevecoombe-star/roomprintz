/**
 * Lab-only closeout summary. This module consumes established camera, support,
 * attachment, and bounds facts; it deliberately creates no geometry, lifecycle,
 * or attachment authority.
 */
export type MilestoneSupportKind = "floor" | "wall_back" | "wall_left" | "wall_right" | "ceiling";
export type MilestoneWallKind = Exclude<MilestoneSupportKind, "floor" | "ceiling">;

export type MilestoneSupportFact = {
  rawReviewStatus: string;
  resolvedReviewStatus: string;
  runtimeUsable: boolean;
  confirmationCurrent: boolean;
  identityKey: string | null;
  attachable: boolean;
  blockers: readonly string[];
};

export type MilestoneMachineFacts = {
  imageBasis: {
    qualified: boolean;
    basisId: string | null;
    basisFingerprint: string | null;
  };
  camera: {
    active: boolean;
    stale: boolean;
    appliedAtIso: string | null;
    frameWidth: number | null;
    frameHeight: number | null;
  };
  supports: Record<MilestoneSupportKind, MilestoneSupportFact>;
  attachment: {
    mode: "detached" | "support_attached_current" | "support_attached_blocked";
    supportKind: MilestoneSupportKind | null;
    bindingCurrent: boolean;
    bindingKey: string | null;
    transformValid: boolean;
    contactDistanceToPlane: number | null;
    orientationDeterminant: number | null;
    blockers: readonly string[];
  };
  model: {
    boundsAvailable: boolean;
    boundsValid: boolean;
    boundsKey: string | null;
  };
  refusalCapabilities: {
    unusableSupportGuard: boolean;
    staleBindingGuard: boolean;
    finiteBoundaryGuard: boolean;
    cameraRevertGuard: boolean;
    modelMutationLockGuard: boolean;
  };
};

export type MilestoneBlocker =
  | "milestone_image_basis_unqualified"
  | "milestone_camera_inactive"
  | "milestone_camera_stale"
  | "milestone_frame_invalid"
  | "milestone_floor_unusable"
  | "milestone_no_wall_usable"
  | "milestone_ceiling_unusable"
  | "milestone_model_bounds_unavailable"
  | "milestone_model_bounds_invalid"
  | "milestone_attachment_not_current"
  | "milestone_attachment_binding_stale"
  | "milestone_attachment_transform_invalid"
  | "milestone_contact_distance_invalid"
  | "milestone_orientation_invalid"
  | "milestone_required_operator_observation_missing"
  | "milestone_operator_observations_stale"
  | "milestone_refusal_unusable_support_unavailable"
  | "milestone_refusal_stale_binding_unavailable"
  | "milestone_refusal_boundary_unavailable"
  | "milestone_refusal_camera_revert_unavailable"
  | "milestone_refusal_model_lock_unavailable";

export type MilestoneReadinessState =
  | "unavailable"
  | "blocked"
  | "ready_for_operator_validation"
  | "operator_validation_in_progress"
  | "operator_passed"
  | "operator_failed"
  | "operator_observations_stale";

export type MilestoneReadiness = {
  machineReady: boolean;
  state: MilestoneReadinessState;
  blockers: MilestoneBlocker[];
  underlyingBlockers: string[];
};

export type MilestoneObservationScenario =
  | "floor_visual_placement"
  | "wall_visual_placement"
  | "ceiling_visual_placement"
  | "boundary_refusal"
  | "stale_frozen_lifecycle"
  | "support_independence"
  | "model_lock_refusal";

export type OperatorObservationStatus = "not_observed" | "passed" | "failed";
export type ObservationContactProfileKey =
  | "floor:local_y:min"
  | "wall:local_z:min"
  | "wall:local_z:max"
  | "ceiling:local_y:min"
  | "ceiling:local_y:max";

/**
 * Session-local evidence of the real attachment configuration used for one
 * observation. It is provenance only: never attachment authority or restore
 * input, and deliberately excludes mutable pose values.
 */
export type ObservationAttachmentProvenance = {
  supportKind: MilestoneSupportKind;
  attachmentBindingKey: string;
  contactProfileKey: ObservationContactProfileKey;
};

export type ValidationAttachmentProvenanceBySupport =
  Partial<Record<MilestoneSupportKind, ObservationAttachmentProvenance>>;

export type MilestoneOperatorObservation = {
  status: OperatorObservationStatus;
  notes: string;
  observedAtIso: string | null;
  contextKey: string | null;
  supportKind?: MilestoneSupportKind | null;
  wallKind?: MilestoneWallKind | null;
  attachmentProvenance: ObservationAttachmentProvenance | null;
};
export type MilestoneOperatorObservations = Record<MilestoneObservationScenario, MilestoneOperatorObservation>;

export type ObservationWithCurrentness = MilestoneOperatorObservation & {
  current: boolean;
  stale: boolean;
};

export const MILESTONE_BLOCKER_ORDER: readonly MilestoneBlocker[] = [
  "milestone_image_basis_unqualified",
  "milestone_camera_inactive",
  "milestone_camera_stale",
  "milestone_frame_invalid",
  "milestone_floor_unusable",
  "milestone_no_wall_usable",
  "milestone_ceiling_unusable",
  "milestone_model_bounds_unavailable",
  "milestone_model_bounds_invalid",
  "milestone_attachment_not_current",
  "milestone_attachment_binding_stale",
  "milestone_attachment_transform_invalid",
  "milestone_contact_distance_invalid",
  "milestone_orientation_invalid",
  "milestone_required_operator_observation_missing",
  "milestone_operator_observations_stale",
  "milestone_refusal_unusable_support_unavailable",
  "milestone_refusal_stale_binding_unavailable",
  "milestone_refusal_boundary_unavailable",
  "milestone_refusal_camera_revert_unavailable",
  "milestone_refusal_model_lock_unavailable",
];

export const MILESTONE_BLOCKER_DESCRIPTIONS: Readonly<Record<MilestoneBlocker, string>> = {
  milestone_image_basis_unqualified: "A qualified image basis is required before validation can begin.",
  milestone_camera_inactive: "Apply a current calibrated camera before validating this room.",
  milestone_camera_stale: "The calibrated camera is no longer current for this image frame.",
  milestone_frame_invalid: "The current image frame has invalid dimensions.",
  milestone_floor_unusable: "Floor must be explicitly reviewed and runtime usable.",
  milestone_no_wall_usable: "At least one explicitly confirmed visible wall must be runtime usable.",
  milestone_ceiling_unusable: "Ceiling must be explicitly reviewed and runtime usable.",
  milestone_model_bounds_unavailable: "Model bounds are unavailable, so contact cannot be evaluated.",
  milestone_model_bounds_invalid: "Model bounds are invalid, so contact cannot be evaluated.",
  milestone_attachment_not_current: "The object is not currently attached to the requested support.",
  milestone_attachment_binding_stale: "The attachment belongs to an older support or camera context.",
  milestone_attachment_transform_invalid: "The current attachment transform is invalid and remains blocked.",
  milestone_contact_distance_invalid: "The attachment contact distance is not valid for the support plane.",
  milestone_orientation_invalid: "The attachment orientation is invalid or may be mirrored.",
  milestone_required_operator_observation_missing: "Required manual visual observations have not all been recorded.",
  milestone_operator_observations_stale: "Recorded manual observations belong to an older validation context.",
  milestone_refusal_unusable_support_unavailable: "The unusable-support refusal path is not available to demonstrate.",
  milestone_refusal_stale_binding_unavailable: "The stale-binding refusal path is not available to demonstrate.",
  milestone_refusal_boundary_unavailable: "The finite-boundary refusal path is not available to demonstrate.",
  milestone_refusal_camera_revert_unavailable: "The camera-revert refusal path is not available to demonstrate.",
  milestone_refusal_model_lock_unavailable: "The model-mutation lock refusal path is not available to demonstrate.",
};

export const REQUIRED_CORE_OBSERVATIONS: readonly MilestoneObservationScenario[] = [
  "floor_visual_placement",
  "wall_visual_placement",
  "ceiling_visual_placement",
  "boundary_refusal",
  "stale_frozen_lifecycle",
  "support_independence",
  "model_lock_refusal",
];

export const MILESTONE_SCENARIO_GUIDANCE: Readonly<Record<MilestoneObservationScenario, string>> = {
  floor_visual_placement: "Attach to Floor, then assess grounding, nearer/farther movement, rotation, scale, and drag continuity.",
  wall_visual_placement: "Attach to a confirmed visible wall and assess flush contact, handedness, movement, rotation, and scale.",
  ceiling_visual_placement: "Attach to Ceiling and assess contact face, room direction, movement, rotation, scale, and handedness.",
  boundary_refusal: "Attempt movement outside a finite reviewed support. It must refuse without clamping or teleporting.",
  stale_frozen_lifecycle: "Change support geometry or height and verify the attachment blocks, freezes, and needs explicit Reattach.",
  support_independence: "Verify invalid supports remain isolated and support handles never move the attached object.",
  model_lock_refusal: "While attached, verify model mutation controls are locked; detach before changing model state.",
};

export const CURATED_ROOM_PROFILES = [
  {
    id: "clear-envelope",
    label: "Profile A — Clear envelope",
    purpose: "Primary milestone demonstration.",
    characteristics: "Visible floor, back or side wall, visible ceiling, moderate perspective, and limited occlusion.",
  },
  {
    id: "side-wall-perspective",
    label: "Profile B — Strong side-wall perspective",
    purpose: "Wall orientation, handedness, and drag-perspective validation.",
    characteristics: "Strong Left or Right wall, long seam, visible floor, and optional ceiling.",
  },
  {
    id: "refusal-stress",
    label: "Profile C — Refusal/stress case",
    purpose: "Show visible fail-closed states without forcing acceptance.",
    characteristics: "Partial ceiling, occluded seam, narrow visible support, or difficult near-horizon geometry/crop.",
  },
] as const;

function validFrame(camera: MilestoneMachineFacts["camera"]): boolean {
  return !!(
    Number.isFinite(camera.frameWidth) &&
    Number.isFinite(camera.frameHeight) &&
    (camera.frameWidth ?? 0) > 0 &&
    (camera.frameHeight ?? 0) > 0
  );
}

function uniqueOrdered(values: readonly MilestoneBlocker[]): MilestoneBlocker[] {
  const set = new Set(values);
  return MILESTONE_BLOCKER_ORDER.filter((reason) => set.has(reason));
}

function foundationBlockers(facts: MilestoneMachineFacts): MilestoneBlocker[] {
  const blockers: MilestoneBlocker[] = [];
  if (!facts.imageBasis.qualified) blockers.push("milestone_image_basis_unqualified");
  if (!facts.camera.active) blockers.push("milestone_camera_inactive");
  if (facts.camera.stale) blockers.push("milestone_camera_stale");
  if (!validFrame(facts.camera)) blockers.push("milestone_frame_invalid");
  return blockers;
}

function modelBlockers(facts: MilestoneMachineFacts): MilestoneBlocker[] {
  if (!facts.model.boundsAvailable) return ["milestone_model_bounds_unavailable"];
  return facts.model.boundsValid ? [] : ["milestone_model_bounds_invalid"];
}

function profileReadiness(machineBlockers: readonly MilestoneBlocker[], underlyingBlockers: readonly string[]): MilestoneReadiness {
  const blockers = uniqueOrdered(machineBlockers);
  return {
    machineReady: blockers.length === 0,
    state: blockers.length === 0 ? "ready_for_operator_validation" : "blocked",
    blockers,
    underlyingBlockers: [...underlyingBlockers],
  };
}

export function evaluateCameraFoundation(facts: MilestoneMachineFacts): MilestoneReadiness {
  return profileReadiness(foundationBlockers(facts), []);
}

export function evaluateFloorDemo(facts: MilestoneMachineFacts): MilestoneReadiness {
  const floor = facts.supports.floor;
  const blockers: MilestoneBlocker[] = [
    ...foundationBlockers(facts),
    ...modelBlockers(facts),
    ...(floor.runtimeUsable && floor.attachable ? [] : (["milestone_floor_unusable"] as const)),
  ];
  return profileReadiness(
    blockers,
    floor.runtimeUsable && floor.attachable ? [] : floor.blockers
  );
}

export function usableWallKinds(facts: MilestoneMachineFacts): MilestoneWallKind[] {
  return (["wall_back", "wall_left", "wall_right"] as const).filter(
    (kind) => facts.supports[kind].runtimeUsable && facts.supports[kind].attachable
  );
}

export function evaluateWallDemo(facts: MilestoneMachineFacts): MilestoneReadiness {
  const walls = ["wall_back", "wall_left", "wall_right"] as const;
  const usable = usableWallKinds(facts);
  const blockers: MilestoneBlocker[] = [
    ...foundationBlockers(facts),
    ...modelBlockers(facts),
    ...(usable.length > 0 ? [] : (["milestone_no_wall_usable"] as const)),
  ];
  return profileReadiness(
    blockers,
    usable.length > 0 ? [] : walls.flatMap((kind) => facts.supports[kind].blockers)
  );
}

export function evaluateCeilingDemo(facts: MilestoneMachineFacts): MilestoneReadiness {
  const ceiling = facts.supports.ceiling;
  const blockers: MilestoneBlocker[] = [
    ...foundationBlockers(facts),
    ...modelBlockers(facts),
    ...(ceiling.runtimeUsable && ceiling.attachable ? [] : (["milestone_ceiling_unusable"] as const)),
  ];
  return profileReadiness(
    blockers,
    ceiling.runtimeUsable && ceiling.attachable ? [] : ceiling.blockers
  );
}

export function evaluateRefusalDemo(facts: MilestoneMachineFacts): MilestoneReadiness {
  const capabilities = facts.refusalCapabilities;
  const blockers: MilestoneBlocker[] = [];
  if (!capabilities.unusableSupportGuard) blockers.push("milestone_refusal_unusable_support_unavailable");
  if (!capabilities.staleBindingGuard) blockers.push("milestone_refusal_stale_binding_unavailable");
  if (!capabilities.finiteBoundaryGuard) blockers.push("milestone_refusal_boundary_unavailable");
  if (!capabilities.cameraRevertGuard) blockers.push("milestone_refusal_camera_revert_unavailable");
  if (!capabilities.modelMutationLockGuard) blockers.push("milestone_refusal_model_lock_unavailable");
  return profileReadiness(blockers, []);
}

export function evaluateCurrentAttachment(facts: MilestoneMachineFacts): MilestoneReadiness {
  const attachment = facts.attachment;
  const blockers: MilestoneBlocker[] = [];
  if (attachment.mode !== "support_attached_current") blockers.push("milestone_attachment_not_current");
  if (!attachment.bindingCurrent) blockers.push("milestone_attachment_binding_stale");
  if (!attachment.transformValid) blockers.push("milestone_attachment_transform_invalid");
  if (attachment.contactDistanceToPlane === null || !Number.isFinite(attachment.contactDistanceToPlane) || Math.abs(attachment.contactDistanceToPlane) > 1e-5) {
    blockers.push("milestone_contact_distance_invalid");
  }
  if (attachment.orientationDeterminant === null || !Number.isFinite(attachment.orientationDeterminant) || attachment.orientationDeterminant <= 0.9999) {
    blockers.push("milestone_orientation_invalid");
  }
  return profileReadiness(blockers, attachment.blockers);
}

export function createEmptyOperatorObservations(): MilestoneOperatorObservations {
  const empty = (): MilestoneOperatorObservation => ({
    status: "not_observed",
    notes: "",
    observedAtIso: null,
    contextKey: null,
    attachmentProvenance: null,
  });
  return {
    floor_visual_placement: empty(),
    wall_visual_placement: empty(),
    ceiling_visual_placement: empty(),
    boundary_refusal: empty(),
    stale_frozen_lifecycle: empty(),
    support_independence: empty(),
    model_lock_refusal: empty(),
  };
}

export function buildValidationContextKey(facts: MilestoneMachineFacts): string {
  return buildContextKey(facts, facts.attachment.bindingKey);
}

/**
 * Observation provenance deliberately excludes the currently selected object
 * attachment. A one-object lab must be able to retain a Floor observation while
 * the operator proceeds to validate a wall or Ceiling. Each support identity
 * already incorporates its binding inputs (basis, camera, frame, reviewed
 * geometry, and confirmation), so changing any relevant authority still stales
 * the observation.
 */
export function buildBroadObservationContextKey(facts: MilestoneMachineFacts): string {
  return buildContextKey(facts, null);
}

function buildContextKey(facts: MilestoneMachineFacts, attachmentBinding: string | null): string {
  const supportIdentity = (kind: MilestoneSupportKind) => facts.supports[kind].identityKey;
  return JSON.stringify({
    version: "visible-3d-room-lab-validation-context/v0",
    basis: [facts.imageBasis.basisId, facts.imageBasis.basisFingerprint],
    camera: [facts.camera.appliedAtIso, facts.camera.frameWidth, facts.camera.frameHeight],
    supports: {
      floor: supportIdentity("floor"),
      wall_back: supportIdentity("wall_back"),
      wall_left: supportIdentity("wall_left"),
      wall_right: supportIdentity("wall_right"),
      ceiling: supportIdentity("ceiling"),
    },
    modelBounds: facts.model.boundsKey,
    attachmentBinding,
  });
}

export function scenarioRequiresAttachmentProvenance(scenario: MilestoneObservationScenario): boolean {
  return scenario !== "support_independence";
}

export function buildObservationContextKey(input: {
  facts: MilestoneMachineFacts;
  scenario: MilestoneObservationScenario;
  observedSupportKind: MilestoneSupportKind | null;
  attachmentProvenance: ObservationAttachmentProvenance | null;
}): string | null {
  const { facts, scenario, observedSupportKind, attachmentProvenance } = input;
  if (scenarioRequiresAttachmentProvenance(scenario)) {
    if (!observedSupportKind || !attachmentProvenance || attachmentProvenance.supportKind !== observedSupportKind) {
      return null;
    }
  }
  return JSON.stringify({
    version: "visible-3d-room-lab-observation-context/v1",
    broadContext: buildBroadObservationContextKey(facts),
    scenario,
    observedSupportKind,
    supportIdentity: observedSupportKind ? facts.supports[observedSupportKind].identityKey : null,
    attachmentProvenance: scenarioRequiresAttachmentProvenance(scenario) ? attachmentProvenance : null,
  });
}

export function withObservationCurrentness(
  observations: MilestoneOperatorObservations,
  facts: MilestoneMachineFacts,
  provenanceBySupport: ValidationAttachmentProvenanceBySupport
): Record<MilestoneObservationScenario, ObservationWithCurrentness> {
  return Object.fromEntries(
    (Object.keys(observations) as MilestoneObservationScenario[]).map((scenario) => {
      const observation = observations[scenario];
      const observed = observation.status !== "not_observed";
      const observedSupportKind = observation.supportKind ?? null;
      const currentProvenance =
        observedSupportKind && scenarioRequiresAttachmentProvenance(scenario)
          ? provenanceBySupport[observedSupportKind] ?? null
          : observation.attachmentProvenance;
      const expectedContextKey = buildObservationContextKey({
        facts,
        scenario,
        observedSupportKind,
        attachmentProvenance: currentProvenance,
      });
      const current = observed && expectedContextKey !== null && observation.contextKey === expectedContextKey;
      return [scenario, { ...observation, current, stale: observed && !current }];
    })
  ) as Record<MilestoneObservationScenario, ObservationWithCurrentness>;
}

export function recordOperatorObservation(input: {
  previous: MilestoneOperatorObservation;
  status: Exclude<OperatorObservationStatus, "not_observed">;
  notes: string;
  contextKey: string;
  observedAtIso: string;
  supportKind?: MilestoneSupportKind | null;
  wallKind?: MilestoneWallKind | null;
  attachmentProvenance?: ObservationAttachmentProvenance | null;
}): MilestoneOperatorObservation {
  return {
    status: input.status,
    notes: input.notes,
    observedAtIso: input.observedAtIso,
    contextKey: input.contextKey,
    supportKind: input.supportKind ?? input.previous.supportKind ?? null,
    wallKind: input.wallKind ?? input.previous.wallKind ?? null,
    attachmentProvenance: input.attachmentProvenance ?? input.previous.attachmentProvenance ?? null,
  };
}

export function updateObservationNotes(
  previous: MilestoneOperatorObservation,
  notes: string
): MilestoneOperatorObservation {
  return { ...previous, notes };
}

export function evaluateCoreMilestone(input: {
  facts: MilestoneMachineFacts;
  observations: MilestoneOperatorObservations;
  provenanceBySupport: ValidationAttachmentProvenanceBySupport;
}): MilestoneReadiness {
  const profiles = [
    evaluateCameraFoundation(input.facts),
    evaluateFloorDemo(input.facts),
    evaluateWallDemo(input.facts),
    evaluateCeilingDemo(input.facts),
    evaluateRefusalDemo(input.facts),
  ];
  const machineBlockers = profiles.flatMap((profile) => profile.blockers);
  const underlyingBlockers = profiles.flatMap((profile) => profile.underlyingBlockers);
  if (machineBlockers.length > 0) {
    const result = profileReadiness(machineBlockers, underlyingBlockers);
    return { ...result, state: result.blockers.length > 0 ? "blocked" : result.state };
  }
  const currentness = withObservationCurrentness(input.observations, input.facts, input.provenanceBySupport);
  const required = REQUIRED_CORE_OBSERVATIONS.map((scenario) => currentness[scenario]);
  if (required.some((observation) => observation.status !== "not_observed" && observation.stale)) {
    return {
      machineReady: true,
      state: "operator_observations_stale",
      blockers: ["milestone_operator_observations_stale"],
      underlyingBlockers: [],
    };
  }
  if (required.some((observation) => observation.current && observation.status === "failed")) {
    return { machineReady: true, state: "operator_failed", blockers: [], underlyingBlockers: [] };
  }
  if (required.every((observation) => observation.current && observation.status === "passed")) {
    return { machineReady: true, state: "operator_passed", blockers: [], underlyingBlockers: [] };
  }
  const hasCurrentObservation = required.some((observation) => observation.current);
  return {
    machineReady: true,
    state: hasCurrentObservation ? "operator_validation_in_progress" : "ready_for_operator_validation",
    blockers: ["milestone_required_operator_observation_missing"],
    underlyingBlockers: [],
  };
}

export function describeMilestoneBlocker(code: string): string {
  return MILESTONE_BLOCKER_DESCRIPTIONS[code as MilestoneBlocker] ?? "This validation condition is unavailable or blocked; review its original diagnostic code.";
}

export type VisibleRoomMilestoneReportV0 = {
  schema: "vibode-3d-room-lab-visible-milestone-report/v0";
  generatedAtIso: string;
  contextKey: string;
  machineFacts: MilestoneMachineFacts;
  readiness: {
    cameraFoundation: MilestoneReadiness;
    floorDemo: MilestoneReadiness;
    wallDemo: MilestoneReadiness;
    ceilingDemo: MilestoneReadiness;
    refusalDemo: MilestoneReadiness;
    coreMilestone: MilestoneReadiness;
  };
  operatorObservations: Record<MilestoneObservationScenario, ObservationWithCurrentness>;
  currentMilestoneResult:
    | "not_ready"
    | "ready_for_operator_validation"
    | "operator_passed"
    | "operator_failed"
    | "operator_observations_stale";
  session: { profileLabel: string; roomPhotoNotes: string };
  disclaimers: string[];
};

export function buildVisibleRoomMilestoneReport(input: {
  facts: MilestoneMachineFacts;
  observations: MilestoneOperatorObservations;
  provenanceBySupport: ValidationAttachmentProvenanceBySupport;
  generatedAtIso: string;
  profileLabel?: string;
  roomPhotoNotes?: string;
}): VisibleRoomMilestoneReportV0 {
  const contextKey = buildValidationContextKey(input.facts);
  const coreMilestone = evaluateCoreMilestone({
    facts: input.facts,
    observations: input.observations,
    provenanceBySupport: input.provenanceBySupport,
  });
  const currentMilestoneResult =
    coreMilestone.state === "operator_passed"
      ? "operator_passed"
      : coreMilestone.state === "operator_failed"
        ? "operator_failed"
        : coreMilestone.state === "operator_observations_stale"
          ? "operator_observations_stale"
          : coreMilestone.machineReady
            ? "ready_for_operator_validation"
            : "not_ready";
  return {
    schema: "vibode-3d-room-lab-visible-milestone-report/v0",
    generatedAtIso: input.generatedAtIso,
    contextKey,
    machineFacts: input.facts,
    readiness: {
      cameraFoundation: evaluateCameraFoundation(input.facts),
      floorDemo: evaluateFloorDemo(input.facts),
      wallDemo: evaluateWallDemo(input.facts),
      ceilingDemo: evaluateCeilingDemo(input.facts),
      refusalDemo: evaluateRefusalDemo(input.facts),
      coreMilestone,
    },
    operatorObservations: withObservationCurrentness(input.observations, input.facts, input.provenanceBySupport),
    currentMilestoneResult,
    session: { profileLabel: input.profileLabel ?? "", roomPhotoNotes: input.roomPhotoNotes ?? "" },
    disclaimers: [
      "This is a session-local lab validation report.",
      "Room height may be assumed; it is not a physical measurement.",
      "Supports are locally reviewed visible patches, not complete room geometry.",
      "Operator visual judgments are manual observations.",
      "This report is not a physical measurement certificate.",
      "This report grants no support or camera authority.",
      "This report does not persist or restore attachment state.",
      "Successful validation of this session does not prove that every future room photo will produce a successful result.",
    ],
  };
}
