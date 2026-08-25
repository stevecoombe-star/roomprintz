import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  executeAfcV2S3Analysis,
} from "./afc-v2-s3-analysis.server";
import type {
  AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import type {
  AfcV2FullyTiledFloorAnalyzeResult,
  PreparedAfcV2FloorInputs,
} from "./fully-tiled-floor-authority.server";
import {
  AFC_V2_FULLY_TILED_PROMPT,
} from "./fully-tiled-prompt";
import {
  buildRoomObservationContract,
  type RoomObservationImageIdentity,
} from "./room-observation-contract";

const input: AfcV2AnalyzeInput = {
  attemptId: "v2-s3-controlled",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: "a".repeat(64),
    decodedWidth: 1200,
    decodedHeight: 800,
    orientation: 1,
  },
  loadGeneration: 3,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};

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
const emptyIdentity = {
  sha256: "c".repeat(64),
  byteCount: 150,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const prepared: PreparedAfcV2FloorInputs = {
  attemptId: input.attemptId,
  resultId: "result-controlled",
  labLoadGeneration: input.loadGeneration,
  original: {
    sourceImageUrl: input.sourceImageUrl,
    basis: originalIdentity,
  },
  empty: {
    basis: emptyIdentity,
    bytes: Uint8Array.from([4, 5, 6]),
    generated: true,
  },
};

const generation = {
  status: "generated" as const,
  value: {
    bytes: Uint8Array.from([1, 2, 3]),
    identity: fullyTiledIdentity,
    originalIdentity,
    provenance: {
      generationId: "generation-controlled",
      generatorId: "afc-v2-fully-tiled-compositor/stage4/v1" as const,
      promptVersion: "afc-v2-fully-tiled-generation/v1" as const,
      promptSha256: createHash("sha256")
        .update(AFC_V2_FULLY_TILED_PROMPT)
        .digest("hex"),
      requestedModelId: "NBP" as const,
      generatedFrom: "ORIGINAL" as const,
      parentOriginalSha256: originalIdentity.sha256,
      generatedAt: "2026-08-25T12:00:00.000Z",
      appliedAspectRatio: "3:2",
      imageTransport: "data_url" as const,
    },
  },
};

const floorPolygon = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;
const floorProduct = {
  status: "authoritative_floor" as const,
  productVersion: "afc-v2-fully-tiled-floor-authority/v1" as const,
  attemptId: input.attemptId,
  resultId: prepared.resultId,
  labLoadGeneration: input.loadGeneration,
  originalBasis: originalIdentity,
  emptyBasis: emptyIdentity,
  floorObservationSource: {
    kind: "FULLY_TILED" as const,
    imageIdentity: fullyTiledIdentity,
    generationId: generation.value.provenance.generationId,
    generatedFrom: "ORIGINAL" as const,
    parentOriginalSha256: originalIdentity.sha256,
    readerVersion: "afc-sr1-tiled-perspective-reader/s1" as const,
    readerInput: {
      identity: {
        ...fullyTiledIdentity,
        sha256: "e".repeat(64),
        byteCount: 120,
        decodedWidth: 720,
        decodedHeight: 400,
      },
      crop: {
        kind: "lower_center_floor_region_crop" as const,
        leftSourceNormalized: 0.2 as const,
        rightSourceNormalized: 0.8 as const,
        topSourceNormalized: 0.5 as const,
        sourceIdentitySha256: fullyTiledIdentity.sha256,
        sourceNormalizedTransform:
          "x_source=left+x_crop*(right-left);y_source=top+y_crop*(1-top)" as const,
      },
    },
    authoritativeQuadSourceNormalized: floorPolygon,
    transferToOriginal:
      "aspect_compatible_source_normalized_not_pixel_verified" as const,
  },
  metric: {
    metricScaleAuthority: "provisional_reference_depth" as const,
    referenceDepthM: 4,
  },
  readerDiagnostics: {
    core: { rows: 2, columns: 2, j0: 0, i0: 0, cellIds: [1, 2, 3, 4] },
    selectedComponentTileCount: 4,
    rawQuadrilateralCount: 4,
    deduplicatedCellCount: 4,
    reprojectionMeanPx: 0.5,
    reprojectionMaxPx: 1,
  },
};
const floorResult = {
  status: "applied",
  product: floorProduct,
  floor: {
    authorityKey: "floor-authority",
    sourceNormalizedPolygon: floorPolygon,
    worldWidthM: 6,
    referenceDepthM: 4,
    widthDepthRatio: 1.5,
  },
  camera: {
    applied: true,
    verticalFovDeg: 55,
    pose: {
      position: { x: 1, y: 2, z: 3 },
      lookAt: { x: 0, y: 0, z: 0 },
      up: { x: 0, y: 1, z: 0 },
    },
    frame: { width: 900, height: 600 },
    originalBasisRestored: true,
  },
  analysisMode: "controlled_replay",
  freezeReceipt: { receiptVersion: "fixture" },
} as unknown as Extract<
  AfcV2FullyTiledFloorAnalyzeResult,
  { status: "applied" }
>;

function observation() {
  return buildRoomObservationContract(
    {
      observedPlanes: [],
      observedGridFamilies: [],
      observedSeams: [],
      observedOpenings: [],
      adjacency: [],
      unresolved: ["Fixture intentionally contains no visible evidence."],
    },
    {
      originalIdentity,
      fullyTiledIdentity,
      generationId: generation.value.provenance.generationId,
      attemptId: input.attemptId,
      floorResultId: floorProduct.resultId,
      cameraAuthorityKey: floorResult.floor.authorityKey,
      frozenSnapshotDigest: "d".repeat(64),
      provider: "controlled_fixture",
      model: "fixture",
      promptVersion: "observer/v1",
      generatedAt: "2026-08-25T12:00:01.000Z",
    },
  );
}

test("live V2 generates one FULLY_TILED scaffold before Floor and reuses it for room observation", async () => {
  const order: string[] = [];
  let floorBytes: Uint8Array | null = null;
  let roomIdentity = "";
  const result = await executeAfcV2S3Analysis(input, {
    createResultId: () => prepared.resultId,
    prepareFloorInputs: async () => {
      order.push("empty");
      return { status: "prepared", value: prepared };
    },
    generateFullyTiled: async () => {
      order.push("fully_tiled");
      return generation;
    },
    executeFloorAnalysis: async (_input, _prepared, fullyTiled) => {
      order.push("floor_reader_camera");
      floorBytes = fullyTiled.bytes;
      assert.equal(fullyTiled.identity.sha256, fullyTiledIdentity.sha256);
      return floorResult;
    },
    observeRoom: async (observationInput) => {
      order.push("room_observation");
      roomIdentity = observationInput.generation.identity.sha256;
      return { status: "observed", contract: observation() };
    },
  });

  assert.deepEqual(order, [
    "empty",
    "fully_tiled",
    "floor_reader_camera",
    "room_observation",
  ]);
  assert.equal(floorBytes, generation.value.bytes);
  assert.equal(roomIdentity, fullyTiledIdentity.sha256);
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.deepEqual(result.executionCounts, {
    emptyGeneration: 1,
    fullyTiledGeneration: 1,
    floorOnlyTiledGeneration: 0,
    fullyTiledFloorReader: 1,
    roomObserver: 1,
  });
  assert.deepEqual(result.liveGeneratedRepresentations, [
    "EMPTY",
    "FULLY_TILED",
  ]);
  assert.equal(
    result.product.floorObservationSource.imageIdentity.sha256,
    fullyTiledIdentity.sha256,
  );
  assert.equal(
    result.product.floorObservationSource.generationId,
    generation.value.provenance.generationId,
  );
  assert.equal(
    result.product.floorObservationSource.parentOriginalSha256,
    originalIdentity.sha256,
  );
  assert.equal(
    result.fullyTiled.binding.floorObservationSource,
    "FULLY_TILED",
  );
  assert.equal(result.fullyTiled.binding.floorAuthorityKey, "floor-authority");
  assert.equal(
    result.roomObservation.calibratedCameraReference.floorResultId,
    floorProduct.resultId,
  );
  assert.equal(
    result.roomObservation.representationIdentity.generationId,
    result.product.floorObservationSource.generationId,
  );
});

test("FULLY_TILED generation failure stops before Floor and room observation", async () => {
  let floorCalled = false;
  let roomCalled = false;
  const result = await executeAfcV2S3Analysis(input, {
    createResultId: () => prepared.resultId,
    prepareFloorInputs: async () => ({ status: "prepared", value: prepared }),
    generateFullyTiled: async () => ({
      status: "failed",
      reason: "controlled_generation_failure",
    }),
    executeFloorAnalysis: async () => {
      floorCalled = true;
      return floorResult;
    },
    observeRoom: async () => {
      roomCalled = true;
      throw new Error("must not run");
    },
  });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.stage, "fully_tiled_generation");
  assert.equal(result.floorCameraApplied, false);
  assert.equal(result.fullyTiled, null);
  assert.equal(floorCalled, false);
  assert.equal(roomCalled, false);
  assert.equal(result.executionCounts.floorOnlyTiledGeneration, 0);
});

test("floor failure retains FULLY_TILED inspection evidence without invoking room observer", async () => {
  let roomCalled = false;
  const result = await executeAfcV2S3Analysis(input, {
    createResultId: () => prepared.resultId,
    prepareFloorInputs: async () => ({ status: "prepared", value: prepared }),
    generateFullyTiled: async () => generation,
    executeFloorAnalysis: async () => ({
      status: "failed",
      reason: "controlled_floor_reader_failure",
      product: floorProduct,
    }),
    observeRoom: async () => {
      roomCalled = true;
      throw new Error("must not run");
    },
  });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") return;
  assert.equal(result.stage, "floor_camera");
  assert.equal(result.floorCameraApplied, false);
  assert.equal(result.fullyTiled?.identity.sha256, fullyTiledIdentity.sha256);
  assert.equal(result.fullyTiled?.binding.floorAuthorityKey, null);
  assert.equal(result.roomObservation, null);
  assert.equal(roomCalled, false);
});

test("room-observation failure preserves Floor, camera, FULLY_TILED, and safe diagnostic", async () => {
  const diagnostic = {
    failureClass: "provider_http" as const,
    failureStage: "provider_response" as const,
    provider: "google_gemini" as const,
    model: "gemini-3.5-flash",
    providerStatus: 400,
    safeDetail: "Room observer HTTP 400: INVALID_ARGUMENT.",
    contractValidationReason: null,
  };
  const result = await executeAfcV2S3Analysis(input, {
    createResultId: () => prepared.resultId,
    prepareFloorInputs: async () => ({ status: "prepared", value: prepared }),
    generateFullyTiled: async () => generation,
    executeFloorAnalysis: async () => floorResult,
    observeRoom: async () => ({
      status: "failed",
      reason: "controlled_observation_failure",
      diagnostic,
    }),
  });
  assert.equal(result.status, "partial");
  if (result.status !== "partial") return;
  assert.equal(result.floor, floorResult.floor);
  assert.equal(result.camera, floorResult.camera);
  assert.equal(result.fullyTiled.identity.sha256, fullyTiledIdentity.sha256);
  assert.deepEqual(result.roomObservationDiagnostic, diagnostic);
});

test("FULLY_TILED generation and floor-reader source contain no floor-only scaffold dependency", () => {
  assert.equal(
    createHash("sha256").update(AFC_V2_FULLY_TILED_PROMPT).digest("hex"),
    "83657e782dd225c6fc5314748a339b21e860eb461c531f2d981d0fad8f6b755e",
  );
  const source = [
    "afc-v2-s3-analysis.server.ts",
    "fully-tiled-generation.server.ts",
    "fully-tiled-floor-authority.server.ts",
  ].map((file) =>
    readFileSync(
      path.join(process.cwd(), "app/admin/3d-room-lab-v2", file),
      "utf8",
    )
  ).join("\n");
  assert.match(source, /floorObservationSource/);
  assert.match(source, /callCompositorAfcSr1TiledPerspectiveReader/);
  assert.doesNotMatch(
    source,
    /vibodeTileGridScaffoldAssist|tile_grid_scaffold|generateTiled/,
  );
});

test("FULLY_TILED evidence route exposes V2 Floor source without false EMPTY lineage", () => {
  const routeSource = readFileSync(
    path.join(
      process.cwd(),
      "app/api/admin/3d-room-lab-v2/attempt-fully-tiled/route.ts",
    ),
    "utf8",
  );
  assert.match(routeSource, /X-AFC-V2-Floor-Observation-Source/);
  assert.match(routeSource, /X-AFC-V2-Floor-Result/);
  assert.match(routeSource, /X-AFC-V2-Floor-Authority/);
  assert.doesNotMatch(routeSource, /EMPTY.*TILED|emptyToTiled/);
});

test("V2-S3 runtime remains isolated from boundary, support, collision, and camera writers", () => {
  const files = [
    "afc-v2-s3-analysis.server.ts",
    "fully-tiled-floor-authority.server.ts",
    "room-observation.server.ts",
    "room-observation-contract.ts",
    "RoomLabV2.tsx",
    "RoomEvidenceOverlay.tsx",
  ];
  const source = files.map((file) =>
    readFileSync(
      path.join(process.cwd(), "app/admin/3d-room-lab-v2", file),
      "utf8",
    )
  ).join("\n");
  assert.doesNotMatch(
    source,
    /room-envelope-reconciliation|live-collision|support-attachment|ThreeRoomLab|Type-B|afc-ui2|g0-containment/i,
  );
  assert.doesNotMatch(source, /setCalibratedCamera|applyContainerFloor/);
});
