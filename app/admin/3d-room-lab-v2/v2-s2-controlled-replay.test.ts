import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createAfcV2ControlledReplayDependencies,
  executeAfcV2ControlledReplay,
  type AfcV2AnalyzeInput,
  type AfcV2ControlledReplayEvidence,
} from "./afc-v2-analysis.server";
import {
  executeAfcSr1TiledLiveProductAttempt,
} from "../3d-room-lab/afc-sr1-tiled-live-product";
import {
  callCompositorAfcSr1TiledPerspectiveReader,
} from "@/lib/callCompositorAfcSr1TiledPerspectiveReader";

const FIXTURE_ROOT = path.join(
  process.cwd(),
  "app/admin/3d-room-lab/research/fixtures/afc-sr1-room-c-strict-semantic-handoff-control.v1",
);
const ORIGINAL_PATH =
  "/Users/stevecoombe/Documents/Vibode/AFC/vibode-afc-r3c-fixed-inputs/room-c/room-c.original.32edb8294a3e5c68d0e54bd5c387eb408b0bc1e15dad781cef0206090df4df1e.jpg";
const EMPTY_PATH = path.join(
  FIXTURE_ROOT,
  "c-raw.b7283bb606d09bc7803543bfcbca14aa5f2041cfb91c5eb590d69d167355243f.png-bytes",
);
const TILED_PATH = path.join(
  FIXTURE_ROOT,
  "c-t1.93c4c40764c863246cd58976c5bc242689f6dfb0e71cb952248872daac76da92.png-bytes",
);
const replayAvailable = [ORIGINAL_PATH, EMPTY_PATH, TILED_PATH].every(existsSync);

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function evidence(): AfcV2ControlledReplayEvidence {
  const original = readFileSync(ORIGINAL_PATH);
  const empty = readFileSync(EMPTY_PATH);
  const tiled = readFileSync(TILED_PATH);
  assert.equal(sha256(original), "32edb8294a3e5c68d0e54bd5c387eb408b0bc1e15dad781cef0206090df4df1e");
  assert.equal(sha256(empty), "b7283bb606d09bc7803543bfcbca14aa5f2041cfb91c5eb590d69d167355243f");
  assert.equal(sha256(tiled), "93c4c40764c863246cd58976c5bc242689f6dfb0e71cb952248872daac76da92");
  return {
    kind: "afc-v2-controlled-replay/v1",
    original: {
      basis: {
        sha256: sha256(original),
        byteCount: original.byteLength,
        decodedWidth: 7360,
        decodedHeight: 4912,
        mimeType: "image/jpeg",
        orientation: 1,
      },
      base64: original.toString("base64"),
    },
    empty: {
      basis: {
        sha256: sha256(empty),
        byteCount: empty.byteLength,
        decodedWidth: 1264,
        decodedHeight: 848,
        mimeType: "image/png",
        orientation: 1,
      },
      base64: empty.toString("base64"),
    },
    floorOnlyTiled: {
      basis: {
        sha256: sha256(tiled),
        byteCount: tiled.byteLength,
        decodedWidth: 1264,
        decodedHeight: 848,
        mimeType: "image/png",
        orientation: 1,
      },
      base64: tiled.toString("base64"),
    },
    lineage: {
      emptySha256: sha256(empty),
      tiledSha256: sha256(tiled),
      emptyToOriginalCompatibilityTier: "aspect_compatible_rescaled",
      transfer: "identity_source_normalized",
      tiledProvenance: {
        generatorId: "vibode-tile-grid-scaffold/stage2/v1",
        profileId: "afc-sr1-tile-grid-scaffold/v1",
        researchPreset: "tile_grid_scaffold",
        requestedModelId: "NBP",
        runId: "df1e68dd-1fce-4850-9bbe-5ac3e8b48ec6",
        generatedAt: "2026-08-09T23:59:51.381Z",
        appliedAspectRatio: null,
        imageTransport: "data_url",
        generationStatus: "generated",
      },
    },
  };
}

const input: AfcV2AnalyzeInput = {
  attemptId: "v2-s2-room-c-t1-replay",
  sourceImageUrl:
    "http://localhost:3000/3d-lab/fixtures/open-plan-or-angled-room.jpg",
  sourceImageIdentity: {
    sha256: "32edb8294a3e5c68d0e54bd5c387eb408b0bc1e15dad781cef0206090df4df1e",
    decodedWidth: 7360,
    decodedHeight: 4912,
    orientation: 1,
  },
  loadGeneration: 1,
  frame: { width: 1118, height: 698 },
  referenceDepthM: 4,
};

const readerResponse = {
  status: "ok" as const,
  decodedIdentity: {
    sha256: "93c4c40764c863246cd58976c5bc242689f6dfb0e71cb952248872daac76da92",
    byteCount: 1178891,
    decodedWidth: 1264,
    decodedHeight: 848,
    mimeType: "image/png" as const,
    orientation: 1 as const,
  },
  readerVersion: "afc-sr1-tiled-perspective-reader/s1" as const,
  authoritativeQuadSourceNormalized: [
    { x: 0.045, y: 1.0 },
    { x: 1.0, y: 0.82 },
    { x: 0.415, y: 0.616 },
    { x: 0.077, y: 0.694 },
  ] as const,
  authoritativeQuadPixel: [
    { x: 56.88, y: 848 },
    { x: 1264, y: 695.36 },
    { x: 524.56, y: 522.368 },
    { x: 97.328, y: 588.512 },
  ] as const,
  authoritativeCore: { rows: 2, columns: 2, j0: 0, i0: 0, cellIds: [1, 2, 3, 4] },
  selectedComponentTileCount: 4,
  rawQuadrilateralCount: 6,
  deduplicatedCellCount: 4,
  reprojectionMeanPx: 0.5,
  reprojectionMaxPx: 1.5,
};

test(
  "Room C T1 exact bytes replay through V1 product and V2 transaction",
  { skip: !replayAvailable },
  async () => {
    const replay = evidence();
    const dependencies = await createAfcV2ControlledReplayDependencies(input, replay);
    assert.ok(dependencies);
    if (!dependencies) return;
    const readTiledPerspective =
      process.env.AFC_V2_CONTROLLED_REPLAY_READER === "live"
        ? callCompositorAfcSr1TiledPerspectiveReader
        : async () => readerResponse;
    const productDependencies = {
      ...dependencies,
      createResultId: () => "room-c-t1-controlled",
      readTiledPerspective,
    };

    const v1 = await executeAfcSr1TiledLiveProductAttempt(
      {
        attemptId: input.attemptId,
        sourceImageUrl: input.sourceImageUrl,
        sourceImageIdentity: input.sourceImageIdentity,
        labLoadGeneration: input.loadGeneration,
        referenceDepthM: input.referenceDepthM,
      },
      productDependencies,
    );
    const v2 = await executeAfcV2ControlledReplay(input, replay, {
      createResultId: () => "room-c-t1-controlled",
      readTiledPerspective,
    });

    assert.equal(v1.status, "authoritative_geometry");
    if (v1.status !== "authoritative_geometry") return;
    assert.deepEqual(v2.product, v1);
    assert.equal(v2.product.geometry.geometryAuthority, "tiled_perspective_reader");
    assert.equal(v2.product.geometry.tiledPerspective?.readerVersion, readerResponse.readerVersion);
    assert.equal(v2.product.emptyBasis.sha256, replay.empty.basis.sha256);
    assert.equal(v2.product.geometry.tiledPerspective?.tiledBasis.sha256, replay.floorOnlyTiled.basis.sha256);

    // This historical Room C byte package has no frozen S2A reader receipt.
    // Its TS2 development quad is intentionally retained as a failure case:
    // V2 must reach the normal settle and fail closed rather than claim parity.
    if (process.env.AFC_V2_CONTROLLED_REPLAY_READER !== "live") {
      assert.equal(v2.status, "failed");
      if (v2.status === "failed") {
        assert.equal(v2.reason, "AFC settle failed closed: no_apply_safe_candidate.");
      }
    }
  },
);

test("controlled replay rejects a mismatched TILED identity before reader execution", async () => {
  const invalid = {
    kind: "afc-v2-controlled-replay/v1",
    original: {
      basis: { sha256: "a".repeat(64), byteCount: 1, decodedWidth: 1, decodedHeight: 1, mimeType: "image/png", orientation: 1 },
      base64: "AQ==",
    },
    empty: {
      basis: { sha256: "b".repeat(64), byteCount: 1, decodedWidth: 1, decodedHeight: 1, mimeType: "image/png", orientation: 1 },
      base64: "Ag==",
    },
    floorOnlyTiled: {
      basis: { sha256: "c".repeat(64), byteCount: 1, decodedWidth: 1, decodedHeight: 1, mimeType: "image/png", orientation: 1 },
      base64: "Aw==",
    },
    lineage: {
      emptySha256: "b".repeat(64),
      tiledSha256: "d".repeat(64),
      emptyToOriginalCompatibilityTier: "exact_grid_compatible",
      transfer: "identity_source_normalized",
      tiledProvenance: {
        generatorId: "vibode-tile-grid-scaffold/stage2/v1",
        profileId: "afc-sr1-tile-grid-scaffold/v1",
        researchPreset: "tile_grid_scaffold",
        requestedModelId: "NBP",
        runId: "test",
        generatedAt: "2026-08-09T23:59:51.381Z",
        appliedAspectRatio: null,
        imageTransport: "data_url",
        generationStatus: "generated",
      },
    },
  } as const;
  assert.equal(
    await createAfcV2ControlledReplayDependencies(
      {
        ...input,
        sourceImageIdentity: {
          sha256: "a".repeat(64),
          decodedWidth: 1,
          decodedHeight: 1,
          orientation: 1,
        },
      },
      invalid,
    ),
    null,
  );
});
