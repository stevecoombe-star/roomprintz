import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type {
  AfcSr1TiledLiveProductDependencies,
} from "../3d-room-lab/afc-sr1-tiled-live-product";
import {
  executeAfcV2Analysis,
  type AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import {
  buildEmptyRoomObservationEvidence,
  type EmptyRoomObservationAcceptedEvidence,
} from "./empty-room-observation-contract";
import {
  normalizeEmptyRoomObservationEvidence,
} from "./empty-room-observation-normalization";
import {
  AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION,
  observeRetainedEmptyRoom,
} from "./empty-room-observation.server";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const EMPTY_BYTES = Uint8Array.from([4, 5, 6]);
const originalBasis = {
  sha256: "a".repeat(64),
  byteCount: 100,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/jpeg" as const,
  orientation: 1 as const,
};
const emptyBasis = {
  sha256: sha(EMPTY_BYTES),
  byteCount: EMPTY_BYTES.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const tiledBasis = {
  sha256: "c".repeat(64),
  byteCount: 3,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const input: AfcV2AnalyzeInput = {
  attemptId: "v2-s3f-side-ceiling-wall",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 21,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

const LEFT_SIDE_CEILING = [
  { x: 0, y: 0.28 },
  { x: 0.18, y: 0.12 },
] as const;
const RIGHT_SIDE_CEILING = [
  { x: 1, y: 0.31 },
  { x: 0.82, y: 0.11 },
] as const;
const BACK_WALL_CEILING = [
  { x: 0.18, y: 0.12 },
  { x: 0.82, y: 0.11 },
] as const;
const LEFT_WALL_WALL = [
  { x: 0.18, y: 0.12 },
  { x: 0.18, y: 0.62 },
] as const;
const PARTIAL_LEFT_SIDE_CEILING = [
  { x: 0.04, y: 0.24 },
  { x: 0.14, y: 0.15 },
] as const;

function roomCPlanes() {
  return [
    {
      id: "visible_floor",
      category: "floor",
      sourceNormalizedPolygon: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 0.82, y: 0.62 },
        { x: 0.18, y: 0.62 },
      ],
      confidence: 0.94,
      visibility: "observed",
    },
    {
      id: "visible_back_wall",
      category: "wall",
      sourceNormalizedPolygon: [
        { x: 0.18, y: 0.12 },
        { x: 0.82, y: 0.11 },
        { x: 0.82, y: 0.62 },
        { x: 0.18, y: 0.62 },
      ],
      confidence: 0.91,
      visibility: "observed",
    },
    {
      id: "visible_left_wall",
      category: "wall",
      sourceNormalizedPolygon: [
        { x: 0, y: 0.05 },
        { x: 0.18, y: 0.12 },
        { x: 0.18, y: 0.62 },
        { x: 0, y: 0.78 },
      ],
      confidence: 0.88,
      visibility: "observed",
    },
    {
      id: "visible_right_wall",
      category: "wall",
      sourceNormalizedPolygon: [
        { x: 0.82, y: 0.11 },
        { x: 1, y: 0.06 },
        { x: 1, y: 0.8 },
        { x: 0.82, y: 0.62 },
      ],
      confidence: 0.86,
      visibility: "observed",
    },
    {
      id: "visible_ceiling",
      category: "ceiling",
      sourceNormalizedPolygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.82, y: 0.11 },
        { x: 0.18, y: 0.12 },
      ],
      confidence: 0.84,
      visibility: "observed",
    },
  ];
}

function roomCObservation() {
  return {
    observedPlanes: roomCPlanes(),
    observedSeams: [
      {
        id: "floor_wall_back",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_back_wall"],
        sourceNormalizedPolyline: [
          { x: 0.18, y: 0.62 },
          { x: 0.82, y: 0.62 },
        ],
        confidence: 0.92,
        visibility: "observed",
      },
      {
        id: "wall_wall_left",
        category: "wall_wall",
        planeIds: ["visible_back_wall", "visible_left_wall"],
        sourceNormalizedPolyline: [...LEFT_WALL_WALL],
        confidence: 0.9,
        visibility: "observed",
      },
      {
        id: "wall_ceiling_back",
        category: "wall_ceiling",
        planeIds: ["visible_back_wall", "visible_ceiling"],
        sourceNormalizedPolyline: [...BACK_WALL_CEILING],
        confidence: 0.89,
        visibility: "observed",
      },
      {
        id: "wall_ceiling_left",
        category: "wall_ceiling",
        planeIds: ["visible_left_wall", "visible_ceiling"],
        sourceNormalizedPolyline: [...LEFT_SIDE_CEILING],
        confidence: 0.81,
        visibility: "observed",
      },
      {
        id: "wall_ceiling_right",
        category: "wall_ceiling",
        planeIds: ["visible_right_wall", "visible_ceiling"],
        sourceNormalizedPolyline: [...RIGHT_SIDE_CEILING],
        confidence: 0.78,
        visibility: "observed",
      },
    ],
    observedOpenings: [{
      id: "back_window",
      category: "window",
      hostPlaneId: "visible_back_wall",
      sourceNormalizedBoundary: [
        { x: 0.32, y: 0.22 },
        { x: 0.48, y: 0.21 },
        { x: 0.48, y: 0.42 },
        { x: 0.32, y: 0.43 },
      ],
      boundaryClosure: "complete_visible_outline",
      boundaryEvidenceCompleteness: "all_edges_visibly_traced",
      confidence: 0.87,
      visibility: "observed",
    }],
    observedJunctions: [{
      id: "left_ceiling_corner",
      category: "room_corner",
      sourceNormalizedPoint: { x: 0.18, y: 0.12 },
      seamIds: ["wall_wall_left", "wall_ceiling_back", "wall_ceiling_left"],
      openingIds: [],
      confidence: 0.83,
      visibility: "observed",
    }],
    unresolved: [] as string[],
  };
}

function evidence(
  raw: unknown = roomCObservation(),
): EmptyRoomObservationAcceptedEvidence {
  return buildEmptyRoomObservationEvidence(raw, {
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION,
    generatedAt: "2026-08-27T12:00:00.000Z",
  });
}

function productDependencies(): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-s3f-result",
    qualifyOriginal: async () => ({
      sourceImageUrl: input.sourceImageUrl,
      basis: originalBasis,
    }),
    resolveEmpty: async () => ({
      basis: emptyBasis,
      bytes: EMPTY_BYTES,
      generated: true,
    }),
    generateTiled: async () => ({
      status: "generated",
      input: emptyBasis,
      tiled: {
        base64: Buffer.from([1, 2, 3]).toString("base64"),
        identity: tiledBasis,
      },
      provenance: {
        generatorId: "vibode-tile-grid-scaffold/stage2/v1",
        profileId: "afc-sr1-tile-grid-scaffold/v1",
        researchPreset: "tile_grid_scaffold",
        requestedModelId: "NBP",
        runId: "v2-s3f-generation",
        generatedAt: "2026-08-27T12:00:00.000Z",
        appliedAspectRatio: "3:2",
        imageTransport: "data_url",
        generationStatus: "generated",
      },
      compatibility: { tier: "exact_grid_compatible" },
    }) as never,
    validateTiledLineage: async () => ({
      tiledIdentity: tiledBasis,
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async () => ({
      status: "ok",
      decodedIdentity: tiledBasis,
      readerVersion: "afc-sr1-tiled-perspective-reader/s1",
      authoritativeQuadSourceNormalized: authoritativeFloorQuad,
      authoritativeQuadPixel: [
        { x: 120, y: 720 },
        { x: 1080, y: 720 },
        { x: 780, y: 440 },
        { x: 420, y: 440 },
      ],
      authoritativeCore: {
        rows: 2,
        columns: 2,
        j0: 0,
        i0: 0,
        cellIds: [1, 2, 3, 4],
      },
      selectedComponentTileCount: 4,
      rawQuadrilateralCount: 4,
      deduplicatedCellCount: 4,
      reprojectionMeanPx: 0.5,
      reprojectionMaxPx: 1,
    }),
  };
}

test("V2-S3F active observer is v4 and coaches side wall-ceiling seams", async () => {
  let suppliedPrompt = "";
  const result = await observeRetainedEmptyRoom({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    originalAncestorIdentity: originalBasis,
    retainedEmpty: { bytes: EMPTY_BYTES, identity: emptyBasis },
  }, {
    model: "fixture",
    now: () => new Date("2026-08-27T12:00:00.000Z"),
    callProvider: async (args) => {
      suppliedPrompt = args.prompt;
      return roomCObservation();
    },
  });

  assert.equal(
    AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION,
    "afc-v2-empty-visible-room-observer/v4",
  );
  assert.equal(result.observer.promptVersion, "afc-v2-empty-visible-room-observer/v4");
  assert.equal(result.observerStatus, "observed");
  assert.match(suppliedPrompt, /side wall-ceiling intersection independently/i);
  assert.match(suppliedPrompt, /perspective-receding/i);
  assert.match(suppliedPrompt, /shallow diagonals, high-angle diagonals/i);
  assert.match(suppliedPrompt, /Distinguish wall-wall from wall-ceiling/i);
  assert.match(suppliedPrompt, /Do not substitute a vertical wall-wall line/i);
  assert.match(suppliedPrompt, /plane-polygon extent/i);
  assert.match(suppliedPrompt, /supported visible segment rather than inventing/i);
  assert.match(suppliedPrompt, /approaches x=0 or x=1/i);
  assert.match(suppliedPrompt, /Do not require both left and right/i);
  assert.match(suppliedPrompt, /Omission of an unsupported or ambiguous side remains correct/i);
  assert.match(suppliedPrompt, /not permission to manufacture a missing side seam/i);
  assert.match(suppliedPrompt, /follows the actual visible architectural seam/i);
  assert.match(suppliedPrompt, /Do not inflate seam confidence from room topology/i);
  assert.doesNotMatch(suppliedPrompt, /room must have left and right ceiling seams/i);
  assert.match(suppliedPrompt, /pelmet, curtain box, valance/i);
  assert.match(suppliedPrompt, /do not move the wall-ceiling seam or junction down/i);
  assert.match(suppliedPrompt, /If a soffit or bulkhead genuinely defines the visible ceiling boundary/i);
});

test("V2-S3F Room Observation remains observation-only", async () => {
  const result = await observeRetainedEmptyRoom({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    originalAncestorIdentity: originalBasis,
    retainedEmpty: { bytes: EMPTY_BYTES, identity: emptyBasis },
  }, {
    model: "fixture",
    now: () => new Date("2026-08-27T12:00:00.000Z"),
    callProvider: async () => roomCObservation(),
  });

  assert.equal(result.authority, "observation_only");
  assert.deepEqual(result.authoritySeparation, {
    cameraAuthorityConsumed: false,
    floorAuthorityConsumed: false,
    worldProjectionPerformed: false,
    tiledEvidenceConsumed: false,
    fullyTiledEvidenceConsumed: false,
  });
  assert.equal(result.qualityGate.normalization?.geometryManufactured, false);
  assert.equal(result.qualityGate.normalization?.hiddenContinuationAdded, false);
});

test("normalization keeps valid diagonal and image-edge side wall-ceiling seams", () => {
  const result = evidence();
  const left = result.observedSeams.find((seam) => seam.id === "wall_ceiling_left");
  const right = result.observedSeams.find((seam) => seam.id === "wall_ceiling_right");
  const back = result.observedSeams.find((seam) => seam.id === "wall_ceiling_back");
  const wallWall = result.observedSeams.find((seam) => seam.id === "wall_wall_left");

  assert.deepEqual(left?.sourceNormalizedPolyline, [...LEFT_SIDE_CEILING]);
  assert.deepEqual(right?.sourceNormalizedPolyline, [...RIGHT_SIDE_CEILING]);
  assert.deepEqual(back?.sourceNormalizedPolyline, [...BACK_WALL_CEILING]);
  assert.deepEqual(wallWall?.sourceNormalizedPolyline, [...LEFT_WALL_WALL]);
  assert.equal(left?.sourceNormalizedPolyline[0]?.x, 0);
  assert.equal(right?.sourceNormalizedPolyline[0]?.x, 1);
  assert.notEqual(left?.sourceNormalizedPolyline[0]?.y, left?.sourceNormalizedPolyline[1]?.y);
  assert.equal(result.qualityGate.normalization.geometryManufactured, false);
  assert.equal(result.qualityGate.normalization.hiddenContinuationAdded, false);
});

test("partial side wall-ceiling segment is not extended or synthesized", () => {
  const raw = roomCObservation();
  raw.observedSeams = raw.observedSeams.map((seam) =>
    seam.id === "wall_ceiling_left"
      ? {
        ...seam,
        sourceNormalizedPolyline: [...PARTIAL_LEFT_SIDE_CEILING],
        ambiguity: "Only the mid-run is confidently visible.",
      }
      : seam
  );
  const result = evidence(raw);
  const left = result.observedSeams.find((seam) => seam.id === "wall_ceiling_left");

  assert.deepEqual(left?.sourceNormalizedPolyline, [...PARTIAL_LEFT_SIDE_CEILING]);
  assert.notEqual(left?.sourceNormalizedPolyline[0]?.x, 0);
  assert.notEqual(left?.sourceNormalizedPolyline.at(-1)?.x, 0.18);
  assert.equal(result.observedSeams.length, raw.observedSeams.length);
  assert.equal(result.qualityGate.normalization.geometryManufactured, false);
  assert.equal(result.qualityGate.normalization.hiddenContinuationAdded, false);
});

test("degenerate and unbound side wall-ceiling seams remain rejected", () => {
  const accepted = evidence().observedPlanes;
  const normalized = normalizeEmptyRoomObservationEvidence({
    planes: accepted,
    seams: [
      {
        id: "degenerate_side",
        category: "wall_ceiling",
        planeIds: ["visible_left_wall", "visible_ceiling"],
        sourceNormalizedPolyline: [
          { x: 0.1, y: 0.2 },
          { x: 0.1, y: 0.2 },
        ],
        endpointPolicy: "preserve_observed_open_endpoints",
        confidence: 0.9,
        ambiguity: null,
        evidenceClass: "provider_reported_visible_evidence",
        observationSource: "focused_side_ceiling_wall",
      },
      {
        id: "unbound_side",
        category: "wall_ceiling",
        planeIds: ["visible_left_wall", "visible_back_wall"],
        sourceNormalizedPolyline: [...LEFT_SIDE_CEILING],
        endpointPolicy: "preserve_observed_open_endpoints",
        confidence: 0.9,
        ambiguity: null,
        evidenceClass: "provider_reported_visible_evidence",
        observationSource: "focused_side_ceiling_wall",
      },
    ],
    openings: [],
    junctions: [],
    parserRejections: [],
  });

  assert.equal(normalized.seams.length, 0);
  assert.equal(
    normalized.diagnostics.rejectedEvidence.some((entry) =>
      entry.rawId === "degenerate_side" &&
      entry.reason === "degenerate_visible_seam_polyline"
    ),
    true,
  );
  assert.equal(
    normalized.diagnostics.rejectedEvidence.some((entry) =>
      entry.rawId === "unbound_side" &&
      entry.reason === "seam_has_invalid_plane_binding_or_category"
    ),
    true,
  );
  assert.equal(normalized.diagnostics.geometryManufactured, false);
  assert.equal(normalized.diagnostics.hiddenContinuationAdded, false);
});

test("omitting an unsupported side wall-ceiling seam does not manufacture a replacement", () => {
  const raw = roomCObservation();
  raw.observedSeams = raw.observedSeams.filter((seam) =>
    seam.id !== "wall_ceiling_right"
  );
  raw.unresolved = ["Right side wall-ceiling junction is too weakly contrasted."];
  const result = evidence(raw);

  assert.equal(
    result.observedSeams.some((seam) => seam.id === "wall_ceiling_right"),
    false,
  );
  assert.equal(
    result.observedSeams.filter((seam) => seam.category === "wall_ceiling").length,
    2,
  );
  assert.match(result.qualityGate.unresolved[0] ?? "", /Right side wall-ceiling/);
  assert.equal(result.qualityGate.normalization.geometryManufactured, false);
  assert.equal(result.qualityGate.normalization.hiddenContinuationAdded, false);
});

test("existing floor-wall, wall-wall, back ceiling, openings, and junctions remain intact", () => {
  const result = evidence();
  assert.deepEqual(
    result.observedSeams.find((seam) => seam.category === "floor_wall")
      ?.sourceNormalizedPolyline,
    [{ x: 0.18, y: 0.62 }, { x: 0.82, y: 0.62 }],
  );
  assert.deepEqual(
    result.observedSeams.find((seam) => seam.id === "wall_wall_left")
      ?.sourceNormalizedPolyline,
    [...LEFT_WALL_WALL],
  );
  assert.deepEqual(
    result.observedSeams.find((seam) => seam.id === "wall_ceiling_back")
      ?.sourceNormalizedPolyline,
    [...BACK_WALL_CEILING],
  );
  assert.equal(result.observedOpenings[0]?.id, "back_window");
  assert.equal(result.observedJunctions[0]?.id, "left_ceiling_corner");
  assert.equal(result.observedVisibleFloorRegions.length, 1);
});

test("S3C isolation: side-seam observation cannot alter Floor or Camera", async () => {
  let observationInputKeys: string[] = [];
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(),
    observeRoom: async (observationInput) => {
      observationInputKeys = Object.keys(observationInput);
      assert.equal("floor" in observationInput, false);
      assert.equal("camera" in observationInput, false);
      return evidence();
    },
  });

  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(observationInputKeys.includes("floor"), false);
  assert.equal(observationInputKeys.includes("camera"), false);
  assert.deepEqual(result.floor.sourceNormalizedPolygon, authoritativeFloorQuad);
  assert.equal(result.product.geometry.geometryAuthority, "tiled_perspective_reader");
  assert.equal(result.camera.originalBasisRestored, true);
  assert.notDeepEqual(
    result.roomObservation?.observedVisibleFloorRegions[0]
      ?.sourceNormalizedPolygon,
    authoritativeFloorQuad,
  );
  assert.equal(result.roomObservation?.authority, "observation_only");
  assert.equal(
    result.roomObservation?.authoritySeparation.floorAuthorityConsumed,
    false,
  );
  assert.equal(
    result.roomObservation?.authoritySeparation.cameraAuthorityConsumed,
    false,
  );
});

test("overlay keeps side wall-ceiling in the existing explicit seam class", () => {
  const overlaySource = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/RoomEvidenceOverlay.tsx"),
    "utf8",
  );
  assert.match(overlaySource, /wall_ceiling: "rgb\(96, 165, 250\)"/);
  assert.match(overlaySource, /data-seam-category=\{seam\.category\}/);
  assert.match(
    overlaySource,
    /data-evidence-role="explicit-observed-architectural-seam"/,
  );
  assert.match(
    overlaySource,
    /data-evidence-role="visible-plane-extent-not-seam"/,
  );
  assert.match(overlaySource, /faint dashed = plane extent · solid = explicit seam/);
  assert.doesNotMatch(overlaySource, /side_wall_ceiling|wall_ceiling_left|world-space/);
});
