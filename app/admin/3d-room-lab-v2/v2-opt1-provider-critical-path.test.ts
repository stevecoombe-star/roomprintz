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
  type EmptyRoomObservationEvidence,
} from "./empty-room-observation-contract";
import { emptyFocusedSideCeilingWallSibling } from "./empty-side-ceiling-wall-observation.server";
import { emptyFocusedSideFloorWallSibling } from "./empty-side-floor-wall-observation.server";
import { deriveAutoMetricScale } from "./metric-auto-scale";
import {
  buildUnavailableMetricRoomPriorReceipt,
  type MetricRoomPriorReceipt,
} from "./metric-room-prior-contract";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

function readV2(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

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
  attemptId: "v2-opt1-critical-path",
  sourceImageUrl: "https://example.test/original.jpg",
  sourceImageIdentity: {
    sha256: originalBasis.sha256,
    decodedWidth: originalBasis.decodedWidth,
    decodedHeight: originalBasis.decodedHeight,
    orientation: 1,
  },
  loadGeneration: 91,
  frame: { width: 900, height: 600 },
  referenceDepthM: 4,
};
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for scheduling predicate");
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function productDependencies(
  order: string[] = [],
): AfcSr1TiledLiveProductDependencies {
  return {
    createResultId: () => "v2-opt1-result",
    qualifyOriginal: async () => {
      order.push("original");
      return { sourceImageUrl: input.sourceImageUrl, basis: originalBasis };
    },
    resolveEmpty: async () => {
      order.push("empty");
      return { basis: emptyBasis, bytes: EMPTY_BYTES, generated: true };
    },
    generateTiled: async () => {
      order.push("tiled");
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
          runId: "v2-opt1-generation",
          generatedAt: "2026-09-03T21:00:00.000Z",
          appliedAspectRatio: "3:2",
          imageTransport: "data_url",
          generationStatus: "generated",
        },
        compatibility: { tier: "exact_grid_compatible" },
      } as never;
    },
    validateTiledLineage: async () => ({
      tiledIdentity: tiledBasis,
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async () => {
      order.push("reader");
      return {
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
      };
    },
  };
}

function observationEvidence(): EmptyRoomObservationEvidence {
  return buildEmptyRoomObservationEvidence({
    observedPlanes: [
      {
        id: "visible_floor",
        category: "floor",
        sourceNormalizedPolygon: [
          { x: 0, y: 1 },
          { x: 1, y: 1 },
          { x: 0.8, y: 0.62 },
          { x: 0.2, y: 0.62 },
        ],
        confidence: 0.94,
        visibility: "observed",
      },
      {
        id: "visible_wall",
        category: "wall",
        sourceNormalizedPolygon: [
          { x: 0.1, y: 0.1 },
          { x: 0.9, y: 0.1 },
          { x: 0.8, y: 0.62 },
          { x: 0.2, y: 0.62 },
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
        { x: 0.2, y: 0.62 },
        { x: 0.5, y: 0.62 },
        { x: 0.8, y: 0.62 },
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
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-03T21:00:00.000Z",
  });
}

function pendingPriorReceipt(): MetricRoomPriorReceipt {
  return buildUnavailableMetricRoomPriorReceipt({
    sourceImageHash: originalBasis.sha256,
    originalAncestorSha256: originalBasis.sha256,
    attemptId: input.attemptId,
    loadGeneration: input.loadGeneration,
    provider: "controlled_fixture",
    model: "fixture",
  }, {
    failureClass: "configuration",
    failureStage: "configuration",
    provider: "controlled_fixture",
    model: "fixture",
    providerStatus: null,
    safeDetail: "OPT-1 pending Room Size Prior fixture.",
    contractValidationReason: "opt1_pending_metric_prior",
  });
}

function instrumentObservation(
  evidence: EmptyRoomObservationEvidence,
  onConsumed: () => void,
): EmptyRoomObservationEvidence {
  return new Proxy(evidence, {
    get(target, property, receiver) {
      onConsumed();
      return Reflect.get(target, property, receiver);
    },
  }) as EmptyRoomObservationEvidence;
}

test("normal Analyze does not invoke UX-3b1 and Auto still uses UX-3b0 + prior only", async () => {
  const result = await executeAfcV2Analysis(input, {
    product: productDependencies(),
    observeRoom: async () => observationEvidence(),
  });
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  const selected = result.metricCorrespondence?.selected ?? null;
  assert.ok(selected);
  assert.equal(result.metricCorrespondenceEstimate, null);
  const withoutEstimate = deriveAutoMetricScale({
    roomPrior: result.metricRoomPrior,
    selected,
    s4aSafety: selected.lineage.s4aCandidateId
      ? {
          observedSpanOnly: result.roomBoundaries?.candidates.find(
            (candidate) => candidate.id === selected.lineage.s4aCandidateId,
          )?.limitations.observedSpanOnly ?? true,
          hiddenContinuation: result.roomBoundaries?.candidates.find(
            (candidate) => candidate.id === selected.lineage.s4aCandidateId,
          )?.limitations.hiddenContinuation ?? false,
          geometryManufactured: result.roomBoundaries?.candidates.find(
            (candidate) => candidate.id === selected.lineage.s4aCandidateId,
          )?.limitations.geometryManufactured ?? false,
        }
      : null,
    trustSelectedBackSpanAsFullWidth: false,
  });
  assert.equal(withoutEstimate.autoMetricScale, 1);
  const analysisSource = readV2("afc-v2-analysis.server.ts");
  assert.doesNotMatch(analysisSource, /startMetricCorrespondenceEstimate/);
  assert.doesNotMatch(analysisSource, /estimateMetricCorrespondenceSpan/);
});

test("Floor/Camera can progress while EMPTY observers remain pending; S4 waits", async () => {
  const deferred = createDeferred<EmptyRoomObservationEvidence>();
  let observationConsumed = false;
  let floorCameraApplied = false;
  let analysisSettled = false;
  let appliedFloorKey: string | null = null;
  const analysisPromise = executeAfcV2Analysis(input, {
    product: productDependencies(),
    observeRoom: async () => deferred.promise,
    onTiledFloorCameraApplied: (applied) => {
      floorCameraApplied = true;
      appliedFloorKey = applied.floor.authorityKey;
      assert.equal(applied.camera.applied, true);
      assert.equal(applied.camera.originalBasisRestored, true);
      assert.equal(observationConsumed, false);
    },
  }).then((result) => {
    analysisSettled = true;
    return result;
  });

  await waitUntil(() => floorCameraApplied);
  assert.equal(analysisSettled, false);
  assert.equal(observationConsumed, false);
  assert.ok(appliedFloorKey);

  deferred.resolve(instrumentObservation(observationEvidence(), () => {
    observationConsumed = true;
  }));
  const result = await analysisPromise;
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.equal(observationConsumed, true);
  assert.ok(result.roomBoundaries);
  assert.ok(result.roomCollision);
  assert.equal(result.floor.authorityKey, appliedFloorKey);
  assert.equal(result.camera.applied, true);
});

test("Room Size Prior does not gate Floor/Camera or S4", async () => {
  const priorDeferred = createDeferred<MetricRoomPriorReceipt>();
  let floorCameraApplied = false;
  let observationConsumed = false;
  let analysisSettled = false;
  const priorReceipt = pendingPriorReceipt();
  const analysisPromise = executeAfcV2Analysis(input, {
    product: productDependencies(),
    observeRoom: async () => instrumentObservation(observationEvidence(), () => {
      observationConsumed = true;
    }),
    estimateMetricRoom: async () => priorDeferred.promise,
    onTiledFloorCameraApplied: (applied) => {
      floorCameraApplied = true;
      assert.equal(applied.camera.applied, true);
    },
  }).then((result) => {
    analysisSettled = true;
    return result;
  });

  await waitUntil(() => floorCameraApplied && observationConsumed);
  assert.equal(analysisSettled, false);

  priorDeferred.resolve(priorReceipt);
  const result = await analysisPromise;
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.ok(result.roomBoundaries);
  assert.ok(result.roomCollision);
  assert.equal(result.camera.applied, true);
  assert.equal(result.metricRoomPrior, priorReceipt);
  assert.equal(result.metricCorrespondenceEstimate, null);
});

test("three EMPTY observers launch concurrently and TILED starts without waiting", async () => {
  const launched: string[] = [];
  const generalGate = createDeferred<void>();
  const ceilingGate = createDeferred<void>();
  const floorWallGate = createDeferred<void>();
  const order: string[] = [];
  const product = productDependencies(order);
  const generateTiled = product.generateTiled!;
  const resultPromise = executeAfcV2Analysis(input, {
    product: {
      ...product,
      qualifyOriginal: async (request) => {
        assert.ok(
          launched.includes("prior"),
          "Room Size Prior must start before the EMPTY product chain",
        );
        return product.qualifyOriginal!(request);
      },
      generateTiled: async (args) => {
        assert.deepEqual(
          launched.filter((name) =>
            name === "general" || name === "ceiling" || name === "floor_wall"
          ).sort(),
          ["ceiling", "floor_wall", "general"],
        );
        launched.push("tiled");
        return generateTiled(args);
      },
    },
    estimateMetricRoom: async () => {
      launched.push("prior");
      return pendingPriorReceipt();
    },
    observeRoom: async () => {
      launched.push("general");
      await generalGate.promise;
      return observationEvidence();
    },
    observeFocusedSideCeilingWall: async (observationInput) => {
      launched.push("ceiling");
      await ceilingGate.promise;
      return emptyFocusedSideCeilingWallSibling(observationInput);
    },
    observeFocusedSideFloorWall: async (observationInput) => {
      launched.push("floor_wall");
      await floorWallGate.promise;
      return emptyFocusedSideFloorWallSibling(observationInput);
    },
  });

  await waitUntil(() => launched.includes("tiled"));
  assert.ok(launched.indexOf("prior") < launched.indexOf("tiled"));
  generalGate.resolve();
  ceilingGate.resolve();
  floorWallGate.resolve();
  const result = await resultPromise;
  assert.equal(result.status, "applied");
  if (result.status !== "applied") return;
  assert.deepEqual(order, ["original", "empty", "tiled", "reader"]);
  assert.equal(result.executionCounts.roomObserver, 1);
  assert.equal(result.executionCounts.focusedSideCeilingObserver, 1);
  assert.equal(result.executionCounts.focusedSideFloorWallObserver, 1);
  assert.equal(result.executionCounts.floorOnlyTiledGeneration, 1);
  assert.equal(result.executionCounts.tiledFloorReader, 1);
});

test("OPT-1 await boundaries keep Floor/Camera ahead of observation and prior joins", () => {
  const analysisSource = readV2("afc-v2-analysis.server.ts");
  const freezeIndex = analysisSource.indexOf("await freezeAppliedTiledAfcCamera");
  const observerJoinIndex = analysisSource.lastIndexOf("await joinObservation()");
  const s4Index = analysisSource.indexOf(
    "const roomBoundaries = constructAfcV2RoomBoundaryAuthority",
  );
  const priorJoinIndex = analysisSource.lastIndexOf("await metricPriorPromise");
  const ux3b0Index = analysisSource.indexOf(
    "metricCorrespondence = selectMetricCorrespondenceSpan",
  );
  assert.ok(freezeIndex > 0);
  assert.ok(observerJoinIndex > freezeIndex);
  assert.ok(s4Index > observerJoinIndex);
  assert.ok(ux3b0Index > s4Index);
  assert.ok(priorJoinIndex > ux3b0Index);
  assert.doesNotMatch(
    analysisSource,
    /Promise\.all\(\[[\s\S]{0,180}observationBranch\.general[\s\S]{0,180}metricPriorPromise/,
  );
  assert.doesNotMatch(analysisSource, /startMetricCorrespondenceEstimate/);
  assert.doesNotMatch(analysisSource, /estimateMetricCorrespondenceSpan/);
  assert.match(analysisSource, /metricCorrespondenceEstimate: null/);
  assert.match(analysisSource, /startMetricRoomPrior/);
  assert.match(analysisSource, /onTiledFloorCameraApplied/);
});
