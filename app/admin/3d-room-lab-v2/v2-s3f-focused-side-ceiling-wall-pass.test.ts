import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
  buildFailedEmptyRoomObservationEvidence,
  type EmptyRoomObservationAcceptedEvidence,
} from "./empty-room-observation-contract";
import {
  buildFocusedSideCeilingWallEvidence,
  buildFailedFocusedSideCeilingWallEvidence,
} from "./empty-side-ceiling-wall-observation-contract";
import { mergeFocusedSideCeilingWallSeams } from "./empty-side-ceiling-wall-observation-merge.server";
import {
  AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION,
  observeFocusedSideCeilingWallSeams,
} from "./empty-side-ceiling-wall-observation.server";

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
  attemptId: "v2-s3f-focused-side-ceiling",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 22,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;
const LEFT_SIDE = [
  { x: 0, y: 0.28 },
  { x: 0.18, y: 0.12 },
] as const;
const PARTIAL_LEFT_SIDE = [
  { x: 0.04, y: 0.24 },
  { x: 0.14, y: 0.15 },
] as const;

const focusedContext = {
  attemptId: input.attemptId,
  loadGeneration: input.loadGeneration,
  emptyIdentity: emptyBasis,
  originalAncestorSha256: originalBasis.sha256,
  provider: "controlled_fixture" as const,
  model: "fixture",
  observerProfile: "empty-side-ceiling-wall-conservative/v1",
  promptVersion: AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION,
  generatedAt: "2026-08-27T18:00:00.000Z",
};

function generalObservation(options: {
  includeLeftSide?: boolean;
  includeWallWall?: boolean;
} = {}) {
  return {
    observedPlanes: [
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
    ],
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
        id: "wall_ceiling_back",
        category: "wall_ceiling",
        planeIds: ["visible_back_wall", "visible_ceiling"],
        sourceNormalizedPolyline: [
          { x: 0.18, y: 0.12 },
          { x: 0.82, y: 0.11 },
        ],
        confidence: 0.89,
        visibility: "observed",
      },
      ...(options.includeWallWall
        ? [{
          id: "wall_wall_left",
          category: "wall_wall",
          planeIds: ["visible_back_wall", "visible_left_wall"],
          sourceNormalizedPolyline: [
            { x: 0.18, y: 0.12 },
            { x: 0.18, y: 0.62 },
          ],
          confidence: 0.9,
          visibility: "observed",
        }]
        : []),
      ...(options.includeLeftSide
        ? [{
          id: "wall_ceiling_left",
          category: "wall_ceiling",
          planeIds: ["visible_left_wall", "visible_ceiling"],
          sourceNormalizedPolyline: [...LEFT_SIDE],
          confidence: 0.81,
          visibility: "observed",
        }]
        : []),
    ],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  };
}

function generalEvidence(
  raw: unknown = generalObservation(),
): EmptyRoomObservationAcceptedEvidence {
  return buildEmptyRoomObservationEvidence(raw, {
    ...focusedContext,
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v3",
  });
}

function focusedEvidence(
  polyline: readonly { x: number; y: number }[] = [...LEFT_SIDE],
  extra: Record<string, unknown> = {},
) {
  return buildFocusedSideCeilingWallEvidence({
    observedSeams: [{
      id: "left_side_ceiling",
      category: "wall_ceiling",
      sourceNormalizedPolyline: polyline,
      confidence: 0.8,
      visibility: "observed",
    }],
    unresolved: [],
    ...extra,
  }, focusedContext);
}

function failedGeneral() {
  return buildFailedEmptyRoomObservationEvidence({
    ...focusedContext,
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v3",
  }, {
    failureClass: "transport",
    failureStage: "provider_invocation",
    provider: "controlled_fixture",
    model: "fixture",
    providerStatus: null,
    safeDetail: "Controlled general observer failure.",
    contractValidationReason: null,
  });
}

function productDependencies(): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-s3f-focused-result",
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
        runId: "v2-s3f-focused-generation",
        generatedAt: "2026-08-27T18:00:00.000Z",
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

test("focused pass consumes the same retained EMPTY identity as general and TILED", async () => {
  const hashes = {
    general: "",
    focused: "",
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
    observeFocusedSideCeilingWall: async (observationInput) => {
      hashes.focused = observationInput.retainedEmpty.identity.sha256;
      return focusedEvidence();
    },
  });

  assert.equal(hashes.general, emptyBasis.sha256);
  assert.equal(hashes.focused, emptyBasis.sha256);
  assert.equal(hashes.tiledEmpty, emptyBasis.sha256);
  assert.equal(result.roomObservation?.basis.identity.sha256, emptyBasis.sha256);
  assert.equal(
    result.focusedSideCeilingObservation?.basis.identity.sha256,
    emptyBasis.sha256,
  );
  assert.equal(result.empty?.identity.sha256, emptyBasis.sha256);
  assert.equal(result.tiled?.provenance.parentEmptySha256, emptyBasis.sha256);
  assert.equal(result.executionCounts.roomObserver, 1);
  assert.equal(result.executionCounts.focusedSideCeilingObserver, 1);
});

test("focused contract is wall-ceiling-only observation in EMPTY image space", async () => {
  let suppliedPrompt = "";
  const result = await observeFocusedSideCeilingWallSeams({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    originalAncestorIdentity: originalBasis,
    retainedEmpty: { bytes: EMPTY_BYTES, identity: emptyBasis },
  }, {
    model: "fixture",
    now: () => new Date("2026-08-27T18:00:00.000Z"),
    callProvider: async (args) => {
      suppliedPrompt = args.prompt;
      assert.equal(
        args.imageBase64,
        Buffer.from(EMPTY_BYTES).toString("base64"),
      );
      return {
        observedSeams: [{
          id: "left_side_ceiling",
          category: "wall_ceiling",
          sourceNormalizedPolyline: [...LEFT_SIDE],
          confidence: 0.8,
          visibility: "observed",
        }],
        unresolved: [],
        cameraPose: { x: 1 },
        worldGeometry: [],
      };
    },
  });

  assert.equal(
    AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION,
    "afc-v2-empty-side-ceiling-wall-observer/v2",
  );
  assert.equal(result.observer.promptVersion, AFC_V2_EMPTY_SIDE_CEILING_WALL_PROMPT_VERSION);
  assert.equal(result.authority, "observation_only");
  assert.equal(result.coordinateSpace, "empty-source-normalized-image/v1");
  assert.deepEqual(result.authoritySeparation, {
    cameraAuthorityConsumed: false,
    floorAuthorityConsumed: false,
    worldProjectionPerformed: false,
    tiledEvidenceConsumed: false,
    fullyTiledEvidenceConsumed: false,
  });
  assert.equal(result.observedSeams.length, 1);
  assert.equal(result.observedSeams[0]?.category, "wall_ceiling");
  assert.deepEqual(result.observedSeams[0]?.sourceNormalizedPolyline, [...LEFT_SIDE]);
  assert.equal(result.qualityGate.geometryManufactured, false);
  assert.equal(result.qualityGate.hiddenContinuationAdded, false);
  assert.deepEqual(result.qualityGate.rejectedForbiddenProviderFields, [
    "cameraPose",
    "worldGeometry",
  ]);
  assert.match(suppliedPrompt, /only for visible side wall-ceiling seams/i);
  assert.match(suppliedPrompt, /perspective-receding/i);
  assert.match(suppliedPrompt, /Do not force both sides/i);
  assert.match(suppliedPrompt, /If uncertain, omit/i);
  assert.match(suppliedPrompt, /Never infer hidden continuation/i);
  assert.match(suppliedPrompt, /pelmets, curtain boxes, bulkheads/i);
  assert.match(suppliedPrompt, /Do not substitute the lower edge of an attached overhead element/i);
  assert.match(suppliedPrompt, /Do not invent a hidden continuation behind it/i);
  assert.doesNotMatch(suppliedPrompt, /vanishing-point solution|Room Boundaries/i);
});

test("empty focused result is valid omission and does not invent seams", () => {
  const focused = buildFocusedSideCeilingWallEvidence({
    observedSeams: [],
    unresolved: [],
  }, focusedContext);
  assert.equal(focused.observerStatus, "observed");
  assert.equal(focused.observedSeams.length, 0);
  const merged = mergeFocusedSideCeilingWallSeams({
    general: generalEvidence(),
    focused,
  });
  assert.equal(merged?.observerStatus, "observed");
  if (!merged || merged.observerStatus !== "observed") return;
  assert.equal(
    merged.observedSeams.filter((seam) =>
      seam.observationSource === "focused_side_ceiling_wall"
    ).length,
    0,
  );
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.observerStatus,
    "empty",
  );
});

test("partial and image-edge focused seams survive unchanged", async () => {
  const result = await observeFocusedSideCeilingWallSeams({
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    originalAncestorIdentity: originalBasis,
    retainedEmpty: { bytes: EMPTY_BYTES, identity: emptyBasis },
  }, {
    callProvider: async () => ({
      observedSeams: [
        {
          id: "partial_left",
          category: "wall_ceiling",
          sourceNormalizedPolyline: [...PARTIAL_LEFT_SIDE],
          confidence: 0.62,
          visibility: "observed",
          ambiguity: "Only the mid-run is visible.",
        },
        {
          id: "edge_right",
          category: "wall_ceiling",
          sourceNormalizedPolyline: [
            { x: 1, y: 0.3 },
            { x: 0.84, y: 0.12 },
          ],
          confidence: 0.71,
          visibility: "observed",
        },
      ],
      unresolved: [],
    }),
  });
  assert.deepEqual(
    result.observedSeams.find((seam) => seam.id === "partial_left")
      ?.sourceNormalizedPolyline,
    [...PARTIAL_LEFT_SIDE],
  );
  assert.equal(
    result.observedSeams.find((seam) => seam.id === "edge_right")
      ?.sourceNormalizedPolyline[0]?.x,
    1,
  );
  assert.equal(result.qualityGate.hiddenContinuationAdded, false);
});

test("focused pass rejects non-wall-ceiling and degenerate seams", () => {
  const result = buildFocusedSideCeilingWallEvidence({
    observedSeams: [
      {
        id: "wall_wall_disguise",
        category: "wall_wall",
        sourceNormalizedPolyline: [...LEFT_SIDE],
        confidence: 0.9,
        visibility: "observed",
      },
      {
        id: "degenerate",
        category: "wall_ceiling",
        sourceNormalizedPolyline: [
          { x: 0.2, y: 0.2 },
          { x: 0.2, y: 0.2 },
        ],
        confidence: 0.9,
        visibility: "observed",
      },
    ],
    unresolved: [],
  }, focusedContext);
  assert.equal(result.observedSeams.length, 0);
  assert.equal(result.qualityGate.parserRejections.length, 2);
  assert.equal(result.qualityGate.geometryManufactured, false);
});

test("merge adds a focused side seam when general has none", () => {
  const merged = mergeFocusedSideCeilingWallSeams({
    general: generalEvidence(),
    focused: focusedEvidence(),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  const added = merged.observedSeams.filter((seam) =>
    seam.observationSource === "focused_side_ceiling_wall"
  );
  assert.equal(added.length, 1);
  assert.deepEqual(added[0]?.sourceNormalizedPolyline, [...LEFT_SIDE]);
  assert.equal(added[0]?.category, "wall_ceiling");
  assert.deepEqual(added[0]?.planeIds, []);
  assert.equal(
    merged.observedSeams.find((seam) => seam.id === "wall_ceiling_back")
      ?.observationSource,
    "general_empty_observer",
  );
  assert.deepEqual(
    merged.qualityGate.focusedSideCeilingWall.addedSeamIds,
    [added[0]?.id],
  );
  assert.equal(merged.qualityGate.focusedSideCeilingWall.geometryManufactured, false);
  assert.equal(merged.authority, "observation_only");
});

test("merge keeps a good general side seam and skips a focused duplicate", () => {
  const general = generalEvidence(generalObservation({ includeLeftSide: true }));
  const before = general.observedSeams.find((seam) =>
    seam.id === "wall_ceiling_left"
  )?.sourceNormalizedPolyline;
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: focusedEvidence(),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.deepEqual(
    merged.observedSeams.find((seam) => seam.id === "wall_ceiling_left")
      ?.sourceNormalizedPolyline,
    before,
  );
  assert.equal(
    merged.observedSeams.filter((seam) =>
      seam.observationSource === "focused_side_ceiling_wall"
    ).length,
    0,
  );
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.skippedDuplicateSeamIds.length,
    1,
  );
});

test("merge leaves general unchanged when focused is empty", () => {
  const general = generalEvidence(generalObservation({ includeLeftSide: true }));
  const merged = mergeFocusedSideCeilingWallSeams({
    general,
    focused: buildFocusedSideCeilingWallEvidence({
      observedSeams: [],
      unresolved: [],
    }, focusedContext),
  });
  assert.deepEqual(
    merged && merged.observerStatus !== "failed"
      ? merged.observedSeams.map((seam) => seam.id)
      : [],
    general.observedSeams.map((seam) => seam.id),
  );
});

test("merge drops a nearly-vertical focused stand-in for wall-wall", () => {
  const merged = mergeFocusedSideCeilingWallSeams({
    general: generalEvidence(generalObservation({ includeWallWall: true })),
    focused: focusedEvidence([
      { x: 0.18, y: 0.14 },
      { x: 0.185, y: 0.58 },
    ]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(
    merged.observedSeams.filter((seam) =>
      seam.observationSource === "focused_side_ceiling_wall"
    ).length,
    0,
  );
  assert.equal(
    merged.qualityGate.focusedSideCeilingWall.rejectedSeamIds.length,
    1,
  );
});

test("focused failure keeps general evidence and does not affect Floor", async () => {
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(),
    observeRoom: async () => generalEvidence(),
    observeFocusedSideCeilingWall: async () => {
      throw new Error("controlled focused failure");
    },
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.roomObservationStatus, "observed");
  assert.equal(
    result.roomObservation?.observedSeams.some((seam) =>
      seam.id === "wall_ceiling_back"
    ),
    true,
  );
  assert.equal(result.focusedSideCeilingObservationStatus, "failed");
  assert.deepEqual(result.floor.sourceNormalizedPolygon, authoritativeFloorQuad);
  assert.equal(result.camera.originalBasisRestored, true);
  assert.equal(
    result.roomObservation?.authoritySeparation.floorAuthorityConsumed,
    false,
  );
});

test("general failure is not replaced by a fabricated observation from focused seams", async () => {
  const merged = mergeFocusedSideCeilingWallSeams({
    general: failedGeneral(),
    focused: focusedEvidence(),
  });
  assert.equal(merged?.observerStatus, "failed");
  assert.equal(merged?.observedSeams.length, 0);
  assert.equal(merged?.failure?.failureClass, "transport");

  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(),
    observeRoom: async () => failedGeneral(),
    observeFocusedSideCeilingWall: async () => focusedEvidence(),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(result.roomObservationStatus, "failed");
  assert.equal(result.focusedSideCeilingObservation?.observedSeams.length, 1);
  assert.deepEqual(result.floor.sourceNormalizedPolygon, authoritativeFloorQuad);
  assert.equal(result.camera.originalBasisRestored, true);
});

test("general and focused failure remain failed without fabricated observation", () => {
  const merged = mergeFocusedSideCeilingWallSeams({
    general: failedGeneral(),
    focused: buildFailedFocusedSideCeilingWallEvidence(focusedContext, {
      failureClass: "timeout",
      failureStage: "provider_invocation",
      provider: "controlled_fixture",
      model: "fixture",
      providerStatus: null,
      safeDetail: "Controlled focused timeout.",
      contractValidationReason: null,
    }),
  });
  assert.equal(merged?.observerStatus, "failed");
  assert.equal(merged?.observedSeams.length, 0);
});
