import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import {
  computeProjectionCoherenceDiagnostics,
  signedTiltFromImageVerticalDeg,
  weightedMedian,
  weightedMedianAbsoluteDeviation,
  type ProjectionCoherenceInput,
  type ProjectionCoherenceWallPolygon,
} from "./projection-coherence-diagnostics";
import { sourceNormToContainerNorm } from "./image-space";
import { applyHomography, getFloorRectCorners, solvePlaneHomography, validateOrderedFloorCorners } from "./perspective-solve";
import { deriveWallSupport, type WallPolygon, type WallSupportKind } from "./wall-support-geometry";

const frame = { width: 1118, height: 698, intrinsicWidth: 1264, intrinsicHeight: 848, imageBasisId: "basis", imageBasisFingerprint: "fingerprint" };
const noWalls: ProjectionCoherenceInput["walls"] = [];

function fixture(overrides: Partial<ProjectionCoherenceInput> = {}): ProjectionCoherenceInput {
  return {
    camera: {
      calibratedCameraVersion: "calibrated-camera/v2",
      appliedAtIso: "2026-01-01T00:00:00.000Z",
      fovDeg: 62,
      pose: {
        position: { x: -0.12668965921617842, y: 1.3172796068108077, z: 4.324911370435683 },
        lookAt: { x: -0.153493032292473, y: 1.300344979215656, z: 3.3254140980132183 },
        up: { x: 0.0071526302474179725, y: 0.9998276517543196, z: -0.017132036305902914 },
      },
    },
    frame,
    floor: { polygonKey: "room-a-floor", worldWidth: 4, worldDepth: 4 },
    walls: noWalls,
    attachment: { current: true, supportKind: "floor", contactPointWorld: { x: -0.053340436931521615, y: 0, z: 0.13406475933189954 } },
    floorReprojection: { cvAveragePx: 0.851, cvMaximumPx: 1.291, cvPerCornerPx: [0.7, 0.8, 1.0, 1.291], rendererAveragePx: 0.851, rendererMaximumPx: 1.291, scaleRatio: 1 },
    ...overrides,
  };
}

type CanonicalRoom = {
  name: "A" | "B" | "C";
  intrinsic: { width: number; height: number };
  fovDeg: number;
  mapping: { width: number; depth: number };
  floor: ProjectionCoherenceWallPolygon;
  camera: NonNullable<ProjectionCoherenceInput["camera"]>["pose"];
  walls: Partial<Record<WallSupportKind, ProjectionCoherenceWallPolygon>>;
  refusedLeft?: ProjectionCoherenceWallPolygon;
  anchor: { x: number; z: number };
  reprojection: NonNullable<ProjectionCoherenceInput["floorReprojection"]>;
};

const CANONICAL_ROOMS: readonly CanonicalRoom[] = [
  {
    name: "A", intrinsic: { width: 1264, height: 848 }, fovDeg: 62, mapping: { width: 4, depth: 4 },
    floor: [{ x: 0.11069808467741936, y: 0.9171407926687549 }, { x: 1, y: 0.927 }, { x: 0.6900000000000001, y: 0.647 }, { x: 0.362, y: 0.648 }],
    camera: { position: { x: -0.12668965921617842, y: 1.3172796068108077, z: 4.324911370435683 }, lookAt: { x: -0.153493032292473, y: 1.300344979215656, z: 3.3254140980132183 }, up: { x: 0.0071526302474179725, y: 0.9998276517543196, z: -0.017132036305902914 } },
    walls: {
      wall_back: [{ x: 0.362, y: 0.648 }, { x: 0.6900000000000001, y: 0.647 }, { x: 0.6903561827956989, y: 0.30728766326709694 }, { x: 0.3606245799731182, y: 0.31049631819550844 }],
      wall_left: [{ x: 0.11069808467741936, y: 0.9171407926687549 }, { x: 0.362, y: 0.648 }, { x: 0.36027805779569894, y: 0.30925459482483864 }, { x: 0.11305373543906809, y: 0.034698079454551604 }],
      wall_right: [{ x: 0.6900000000000001, y: 0.647 }, { x: 1, y: 0.927 }, { x: 1, y: 0.034698079454551604 }, { x: 0.6894706261200716, y: 0.3053781222853105 }],
    },
    anchor: { x: -0.053340436931521615, z: 0.13406475933189954 },
    reprojection: { cvAveragePx: 0.851, cvMaximumPx: 1.291, cvPerCornerPx: [1.2, 1.29, 0.5, 0.42], rendererAveragePx: 0.851, rendererMaximumPx: 1.291, scaleRatio: 1 },
  },
  {
    name: "B", intrinsic: { width: 5000, height: 3333 }, fovDeg: 47, mapping: { width: 3.8, depth: 4 },
    floor: [{ x: 0.19639756944444445, y: 0.7230990163453648 }, { x: 0.9899999999999998, y: 0.8700000000000001 }, { x: 0.8362350190412188, y: 0.6374625576375754 }, { x: 0.4558691756272402, y: 0.5966422847824432 }],
    camera: { position: { x: 0.8650443337121687, y: 1.026730078232466, z: 5.25605633824082 }, lookAt: { x: 0.5658053560585476, y: 0.986461021903263, z: 4.30272825339533 }, up: { x: -0.0400329432323816, y: 0.9987591746229256, z: -0.029622197127919917 } },
    walls: {
      wall_back: [{ x: 0.4558691756272402, y: 0.5966422847824432 }, { x: 0.8362350190412188, y: 0.6374625576375754 }, { x: 0.8268947806409609, y: 0.28645912812528673 }, { x: 0.4571236777903786, y: 0.3218787978869965 }],
      wall_left: [{ x: 0.19639756944444445, y: 0.7230990163453648 }, { x: 0.4558691756272402, y: 0.5966422847824432 }, { x: 0.45751778113799285, y: 0.32214372074895875 }, { x: 0.2017564124103943, y: 0.173873639470103 }],
      wall_right: [{ x: 0.8362350190412188, y: 0.6374625576375754 }, { x: 0.9899999999999998, y: 0.8700000000000001 }, { x: 0.9629816308243727, y: 0.06522786308142993 }, { x: 0.8270469310035844, y: 0.28637880620461126 }],
    },
    anchor: { x: 0.029675531283801293, z: 0.21956001285932647 },
    reprojection: { cvAveragePx: 1.607, cvMaximumPx: 2.788, cvPerCornerPx: [1.81, 1.08, 2.79, 0.75], rendererAveragePx: 1.607, rendererMaximumPx: 2.788, scaleRatio: 1 },
  },
  {
    name: "C", intrinsic: { width: 7360, height: 4912 }, fovDeg: 48, mapping: { width: 3, depth: 4 },
    floor: [{ x: 0.045000000000000005, y: 0.9653019205454482 }, { x: 0.6912032370071685, y: 0.7138032156053693 }, { x: 0.4119999999999999, y: 0.617 }, { x: 0.07800000000000003, y: 0.6950000000000001 }],
    camera: { position: { x: -1.2417974535677727, y: 1.016316494972545, z: 4.842226413206968 }, lookAt: { x: -0.7491661350031878, y: 0.9784274514653173, z: 3.9728135053482077 }, up: { x: 0.0896839986318533, y: 0.9959426755230188, z: 0.007414004414120281 } },
    walls: {
      wall_back: [{ x: 0.07800000000000003, y: 0.6950000000000001 }, { x: 0.4119999999999999, y: 0.617 }, { x: 0.41012042739485327, y: 0.3338783144276417 }, { x: 0.07842623802923387, y: 0.22181302540863798 }],
      wall_right: [{ x: 0.4119999999999999, y: 0.617 }, { x: 0.6912032370071685, y: 0.7138032156053693 }, { x: 0.6885487546202959, y: 0.1791307897367448 }, { x: 0.4102434274543571, y: 0.3331937243038378 }],
    },
    refusedLeft: [{ x: 0.06258421957488214, y: 0.8212701532004936 }, { x: 0.07800000000000003, y: 0.6950000000000001 }, { x: 0.07833851366487456, y: 0.22163347825024032 }, { x: 0.06311953965053764, y: 0.03226154195777707 }],
    anchor: { x: -0.05164281125945247, z: 0.15308377571337273 },
    reprojection: { cvAveragePx: 0.541, cvMaximumPx: 0.862, cvPerCornerPx: [0.6, 0.38, 0.32, 0.86], rendererAveragePx: 0.541, rendererMaximumPx: 0.862, scaleRatio: 1 },
  },
];

function deriveCanonicalRoom(room: CanonicalRoom): ProjectionCoherenceInput {
  const display = { width: 1118, height: 698 };
  const container = (polygon: ProjectionCoherenceWallPolygon) => polygon.map((point) => {
    const mapped = sourceNormToContainerNorm(point, room.intrinsic, display);
    assert.ok(mapped, `${room.name} source point maps to display`);
    return mapped;
  }) as unknown as ProjectionCoherenceWallPolygon;
  const rect = getFloorRectCorners({ widthMeters: room.mapping.width, depthMeters: room.mapping.depth });
  assert.ok(rect.ok, `${room.name} Floor rect`);
  if (!rect.ok) throw new Error(`${room.name} invalid Floor rect`);
  const orderedFloor = validateOrderedFloorCorners(container(room.floor) as unknown as { x: number; y: number }[]);
  assert.ok(orderedFloor.ok, `${room.name} Floor order`);
  if (!orderedFloor.ok) throw new Error(`${room.name} Floor order`);
  const homography = solvePlaneHomography(
    orderedFloor.value.asArray.map((point) => ({ x: point.x * display.width, y: point.y * display.height })),
    rect.value.asArray.map((point) => ({ x: point.x, y: point.z }))
  );
  assert.ok(homography.ok, `${room.name} Floor homography`);
  if (!homography.ok) throw new Error(`${room.name} Floor homography`);
  const camera = new THREE.PerspectiveCamera(room.fovDeg, display.width / display.height, 0.1, 100);
  camera.position.set(room.camera.position.x, room.camera.position.y, room.camera.position.z);
  camera.up.set(room.camera.up.x, room.camera.up.y, room.camera.up.z);
  camera.lookAt(room.camera.lookAt.x, room.camera.lookAt.y, room.camera.lookAt.z);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const ray = (point: { x: number; y: number }) => {
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(point.x * 2 - 1, 1 - point.y * 2, 0.5).unproject(camera);
    return { origin: { x: origin.x, y: origin.y, z: origin.z }, direction: target.sub(origin).normalize() };
  };
  const project = (point: { x: number; y: number; z: number }) => {
    const ndc = new THREE.Vector3(point.x, point.y, point.z).project(camera);
    return { x: (ndc.x + 1) * display.width / 2, y: (1 - ndc.y) * display.height / 2 };
  };
  const inputWall = (kind: WallSupportKind, polygon: ProjectionCoherenceWallPolygon, reviewState = "manually_confirmed", confirmationCurrent = true, runtimeUsable = true) => {
    const displayPolygon = container(polygon);
    const derivation = deriveWallSupport({
      kind,
      polygonSourceNorm: polygon as unknown as WallPolygon,
      polygonContainerNorm: displayPolygon as unknown as WallPolygon,
      frameSize: display,
      mapImagePixelToFloor: (point) => applyHomography(homography.value, point),
      cameraPosition: room.camera.position,
      rays: displayPolygon.map(ray) as [ReturnType<typeof ray>, ReturnType<typeof ray>, ReturnType<typeof ray>, ReturnType<typeof ray>],
      projectWorldToPixels: project,
      floorBounds: { minX: -room.mapping.width / 2, maxX: room.mapping.width / 2, minZ: -room.mapping.depth / 2, maxZ: room.mapping.depth / 2 },
    });
    return { kind, enabled: true, reviewState, confirmationCurrent, runtimeUsable, sourcePolygon: polygon, derivation };
  };
  const walls = (Object.entries(room.walls) as [WallSupportKind, ProjectionCoherenceWallPolygon][]).map(([kind, polygon]) => inputWall(kind, polygon));
  if (room.refusedLeft) walls.push(inputWall("wall_left", room.refusedLeft, "needs_review", false, false));
  return {
    camera: { calibratedCameraVersion: "calibrated-camera/v2", appliedAtIso: `${room.name}-applied`, fovDeg: room.fovDeg, pose: room.camera },
    frame: { ...display, intrinsicWidth: room.intrinsic.width, intrinsicHeight: room.intrinsic.height, imageBasisId: `${room.name}-basis`, imageBasisFingerprint: `${room.name}-fingerprint` },
    floor: { polygonKey: `${room.name}-floor`, worldWidth: room.mapping.width, worldDepth: room.mapping.depth },
    walls,
    attachment: { current: true, supportKind: "floor", contactPointWorld: { x: room.anchor.x, y: 0, z: room.anchor.z } },
    floorReprojection: room.reprojection,
  };
}

test("camera roll, yaw, lateral offset, and anchor projection use requested signs", () => {
  const result = computeProjectionCoherenceDiagnostics(fixture());
  assert.equal(result.camera.roll.state, "available");
  assert.equal(result.camera.yaw.state, "available");
  assert.equal(result.camera.normalizedLateralOffset.state, "available");
  assert.ok(Math.abs(result.camera.roll.value + 0.436) < 0.05);
  assert.ok(Math.abs(result.camera.yaw.value + 1.54) < 0.05);
  assert.ok(Math.abs(result.camera.normalizedLateralOffset.value - 0.0633) < 0.001);
  assert.equal(result.anchorProjection.state, "available");
  assert.ok(result.anchorProjection.value.horizontalPixelsPerVerticalMetre < 0);
  assert.ok(result.anchorProjection.value.bothInFront);
});

test("source structural tilt, residual, physical IDs, and frame exclusions are deterministic", () => {
  const wall = {
    kind: "wall_back" as const,
    enabled: true,
    reviewState: "manually_confirmed",
    confirmationCurrent: true,
    runtimeUsable: true,
    sourcePolygon: [
      { x: 0.2, y: 0.7 }, { x: 0.6, y: 0.7 }, { x: 0.61, y: 0.3 }, { x: 0.21, y: 0.3 },
    ] as const,
    derivation: {
      ok: true as const,
      boundaryUV: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2.1, y: 2 }, { x: 0.1, y: 2 }],
      boundaryWorld: [{ x: -1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 2, z: 1 }, { x: -1, y: 2, z: 1 }],
      diagnostics: {
        upperRayPlaneDenominatorStart: 0.4, upperRayPlaneDenominatorEnd: 0.5, minUpperRayPlaneDenominator: 0.4,
        minUpperRayPlaneDenominatorThreshold: 0.035, maxRoundTripReprojectionErrorPx: 0.1,
        lowerSeamDisagreementStartWorld: 0.01, lowerSeamDisagreementEndWorld: 0.02,
      },
    },
  };
  const result = computeProjectionCoherenceDiagnostics(fixture({ walls: [wall] }));
  assert.equal(result.structural.observations.length, 2);
  assert.deepEqual(result.structural.observations.map((edge) => edge.physicalVerticalId), ["back_left", "back_right"]);
  assert.ok(result.structural.observations.every((edge) => edge.observedTiltDeg !== null));
  assert.equal(result.structural.rawObservedTilt.state, "available");
  assert.equal(result.walls[0].endpoint1LateralDriftM, 0.1);
  assert.ok(result.walls[0].endpoint1LeanDeg! > 0);

  const coincident = { ...wall, sourcePolygon: [{ x: 0, y: 0.7 }, { x: 0.6, y: 0.7 }, { x: 0.61, y: 0.3 }, { x: 0, y: 0.3 }] as const };
  const excluded = computeProjectionCoherenceDiagnostics(fixture({ walls: [coincident] })).structural.observations[0];
  assert.equal(excluded.frameCoincident, true);
  assert.equal(excluded.exclusionReason, "frame_coincident_edge");
});

test("weighted estimators use a documented deterministic lower-bound tie rule", () => {
  assert.equal(weightedMedian([{ value: -2, weight: 1 }, { value: 4, weight: 1 }]), -2);
  assert.equal(weightedMedianAbsoluteDeviation([{ value: -2, weight: 1 }, { value: 4, weight: 1 }], -2), 0);
  assert.equal(signedTiltFromImageVerticalDeg({ x: 10, y: 100 }, { x: 20, y: 0 })! > 0, true);
});

test("Room B and Room C canonical camera neighborhoods remain observational only", () => {
  const roomB = computeProjectionCoherenceDiagnostics(fixture({
    frame: { ...frame, intrinsicWidth: 5000, intrinsicHeight: 3333 },
    floor: { polygonKey: "room-b-floor", worldWidth: 3.8, worldDepth: 4 },
    camera: {
      calibratedCameraVersion: "calibrated-camera/v2", appliedAtIso: "b", fovDeg: 47,
      pose: {
        position: { x: 0.8650443337121687, y: 1.026730078232466, z: 5.25605633824082 },
        lookAt: { x: 0.5658053560585476, y: 0.986461021903263, z: 4.30272825339533 },
        up: { x: -0.0400329432323816, y: 0.9987591746229256, z: -0.029622197127919917 },
      },
    },
  }));
  if (roomB.camera.roll.state !== "available" || roomB.camera.yaw.state !== "available") assert.fail("Room B camera diagnostics unavailable");
  assert.ok(Math.abs(roomB.camera.roll.value - 1.68) < 0.1);
  assert.ok(Math.abs(roomB.camera.yaw.value + 17.43) < 0.1);

  const roomC = computeProjectionCoherenceDiagnostics(fixture({
    frame: { ...frame, intrinsicWidth: 7360, intrinsicHeight: 4912 },
    floor: { polygonKey: "room-c-floor", worldWidth: 3, worldDepth: 4 },
    camera: {
      calibratedCameraVersion: "calibrated-camera/v2", appliedAtIso: "c", fovDeg: 48,
      pose: {
        position: { x: -1.2417974535677727, y: 1.016316494972545, z: 4.842226413206968 },
        lookAt: { x: -0.7491661350031878, y: 0.9784274514653173, z: 3.9728135053482077 },
        up: { x: 0.0896839986318533, y: 0.9959426755230188, z: 0.007414004414120281 },
      },
    },
  }));
  if (roomC.camera.roll.state !== "available" || roomC.camera.yaw.state !== "available") assert.fail("Room C camera diagnostics unavailable");
  assert.ok(Math.abs(roomC.camera.roll.value + 4.685) < 0.1);
  assert.ok(Math.abs(roomC.camera.yaw.value - 29.54) < 0.1);
});

test("refused walls, missing runtime inputs, and source inputs remain read-only", () => {
  const refused = {
    kind: "wall_left" as const, enabled: true, reviewState: "needs_review", confirmationCurrent: false, runtimeUsable: false,
    sourcePolygon: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 1 }, { x: 0, y: 1 }] as const,
    derivation: { ok: false as const, reasons: ["wall_upper_reconstruction_ill_conditioned"], diagnostics: { minUpperRayPlaneDenominator: 0.0035 } },
  };
  const input = fixture({ walls: [refused] });
  const before = JSON.stringify(input);
  const result = computeProjectionCoherenceDiagnostics(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(result.walls[0].derivation, "refused");
  assert.deepEqual(result.walls[0].refusalReasons, ["wall_upper_reconstruction_ill_conditioned"]);
  assert.equal(result.structural.observations.length, 0);
  const unavailable = computeProjectionCoherenceDiagnostics(fixture({ camera: null, frame: null, attachment: null, walls: [] }));
  assert.equal(unavailable.camera.roll.state, "unavailable");
  assert.equal(unavailable.anchorProjection.state, "unavailable");
});

test("display-ready output never exposes NaN or Infinity", () => {
  const result = computeProjectionCoherenceDiagnostics(fixture({
    frame: { ...frame, intrinsicWidth: Number.NaN, intrinsicHeight: Number.POSITIVE_INFINITY },
    floor: { polygonKey: null, worldWidth: Number.NaN, worldDepth: Number.POSITIVE_INFINITY },
    floorReprojection: { cvAveragePx: Number.NaN, cvMaximumPx: Infinity, cvPerCornerPx: [NaN, Infinity], rendererAveragePx: null, rendererMaximumPx: null, scaleRatio: NaN },
  }));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("NaN"), false);
  assert.equal(serialized.includes("Infinity"), false);
  assert.equal(result.structural.observations.length, 0);
});

function near(actual: number | null, expected: number, tolerance: number, label: string): void {
  if (actual === null) assert.fail(`${label} is available`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected} ± ${tolerance}, got ${actual}`);
}

function available<T>(value: { state: string; value?: T; reason?: string }, label: string): T {
  assert.equal(value.state, "available", `${label}: ${value.reason ?? "unavailable"}`);
  return value.value as T;
}

function canonical(name: CanonicalRoom["name"]) {
  const room = CANONICAL_ROOMS.find((candidate) => candidate.name === name);
  assert.ok(room, `Room ${name} fixture exists`);
  return computeProjectionCoherenceDiagnostics(deriveCanonicalRoom(room));
}

function wallByKind(result: ReturnType<typeof canonical>, kind: WallSupportKind) {
  const wall = result.walls.find((candidate) => candidate.kind === kind);
  assert.ok(wall, `${kind} diagnostic exists`);
  return wall;
}

test("Room A canonical fixture preserves coherent diagnostics and frame-truncation semantics", () => {
  const result = canonical("A");
  const roll = available(result.camera.roll, "A roll");
  const yaw = available(result.camera.yaw, "A yaw");
  const offset = available(result.camera.normalizedLateralOffset, "A offset");
  const anchor = available(result.anchorProjection, "A anchor");
  const raw = available(result.structural.rawObservedTilt, "A raw structural");
  const residual = available(result.structural.locationMatchedResidual, "A residual structural");
  near(roll, -0.436, 0.01, "A roll");
  near(yaw, -1.54, 0.01, "A yaw");
  near(offset, 0.063, 0.002, "A lateral offset");
  near(anchor.tiltDeg, -0.39, 0.02, "A anchor tilt");
  near(anchor.horizontalPixelsPerVerticalMetre, -0.95, 0.05, "A anchor horizontal px/m");
  near(anchor.projectedPixelsPerVerticalMetre, 137.8, 0.2, "A anchor projected px/m");
  assert.equal(raw.eligibleObservationCount, 5);
  assert.equal(raw.distinctPhysicalVerticalCount, 3);
  near(raw.valueDeg, 0.09, 0.15, "A raw estimator");
  near(residual.valueDeg, 0.35, 0.15, "A location-matched estimator");
  near(raw.weightedMadDeg, 0.138, 0.015, "A weighted MAD");
  assert.ok((raw.leaveOneOutRangeDeg ?? Infinity) < 0.25, "A raw leave-one-out sensitivity remains small");
  const frontRight = result.structural.observations.find((observation) => observation.physicalVerticalId === "front_right");
  assert.ok(frontRight);
  assert.equal(frontRight.frameTouching, true);
  assert.equal(frontRight.frameCoincident, true);
  assert.equal(frontRight.inclusion, "excluded");
  assert.equal(frontRight.exclusionReason, "frame_coincident_edge");
  assert.equal(result.structural.observations.length, 6, "truncated observations remain visible");

  const back = wallByKind(result, "wall_back");
  const left = wallByKind(result, "wall_left");
  const right = wallByKind(result, "wall_right");
  for (const wall of [back, left, right]) assert.equal(wall.derivation, "accepted");
  near(back.endpoint1LateralDriftM, 0.017, 0.002, "A back drift 1"); near(back.endpoint2LateralDriftM, 0.008, 0.002, "A back drift 2");
  near(back.endpoint1LeanDeg, 0.35, 0.03, "A back lean 1"); near(back.endpoint2LeanDeg, 0.17, 0.03, "A back lean 2");
  near(back.endpoint1UpperRayPlaneDenominator, -0.937, 0.002, "A back conditioning 1"); near(back.endpoint2UpperRayPlaneDenominator, -0.927, 0.002, "A back conditioning 2");
  near(left.endpoint1LateralDriftM, 0.087, 0.003, "A left drift 1"); near(left.endpoint2LateralDriftM, 0.043, 0.003, "A left drift 2");
  near(left.endpoint1LeanDeg, 1.80, 0.05, "A left lean 1"); near(left.endpoint2LeanDeg, 0.89, 0.05, "A left lean 2");
  near(left.endpoint1UpperRayPlaneDenominator, -0.554, 0.003, "A left conditioning 1"); near(left.endpoint2UpperRayPlaneDenominator, -0.276, 0.003, "A left conditioning 2");
  near(right.endpoint1LateralDriftM, -0.007, 0.002, "A right drift 1"); near(right.endpoint2LateralDriftM, -0.024, 0.003, "A right drift 2");
  near(right.endpoint1LeanDeg, -0.15, 0.03, "A right lean 1"); near(right.endpoint2LeanDeg, -0.53, 0.04, "A right lean 2");
  near(right.endpoint1UpperRayPlaneDenominator, -0.310, 0.003, "A right conditioning 1"); near(right.endpoint2UpperRayPlaneDenominator, -0.621, 0.003, "A right conditioning 2");
  const drifts = [back, left, right].flatMap((wall) => [wall.endpoint1LateralDriftM!, wall.endpoint2LateralDriftM!]).map(Math.abs).sort((a, b) => a - b);
  const leans = [back, left, right].flatMap((wall) => [wall.endpoint1LeanDeg!, wall.endpoint2LeanDeg!]).map(Math.abs).sort((a, b) => a - b);
  near(drifts.at(-1) ?? null, 0.087, 0.003, "A max drift"); near((drifts[2] + drifts[3]) / 2, 0.021, 0.003, "A median drift");
  near(leans.at(-1) ?? null, 1.80, 0.05, "A max lean"); near((leans[2] + leans[3]) / 2, 0.44, 0.05, "A median lean");
  const floor = available(result.floorReprojection, "A Floor");
  near(floor.cvAveragePx, 0.851, 0.001, "A CV average"); near(floor.cvMaximumPx, 1.291, 0.001, "A CV maximum");
  assert.deepEqual(floor.cvPerCornerPx, [1.2, 1.29, 0.5, 0.42]);
  near(floor.cvVsRendererAverageDifferencePx, 0, 1e-9, "A CV-render average"); near(floor.cvVsRendererMaximumDifferencePx, 0, 1e-9, "A CV-render maximum");
});

test("Room B canonical fixture retains both structural families and accepted grazing wall", () => {
  const result = canonical("B");
  const roll = available(result.camera.roll, "B roll");
  const yaw = available(result.camera.yaw, "B yaw");
  const offset = available(result.camera.normalizedLateralOffset, "B offset");
  const anchor = available(result.anchorProjection, "B anchor");
  const raw = available(result.structural.rawObservedTilt, "B raw");
  const residual = available(result.structural.locationMatchedResidual, "B residual");
  near(roll, 1.680, 0.01, "B roll"); near(yaw, -17.43, 0.02, "B yaw"); near(offset, 0.455, 0.002, "B lateral offset");
  near(anchor.tiltDeg, 2.01, 0.03, "B anchor tilt"); near(anchor.horizontalPixelsPerVerticalMetre, 5.52, 0.05, "B anchor horizontal px/m"); near(anchor.projectedPixelsPerVerticalMetre, 157.65, 0.15, "B anchor projected px/m");
  near(raw.valueDeg, -2.248, 0.01, "B raw estimator"); near(residual.valueDeg, -5.03, 0.03, "B residual estimator");
  near(raw.weightedMadDeg, 0.635, 0.01, "B weighted MAD"); near(raw.rangeDeg, 3.72, 0.03, "B raw range");
  near(residual.leaveOneOutMinimumDeg, -5.07, 0.03, "B residual LOO min"); near(residual.leaveOneOutMaximumDeg, -1.15, 0.03, "B residual LOO max");
  assert.ok((residual.leaveOneOutRangeDeg ?? 0) > 3.8, "B leave-one-out reveals estimator instability");
  assert.equal(raw.eligibleObservationCount, 6); assert.equal(raw.distinctPhysicalVerticalCount, 4);
  assert.notEqual(raw.eligibleObservationCount, raw.distinctPhysicalVerticalCount, "shared physical corners are not collapsed");
  const representative = result.structural.observations.map((observation) => observation.locationMatchedResidualDeg);
  near(representative[2], 0.13, 0.03, "B left start residual"); near(representative[3], -1.03, 0.03, "B left end residual");
  near(representative[0], -1.15, 0.03, "B back start residual"); near(representative[1], -5.07, 0.03, "B back end residual");
  near(representative[4], -5.03, 0.03, "B right start residual"); near(representative[5], -6.18, 0.03, "B right end residual");
  const back = wallByKind(result, "wall_back"); const left = wallByKind(result, "wall_left"); const right = wallByKind(result, "wall_right");
  near(back.endpoint1LateralDriftM, -0.042, 0.003, "B back drift 1"); near(back.endpoint2LateralDriftM, -0.174, 0.003, "B back drift 2");
  near(back.endpoint1LeanDeg, -1.23, 0.05, "B back lean 1"); near(back.endpoint2LeanDeg, -4.61, 0.05, "B back lean 2");
  near(back.endpoint1UpperRayPlaneDenominator, -0.926, 0.003, "B back conditioning 1"); near(back.endpoint2UpperRayPlaneDenominator, -0.982, 0.003, "B back conditioning 2");
  near(left.endpoint1LateralDriftM, 0.006, 0.003, "B left drift 1"); near(left.endpoint2LateralDriftM, -0.098, 0.003, "B left drift 2");
  near(left.endpoint1LeanDeg, 0.18, 0.05, "B left lean 1"); near(left.endpoint2LeanDeg, -2.86, 0.05, "B left lean 2");
  near(left.endpoint1UpperRayPlaneDenominator, -0.629, 0.003, "B left conditioning 1"); near(left.endpoint2UpperRayPlaneDenominator, -0.357, 0.003, "B left conditioning 2");
  assert.equal(right.derivation, "accepted");
  near(right.endpoint1LateralDriftM, -1.519, 0.003, "B right drift 1"); near(right.endpoint2LateralDriftM, -0.753, 0.003, "B right drift 2");
  near(right.endpoint1LeanDeg, -31.90, 0.05, "B right lean 1"); near(right.endpoint2LeanDeg, -17.76, 0.05, "B right lean 2");
  // The current authoritative derivation makes the requested drift/lean values
  // mathematically consistent with 2.440/2.350 m heights; do not rewrite it.
  near(right.endpoint1HeightM, 2.440, 0.003, "B right derived height 1"); near(right.endpoint2HeightM, 2.350, 0.003, "B right derived height 2");
  near(right.endpoint1UpperRayPlaneDenominator, -0.114, 0.002, "B right conditioning 1"); near(right.endpoint2UpperRayPlaneDenominator, -0.238, 0.002, "B right conditioning 2");
  near(right.conditioningMargin, 0.079, 0.002, "B conditioning margin"); near(right.conditioningMultiple, 3.26, 0.02, "B conditioning multiple");
  const drifts = [back, left, right].flatMap((wall) => [wall.endpoint1LateralDriftM!, wall.endpoint2LateralDriftM!]).map(Math.abs).sort((a, b) => a - b);
  const leans = [back, left, right].flatMap((wall) => [wall.endpoint1LeanDeg!, wall.endpoint2LeanDeg!]).map(Math.abs).sort((a, b) => a - b);
  near(drifts.at(-1) ?? null, 1.519, 0.003, "B max drift"); near((drifts[2] + drifts[3]) / 2, 0.136, 0.01, "B median drift");
  near(leans.at(-1) ?? null, 31.90, 0.05, "B max lean"); near((leans[2] + leans[3]) / 2, 3.73, 0.08, "B median lean");
  const floor = available(result.floorReprojection, "B Floor");
  near(floor.cvAveragePx, 1.607, 0.001, "B CV average"); near(floor.cvMaximumPx, 2.788, 0.001, "B CV maximum");
  assert.deepEqual(floor.cvPerCornerPx, [1.81, 1.08, 2.79, 0.75]);
  near(floor.cvVsRendererAverageDifferencePx, 0, 1e-9, "B CV-render average"); near(floor.cvVsRendererMaximumDifferencePx, 0, 1e-9, "B CV-render maximum");
});

test("Room C canonical fixture retains coherent disagreement and refuses Left wall", () => {
  const result = canonical("C");
  const roll = available(result.camera.roll, "C roll"); const yaw = available(result.camera.yaw, "C yaw"); const offset = available(result.camera.normalizedLateralOffset, "C offset");
  const anchor = available(result.anchorProjection, "C anchor"); const raw = available(result.structural.rawObservedTilt, "C raw"); const residual = available(result.structural.locationMatchedResidual, "C residual");
  near(roll, -4.685, 0.01, "C roll"); near(yaw, 29.54, 0.02, "C yaw"); near(offset, 0.828, 0.002, "C lateral offset");
  near(anchor.tiltDeg, -5.28, 0.03, "C anchor tilt"); near(anchor.horizontalPixelsPerVerticalMetre, -15.35, 0.08, "C anchor horizontal px/m"); near(anchor.projectedPixelsPerVerticalMetre, 166.8, 0.3, "C anchor projected px/m");
  near(raw.valueDeg, -0.426, 0.01, "C raw estimator"); near(residual.valueDeg, 4.41, 0.03, "C residual estimator"); near(raw.weightedMadDeg, 0.105, 0.01, "C weighted MAD");
  near(residual.leaveOneOutMinimumDeg, 4.41, 0.03, "C residual LOO min"); near(residual.leaveOneOutMaximumDeg, 4.45, 0.03, "C residual LOO max");
  assert.ok((residual.leaveOneOutRangeDeg ?? Infinity) < 0.05, "C residual leave-one-out remains tight");
  assert.equal(raw.eligibleObservationCount, 4); assert.equal(raw.distinctPhysicalVerticalCount, 3);
  assert.deepEqual(result.structural.observations.map((observation) => observation.wallKind), ["wall_back", "wall_back", "wall_right", "wall_right"]);
  const back = wallByKind(result, "wall_back"); const right = wallByKind(result, "wall_right"); const left = wallByKind(result, "wall_left");
  near(back.endpoint1LateralDriftM, 0.240, 0.003, "C back drift 1"); near(back.endpoint2LateralDriftM, 0.162, 0.003, "C back drift 2");
  near(back.endpoint1LeanDeg, 5.20, 0.05, "C back lean 1"); near(back.endpoint2LeanDeg, 4.71, 0.05, "C back lean 2");
  near(back.endpoint1UpperRayPlaneDenominator, -0.973, 0.003, "C back conditioning 1"); near(back.endpoint2UpperRayPlaneDenominator, -0.913, 0.003, "C back conditioning 2");
  near(right.endpoint1LateralDriftM, 0.386, 0.003, "C right drift 1"); near(right.endpoint2LateralDriftM, 0.167, 0.003, "C right drift 2");
  near(right.endpoint1LeanDeg, 11.36, 0.05, "C right lean 1"); near(right.endpoint2LeanDeg, 5.01, 0.05, "C right lean 2");
  near(right.endpoint1UpperRayPlaneDenominator, -0.388, 0.003, "C right conditioning 1"); near(right.endpoint2UpperRayPlaneDenominator, -0.697, 0.003, "C right conditioning 2");
  assert.equal(left.derivation, "refused"); assert.deepEqual(left.refusalReasons, ["wall_upper_reconstruction_ill_conditioned"]);
  near(left.endpoint1UpperRayPlaneDenominator, -0.0054, 0.0002, "C Left conditioning 1"); near(left.endpoint2UpperRayPlaneDenominator, -0.0035, 0.0002, "C Left conditioning 2");
  assert.equal(result.structural.observations.some((observation) => observation.wallKind === "wall_left"), false, "no phantom Left geometry");
  const drifts = [back, right].flatMap((wall) => [wall.endpoint1LateralDriftM!, wall.endpoint2LateralDriftM!]).map(Math.abs).sort((a, b) => a - b);
  const leans = [back, right].flatMap((wall) => [wall.endpoint1LeanDeg!, wall.endpoint2LeanDeg!]).map(Math.abs).sort((a, b) => a - b);
  near(drifts.at(-1) ?? null, 0.386, 0.003, "C max drift"); near((drifts[1] + drifts[2]) / 2, 0.203, 0.01, "C median drift");
  near(leans.at(-1) ?? null, 11.36, 0.05, "C max lean"); near((leans[1] + leans[2]) / 2, 5.10, 0.08, "C median lean");
  const floor = available(result.floorReprojection, "C Floor");
  near(floor.cvAveragePx, 0.541, 0.001, "C CV average"); near(floor.cvMaximumPx, 0.862, 0.001, "C CV maximum");
  assert.deepEqual(floor.cvPerCornerPx, [0.6, 0.38, 0.32, 0.86]);
  near(floor.cvVsRendererAverageDifferencePx, 0, 1e-9, "C CV-render average"); near(floor.cvVsRendererMaximumDifferencePx, 0, 1e-9, "C CV-render maximum");
});

function syntheticWall(overrides: Partial<ProjectionCoherenceInput["walls"][number]> = {}) {
  return {
    kind: "wall_back" as const,
    enabled: true,
    reviewState: "manually_confirmed",
    confirmationCurrent: true,
    runtimeUsable: true,
    sourcePolygon: [{ x: 0.2, y: 0.8 }, { x: 0.6, y: 0.8 }, { x: 0.61, y: 0.2 }, { x: 0.21, y: 0.2 }] as ProjectionCoherenceWallPolygon,
    derivation: {
      ok: true as const,
      boundaryUV: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }],
      boundaryWorld: [{ x: -1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 2, z: 1 }, { x: -1, y: 2, z: 1 }],
      diagnostics: {
        upperRayPlaneDenominatorStart: 0.4, upperRayPlaneDenominatorEnd: 0.5, minUpperRayPlaneDenominator: 0.4,
        minUpperRayPlaneDenominatorThreshold: 0.035, maxRoundTripReprojectionErrorPx: 0.1,
        lowerSeamDisagreementStartWorld: 0.01, lowerSeamDisagreementEndWorld: 0.02,
      },
    },
    ...overrides,
  };
}

test("weighted median and MAD are deterministic, duplicate-safe, and do not mutate inputs", () => {
  const entries = [{ value: 5, weight: 2 }, { value: -3, weight: 1 }, { value: 1, weight: 1 }, { value: 1, weight: 1 }];
  const before = JSON.stringify(entries);
  assert.equal(weightedMedian(entries), 1, "sorting is deterministic and exact-half chooses the lower value");
  assert.equal(weightedMedian([{ value: 4, weight: 2 }, { value: -2, weight: 2 }]), -2, "exact half remains lower-bound deterministic");
  assert.equal(weightedMedian([{ value: 1, weight: 1 }, { value: 1, weight: 3 }, { value: 9, weight: 1 }]), 1, "duplicated physical-corner observations remain stable");
  assert.equal(weightedMedianAbsoluteDeviation([{ value: 3, weight: 2 }, { value: 3, weight: 1 }], 3), 0, "zero dispersion");
  assert.equal(weightedMedianAbsoluteDeviation([{ value: -4, weight: 1 }, { value: 1, weight: 3 }, { value: 10, weight: 1 }], 1), 0, "MAD uses selected weighted median centre");
  assert.equal(JSON.stringify(entries), before, "statistics do not mutate caller order");
});

test("leave-one-out summary exposes unavailable sparsity and B/C stability contrast", () => {
  const single = computeProjectionCoherenceDiagnostics(fixture({ walls: [syntheticWall({
    sourcePolygon: [{ x: 0, y: 0.8 }, { x: 0.6, y: 0.8 }, { x: 0.61, y: 0.2 }, { x: 0, y: 0.2 }],
  })] }));
  const singleSummary = available(single.structural.rawObservedTilt, "single structural summary");
  assert.equal(singleSummary.leaveOneOutMinimumDeg, null);
  assert.equal(singleSummary.leaveOneOutMaximumDeg, null);
  assert.equal(singleSummary.leaveOneOutRangeDeg, null);
  const roomB = available(canonical("B").structural.locationMatchedResidual, "B residual summary");
  const roomC = available(canonical("C").structural.locationMatchedResidual, "C residual summary");
  assert.ok((roomB.leaveOneOutRangeDeg ?? 0) > 3.8, "B is estimator-sensitive");
  assert.ok((roomC.leaveOneOutRangeDeg ?? Infinity) < 0.05, "C is estimator-stable");
});

test("frame flags identify every boundary and preserve excluded observations", () => {
  const evaluate = (polygon: ProjectionCoherenceWallPolygon, sideIndex = 0, intrinsic = { width: 1000, height: 1000 }) =>
    computeProjectionCoherenceDiagnostics(fixture({ frame: { ...frame, ...intrinsic }, walls: [syntheticWall({ sourcePolygon: polygon })] })).structural.observations[sideIndex];
  const left = evaluate([{ x: 0, y: 0.8 }, { x: 0.6, y: 0.8 }, { x: 0.61, y: 0.2 }, { x: 0, y: 0.2 }]);
  const right = evaluate([{ x: 0.2, y: 0.8 }, { x: 1, y: 0.8 }, { x: 1, y: 0.2 }, { x: 0.21, y: 0.2 }], 1);
  const top = evaluate([{ x: 0.1, y: 0 }, { x: 0.6, y: 0.8 }, { x: 0.61, y: 0.2 }, { x: 0.2, y: 0 }]);
  const bottom = evaluate([{ x: 0.1, y: 1 }, { x: 0.6, y: 0.8 }, { x: 0.61, y: 0.2 }, { x: 0.2, y: 1 }]);
  for (const observation of [left, right, top, bottom]) {
    assert.equal(observation.frameTouching, true);
    assert.equal(observation.frameCoincident, true);
    assert.equal(observation.inclusion, "excluded");
    assert.equal(observation.exclusionReason, "frame_coincident_edge");
  }
  const oneTouch = evaluate([{ x: 0, y: 0.8 }, { x: 0.6, y: 0.8 }, { x: 0.61, y: 0.2 }, { x: 0.21, y: 0.2 }]);
  assert.equal(oneTouch.frameTouching, true); assert.equal(oneTouch.frameCoincident, false); assert.equal(oneTouch.inclusion, "included");
  const withinTolerance = evaluate([{ x: 0.0000005, y: 0.8 }, { x: 0.6, y: 0.8 }, { x: 0.61, y: 0.2 }, { x: 0.0000005, y: 0.2 }]);
  const outsideTolerance = evaluate([{ x: 0.0000015, y: 0.8 }, { x: 0.6, y: 0.8 }, { x: 0.61, y: 0.2 }, { x: 0.0000015, y: 0.2 }]);
  assert.equal(withinTolerance.frameCoincident, true, "0.0005 source pixels is inside tolerance");
  assert.equal(outsideTolerance.frameCoincident, false, "0.0015 source pixels is outside tolerance");
});

test("structural eligibility states name every supported exclusion and refused walls remain absent", () => {
  const cases = [
    ["not_manually_confirmed", syntheticWall({ reviewState: "needs_review" })],
    ["confirmation_not_current", syntheticWall({ confirmationCurrent: false })],
    ["support_not_runtime_usable", syntheticWall({ runtimeUsable: false })],
  ] as const;
  for (const [reason, wall] of cases) {
    const observations = computeProjectionCoherenceDiagnostics(fixture({ walls: [wall] })).structural.observations;
    assert.equal(observations.length, 2);
    assert.ok(observations.every((observation) => observation.exclusionReason === reason));
  }
  const refused = syntheticWall({
    reviewState: "needs_review", confirmationCurrent: false, runtimeUsable: false,
    derivation: { ok: false, reasons: ["wall_upper_reconstruction_ill_conditioned"], diagnostics: { minUpperRayPlaneDenominator: 0.003 } },
  });
  const refusedResult = computeProjectionCoherenceDiagnostics(fixture({ walls: [refused] }));
  assert.equal(refusedResult.structural.observations.length, 0);
  assert.equal(refusedResult.structural.rawObservedTilt.state, "insufficient_evidence");
  assert.equal(refusedResult.walls[0].derivation, "refused");
  const noDimensions = computeProjectionCoherenceDiagnostics(fixture({ frame: { ...frame, intrinsicWidth: 0, intrinsicHeight: 0 }, walls: [syntheticWall()] }));
  assert.equal(noDimensions.structural.observations.length, 0, "missing source dimensions do not synthesize observations");
});

test("availability boundaries and deep-frozen inputs fail closed without misleading zeroes", () => {
  const invalidFrame = computeProjectionCoherenceDiagnostics(fixture({ frame: { ...frame, width: 0, height: 0 } }));
  assert.equal(invalidFrame.camera.roll.state, "unavailable");
  assert.equal(invalidFrame.anchorProjection.state, "unavailable");
  assert.equal(computeProjectionCoherenceDiagnostics(fixture({ camera: null })).camera.roll.state, "unavailable");
  assert.equal(computeProjectionCoherenceDiagnostics(fixture({ floor: { polygonKey: null, worldWidth: 0, worldDepth: 4 } })).camera.normalizedLateralOffset.state, "unavailable");
  assert.equal(computeProjectionCoherenceDiagnostics(fixture({ attachment: { current: false, supportKind: "floor", contactPointWorld: null } })).anchorProjection.state, "unavailable");
  assert.equal(computeProjectionCoherenceDiagnostics(fixture({ walls: [] })).structural.rawObservedTilt.state, "insufficient_evidence");
  assert.equal(computeProjectionCoherenceDiagnostics(fixture({ walls: [syntheticWall({ sourcePolygon: [{ x: 0, y: 0.8 }, { x: 1, y: 0.8 }, { x: 1, y: 0.2 }, { x: 0, y: 0.2 }] })] })).structural.rawObservedTilt.state, "insufficient_evidence");
  assert.equal(computeProjectionCoherenceDiagnostics(fixture({ floorReprojection: null })).floorReprojection.state, "unavailable");

  const input = fixture({ walls: [syntheticWall()] });
  const derivation = input.walls[0].derivation;
  assert.equal(derivation.ok, true);
  if (!derivation.ok) assert.fail("synthetic wall derivation is accepted");
  Object.freeze(input.camera!.pose.position); Object.freeze(input.camera!.pose.lookAt); Object.freeze(input.camera!.pose.up); Object.freeze(input.camera!.pose);
  derivation.boundaryUV.forEach(Object.freeze); derivation.boundaryWorld.forEach(Object.freeze);
  input.walls[0].sourcePolygon?.forEach(Object.freeze);
  Object.freeze(derivation.diagnostics); Object.freeze(derivation.boundaryUV); Object.freeze(derivation.boundaryWorld); Object.freeze(input.walls[0]);
  Object.freeze(input.walls); Object.freeze(input.attachment!); Object.freeze(input.floorReprojection!); Object.freeze(input);
  const once = computeProjectionCoherenceDiagnostics(input);
  const twice = computeProjectionCoherenceDiagnostics(input);
  assert.deepEqual(once, twice, "deep-frozen input produces deterministic output");
  const visit = (value: unknown): void => {
    if (typeof value === "number") assert.ok(Number.isFinite(value), `finite output ${value}`);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(once);
});
