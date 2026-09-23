import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { AfcSr1TiledLiveProductDependencies } from "@/app/admin/3d-room-lab/afc-sr1-tiled-live-product";
import {
  AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
} from "@/app/admin/3d-room-lab/research/afc-sr1-tile-grid-scaffold";
import type { AfcV2AnalysisDependencies } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import { buildEmptyRoomObservationEvidence } from "@/app/admin/3d-room-lab-v2/empty-room-observation-contract";
import { buildUnavailableMetricRoomPriorReceipt } from "@/app/admin/3d-room-lab-v2/metric-room-prior-contract";
import { AUTO_METRIC_SCALE } from "@/app/admin/3d-room-lab-v2/scene-metric-world-realization";
import { AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS } from "@/lib/afc-v2-diagnostics/admin-read-model.server";

import {
  isAfcV2MetricDecisionCaptureFailedV1,
  isAfcV2MetricDecisionDiagnosticV1,
  parseAfcV2MetricDecision,
} from "./metric-decision-diagnostic";
import {
  AfcGenerationImmutabilityError,
  createMemoryAfcProductionStore,
  type AfcProductionStore,
  type UpdateAfcGenerationInput,
} from "./production-store";
import { runProductionAfcAnalysis } from "./production-adapter.server";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const ORIGINAL_BYTES = Uint8Array.from([9, 8, 7, 6]);
const EMPTY_BYTES = Uint8Array.from([4, 5, 6]);
const TILED_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const originalBasis = {
  sha256: sha(ORIGINAL_BYTES),
  byteCount: ORIGINAL_BYTES.byteLength,
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
  sha256: sha(TILED_PNG),
  byteCount: TILED_PNG.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};

function analysisDependencies(failReader = false): AfcV2AnalysisDependencies {
  const product: AfcSr1TiledLiveProductDependencies = {
    createResultId: () => "afr-1c-result",
    resolveEmpty: async () => ({ basis: emptyBasis, bytes: EMPTY_BYTES, generated: true }),
    generateTiled: async () => ({
      status: "generated" as const,
      input: emptyBasis,
      tiled: {
        base64: Buffer.from(TILED_PNG).toString("base64"),
        identity: tiledBasis,
      },
      provenance: {
        generatorId: AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
        profileId: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
        researchPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
        requestedModelId: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
        runId: "tiled-afr-1c",
        generatedAt: "2026-09-23T00:00:00.000Z",
        appliedAspectRatio: "3:2",
        imageTransport: "data_url" as const,
        generationStatus: "generated" as const,
      },
      compatibility: { tier: "exact_grid_compatible" as const },
    }) as never,
    validateTiledLineage: async () => ({
      tiledIdentity: tiledBasis,
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async () => {
      if (failReader) {
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
        authoritativeQuadSourceNormalized: [
          { x: 0.1, y: 0.9 },
          { x: 0.9, y: 0.9 },
          { x: 0.65, y: 0.55 },
          { x: 0.35, y: 0.55 },
        ],
        authoritativeQuadPixel: [
          { x: 120, y: 720 },
          { x: 1080, y: 720 },
          { x: 780, y: 440 },
          { x: 420, y: 440 },
        ],
        authoritativeCore: {
          rows: 2, columns: 2, j0: 0, i0: 0, cellIds: [1, 2, 3, 4],
        },
        selectedComponentTileCount: 4,
        rawQuadrilateralCount: 4,
        deduplicatedCellCount: 4,
        reprojectionMeanPx: 0.5,
        reprojectionMaxPx: 1,
      };
    },
  };
  return {
    product,
    observeRoom: async () => buildEmptyRoomObservationEvidence({
      observedPlanes: [],
      observedSeams: [],
      observedOpenings: [],
      observedJunctions: [],
      unresolved: [],
    }, {
      attemptId: "afr-1c",
      loadGeneration: 0,
      emptyIdentity: emptyBasis,
      originalAncestorSha256: originalBasis.sha256,
      provider: "controlled_fixture",
      model: "fixture",
      observerProfile: "empty-visible-architecture-conservative/v1",
      promptVersion: "afc-v2-empty-visible-room-observer/v5",
      generatedAt: "2026-09-23T00:00:00.000Z",
    }),
    estimateMetricRoom: async () => buildUnavailableMetricRoomPriorReceipt({
      sourceImageHash: originalBasis.sha256,
      originalAncestorSha256: originalBasis.sha256,
      attemptId: "afr-1c",
      loadGeneration: 0,
      provider: "controlled_fixture",
      model: "fixture",
    }, {
      failureClass: "configuration",
      failureStage: "configuration",
      provider: "controlled_fixture",
      model: "fixture",
      providerStatus: null,
      safeDetail: "PI-2 fixture metric prior unavailable.",
      contractValidationReason: "pi2_fixture",
    }),
  };
}

async function seededStore(): Promise<AfcProductionStore> {
  const store = createMemoryAfcProductionStore();
  await store.createRoom?.({
    id: ROOM_ID,
    userId: USER_ID,
    currentAfcGenerationId: null,
    baseStorageBucket: "vibode-base-images",
    baseStoragePath: `users/${USER_ID}/scene_x/base.jpg`,
    baseAsset: null,
  });
  return store;
}

function recordingStore(inner: AfcProductionStore) {
  const patches: UpdateAfcGenerationInput[] = [];
  const store: AfcProductionStore = {
    ...inner,
    updateGeneration: async (generationId, patch) => {
      patches.push(patch);
      return inner.updateGeneration(generationId, patch);
    },
  };
  return { store, patches };
}

test("running generation starts with metric_decision null and the terminal write records V1", async () => {
  const inner = await seededStore();
  const { store, patches } = recordingStore(inner);
  let runningId = "";
  const result = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
    original: {
      bytes: ORIGINAL_BYTES,
      identity: originalBasis,
      sourceImageUrl: "https://example.test/original.jpg",
    },
    analysisDependencies: analysisDependencies(),
    onGenerationCreated: async (created) => {
      runningId = created.generationId;
      const running = await inner.getGeneration(created.generationId);
      assert.equal(running?.status, "running");
      assert.equal(running?.metricDecision, null);
    },
  });
  assert.equal(result.status, "ready");
  assert.equal("metricDecision" in result, false);
  assert.equal("metric_decision" in result, false);
  assert.equal(JSON.stringify(result).includes("metricDecision"), false);
  assert.equal(JSON.stringify(result).includes("metric_decision"), false);
  const generation = await inner.getGeneration(result.generationId!);
  assert.equal(generation?.status, "ready");
  assert.equal(isAfcV2MetricDecisionDiagnosticV1(generation?.metricDecision), true);
  if (!generation?.metricDecision || !("finalDecision" in generation.metricDecision)) {
    throw new Error("ready generation missing recorded metric decision");
  }
  const decision = generation.metricDecision;
  assert.equal(decision.finalDecision.selectedPath, generation.metricStatus);
  assert.equal(decision.finalDecision.selectedPath, result.authority?.metric.path);
  assert.equal(decision.finalDecision.accepted, result.authority?.metric.accepted);
  assert.equal(decision.finalDecision.authority, result.authority?.metric.authority);
  assert.equal(decision.finalDecision.metricScale, result.authority?.metric.metricScale);
  assert.equal(decision.finalDecision.autoMetricScale, result.authority?.metric.autoMetricScale);
  assert.equal(decision.finalDecision.fallbackApplied, result.authority?.metric.fallbackApplied);
  assert.equal(decision.finalDecision.safeFailureState, result.authority?.recovery.safeFailureState);
  assert.equal(result.authority?.metric.fallbackApplied, true);
  assert.equal(result.authority?.metric.metricScale, AUTO_METRIC_SCALE);
  assert.equal(decision.fallback.used, true);
  assert.equal(decision.fallback.numericFallback, AUTO_METRIC_SCALE);
  assert.equal(decision.finalDecision.terminalStatus, "ready");
  const parsed = parseAfcV2MetricDecision(JSON.parse(JSON.stringify(decision)));
  assert.equal(parsed.ok, true);
  const runningPatches = patches.filter((patch) =>
    patch.status !== "ready" && patch.status !== "failed"
  );
  assert.ok(runningPatches.length >= 1);
  for (const patch of runningPatches) {
    assert.equal(patch.metricDecision, undefined);
  }
  const terminal = patches.filter((patch) => patch.status === "ready");
  assert.equal(terminal.length, 1);
  assert.ok(terminal[0]?.metricDecision);
  assert.equal(runningId, result.generationId);
});

test("failed terminal write records a valid failed V1 and does not grant fallback authority", async () => {
  const store = await seededStore();
  const result = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
    original: {
      bytes: ORIGINAL_BYTES,
      identity: originalBasis,
      sourceImageUrl: "https://example.test/original.jpg",
    },
    analysisDependencies: analysisDependencies(true),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.authority, null);
  const generation = await store.getGeneration(result.generationId!);
  assert.equal(generation?.status, "failed");
  assert.equal(generation?.productionAuthority, null);
  assert.equal(generation?.metricStatus, "none");
  assert.equal(isAfcV2MetricDecisionDiagnosticV1(generation?.metricDecision), true);
  if (!generation?.metricDecision || !("finalDecision" in generation.metricDecision)) {
    throw new Error("failed generation missing metric decision");
  }
  assert.equal(generation.metricDecision.finalDecision.terminalStatus, "failed");
  assert.equal(generation.metricDecision.finalDecision.authorityBuilt, false);
  assert.equal(generation.metricDecision.finalDecision.selectedPath, "none");
  assert.equal(generation.metricDecision.finalDecision.fallbackApplied, false);
  assert.equal(generation.metricDecision.fallback.used, false);
  assert.equal(generation.metricDecision.fallback.numericFallback, null);
  assert.equal(generation.metricDecision.pathA.roomPrior.attempted, true);
  assert.equal(generation.metricDecision.pathA.disposition, "not_reached");
  assert.equal(generation.metricDecision.pathB.launchDisposition, "not_reached");
  assert.equal(
    generation.metricDecision.pathA.roomPrior.failure?.safeDetail,
    "PI-2 fixture metric prior unavailable.",
  );
  assert.equal(
    generation.metricDecision.pathA.roomPrior.hostAcceptance?.reasonCodes.includes(
      "PI-2 fixture metric prior unavailable.",
    ),
    false,
  );
});

test("same terminal metric_decision retries and a distinct mutation is rejected", async () => {
  const store = await seededStore();
  const ready = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
    original: {
      bytes: ORIGINAL_BYTES,
      identity: originalBasis,
      sourceImageUrl: "https://example.test/original.jpg",
    },
    analysisDependencies: analysisDependencies(),
  });
  const generation = await store.getGeneration(ready.generationId!);
  assert.ok(generation?.metricDecision);
  const again = await store.updateGeneration(generation.id, {
    metricDecision: generation.metricDecision,
  });
  assert.deepEqual(again.metricDecision, generation.metricDecision);
  await assert.rejects(
    () => store.updateGeneration(generation.id, {
      metricDecision: {
        schemaVersion: "afc-v2-metric-decision-diagnostic/v1",
        captureStatus: "capture_failed",
        generationId: generation.id,
      },
    }),
    AfcGenerationImmutabilityError,
  );
  const preserved = await store.getGeneration(generation.id);
  assert.equal(isAfcV2MetricDecisionCaptureFailedV1(preserved?.metricDecision), false);
  assert.deepEqual(preserved?.metricDecision, generation.metricDecision);
});

test("admin generation columns and inspector sources still exclude metric_decision", () => {
  assert.equal(AFC_DIAGNOSTIC_ADMIN_GENERATION_COLUMNS.includes("metric_decision"), false);
  const files = [
    "lib/afc-v2-diagnostics/admin-read-model.server.ts",
    "lib/afc-v2-diagnostics/admin-read-model.ts",
    "lib/afc-v2-diagnostics/admin-case-inspector.client.ts",
    "app/admin/afc-diagnostics/cases/[caseId]/AfcDiagnosticCaseInspector.tsx",
    "app/api/vibode/afc/analyze/route.ts",
  ];
  for (const relativePath of files) {
    const source = readFileSync(relativePath, "utf8");
    assert.equal(/metric_decision|metricDecision|AfcV2MetricDecision/.test(source), false, relativePath);
  }
});
