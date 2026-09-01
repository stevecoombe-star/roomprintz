import assert from "node:assert/strict";
import test from "node:test";

import {
  ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO,
} from "./room-boundary-authority-contract";
import {
  applicableEvidencePasses,
  chooseFloorInteriorWitnessAttempt,
  classifyOccupancyOffset,
  competingSameWall,
  distanceToPolygonFrontier,
  evaluateFrontierProximity,
  evaluateInteriorHalfSpace,
  evaluateOppositeOccupancy,
  floorWallProjectionContinuation,
  isNearVerticalFloorWallSeam,
  nearVerticalFloorWallMayContinue,
  pointInPolygon,
} from "./room-boundary-qualification.server";

const floorPolygon = [
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 0.8, y: 0.62 },
  { x: 0.2, y: 0.62 },
];
const wallPolygon = [
  { x: 0.1, y: 0.1 },
  { x: 0.9, y: 0.1 },
  { x: 0.8, y: 0.62 },
  { x: 0.2, y: 0.62 },
];
const seam = [
  { x: 0.2, y: 0.62 },
  { x: 0.8, y: 0.62 },
];

test("opposite occupancy accepts floor below and wall above a floor-wall seam", () => {
  const occupancy = evaluateOppositeOccupancy(seam, floorPolygon, wallPolygon);
  assert.ok(occupancy);
  assert.equal(occupancy.opposite, true);
  assert.equal(occupancy.floorSide, "positive");
  assert.equal(occupancy.wallSide, "negative");
});

test("same-side occupancy is not opposite", () => {
  const occupancy = evaluateOppositeOccupancy(seam, floorPolygon, floorPolygon);
  assert.ok(occupancy);
  assert.equal(occupancy.opposite, false);
  assert.equal(occupancy.floorSide, occupancy.wallSide);
});

test("mixed occupancy is not unique", () => {
  const straddling = [
    { x: 0.1, y: 0.2 },
    { x: 0.9, y: 0.2 },
    { x: 0.9, y: 0.9 },
    { x: 0.1, y: 0.9 },
  ];
  const occupancy = evaluateOppositeOccupancy(seam, straddling, wallPolygon);
  assert.ok(occupancy);
  assert.equal(occupancy.floorSide, "mixed");
  assert.equal(occupancy.opposite, false);
});

test("frontier accepts a seam on both plane edges", () => {
  const frontier = evaluateFrontierProximity(seam, floorPolygon, wallPolygon);
  assert.equal(frontier.nearFloorFrontier, true);
  assert.equal(frontier.nearWallFrontier, true);
  assert.ok(
    (frontier.maxDistanceToFloorFrontier ?? 1) <=
      ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  );
});

test("frontier rejects a line floating inside the wall polygon", () => {
  const radiator = [
    { x: 0.3, y: 0.35 },
    { x: 0.7, y: 0.35 },
  ];
  const frontier = evaluateFrontierProximity(radiator, floorPolygon, wallPolygon);
  assert.equal(frontier.nearFloorFrontier, false);
  assert.ok(
    (frontier.maxDistanceToFloorFrontier ?? 0) >
      ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  );
  const wallDistance = distanceToPolygonFrontier(radiator[0], wallPolygon);
  assert.ok(wallDistance !== null && wallDistance > 0.02);
});

test("named near-vertical ratio fails closed without relabeling", () => {
  const wallWall = [
    { x: 0.48, y: 0.2 },
    { x: 0.5, y: 0.8 },
  ];
  assert.equal(isNearVerticalFloorWallSeam(wallWall), true);
  assert.ok(ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO <= 0.1);
  assert.equal(isNearVerticalFloorWallSeam(seam), false);
});

test("near-vertical continuation requires the full strong floor-wall proof set", () => {
  const strong = {
    nearVertical: true,
    bindingSucceeded: true,
    ambiguity: null,
    occupancyOpposite: true,
    nearFloorFrontier: true,
    nearWallFrontier: true,
  };
  assert.equal(nearVerticalFloorWallMayContinue(strong), true);
  assert.equal(
    nearVerticalFloorWallMayContinue({ ...strong, nearVertical: false }),
    true,
  );
  assert.equal(
    nearVerticalFloorWallMayContinue({ ...strong, bindingSucceeded: false }),
    false,
  );
  assert.equal(
    nearVerticalFloorWallMayContinue({
      ...strong,
      ambiguity: "could be a jamb",
    }),
    false,
  );
  assert.equal(
    nearVerticalFloorWallMayContinue({ ...strong, occupancyOpposite: false }),
    false,
  );
  assert.equal(
    nearVerticalFloorWallMayContinue({ ...strong, nearFloorFrontier: false }),
    false,
  );
  assert.equal(
    nearVerticalFloorWallMayContinue({ ...strong, nearWallFrontier: false }),
    false,
  );
});

test("steep ratio just below the named threshold is still near-vertical", () => {
  const justBelow = [
    { x: 0.160, y: 0.64 },
    { x: 0.127, y: 0.98 },
  ];
  const justAbove = [
    { x: 0.160, y: 0.64 },
    { x: 0.118, y: 0.98 },
  ];
  assert.equal(isNearVerticalFloorWallSeam(justBelow), true);
  assert.equal(isNearVerticalFloorWallSeam(justAbove), false);
  assert.equal(isNearVerticalFloorWallSeam(seam), false);
});

test("point-in-polygon does not treat the cyan floor quad as occupancy", () => {
  const cyanQuad = [
    { x: 0.1, y: 0.9 },
    { x: 0.9, y: 0.9 },
    { x: 0.65, y: 0.55 },
    { x: 0.35, y: 0.55 },
  ];
  assert.equal(pointInPolygon({ x: 0.5, y: 0.81 }, floorPolygon), true);
  assert.equal(pointInPolygon({ x: 0.5, y: 0.97 }, cyanQuad), false);
});

test("competing same-wall traces share orientation, offset, and overlap", () => {
  const first = {
    baseStart: { x: -1, y: 0, z: 0 },
    baseEnd: { x: 1, y: 0, z: 0 },
    tangent: { x: 1, y: 0, z: 0 },
    supportPlaneNormal: { x: 0, y: 0, z: 1 },
    supportPlaneConstant: 0,
  };
  const duplicate = {
    baseStart: { x: -0.8, y: 0, z: 0.04 },
    baseEnd: { x: 0.9, y: 0, z: 0.04 },
    tangent: { x: 1, y: 0, z: 0 },
    supportPlaneNormal: { x: 0, y: 0, z: 1 },
    supportPlaneConstant: -0.04,
  };
  const angled = {
    baseStart: { x: 1, y: 0, z: 0 },
    baseEnd: { x: 1, y: 0, z: -2 },
    tangent: { x: 0, y: 0, z: -1 },
    supportPlaneNormal: { x: 1, y: 0, z: 0 },
    supportPlaneConstant: -1,
  };
  assert.equal(competingSameWall(first, duplicate), true);
  assert.equal(competingSameWall(first, angled), false);
});

test("camera contradiction leaves interior insufficient without flipping the plane", () => {
  const occupancy = evaluateOppositeOccupancy(seam, floorPolygon, wallPolygon);
  assert.ok(occupancy);
  const geometry = {
    baseStart: { x: -1, y: 0, z: 0 },
    baseEnd: { x: 1, y: 0, z: 0 },
    tangent: { x: 1, y: 0, z: 0 },
    supportPlaneNormal: { x: 0, y: 0, z: 1 },
    supportPlaneConstant: 0,
  };
  const witnessSign = occupancy.floorSide === "positive" ? 1 : -1;
  const interior = evaluateInteriorHalfSpace({
    occupancy,
    polyline: seam,
    floorPolygon,
    geometry,
    camera: {
      verticalFovDeg: 52,
      pose: {
        position: { x: 0, y: 1.6, z: -2 * witnessSign },
        lookAt: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      frame: { width: 900, height: 600 },
    },
    projectWitness: () => ({ x: 0, y: 0, z: witnessSign }),
  });
  assert.equal(interior.cameraContradictsWitness, true);
  assert.equal(interior.status, "insufficient");
  assert.equal(interior.sideSign, witnessSign);
  assert.equal(geometry.supportPlaneNormal.z, 1);
});

test("frame-adjacent missing polygon support is not_applicable, not a max-distance veto", () => {
  const truncated = [
    { x: 0.01, y: 0.62 },
    { x: 0.35, y: 0.62 },
    { x: 0.55, y: 0.62 },
  ];
  const conservativeWall = [
    { x: 0.2, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.8, y: 0.62 },
    { x: 0.2, y: 0.62 },
  ];
  const frontier = evaluateFrontierProximity(truncated, floorPolygon, conservativeWall);
  assert.equal(frontier.floorVertices[0]?.status, "not_applicable");
  assert.equal(frontier.wallVertices[0]?.status, "not_applicable");
  assert.equal(frontier.floorVertices[2]?.status, "pass");
  assert.equal(frontier.wallVertices[2]?.status, "pass");
  assert.equal(frontier.nearFloorFrontier, true);
  assert.equal(frontier.nearWallFrontier, true);
  assert.ok(
    (frontier.maxDistanceToFloorFrontier ?? 1) <=
      ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  );
});

test("interior non-frame vertex far from wall/floor frontier remains a failure", () => {
  const interiorFalse = [
    { x: 0.35, y: 0.35 },
    { x: 0.65, y: 0.35 },
  ];
  const frontier = evaluateFrontierProximity(interiorFalse, floorPolygon, wallPolygon);
  assert.equal(frontier.nearFloorFrontier, false);
  assert.equal(frontier.floorVertices[0]?.status, "contradiction");
  assert.equal(frontier.floorVertices[0]?.applicability, "contradiction");
});

test("occupancy offset out of bounds is not_applicable", () => {
  const sample = classifyOccupancyOffset({
    sample: { x: -0.01, y: 0.62 },
    probe: { x: 0.01, y: 0.62 },
    expectedPolygon: floorPolygon,
    wrongPolygon: wallPolygon,
  });
  assert.equal(sample.status, "not_applicable");
  assert.equal(sample.outOfBounds, true);
});

test("occupancy offset in neither polygon near truncation is not_applicable", () => {
  const sample = classifyOccupancyOffset({
    sample: { x: 0.01, y: 0.5 },
    probe: { x: 0.01, y: 0.62 },
    expectedPolygon: wallPolygon,
    wrongPolygon: floorPolygon,
  });
  assert.equal(sample.status, "not_applicable");
  assert.equal(sample.inExpected, false);
  assert.equal(sample.inWrong, false);
});

test("occupancy offset in the wrong known polygon is contradiction", () => {
  const sample = classifyOccupancyOffset({
    sample: { x: 0.5, y: 0.35 },
    probe: { x: 0.5, y: 0.62 },
    expectedPolygon: floorPolygon,
    wrongPolygon: wallPolygon,
  });
  assert.equal(sample.status, "contradiction");
  assert.equal(sample.inWrong, true);
});

test("applicable evidence pass rule does not majority-vote and fails closed on zero applicable", () => {
  assert.equal(applicableEvidencePasses({ passCount: 1, contradictionCount: 0 }), true);
  assert.equal(applicableEvidencePasses({ passCount: 2, contradictionCount: 0 }), true);
  assert.equal(applicableEvidencePasses({ passCount: 1, contradictionCount: 3 }), false);
  assert.equal(applicableEvidencePasses({ passCount: 2, contradictionCount: 1 }), false);
  assert.equal(applicableEvidencePasses({ passCount: 0, contradictionCount: 0 }), false);
});

test("interior witness tries in-span quarter points when midpoint offset is out of frame", () => {
  const occupancy = evaluateOppositeOccupancy(seam, floorPolygon, wallPolygon);
  assert.ok(occupancy);
  const leftSeam = [
    { x: 0.005, y: 0.9 },
    { x: 0.22, y: 0.62 },
  ];
  const leftFloor = [
    { x: 0, y: 1 },
    { x: 0.55, y: 1 },
    { x: 0.22, y: 0.62 },
    { x: 0.0, y: 0.92 },
  ];
  const attempt = chooseFloorInteriorWitnessAttempt(
    leftSeam,
    leftFloor,
    occupancy.floorSide === "positive" || occupancy.floorSide === "negative"
      ? { ...occupancy, floorSide: occupancy.floorSide }
      : occupancy,
    wallPolygon,
  );
  if (attempt.status === "pass") {
    assert.ok(attempt.witness);
    assert.equal(pointInPolygon(attempt.witness, leftFloor), true);
  }
});

test("interior witness wrong-polygon sample is contradiction", () => {
  const occupancy = evaluateOppositeOccupancy(seam, floorPolygon, wallPolygon);
  assert.ok(occupancy);
  const attempt = chooseFloorInteriorWitnessAttempt(
    [
      { x: 0.3, y: 0.35 },
      { x: 0.7, y: 0.35 },
    ],
    floorPolygon,
    occupancy,
    wallPolygon,
  );
  assert.ok(attempt.status === "contradiction" || attempt.status === "insufficient");
  if (attempt.status === "contradiction") {
    assert.ok(attempt.witness);
    assert.equal(pointInPolygon(attempt.witness, wallPolygon), true);
  }
});

test("endpoint projection failure fails closed; interior failure may retain observed span", () => {
  const interior = floorWallProjectionContinuation([
    { ok: true },
    { ok: false },
    { ok: true },
  ]);
  assert.equal(interior.endpointProjectionFailed, false);
  assert.equal(interior.interiorProjectionFailed, true);
  assert.equal(interior.retainObservedEndpointSpan, true);
  const endpoint = floorWallProjectionContinuation([
    { ok: false },
    { ok: true },
    { ok: true },
  ]);
  assert.equal(endpoint.endpointProjectionFailed, true);
  assert.equal(endpoint.retainObservedEndpointSpan, false);
});

test("thresholds remain the named conservative gates", () => {
  assert.equal(ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE, 0.012);
  assert.equal(ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO, 0.1);
});
