import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_PHYSICAL_BOUNDARY_SOURCE_COORDINATE_SPACE,
  PHYSICAL_ROOM_ENVELOPE_COORDINATE_SPACE,
  PHYSICAL_ROOM_ENVELOPE_VERSION,
  createPhysicalRoomEnvelope,
  physicalWallEdges,
  type PhysicalRoomEnvelopeInput,
} from "./physical-room-envelope";

function input(edges: PhysicalRoomEnvelopeInput["edges"]): PhysicalRoomEnvelopeInput {
  return {
    provenance: {
      source: "attempt_bound_empty",
      detectorId: "p2-s1-boundary-reader",
      detectorVersion: "research",
      emptyImageSha256: "e".repeat(64),
      emptyBasisDigest: "empty-basis",
      originalBasisDigest: "original-basis",
    },
    edges,
  };
}

test("accepts a one-wall partial envelope without requiring a closed polygon", () => {
  const envelope = createPhysicalRoomEnvelope(input([{
    id: "back-wall",
    state: "physical_wall",
    startXZ: { x: -2, z: 3 },
    endXZ: { x: 2, z: 3 },
    imageEvidence: {
      coordinateSpace: EMPTY_PHYSICAL_BOUNDARY_SOURCE_COORDINATE_SPACE,
      start: { x: 0.1, y: 0.7 },
      end: { x: 0.9, y: 0.7 },
    },
  }]));

  assert.ok(envelope);
  assert.equal(envelope.version, PHYSICAL_ROOM_ENVELOPE_VERSION);
  assert.equal(envelope.coordinateSpace, PHYSICAL_ROOM_ENVELOPE_COORDINATE_SPACE);
  assert.equal(envelope.edges.length, 1);
  assert.equal(envelope.edges[0].state, "physical_wall");
  assert.equal(physicalWallEdges(envelope).length, 1);
  assert.ok(Object.isFrozen(envelope));
  assert.ok(Object.isFrozen(envelope.edges));
});

test("preserves open, truncated, and unknown extents without promoting them to walls", () => {
  const envelope = createPhysicalRoomEnvelope(input([
    {
      id: "observed",
      state: "physical_wall",
      startXZ: { x: -1, z: 2 },
      endXZ: { x: 1, z: 2 },
      imageEvidence: null,
    },
    {
      id: "left-frame",
      state: "frame_truncated",
      startXZ: { x: -1, z: 2 },
      endXZ: { x: -3, z: 2 },
      imageEvidence: null,
    },
    {
      id: "doorway",
      state: "open",
      startXZ: { x: 1, z: 2 },
      endXZ: { x: 3, z: 2 },
      imageEvidence: null,
    },
    {
      id: "unreadable",
      state: "unknown",
      startXZ: { x: 3, z: 2 },
      endXZ: { x: 3, z: 4 },
      imageEvidence: null,
    },
  ]));

  assert.ok(envelope);
  assert.deepEqual(envelope.edges.map((edge) => edge.state), [
    "physical_wall",
    "frame_truncated",
    "open",
    "unknown",
  ]);
  assert.deepEqual(physicalWallEdges(envelope).map((edge) => edge.id), ["observed"]);
});

test("does not infer a closure for an envelope with no observed walls", () => {
  const envelope = createPhysicalRoomEnvelope(input([
    {
      id: "frame-only",
      state: "frame_truncated",
      startXZ: { x: -1, z: 1 },
      endXZ: { x: 1, z: 1 },
      imageEvidence: null,
    },
  ]));

  assert.ok(envelope);
  assert.equal(envelope.edges.length, 1);
  assert.deepEqual(physicalWallEdges(envelope), []);
});
