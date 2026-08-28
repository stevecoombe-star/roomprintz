import assert from "node:assert/strict";
import test from "node:test";

import {
  ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE,
  ROOM_BOUNDARY_NEAR_VERTICAL_MAX_HORIZONTAL_RATIO,
} from "./room-boundary-authority-contract";
import {
  competingSameWall,
  distanceToPolygonFrontier,
  evaluateFrontierProximity,
  evaluateInteriorHalfSpace,
  evaluateOppositeOccupancy,
  isNearVerticalFloorWallSeam,
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
