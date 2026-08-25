import assert from "node:assert/strict";
import test from "node:test";

import {
  AFC_V2_ROOM_OBSERVATION_VERSION,
  buildRoomObservationContract,
  type RoomObservationImageIdentity,
} from "./room-observation-contract";

const originalIdentity: RoomObservationImageIdentity = {
  sha256: "a".repeat(64),
  byteCount: 100,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/jpeg",
  orientation: 1,
};
const fullyTiledIdentity: RoomObservationImageIdentity = {
  sha256: "b".repeat(64),
  byteCount: 200,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png",
  orientation: 1,
};

function contract(raw: unknown) {
  return buildRoomObservationContract(raw, {
    originalIdentity,
    fullyTiledIdentity,
    generationId: "generation-1",
    attemptId: "attempt-1",
    floorResultId: "floor-result-1",
    cameraAuthorityKey: "floor-authority",
    frozenSnapshotDigest: "c".repeat(64),
    provider: "controlled_fixture",
    model: "fixture",
    promptVersion: "observer/v1",
    generatedAt: "2026-08-25T12:00:00.000Z",
  });
}

test("room observation contract separates visible evidence and conservative topology", () => {
  const result = contract({
    observedPlanes: [
      {
        id: "floor_1",
        category: "floor",
        imagePolygon: [
          { x: 0.1, y: 0.95 },
          { x: 0.9, y: 0.95 },
          { x: 0.65, y: 0.55 },
          { x: 0.35, y: 0.55 },
        ],
        confidence: 0.98,
        visibility: "observed",
      },
      {
        id: "wall_1",
        category: "wall",
        imagePolygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.65, y: 0.55 },
          { x: 0.35, y: 0.55 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
    ],
    observedGridFamilies: [
      {
        id: "floor_axis_a",
        planeId: "floor_1",
        axis: "axis_a",
        lineSegments: [
          { start: { x: 0.2, y: 0.8 }, end: { x: 0.8, y: 0.8 } },
        ],
        confidence: 0.92,
        visibility: "observed",
      },
      {
        id: "floor_axis_b",
        planeId: "floor_1",
        axis: "axis_b",
        lineSegments: [
          { start: { x: 0.3, y: 0.9 }, end: { x: 0.45, y: 0.58 } },
        ],
        confidence: 0.88,
        visibility: "observed",
      },
    ],
    observedSeams: [{
      id: "seam_1",
      category: "floor_wall",
      planeIds: ["floor_1", "wall_1"],
      imagePolyline: [
        { x: 0.35, y: 0.55 },
        { x: 0.65, y: 0.55 },
      ],
      confidence: 0.94,
      visibility: "observed",
    }],
    observedOpenings: [{
      id: "opening_1",
      category: "window",
      hostPlaneId: "wall_1",
      imageBoundary: [
        { x: 0.45, y: 0.2 },
        { x: 0.6, y: 0.2 },
        { x: 0.6, y: 0.42 },
        { x: 0.45, y: 0.42 },
      ],
      confidence: 0.87,
      visibility: "observed",
    }],
    adjacency: [{
      id: "adjacency_1",
      planeAId: "floor_1",
      planeBId: "wall_1",
      seamId: "seam_1",
      confidence: 0.91,
    }],
    unresolved: ["The right wall-ceiling corner is cropped."],
  });

  assert.equal(result.observationVersion, AFC_V2_ROOM_OBSERVATION_VERSION);
  assert.equal(result.representationIdentity.kind, "FULLY_TILED");
  assert.equal(result.representationIdentity.generatedFrom, "ORIGINAL");
  assert.equal(result.calibratedCameraReference.role, "consumed_reference_only");
  assert.equal(result.observedPlanes.length, 2);
  assert.deepEqual(result.observedPlanes[0].gridFamilyIds, [
    "floor_axis_a",
    "floor_axis_b",
  ]);
  assert.equal(
    result.observedSeams[0].evidenceClass,
    "provider_reported_visible_evidence",
  );
  assert.equal(result.observedOpenings[0].tiledFieldInterruption, true);
  assert.equal(
    result.adjacency[0].evidenceClass,
    "conservative_seam_supported_inference",
  );
  assert.equal(result.diagnostics.worldGeometryProduced, false);
  assert.equal(
    result.diagnostics.providerEvidenceStatus,
    "schema_validated_and_conservatively_normalized_provider_report_not_pixel_verified",
  );
  assert.equal(
    result.sourceBasis.crossBasisAlignment,
    "generation_prompt_preserved_not_pixel_verified",
  );
  assert.equal(
    result.sourceBasis.calibratedFloorReferenceBasis,
    "FULLY_TILED",
  );
  assert.equal(result.sourceBasis.cameraRealizationBasis, "ORIGINAL");
  assert.equal("worldPlanes" in result, false);
});

test("ambiguous evidence remains unknown and hidden or unbound claims are rejected", () => {
  const result = contract({
    observedPlanes: [
      {
        id: "plane_unknown",
        category: "uncertain_surface",
        imagePolygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.3, y: 0.1 },
          { x: 0.2, y: 0.3 },
        ],
        confidence: 0.4,
        visibility: "observed",
        ambiguity: "Could be a soffit rather than the main ceiling.",
      },
      {
        id: "hidden_wall",
        category: "wall",
        imagePolygon: [
          { x: 0.4, y: 0.1 },
          { x: 0.6, y: 0.1 },
          { x: 0.5, y: 0.3 },
        ],
        confidence: 0.9,
        visibility: "inferred_hidden",
      },
    ],
    observedGridFamilies: [{
      id: "unbound_grid",
      planeId: "hidden_wall",
      axis: "axis_a",
      lineSegments: [
        { start: { x: 0.4, y: 0.2 }, end: { x: 0.5, y: 0.2 } },
      ],
      confidence: 0.8,
      visibility: "observed",
    }],
    observedSeams: [],
    observedOpenings: [{
      id: "out_of_bounds",
      category: "door",
      hostPlaneId: "plane_unknown",
      imageBoundary: [
        { x: -0.1, y: 0.2 },
        { x: 0.2, y: 0.2 },
        { x: 0.2, y: 0.5 },
      ],
      confidence: 0.8,
      visibility: "observed",
    }],
    adjacency: [{
      id: "invented_topology",
      planeAId: "plane_unknown",
      planeBId: "hidden_wall",
      seamId: "missing_seam",
      confidence: 0.8,
    }],
    unresolved: ["No visible support for the hidden wall."],
    camera: { verticalFovDeg: 99 },
    worldPlanes: [{ id: "forbidden_world_wall" }],
  });

  assert.equal(result.observedPlanes.length, 1);
  assert.equal(result.observedPlanes[0].category, "unknown");
  assert.match(result.observedPlanes[0].ambiguity ?? "", /soffit/);
  assert.equal(result.observedGridFamilies.length, 0);
  assert.equal(result.observedOpenings.length, 0);
  assert.equal(result.adjacency.length, 0);
  assert.deepEqual(result.diagnostics.rejected, {
    planes: 1,
    gridFamilies: 1,
    seams: 0,
    openings: 1,
    adjacency: 1,
    continuity: 0,
  });
  assert.deepEqual(result.diagnostics.rejectedForbiddenProviderFields, [
    "camera",
    "worldPlanes",
  ]);
  assert.equal("camera" in result, false);
  assert.equal("worldPlanes" in result, false);
});
