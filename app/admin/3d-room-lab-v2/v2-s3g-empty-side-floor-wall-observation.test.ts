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
  buildFocusedSideFloorWallEvidence,
} from "./empty-side-floor-wall-observation-contract";
import {
  AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION,
  observeFocusedSideFloorWallObservation,
} from "./empty-side-floor-wall-observation.server";
import { AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION } from "./empty-room-observation.server";

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
  attemptId: "v2-s3g-focused-side-floor-wall",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 31,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

const LEFT_WALL = [
  { x: 0, y: 0.22 },
  { x: 0.18, y: 0.16 },
  { x: 0.18, y: 0.64 },
  { x: 0.06, y: 1 },
] as const;
const LEFT_SEAM = [
  { x: 0.06, y: 1 },
  { x: 0.18, y: 0.64 },
] as const;

const focusedContext = {
  attemptId: input.attemptId,
  loadGeneration: input.loadGeneration,
  emptyIdentity: emptyBasis,
  originalAncestorSha256: originalBasis.sha256,
  provider: "controlled_fixture" as const,
  model: "fixture",
  observerProfile: "empty-side-floor-wall-conservative/v1",
  promptVersion: AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION,
  generatedAt: "2026-08-29T18:00:00.000Z",
};

function generalRaw() {
  return {
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0.06, y: 1 },
          { x: 0.96, y: 1 },
          { x: 0.8, y: 0.64 },
          { x: 0.18, y: 0.64 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_back_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.18, y: 0.16 },
          { x: 0.8, y: 0.16 },
          { x: 0.8, y: 0.64 },
          { x: 0.18, y: 0.64 },
        ],
        confidence: 0.91,
        visibility: "observed",
      },
      {
        id: "visible_right_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 1, y: 0.22 },
          { x: 0.8, y: 0.16 },
          { x: 0.8, y: 0.64 },
          { x: 0.96, y: 1 },
        ],
        confidence: 0.88,
        visibility: "observed",
      },
    ],
    observedSeams: [
      {
        id: "floor_wall_back",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_back_wall"],
        sourceNormalizedPolyline: [
          { x: 0.18, y: 0.64 },
          { x: 0.8, y: 0.64 },
        ],
        confidence: 0.92,
        visibility: "observed",
      },
      {
        id: "floor_wall_right",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_right_wall"],
        sourceNormalizedPolyline: [
          { x: 0.96, y: 1 },
          { x: 0.8, y: 0.64 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
    ],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  };
}

function generalEvidence(): EmptyRoomObservationAcceptedEvidence {
  return buildEmptyRoomObservationEvidence(generalRaw(), {
    ...focusedContext,
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION,
  });
}

function focusedEvidence() {
  return buildFocusedSideFloorWallEvidence({
    observedSides: [{
      side: "left",
      wallPlaneVisible: true,
      sourceNormalizedWallPolygon: [...LEFT_WALL],
      sourceNormalizedFloorWallPolyline: [...LEFT_SEAM],
      confidence: 0.82,
      visibility: "observed",
      ambiguity: null,
      frameTruncated: true,
    }],
    unresolved: [],
  }, focusedContext);
}

function productDependencies(): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-s3g-focused-result",
    qualifyOriginal: async () => ({
      sourceImageUrl: input.sourceImageUrl,
      basis: originalBasis,
    }),
    resolveEmpty: async () => ({
      basis: emptyBasis,
      bytes: EMPTY_BYTES,
      generated: true,
    }),
    generateTiled: async (args) => ({
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
        runId: "v2-s3g-focused-generation",
        generatedAt: "2026-08-29T18:00:00.000Z",
        appliedAspectRatio: "3:2",
        imageTransport: "data_url",
        generationStatus: "generated",
      },
      compatibility: { tier: "exact_grid_compatible" },
      capturedEmptyBase64: args.empty.base64,
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

test("focused side floor-wall prompt is narrow and forbids hidden completion", async () => {
  let suppliedPrompt = "";
  const result = await observeFocusedSideFloorWallObservation({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    originalAncestorIdentity: originalBasis,
    retainedEmpty: { bytes: EMPTY_BYTES, identity: emptyBasis },
  }, {
    model: "fixture",
    now: () => new Date("2026-08-29T18:00:00.000Z"),
    callProvider: async (args) => {
      suppliedPrompt = args.prompt;
      assert.equal(
        args.imageBase64,
        Buffer.from(EMPTY_BYTES).toString("base64"),
      );
      return {
        observedSides: [{
          side: "left",
          wallPlaneVisible: true,
          sourceNormalizedWallPolygon: [...LEFT_WALL],
          sourceNormalizedFloorWallPolyline: [...LEFT_SEAM],
          confidence: 0.82,
          visibility: "observed",
          frameTruncated: true,
        }],
        unresolved: [],
        cameraPose: { x: 1 },
      };
    },
  });

  assert.equal(result.observer.promptVersion, AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION);
  assert.equal(result.observer.promptVersion, "afc-v2-empty-side-floor-wall-observer/v2");
  assert.equal(result.authority, "observation_only");
  assert.deepEqual(result.authoritySeparation, {
    cameraAuthorityConsumed: false,
    floorAuthorityConsumed: false,
    worldProjectionPerformed: false,
    tiledEvidenceConsumed: false,
    fullyTiledEvidenceConsumed: false,
  });
  assert.equal(result.qualityGate.geometryManufactured, false);
  assert.equal(result.qualityGate.hiddenContinuationAdded, false);
  assert.match(suppliedPrompt, /left side and the right side independently/i);
  assert.match(suppliedPrompt, /floor-wall/i);
  assert.match(suppliedPrompt, /architectural lateral wall bounding the room/i);
  assert.match(suppliedPrompt, /visibly continues toward the foreground/i);
  assert.match(suppliedPrompt, /visible physical contact where the visible floor region meets the side wall/i);
  assert.match(suppliedPrompt, /Do not automatically use the wall polygon's lower edge/i);
  assert.match(suppliedPrompt, /leaving the corner toward the foreground along the visible floor boundary/i);
  assert.match(suppliedPrompt, /upward = wall-wall/i);
  assert.match(suppliedPrompt, /across the rear = back floor-wall/i);
  assert.match(suppliedPrompt, /arbitrary nearest-frame cut/i);
  assert.match(
    suppliedPrompt,
    /ONLY when the actual visible floor-wall contact itself reaches that frame/i,
  );
  assert.match(suppliedPrompt, /If the true contact cannot be identified, omit/i);
  assert.match(suppliedPrompt, /Hidden continuation beyond the frame is forbidden/i);
  assert.match(suppliedPrompt, /Do not invent hidden geometry/i);
  assert.match(suppliedPrompt, /Observation-only/i);
  assert.match(suppliedPrompt, /It is not TILED/i);
  assert.match(suppliedPrompt, /no camera, Floor authority/i);
  assert.match(suppliedPrompt, /ORIGINAL/i);
  assert.match(suppliedPrompt, /Do not omit a visible side wall merely because the floor polygon/i);
  assert.match(suppliedPrompt, /Do not infer a wall merely because a room "should" have one/i);
  assert.match(suppliedPrompt, /Do not report/i);
  assert.match(suppliedPrompt, /the back wall/i);
  assert.match(suppliedPrompt, /wall-ceiling seams/i);
  assert.doesNotMatch(suppliedPrompt, /Observed finite segment to the frame = valid/i);
  assert.doesNotMatch(suppliedPrompt, /A triangular or narrow visible wedge is acceptable/i);
  assert.doesNotMatch(suppliedPrompt, /complete the room|rectangular-room completion/i);
  assert.doesNotMatch(suppliedPrompt, /Room 2|Room2/i);
  assert.equal(result.observedSides.length, 1);
  assert.deepEqual(
    result.qualityGate.rejectedForbiddenProviderFields,
    ["cameraPose"],
  );
});

test("general prompt v5 allows frame-terminated side floor-wall seams", () => {
  assert.equal(
    AFC_V2_EMPTY_ROOM_OBSERVATION_PROMPT_VERSION,
    "afc-v2-empty-visible-room-observer/v5",
  );
  const source = readFileSync(
    path.join(
      process.cwd(),
      "app/admin/3d-room-lab-v2/empty-room-observation.server.ts",
    ),
    "utf8",
  );
  assert.match(source, /visible side floor-wall boundaries/i);
  assert.match(source, /emit the explicit finite seam even if one endpoint is at the image frame/i);
  assert.match(source, /Do not omit a directly visible floor-wall seam merely because/i);
  assert.match(source, /do not extend beyond the frame/i);
});

test("focused pass consumes the same retained EMPTY identity as general", async () => {
  const hashes = {
    general: "",
    focusedFloorWall: "",
    tiledEmpty: "",
  };
  const result = await executeAfcV2Analysis(input, {
    product: {
      ...productDependencies(),
      generateTiled: async (args) => {
        hashes.tiledEmpty = createHash("sha256")
          .update(Buffer.from(args.empty.base64, "base64"))
          .digest("hex");
        return productDependencies().generateTiled!(args);
      },
    },
    observeRoom: async (observationInput) => {
      hashes.general = observationInput.retainedEmpty.identity.sha256;
      assert.equal(
        createHash("sha256").update(observationInput.retainedEmpty.bytes)
          .digest("hex"),
        hashes.general,
      );
      return generalEvidence();
    },
    observeFocusedSideFloorWall: async (observationInput) => {
      hashes.focusedFloorWall = observationInput.retainedEmpty.identity.sha256;
      assert.equal(
        createHash("sha256").update(observationInput.retainedEmpty.bytes)
          .digest("hex"),
        hashes.focusedFloorWall,
      );
      return focusedEvidence();
    },
  });

  assert.equal(hashes.general, emptyBasis.sha256);
  assert.equal(hashes.focusedFloorWall, emptyBasis.sha256);
  assert.equal(hashes.tiledEmpty, emptyBasis.sha256);
  assert.equal(result.roomObservation?.basis.identity.sha256, emptyBasis.sha256);
  assert.equal(
    result.focusedSideFloorWallObservation?.basis.identity.sha256,
    emptyBasis.sha256,
  );
  assert.equal(result.executionCounts.roomObserver, 1);
  assert.equal(result.executionCounts.focusedSideFloorWallObserver, 1);
  assert.equal(
    result.roomObservation && result.roomObservation.observerStatus !== "failed"
      ? result.roomObservation.qualityGate.focusedSideFloorWall.emptyIdentitySha256
      : null,
    emptyBasis.sha256,
  );
});

test("host merge recovers omitted left floor-wall into S4A candidates", async () => {
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(),
    observeRoom: async () => generalEvidence(),
    observeFocusedSideFloorWall: async () => focusedEvidence(),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  const observation = result.roomObservation;
  assert.ok(observation && observation.observerStatus !== "failed");
  assert.equal(
    observation.observedSeams.filter((seam) => seam.category === "floor_wall")
      .length,
    3,
  );
  assert.equal(observation.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.equal(observation.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 1);
  assert.equal(result.roomBoundaries?.summary.candidateCount, 3);
  assert.ok(result.roomBoundaries?.candidates.some((candidate) =>
    candidate.sourceSeamId.includes("left")
  ));
});

test("focused floor-wall failure does not fail Analyze & Apply", async () => {
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(),
    observeRoom: async () => generalEvidence(),
    observeFocusedSideFloorWall: async () => {
      throw new Error("controlled focused side-floor-wall failure");
    },
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.roomObservationStatus, "observed");
  assert.equal(
    result.roomObservation?.observedSeams.filter((seam) =>
      seam.category === "floor_wall"
    ).length,
    2,
  );
  assert.equal(result.focusedSideFloorWallObservationStatus, "failed");
});

test("host UI surfaces focused side floor-wall diagnostics", () => {
  const roomLab = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/RoomLabV2.tsx"),
    "utf8",
  );
  assert.match(roomLab, /Focused side floor-wall/);
  assert.match(roomLab, /focusedSideFloorWall/);
});

test("S4A still rejects non-canonical focused observationSource values", () => {
  const authority = readFileSync(
    path.join(
      process.cwd(),
      "app/admin/3d-room-lab-v2/room-boundary-authority.server.ts",
    ),
    "utf8",
  );
  assert.match(authority, /observationSourceMayCreateWorldBoundary/);
  assert.match(authority, /focused_observer_cannot_create_world_boundary/);
});

test("exact-grid / EMPTY-authoritative runtime routing is unchanged", () => {
  const analysis = readFileSync(
    path.join(process.cwd(), "app/admin/3d-room-lab-v2/afc-v2-analysis.server.ts"),
    "utf8",
  );
  const envelope = readFileSync(
    path.join(
      process.cwd(),
      "app/admin/3d-room-lab-v2/room-envelope-collision-authority-contract.ts",
    ),
    "utf8",
  );
  assert.match(analysis, /mergeFocusedSideFloorWallObservation/);
  assert.match(analysis, /observeFocusedSideFloorWallObservation/);
  assert.match(envelope, /aspect_compatible_rescaled/);
  assert.doesNotMatch(analysis, /if \(room === /);
  assert.doesNotMatch(
    readFileSync(
      path.join(
        process.cwd(),
        "app/admin/3d-room-lab-v2/empty-side-floor-wall-observation-merge.server.ts",
      ),
      "utf8",
    ),
    /Room2|0\.046/,
  );
});
