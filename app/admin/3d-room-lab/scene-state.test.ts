import assert from "node:assert/strict";
import test from "node:test";
import {
  SCENE_STATE_SCHEMA_VERSION,
  buildSceneStatePayload,
  validateImportedSceneJson,
  type SceneStatePayloadInput,
} from "./scene-state";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
} from "./calibrated-camera-restore-authority";

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

function payload() {
  return buildSceneStatePayload(payloadInput());
}

type Payload = ReturnType<typeof payload>;

function parse(value: unknown) {
  const result = validateImportedSceneJson(value, limits);
  assert.notEqual(typeof result, "string", typeof result === "string" ? result : "");
  return result as Exclude<typeof result, string>;
}

test("round-trips full operator-owned support source state", () => {
  const result = parse(payload());
  assert.equal(result.supports?.floor.reviewStatus, "manually_confirmed");
  assert.deepEqual(result.supports?.walls.wall_back?.draft, payloadInput().supports.walls.wall_back?.draft);
  assert.deepEqual(result.supports?.walls.wall_left?.draft, payloadInput().supports.walls.wall_left?.draft);
  assert.deepEqual(result.supports?.walls.wall_right?.draft, payloadInput().supports.walls.wall_right?.draft);
  assert.deepEqual(result.supports?.ceiling?.draft, payloadInput().supports.ceiling?.draft);
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
