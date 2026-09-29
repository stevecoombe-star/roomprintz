import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { AfcSr1TiledLiveProductDependencies } from "@/app/admin/3d-room-lab/afc-sr1-tiled-live-product";
import type { AfcSr1TiledPerspectiveReaderResponse } from "@/lib/callCompositorAfcSr1TiledPerspectiveReader";
import { buildAfcSr1TiledArtifactCacheKey } from "@/app/admin/3d-room-lab/afc-sr1-tiled-artifact-cache";
import {
  AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
} from "@/app/admin/3d-room-lab/research/afc-sr1-tile-grid-scaffold";
import type { AfcV2AnalysisDependencies } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import { buildEmptyRoomObservationEvidence } from "@/app/admin/3d-room-lab-v2/empty-room-observation-contract";
import { buildUnavailableMetricRoomPriorReceipt } from "@/app/admin/3d-room-lab-v2/metric-room-prior-contract";

import {
  AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION,
  afcV2ReaderEvidenceFromProduct,
  buildAfcV2ArtifactLineageDiagnostic,
  isAfcV2ArtifactLineageRecorded,
  parseAfcV2ArtifactLineage,
  unknownAfcV2ArtifactLineageEmpty,
  unknownAfcV2ArtifactLineageReader,
  unknownAfcV2ArtifactLineageTiled,
  type AfcV2ArtifactLineageRecordedV1,
} from "./artifact-lineage-diagnostic";
import { runProductionAfcAnalysis } from "./production-adapter.server";
import { createSupabaseAfcProductionStore } from "./production-persistence.server";
import {
  AfcGenerationImmutabilityError,
  createMemoryAfcProductionStore,
  type AfcProductionStore,
} from "./production-store";
import { isAfcV2SettleDecisionRecordedV1 } from "./settle-decision-diagnostic";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const PUBLISHER_ID = "33333333-3333-4333-8333-333333333333";
const ORIGINAL_BYTES = Uint8Array.from([9, 8, 7, 6]);
const EMPTY_BYTES = Uint8Array.from([4, 5, 6]);
const TILED_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const SOURCE_IMAGE_URL = "https://example.test/original.jpg";
const READER_VERSION = "afc-sr1-tiled-perspective-reader/s1" as const;
const QUAD = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;
const BAD_QUAD = [
  { x: 0.19433574484340907, y: 0.9992958566241903 },
  { x: 0.30440890550742766, y: 0.9142958069427229 },
  { x: 0.1876279696638781, y: 0.7325327273739121 },
  { x: 0.09595426095204106, y: 0.751388285412524 },
] as const;

const originalBasis = basis(ORIGINAL_BYTES, 1200, 800, "image/jpeg");
const emptyBasis = basis(EMPTY_BYTES, 1200, 800, "image/png");
const tiledBasis = basis(TILED_PNG, 1200, 800, "image/png");

type Basis = ReturnType<typeof basis>;

function basis(
  bytes: Uint8Array,
  width: number,
  height: number,
  mimeType: "image/jpeg" | "image/png",
) {
  return {
    sha256: sha(bytes),
    byteCount: bytes.byteLength,
    decodedWidth: width,
    decodedHeight: height,
    mimeType,
    orientation: 1 as const,
  };
}

function tiledResult(runId: string, identity: Basis = tiledBasis) {
  return {
    status: "generated" as const,
    input: emptyBasis,
    tiled: {
      base64: Buffer.from(TILED_PNG).toString("base64"),
      identity,
    },
    provenance: {
      generatorId: AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
      profileId: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
      researchPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
      requestedModelId: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
      runId,
      generatedAt: "2026-09-28T20:00:00.000Z",
      appliedAspectRatio: "3:2",
      imageTransport: "data_url" as const,
      generationStatus: "generated" as const,
    },
    compatibility: { tier: "exact_grid_compatible" as const },
  };
}

function observation(emptyIdentity: Basis, originalSha: string) {
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
    attemptId: "prod",
    loadGeneration: 0,
    emptyIdentity,
    originalAncestorSha256: originalSha,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-28T20:00:00.000Z",
  });
}

type ReaderMode =
  | "ok"
  | "failed"
  | "invalid_polygon"
  | "identity_mismatch"
  | "throw";

function analysisDependencies(input: Readonly<{
  counts: { empty: number; tiled: number; reader: number; stage1: number };
  emptyGenerated?: boolean;
  emptyIdentity?: Basis;
  tiledIdentity?: Basis;
  originalSha?: string;
  readerMode?: ReaderMode;
  quad?: readonly { x: number; y: number }[];
  core?: Readonly<{ rows: number; columns: number; j0: number; i0: number }>;
  rawQuadCount?: number;
  deduplicatedCellCount?: number;
  selectedComponentTileCount?: number;
  reprojectionMeanPx?: number;
  reprojectionMaxPx?: number;
  tiledImpl?: AfcSr1TiledLiveProductDependencies["generateTiled"];
}>): AfcV2AnalysisDependencies {
  const emptyIdentity = input.emptyIdentity ?? emptyBasis;
  const tiledIdentity = input.tiledIdentity ?? tiledBasis;
  const quad = input.quad ?? QUAD;
  const product: AfcSr1TiledLiveProductDependencies = {
    createResultId: () => "prod-result",
    resolveEmpty: async () => {
      input.counts.empty += 1;
      if (input.emptyGenerated !== false) input.counts.stage1 += 1;
      return {
        basis: emptyIdentity,
        bytes: EMPTY_BYTES,
        generated: input.emptyGenerated !== false,
      };
    },
    generateTiled: input.tiledImpl ?? (async () => {
      input.counts.tiled += 1;
      return tiledResult(`tiled-${input.counts.tiled}`, tiledIdentity) as never;
    }),
    validateTiledLineage: async () => ({
      tiledIdentity,
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async () => {
      input.counts.reader += 1;
      if (input.readerMode === "throw") {
        throw new Error("reader transport down");
      }
      const decodedIdentity = input.readerMode === "identity_mismatch"
        ? { ...tiledIdentity, sha256: "a".repeat(64) }
        : tiledIdentity;
      if (input.readerMode === "failed") {
        return {
          status: "failed",
          reason: "no_complete_tile",
          decodedIdentity,
          readerVersion: READER_VERSION,
        } satisfies AfcSr1TiledPerspectiveReaderResponse;
      }
      const polygon = [quad[0], quad[1], quad[2], quad[3]] as const;
      return {
        status: "ok",
        decodedIdentity,
        readerVersion: READER_VERSION,
        authoritativeQuadSourceNormalized: polygon,
        authoritativeQuadPixel: polygon,
        authoritativeCore: {
          ...(input.core ?? { rows: 2, columns: 2, j0: 0, i0: 0 }),
          cellIds: [1, 2, 3, 4],
        },
        selectedComponentTileCount: input.selectedComponentTileCount ?? 4,
        rawQuadrilateralCount: input.rawQuadCount ?? 4,
        deduplicatedCellCount: input.deduplicatedCellCount ?? 4,
        reprojectionMeanPx: input.reprojectionMeanPx ?? 0.5,
        reprojectionMaxPx: input.reprojectionMaxPx ?? 1,
      } satisfies AfcSr1TiledPerspectiveReaderResponse;
    },
  };
  return {
    product,
    observeRoom: async () => observation(emptyIdentity, input.originalSha ?? originalBasis.sha256),
    estimateMetricRoom: async () => buildUnavailableMetricRoomPriorReceipt({
      sourceImageHash: input.originalSha ?? originalBasis.sha256,
      originalAncestorSha256: input.originalSha ?? originalBasis.sha256,
      attemptId: "prod",
      loadGeneration: 0,
      provider: "controlled_fixture",
      model: "fixture",
    }, {
      failureClass: "configuration",
      failureStage: "configuration",
      provider: "controlled_fixture",
      model: "fixture",
      providerStatus: null,
      safeDetail: "AFR-3D fixture metric prior unavailable.",
      contractValidationReason: "afr3d_fixture",
    }),
  };
}

async function seededStore() {
  const store = createMemoryAfcProductionStore();
  await store.createRoom?.({
    id: ROOM_ID,
    userId: USER_ID,
    currentAfcGenerationId: null,
    baseStorageBucket: null,
    baseStoragePath: null,
    baseAsset: null,
  });
  return store;
}

async function analyze(input: Readonly<{
  store: AfcProductionStore;
  counts: { empty: number; tiled: number; reader: number; stage1: number };
  intent?: "analyze" | "run_again" | "reread_perspective";
  original?: Basis;
  bytes?: Uint8Array;
  emptyGenerated?: boolean;
  emptyIdentity?: Basis;
  tiledIdentity?: Basis;
  readerMode?: ReaderMode;
  quad?: readonly { x: number; y: number }[];
  core?: Readonly<{ rows: number; columns: number; j0: number; i0: number }>;
  rawQuadCount?: number;
  deduplicatedCellCount?: number;
  selectedComponentTileCount?: number;
  reprojectionMeanPx?: number;
  reprojectionMaxPx?: number;
  tiledImpl?: AfcSr1TiledLiveProductDependencies["generateTiled"];
}>) {
  const original = input.original ?? originalBasis;
  return runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    intent: input.intent,
    store: input.store,
    original: {
      bytes: input.bytes ?? ORIGINAL_BYTES,
      identity: original,
      sourceImageUrl: SOURCE_IMAGE_URL,
    },
    analysisDependencies: analysisDependencies({
      counts: input.counts,
      emptyGenerated: input.emptyGenerated,
      emptyIdentity: input.emptyIdentity,
      tiledIdentity: input.tiledIdentity,
      originalSha: original.sha256,
      readerMode: input.readerMode,
      quad: input.quad,
      core: input.core,
      rawQuadCount: input.rawQuadCount,
      deduplicatedCellCount: input.deduplicatedCellCount,
      selectedComponentTileCount: input.selectedComponentTileCount,
      reprojectionMeanPx: input.reprojectionMeanPx,
      reprojectionMaxPx: input.reprojectionMaxPx,
      tiledImpl: input.tiledImpl,
    }),
  });
}

function counts() {
  return { empty: 0, tiled: 0, reader: 0, stage1: 0 };
}

async function recordedOf(store: AfcProductionStore, generationId: string | null) {
  const generation = await store.getGeneration(generationId ?? "");
  assert.ok(generation);
  assert.equal(
    isAfcV2ArtifactLineageRecorded(generation.artifactLineage),
    true,
  );
  if (!isAfcV2ArtifactLineageRecorded(generation.artifactLineage)) {
    throw new Error("artifact lineage was not recorded");
  }
  return { generation, lineage: generation.artifactLineage };
}

function sample(overrides: Partial<{
  emptySource: "generated" | "process_cache" | "durable" | "unknown";
  tiledSource: "generated" | "durable" | "unknown";
  reused: string | null;
}> = {}): AfcV2ArtifactLineageRecordedV1 {
  return buildAfcV2ArtifactLineageDiagnostic({
    empty: {
      ...unknownAfcV2ArtifactLineageEmpty(),
      sha256: emptyBasis.sha256,
      byteCount: emptyBasis.byteCount,
      width: emptyBasis.decodedWidth,
      height: emptyBasis.decodedHeight,
      source: overrides.emptySource ?? "generated",
      reusedFromGenerationId: overrides.emptySource === "durable" ? overrides.reused ?? null : null,
    },
    tiled: {
      ...unknownAfcV2ArtifactLineageTiled(),
      sha256: tiledBasis.sha256,
      byteCount: tiledBasis.byteCount,
      width: tiledBasis.decodedWidth,
      height: tiledBasis.decodedHeight,
      source: overrides.tiledSource ?? "generated",
      reusedFromGenerationId: overrides.tiledSource === "durable"
        ? overrides.reused ?? PUBLISHER_ID
        : PUBLISHER_ID,
      generatorId: AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
      profileId: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
      researchPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
      requestedModelId: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
      provenanceRunId: "tiled-1",
    },
    reader: {
      ...unknownAfcV2ArtifactLineageReader(),
      readerVersion: READER_VERSION,
      status: "ok",
      rawQuadCount: 14,
      deduplicatedCellCount: 14,
      selectedComponentTileCount: 7,
      selectedCore: { rows: 4, columns: 1, j0: 0, i0: -1 },
      latticeReprojectionMeanPx: 11.42760589387132,
      latticeReprojectionMaxPx: 48.01957277261079,
      selectedPolygon: BAD_QUAD,
    },
  });
}

test("builder degrades non-finite residuals and keeps a negative core index", () => {
  const diagnostic = buildAfcV2ArtifactLineageDiagnostic({
    empty: unknownAfcV2ArtifactLineageEmpty(),
    tiled: {
      ...unknownAfcV2ArtifactLineageTiled(),
      source: "process_cache" as never,
      reusedFromGenerationId: PUBLISHER_ID,
    },
    reader: {
      ...unknownAfcV2ArtifactLineageReader(),
      status: "ok",
      selectedCore: { rows: 4, columns: 1, j0: 0, i0: -1 },
      latticeReprojectionMeanPx: Number.NaN,
      latticeReprojectionMaxPx: Number.POSITIVE_INFINITY,
      selectedPolygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: Number.NaN, y: 1 },
        { x: 0, y: 1 },
      ],
    },
  });
  assert.equal(diagnostic.tiled.source, "unknown");
  assert.equal(diagnostic.tiled.reusedFromGenerationId, null);
  assert.equal(diagnostic.reader.selectedCore?.i0, -1);
  assert.equal(diagnostic.reader.latticeReprojectionMeanPx, null);
  assert.equal(diagnostic.reader.latticeReprojectionMaxPx, null);
  assert.equal(diagnostic.reader.selectedPolygon, null);
  assert.equal(JSON.stringify(diagnostic).includes("NaN"), false);
  assert.equal(JSON.stringify(diagnostic).includes("Infinity"), false);
  const parsed = parseAfcV2ArtifactLineage(JSON.parse(JSON.stringify(diagnostic)));
  assert.equal(parsed.ok, true);
});

test("parser accepts the recorded contract and rejects malformed reader evidence", () => {
  const diagnostic = sample();
  assert.equal(diagnostic.schemaVersion, AFC_V2_ARTIFACT_LINEAGE_DIAGNOSTIC_SCHEMA_VERSION);
  assert.equal(diagnostic.empty.reusedFromGenerationId, null);
  assert.equal(diagnostic.reader.selectedCore?.rows, 4);
  assert.equal(diagnostic.reader.selectedCore?.columns, 1);
  assert.equal(diagnostic.reader.selectedCore?.i0, -1);
  assert.equal(diagnostic.reader.selectedPolygon?.length, 4);
  const roundTrip = parseAfcV2ArtifactLineage(JSON.parse(JSON.stringify(diagnostic)));
  assert.equal(roundTrip.ok, true);
  if (!roundTrip.ok || !isAfcV2ArtifactLineageRecorded(roundTrip.decision)) return;
  assert.deepEqual(roundTrip.decision.reader.selectedPolygon, diagnostic.reader.selectedPolygon);

  assert.deepEqual(parseAfcV2ArtifactLineage(null), { ok: true, decision: null });
  const unknown = parseAfcV2ArtifactLineage({
    schemaVersion: "afc-v2-artifact-lineage-diagnostic/v0",
    empty: diagnostic.empty,
  });
  assert.equal(unknown.ok, true);
  if (!unknown.ok || unknown.decision == null || !("kind" in unknown.decision)) return;
  assert.equal(unknown.decision.kind, "unsupported_schema");

  const nan = parseAfcV2ArtifactLineage({
    ...diagnostic,
    reader: { ...diagnostic.reader, latticeReprojectionMeanPx: Number.NaN },
  });
  assert.equal(nan.ok, false);
  const shortPolygon = parseAfcV2ArtifactLineage({
    ...diagnostic,
    reader: {
      ...diagnostic.reader,
      selectedPolygon: diagnostic.reader.selectedPolygon?.slice(0, 3),
    },
  });
  assert.equal(shortPolygon.ok, false);
  const extra = parseAfcV2ArtifactLineage({ ...diagnostic, storagePath: "users/private/tiled.png" });
  assert.equal(extra.ok, false);
});

test("reader evidence is copied from the product and not from a settle polygon", () => {
  const fromGeometry = afcV2ReaderEvidenceFromProduct({
    status: "authoritative_geometry",
    geometry: {
      sourceNormalizedPolygon: QUAD,
      tiledPerspective: {
        readerVersion: READER_VERSION,
        core: { rows: 2, columns: 2, j0: 0, i0: 0 },
        selectedComponentTileCount: 4,
        rawQuadrilateralCount: 4,
        deduplicatedCellCount: 4,
        reprojectionMeanPx: 0.5,
        reprojectionMaxPx: Number.NaN,
      },
    },
    settleDecision: { sourceNormalizedPolygon: BAD_QUAD },
  });
  assert.deepEqual(fromGeometry.selectedPolygon, QUAD);
  assert.equal(fromGeometry.latticeReprojectionMaxPx, null);
  assert.equal(fromGeometry.status, "ok");

  const fromFailure = afcV2ReaderEvidenceFromProduct({
    status: "failed",
    diagnostics: {
      tiledPerspectiveReader: {
        ...unknownAfcV2ArtifactLineageReader(),
        readerVersion: READER_VERSION,
        status: "failed",
      },
    },
  });
  assert.equal(fromFailure.status, "failed");
  assert.equal(fromFailure.rawQuadCount, null);
  assert.equal(fromFailure.selectedPolygon, null);
  assert.deepEqual(afcV2ReaderEvidenceFromProduct(null), unknownAfcV2ArtifactLineageReader());
});

test("terminal artifact lineage cannot change after ready or failed", async () => {
  const store = createMemoryAfcProductionStore();
  const running = await store.createGeneration({
    roomId: ROOM_ID,
    userId: USER_ID,
    parentGenerationId: null,
    runId: "run-lineage",
    intent: "analyze",
    tiledForceRegeneration: false,
  });
  assert.equal(running.artifactLineage, null);
  const diagnostic = sample();
  const failed = await store.updateGeneration(running.id, {
    status: "failed",
    completedAt: "2026-09-28T00:00:00.000Z",
    failureReason: "no_complete_tile",
    metricStatus: "none",
    collisionStatus: "none",
    artifactLineage: diagnostic,
  });
  assert.deepEqual(failed.artifactLineage, diagnostic);
  await store.updateGeneration(running.id, { artifactLineage: failed.artifactLineage });
  await assert.rejects(
    () => store.updateGeneration(running.id, {
      artifactLineage: sample({ emptySource: "process_cache" }),
    }),
    AfcGenerationImmutabilityError,
  );
  const preserved = await store.getGeneration(running.id);
  assert.deepEqual(preserved?.artifactLineage, diagnostic);
});

test("generated EMPTY and TILED record a stage dispatch and no reused generation", async () => {
  const store = await seededStore();
  const calls = counts();
  const result = await analyze({ store, counts: calls });
  assert.equal(result.status, "ready");
  assert.equal("artifactLineage" in result, false);
  assert.equal(calls.stage1, 1);
  assert.equal(calls.tiled, 1);
  assert.equal(calls.reader, 1);
  const { generation, lineage } = await recordedOf(store, result.generationId);
  assert.equal(lineage.empty.source, "generated");
  assert.equal(lineage.empty.sha256, emptyBasis.sha256);
  assert.equal(lineage.empty.reusedFromGenerationId, null);
  assert.equal(lineage.tiled.source, "generated");
  assert.equal(lineage.tiled.sha256, tiledBasis.sha256);
  assert.equal(lineage.tiled.reusedFromGenerationId, null);
  assert.equal(lineage.tiled.provenanceRunId, "tiled-1");
  assert.equal(lineage.tiled.generatorId, AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID);
  assert.equal(lineage.tiled.profileId, AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE);
  assert.equal(lineage.tiled.researchPreset, AFC_SR1_TILE_GRID_SCAFFOLD_PRESET);
  assert.equal(lineage.tiled.requestedModelId, AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID);
  assert.equal(lineage.reader.status, "ok");
  assert.equal(lineage.reader.readerVersion, READER_VERSION);
  assert.equal(lineage.reader.rawQuadCount, 4);
  assert.equal(lineage.reader.deduplicatedCellCount, 4);
  assert.equal(lineage.reader.selectedComponentTileCount, 4);
  assert.equal(lineage.reader.selectedCore?.rows, 2);
  assert.equal(lineage.reader.selectedCore?.columns, 2);
  assert.deepEqual(lineage.reader.selectedPolygon, QUAD);
  assert.equal(generation.emptyArtifactSource, "generated");
  assert.equal(generation.tiledArtifactSource, "generated");
  assert.equal(JSON.stringify(generation.diagnosticPayload).includes("artifact-lineage"), false);
  assert.equal(JSON.stringify(generation.settleDecision).includes("artifact-lineage"), false);
  assert.equal(JSON.stringify(generation.cameraRealizability).includes("artifact-lineage"), false);
  const durableEmpty = await store.lookupDurableEmpty(USER_ID, originalBasis.sha256);
  const durableTiled = await store.lookupDurableTiled(
    USER_ID,
    buildAfcSr1TiledArtifactCacheKey({ emptySha256: emptyBasis.sha256 }),
  );
  assert.equal(durableEmpty?.sourceGenerationId, result.generationId);
  assert.equal(durableTiled?.sourceGenerationId, result.generationId);
});

test("process-cache EMPTY is not labeled generated and still follows the existing publish rule", async () => {
  const store = await seededStore();
  const calls = counts();
  const result = await analyze({ store, counts: calls, emptyGenerated: false });
  assert.equal(result.status, "ready");
  assert.equal(calls.empty, 1);
  assert.equal(calls.stage1, 0);
  const { generation, lineage } = await recordedOf(store, result.generationId);
  assert.equal(lineage.empty.source, "process_cache");
  assert.equal(lineage.empty.reusedFromGenerationId, null);
  assert.equal(lineage.empty.sha256, emptyBasis.sha256);
  assert.equal(generation.emptyArtifactSource, "generated");
  const payload = generation.diagnosticPayload as {
    engineEmptyArtifactSource: string | null;
  };
  assert.equal(payload.engineEmptyArtifactSource, "cache");
  const durableEmpty = await store.lookupDurableEmpty(USER_ID, originalBasis.sha256);
  assert.equal(durableEmpty?.sourceGenerationId, result.generationId);
});

test("durable EMPTY and TILED reuse keep the publishing generation id", async () => {
  const store = await seededStore();
  const firstCalls = counts();
  const first = await analyze({ store, counts: firstCalls });
  assert.equal(first.status, "ready");
  const secondCalls = counts();
  const second = await analyze({ store, counts: secondCalls, intent: "run_again" });
  assert.equal(second.status, "ready");
  assert.equal(secondCalls.empty, 0);
  assert.equal(secondCalls.stage1, 0);
  assert.equal(secondCalls.tiled, 0);
  assert.equal(secondCalls.reader, 1);
  const { generation, lineage } = await recordedOf(store, second.generationId);
  assert.equal(lineage.empty.source, "durable");
  assert.equal(lineage.empty.reusedFromGenerationId, first.generationId);
  assert.equal(lineage.tiled.source, "durable");
  assert.equal(lineage.tiled.reusedFromGenerationId, first.generationId);
  assert.equal(lineage.tiled.provenanceRunId, "tiled-1");
  assert.equal(lineage.tiled.sha256, tiledBasis.sha256);
  assert.equal(generation.emptyArtifactSource, "durable");
  assert.equal(generation.tiledArtifactSource, "durable");
  const payload = generation.diagnosticPayload as {
    engineEmptyArtifactSource: string | null;
    engineTiledArtifactSource: string | null;
    executionCounts: { floorOnlyTiledGeneration: number } | null;
  };
  assert.equal(payload.engineEmptyArtifactSource, "cache");
  assert.equal(payload.engineTiledArtifactSource, "generated");
  assert.equal(payload.executionCounts?.floorOnlyTiledGeneration, 1);
  assert.equal(second.authority?.empty.artifactSource, "durable");
  assert.equal(second.authority?.tiled.artifactSource, "durable");
});

test("Re-read Perspective regenerates TILED and keeps the durable EMPTY lineage", async () => {
  const store = await seededStore();
  const first = await analyze({ store, counts: counts() });
  assert.equal(first.status, "ready");
  const calls = counts();
  const reread = await analyze({ store, counts: calls, intent: "reread_perspective" });
  assert.equal(reread.status, "ready");
  assert.equal(calls.empty, 0);
  assert.equal(calls.tiled, 1);
  assert.equal(reread.authority?.tiled.artifactSource, "generated");
  assert.equal(reread.authority?.empty.artifactSource, "durable");
  const { lineage } = await recordedOf(store, reread.generationId);
  assert.equal(lineage.empty.source, "durable");
  assert.equal(lineage.empty.reusedFromGenerationId, first.generationId);
  assert.equal(lineage.tiled.source, "generated");
  assert.equal(lineage.tiled.reusedFromGenerationId, null);
  assert.equal(lineage.tiled.provenanceRunId, "tiled-1");
  const durable = await store.lookupDurableTiled(
    USER_ID,
    buildAfcSr1TiledArtifactCacheKey({ emptySha256: emptyBasis.sha256 }),
  );
  assert.equal(durable?.sourceGenerationId, reread.generationId);
});

test("stage-2 failure records the dispatch and does not publish durable artifacts", async () => {
  const store = await seededStore();
  const calls = counts();
  const result = await analyze({
    store,
    counts: calls,
    tiledImpl: async () => {
      calls.tiled += 1;
      return { status: "failure", code: "generation_failed", runId: "stage2-fail" } as never;
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "generation_failed");
  assert.equal(calls.tiled, 1);
  assert.equal(calls.reader, 0);
  const { generation, lineage } = await recordedOf(store, result.generationId);
  assert.equal(lineage.empty.source, "generated");
  assert.equal(lineage.tiled.source, "generated");
  assert.equal(lineage.tiled.sha256, null);
  assert.equal(lineage.tiled.provenanceRunId, "stage2-fail");
  assert.equal(lineage.tiled.generatorId, AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID);
  assert.equal(lineage.tiled.reusedFromGenerationId, null);
  assert.equal(lineage.reader.status, null);
  assert.equal(generation.tiledArtifactSource, null);
  assert.equal(await store.lookupDurableEmpty(USER_ID, originalBasis.sha256), null);
  assert.equal(
    await store.lookupDurableTiled(
      USER_ID,
      buildAfcSr1TiledArtifactCacheKey({ emptySha256: emptyBasis.sha256 }),
    ),
    null,
  );
});

test("reader failure keeps status and version without counts and does not publish", async () => {
  const store = await seededStore();
  const result = await analyze({ store, counts: counts(), readerMode: "failed" });
  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "no_complete_tile");
  assert.equal(JSON.stringify(result).includes(READER_VERSION), false);
  const { lineage } = await recordedOf(store, result.generationId);
  assert.equal(lineage.reader.status, "failed");
  assert.equal(lineage.reader.readerVersion, READER_VERSION);
  assert.equal(lineage.reader.rawQuadCount, null);
  assert.equal(lineage.reader.deduplicatedCellCount, null);
  assert.equal(lineage.reader.selectedComponentTileCount, null);
  assert.equal(lineage.reader.selectedCore, null);
  assert.equal(lineage.reader.selectedPolygon, null);
  assert.equal(lineage.tiled.source, "generated");
  assert.equal(lineage.tiled.provenanceRunId, "tiled-1");
  assert.equal(await store.lookupDurableEmpty(USER_ID, originalBasis.sha256), null);
  assert.equal(
    await store.lookupDurableTiled(
      USER_ID,
      buildAfcSr1TiledArtifactCacheKey({ emptySha256: emptyBasis.sha256 }),
    ),
    null,
  );
});

test("an invalid reader polygon is retained while the failure reason stays unchanged", async () => {
  const store = await seededStore();
  const quad = [
    { x: 0.1, y: 1.5 },
    { x: 0.9, y: 0.9 },
    { x: 0.65, y: 0.55 },
    { x: 0.35, y: 0.55 },
  ] as const;
  const result = await analyze({
    store,
    counts: counts(),
    readerMode: "invalid_polygon",
    quad,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.failureReason, "reader_authoritative_quad_invalid");
  const { lineage } = await recordedOf(store, result.generationId);
  assert.equal(lineage.reader.status, "ok");
  assert.equal(lineage.reader.rawQuadCount, 4);
  assert.deepEqual(lineage.reader.selectedPolygon, quad);
  assert.equal(lineage.reader.selectedCore?.rows, 2);
});

test("identity mismatch and reader transport failure leave the reader section empty", async () => {
  const mismatchStore = await seededStore();
  const mismatch = await analyze({
    store: mismatchStore,
    counts: counts(),
    readerMode: "identity_mismatch",
  });
  assert.equal(mismatch.status, "failed");
  assert.equal(mismatch.failureReason, "reader_identity_does_not_bind_generated_tiled");
  const mismatchLineage = await recordedOf(mismatchStore, mismatch.generationId);
  assert.equal(mismatchLineage.lineage.reader.status, null);
  assert.equal(mismatchLineage.lineage.reader.readerVersion, null);
  assert.equal(mismatchLineage.lineage.reader.selectedPolygon, null);

  const transportStore = await seededStore();
  const transport = await analyze({
    store: transportStore,
    counts: counts(),
    readerMode: "throw",
  });
  assert.equal(transport.status, "failed");
  assert.equal(transport.failureReason, "tiled_reader_transport_or_contract_failed");
  const transportLineage = await recordedOf(transportStore, transport.generationId);
  assert.deepEqual(transportLineage.lineage.reader, unknownAfcV2ArtifactLineageReader());
});

test("settle failure keeps the reader polygon and does not publish durable artifacts", async () => {
  const store = await seededStore();
  const historicalOriginal = basis(ORIGINAL_BYTES, 1144, 1534, "image/jpeg");
  const historicalEmpty = basis(EMPTY_BYTES, 896, 1200, "image/png");
  const historicalTiled = basis(TILED_PNG, 896, 1200, "image/png");
  const result = await analyze({
    store,
    counts: counts(),
    original: historicalOriginal,
    emptyIdentity: historicalEmpty,
    tiledIdentity: historicalTiled,
    quad: BAD_QUAD,
    core: { rows: 4, columns: 1, j0: 0, i0: -1 },
    rawQuadCount: 14,
    deduplicatedCellCount: 14,
    selectedComponentTileCount: 7,
    reprojectionMeanPx: 11.42760589387132,
    reprojectionMaxPx: 48.01957277261079,
  });
  assert.equal(result.status, "failed");
  assert.match(result.failureReason ?? "", /no_apply_safe_candidate/);
  const { generation, lineage } = await recordedOf(store, result.generationId);
  assert.equal(lineage.reader.status, "ok");
  assert.equal(lineage.reader.rawQuadCount, 14);
  assert.equal(lineage.reader.deduplicatedCellCount, 14);
  assert.equal(lineage.reader.selectedComponentTileCount, 7);
  assert.equal(lineage.reader.selectedCore?.rows, 4);
  assert.equal(lineage.reader.selectedCore?.columns, 1);
  assert.equal(lineage.reader.selectedCore?.j0, 0);
  assert.equal(lineage.reader.selectedCore?.i0, -1);
  assert.equal(lineage.reader.latticeReprojectionMeanPx, 11.42760589387132);
  assert.equal(lineage.reader.latticeReprojectionMaxPx, 48.01957277261079);
  assert.deepEqual(lineage.reader.selectedPolygon, BAD_QUAD);
  assert.equal(isAfcV2SettleDecisionRecordedV1(generation.settleDecision), true);
  if (!isAfcV2SettleDecisionRecordedV1(generation.settleDecision)) return;
  assert.equal(generation.settleDecision.result.reason, "no_apply_safe_candidate");
  assert.equal(generation.settleDecision.applySafeCellCount, 0);
  assert.equal(await store.lookupDurableEmpty(USER_ID, historicalOriginal.sha256), null);
  await assert.rejects(
    () => store.updateGeneration(generation.id, {
      artifactLineage: sample(),
    }),
    AfcGenerationImmutabilityError,
  );
});

test("a failed Re-read Perspective leaves the good durable TILED unchanged", async () => {
  const store = await seededStore();
  const first = await analyze({ store, counts: counts() });
  assert.equal(first.status, "ready");
  const cacheKey = buildAfcSr1TiledArtifactCacheKey({ emptySha256: emptyBasis.sha256 });
  const published = await store.lookupDurableTiled(USER_ID, cacheKey);
  assert.equal(published?.sourceGenerationId, first.generationId);
  assert.equal(published?.result.tiled.identity.sha256, tiledBasis.sha256);

  const regenerated = basis(Uint8Array.of(9, 9, 9, 9), 1200, 800, "image/png");
  assert.notEqual(regenerated.sha256, tiledBasis.sha256);
  const rereadCalls = counts();
  const reread = await analyze({
    store,
    counts: rereadCalls,
    intent: "reread_perspective",
    tiledIdentity: regenerated,
    readerMode: "failed",
  });
  assert.equal(reread.status, "failed");
  assert.equal(rereadCalls.tiled, 1);
  assert.equal(rereadCalls.empty, 0);
  const failed = await recordedOf(store, reread.generationId);
  assert.equal(failed.lineage.tiled.source, "generated");
  assert.equal(failed.lineage.tiled.sha256, regenerated.sha256);
  assert.equal(failed.lineage.tiled.reusedFromGenerationId, null);
  assert.equal(failed.generation.status, "failed");

  const afterFailure = await store.lookupDurableTiled(USER_ID, cacheKey);
  assert.equal(afterFailure?.sourceGenerationId, first.generationId);
  assert.equal(afterFailure?.result.tiled.identity.sha256, tiledBasis.sha256);
  assert.equal(afterFailure?.result.tiled.identity.sha256 === regenerated.sha256, false);

  const againCalls = counts();
  const again = await analyze({ store, counts: againCalls, intent: "run_again" });
  assert.equal(again.status, "ready");
  assert.equal(againCalls.tiled, 0);
  const reused = await recordedOf(store, again.generationId);
  assert.equal(reused.lineage.tiled.source, "durable");
  assert.equal(reused.lineage.tiled.sha256, tiledBasis.sha256);
  assert.equal(reused.lineage.tiled.reusedFromGenerationId, first.generationId);
  assert.equal(reused.generation.tiledArtifactSource, "durable");
  const stillPublished = await store.lookupDurableTiled(USER_ID, cacheKey);
  assert.equal(stillPublished?.sourceGenerationId, first.generationId);
  assert.equal(stillPublished?.result.tiled.identity.sha256, tiledBasis.sha256);
});

test("the supabase generation update writes artifact_lineage_decision for ready and failed rows", async () => {
  const readyStore = recordingSupabase("analyze");
  const ready = createSupabaseAfcProductionStore(readyStore.client as never);
  const readyLineage = sample({ tiledSource: "durable", reused: PUBLISHER_ID });
  const readyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const readyGeneration = await ready.updateGeneration(readyId, {
    status: "ready",
    completedAt: "2026-09-29T00:00:01.000Z",
    artifactLineage: readyLineage,
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(readyStore.updates[0], "artifact_lineage_decision"),
    true,
  );
  assert.equal(
    isAfcV2ArtifactLineageRecorded(
      persistedLineage(readyStore.updates[0].artifact_lineage_decision),
    ),
    true,
  );
  assert.deepEqual(readyGeneration.artifactLineage, readyLineage);
  await ready.updateGeneration(readyId, { metricStatus: "none" });
  assert.equal(
    Object.prototype.hasOwnProperty.call(readyStore.updates[1], "artifact_lineage_decision"),
    false,
  );
  const preservedReady = await ready.getGeneration(readyId);
  assert.deepEqual(preservedReady?.artifactLineage, readyLineage);

  const failedStore = recordingSupabase("reread_perspective");
  const failed = createSupabaseAfcProductionStore(failedStore.client as never);
  const failedLineage = sample();
  const failedId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const failedGeneration = await failed.updateGeneration(failedId, {
    status: "failed",
    completedAt: "2026-09-29T00:00:02.000Z",
    failureReason: "AFC settle failed closed: no_apply_safe_candidate.",
    artifactLineage: failedLineage,
  });
  assert.equal(
    isAfcV2ArtifactLineageRecorded(
      persistedLineage(failedStore.updates[0].artifact_lineage_decision),
    ),
    true,
  );
  assert.deepEqual(failedGeneration.artifactLineage, failedLineage);
  assert.equal(failedGeneration.status, "failed");
  await failed.updateGeneration(failedId, { collisionStatus: "none" });
  assert.equal(
    Object.prototype.hasOwnProperty.call(failedStore.updates[1], "artifact_lineage_decision"),
    false,
  );
  const preservedFailed = await failed.getGeneration(failedId);
  assert.deepEqual(preservedFailed?.artifactLineage, failedLineage);
  assert.equal(preservedFailed?.failureReason, "AFC settle failed closed: no_apply_safe_candidate.");
});

function persistedLineage(value: unknown) {
  if (value == null) return null;
  const parsed = parseAfcV2ArtifactLineage(value);
  return parsed.ok ? parsed.decision : null;
}

function recordingSupabase(intent: "analyze" | "reread_perspective") {
  const updates: Array<Record<string, unknown>> = [];
  let row: Record<string, unknown> = {
    id: intent === "analyze"
      ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    room_id: ROOM_ID,
    user_id: USER_ID,
    parent_generation_id: null,
    lineage_seq: 1,
    run_id: "run-persist",
    intent,
    status: "running",
    created_at: "2026-09-29T00:00:00.000Z",
    completed_at: null,
    tiled_force_regeneration: intent === "reread_perspective",
    engine_fingerprint: null,
    production_authority: null,
    diagnostic_payload: null,
    failure_reason: null,
    metric_status: null,
    collision_status: null,
    metric_decision: null,
    settle_decision: null,
    camera_realizability_decision: null,
    artifact_lineage_decision: null,
    provider_provenance: {},
  };
  const chain = {
    eq() { return chain; },
    select() { return chain; },
    async single() { return { data: { ...row }, error: null }; },
    async maybeSingle() { return { data: { ...row }, error: null }; },
  };
  return {
    updates,
    client: {
      from() {
        return {
          update(payload: Record<string, unknown>) {
            updates.push({ ...payload });
            row = { ...row, ...payload };
            return chain;
          },
          select() { return chain; },
        };
      },
    },
  };
}
