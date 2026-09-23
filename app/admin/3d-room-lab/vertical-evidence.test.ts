import assert from "node:assert/strict";
import test from "node:test";
import type { StructuralVerticalObservation } from "./projection-coherence-diagnostics";
import {
  VERTICAL_EVIDENCE_MODEL_VERSION,
  buildVerticalEvidenceSuggestionId,
  deriveFrozenVerticalEvidenceAnchor,
  deriveVerticalEvidenceCollectionRuntime,
  deriveVerticalEvidenceSuggestions,
  evaluateVerticalEvidenceObservation,
  materializeVerticalEvidenceObservation,
  parseVerticalEvidenceSection,
  serializeVerticalEvidenceSection,
  type VerticalEvidenceSuggestion,
} from "./vertical-evidence";
import type { WallPolygon } from "./wall-support-geometry";

const basis = {
  basisId: "basis-a",
  basisFingerprint: "fingerprint-a",
  sourceImageUrl: "https://example.test/a.jpg",
  decodedWidth: 1600,
  decodedHeight: 1200,
  encodedOrientation: 1,
  decodedOrientationNormal: true as const,
  orientationTransform: "identity" as const,
  dimensionSource: "server" as const,
  coordinateSpaceVersion: {
    decoderId: "sharp-metadata/v1",
    normalizationPolicyVersion: "orientation-normal/v1",
    orientationApplied: false,
  },
  basisKind: "original" as const,
};

const floor = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.8, y: 0.2 },
  { x: 0.2, y: 0.2 },
] as const;
const wall: WallPolygon = [
  { x: 0.2, y: 0.8 },
  { x: 0.7, y: 0.8 },
  { x: 0.7, y: 0.2 },
  { x: 0.2, y: 0.2 },
];
const leftWall: WallPolygon = [
  { x: 0.1, y: 0.9 },
  { x: 0.2, y: 0.8 },
  { x: 0.2, y: 0.2 },
  { x: 0.1, y: 0.1 },
];

function edge(overrides: Partial<StructuralVerticalObservation> = {}): StructuralVerticalObservation {
  return {
    wallKind: "wall_back",
    sideIndex: 0,
    physicalVerticalId: "back_left",
    sourceNormalizedEndpoints: { lower: { x: 0.2, y: 0.8 }, upper: { x: 0.2, y: 0.2 } },
    sourcePixelEndpoints: { lower: { x: 320, y: 960 }, upper: { x: 320, y: 240 } },
    sourcePixelLength: 720,
    observedTiltDeg: 0,
    lowerWorldPoint: { x: -1, y: 0, z: 1 },
    predictedWorldUpTiltDeg: 0,
    locationMatchedResidualDeg: 0.25,
    reviewState: "manually_confirmed",
    runtimeUsable: true,
    confirmationCurrent: true,
    wallGeometryPolicyVersion: "wall-support-geometry-policy/v1",
    inclusion: "included",
    exclusionReason: null,
    frameTouching: false,
    frameCoincident: false,
    ...overrides,
  };
}

function suggestions(walls = [{ kind: "wall_back" as const, polygon: wall, derivationOk: true, runtimeUsable: true }]) {
  return deriveVerticalEvidenceSuggestions({
    imageBasis: basis,
    intrinsicWidth: 1600,
    intrinsicHeight: 1200,
    walls,
    structuralObservations: [edge()],
  });
}

function materialize(suggestion = suggestions()[0], decision: "selected" | "excluded" = "selected") {
  assert.ok(suggestion);
  const result = materializeVerticalEvidenceObservation({
    suggestion,
    operatorDecision: decision,
    decisionAtIso: "2026-07-19T12:00:00.000Z",
    floor: {
      sourceNormalizedPolygon: floor,
      polygonKey: "floor-a",
      worldWidth: 4,
      worldDepth: 3,
    },
    historicalContext: {
      nonBinding: true,
      cameraVersion: "calibrated-camera/v2",
      cameraAppliedAtIso: "2026-07-19T11:00:00.000Z",
      frameWidth: 800,
      frameHeight: 600,
    },
  });
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.observation;
}

function context(overrides: Partial<Parameters<typeof evaluateVerticalEvidenceObservation>[1]> = {}) {
  return {
    imageBasis: basis,
    intrinsicWidth: 1600,
    intrinsicHeight: 1200,
    floor: { polygonKey: "floor-a", worldWidth: 4, worldDepth: 3 },
    walls: { wall_back: wall, wall_left: null, wall_right: null },
    ...overrides,
  };
}

test("suggestion identity is deterministic and no observation exists before a decision", () => {
  const suggestion = suggestions()[0];
  assert.ok(suggestion);
  assert.deepEqual(suggestions(), suggestions());
  assert.equal(suggestions().length, 1);
  const id = suggestion.suggestionId;
  const identity = (overrides: Partial<Parameters<typeof buildVerticalEvidenceSuggestionId>[0]>) =>
    buildVerticalEvidenceSuggestionId({
      imageBasisId: suggestion.imageBasisId,
      imageBasisFingerprint: suggestion.imageBasisFingerprint,
      wallKind: suggestion.wallKind,
      wallPolygonKey: suggestion.wallPolygonKey,
      physicalVerticalId: suggestion.physicalVerticalId,
      sourceNormalizedEndpoints: suggestion.sourceNormalizedEndpoints,
      ...overrides,
    });
  assert.notEqual(identity({ imageBasisId: "basis-b" }), id);
  assert.notEqual(identity({ imageBasisFingerprint: "fingerprint-b" }), id);
  assert.notEqual(identity({ wallKind: "wall_left" }), id);
  assert.notEqual(identity({ wallPolygonKey: "replacement-wall" }), id);
  assert.notEqual(identity({ physicalVerticalId: "back_right" }), id);
  assert.notEqual(identity({
    sourceNormalizedEndpoints: {
      lower: { x: 0.21, y: 0.8 },
      upper: { x: 0.2, y: 0.2 },
    },
  }), id);
  assert.notEqual(identity({ suggestionGeneratorVersion: "wall-edge-suggestions/v2" }), id);
  assert.equal(serializeVerticalEvidenceSection(null), undefined);
});

test("selection and exclusion materialize immutable source provenance only on operator action", () => {
  const selected = materialize();
  const excluded = materialize(suggestions()[0], "excluded");
  assert.equal(selected.operatorDecision, "selected");
  assert.equal(excluded.operatorDecision, "excluded");
  assert.equal(selected.evidenceModelVersion, VERTICAL_EVIDENCE_MODEL_VERSION);
  assert.deepEqual(selected.sourceNormalizedEndpoints, suggestions()[0].sourceNormalizedEndpoints);
  assert.equal(selected.historicalContext.nonBinding, true);
});

test("historical camera and frame context are non-binding after materialization", () => {
  const observation = materialize();
  const reappliedObservation = {
    ...observation,
    historicalContext: {
      ...observation.historicalContext,
      cameraAppliedAtIso: "2026-07-19T13:00:00.000Z",
      frameWidth: 1280,
      frameHeight: 720,
    },
  };
  const original = evaluateVerticalEvidenceObservation(observation, context());
  const reapplied = evaluateVerticalEvidenceObservation(reappliedObservation, context());
  assert.equal(original.usability, "current");
  assert.equal(reapplied.usability, "current");
  assert.equal(original.eligible, true);
  assert.equal(reapplied.eligible, true);
  assert.equal(reapplied.observation.operatorDecision, "selected");
  assert.deepEqual(reapplied.observation.sourceNormalizedEndpoints, observation.sourceNormalizedEndpoints);
  assert.deepEqual(reapplied.observation.frozenWorldAnchor, observation.frozenWorldAnchor);
});

test("later wall refusal removes new suggestions but preserves captured evidence", () => {
  const admitted = suggestions();
  assert.equal(admitted.length, 1);
  const observation = materialize(admitted[0]);
  const refused = deriveVerticalEvidenceSuggestions({
    imageBasis: basis,
    intrinsicWidth: 1600,
    intrinsicHeight: 1200,
    walls: [{ kind: "wall_back", polygon: wall, derivationOk: false, runtimeUsable: false }],
    structuralObservations: [edge()],
  });
  assert.deepEqual(refused, []);
  const persisted = evaluateVerticalEvidenceObservation(observation, context());
  assert.equal(persisted.usability, "current");
  assert.equal(persisted.eligible, true);
  assert.equal(persisted.observation.operatorDecision, "selected");
});

test("basis changes stale evidence while display resize has no anchor or usability input", () => {
  const observation = materialize();
  assert.equal(evaluateVerticalEvidenceObservation(observation, context()).usability, "current");
  assert.equal(evaluateVerticalEvidenceObservation(observation, context({
    imageBasis: { ...basis, basisFingerprint: "other" },
  })).usability, "stale");
  const one = deriveFrozenVerticalEvidenceAnchor({
    sourceNormalizedFloorPolygon: floor,
    intrinsicWidth: 1600,
    intrinsicHeight: 1200,
    worldWidth: 4,
    worldDepth: 3,
    lowerSourceNormalizedEndpoint: observation.sourceNormalizedEndpoints.lower,
  });
  const two = deriveFrozenVerticalEvidenceAnchor({
    sourceNormalizedFloorPolygon: floor,
    intrinsicWidth: 1600,
    intrinsicHeight: 1200,
    worldWidth: 4,
    worldDepth: 3,
    lowerSourceNormalizedEndpoint: observation.sourceNormalizedEndpoints.lower,
  });
  assert.deepEqual(one, two, "display frame is absent from the canonical source-space anchor path");
});

test("Floor and wall source changes require review without mutating observations", () => {
  const observation = materialize();
  assert.equal(evaluateVerticalEvidenceObservation(observation, context({
    floor: { polygonKey: "replacement", worldWidth: 4, worldDepth: 3 },
  })).usability, "needs_review");
  assert.equal(evaluateVerticalEvidenceObservation(observation, context({
    walls: {
      wall_back: [{ ...wall[0] }, { ...wall[1] }, { ...wall[2] }, { x: 0.21, y: 0.2 }],
      wall_left: null,
      wall_right: null,
    },
  })).usability, "needs_review");
  assert.equal(observation.operatorDecision, "selected");
});

test("refused walls produce no suggestion and malformed segments are hard rejected", () => {
  assert.equal(suggestions([{ kind: "wall_back", polygon: wall, derivationOk: false, runtimeUsable: false }]).length, 0);
  const base = suggestions()[0];
  assert.ok(base);
  const coincident: VerticalEvidenceSuggestion = {
    ...base,
    sourceNormalizedEndpoints: { lower: { x: 0, y: 0.8 }, upper: { x: 0, y: 0.2 } },
  };
  // Use a fresh canonical identity so the materialization helper remains strict.
  const coincidentResult = materializeVerticalEvidenceObservation({
    suggestion: {
      ...coincident,
      suggestionId: "vertical-evidence-suggestion:wall-edge-suggestions/v1:basis-a:fingerprint-a:wall_back:test:back_left:0.00000000,0.80000000,0.00000000,0.20000000",
      wallPolygonKey: "test",
    },
    operatorDecision: "selected",
    decisionAtIso: "2026-07-19T12:00:00.000Z",
    floor: { sourceNormalizedPolygon: floor, polygonKey: "floor-a", worldWidth: 4, worldDepth: 3 },
    historicalContext: { nonBinding: true, cameraVersion: null, cameraAppliedAtIso: null, frameWidth: null, frameHeight: null },
  });
  assert.ok(coincidentResult.ok, coincidentResult.ok ? "" : coincidentResult.reason);
  assert.equal(evaluateVerticalEvidenceObservation(coincidentResult.observation, context()).usability, "hard_rejected");
  const degenerate = {
    ...coincidentResult.observation,
    sourceNormalizedEndpoints: { lower: { x: 0.4, y: 0.4 }, upper: { x: 0.4, y: 0.4 } },
  };
  assert.equal(evaluateVerticalEvidenceObservation(degenerate, context()).usability, "hard_rejected");
});

test("groups exact duplicates by physical vertical and only reports insufficient or unclassified", () => {
  const one = materialize();
  const two = { ...one, observationId: `${one.observationId}:duplicate`, suggestionSourceId: `${one.suggestionSourceId}:duplicate` };
  // A duplicate is constructed as imported/runtime data here; it is intentionally
  // not reserialized because the strict parser rejects forged identities.
  const runtime = deriveVerticalEvidenceCollectionRuntime({
    section: { evidenceModelVersion: VERTICAL_EVIDENCE_MODEL_VERSION, observations: [one, two] },
    context: context(),
    suggestions: [],
    structuralObservations: [edge()],
  });
  assert.equal(runtime.metrics.distinctPhysicalVerticalCount, 1);
  assert.equal(runtime.metrics.observationsPerPhysicalVertical[0].observationIds.length, 2);
  assert.equal(runtime.assessment, "insufficient");
  assert.notEqual(runtime.assessment, "coherent");
});

test("Floor quadrant occupancy tolerates homography roundoff but rejects material out-of-bounds anchors", () => {
  const base = materialize();
  const observation = (index: number, anchor: { x: number; y: 0; z: number }) => ({
    ...base,
    observationId: `${base.observationId}:quadrant-${index}`,
    frozenWorldAnchor: anchor,
    floorProvenance: { ...base.floorProvenance, worldWidth: 4, worldDepth: 4 },
  });
  const observations = [
    observation(0, { x: -2, y: 0, z: -2 }),
    observation(1, { x: 2, y: 0, z: -2 }),
    observation(2, { x: 2.0000000000000013, y: 0, z: -2.0000000000000013 }),
    observation(3, { x: 0, y: 0, z: 0 }),
    observation(4, { x: -1e-8, y: 0, z: 1e-8 }),
    observation(5, { x: 2, y: 0, z: -2 }),
    observation(6, { x: 2.00001, y: 0, z: -2 }),
  ];
  const runtime = deriveVerticalEvidenceCollectionRuntime({
    section: { evidenceModelVersion: VERTICAL_EVIDENCE_MODEL_VERSION, observations },
    context: context({ floor: { polygonKey: "floor-a", worldWidth: 4, worldDepth: 4 } }),
    suggestions: [],
    structuralObservations: [edge()],
  });
  assert.deepEqual(runtime.metrics.floorQuadrantOccupancy, {
    near_left: 1,
    near_right: 1,
    far_left: 1,
    far_right: 3,
    outside_or_unavailable: 1,
  });
});

test("cross-wall shared corners group by physical vertical without collapsing observations", () => {
  const structuralObservations = [
    edge(),
    edge({
      wallKind: "wall_left",
      sideIndex: 1,
      physicalVerticalId: "back_left",
      sourceNormalizedEndpoints: { lower: { x: 0.2, y: 0.8 }, upper: { x: 0.2, y: 0.2 } },
    }),
    edge({
      sideIndex: 1,
      physicalVerticalId: "back_right",
      sourceNormalizedEndpoints: { lower: { x: 0.7, y: 0.8 }, upper: { x: 0.7, y: 0.2 } },
    }),
  ];
  const sharedSuggestions = deriveVerticalEvidenceSuggestions({
    imageBasis: basis,
    intrinsicWidth: 1600,
    intrinsicHeight: 1200,
    walls: [
      { kind: "wall_back", polygon: wall, derivationOk: true, runtimeUsable: true },
      { kind: "wall_left", polygon: leftWall, derivationOk: true, runtimeUsable: true },
    ],
    structuralObservations,
  });
  assert.equal(sharedSuggestions.length, 3);
  const observations = sharedSuggestions.map((suggestion) => materialize(suggestion));
  assert.equal(new Set(observations.map((observation) => observation.observationId)).size, 3);
  const runtime = deriveVerticalEvidenceCollectionRuntime({
    section: { evidenceModelVersion: VERTICAL_EVIDENCE_MODEL_VERSION, observations },
    context: context({ walls: { wall_back: wall, wall_left: leftWall, wall_right: null } }),
    suggestions: sharedSuggestions,
    structuralObservations,
  });
  const backLeft = runtime.metrics.observationsPerPhysicalVertical.find((group) => group.physicalVerticalId === "back_left");
  const backRight = runtime.metrics.observationsPerPhysicalVertical.find((group) => group.physicalVerticalId === "back_right");
  assert.equal(backLeft?.observationIds.length, 2);
  assert.equal(backRight?.observationIds.length, 1);
  assert.equal(runtime.metrics.distinctPhysicalVerticalCount, 2);
  assert.equal(runtime.observations.length, 3, "individual raw observations remain inspectable");
});

test("a non-finite in-memory frozen anchor cannot contribute to collection eligibility", () => {
  const observation = {
    ...materialize(),
    frozenWorldAnchor: { x: Number.NaN, y: 0 as const, z: 0 },
  };
  const runtime = deriveVerticalEvidenceCollectionRuntime({
    section: { evidenceModelVersion: VERTICAL_EVIDENCE_MODEL_VERSION, observations: [observation] },
    context: context(),
    suggestions: [],
    structuralObservations: [edge()],
  });
  assert.equal(runtime.observations[0].usability, "hard_rejected");
  assert.equal(runtime.observations[0].eligible, false);
  assert.equal(runtime.assessment, "insufficient");
});

test("vertical evidence serializes canonically and malformed imports degrade fail-closed", () => {
  const section = { evidenceModelVersion: VERTICAL_EVIDENCE_MODEL_VERSION, observations: [materialize()] } as const;
  const serialized = serializeVerticalEvidenceSection(section);
  assert.ok(serialized);
  const parsed = parseVerticalEvidenceSection(serialized);
  assert.equal(parsed.kind, "valid");
  assert.deepEqual(parsed.kind === "valid" ? parsed.value : null, serialized);
  const malformed = structuredClone(serialized) as unknown as { observations: Array<{ frozenWorldAnchor: { x: number } }> };
  malformed.observations[0].frozenWorldAnchor.x = Number.NaN;
  assert.equal(parseVerticalEvidenceSection(malformed).kind, "degraded");
  const payload = JSON.stringify(serialized);
  assert.equal(payload.includes("candidate"), false);
  assert.equal(payload.includes("boundaryWorld"), false);
  assert.equal(payload.includes("\"pose\""), false);
});
