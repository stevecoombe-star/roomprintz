import assert from "node:assert/strict";
import test from "node:test";
import {
  LEGACY_SCENE_STATE_SCHEMA_VERSION,
  SCENE_STATE_SCHEMA_VERSION,
  SCENE_STATE_SCHEMA_VERSION_V2,
  buildSceneStatePayload,
  validateImportedSceneJson,
  type SceneStatePayloadInput,
} from "./scene-state";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
} from "./calibrated-camera-restore-authority";
import { createWallConfirmationStamp } from "./wall-support-geometry";
import {
  buildVerticalEvidenceSuggestionId,
  materializeVerticalEvidenceObservation,
  type VerticalEvidenceSuggestion,
} from "./vertical-evidence";

const limits = {
  transformLimits: {
    positionX: { min: -5, max: 5 },
    positionY: { min: -5, max: 5 },
    positionZ: { min: -10, max: 10 },
    rotationYDeg: { min: -180, max: 180 },
    uniformScale: { min: 0.1, max: 4 },
  },
  modelNormalizationLimits: {
    modelYOffset: { min: -5, max: 5 },
    modelYawOffsetDeg: { min: -180, max: 180 },
    modelScaleMultiplier: { min: 0.1, max: 4 },
  },
  floorMappingLimits: {
    worldWidth: { min: 0.1, max: 50 },
    worldDepth: { min: 0.1, max: 50 },
    depthCenterY: { min: -5, max: 5 },
  },
  perspectiveDepthScalingLimits: {
    nearScaleMultiplier: { min: 0.1, max: 4 },
    farScaleMultiplier: { min: 0.1, max: 4 },
    nearFloorY: { min: 0, max: 1 },
    farFloorY: { min: 0, max: 1 },
  },
  defaultModelNormalization: { modelYOffset: 0, modelYawOffsetDeg: 0, modelScaleMultiplier: 1 },
  defaultFloorMapping: { worldWidth: 6, worldDepth: 5, depthCenterY: 0.5 },
  defaultPerspectiveDepthScaling: {
    enabled: false,
    nearScaleMultiplier: 1,
    farScaleMultiplier: 1,
    nearFloorY: 0,
    farFloorY: 1,
  },
} as const;

const basis = {
  basisId: "basis-a",
  basisFingerprint: "fingerprint-a",
  sourceImageUrl: "https://example.test/room.jpg",
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
const quad: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }] = [
  { x: 0.123456789, y: 0.8 },
  { x: 0.9, y: 0.8 },
  { x: 0.8, y: 0.2 },
  { x: 0.2, y: 0.2 },
];

function payloadInput(): SceneStatePayloadInput {
  const wall = (kind: "wall_back" | "wall_left" | "wall_right") => ({
    draft: {
      kind,
      enabled: true,
      source: "manual" as const,
      imagePolygonSourceNorm: structuredClone(quad),
      reviewStatus: "manually_confirmed" as const,
      confirmationStamp: {
        wallPolygonKey: `${kind}-polygon`,
        imageBasisId: basis.basisId,
        imageBasisFingerprint: basis.basisFingerprint,
        cameraAppliedAtIso: "2026-07-14T00:00:00.000Z",
        frameWidth: 1600,
        frameHeight: 1200,
      },
    },
    supportImageBasis: structuredClone(basis),
  });
  return {
    exportedAtIso: "2026-07-14T00:00:00.000Z",
    roomImageUrl: basis.sourceImageUrl,
    modelPath: "/cube.glb",
    activeObjectType: "fallbackCube",
    glbLoadStatus: "fallback",
    modelNormalization: { modelYOffset: 0, modelYawOffsetDeg: 0, modelScaleMultiplier: 1 },
    transform: { positionX: 0, positionY: 0, positionZ: 0, rotationYDeg: 0, uniformScale: 1, autoRotate: false },
    floor: {
      polygon: structuredClone(quad),
      overlayVisible: true,
      placementModeEnabled: false,
      lastAcceptedClick: null,
      lastRejectedClick: null,
      mapping: { worldWidth: 6, worldDepth: 5, depthCenterY: 0.5 },
      perspectiveDepthScaling: { enabled: false, nearScaleMultiplier: 1, farScaleMultiplier: 1, nearFloorY: 0, farFloorY: 1 },
    },
    image: { intrinsicWidth: 1600, intrinsicHeight: 1200, coordinateSpace: "container-normalized-v0" },
    calibration: {
      calibrationVersion: "calibrated-camera/v2",
      solver: "homography-planar-cv/v1",
      intrinsics: { verticalFovDeg: 50 },
      source: {
        imageBasis: structuredClone(basis),
        sourceFloorPolygon: structuredClone(quad),
      },
    },
    calibrationAppliedAuthority: {
      authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
      appliedAtIso: "2026-07-14T00:00:00.000Z",
      verticalFovDeg: 50,
      frameSize: { width: 1600, height: 1200 },
      pose: {
        position: { x: 0, y: 5, z: 8 },
        lookAt: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      imageBasis: structuredClone(basis),
      sourceFloorPolygon: structuredClone(quad),
      floorMapping: { worldWidth: 6, worldDepth: 5 },
      calibrationVersion: CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
      solver: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
      diagnosticsSummary: "high confidence",
    },
    supports: {
      floor: {
        sourceNormalizedPolygon: structuredClone(quad),
        reviewStatus: "manually_confirmed",
        source: "manual",
        supportImageBasis: structuredClone(basis),
        authorityEligible: true,
      },
      walls: { wall_back: wall("wall_back"), wall_left: wall("wall_left"), wall_right: wall("wall_right") },
      ceiling: {
        draft: {
          enabled: true,
          source: "manual",
          imagePolygonSourceNorm: structuredClone(quad),
          roomHeight: 2.75,
          reviewStatus: "manually_confirmed",
          confirmationStamp: {
            ceilingPolygonKey: "ceiling-polygon",
            roomHeightKey: "2.750000",
            imageBasisId: basis.basisId,
            imageBasisFingerprint: basis.basisFingerprint,
            cameraAppliedAtIso: "2026-07-14T00:00:00.000Z",
            frameWidth: 1600,
            frameHeight: 1200,
          },
        },
        supportImageBasis: structuredClone(basis),
      },
    },
    attachment: {
      supportKind: "floor",
      supportBindingKey: "exact-floor-binding",
      localPosition: { u: 0, v: 0 },
      rotationAboutNormalDeg: 0,
      uniformScale: 1,
      contactProfile: { kind: "floor", contactAxis: "local_y", contactSide: "min" },
      attachedAtIso: "2026-07-14T00:00:00.000Z",
    },
    debug: { rendererSize: { width: 1600, height: 1200 }, imageStatus: "loaded", modelStatus: "fallback" },
  };
}

function build(input: SceneStatePayloadInput) {
  const result = buildSceneStatePayload(input);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.payload;
}

function payload() {
  return build(payloadInput());
}

function verticalEvidenceFixture() {
  const sourceNormalizedEndpoints = { lower: { x: 0.2, y: 0.8 }, upper: { x: 0.2, y: 0.2 } };
  const suggestion: VerticalEvidenceSuggestion = {
    suggestionId: buildVerticalEvidenceSuggestionId({
      imageBasisId: basis.basisId,
      imageBasisFingerprint: basis.basisFingerprint,
      wallKind: "wall_back",
      wallPolygonKey: "back-wall",
      physicalVerticalId: "back_left",
      sourceNormalizedEndpoints,
    }),
    imageBasisId: basis.basisId,
    imageBasisFingerprint: basis.basisFingerprint,
    intrinsicWidth: basis.decodedWidth,
    intrinsicHeight: basis.decodedHeight,
    wallKind: "wall_back",
    wallPolygonKey: "back-wall",
    physicalVerticalId: "back_left",
    sourceNormalizedEndpoints,
    suggestionGeneratorVersion: "wall-edge-suggestions/v1",
    sourceResidualDeg: null,
  };
  const materialized = materializeVerticalEvidenceObservation({
    suggestion,
    operatorDecision: "selected",
    decisionAtIso: "2026-07-14T00:00:00.000Z",
    floor: {
      sourceNormalizedPolygon: quad,
      polygonKey: "floor-a",
      worldWidth: 6,
      worldDepth: 5,
    },
    historicalContext: {
      nonBinding: true,
      cameraVersion: "calibrated-camera/v2",
      cameraAppliedAtIso: "2026-07-14T00:00:00.000Z",
      frameWidth: 1600,
      frameHeight: 1200,
    },
  });
  assert.ok(materialized.ok, materialized.ok ? "" : materialized.reason);
  return { evidenceModelVersion: "vertical-evidence-model/v1" as const, observations: [materialized.observation] };
}

type Payload = ReturnType<typeof payload>;

function parse(value: unknown) {
  const result = validateImportedSceneJson(value, limits);
  assert.notEqual(typeof result, "string", typeof result === "string" ? result : "");
  return result as Exclude<typeof result, string>;
}

for (const coordinate of [1.25, -0.25] as const) {
  test(`v0 calibration.source.sourceFloorPolygon ignores unit-external ${coordinate}`, () => {
    const value = payload();
    const legacyValue = value as unknown as Record<string, unknown>;
    legacyValue.schemaVersion = LEGACY_SCENE_STATE_SCHEMA_VERSION;
    delete legacyValue.supports;
    delete legacyValue.attachment;
    delete value.calibrationAppliedAuthority;
    value.calibration!.source.sourceFloorPolygon[0].x = coordinate;

    const result = validateImportedSceneJson(value, limits);
    assert.notEqual(typeof result, "string", String(result));
    if (typeof result === "string") return;
    assert.deepEqual(result.calibration, {
      kind: "ignored",
      reason: "calibration.source.sourceFloorPolygon must contain exactly four valid points.",
    });
  });

  test(`v1 supports.floor.sourceNormalizedPolygon rejects unit-external ${coordinate}`, () => {
    const value = payload();
    value.supports.floor.sourceNormalizedPolygon[0].x = coordinate;
    assert.match(
      validateImportedSceneJson(value, limits) as string,
      /^supports must contain valid source-normalized floor, wall, and ceiling authority\.$/
    );
  });

  test(`v1 calibration.source.sourceFloorPolygon ignores unit-external ${coordinate}`, () => {
    const value = payload();
    delete value.calibrationAppliedAuthority;
    value.calibration!.source.sourceFloorPolygon[0].x = coordinate;

    const result = validateImportedSceneJson(value, limits);
    assert.notEqual(typeof result, "string", String(result));
    if (typeof result === "string") return;
    assert.deepEqual(result.calibration, {
      kind: "ignored",
      reason: "calibration.source.sourceFloorPolygon must contain exactly four valid points.",
    });
  });

  test(`v1 calibrationAppliedAuthority.sourceFloorPolygon rejects unit-external ${coordinate}`, () => {
    const value = payload();
    value.calibrationAppliedAuthority!.sourceFloorPolygon[0].x = coordinate;
    assert.equal(
      validateImportedSceneJson(value, limits),
      "calibrationAppliedAuthority is malformed (source_floor_polygon)."
    );
  });
}

test("round-trips full operator-owned support source state", () => {
  const result = parse(payload());
  assert.deepEqual(
    result.floor.polygon,
    [
      { x: 0.123, y: 0.8 },
      { x: 0.9, y: 0.8 },
      { x: 0.8, y: 0.2 },
      { x: 0.2, y: 0.2 },
    ],
    "Floor [NL, NR, FR, FL] array positions are preserved through export/import"
  );
  assert.equal(result.supports?.floor.reviewStatus, "manually_confirmed");
  assert.deepEqual(result.supports?.walls.wall_back?.draft, payloadInput().supports.walls.wall_back?.draft);
  assert.deepEqual(result.supports?.walls.wall_left?.draft, payloadInput().supports.walls.wall_left?.draft);
  assert.deepEqual(result.supports?.walls.wall_right?.draft, payloadInput().supports.walls.wall_right?.draft);
  assert.deepEqual(result.supports?.ceiling?.draft, payloadInput().supports.ceiling?.draft);
});

test("round-trips optional vertical evidence and degrades malformed records fail-closed", () => {
  const input = payloadInput();
  input.verticalEvidence = verticalEvidenceFixture();
  const exported = build(input);
  const restored = parse(exported);
  assert.deepEqual(restored.verticalEvidence, input.verticalEvidence);
  assert.equal(restored.verticalEvidenceDegradationReason, null);

  const malformed = structuredClone(exported) as unknown as {
    verticalEvidence: { observations: Array<{ frozenWorldAnchor: { x: number } }> };
  };
  malformed.verticalEvidence!.observations[0].frozenWorldAnchor.x = Number.NaN;
  const degraded = parse(malformed);
  assert.equal(degraded.verticalEvidence, null);
  assert.match(degraded.verticalEvidenceDegradationReason ?? "", /malformed observation/);
});

test("vertical evidence import strips injected authority-like keys without affecting scene authority", () => {
  const input = payloadInput();
  input.verticalEvidence = verticalEvidenceFixture();
  const baseline = build(input);
  const injected = structuredClone(baseline) as unknown as {
    verticalEvidence: Record<string, unknown> & {
      observations: Array<Record<string, unknown> & {
        floorProvenance: Record<string, unknown>;
        sourceNormalizedEndpoints: Record<string, unknown>;
      }>;
    };
  };
  const authorityLikeKeys = [
    "pose",
    "candidate",
    "candidateCamera",
    "calibrationVersion",
    "applyCamera",
    "cameraAppliedAtIso",
    "authorityEligible",
    "calibrationAuthorityGranted",
  ] as const;
  for (const key of authorityLikeKeys) injected.verticalEvidence[key] = { injected: true };
  const observation = injected.verticalEvidence.observations[0];
  for (const key of authorityLikeKeys) observation[key] = { injected: true };
  observation.floorProvenance.authorityEligible = true;
  observation.floorProvenance.calibrationAuthorityGranted = true;
  observation.sourceNormalizedEndpoints.candidateCamera = { injected: true };

  const baselineParsed = parse(baseline);
  const injectedParsed = parse(injected);
  assert.deepEqual(injectedParsed.verticalEvidence, baselineParsed.verticalEvidence);
  assert.deepEqual(injectedParsed.calibration, baselineParsed.calibration);
  assert.deepEqual(injectedParsed.calibrationAppliedAuthority, baselineParsed.calibrationAppliedAuthority);
  assert.deepEqual(injectedParsed.supports, baselineParsed.supports);
  assert.deepEqual(injectedParsed.attachment, baselineParsed.attachment);
  assert.deepEqual(injectedParsed.floor, baselineParsed.floor);

  const parsedEvidence = injectedParsed.verticalEvidence!;
  const parsedObservation = parsedEvidence.observations[0] as unknown as Record<string, unknown> & {
    floorProvenance: Record<string, unknown>;
    sourceNormalizedEndpoints: Record<string, unknown>;
  };
  for (const key of authorityLikeKeys) {
    assert.equal(Object.hasOwn(parsedEvidence, key), false, `section excludes ${key}`);
    assert.equal(Object.hasOwn(parsedObservation, key), false, `observation excludes ${key}`);
  }
  assert.equal(Object.hasOwn(parsedObservation.floorProvenance, "authorityEligible"), false);
  assert.equal(Object.hasOwn(parsedObservation.floorProvenance, "calibrationAuthorityGranted"), false);
  assert.equal(Object.hasOwn(parsedObservation.sourceNormalizedEndpoints, "candidateCamera"), false);

  const reexported = build({ ...payloadInput(), verticalEvidence: injectedParsed.verticalEvidence });
  const serializedEvidence = JSON.stringify(reexported.verticalEvidence);
  for (const key of ["pose", "candidate", "candidateCamera", "calibrationVersion", "applyCamera", "authorityEligible", "calibrationAuthorityGranted"]) {
    assert.equal(serializedEvidence.includes(`"${key}"`), false, `re-export excludes ${key}`);
  }
});

test("round-trips a versioned wall policy stamp with deterministic field ordering", () => {
  const value = payload();
  const inputStamp = value.supports.walls.wall_back!.draft.confirmationStamp!;
  inputStamp.wallGeometryPolicyVersion = "wall-support-geometry-policy/v1";
  const result = parse(value);
  const parsedStamp = result.supports!.walls.wall_back!.draft.confirmationStamp!;
  const equivalentFreshStamp = {
    ...createWallConfirmationStamp(quad, basis, "2026-07-14T00:00:00.000Z", { width: 1600, height: 1200 }),
    wallPolygonKey: "wall_back-polygon",
  };
  assert.deepEqual(parsedStamp, inputStamp);
  assert.equal(JSON.stringify(parsedStamp), JSON.stringify(equivalentFreshStamp));

  const reexported = build({ ...payloadInput(), supports: result.supports! });
  assert.deepEqual(reexported.supports.walls.wall_back!.draft.confirmationStamp, inputStamp);
});

test("round-trips legacy wall stamps without synthesis or input mutation", () => {
  const value = payload();
  const original = structuredClone(value);
  const result = parse(value);
  const parsedStamp = result.supports!.walls.wall_back!.draft.confirmationStamp!;
  assert.deepEqual(value, original);
  assert.equal(Object.prototype.hasOwnProperty.call(parsedStamp, "wallGeometryPolicyVersion"), false);

  const reexported = build({ ...payloadInput(), supports: result.supports! });
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      reexported.supports.walls.wall_back!.draft.confirmationStamp!,
      "wallGeometryPolicyVersion"
    ),
    false
  );
});

test("preserves an unknown well-formed future wall policy string", () => {
  const value = payload();
  value.supports.walls.wall_back!.draft.confirmationStamp!.wallGeometryPolicyVersion =
    "wall-support-geometry-policy/v999";
  const result = parse(value);
  assert.equal(
    result.supports!.walls.wall_back!.draft.confirmationStamp!.wallGeometryPolicyVersion,
    "wall-support-geometry-policy/v999"
  );
  const reexported = build({ ...payloadInput(), supports: result.supports! });
  assert.equal(
    reexported.supports.walls.wall_back!.draft.confirmationStamp!.wallGeometryPolicyVersion,
    "wall-support-geometry-policy/v999"
  );
});

for (const [name, policyVersion] of [
  ["empty string", ""],
  ["whitespace-only string", " \t "],
  ["number", 1],
  ["null", null],
  ["object", {}],
] as const) {
  test(`rejects malformed wall geometry policy version: ${name}`, () => {
    const value = payload();
    (value.supports.walls.wall_back!.draft.confirmationStamp as unknown as Record<string, unknown>)
      .wallGeometryPolicyVersion = policyVersion;
    assert.match(validateImportedSceneJson(value, limits) as string, /supports/);
  });
}

test("keeps manually confirmed walls with a null stamp importable", () => {
  const value = payload();
  value.supports.walls.wall_back!.draft.confirmationStamp = null;
  const result = parse(value);
  assert.equal(result.supports!.walls.wall_back!.draft.reviewStatus, "manually_confirmed");
  assert.equal(result.supports!.walls.wall_back!.draft.confirmationStamp, null);
});

test("round-trips the complete applied authority without rounding source Floor authority", () => {
  const value = payload();
  const result = parse(value);
  assert.deepEqual(result.calibrationAppliedAuthority?.sourceFloorPolygon, payloadInput().supports.floor.sourceNormalizedPolygon);
  assert.equal(result.calibrationAppliedAuthority?.appliedAtIso, "2026-07-14T00:00:00.000Z");
  assert.deepEqual(value.calibration?.source.sourceFloorPolygon, payloadInput().supports.floor.sourceNormalizedPolygon);
  assert.deepEqual(value.calibrationAppliedAuthority?.sourceFloorPolygon, value.calibration?.source.sourceFloorPolygon);
});

test("accepts request-only v1 but keeps v0 authority-free", () => {
  const requestOnly = payload();
  delete requestOnly.calibrationAppliedAuthority;
  assert.equal(parse(requestOnly).calibrationAppliedAuthority, null);
  const legacy = requestOnly as Record<string, unknown>;
  legacy.schemaVersion = "vibode-3d-room-lab-scene-state/v0";
  delete legacy.supports;
  delete legacy.attachment;
  assert.equal(parse(legacy).calibrationAppliedAuthority, null);
});

test("rejects request-only v1 when calibration and support Floor authority disagree", () => {
  const value = payload();
  delete value.calibrationAppliedAuthority;
  value.calibration!.source.sourceFloorPolygon[0].x = 0.25;
  assert.match(validateImportedSceneJson(value, limits) as string, /contradicts supports/);
});

for (const [name, mutate] of [
  ["malformed authority", (value: Payload) => { (value.calibrationAppliedAuthority as { authorityVersion: string }).authorityVersion = "unknown"; }],
  ["non-finite authority pose", (value: Payload) => { value.calibrationAppliedAuthority!.pose.position.x = Infinity; }],
  ["contradictory source Floor polygon", (value: Payload) => { value.calibrationAppliedAuthority!.sourceFloorPolygon[0].x = 0.25; }],
  ["contradictory FOV", (value: Payload) => { value.calibrationAppliedAuthority!.verticalFovDeg = 51; }],
  ["contradictory calibration version", (value: Payload) => { (value.calibrationAppliedAuthority as { calibrationVersion: string }).calibrationVersion = "other"; }],
  ["contradictory solver", (value: Payload) => { (value.calibrationAppliedAuthority as { solver: string }).solver = "other"; }],
  ["contradictory basis", (value: Payload) => { value.calibrationAppliedAuthority!.imageBasis.basisFingerprint = "other"; }],
  ["contradictory world mapping", (value: Payload) => { value.calibrationAppliedAuthority!.floorMapping.worldWidth = 7; }],
] as const) {
  test(`rejects ${name} before import mutation`, () => {
    const value = payload();
    mutate(value);
    assert.equal(typeof validateImportedSceneJson(value, limits), "string");
  });
}

test("rejects malformed support basis and strict current-v1 timestamps", () => {
  const badBasis = payload();
  (badBasis.supports.floor.supportImageBasis as { basisKind: string }).basisKind = "invalid";
  assert.match(validateImportedSceneJson(badBasis, limits) as string, /supports/);

  const badWallStamp = payload();
  badWallStamp.supports.walls.wall_back!.draft.confirmationStamp!.cameraAppliedAtIso = "not-an-iso";
  assert.match(validateImportedSceneJson(badWallStamp, limits) as string, /supports/);

  const badAttachmentStamp = payload();
  badAttachmentStamp.attachment!.attachedAtIso = "not-an-iso";
  assert.match(validateImportedSceneJson(badAttachmentStamp, limits) as string, /attachment/);
});

test("preserves exact wall slot mapping", () => {
  const value = payload();
  value.supports.walls.wall_back!.draft.kind = "wall_left";
  assert.match(validateImportedSceneJson(value, limits) as string, /supports/);
});

test("preserves ceiling room height and stamp without regeneration", () => {
  const value = payload();
  value.supports.ceiling!.draft.roomHeight = 3.125;
  value.supports.ceiling!.draft.confirmationStamp!.roomHeightKey = "3.125000";
  const result = parse(value);
  assert.equal(result.supports?.ceiling?.draft.roomHeight, 3.125);
  assert.equal(result.supports?.ceiling?.draft.confirmationStamp?.roomHeightKey, "3.125000");
});

test("round-trips attachment exactly and supports detached scenes", () => {
  const attached = parse(payload());
  assert.deepEqual(attached.attachment, payloadInput().attachment);
  const detached = payload();
  detached.attachment = null;
  assert.equal(parse(detached).attachment, null);
});

test("round-trips wall and ceiling attachment records without rebinding", () => {
  const wall = payload();
  wall.attachment = {
    supportKind: "wall_left",
    supportBindingKey: "exact-wall-binding",
    localPosition: { u: 0.2, v: 0.3 },
    rotationAboutNormalDeg: 15,
    uniformScale: 1.25,
    contactProfile: { kind: "wall", contactAxis: "local_z", contactSide: "max" },
    attachedAtIso: "2026-07-14T00:00:00.000Z",
  };
  assert.deepEqual(parse(wall).attachment, wall.attachment);
  const ceiling = payload();
  ceiling.attachment = {
    supportKind: "ceiling",
    supportBindingKey: "exact-ceiling-binding",
    localPosition: { u: 0.4, v: 0.5 },
    rotationAboutNormalDeg: -30,
    uniformScale: 0.75,
    contactProfile: { kind: "ceiling", contactAxis: "local_y", contactSide: "max" },
    attachedAtIso: "2026-07-14T00:00:00.000Z",
  };
  assert.deepEqual(parse(ceiling).attachment, ceiling.attachment);
});

for (const [name, mutate] of [
  ["invalid support kind", (value: Payload) => { (value.attachment as { supportKind: string }).supportKind = "other"; }],
  ["non-finite anchor", (value: Payload) => { value.attachment!.localPosition.u = Infinity; }],
  ["invalid scale", (value: Payload) => { value.attachment!.uniformScale = 0; }],
  ["invalid contact profile", (value: Payload) => { value.attachment!.contactProfile = { kind: "wall", contactAxis: "local_z", contactSide: "min" }; }],
] as const) {
  test(`rejects malformed attachment: ${name}`, () => {
    const value = payload();
    mutate(value);
    assert.match(validateImportedSceneJson(value, limits) as string, /attachment/);
  });
}

for (const [name, mutate] of [
  ["wrong point count", (value: Payload) => { value.supports.walls.wall_back!.draft.imagePolygonSourceNorm!.pop(); }],
  ["non-finite point", (value: Payload) => { value.supports.walls.wall_back!.draft.imagePolygonSourceNorm![0].x = Infinity; }],
  ["bad enum", (value: Payload) => { (value.supports.walls.wall_back!.draft as { source: string }).source = "unknown"; }],
  ["invalid ceiling height", (value: Payload) => { value.supports.ceiling!.draft.roomHeight = 100; }],
  ["malformed stamp", (value: Payload) => { value.supports.ceiling!.draft.confirmationStamp!.frameWidth = 0; }],
] as const) {
  test(`rejects malformed support: ${name}`, () => {
    const value = payload();
    mutate(value);
    assert.match(validateImportedSceneJson(value, limits) as string, /supports/);
  });
}

test("loads legacy v0 scenes with absent supports and attachment", () => {
  const value = payload() as Record<string, unknown>;
  value.schemaVersion = "vibode-3d-room-lab-scene-state/v0";
  delete value.supports;
  delete value.attachment;
  const result = parse(value);
  assert.equal(result.supports, null);
  assert.equal(result.attachment, null);
});

test("does not serialize derived envelope or transient edit state", () => {
  const serialized = JSON.stringify(payload());
  for (const key of ["roomEnvelopeReconciliation", "residuals", "wireframe", "runtimeUsable", "blockingReasons", "gridPolylines", "plane", "boundaryWorld", "activeFocus", "dragTransaction", "selectedHandle", "undoSnapshot"]) {
    assert.equal(serialized.includes(`"${key}"`), false, key);
  }
});

test("is deterministic and does not mutate frozen input", () => {
  const input = payloadInput();
  const freeze = <T>(value: T): T => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value as Record<string, unknown>).forEach((child) => freeze(child));
    }
    return value;
  };
  freeze(input);
  assert.deepEqual(buildSceneStatePayload(input), buildSceneStatePayload(input));
});

test("exports the current schema version", () => {
  assert.equal(payload().schemaVersion, SCENE_STATE_SCHEMA_VERSION);
});

function setFloorSourceAuthority(
  input: SceneStatePayloadInput,
  sourcePolygon: typeof quad
): void {
  input.supports.floor.sourceNormalizedPolygon = structuredClone(sourcePolygon);
  input.calibration!.source.sourceFloorPolygon = structuredClone(sourcePolygon);
  input.calibrationAppliedAuthority!.sourceFloorPolygon = structuredClone(sourcePolygon);
}

test("v2 accepts the inclusive widened Floor source extent on both axes", () => {
  const input = payloadInput();
  const widenedQuad = [
    { x: -0.25, y: -0.25 },
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 1.25, y: 1.25 },
  ] as typeof quad;
  setFloorSourceAuthority(input, widenedQuad);

  const exported = build(input);
  assert.equal(exported.schemaVersion, SCENE_STATE_SCHEMA_VERSION_V2);
  const restored = parse(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(restored.supports?.floor.sourceNormalizedPolygon, widenedQuad);
  assert.deepEqual(restored.calibrationAppliedAuthority?.sourceFloorPolygon, widenedQuad);
});

for (const [axis, coordinate] of [
  ["x", -0.25000000000000006],
  ["x", 1.2500000000000002],
  ["y", -0.25000000000000006],
  ["y", 1.2500000000000002],
  ["x", Number.NaN],
  ["y", Number.POSITIVE_INFINITY],
  ["x", Number.NEGATIVE_INFINITY],
] as const) {
  test(`v2 rejects ${axis}=${String(coordinate)} outside its exact Floor extent`, () => {
    const value = payload();
    value.schemaVersion = SCENE_STATE_SCHEMA_VERSION_V2;
    value.supports.floor.sourceNormalizedPolygon[0][axis] = coordinate;
    assert.match(
      validateImportedSceneJson(value, limits) as string,
      /^supports must contain valid source-normalized floor, wall, and ceiling authority\.$/
    );
  });
}

test("v2 preserves exact off-frame source authority and duplicated claims through JSON", () => {
  const input = payloadInput();
  const sourcePolygon = [
    { x: -0.05, y: 1.10 },
    { x: 1.25, y: 0.25 },
    { x: 0.75, y: -0.05 },
    { x: 0.2, y: 0.2 },
  ] as typeof quad;
  setFloorSourceAuthority(input, sourcePolygon);
  input.floor.polygon = [
    { x: -0.7777, y: 1.7777 },
    { x: 1.7777, y: 0.25 },
    { x: 0.75, y: -0.7777 },
    { x: 0.2, y: 0.2 },
  ];

  const exported = build(input);
  assert.equal(exported.schemaVersion, SCENE_STATE_SCHEMA_VERSION_V2);
  assert.deepEqual(exported.supports.floor.sourceNormalizedPolygon, sourcePolygon);
  assert.deepEqual(exported.calibration?.source.sourceFloorPolygon, sourcePolygon);
  assert.deepEqual(exported.calibrationAppliedAuthority?.sourceFloorPolygon, sourcePolygon);
  const restored = parse(JSON.parse(JSON.stringify(exported)));
  assert.deepEqual(restored.supports?.floor.sourceNormalizedPolygon, sourcePolygon);
  assert.equal(restored.calibration.kind, "valid");
  if (restored.calibration.kind === "valid") {
    assert.deepEqual(restored.calibration.value.source.sourceFloorPolygon, sourcePolygon);
  }
  assert.deepEqual(restored.calibrationAppliedAuthority?.sourceFloorPolygon, sourcePolygon);
});

test("v2 does not rewrite a meaningful one-ULP-above-unit persisted source value", () => {
  const input = payloadInput();
  const sourcePolygon = structuredClone(quad);
  sourcePolygon[0].x = 1.0000000000000002;
  setFloorSourceAuthority(input, sourcePolygon);

  const exported = build(input);
  assert.equal(exported.schemaVersion, SCENE_STATE_SCHEMA_VERSION_V2);
  assert.equal(exported.supports.floor.sourceNormalizedPolygon[0].x, 1.0000000000000002);
  assert.equal(parse(JSON.parse(JSON.stringify(exported))).supports?.floor.sourceNormalizedPolygon[0].x, 1.0000000000000002);
});

test("export selects v1 for unit-bounded source authority and refuses invalid authority without a payload", () => {
  const inFrame = buildSceneStatePayload(payloadInput());
  assert.ok(inFrame.ok, inFrame.ok ? "" : inFrame.reason);
  assert.equal(inFrame.payload.schemaVersion, SCENE_STATE_SCHEMA_VERSION);

  const outOfExtent = payloadInput();
  outOfExtent.supports.floor.sourceNormalizedPolygon[0].x = 1.2500000000000002;
  const rejected = buildSceneStatePayload(outOfExtent);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.match(rejected.reason, /source_x_above_max/);
    assert.equal("payload" in rejected, false);
  }

  const nonFinite = payloadInput();
  nonFinite.supports.floor.sourceNormalizedPolygon[0].y = Number.NaN;
  const rejectedNonFinite = buildSceneStatePayload(nonFinite);
  assert.equal(rejectedNonFinite.ok, false);
  if (!rejectedNonFinite.ok) assert.match(rejectedNonFinite.reason, /source_y_not_finite/);
});

test("v2 has no schema fallback and retains the v1 source extent", () => {
  const input = payloadInput();
  const sourcePolygon = structuredClone(quad);
  sourcePolygon[0].x = 1.1;
  setFloorSourceAuthority(input, sourcePolygon);
  const exported = build(input);
  assert.equal(exported.schemaVersion, SCENE_STATE_SCHEMA_VERSION_V2);

  const relabeledV1 = structuredClone(exported);
  relabeledV1.schemaVersion = SCENE_STATE_SCHEMA_VERSION;
  assert.match(validateImportedSceneJson(relabeledV1, limits) as string, /supports/);

  const unknown = structuredClone(exported);
  unknown.schemaVersion = "vibode-3d-room-lab-scene-state/v999" as typeof unknown.schemaVersion;
  assert.match(validateImportedSceneJson(unknown, limits) as string, /Unsupported schemaVersion/);
});

test("v2 parses the container Floor mirror without clamping and rejects non-finite mirrors", () => {
  const input = payloadInput();
  const sourcePolygon = structuredClone(quad);
  sourcePolygon[0].x = -0.05;
  setFloorSourceAuthority(input, sourcePolygon);
  const exported = build(input);
  exported.floor.polygon = [
    { x: -4, y: 2 },
    { x: 3, y: -5 },
    { x: 0.8, y: 0.2 },
    { x: 0.2, y: 0.2 },
  ];
  const restored = parse(exported);
  assert.deepEqual(restored.floor.polygon, exported.floor.polygon);
  assert.deepEqual(restored.supports?.floor.sourceNormalizedPolygon, sourcePolygon);

  exported.floor.polygon[0].x = Number.POSITIVE_INFINITY;
  assert.match(validateImportedSceneJson(exported, limits) as string, /floor\.polygon/);
});

for (const [kind, coordinate] of [
  ["wall", 1.1],
  ["wall", -0.05],
  ["ceiling", 1.1],
  ["ceiling", -0.05],
] as const) {
  test(`v2 keeps ${kind} source coordinates unit-bounded (${coordinate})`, () => {
    const input = payloadInput();
    const sourcePolygon = structuredClone(quad);
    sourcePolygon[0].x = -0.05;
    setFloorSourceAuthority(input, sourcePolygon);
    const exported = build(input);
    if (kind === "wall") {
      exported.supports.walls.wall_back!.draft.imagePolygonSourceNorm![0].x = coordinate;
    } else {
      exported.supports.ceiling!.draft.imagePolygonSourceNorm![0].x = coordinate;
    }
    assert.match(validateImportedSceneJson(exported, limits) as string, /supports/);
  });
}

test("v2 rejects contradictory duplicated Floor authority claims", () => {
  const input = payloadInput();
  const sourcePolygon = structuredClone(quad);
  sourcePolygon[0].x = -0.05;
  setFloorSourceAuthority(input, sourcePolygon);
  const exported = build(input);
  exported.calibration!.source.sourceFloorPolygon[0].x = 0.25;
  assert.match(validateImportedSceneJson(exported, limits) as string, /calibration\.source\.sourceFloorPolygon contradicts/);

  const authorityMismatch = build(input);
  authorityMismatch.calibrationAppliedAuthority!.sourceFloorPolygon[0].x = 0.25;
  assert.match(validateImportedSceneJson(authorityMismatch, limits) as string, /calibrationAppliedAuthority contradicts/);
});

test("export refuses duplicated source-authority contradictions without producing a payload", () => {
  const input = payloadInput();
  input.calibration!.source.sourceFloorPolygon[0].x = 0.25;
  const rejected = buildSceneStatePayload(input);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) {
    assert.equal(
      rejected.reason,
      "calibration.source.sourceFloorPolygon contradicts supports.floor.sourceNormalizedPolygon."
    );
    assert.equal("payload" in rejected, false);
  }
});
