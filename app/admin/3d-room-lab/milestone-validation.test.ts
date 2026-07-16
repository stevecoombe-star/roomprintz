import assert from "node:assert/strict";
import test from "node:test";
import {
  MILESTONE_BLOCKER_DESCRIPTIONS,
  buildObservationContextKey,
  buildValidationContextKey,
  buildVisibleRoomMilestoneReport,
  createEmptyOperatorObservations,
  describeMilestoneBlocker,
  evaluateCameraFoundation,
  evaluateCoreMilestone,
  evaluateFloorDemo,
  evaluateRefusalDemo,
  evaluateWallDemo,
  recordOperatorObservation,
  withObservationCurrentness,
  type MilestoneMachineFacts,
  type MilestoneObservationScenario,
  type MilestoneOperatorObservations,
  type MilestoneSupportKind,
  type ObservationAttachmentProvenance,
  type ValidationAttachmentProvenanceBySupport,
} from "./milestone-validation";

function support(identityKey: string, usable = true) {
  return {
    rawReviewStatus: "manually_confirmed",
    resolvedReviewStatus: "manually_confirmed",
    runtimeUsable: usable,
    confirmationCurrent: usable,
    identityKey,
    attachable: usable,
    blockers: usable ? [] : ["support_not_confirmed"],
  };
}

type FactsOverrides = Omit<Partial<MilestoneMachineFacts>, "imageBasis" | "camera" | "supports" | "attachment" | "model" | "refusalCapabilities"> & {
  imageBasis?: Partial<MilestoneMachineFacts["imageBasis"]>;
  camera?: Partial<MilestoneMachineFacts["camera"]>;
  supports?: Partial<MilestoneMachineFacts["supports"]>;
  attachment?: Partial<MilestoneMachineFacts["attachment"]>;
  model?: Partial<MilestoneMachineFacts["model"]>;
  refusalCapabilities?: Partial<MilestoneMachineFacts["refusalCapabilities"]>;
};

function facts(overrides: FactsOverrides = {}): MilestoneMachineFacts {
  const base: MilestoneMachineFacts = {
    imageBasis: { qualified: true, basisId: "basis-a", basisFingerprint: "fp-a" },
    camera: { active: true, stale: false, appliedAtIso: "2026-07-11T10:00:00.000Z", frameWidth: 1600, frameHeight: 900 },
    supports: {
      floor: support("floor-a"),
      wall_back: support("back-a"),
      wall_left: support("left-a", false),
      wall_right: support("right-a", false),
      ceiling: support("ceiling-a"),
    },
    attachment: {
      mode: "detached",
      supportKind: null,
      bindingCurrent: false,
      bindingKey: null,
      transformValid: false,
      contactDistanceToPlane: null,
      orientationDeterminant: null,
      blockers: [],
    },
    model: { boundsAvailable: true, boundsValid: true, boundsKey: "bounds-a" },
    refusalCapabilities: {
      unusableSupportGuard: true,
      staleBindingGuard: true,
      finiteBoundaryGuard: true,
      cameraRevertGuard: true,
      modelMutationLockGuard: true,
    },
  };
  return {
    ...base,
    ...overrides,
    supports: { ...base.supports, ...overrides.supports },
    imageBasis: { ...base.imageBasis, ...overrides.imageBasis },
    camera: { ...base.camera, ...overrides.camera },
    attachment: { ...base.attachment, ...overrides.attachment },
    model: { ...base.model, ...overrides.model },
    refusalCapabilities: { ...base.refusalCapabilities, ...overrides.refusalCapabilities },
  };
}

function provenance(
  supportKind: MilestoneSupportKind,
  contactProfileKey: ObservationAttachmentProvenance["contactProfileKey"] =
    supportKind === "floor"
      ? "floor:local_y:min"
      : supportKind === "ceiling"
        ? "ceiling:local_y:max"
        : "wall:local_z:min",
  binding = `${supportKind}-binding-a`
): ObservationAttachmentProvenance {
  return { supportKind, attachmentBindingKey: binding, contactProfileKey };
}

function cache(): ValidationAttachmentProvenanceBySupport {
  return {
    floor: provenance("floor"),
    wall_back: provenance("wall_back"),
    ceiling: provenance("ceiling"),
  };
}

function observationContext(
  machineFacts: MilestoneMachineFacts,
  scenario: MilestoneObservationScenario,
  supportKind: MilestoneSupportKind | null,
  attachmentProvenance: ObservationAttachmentProvenance | null
): string {
  const key = buildObservationContextKey({
    facts: machineFacts,
    scenario,
    observedSupportKind: supportKind,
    attachmentProvenance,
  });
  assert.notEqual(key, null);
  return key!;
}

function record(
  observations: MilestoneOperatorObservations,
  machineFacts: MilestoneMachineFacts,
  scenario: MilestoneObservationScenario,
  supportKind: MilestoneSupportKind | null,
  attachmentProvenance: ObservationAttachmentProvenance | null,
  status: "passed" | "failed" = "passed"
) {
  observations[scenario] = recordOperatorObservation({
    previous: observations[scenario],
    status,
    notes: `${scenario} checked`,
    contextKey: observationContext(machineFacts, scenario, supportKind, attachmentProvenance),
    observedAtIso: "2026-07-11T10:01:00.000Z",
    supportKind,
    wallKind:
      supportKind === "wall_back" || supportKind === "wall_left" || supportKind === "wall_right"
        ? supportKind
        : null,
    attachmentProvenance,
  });
}

function allPassed(machineFacts: MilestoneMachineFacts, provenanceBySupport = cache()): MilestoneOperatorObservations {
  const observations = createEmptyOperatorObservations();
  record(observations, machineFacts, "floor_visual_placement", "floor", provenanceBySupport.floor!);
  record(observations, machineFacts, "wall_visual_placement", "wall_back", provenanceBySupport.wall_back!);
  record(observations, machineFacts, "ceiling_visual_placement", "ceiling", provenanceBySupport.ceiling!);
  record(observations, machineFacts, "boundary_refusal", "floor", provenanceBySupport.floor!);
  record(observations, machineFacts, "stale_frozen_lifecycle", "floor", provenanceBySupport.floor!);
  record(observations, machineFacts, "support_independence", null, null);
  record(observations, machineFacts, "model_lock_refusal", "floor", provenanceBySupport.floor!);
  return observations;
}

test("machine readiness preserves deterministic camera, model, and wall blockers", () => {
  assert.deepEqual(
    evaluateCameraFoundation(
      facts({
        imageBasis: { qualified: false, basisId: null, basisFingerprint: null },
        camera: { active: false, stale: true, appliedAtIso: null, frameWidth: 0, frameHeight: null },
      })
    ).blockers,
    ["milestone_image_basis_unqualified", "milestone_camera_inactive", "milestone_camera_stale", "milestone_frame_invalid"]
  );
  assert.deepEqual(
    evaluateFloorDemo(facts({ model: { boundsAvailable: false, boundsValid: false, boundsKey: null } })).blockers,
    ["milestone_model_bounds_unavailable"]
  );
  assert.equal(
    evaluateWallDemo(facts({ supports: { wall_back: support("back-a", false), wall_left: support("left-a"), wall_right: support("right-a", false) } })).machineReady,
    true
  );
});

test("floor, ceiling, and alternate visible walls retain their existing readiness coverage", () => {
  assert.deepEqual(
    evaluateFloorDemo(facts({ supports: { floor: support("floor-a", false) } })).blockers,
    ["milestone_floor_unusable"]
  );
  assert.equal(
    evaluateWallDemo(facts({ supports: { wall_back: support("back-a", false), wall_left: support("left-a", false), wall_right: support("right-a") } })).machineReady,
    true
  );
  assert.equal(
    evaluateWallDemo(facts({ supports: { wall_left: support("left-a"), wall_right: support("right-a") } })).machineReady,
    true
  );
});

test("machine ready remains distinct from missing, in-progress, failed, and passed observations", () => {
  const machineFacts = facts();
  const provenanceBySupport = cache();
  const observations = createEmptyOperatorObservations();
  assert.equal(evaluateCoreMilestone({ facts: machineFacts, observations, provenanceBySupport }).state, "ready_for_operator_validation");
  record(observations, machineFacts, "floor_visual_placement", "floor", provenanceBySupport.floor!);
  assert.equal(evaluateCoreMilestone({ facts: machineFacts, observations, provenanceBySupport }).state, "operator_validation_in_progress");
  const passed = allPassed(machineFacts, provenanceBySupport);
  assert.equal(evaluateCoreMilestone({ facts: machineFacts, observations: passed, provenanceBySupport }).state, "operator_passed");
  passed.wall_visual_placement = { ...passed.wall_visual_placement, status: "failed" };
  assert.equal(evaluateCoreMilestone({ facts: machineFacts, observations: passed, provenanceBySupport }).state, "operator_failed");
});

test("sequential Floor, wall, and Ceiling validation keeps completed support observations current", () => {
  const machineFacts = facts();
  const provenanceBySupport = cache();
  const observations = createEmptyOperatorObservations();
  record(observations, machineFacts, "floor_visual_placement", "floor", provenanceBySupport.floor!);
  let currentness = withObservationCurrentness(observations, { ...machineFacts, attachment: { ...machineFacts.attachment, supportKind: "wall_back", bindingKey: "wall_back-binding-a" } }, provenanceBySupport);
  assert.equal(currentness.floor_visual_placement.current, true);
  record(observations, machineFacts, "wall_visual_placement", "wall_back", provenanceBySupport.wall_back!);
  currentness = withObservationCurrentness(observations, { ...machineFacts, attachment: { ...machineFacts.attachment, supportKind: "ceiling", bindingKey: "ceiling-binding-a" } }, provenanceBySupport);
  assert.equal(currentness.floor_visual_placement.current, true);
  assert.equal(currentness.wall_visual_placement.current, true);
});

test("wall contact-face provenance stales only the observed wall and prevents a passed core", () => {
  const machineFacts = facts();
  const provenanceBySupport = cache();
  const observations = allPassed(machineFacts, provenanceBySupport);
  provenanceBySupport.wall_back = provenance("wall_back", "wall:local_z:max");
  const currentness = withObservationCurrentness(observations, machineFacts, provenanceBySupport);
  assert.equal(currentness.wall_visual_placement.stale, true);
  assert.equal(currentness.floor_visual_placement.current, true);
  assert.equal(currentness.ceiling_visual_placement.current, true);
  assert.equal(evaluateCoreMilestone({ facts: machineFacts, observations, provenanceBySupport }).state, "operator_observations_stale");
});

test("ceiling contact-face provenance stales only Ceiling and prevents a passed core", () => {
  const machineFacts = facts();
  const provenanceBySupport = cache();
  const observations = allPassed(machineFacts, provenanceBySupport);
  provenanceBySupport.ceiling = provenance("ceiling", "ceiling:local_y:min");
  const currentness = withObservationCurrentness(observations, machineFacts, provenanceBySupport);
  assert.equal(currentness.ceiling_visual_placement.stale, true);
  assert.equal(currentness.floor_visual_placement.current, true);
  assert.equal(currentness.wall_visual_placement.current, true);
  assert.equal(evaluateCoreMilestone({ facts: machineFacts, observations, provenanceBySupport }).state, "operator_observations_stale");
});

test("re-recording an observation with new contact provenance restores only that observation", () => {
  const machineFacts = facts();
  const provenanceBySupport = cache();
  const observations = allPassed(machineFacts, provenanceBySupport);
  provenanceBySupport.wall_back = provenance("wall_back", "wall:local_z:max");
  record(observations, machineFacts, "wall_visual_placement", "wall_back", provenanceBySupport.wall_back!);
  const currentness = withObservationCurrentness(observations, machineFacts, provenanceBySupport);
  assert.equal(currentness.wall_visual_placement.current, true);
  assert.equal(currentness.floor_visual_placement.current, true);
  assert.equal(evaluateCoreMilestone({ facts: machineFacts, observations, provenanceBySupport }).state, "operator_passed");
});

test("binding provenance changes stale only observations for the affected support", () => {
  const machineFacts = facts();
  const provenanceBySupport = cache();
  const observations = allPassed(machineFacts, provenanceBySupport);
  provenanceBySupport.wall_back = provenance("wall_back", "wall:local_z:min", "wall_back-binding-b");
  const currentness = withObservationCurrentness(observations, machineFacts, provenanceBySupport);
  assert.equal(currentness.wall_visual_placement.stale, true);
  assert.equal(currentness.floor_visual_placement.current, true);
  assert.equal(currentness.ceiling_visual_placement.current, true);
});

test("scenario context is stable for identical provenance and excludes transient selection", () => {
  const machineFacts = facts();
  const floor = provenance("floor");
  const key = observationContext(machineFacts, "floor_visual_placement", "floor", floor);
  assert.equal(key, observationContext(machineFacts, "floor_visual_placement", "floor", floor));
  const observations = allPassed(machineFacts);
  const currentness = withObservationCurrentness(
    observations,
    { ...machineFacts, attachment: { ...machineFacts.attachment, supportKind: "wall_back", bindingKey: "future-target-only" } },
    cache()
  );
  assert.equal(currentness.floor_visual_placement.current, true);
});

test("attachment-dependent recording has no broad-context fallback when provenance is absent", () => {
  const machineFacts = facts();
  assert.equal(
    buildObservationContextKey({
      facts: machineFacts,
      scenario: "wall_visual_placement",
      observedSupportKind: "wall_back",
      attachmentProvenance: null,
    }),
    null
  );
  assert.notEqual(
    buildObservationContextKey({
      facts: machineFacts,
      scenario: "support_independence",
      observedSupportKind: null,
      attachmentProvenance: null,
    }),
    null
  );
});

test("broad material changes preserve history but mark observations stale", () => {
  const machineFacts = facts();
  const provenanceBySupport = cache();
  const observations = allPassed(machineFacts, provenanceBySupport);
  const changed = facts({ camera: { appliedAtIso: "2026-07-11T10:05:00.000Z" } });
  const currentness = withObservationCurrentness(observations, changed, provenanceBySupport);
  assert.equal(currentness.floor_visual_placement.status, "passed");
  assert.equal(currentness.floor_visual_placement.stale, true);
});

test("report exposes attachment provenance, exact contact faces, and the future-room disclaimer", () => {
  const machineFacts = facts();
  const provenanceBySupport = cache();
  const report = buildVisibleRoomMilestoneReport({
    facts: machineFacts,
    observations: allPassed(machineFacts, provenanceBySupport),
    provenanceBySupport,
    generatedAtIso: "2026-07-11T10:20:00.000Z",
  });
  assert.equal(report.currentMilestoneResult, "operator_passed");
  assert.deepEqual(report.operatorObservations.wall_visual_placement.attachmentProvenance, provenanceBySupport.wall_back);
  assert.equal(report.operatorObservations.ceiling_visual_placement.attachmentProvenance?.contactProfileKey, "ceiling:local_y:max");
  assert.equal(report.disclaimers.length, 8);
  assert.match(report.disclaimers[7], /future room photo/);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test("report is stale after an unobserved contact-face change", () => {
  const machineFacts = facts();
  const provenanceBySupport = cache();
  const observations = allPassed(machineFacts, provenanceBySupport);
  provenanceBySupport.wall_back = provenance("wall_back", "wall:local_z:max");
  assert.equal(
    buildVisibleRoomMilestoneReport({
      facts: machineFacts,
      observations,
      provenanceBySupport,
      generatedAtIso: "2026-07-11T10:22:00.000Z",
    }).currentMilestoneResult,
    "operator_observations_stale"
  );
});

test("validation context retains broad material identity and blocker descriptions remain complete", () => {
  const machineFacts = facts();
  assert.notEqual(buildValidationContextKey(machineFacts), buildValidationContextKey(facts({ model: { boundsKey: "bounds-b" } })));
  assert.deepEqual(
    evaluateRefusalDemo(facts({ refusalCapabilities: { finiteBoundaryGuard: false } })).blockers,
    ["milestone_refusal_boundary_unavailable"]
  );
  for (const code of Object.keys(MILESTONE_BLOCKER_DESCRIPTIONS)) assert.ok(describeMilestoneBlocker(code).length > 0);
  assert.match(describeMilestoneBlocker("unknown"), /unavailable or blocked/);
});

test("current attachment diagnostics still expose named failure blockers", () => {
  const result = evaluateFloorDemo(facts({ model: { boundsAvailable: true, boundsValid: false, boundsKey: null } }));
  assert.deepEqual(result.blockers, ["milestone_model_bounds_invalid"]);
});
