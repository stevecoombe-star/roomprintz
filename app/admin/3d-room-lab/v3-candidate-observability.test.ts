import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildSceneStatePayload, type SceneStatePayloadInput } from "./scene-state";
import { v3ProjectIntrinsic, type V3ActiveV2Snapshot, type V3Theta } from "./v3-candidate-solver";
import {
  evaluateV3CandidateObservability,
  type V3CandidateCalibratedCameraSnapshot,
  type V3CandidateObservabilityInput,
} from "./v3-candidate-observability";
import { runProductionV2FloorSolve } from "./v3-synthetic-camera";
import { syntheticFixtureById } from "./v3-synthetic-fixtures";
import type {
  VerticalEvidenceCollectionRuntime,
  VerticalEvidenceObservation,
  VerticalEvidenceObservationRuntime,
} from "./vertical-evidence";

const ZERO: V3Theta = { omegaXRad: 0, omegaZRad: 0, deltaTxM: 0, deltaTyM: 0, deltaTzM: 0 };

function runtime(
  observations: readonly VerticalEvidenceObservation[],
  overrides: Readonly<Record<string, Partial<Pick<VerticalEvidenceObservationRuntime, "usability" | "eligible">>>> = {}
): VerticalEvidenceCollectionRuntime {
  return {
    suggestions: [],
    observations: observations.map((observation) => ({
      observation,
      usability: overrides[observation.observationId]?.usability ?? "current",
      reasons: [],
      eligible: overrides[observation.observationId]?.eligible ?? true,
      sourcePixelLength: null,
      normalizedSourceLength: null,
      activeRawResidualDeg: null,
    })),
    assessment: "unclassified",
    metrics: {
      distinctPhysicalVerticalCount: new Set(observations.map((observation) => observation.physicalVerticalId)).size,
      observationsPerPhysicalVertical: [],
      representedWallCount: 0,
      representedWalls: [],
      sameWallOnly: false,
      normalizedSourceImageSeparation: null,
      normalizedWorldAnchorSeparation: null,
      normalizedObservationLengths: [],
      floorQuadrantOccupancy: { near_left: 0, near_right: 0, far_left: 0, far_right: 0, outside_or_unavailable: 0 },
      activeRawResidualSummary: { count: 0, minimumDeg: null, maximumDeg: null, rangeDeg: null, averageDeg: null, note: "test" },
    },
  };
}

function productionInput(
  fixtureId: Parameters<typeof syntheticFixtureById>[0] = "v3-synthetic-2-off-axis-zero-roll"
): V3CandidateObservabilityInput {
  const fixture = syntheticFixtureById(fixtureId);
  const solved = runProductionV2FloorSolve({
    floorPixels: fixture.floorEvidencePixels,
    dimensions: fixture.floorDimensions,
    intrinsics: fixture.intrinsics,
  });
  assert.equal(solved.ok, true, fixtureId);
  if (!solved.ok) throw new Error("Synthetic production v2 solve failed.");
  const basis = {
    basisId: `${fixture.manifest.id}:basis`,
    basisFingerprint: `${fixture.manifest.id}:fingerprint`,
    sourceImageUrl: "https://example.test/room.jpg",
    decodedWidth: fixture.intrinsics.width,
    decodedHeight: fixture.intrinsics.height,
    encodedOrientation: 1 as const,
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
  const sourceFloorPolygon = fixture.floorEvidencePixels.map((point) => ({
    x: point.x / fixture.intrinsics.width,
    y: point.y / fixture.intrinsics.height,
  }));
  const snapshot: V3CandidateCalibratedCameraSnapshot = {
    pose: solved.decomposition.pose,
    fovDeg: fixture.intrinsics.verticalFovDeg,
    frameSize: { width: fixture.intrinsics.width, height: fixture.intrinsics.height },
    diagnosticsSummary: "synthetic production v2",
    appliedAtIso: "2026-07-20T00:00:00.000Z",
    imageBasis: basis,
    sourceFloorPolygon,
  };
  return {
    isCalibratedCameraActive: true,
    calibratedCameraSnapshot: snapshot,
    qualifiedImageBasis: basis,
    sourceNormalizedFloorPolygon: sourceFloorPolygon,
    floorMapping: {
      worldWidth: fixture.floorDimensions.widthMeters,
      worldDepth: fixture.floorDimensions.depthMeters,
    },
    verticalEvidenceRuntimeObservations: runtime(fixture.verticalEvidence.map(({ observation }) => observation)),
  };
}

function evaluated(input: V3CandidateObservabilityInput) {
  const value = evaluateV3CandidateObservability(input);
  assert.equal(value.kind, "evaluated");
  if (value.kind !== "evaluated") throw new Error("Unexpected unavailable result.");
  return value;
}

function unavailableReason(input: V3CandidateObservabilityInput) {
  const value = evaluateV3CandidateObservability(input);
  if (value.kind === "unavailable") return value.reason;
  assert.fail("Expected an adapter-level unavailable result.");
}

test("retained production-v2 pose reconstructs the Package 2A CV basis and Floor projection", () => {
  const input = productionInput();
  const value = evaluated(input);
  assert.ok((value.result.initial.floorRmsPx ?? Infinity) < 1e-7);
  assert.equal(value.result.status, "no_op");

  // The test input originates in the production v2 solve; no decomposition
  // world-to-CV matrix is copied into the adapter input.
  const fixture = syntheticFixtureById("v3-synthetic-2-off-axis-zero-roll");
  const syntheticSnapshot = value.result.candidatePose;
  assert.ok(syntheticSnapshot);
  assert.deepEqual(syntheticSnapshot?.position, input.calibratedCameraSnapshot?.pose.position);
  assert.deepEqual(syntheticSnapshot?.lookAt, input.calibratedCameraSnapshot?.pose.lookAt);
  assert.ok(fixture.floorEvidencePixels.length === 4);
});

test("adapter refuses only unavailable active-v2 construction inputs", () => {
  const base = productionInput();
  assert.deepEqual(evaluateV3CandidateObservability({ ...base, isCalibratedCameraActive: false }), {
    kind: "unavailable",
    reason: "calibrated_camera_inactive",
    detail: "The calibrated-camera/v2 authority is not active.",
  });
  assert.equal(evaluateV3CandidateObservability({ ...base, calibratedCameraSnapshot: null }).kind, "unavailable");
  assert.equal(unavailableReason({ ...base, qualifiedImageBasis: null }), "image_basis_unqualified");
  assert.equal(
    unavailableReason({
      ...base,
      qualifiedImageBasis: { ...base.qualifiedImageBasis!, basisFingerprint: "different" },
    }),
    "image_basis_unqualified"
  );
  assert.equal(
    unavailableReason({
      ...base,
      sourceNormalizedFloorPolygon: [{ x: 0, y: 0 }, ...base.sourceNormalizedFloorPolygon.slice(1)],
    }),
    "floor_polygon_mismatch"
  );
  assert.equal(
    unavailableReason({ ...base, floorMapping: { ...base.floorMapping, worldWidth: 0 } }),
    "floor_mapping_invalid"
  );
  assert.equal(
    unavailableReason({
      ...base,
      calibratedCameraSnapshot: {
        ...base.calibratedCameraSnapshot!,
        pose: { ...base.calibratedCameraSnapshot!.pose, lookAt: { ...base.calibratedCameraSnapshot!.pose.position } },
      },
    }),
    "camera_pose_invalid"
  );
  assert.equal(
    unavailableReason({
      ...base,
      calibratedCameraSnapshot: {
        ...base.calibratedCameraSnapshot!,
        pose: {
          ...base.calibratedCameraSnapshot!.pose,
          up: { x: Number.NaN, y: 1, z: 0 },
        },
      },
    }),
    "camera_pose_invalid"
  );
});

test("solver-owned evidence statuses and exclusions remain visible", () => {
  const base = productionInput();
  const zero = evaluated({ ...base, verticalEvidenceRuntimeObservations: runtime([]) });
  assert.equal(zero.result.status, "insufficient_evidence");
  assert.equal(zero.result.rawObservationCount, 0);

  const one = evaluated({
    ...base,
    verticalEvidenceRuntimeObservations: runtime([base.verticalEvidenceRuntimeObservations.observations[0].observation]),
  });
  assert.equal(one.result.status, "insufficient_evidence");
  assert.equal(one.result.distinctPhysicalVerticalCount, 1);

  const nonCurrentId = base.verticalEvidenceRuntimeObservations.observations[0].observation.observationId;
  const nonCurrent = evaluated({
    ...base,
    verticalEvidenceRuntimeObservations: runtime(
      base.verticalEvidenceRuntimeObservations.observations.map(({ observation }) => observation),
      { [nonCurrentId]: { usability: "stale", eligible: false } }
    ),
  });
  assert.deepEqual(nonCurrent.result.excludedObservations.find((item) => item.observationId === nonCurrentId), {
    observationId: nonCurrentId,
    reason: "not_current",
  });

  const ineligibleId = base.verticalEvidenceRuntimeObservations.observations[1].observation.observationId;
  const malformedId = base.verticalEvidenceRuntimeObservations.observations[2].observation.observationId;
  const observations = base.verticalEvidenceRuntimeObservations.observations.map(({ observation }) =>
    observation.observationId === malformedId
      ? {
          ...observation,
          sourceNormalizedEndpoints: {
            lower: { ...observation.sourceNormalizedEndpoints.lower, x: Number.NaN },
            upper: { ...observation.sourceNormalizedEndpoints.upper },
          },
        }
      : observation
  );
  const passedThrough = evaluated({
    ...base,
    verticalEvidenceRuntimeObservations: runtime(observations, {
      [ineligibleId]: { eligible: false },
    }),
  });
  assert.equal(passedThrough.result.excludedObservations.find((item) => item.observationId === ineligibleId)?.reason, "not_eligible");
  assert.equal(passedThrough.result.excludedObservations.find((item) => item.observationId === malformedId)?.reason, "non_finite");
});

test("preserves persisted evidence fidelity while adding only runtime decisions", () => {
  const base = productionInput();
  const original = base.verticalEvidenceRuntimeObservations.observations[0].observation;
  const value = evaluated({
    ...base,
    verticalEvidenceRuntimeObservations: runtime([original], {
      [original.observationId]: { usability: "needs_review", eligible: false },
    }),
  });
  assert.equal(value.result.excludedObservations[0]?.observationId, original.observationId);
  assert.equal(value.result.excludedObservations[0]?.reason, "not_current");
  assert.equal(value.provenance.observationCounts.persisted, 1);
  assert.equal(value.provenance.observationCounts.selected, 1);
  assert.equal(value.provenance.observationCounts.current, 0);
  assert.equal(value.provenance.observationCounts.eligible, 0);

  const changedEndpoints: VerticalEvidenceObservation = {
    ...original,
    sourceNormalizedEndpoints: {
      lower: { ...original.sourceNormalizedEndpoints.lower, x: original.sourceNormalizedEndpoints.lower.x + 0.001 },
      upper: { ...original.sourceNormalizedEndpoints.upper },
    },
  };
  const changedAnchor: VerticalEvidenceObservation = {
    ...original,
    frozenWorldAnchor: { ...original.frozenWorldAnchor, x: original.frozenWorldAnchor.x + 0.01 },
  };
  const changedDecision: VerticalEvidenceObservation = {
    ...original,
    operatorDecision: "excluded",
    decisionAtIso: "2026-07-20T00:01:00.000Z",
  };
  const fingerprints = [
    evaluated({ ...base, verticalEvidenceRuntimeObservations: runtime([original, base.verticalEvidenceRuntimeObservations.observations[1].observation]) }).result.fingerprint,
    evaluated({ ...base, verticalEvidenceRuntimeObservations: runtime([changedEndpoints, base.verticalEvidenceRuntimeObservations.observations[1].observation]) }).result.fingerprint,
    evaluated({ ...base, verticalEvidenceRuntimeObservations: runtime([changedAnchor, base.verticalEvidenceRuntimeObservations.observations[1].observation]) }).result.fingerprint,
    evaluated({ ...base, verticalEvidenceRuntimeObservations: runtime([changedDecision, base.verticalEvidenceRuntimeObservations.observations[1].observation]) }).result.fingerprint,
  ];
  assert.equal(new Set(fingerprints).size, fingerprints.length);
});

test("evaluation is deterministic and does not mutate supplied authority or evidence", () => {
  const input = productionInput();
  const before = structuredClone(input);
  const first = evaluated(input);
  const second = evaluated(input);
  assert.deepEqual(first, second);
  assert.equal(first.result.fingerprint, second.result.fingerprint);
  assert.deepEqual(input, before);
});

test("adapter source remains isolated from rendering, Apply, and persistence paths", () => {
  const source = readFileSync(new URL("./v3-candidate-observability.ts", import.meta.url), "utf8");
  for (const forbidden of [
    "from \"react\"",
    "from \"three\"",
    "calibrated-camera-apply",
    "scene-state",
    "support-attachment",
    "room-envelope",
    "cameraRef",
  ]) {
    assert.equal(source.includes(forbidden), false, `adapter must not reference ${forbidden}`);
  }
  assert.equal(/from\s+["'][^"']*renderer[^"']*["']/.test(source), false);
  assert.equal((source.match(/solveV3Candidate\(/g) ?? []).length, 1);
});

test("candidate evaluation is absent from scene JSON", () => {
  const input = productionInput();
  const before = structuredClone(input);
  evaluated(input);
  assert.deepEqual(input, before);
  const quad = input.sourceNormalizedFloorPolygon.map((point) => ({ x: point.x, y: point.y }));
  const payload = buildSceneStatePayload({
    exportedAtIso: "2026-07-20T00:00:00.000Z",
    roomImageUrl: "",
    modelPath: "",
    activeObjectType: "none",
    glbLoadStatus: "idle",
    modelNormalization: { modelYOffset: 0, modelYawOffsetDeg: 0, modelScaleMultiplier: 1 },
    transform: { positionX: 0, positionY: 0, positionZ: 0, rotationYDeg: 0, uniformScale: 1, autoRotate: false },
    floor: {
      polygon: quad,
      overlayVisible: false,
      placementModeEnabled: false,
      lastAcceptedClick: null,
      lastRejectedClick: null,
      mapping: { worldWidth: 4, worldDepth: 4, depthCenterY: 0.5 },
      perspectiveDepthScaling: { enabled: false, nearScaleMultiplier: 1, farScaleMultiplier: 1, nearFloorY: 0, farFloorY: 1 },
    },
    image: null,
    calibration: undefined,
    calibrationAppliedAuthority: undefined,
    supports: {
      floor: {
        sourceNormalizedPolygon: quad,
        reviewStatus: "unavailable",
        source: "manual",
        supportImageBasis: null,
        authorityEligible: false,
      },
      walls: { wall_back: null, wall_left: null, wall_right: null },
      ceiling: null,
    },
    attachment: null,
    verticalEvidence: null,
    debug: { rendererSize: { width: 0, height: 0 }, imageStatus: "idle", modelStatus: "idle" },
  } satisfies SceneStatePayloadInput);
  const forbiddenKeys = new Set(["candidatePose", "theta", "omegaXRad", "omegaZRad", "candidateReport"]);
  const visit = (value: unknown): void => {
    if (typeof value === "string") assert.equal(value.startsWith("v3fnv1a-"), false);
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, `scene payload contains ${key}`);
      visit(child);
    }
  };
  visit(payload);
});

test("zero correction projection helper retains Package 2A intrinsic convention", () => {
  const value = evaluated(productionInput());
  assert.ok(value.result.candidatePose);
  const candidate = value.result.candidatePose!;
  const snapshot: V3ActiveV2Snapshot = {
    authorityVersion: "test",
    appliedAtIso: "2026-07-20T00:00:00.000Z",
    calibrationVersion: "test",
    solverIdentifier: "test",
    frameSize: { width: 1280, height: 800 },
    imageBasis: { id: "test", fingerprint: "test", intrinsicWidth: 1280, intrinsicHeight: 800 },
    verticalFovDeg: candidate.verticalFovDeg,
    worldToCameraCv: candidate.worldToCameraCv,
    position: candidate.position,
    sourceFloorPolygon: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
    floor: { polygonKey: "test", worldWidth: 4, worldDepth: 4 },
  };
  assert.ok(v3ProjectIntrinsic(snapshot, ZERO, { x: 0, y: 0, z: 0 }));
});
