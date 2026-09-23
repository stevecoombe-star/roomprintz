import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { AfcSr1TiledLiveProductDependencies } from "../3d-room-lab/afc-sr1-tiled-live-product";
import { executeAfcV2Analysis, type AfcV2AnalyzeInput } from "./afc-v2-analysis.server";
import { buildEmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import { AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION } from "./empty-original-registration-authority-contract";
import { AFC_V2_ROOM_ENVELOPE_AUTHORITY_VERSION } from "./room-envelope-authority-contract";
import { AFC_V2_ROOM_ENVELOPE_COLLISION_AUTHORITY_VERSION } from "./room-envelope-collision-authority-contract";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
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
  attemptId: "v2-s4c-host",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 23,
  frame: { width: 1118, height: 698 },
  referenceDepthM: 4,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

function observation() {
  return buildEmptyRoomObservationEvidence({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.8, y: 0.62 }, { x: 0.2, y: 0.62 },
        ],
        confidence: 0.91,
        visibility: "observed",
      },
    ],
    observedSeams: [{
      id: "visible_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.2, y: 0.62 }, { x: 0.5, y: 0.62 }, { x: 0.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
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
    promptVersion: "afc-v2-empty-visible-room-observer/v4",
    generatedAt: "2026-08-28T12:00:00.000Z",
  });
}

function productDependencies(): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-s4c-result",
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
        runId: "v2-s4c-generation",
        generatedAt: "2026-08-28T12:00:00.000Z",
        appliedAspectRatio: "3:2",
        imageTransport: "data_url",
        generationStatus: "generated",
      },
      compatibility: { tier: "exact_grid_compatible" },
    } as never),
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
        { x: 120, y: 720 }, { x: 1080, y: 720 }, { x: 780, y: 440 }, { x: 420, y: 440 },
      ],
      authoritativeCore: {
        rows: 2, columns: 2, j0: 0, i0: 0, cellIds: [1, 2, 3, 4],
      },
      selectedComponentTileCount: 4,
      rawQuadrilateralCount: 4,
      deduplicatedCellCount: 4,
      reprojectionMeanPx: 0.5,
      reprojectionMaxPx: 1,
    }),
  };
}

test("S4C omission does not fail AFC apply and leaves S4A/S4B intact", async () => {
  const result = await executeAfcV2Analysis(input, {
    analysisMode: "controlled_replay",
    product: productDependencies(),
    observeRoom: async () => observation(),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.ok(result.roomBoundaries);
  assert.ok(result.roomCollision);
  assert.ok(result.emptyOriginalRegistration);
  assert.equal(
    result.emptyOriginalRegistration.schemaVersion,
    AFC_V2_EMPTY_ORIGINAL_REGISTRATION_AUTHORITY_VERSION,
  );
  assert.equal(result.emptyOriginalRegistration.registrationClass, "exact_grid_registered");
  assert.ok(result.roomEnvelope);
  assert.equal(result.roomEnvelope.schemaVersion, AFC_V2_ROOM_ENVELOPE_AUTHORITY_VERSION);
  assert.equal(result.roomEnvelope.ceiling.status, "not_evaluated");
  assert.ok(result.roomEnvelopeCollision);
  assert.equal(
    result.roomEnvelopeCollision.schemaVersion,
    AFC_V2_ROOM_ENVELOPE_COLLISION_AUTHORITY_VERSION,
  );
  assert.equal(result.roomBoundaries.collisionAuthority, false);
  assert.deepEqual(result.floor.sourceNormalizedPolygon, authoritativeFloorQuad);
  assert.equal(result.originalStructuralLocalization, null);
  assert.equal(result.originalLocalizedBoundary, null);
  assert.equal(result.originalLocalizedCollision, null);
  assert.ok(result.emptyAuthoritativeCollision);
  assert.equal(
    result.emptyAuthoritativeCollision.schemaVersion,
    "afc-v2-empty-authoritative-collision-authority/v1",
  );
  assert.equal(result.emptyAuthoritativeCollision.experimentalPolicy, true);
  assert.equal(result.emptyAuthoritativeCollision.originalCorroborationRequired, false);
});

test("S4C is constructed after S4B and host keeps separate downloads", () => {
  const analysisSource = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/afc-v2-analysis.server.ts"),
    "utf8",
  );
  const roomLabSource = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/RoomLabV2.tsx"),
    "utf8",
  );
  const overlaySource = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/RoomEvidenceOverlay.tsx"),
    "utf8",
  );
  const s4bIndex = analysisSource.indexOf("constructAfcV2RoomCollisionAuthority");
  const s4c0Index = analysisSource.indexOf("constructEmptyOriginalRegistrationAuthority");
  const s4c1Index = analysisSource.indexOf("constructAfcV2RoomEnvelopeAuthority");
  const s4cqIndex = analysisSource.indexOf("constructAfcV2RoomEnvelopeCollisionAuthority");
  const emptyAuthIndex = analysisSource.indexOf("constructAfcV2EmptyAuthoritativeCollisionAuthority");
  assert.ok(s4bIndex > 0 && s4c0Index > s4bIndex && s4c1Index > s4c0Index && s4cqIndex > s4c1Index);
  assert.ok(emptyAuthIndex > s4cqIndex);
  assert.match(roomLabSource, /Room Envelope/);
  assert.match(roomLabSource, /selectActiveRuntimeCollisionWalls/);
  assert.match(roomLabSource, /Active collision source/);
  assert.match(roomLabSource, /Registration path/);
  assert.match(roomLabSource, /ORIGINAL Localization/);
  assert.match(roomLabSource, /Collision policy: EMPTY-authoritative experiment/);
  assert.match(roomLabSource, /afc-v2-s4c0-empty-original-registration-authority\.json/);
  assert.match(roomLabSource, /afc-v2-s4c0-ol-original-structural-localization-authority\.json/);
  assert.match(roomLabSource, /afc-v2-s4c0-ol-original-localized-boundary-authority\.json/);
  assert.match(roomLabSource, /afc-v2-s4c-ol-original-localized-collision-authority\.json/);
  assert.match(roomLabSource, /afc-v2-s4c1-room-envelope-authority\.json/);
  assert.match(roomLabSource, /afc-v2-s4c-cq-room-envelope-collision-authority\.json/);
  assert.match(roomLabSource, /afc-v2-s4a-room-boundary-authority\.json/);
  assert.match(roomLabSource, /afc-v2-s4b-room-collision-authority\.json/);
  assert.match(roomLabSource, /afc-v2-empty-authoritative-collision-authority\.json/);
  assert.match(overlaySource, /s4c-registration-correspondences/);
  assert.match(overlaySource, /registration-point-anchor/);
  assert.match(overlaySource, /registration-ridge-normal/);
  assert.match(roomLabSource, /structure inlier fraction/);
  assert.match(roomLabSource, /methodVersion/);
  assert.match(roomLabSource, /zoom lock/);
  assert.match(overlaySource, /s4c0-ol-original-localization/);
  assert.match(roomLabSource, /collisionWallColor=\{activeCollision\.source === "empty_authoritative"/);
});

test("V1 runtime files are not modified by S4C", () => {
  const v1Files = [
    "app/admin/3d-room-lab/page.tsx",
    "app/admin/3d-room-lab/p2-s2h-furniture-blocker-collision.ts",
  ];
  for (const relative of v1Files) {
    const source = readFileSync(path.join(process.cwd(), relative), "utf8");
    assert.doesNotMatch(source, /constructEmptyOriginalRegistrationAuthority/);
    assert.doesNotMatch(source, /afc-v2-room-envelope-authority\/v1/);
    assert.doesNotMatch(source, /constructAfcV2RoomEnvelopeCollisionAuthority/);
    assert.doesNotMatch(source, /constructAfcV2EmptyAuthoritativeCollisionAuthority/);
  }
});
