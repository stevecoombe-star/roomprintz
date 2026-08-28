import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  executeAfcV2Analysis,
  type AfcV2AnalyzeInput,
} from "./afc-v2-analysis.server";
import type {
  AfcSr1TiledLiveProductDependencies,
} from "../3d-room-lab/afc-sr1-tiled-live-product";
import {
  buildEmptyRoomObservationEvidence,
} from "./empty-room-observation-contract";

const originalBasis = {
  sha256: "a".repeat(64),
  byteCount: 100,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/jpeg" as const,
  orientation: 1 as const,
};
const emptyBasis = {
  sha256: "b".repeat(64),
  byteCount: 3,
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
  attemptId: "v2-s3c-restored",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 7,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};
const authoritativeQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

async function observeEmptyFixture() {
  return buildEmptyRoomObservationEvidence({
    observedPlanes: [{
      id: "visible_floor",
      category: "floor",
      sourceNormalizedPolygon: [
        { x: 0, y: 1 },
        { x: 1, y: 1 },
        { x: 0.7, y: 0.6 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedSeams: [],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  }, {
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v3",
    generatedAt: "2026-08-26T12:00:00.000Z",
  });
}

function productDependencies(
  observations: {
    order: string[];
    generatedFromBase64: string | null;
    readerBase64: string | null;
  },
  options: {
    generationFails?: boolean;
    readerFails?: boolean;
  } = {},
): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-s3c-result",
    qualifyOriginal: async () => {
      observations.order.push("original");
      return {
        sourceImageUrl: input.sourceImageUrl,
        basis: originalBasis,
      };
    },
    resolveEmpty: async () => {
      observations.order.push("empty");
      return {
        basis: emptyBasis,
        bytes: Uint8Array.from([4, 5, 6]),
        generated: true,
      };
    },
    generateTiled: async (args) => {
      observations.order.push("tiled");
      observations.generatedFromBase64 = args.empty.base64;
      if (options.generationFails) {
        return {
          status: "failure",
          code: "generation_failed",
          runId: "failed-generation",
        };
      }
      return {
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
          runId: "v2-s3c-generation",
          generatedAt: "2026-08-26T12:00:00.000Z",
          appliedAspectRatio: "3:2",
          imageTransport: "data_url",
          generationStatus: "generated",
        },
        compatibility: { tier: "exact_grid_compatible" },
      } as never;
    },
    validateTiledLineage: async () => ({
      tiledIdentity: tiledBasis,
      authority: {
        lineageEvidenceDigest: "d".repeat(64),
      },
    }) as never,
    readTiledPerspective: async (args) => {
      observations.order.push("reader");
      observations.readerBase64 = args.imageBase64;
      if (options.readerFails) {
        return {
          status: "failed",
          reason: "no_complete_tile",
          decodedIdentity: tiledBasis,
          readerVersion: "afc-sr1-tiled-perspective-reader/s1",
        };
      }
      return {
        status: "ok",
        decodedIdentity: tiledBasis,
        readerVersion: "afc-sr1-tiled-perspective-reader/s1",
        authoritativeQuadSourceNormalized: authoritativeQuad,
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
      };
    },
  };
}

test("live V2 restores Original to EMPTY to full-raster TILED reader authority", async () => {
  const observations = {
    order: [] as string[],
    generatedFromBase64: null as string | null,
    readerBase64: null as string | null,
  };
  const result = await executeAfcV2Analysis(input, {
    analysisMode: "controlled_replay",
    product: productDependencies(observations),
    observeRoom: observeEmptyFixture,
  });

  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.deepEqual(observations.order, [
    "original",
    "empty",
    "tiled",
    "reader",
  ]);
  assert.equal(
    observations.generatedFromBase64,
    Buffer.from([4, 5, 6]).toString("base64"),
  );
  assert.equal(
    observations.readerBase64,
    Buffer.from([1, 2, 3]).toString("base64"),
  );
  assert.equal(result.empty?.provenance.generatedFrom, "ORIGINAL");
  assert.equal(
    result.empty?.provenance.parentOriginalSha256,
    originalBasis.sha256,
  );
  assert.equal(result.tiled?.provenance.generatedFrom, "EMPTY");
  assert.equal(result.tiled?.provenance.parentEmptySha256, emptyBasis.sha256);
  assert.equal(result.tiled?.identity.sha256, tiledBasis.sha256);
  assert.equal(result.tiled?.floorReaderContract.input, "full_tiled_raster");
  assert.equal(
    result.product.geometry.geometryAuthority,
    "tiled_perspective_reader",
  );
  assert.deepEqual(
    result.product.geometry.sourceNormalizedPolygon,
    authoritativeQuad,
  );
  assert.deepEqual(result.executionCounts, {
    emptyGeneration: 1,
    floorOnlyTiledGeneration: 1,
    tiledFloorReader: 1,
    fullyTiledGeneration: 0,
    fullyTiledFloorReader: 0,
    roomObserver: 1,
    focusedSideCeilingObserver: 1,
  });
  assert.equal(result.camera.originalBasisRestored, true);
  assert.equal(result.roomObservationStatus, "observed");
  assert.equal(result.roomObservation?.basis.kind, "EMPTY");
});

test("TILED generation failure creates no Floor or camera authority", async () => {
  const observations = {
    order: [] as string[],
    generatedFromBase64: null as string | null,
    readerBase64: null as string | null,
  };
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(observations, { generationFails: true }),
    observeRoom: observeEmptyFixture,
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(observations.order, ["original", "empty", "tiled"]);
  assert.equal(observations.readerBase64, null);
  assert.equal(result.tiled, null);
  assert.equal(result.executionCounts.fullyTiledGeneration, 0);
  assert.equal(result.executionCounts.tiledFloorReader, 0);
});

test("failed certified TILED read preserves evidence but creates no camera", async () => {
  const observations = {
    order: [] as string[],
    generatedFromBase64: null as string | null,
    readerBase64: null as string | null,
  };
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(observations, { readerFails: true }),
    observeRoom: observeEmptyFixture,
  });
  assert.equal(result.status, "failed");
  assert.deepEqual(observations.order, [
    "original",
    "empty",
    "tiled",
    "reader",
  ]);
  assert.equal(result.tiled?.identity.sha256, tiledBasis.sha256);
  assert.equal(result.executionCounts.tiledFloorReader, 1);
  assert.equal(result.executionCounts.fullyTiledFloorReader, 0);
});

test("live route has no FULLY_TILED or abandoned multi-crop dependency", () => {
  const root = process.cwd();
  const files = [
    "app/api/admin/3d-room-lab-v2/analyze/route.ts",
    "app/api/admin/3d-room-lab-v2/attempt-tiled/route.ts",
    "app/admin/3d-room-lab-v2/afc-v2-analysis.server.ts",
    "app/admin/3d-room-lab-v2/RoomLabV2.tsx",
    "app/admin/3d-room-lab-v2/representation-state.ts",
  ];
  const source = files.map((file) =>
    readFileSync(path.join(root, file), "utf8")
  ).join("\n");
  assert.match(source, /executeAfcSr1TiledLiveProductAttempt/);
  assert.match(source, /full_tiled_raster/);
  assert.match(source, /generatedFrom: "EMPTY"/);
  assert.match(source, /X-AFC-V2-Parent-EMPTY-SHA256/);
  assert.doesNotMatch(
    source,
    /generateFullyTiledFromOriginal|executeAfcV2FullyTiledFloorAnalysis|lower_center_floor_region_crop/,
  );
  assert.doesNotMatch(
    source,
    /multi.?crop|candidate clustering|candidate ranking|ambiguity scoring|wall.?grid heuristic/i,
  );
});
