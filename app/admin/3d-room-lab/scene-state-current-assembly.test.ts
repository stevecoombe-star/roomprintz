import assert from "node:assert/strict";
import test from "node:test";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
} from "./calibrated-camera-restore-authority";
import {
  SCENE_IMAGE_COORDINATE_SPACE_V0,
  SCENE_STATE_SCHEMA_VERSION,
  buildSceneStatePayload,
  type SceneStatePayload,
  type SceneStatePayloadInput,
} from "./scene-state";
import {
  assembleCurrentSceneStatePayload,
  type CurrentSceneStateAssemblyInput,
} from "./scene-state-current-assembly";
import {
  buildVerticalEvidenceSuggestionId,
  materializeVerticalEvidenceObservation,
  type VerticalEvidenceSuggestion,
} from "./vertical-evidence";

const EXPORTED_AT = "2026-09-22T12:00:00.000Z";
const APPLIED_AT = "2026-07-14T00:00:00.000Z";

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

const quad = [
  { x: 0.2, y: 0.8 },
  { x: 0.9, y: 0.75 },
  { x: 0.8, y: 0.2 },
  { x: 0.15, y: 0.25 },
];

const containerPolygon = [
  { x: 0.1239, y: 0.8 },
  { x: 0.9, y: 0.75 },
  { x: 0.8, y: 0.2 },
  { x: 0.15, y: 0.25 },
];

function wallDraft(kind: "wall_back" | "wall_left" | "wall_right") {
  return {
    kind,
    enabled: true,
    source: "manual" as const,
    imagePolygonSourceNorm: structuredClone(quad) as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ],
    reviewStatus: "manually_confirmed" as const,
    confirmationStamp: {
      wallPolygonKey: `${kind}-polygon`,
      imageBasisId: basis.basisId,
      imageBasisFingerprint: basis.basisFingerprint,
      cameraAppliedAtIso: APPLIED_AT,
      frameWidth: 1600,
      frameHeight: 1200,
    },
  };
}

function completeInput(): CurrentSceneStateAssemblyInput {
  return {
    exportedAtIso: EXPORTED_AT,
    roomImageUrl: basis.sourceImageUrl,
    imageIntrinsicSize: { width: 1600, height: 1200 },
    rendererSize: { width: 800, height: 600 },
    calibratedCameraSnapshot: {
      pose: {
        position: { x: 0, y: 5, z: 8 },
        lookAt: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      fovDeg: 50,
      frameSize: { width: 800, height: 600 },
      diagnosticsSummary: "high confidence",
      appliedAtIso: APPLIED_AT,
      imageBasis: structuredClone(basis),
      sourceFloorPolygon: structuredClone(quad),
    },
    isCalibratedCameraActive: true,
    qualifiedImageBasis: structuredClone(basis),
    sourceNormalizedFloorPolygon: structuredClone(quad),
    floorMapping: { worldWidth: 6, worldDepth: 5, depthCenterY: 0.4 },
    modelPath: "/models/chair.glb",
    activeObjectType: "glb",
    modelLoadState: "loaded",
    modelLoadError: null,
    modelNormalization: { modelYOffset: 0.25, modelYawOffsetDeg: 15, modelScaleMultiplier: 1.5 },
    transform: {
      positionX: 1.25,
      positionY: 0,
      positionZ: -2,
      rotationYDeg: 30,
      uniformScale: 1.1,
    },
    autoRotateEnabled: true,
    floorPolygon: structuredClone(containerPolygon),
    showFloorOverlay: true,
    isFloorClickPlacementEnabled: true,
    lastAcceptedFloorClick: { x: 0.3333, y: 0.6666 },
    lastRejectedFloorClick: { x: 0.1, y: 0.2 },
    perspectiveDepthScaling: {
      enabled: true,
      nearScaleMultiplier: 1.2,
      farScaleMultiplier: 0.8,
      nearFloorY: 0.2,
      farFloorY: 0.9,
    },
    floorSupportReviewStatus: "manually_confirmed",
    floorSupportSource: "manual",
    floorSupportImageBasis: structuredClone(basis),
    floorPolygonAuthorityEligible: true,
    wallSupportDrafts: {
      wall_back: wallDraft("wall_back"),
      wall_left: wallDraft("wall_left"),
      wall_right: wallDraft("wall_right"),
    },
    wallSupportImageBases: {
      wall_back: structuredClone(basis),
      wall_left: structuredClone(basis),
      wall_right: structuredClone(basis),
    },
    ceilingSupportDraft: {
      enabled: true,
      source: "manual",
      imagePolygonSourceNorm: structuredClone(quad) as [
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
        { x: number; y: number },
      ],
      roomHeight: 2.75,
      reviewStatus: "manually_confirmed",
      confirmationStamp: {
        ceilingPolygonKey: "ceiling-polygon",
        roomHeightKey: "2.750000",
        imageBasisId: basis.basisId,
        imageBasisFingerprint: basis.basisFingerprint,
        cameraAppliedAtIso: APPLIED_AT,
        frameWidth: 1600,
        frameHeight: 1200,
      },
    },
    ceilingSupportImageBasis: structuredClone(basis),
    objectSupportAttachment: {
      supportKind: "floor",
      supportBindingKey: "exact-floor-binding",
      localPosition: { u: 0.2, v: 0.4 },
      rotationAboutNormalDeg: 12,
      uniformScale: 1.05,
      contactProfile: { kind: "floor", contactAxis: "local_y", contactSide: "min" },
      attachedAtIso: APPLIED_AT,
    },
    verticalEvidence: null,
    imageLoadState: "loaded",
  };
}

function payloadOf(input: CurrentSceneStateAssemblyInput): SceneStatePayload {
  const result = assembleCurrentSceneStatePayload(input);
  if (!result.ok) assert.fail(result.reason);
  return result.payload;
}

function priorContractInput(input: CurrentSceneStateAssemblyInput): SceneStatePayloadInput {
  const snapshot = input.calibratedCameraSnapshot;
  const qualified = input.qualifiedImageBasis;
  assert.ok(snapshot);
  assert.ok(qualified);
  assert.ok(input.imageIntrinsicSize);
  return {
    exportedAtIso: input.exportedAtIso,
    roomImageUrl: input.roomImageUrl,
    modelPath: input.modelPath,
    activeObjectType: input.activeObjectType,
    glbLoadStatus: input.modelLoadState,
    modelNormalization: input.modelNormalization,
    transform: {
      positionX: input.transform.positionX,
      positionY: input.transform.positionY,
      positionZ: input.transform.positionZ,
      rotationYDeg: input.transform.rotationYDeg,
      uniformScale: input.transform.uniformScale,
      autoRotate: input.autoRotateEnabled,
    },
    floor: {
      polygon: input.floorPolygon,
      overlayVisible: input.showFloorOverlay,
      placementModeEnabled: input.isFloorClickPlacementEnabled,
      lastAcceptedClick: input.lastAcceptedFloorClick,
      lastRejectedClick: input.lastRejectedFloorClick,
      mapping: input.floorMapping,
      perspectiveDepthScaling: input.perspectiveDepthScaling,
    },
    image: {
      intrinsicWidth: input.imageIntrinsicSize.width,
      intrinsicHeight: input.imageIntrinsicSize.height,
      coordinateSpace: SCENE_IMAGE_COORDINATE_SPACE_V0,
    },
    calibration: {
      calibrationVersion: "calibrated-camera/v2",
      solver: "homography-planar-cv/v1",
      intrinsics: { verticalFovDeg: snapshot.fovDeg },
      source: {
        imageBasis: qualified,
        sourceFloorPolygon: input.sourceNormalizedFloorPolygon.map((point) => ({ x: point.x, y: point.y })),
      },
    },
    calibrationAppliedAuthority: {
      authorityVersion: CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
      appliedAtIso: snapshot.appliedAtIso,
      verticalFovDeg: snapshot.fovDeg,
      frameSize: { ...snapshot.frameSize },
      pose: {
        position: { ...snapshot.pose.position },
        lookAt: { ...snapshot.pose.lookAt },
        up: { ...snapshot.pose.up },
      },
      imageBasis: snapshot.imageBasis,
      sourceFloorPolygon: [
        { x: snapshot.sourceFloorPolygon[0].x, y: snapshot.sourceFloorPolygon[0].y },
        { x: snapshot.sourceFloorPolygon[1].x, y: snapshot.sourceFloorPolygon[1].y },
        { x: snapshot.sourceFloorPolygon[2].x, y: snapshot.sourceFloorPolygon[2].y },
        { x: snapshot.sourceFloorPolygon[3].x, y: snapshot.sourceFloorPolygon[3].y },
      ],
      floorMapping: {
        worldWidth: input.floorMapping.worldWidth,
        worldDepth: input.floorMapping.worldDepth,
      },
      calibrationVersion: CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
      solver: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
      diagnosticsSummary: snapshot.diagnosticsSummary,
    },
    supports: {
      floor: {
        sourceNormalizedPolygon: input.sourceNormalizedFloorPolygon,
        reviewStatus: input.floorSupportReviewStatus,
        source: input.floorSupportSource,
        supportImageBasis: input.floorSupportImageBasis,
        authorityEligible: input.floorPolygonAuthorityEligible,
      },
      walls: {
        wall_back: {
          draft: input.wallSupportDrafts.wall_back,
          supportImageBasis: input.wallSupportImageBases.wall_back,
        },
        wall_left: {
          draft: input.wallSupportDrafts.wall_left,
          supportImageBasis: input.wallSupportImageBases.wall_left,
        },
        wall_right: {
          draft: input.wallSupportDrafts.wall_right,
          supportImageBasis: input.wallSupportImageBases.wall_right,
        },
      },
      ceiling: {
        draft: input.ceilingSupportDraft,
        supportImageBasis: input.ceilingSupportImageBasis,
      },
    },
    attachment: input.objectSupportAttachment,
    verticalEvidence: input.verticalEvidence,
    debug: {
      rendererSize: input.rendererSize,
      imageStatus: input.imageLoadState,
      modelStatus: "loaded",
    },
  };
}

test("complete assembly matches the prior scene-state contract exactly", () => {
  const input = completeInput();
  const assembled = assembleCurrentSceneStatePayload(input);
  const prior = buildSceneStatePayload(priorContractInput(input));
  assert.deepEqual(assembled, prior);
  assert.equal(assembled.ok, true);
  if (!assembled.ok) return;

  assert.deepEqual(Object.keys(assembled.payload), [
    "schemaVersion",
    "exportedAt",
    "roomImageUrl",
    "image",
    "calibration",
    "calibrationAppliedAuthority",
    "model",
    "transform",
    "floor",
    "supports",
    "attachment",
    "verticalEvidence",
    "debug",
    "notes",
  ]);
  assert.equal(assembled.payload.schemaVersion, SCENE_STATE_SCHEMA_VERSION);
  assert.equal(assembled.payload.exportedAt, EXPORTED_AT);
  assert.equal(assembled.payload.roomImageUrl, basis.sourceImageUrl);
  assert.deepEqual(assembled.payload.image, {
    intrinsicWidth: 1600,
    intrinsicHeight: 1200,
    coordinateSpace: "container-normalized-v0",
  });
  assert.equal(assembled.payload.calibration?.calibrationVersion, "calibrated-camera/v2");
  assert.equal(assembled.payload.calibration?.solver, "homography-planar-cv/v1");
  assert.equal(assembled.payload.calibration?.intrinsics.verticalFovDeg, 50);
  assert.equal(assembled.payload.calibrationAppliedAuthority?.authorityVersion, CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION);
  assert.equal(assembled.payload.calibrationAppliedAuthority?.appliedAtIso, APPLIED_AT);
  assert.equal(assembled.payload.calibrationAppliedAuthority?.calibrationVersion, "calibrated-camera/v2");
  assert.equal(assembled.payload.calibrationAppliedAuthority?.solver, "homography-planar-cv/v1");
  assert.deepEqual(assembled.payload.model, {
    modelPath: "/models/chair.glb",
    activeObjectType: "glb",
    glbLoadStatus: "loaded",
    normalization: { yOffset: 0.25, yawOffsetDeg: 15, scaleMultiplier: 1.5 },
  });
  assert.deepEqual(assembled.payload.transform, {
    positionX: 1.25,
    positionY: 0,
    positionZ: -2,
    rotationYDegrees: 30,
    scale: 1.1,
    autoRotate: true,
  });
  assert.deepEqual(assembled.payload.floor.polygon[0], { x: 0.124, y: 0.8 });
  assert.deepEqual(assembled.payload.floor.lastAcceptedClick, { x: 0.333, y: 0.667 });
  assert.deepEqual(assembled.payload.floor.lastRejectedClick, { x: 0.1, y: 0.2 });
  assert.equal(assembled.payload.floor.overlayVisible, true);
  assert.equal(assembled.payload.floor.placementModeEnabled, true);
  assert.deepEqual(assembled.payload.floor.mapping, { worldWidth: 6, worldDepth: 5, depthCenterY: 0.4 });
  assert.deepEqual(assembled.payload.floor.perspectiveDepthScaling, {
    enabled: true,
    nearScaleMultiplier: 1.2,
    farScaleMultiplier: 0.8,
    nearFloorY: 0.2,
    farFloorY: 0.9,
  });
  assert.deepEqual(Object.keys(assembled.payload.supports.walls), ["wall_back", "wall_left", "wall_right"]);
  assert.equal(assembled.payload.supports.floor.reviewStatus, "manually_confirmed");
  assert.equal(assembled.payload.supports.floor.authorityEligible, true);
  assert.equal(assembled.payload.supports.ceiling?.draft.roomHeight, 2.75);
  assert.equal(assembled.payload.attachment?.supportBindingKey, "exact-floor-binding");
  assert.equal(assembled.payload.verticalEvidence, undefined);
  assert.deepEqual(assembled.payload.debug, {
    rendererSize: { width: 800, height: 600 },
    imageStatus: "loaded",
    modelStatus: "loaded",
  });
  assert.deepEqual(assembled.payload.notes, [
    "Floor polygon points are normalized to the displayed container for UI editing.",
    "Source-normalized floor polygon is persisted for Type A calibration authority and restore compatibility.",
    "Phase 0D floor click placement uses temporary linear mapping constants and is not perspective-calibrated.",
  ]);
});

test("identical inputs are deterministic, and exportedAt is the only timestamp the caller supplies", () => {
  const first = payloadOf(completeInput());
  const second = payloadOf(completeInput());
  assert.deepEqual(first, second);
  const later = payloadOf({ ...completeInput(), exportedAtIso: "2026-09-22T13:00:00.000Z" });
  assert.equal(later.exportedAt, "2026-09-22T13:00:00.000Z");
  const { exportedAt: firstExportedAt, ...firstBody } = first;
  const { exportedAt: laterExportedAt, ...laterBody } = later;
  assert.notEqual(firstExportedAt, laterExportedAt);
  assert.deepEqual(firstBody, laterBody);
});

test("floor support fields each change the payload on their own", () => {
  const baseline = payloadOf(completeInput());

  const review = completeInput();
  review.floorSupportReviewStatus = "needs_review";
  const reviewPayload = payloadOf(review);
  assert.equal(reviewPayload.supports.floor.reviewStatus, "needs_review");
  assert.equal(reviewPayload.supports.floor.source, baseline.supports.floor.source);
  assert.equal(reviewPayload.supports.floor.authorityEligible, baseline.supports.floor.authorityEligible);

  const source = completeInput();
  source.floorSupportSource = "derived";
  const sourcePayload = payloadOf(source);
  assert.equal(sourcePayload.supports.floor.source, "derived");
  assert.equal(sourcePayload.supports.floor.reviewStatus, baseline.supports.floor.reviewStatus);

  const nextBasis = structuredClone(basis);
  nextBasis.basisFingerprint = "floor-basis-next";
  const basisInput = completeInput();
  basisInput.floorSupportImageBasis = nextBasis;
  const basisPayload = payloadOf(basisInput);
  assert.equal(basisPayload.supports.floor.supportImageBasis?.basisFingerprint, "floor-basis-next");
  assert.equal(basisPayload.supports.floor.reviewStatus, baseline.supports.floor.reviewStatus);

  const eligibility = completeInput();
  eligibility.floorPolygonAuthorityEligible = false;
  const eligibilityPayload = payloadOf(eligibility);
  assert.equal(eligibilityPayload.supports.floor.authorityEligible, false);
  assert.equal(eligibilityPayload.supports.floor.reviewStatus, baseline.supports.floor.reviewStatus);
});

test("wall draft and wall image basis each change only that wall", () => {
  const draftInput = completeInput();
  draftInput.wallSupportDrafts = {
    ...draftInput.wallSupportDrafts,
    wall_back: { ...draftInput.wallSupportDrafts.wall_back, reviewStatus: "needs_review" },
  };
  const draftPayload = payloadOf(draftInput);
  assert.equal(draftPayload.supports.walls.wall_back?.draft.reviewStatus, "needs_review");
  assert.equal(draftPayload.supports.walls.wall_left?.draft.reviewStatus, "manually_confirmed");
  assert.equal(draftPayload.supports.walls.wall_right?.draft.reviewStatus, "manually_confirmed");

  const nextBasis = structuredClone(basis);
  nextBasis.basisId = "wall-left-basis";
  const basisInput = completeInput();
  basisInput.wallSupportImageBases = {
    ...basisInput.wallSupportImageBases,
    wall_left: nextBasis,
  };
  const basisPayload = payloadOf(basisInput);
  assert.equal(basisPayload.supports.walls.wall_left?.supportImageBasis?.basisId, "wall-left-basis");
  assert.equal(basisPayload.supports.walls.wall_back?.supportImageBasis?.basisId, basis.basisId);
  assert.equal(basisPayload.supports.walls.wall_right?.supportImageBasis?.basisId, basis.basisId);
});

test("ceiling draft and ceiling image basis each change the ceiling support", () => {
  const draftInput = completeInput();
  draftInput.ceilingSupportDraft = { ...draftInput.ceilingSupportDraft, roomHeight: 3.1 };
  const draftPayload = payloadOf(draftInput);
  assert.equal(draftPayload.supports.ceiling?.draft.roomHeight, 3.1);
  assert.equal(draftPayload.supports.ceiling?.supportImageBasis?.basisFingerprint, basis.basisFingerprint);

  const nextBasis = structuredClone(basis);
  nextBasis.basisFingerprint = "ceiling-basis-next";
  const basisInput = completeInput();
  basisInput.ceilingSupportImageBasis = nextBasis;
  const basisPayload = payloadOf(basisInput);
  assert.equal(basisPayload.supports.ceiling?.supportImageBasis?.basisFingerprint, "ceiling-basis-next");
  assert.equal(basisPayload.supports.ceiling?.draft.roomHeight, 2.75);
});

test("object attachment can be set, updated, and cleared", () => {
  const cleared = completeInput();
  cleared.objectSupportAttachment = null;
  assert.equal(payloadOf(cleared).attachment, null);

  const set = payloadOf(completeInput());
  assert.equal(set.attachment?.supportKind, "floor");
  assert.deepEqual(set.attachment?.localPosition, { u: 0.2, v: 0.4 });
  assert.equal(set.attachment?.attachedAtIso, APPLIED_AT);

  const updated = completeInput();
  updated.objectSupportAttachment = {
    ...updated.objectSupportAttachment!,
    localPosition: { u: 0.5, v: -0.25 },
    rotationAboutNormalDeg: 40,
    supportKind: "ceiling",
    contactProfile: { kind: "ceiling", contactAxis: "local_y", contactSide: "max" },
  };
  const updatedPayload = payloadOf(updated);
  assert.equal(updatedPayload.attachment?.supportKind, "ceiling");
  assert.deepEqual(updatedPayload.attachment?.localPosition, { u: 0.5, v: -0.25 });
  assert.equal(updatedPayload.attachment?.rotationAboutNormalDeg, 40);
  assert.deepEqual(updatedPayload.attachment?.contactProfile, {
    kind: "ceiling",
    contactAxis: "local_y",
    contactSide: "max",
  });
});

test("active object type and transform are serialized from the explicit inputs", () => {
  for (const activeObjectType of ["glb", "fallbackCube", "none"] as const) {
    const input = completeInput();
    input.activeObjectType = activeObjectType;
    assert.equal(payloadOf(input).model.activeObjectType, activeObjectType);
  }

  const moved = completeInput();
  moved.transform = { ...moved.transform, positionX: -1.5, uniformScale: 2 };
  moved.autoRotateEnabled = false;
  const movedPayload = payloadOf(moved);
  assert.equal(movedPayload.transform.positionX, -1.5);
  assert.equal(movedPayload.transform.scale, 2);
  assert.equal(movedPayload.transform.autoRotate, false);
  assert.equal(movedPayload.transform.rotationYDegrees, 30);
});

test("model status formatting stays with the assembler", () => {
  const fallback = completeInput();
  fallback.modelLoadState = "fallback";
  fallback.modelLoadError = "missing mesh";
  const fallbackPayload = payloadOf(fallback);
  assert.equal(fallbackPayload.model.glbLoadStatus, "fallback");
  assert.equal(fallbackPayload.debug.modelStatus, "fallback cube (missing mesh)");

  const failed = completeInput();
  failed.modelLoadState = "error";
  failed.modelLoadError = null;
  assert.equal(payloadOf(failed).debug.modelStatus, "error (unknown)");

  const loading = completeInput();
  loading.imageLoadState = "loading";
  loading.modelLoadState = "loading";
  const loadingPayload = payloadOf(loading);
  assert.equal(loadingPayload.debug.imageStatus, "loading");
  assert.equal(loadingPayload.debug.modelStatus, "loading");
});

test("calibration and applied authority follow the previous export gates", () => {
  const inactive = completeInput();
  inactive.isCalibratedCameraActive = false;
  const inactivePayload = payloadOf(inactive);
  assert.equal(inactivePayload.calibration, undefined);
  assert.equal(inactivePayload.calibrationAppliedAuthority, undefined);

  const lowFov = completeInput();
  lowFov.calibratedCameraSnapshot = { ...lowFov.calibratedCameraSnapshot!, fovDeg: 19 };
  assert.equal(payloadOf(lowFov).calibration, undefined);

  const minFov = completeInput();
  minFov.calibratedCameraSnapshot = { ...minFov.calibratedCameraSnapshot!, fovDeg: 20 };
  assert.equal(payloadOf(minFov).calibration?.intrinsics.verticalFovDeg, 20);

  const maxFov = completeInput();
  maxFov.calibratedCameraSnapshot = { ...maxFov.calibratedCameraSnapshot!, fovDeg: 90 };
  assert.equal(payloadOf(maxFov).calibration?.intrinsics.verticalFovDeg, 90);

  const highFov = completeInput();
  highFov.calibratedCameraSnapshot = { ...highFov.calibratedCameraSnapshot!, fovDeg: 91 };
  assert.equal(payloadOf(highFov).calibration, undefined);

  const blankUrl = completeInput();
  blankUrl.roomImageUrl = "   ";
  const blankPayload = payloadOf(blankUrl);
  assert.equal(blankPayload.roomImageUrl, "   ");
  assert.equal(blankPayload.calibration, undefined);

  const missingImage = completeInput();
  missingImage.imageIntrinsicSize = null;
  const missingImagePayload = payloadOf(missingImage);
  assert.equal(missingImagePayload.image, undefined);
  assert.equal(missingImagePayload.calibration, undefined);

  const invalidImage = completeInput();
  invalidImage.imageIntrinsicSize = { width: 0, height: 1200 };
  const invalidImagePayload = payloadOf(invalidImage);
  assert.equal(invalidImagePayload.image?.intrinsicWidth, 0);
  assert.equal(invalidImagePayload.calibration, undefined);

  const mismatchedBasis = completeInput();
  mismatchedBasis.calibratedCameraSnapshot = {
    ...mismatchedBasis.calibratedCameraSnapshot!,
    imageBasis: { ...mismatchedBasis.calibratedCameraSnapshot!.imageBasis, basisId: "other-basis" },
  };
  const mismatchedBasisPayload = payloadOf(mismatchedBasis);
  assert.equal(mismatchedBasisPayload.calibration?.source.imageBasis.basisId, basis.basisId);
  assert.equal(mismatchedBasisPayload.calibrationAppliedAuthority, undefined);

  const mismatchedFrame = completeInput();
  mismatchedFrame.rendererSize = { width: 801, height: 600 };
  const mismatchedFramePayload = payloadOf(mismatchedFrame);
  assert.ok(mismatchedFramePayload.calibration);
  assert.equal(mismatchedFramePayload.calibrationAppliedAuthority, undefined);

  const withinTolerance = completeInput();
  withinTolerance.sourceNormalizedFloorPolygon = withinTolerance.sourceNormalizedFloorPolygon.map((point, index) =>
    index === 0 ? { x: 0.5, y: point.y } : { ...point }
  );
  withinTolerance.calibratedCameraSnapshot = {
    ...withinTolerance.calibratedCameraSnapshot!,
    sourceFloorPolygon: withinTolerance.sourceNormalizedFloorPolygon.map((point, index) =>
      index === 0 ? { x: 0.5 + 5e-7, y: point.y } : { ...point }
    ),
  };
  const withinToleranceResult = assembleCurrentSceneStatePayload(withinTolerance);
  assert.equal(withinToleranceResult.ok, false);
  if (!withinToleranceResult.ok) {
    assert.match(withinToleranceResult.reason, /calibrationAppliedAuthority\.sourceFloorPolygon contradicts/);
  }

  const outsideTolerance = completeInput();
  outsideTolerance.sourceNormalizedFloorPolygon = outsideTolerance.sourceNormalizedFloorPolygon.map((point, index) =>
    index === 0 ? { x: 0.5, y: point.y } : { ...point }
  );
  outsideTolerance.calibratedCameraSnapshot = {
    ...outsideTolerance.calibratedCameraSnapshot!,
    sourceFloorPolygon: outsideTolerance.sourceNormalizedFloorPolygon.map((point, index) =>
      index === 0 ? { x: 0.5 + 5e-6, y: point.y } : { ...point }
    ),
  };
  const outsideTolerancePayload = payloadOf(outsideTolerance);
  assert.ok(outsideTolerancePayload.calibration);
  assert.equal(outsideTolerancePayload.calibrationAppliedAuthority, undefined);
  assert.equal(outsideTolerancePayload.calibration?.source.sourceFloorPolygon[0].x, 0.5);
});

test("vertical evidence is forwarded without being invented when absent", () => {
  assert.equal(payloadOf(completeInput()).verticalEvidence, undefined);

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
    decisionAtIso: APPLIED_AT,
    floor: {
      sourceNormalizedPolygon: quad,
      polygonKey: "floor-a",
      worldWidth: 6,
      worldDepth: 5,
    },
    historicalContext: {
      nonBinding: true,
      cameraVersion: "calibrated-camera/v2",
      cameraAppliedAtIso: APPLIED_AT,
      frameWidth: 1600,
      frameHeight: 1200,
    },
  });
  assert.equal(materialized.ok, true);
  if (!materialized.ok) return;
  const input = completeInput();
  input.verticalEvidence = {
    evidenceModelVersion: "vertical-evidence-model/v1",
    observations: [materialized.observation],
  };
  const payload = payloadOf(input);
  assert.equal(payload.verticalEvidence?.evidenceModelVersion, "vertical-evidence-model/v1");
  assert.equal(payload.verticalEvidence?.observations.length, 1);
  assert.equal(payload.verticalEvidence?.observations[0].operatorDecision, "selected");
});
