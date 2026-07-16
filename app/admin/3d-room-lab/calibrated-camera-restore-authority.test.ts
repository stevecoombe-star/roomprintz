import assert from "node:assert/strict";
import test from "node:test";
import {
  CALIBRATED_CAMERA_APPLIED_AUTHORITY_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
  CALIBRATED_CAMERA_AUTHORITY_SOLVER,
  CALIBRATED_CAMERA_IDENTITY_EQUIVALENCE_VERSION,
  IDENTITY_EQUIVALENCE_MAX_COMPONENT_DELTA,
  evaluateCalibratedCameraIdentityRestore,
  isStrictUtcIsoTimestamp,
  parseCalibratedCameraAppliedAuthority,
  selectAppliedAtIso,
  type CalibratedCameraAppliedAuthority,
  type ParsedCalibratedCameraAppliedAuthority,
} from "./calibrated-camera-restore-authority";
import {
  buildCeilingPolygonKey,
  buildRoomHeightKey,
  isCeilingConfirmationCurrent,
  type CeilingPolygon,
} from "./ceiling-support-geometry";
import {
  buildAttachmentBindingKey,
  isAttachmentBindingCurrent,
  selectObjectTransformMode,
  selectPlacementTransformAuthority,
} from "./support-attachment";
import { buildWallPolygonKey, isWallConfirmationCurrent, type WallPolygon } from "./wall-support-geometry";

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

function authorityFixture(): CalibratedCameraAppliedAuthority {
  return {
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
    sourceFloorPolygon: [
      { x: 0.1, y: 0.8 },
      { x: 0.9, y: 0.8 },
      { x: 0.8, y: 0.2 },
      { x: 0.2, y: 0.2 },
    ],
    floorMapping: { worldWidth: 6, worldDepth: 5 },
    calibrationVersion: CALIBRATED_CAMERA_AUTHORITY_CALIBRATION_VERSION,
    solver: CALIBRATED_CAMERA_AUTHORITY_SOLVER,
    diagnosticsSummary: "high confidence; residuals within apply gate",
  };
}

function parsedAuthority(): ParsedCalibratedCameraAppliedAuthority {
  const result = parseCalibratedCameraAppliedAuthority(authorityFixture());
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("fixture authority did not parse");
  return result.value;
}

function matchingContext() {
  const authority = parsedAuthority();
  return {
    authority,
    currentImageBasis: structuredClone(basis),
    currentFrameSize: { ...authority.frameSize },
    currentSourceFloorPolygon: authority.sourceFloorPolygon.map((point) => ({ ...point })),
    currentFloorMapping: { ...authority.floorMapping },
    currentFovDeg: authority.verticalFovDeg,
    freshCandidatePose: structuredClone(authority.pose),
  };
}

test("parses a complete authority without changing its timestamp or pose", () => {
  const parsed = parsedAuthority();
  assert.equal(parsed.appliedAtIso, "2026-07-14T00:00:00.000Z");
  assert.deepEqual(parsed.pose, authorityFixture().pose);
});

for (const [name, mutate, reason] of [
  ["unknown authority version", (value: CalibratedCameraAppliedAuthority) => { (value as { authorityVersion: string }).authorityVersion = "unknown"; }, "authority_version"],
  ["wrong calibration version", (value: CalibratedCameraAppliedAuthority) => { (value as { calibrationVersion: string }).calibrationVersion = "other"; }, "calibration_version"],
  ["wrong solver", (value: CalibratedCameraAppliedAuthority) => { (value as { solver: string }).solver = "other"; }, "solver"],
  ["invalid FOV", (value: CalibratedCameraAppliedAuthority) => { value.verticalFovDeg = 91; }, "vertical_fov"],
  ["invalid frame", (value: CalibratedCameraAppliedAuthority) => { value.frameSize.width = 0; }, "frame_size"],
  ["non-finite position", (value: CalibratedCameraAppliedAuthority) => { value.pose.position.x = Number.NaN; }, "pose"],
  ["non-finite lookAt", (value: CalibratedCameraAppliedAuthority) => { value.pose.lookAt.y = Number.POSITIVE_INFINITY; }, "pose"],
  ["non-finite up", (value: CalibratedCameraAppliedAuthority) => { value.pose.up.z = Number.NaN; }, "pose"],
  ["degenerate view", (value: CalibratedCameraAppliedAuthority) => { value.pose.lookAt = { ...value.pose.position }; }, "pose"],
  ["non-unit up", (value: CalibratedCameraAppliedAuthority) => { value.pose.up.y = 2; }, "pose"],
  ["collinear view and up", (value: CalibratedCameraAppliedAuthority) => { value.pose.up = { x: 0, y: 5, z: 8 }; }, "pose"],
  ["wrong polygon count", (value: CalibratedCameraAppliedAuthority) => { (value.sourceFloorPolygon as unknown as { pop: () => void }).pop(); }, "source_floor_polygon"],
  ["out-of-range floor coordinate", (value: CalibratedCameraAppliedAuthority) => { value.sourceFloorPolygon[0].x = 2; }, "source_floor_polygon"],
  ["invalid floor width", (value: CalibratedCameraAppliedAuthority) => { value.floorMapping.worldWidth = 0; }, "floor_mapping"],
  ["invalid floor depth", (value: CalibratedCameraAppliedAuthority) => { value.floorMapping.worldDepth = Number.NaN; }, "floor_mapping"],
  ["malformed basis", (value: CalibratedCameraAppliedAuthority) => { (value.imageBasis as { basisKind: string }).basisKind = "bad"; }, "image_basis"],
  ["noncanonical coordinate version", (value: CalibratedCameraAppliedAuthority) => { value.imageBasis.coordinateSpaceVersion.decoderId = "other"; }, "image_basis"],
  ["invalid timestamp", (value: CalibratedCameraAppliedAuthority) => { value.appliedAtIso = "today"; }, "applied_at_iso"],
] as const) {
  test(`rejects ${name}`, () => {
    const value = authorityFixture();
    mutate(value);
    const result = parseCalibratedCameraAppliedAuthority(value);
    assert.deepEqual(result, { ok: false, reason });
  });
}

test("rejects a missing required field", () => {
  const value = authorityFixture() as unknown as Record<string, unknown>;
  delete value.diagnosticsSummary;
  assert.deepEqual(parseCalibratedCameraAppliedAuthority(value), { ok: false, reason: "diagnostics_summary" });
});

test("strict timestamp validator only accepts Date ISO UTC milliseconds", () => {
  assert.equal(isStrictUtcIsoTimestamp("2026-07-14T00:00:00.000Z"), true);
  assert.equal(isStrictUtcIsoTimestamp("2026-07-14T00:00:00Z"), false);
  assert.equal(isStrictUtcIsoTimestamp("2026-02-30T00:00:00.000Z"), false);
});

test("exact context accepts and preserves the original identity receipt", () => {
  const result = evaluateCalibratedCameraIdentityRestore(matchingContext());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.identity.appliedAtIso, authorityFixture().appliedAtIso);
  assert.equal(result.identity.receipt.equivalencePolicyVersion, CALIBRATED_CAMERA_IDENTITY_EQUIVALENCE_VERSION);
  assert.ok(result.identity.receipt.maxCornerDeltaPx <= 0.01);
});

for (const [name, mutate, reason] of [
  ["basis ID", (value: ReturnType<typeof matchingContext>) => { value.currentImageBasis.basisId = "other"; }, "image-basis"],
  ["basis fingerprint", (value: ReturnType<typeof matchingContext>) => { value.currentImageBasis.basisFingerprint = "other"; }, "image-basis"],
  ["source URL", (value: ReturnType<typeof matchingContext>) => { value.currentImageBasis.sourceImageUrl = "other"; }, "image-basis"],
  ["decoded width", (value: ReturnType<typeof matchingContext>) => { value.currentImageBasis.decodedWidth = 99; }, "image-basis"],
  ["decoded height", (value: ReturnType<typeof matchingContext>) => { value.currentImageBasis.decodedHeight = 99; }, "image-basis"],
  ["encoded orientation", (value: ReturnType<typeof matchingContext>) => { value.currentImageBasis.encodedOrientation = 2; }, "image-basis"],
  ["coordinate space", (value: ReturnType<typeof matchingContext>) => { value.currentImageBasis.coordinateSpaceVersion.decoderId = "other"; }, "image-basis"],
  ["basis kind", (value: ReturnType<typeof matchingContext>) => { (value.currentImageBasis as { basisKind: "original" | "derivative" }).basisKind = "derivative"; }, "image-basis"],
  ["frame width", (value: ReturnType<typeof matchingContext>) => { value.currentFrameSize.width = 99; }, "frame-width"],
  ["frame height", (value: ReturnType<typeof matchingContext>) => { value.currentFrameSize.height = 99; }, "frame-height"],
  ["floor polygon", (value: ReturnType<typeof matchingContext>) => { value.currentSourceFloorPolygon[0].x = 0.11; }, "source-floor-polygon"],
  ["floor width", (value: ReturnType<typeof matchingContext>) => { value.currentFloorMapping.worldWidth = 7; }, "floor-world-width"],
  ["floor depth", (value: ReturnType<typeof matchingContext>) => { value.currentFloorMapping.worldDepth = 7; }, "floor-world-depth"],
  ["FOV", (value: ReturnType<typeof matchingContext>) => { value.currentFovDeg = 51; }, "vertical-fov"],
  ["position", (value: ReturnType<typeof matchingContext>) => { value.freshCandidatePose.position.x += 1e-4; }, "pose-component-delta"],
  ["lookAt", (value: ReturnType<typeof matchingContext>) => { value.freshCandidatePose.lookAt.x += 1e-4; }, "pose-component-delta"],
  ["up", (value: ReturnType<typeof matchingContext>) => { value.freshCandidatePose.up.x += 1e-4; }, "pose-component-delta"],
] as const) {
  test(`rejects a ${name} mismatch`, () => {
    const value = matchingContext();
    mutate(value);
    const result = evaluateCalibratedCameraIdentityRestore(value);
    assert.deepEqual(result, { ok: false, reason });
  });
}

test("accepts numerical component noise within policy", () => {
  const value = matchingContext();
  value.freshCandidatePose.position.x += IDENTITY_EQUIVALENCE_MAX_COMPONENT_DELTA / 2;
  assert.equal(evaluateCalibratedCameraIdentityRestore(value).ok, true);
});

test("rejects projection delta above 0.01px after component agreement", () => {
  const authority = authorityFixture();
  authority.frameSize = { width: 100_000_000, height: 100_000_000 };
  const parsed = parseCalibratedCameraAppliedAuthority(authority);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const value = matchingContext();
  value.authority = parsed.value;
  value.currentFrameSize = { ...parsed.value.frameSize };
  value.currentFovDeg = parsed.value.verticalFovDeg;
  value.freshCandidatePose = structuredClone(parsed.value.pose);
  value.freshCandidatePose.position.x += IDENTITY_EQUIVALENCE_MAX_COMPONENT_DELTA / 2;
  assert.deepEqual(evaluateCalibratedCameraIdentityRestore(value), { ok: false, reason: "projection-delta" });
});

test("rejects invalid projections and uses deterministic first reason", () => {
  const invalid = matchingContext();
  invalid.freshCandidatePose = {
    position: { x: 0, y: 0, z: 0 },
    lookAt: { x: 0, y: 0, z: 1 },
    up: { x: 0, y: 1, z: 0 },
  };
  assert.deepEqual(evaluateCalibratedCameraIdentityRestore(invalid), { ok: false, reason: "pose-component-delta" });
  const multi = matchingContext();
  multi.currentImageBasis.basisId = "other";
  multi.currentFrameSize.width = 1;
  assert.deepEqual(evaluateCalibratedCameraIdentityRestore(multi), { ok: false, reason: "image-basis" });
});

test("timestamp selection only accepts the branded evaluated identity for restore", () => {
  const evaluation = evaluateCalibratedCameraIdentityRestore(matchingContext());
  assert.equal(evaluation.ok, true);
  if (!evaluation.ok) return;
  assert.equal(selectAppliedAtIso({ kind: "new_apply" }, "2026-07-15T00:00:00.000Z"), "2026-07-15T00:00:00.000Z");
  assert.equal(
    selectAppliedAtIso({ kind: "restore_existing_identity", identity: evaluation.identity }, "2026-07-15T00:00:00.000Z"),
    "2026-07-14T00:00:00.000Z"
  );
  // @ts-expect-error Parsed authority is evidence, not a restorable identity.
  selectAppliedAtIso({ kind: "restore_existing_identity", identity: parsedAuthority() }, "2026-07-15T00:00:00.000Z");
});

test("preserved identity naturally restores wall, Ceiling, and attachment currentness", () => {
  const authority = parsedAuthority();
  const wallPolygon: WallPolygon = [
    { x: 0.1, y: 0.8 },
    { x: 0.9, y: 0.8 },
    { x: 0.8, y: 0.2 },
    { x: 0.2, y: 0.2 },
  ];
  const ceilingPolygon: CeilingPolygon = wallPolygon.map((point) => ({ ...point })) as CeilingPolygon;
  const wallStamp = {
    wallPolygonKey: buildWallPolygonKey(wallPolygon),
    imageBasisId: basis.basisId,
    imageBasisFingerprint: basis.basisFingerprint,
    cameraAppliedAtIso: authority.appliedAtIso,
    frameWidth: authority.frameSize.width,
    frameHeight: authority.frameSize.height,
  };
  assert.equal(isWallConfirmationCurrent({
    stamp: wallStamp,
    polygon: wallPolygon,
    basis,
    cameraAppliedAtIso: authority.appliedAtIso,
    frameSize: authority.frameSize,
  }), true);
  assert.equal(isWallConfirmationCurrent({
    stamp: wallStamp,
    polygon: wallPolygon,
    basis,
    cameraAppliedAtIso: "2026-07-15T00:00:00.000Z",
    frameSize: authority.frameSize,
  }), false);

  const ceilingStamp = {
    ceilingPolygonKey: buildCeilingPolygonKey(ceilingPolygon),
    roomHeightKey: buildRoomHeightKey(2.75),
    imageBasisId: basis.basisId,
    imageBasisFingerprint: basis.basisFingerprint,
    cameraAppliedAtIso: authority.appliedAtIso,
    frameWidth: authority.frameSize.width,
    frameHeight: authority.frameSize.height,
  };
  assert.equal(isCeilingConfirmationCurrent({
    stamp: ceilingStamp,
    polygon: ceilingPolygon,
    roomHeight: 2.75,
    basis,
    cameraAppliedAtIso: authority.appliedAtIso,
    frameSize: authority.frameSize,
  }), true);
  assert.equal(isCeilingConfirmationCurrent({
    stamp: ceilingStamp,
    polygon: ceilingPolygon,
    roomHeight: 2.75,
    basis,
    cameraAppliedAtIso: "2026-07-15T00:00:00.000Z",
    frameSize: authority.frameSize,
  }), false);

  const binding = {
    supportKind: "floor" as const,
    sourcePolygonKey: "floor-authority",
    confirmationStampKey: "floor-confirmed",
    imageBasisId: basis.basisId,
    imageBasisFingerprint: basis.basisFingerprint,
    cameraAppliedAtIso: authority.appliedAtIso,
    frameWidth: authority.frameSize.width,
    frameHeight: authority.frameSize.height,
  };
  const attachment = {
    supportKind: "floor" as const,
    supportBindingKey: buildAttachmentBindingKey(binding),
    localPosition: { u: 0, v: 0 },
    rotationAboutNormalDeg: 0,
    uniformScale: 1,
    contactProfile: { kind: "floor" as const, contactAxis: "local_y" as const, contactSide: "min" as const },
    attachedAtIso: authority.appliedAtIso,
  };
  assert.equal(isAttachmentBindingCurrent(attachment, binding), true);
  assert.equal(isAttachmentBindingCurrent(attachment, { ...binding, cameraAppliedAtIso: "2026-07-15T00:00:00.000Z" }), false);
  const blocked = selectObjectTransformMode({
    attachment,
    bindingCurrent: false,
    supportUsable: false,
    cameraActive: true,
  });
  assert.equal(blocked, "support_attached_blocked");
  assert.equal(selectPlacementTransformAuthority({
    mode: blocked,
    hasCurrentAttachmentTransform: false,
    hasFrozenAttachmentTransform: true,
  }), "attachment_frozen");
});
