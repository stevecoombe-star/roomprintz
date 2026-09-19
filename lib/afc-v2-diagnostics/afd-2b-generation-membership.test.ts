import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { AfcSr1TiledLiveProductDependencies } from "@/app/admin/3d-room-lab/afc-sr1-tiled-live-product";
import {
  AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
} from "@/app/admin/3d-room-lab/research/afc-sr1-tile-grid-scaffold";
import {
  executeAfcV2Analysis,
  type AfcV2AnalysisDependencies,
} from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import { buildEmptyRoomObservationEvidence } from "@/app/admin/3d-room-lab-v2/empty-room-observation-contract";
import { buildUnavailableMetricRoomPriorReceipt } from "@/app/admin/3d-room-lab-v2/metric-room-prior-contract";
import {
  restoreProductionAfcRoom,
  runProductionAfcAnalysis,
  type ProductionAfcGenerationCreated,
  type ProductionAfcIntent,
} from "@/lib/afc-v2-production/production-adapter.server";
import { collectProductionPayloadPrivacyViolations } from "@/lib/afc-v2-production/privacy";
import { type ProductionAfcAuth } from "@/lib/afc-v2-production/production-http";
import {
  createMemoryAfcProductionStore,
  type AfcGenerationRecord,
  type AfcProductionStore,
} from "@/lib/afc-v2-production/production-store";

import { AFC_DIAGNOSTIC_CASE_TABLE } from "./contracts";
import { handleAfcQaCapabilityGet } from "./qa-capability.server";
import {
  AFC_DIAGNOSTIC_SESSION_ASSOCIATION_FAILED_EVENT,
  attachAfcDiagnosticSessionBestEffort,
  type AfcDiagnosticSessionAttachLog,
} from "./session-attach.server";
import {
  AfcDiagnosticSessionStoreError,
  type AfcDiagnosticMembershipResult,
  type AfcDiagnosticSessionMembershipInput,
  type AfcDiagnosticSessionStore,
} from "./session-lifecycle.server";

const ROOT = process.cwd();
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const BASE_ASSET_ID = "99999999-9999-4999-8999-999999999999";
const ORIGINAL_BYTES = Uint8Array.from([9, 8, 7, 6]);
const ORIGINAL_B_BYTES = Uint8Array.from([1, 2, 3, 4]);
const SOURCE_IMAGE_URL = "https://example.test/original.jpg";
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
const originalBasisB = {
  sha256: sha(ORIGINAL_B_BYTES),
  byteCount: ORIGINAL_B_BYTES.byteLength,
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
const authoritativeFloorQuad = [
  { x: 0.1, y: 0.9 },
  { x: 0.9, y: 0.9 },
  { x: 0.65, y: 0.55 },
  { x: 0.35, y: 0.55 },
] as const;

const PUBLIC_ANALYZE_KEYS = [
  "status",
  "generationId",
  "currentGenerationId",
  "authority",
  "failureReason",
  "frame",
] as const;

function source(relativePath: string) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function walkTs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walkTs(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

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
    attemptId: "prod",
    loadGeneration: 0,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-08T20:00:00.000Z",
  });
}

function tiledResult(runId: string) {
  return {
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
      runId,
      generatedAt: "2026-09-08T20:00:00.000Z",
      appliedAspectRatio: "3:2",
      imageTransport: "data_url" as const,
      generationStatus: "generated" as const,
    },
    compatibility: { tier: "exact_grid_compatible" as const },
  };
}

function analysisDependencies(
  options: Readonly<{ failReader?: boolean }> = {},
): AfcV2AnalysisDependencies {
  const product: AfcSr1TiledLiveProductDependencies = {
    createResultId: () => "prod-result",
    resolveEmpty: async () => ({
      basis: emptyBasis,
      bytes: EMPTY_BYTES,
      generated: true,
    }),
    generateTiled: async () => tiledResult("tiled-1") as never,
    validateTiledLineage: async () => ({
      tiledIdentity: tiledBasis,
      authority: { lineageEvidenceDigest: "d".repeat(64) },
    }) as never,
    readTiledPerspective: async () => {
      if (options.failReader) {
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
        authoritativeQuadSourceNormalized: authoritativeFloorQuad,
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
    observeRoom: async () => observation(),
    estimateMetricRoom: async () => buildUnavailableMetricRoomPriorReceipt({
      sourceImageHash: originalBasis.sha256,
      originalAncestorSha256: originalBasis.sha256,
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
      safeDetail: "PI-2 fixture metric prior unavailable.",
      contractValidationReason: "pi2_fixture",
    }),
  };
}

async function seededStore(baseAsset = true): Promise<AfcProductionStore> {
  const store = createMemoryAfcProductionStore();
  await store.createRoom?.({
    id: ROOM_ID,
    userId: USER_ID,
    currentAfcGenerationId: null,
    baseStorageBucket: "vibode-base-images",
    baseStoragePath: `users/${USER_ID}/scene_x/base.jpg`,
    baseAsset: baseAsset
      ? Object.freeze({
        id: BASE_ASSET_ID,
        roomId: ROOM_ID,
        userId: USER_ID,
        storageBucket: "vibode-base-images",
        storagePath: `users/${USER_ID}/scene_x/base.jpg`,
      })
      : null,
  });
  return store;
}

type AttachSpy = {
  calls: ProductionAfcGenerationCreated[];
  statuses: Array<AfcGenerationRecord["status"] | null>;
  events: string[];
  ensure: (
    input: AfcDiagnosticSessionMembershipInput,
  ) => Promise<AfcDiagnosticMembershipResult>;
};

function createAttachSpy(
  store: AfcProductionStore,
  options: Readonly<{
    throwError?: unknown;
    result?: AfcDiagnosticMembershipResult;
  }> = {},
): AttachSpy {
  const spy: AttachSpy = {
    calls: [],
    statuses: [],
    events: [],
    ensure: async (input) => {
      const generation = await store.getGeneration(String(input.generationId));
      spy.events.push("diagnosticAttach");
      spy.calls.push(input as ProductionAfcGenerationCreated);
      spy.statuses.push(generation?.status ?? null);
      if (options.throwError !== undefined) throw options.throwError;
      return options.result ?? {
        enabled: true,
        sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        generationId: String(input.generationId),
        attemptOrdinal: spy.calls.length,
        sessionCreated: spy.calls.length === 1,
        membershipCreated: true,
        staleSessionsClosed: 0,
      };
    },
  };
  return spy;
}

function instrumentStore(store: AfcProductionStore, events: string[]): AfcProductionStore {
  return {
    ...store,
    async createGeneration(input) {
      const generation = await store.createGeneration(input);
      events.push("createGeneration");
      return generation;
    },
    async updateGeneration(generationId, patch) {
      const updated = await store.updateGeneration(generationId, patch);
      if (patch.status === "ready" || patch.status === "failed") {
        events.push(`terminal:${patch.status}`);
      }
      return updated;
    },
    async activateGeneration(input) {
      const current = await store.activateGeneration(input);
      events.push("activate");
      return current;
    },
  };
}

async function analyzeWithAttach(args: Readonly<{
  store: AfcProductionStore;
  spy: AttachSpy;
  intent?: ProductionAfcIntent;
  failReader?: boolean;
  env?: NodeJS.ProcessEnv;
  originalBytes?: Uint8Array;
  originalIdentity?: typeof originalBasis;
  analyze?: typeof executeAfcV2Analysis;
  logs?: AfcDiagnosticSessionAttachLog[];
}>) {
  const events = args.spy.events;
  return runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    intent: args.intent,
    store: args.store,
    original: {
      bytes: args.originalBytes ?? ORIGINAL_BYTES,
      identity: args.originalIdentity ?? originalBasis,
      sourceImageUrl: SOURCE_IMAGE_URL,
    },
    analysisDependencies: analysisDependencies({ failReader: args.failReader }),
    analyze: args.analyze ?? (async (input, deps) => {
      events.push("analyze");
      return executeAfcV2Analysis(input, deps);
    }),
    onGenerationCreated: (created) => attachAfcDiagnosticSessionBestEffort(created, {
      env: args.env,
      ensureMembership: args.spy.ensure,
      log: args.logs ? (entry) => args.logs!.push(entry) : undefined,
    }),
  });
}

function throwingDiagnosticStore(): AfcDiagnosticSessionStore {
  const fail = async () => {
    throw new Error("diagnostic store should not be used");
  };
  return {
    closeStaleOpenSessions: fail,
    findOpenSession: fail,
    insertOpenSession: fail,
    findMembershipByGenerationId: fail,
    maxAttemptOrdinal: fail,
    insertMembership: fail,
  };
}

test("successful generation creation invokes diagnostics exactly once with trusted inputs", async () => {
  const base = await seededStore();
  const events: string[] = [];
  const store = instrumentStore(base, events);
  const spy = createAttachSpy(store);
  spy.events = events;
  const result = await analyzeWithAttach({ store, spy, intent: "analyze" });
  assert.equal(result.status, "ready");
  assert.equal(spy.calls.length, 1);
  const created = spy.calls[0]!;
  assert.equal(created.userId, USER_ID);
  assert.equal(created.roomId, ROOM_ID);
  assert.equal(created.generationId, result.generationId);
  assert.equal(created.originalSha256, originalBasis.sha256);
  assert.equal(created.baseAssetId, BASE_ASSET_ID);
  assert.equal(created.intent, "analyze");
  assert.deepEqual(spy.statuses, ["running"]);
  assert.equal(events.indexOf("createGeneration") >= 0, true);
  assert.equal(events.indexOf("diagnosticAttach") >= 0, true);
  assert.equal(events.indexOf("analyze") >= 0, true);
  assert.equal(events.indexOf("terminal:ready") >= 0, true);
  assert.ok(events.indexOf("createGeneration") < events.indexOf("diagnosticAttach"));
  assert.ok(events.indexOf("diagnosticAttach") < events.indexOf("analyze"));
  assert.ok(events.indexOf("diagnosticAttach") < events.indexOf("terminal:ready"));
  assert.equal(
    events.filter((event) => event === "diagnosticAttach").length,
    1,
  );
});

test("nullable baseAssetId is passed when the ORIGINAL snapshot is absent", async () => {
  const store = instrumentStore(await seededStore(false), []);
  const spy = createAttachSpy(store);
  const result = await analyzeWithAttach({ store, spy, intent: "analyze" });
  assert.equal(result.status, "ready");
  assert.equal(spy.calls[0]?.baseAssetId, null);
});

test("QA off is a true no-op: AFC unchanged, no diagnostic error log, public response unchanged", async () => {
  const store = await seededStore();
  const logs: AfcDiagnosticSessionAttachLog[] = [];
  const errors: unknown[][] = [];
  const originalError = console.error;
  const originalWarn = console.warn;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  console.warn = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    const result = await runProductionAfcAnalysis({
      roomId: ROOM_ID,
      userId: USER_ID,
      intent: "analyze",
      store,
      original: {
        bytes: ORIGINAL_BYTES,
        identity: originalBasis,
        sourceImageUrl: SOURCE_IMAGE_URL,
      },
      analysisDependencies: analysisDependencies(),
      onGenerationCreated: (created) => attachAfcDiagnosticSessionBestEffort(created, {
        env: { VIBODE_AFC_QA_MODE: "off" },
        store: throwingDiagnosticStore(),
        log: (entry) => logs.push(entry),
      }),
    });
    assert.equal(result.status, "ready");
    assert.ok(result.generationId);
    assert.equal(result.currentGenerationId, result.generationId);
    assert.deepEqual(Object.keys(result).sort(), [...PUBLIC_ANALYZE_KEYS].sort());
    assert.equal("sessionId" in result, false);
    assert.equal("attemptOrdinal" in result, false);
    assert.equal("enabled" in result, false);
    assert.equal(logs.length, 0);
    assert.equal(errors.length, 0);
    const generation = await store.getGeneration(result.generationId!);
    assert.equal(generation?.status, "ready");
    assert.equal((await store.getRoom(ROOM_ID))?.currentAfcGenerationId, result.generationId);
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
});

test("diagnostic primitive throw is non-fatal: AFC reaches READY, activates, logs compactly", async () => {
  const events: string[] = [];
  const store = instrumentStore(await seededStore(), events);
  const logs: AfcDiagnosticSessionAttachLog[] = [];
  const sensitive = new AfcDiagnosticSessionStoreError(
    "Diagnostic session store failed (23505).",
    "23505",
  );
  Object.assign(sensitive, {
    failureReason: "secret-failure-reason",
    engineFingerprint: { gitSha: "deadbeef" },
    diagnosticPayload: { prompt: "do not log" },
    sourceImageUrl: "https://example.test/original.jpg?token=secret",
    storagePath: "users/x/base.jpg",
    providerProvenance: { vendor: "hidden" },
    bearerToken: "bearer-secret",
    serviceRoleKey: "service-role-secret",
  });
  const spy = createAttachSpy(store, { throwError: sensitive });
  spy.events = events;
  const result = await analyzeWithAttach({
    store,
    spy,
    intent: "analyze",
    logs,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.currentGenerationId, result.generationId);
  assert.deepEqual(Object.keys(result).sort(), [...PUBLIC_ANALYZE_KEYS].sort());
  assert.equal("sessionId" in result, false);
  const generation = await store.getGeneration(result.generationId!);
  assert.equal(generation?.status, "ready");
  assert.ok(generation?.productionAuthority);
  assert.equal((await store.getRoom(ROOM_ID))?.currentAfcGenerationId, result.generationId);
  assert.ok(events.indexOf("createGeneration") < events.indexOf("diagnosticAttach"));
  assert.ok(events.indexOf("diagnosticAttach") < events.indexOf("analyze"));
  assert.ok(events.indexOf("diagnosticAttach") < events.indexOf("terminal:ready"));
  assert.ok(events.includes("activate"));
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0], {
    event: AFC_DIAGNOSTIC_SESSION_ASSOCIATION_FAILED_EVENT,
    generationId: result.generationId,
    roomId: ROOM_ID,
    errorName: "AfcDiagnosticSessionStoreError",
    postgresCode: "23505",
  });
  const serialized = JSON.stringify(logs[0]);
  assert.doesNotMatch(
    serialized,
    /secret-failure-reason|deadbeef|do not log|token=secret|users\/x\/base|hidden|bearer-secret|service-role-secret|engineFingerprint|diagnosticPayload|failureReason|sourceImageUrl/,
  );
});

test("failed AFC still associates once while running and never activates", async () => {
  const events: string[] = [];
  const store = instrumentStore(await seededStore(), events);
  const spy = createAttachSpy(store);
  spy.events = events;
  const failed = await analyzeWithAttach({
    store,
    spy,
    intent: "analyze",
    failReader: true,
  });
  assert.equal(failed.status, "failed");
  assert.equal(spy.calls.length, 1);
  assert.deepEqual(spy.statuses, ["running"]);
  assert.equal(spy.calls[0]?.generationId, failed.generationId);
  assert.ok(events.indexOf("diagnosticAttach") < events.indexOf("analyze"));
  assert.ok(events.indexOf("diagnosticAttach") < events.indexOf("terminal:failed"));
  assert.equal(events.includes("activate"), false);
  assert.equal(
    events.filter((event) => event === "diagnosticAttach").length,
    1,
  );
  const generation = await store.getGeneration(failed.generationId!);
  assert.equal(generation?.status, "failed");
  assert.equal(generation?.productionAuthority, null);
  assert.equal((await store.getRoom(ROOM_ID))?.currentAfcGenerationId, null);
  assert.equal(failed.currentGenerationId, null);
});

test("pre-generation ORIGINAL URL failure does not invoke diagnostics", async () => {
  const store = await seededStore();
  const spy = createAttachSpy(store);
  const result = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    intent: "analyze",
    store,
    original: { bytes: ORIGINAL_BYTES, identity: originalBasis },
    analysisDependencies: analysisDependencies(),
    onGenerationCreated: (created) => attachAfcDiagnosticSessionBestEffort(created, {
      ensureMembership: spy.ensure,
    }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.generationId, null);
  assert.equal(spy.calls.length, 0);
});

test("failed createGeneration does not invoke diagnostics", async () => {
  const base = await seededStore();
  const store: AfcProductionStore = {
    ...base,
    async createGeneration() {
      throw new Error("Failed to create AFC generation");
    },
  };
  const spy = createAttachSpy(store);
  await assert.rejects(
    () => analyzeWithAttach({ store, spy, intent: "analyze" }),
    /Failed to create AFC generation/,
  );
  assert.equal(spy.calls.length, 0);
});

test("source-change generation passes the new ORIGINAL sha and does not close Sessions itself", async () => {
  const store = await seededStore();
  const spy = createAttachSpy(store);
  const first = await analyzeWithAttach({ store, spy, intent: "analyze" });
  assert.equal(first.status, "ready");
  const second = await analyzeWithAttach({
    store,
    spy,
    intent: "run_again",
    originalBytes: ORIGINAL_B_BYTES,
    originalIdentity: originalBasisB,
  });
  assert.ok(second.generationId);
  assert.equal(spy.calls.length, 2);
  assert.equal(spy.calls[0]?.originalSha256, originalBasis.sha256);
  assert.equal(spy.calls[1]?.originalSha256, originalBasisB.sha256);
  assert.notEqual(spy.calls[1]?.originalSha256, spy.calls[0]?.originalSha256);
  assert.equal(spy.calls[1]?.generationId, second.generationId);
  assert.notEqual(spy.calls[1]?.generationId, spy.calls[0]?.generationId);
  const attach = source("lib/afc-v2-diagnostics/session-attach.server.ts");
  const analyzeRoute = source("app/api/vibode/afc/analyze/route.ts");
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  assert.doesNotMatch(attach, /closeStaleOpenSessions/);
  assert.doesNotMatch(analyzeRoute, /closeStaleOpenSessions/);
  assert.doesNotMatch(adapter, /closeStaleOpenSessions/);
  const lifecycle = source("lib/afc-v2-diagnostics/session-lifecycle.server.ts");
  assert.match(lifecycle, /closeStaleOpenSessions/);
});

test("normalized production intents are forwarded from the created generation", async () => {
  const store = await seededStore();
  const spy = createAttachSpy(store);
  await analyzeWithAttach({ store, spy, intent: "analyze" });
  await analyzeWithAttach({ store, spy, intent: "run_again" });
  await analyzeWithAttach({ store, spy, intent: "reread_perspective" });
  assert.deepEqual(
    spy.calls.map((call) => call.intent),
    ["analyze", "run_again", "reread_perspective"],
  );
  assert.equal(spy.calls.length, 3);
});

test("one newly created generation causes one attach; restore/runtime/terminal do not attach again", async () => {
  const events: string[] = [];
  const store = instrumentStore(await seededStore(), events);
  const spy = createAttachSpy(store);
  spy.events = events;
  const result = await analyzeWithAttach({ store, spy, intent: "analyze" });
  assert.equal(result.status, "ready");
  assert.equal(spy.calls.length, 1);
  const restored = await restoreProductionAfcRoom({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
  });
  assert.equal(restored.status, "ready");
  assert.equal(spy.calls.length, 1);
  assert.equal(
    events.filter((event) => event === "diagnosticAttach").length,
    1,
  );
  const restoreRoute = source("app/api/vibode/afc/restore/route.ts");
  const runtimeRoute = source("app/api/vibode/afc/runtime/route.ts");
  const restoreFn = source("lib/afc-v2-production/production-adapter.server.ts");
  const restoreImpl = restoreFn.slice(
    restoreFn.indexOf("export async function restoreProductionAfcRoom"),
    restoreFn.indexOf("export async function runProductionAfcAnalysis"),
  );
  assert.doesNotMatch(restoreRoute, /onGenerationCreated|attachAfcDiagnosticSessionBestEffort/);
  assert.doesNotMatch(runtimeRoute, /onGenerationCreated|attachAfcDiagnosticSessionBestEffort/);
  assert.doesNotMatch(restoreImpl, /onGenerationCreated/);
  assert.equal(
    (restoreFn.slice(restoreFn.indexOf("export async function runProductionAfcAnalysis"))
      .match(/onGenerationCreated/g) ?? []).length,
    1,
  );
});

test("diagnostics result is never used for activation, authority, or status", async () => {
  const store = await seededStore();
  const result = await runProductionAfcAnalysis({
    roomId: ROOM_ID,
    userId: USER_ID,
    intent: "analyze",
    store,
    original: {
      bytes: ORIGINAL_BYTES,
      identity: originalBasis,
      sourceImageUrl: SOURCE_IMAGE_URL,
    },
    analysisDependencies: analysisDependencies(),
    onGenerationCreated: async () => ({
      enabled: true,
      status: "failed",
      currentGenerationId: "should-not-win",
      productionAuthority: { schemaVersion: "nope" },
      sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }),
  });
  assert.equal(result.status, "ready");
  assert.equal(result.currentGenerationId, result.generationId);
  assert.notEqual(result.currentGenerationId, "should-not-win");
  assert.equal("sessionId" in result, false);
  const generation = await store.getGeneration(result.generationId!);
  assert.equal(generation?.status, "ready");
  assert.notEqual(generation?.productionAuthority, null);
  assert.equal(
    generation?.productionAuthority?.schemaVersion,
    "afc-v2-production-room-authority/v1",
  );
  assert.equal((await store.getRoom(ROOM_ID))?.currentAfcGenerationId, result.generationId);
});

test("analyze, restore, runtime, and QA capability public surfaces stay unchanged", async () => {
  const store = await seededStore();
  const spy = createAttachSpy(store);
  const analyzed = await analyzeWithAttach({ store, spy, intent: "analyze" });
  assert.deepEqual(Object.keys(analyzed).sort(), [...PUBLIC_ANALYZE_KEYS].sort());
  assert.equal(collectProductionPayloadPrivacyViolations(analyzed).length, 0);
  const restored = await restoreProductionAfcRoom({
    roomId: ROOM_ID,
    userId: USER_ID,
    store,
  });
  assert.deepEqual(Object.keys(restored).sort(), [...PUBLIC_ANALYZE_KEYS].sort());
  for (const key of ["sessionId", "attemptOrdinal", "enabled", "qaEnabled"]) {
    assert.equal(key in analyzed, false);
    assert.equal(key in restored, false);
  }
  const capability = await handleAfcQaCapabilityGet({
    request: new Request("http://test/api/vibode/afc/qa/capability"),
    authorize: async (): Promise<ProductionAfcAuth> => ({ ok: true, userId: USER_ID }),
    env: { VIBODE_AFC_QA_MODE: "all" },
  });
  const body = await capability.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body), ["enabled"]);
  assert.equal(body.enabled, true);
  const runtime = source("app/api/vibode/afc/runtime/route.ts");
  assert.match(runtime, /originalImageUrl/);
  assert.doesNotMatch(runtime, /sessionId|attemptOrdinal|qaEnabled/);
  const analyzeRoute = source("app/api/vibode/afc/analyze/route.ts");
  assert.doesNotMatch(analyzeRoute, /sessionId|attemptOrdinal|qaEnabled/);
  assert.doesNotMatch(
    source("lib/afc-v2-production/production-adapter.server.ts"),
    /function publicResponse[\s\S]*sessionId/,
  );
});

test("AFD-2B does not add Case writes, migrations, Editor, or Partner Portal changes", () => {
  const attach = source("lib/afc-v2-diagnostics/session-attach.server.ts");
  const analyzeRoute = source("app/api/vibode/afc/analyze/route.ts");
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  assert.doesNotMatch(
    `${attach}\n${analyzeRoute}`,
    /vibode_afc_diagnostic_cases|repeated_unsuccessful|issue_codes|AFC_DIAGNOSTIC_CASE_TABLE/,
  );
  assert.doesNotMatch(adapter, /vibode_afc_diagnostic_cases/);
  const migrations = readdirSync(path.join(ROOT, "supabase/migrations")).filter(
    (name) => name.endsWith(".sql"),
  );
  assert.equal(migrations.some((name) => /afd.?2b|generation_membership/i.test(name)), false);
  assert.doesNotMatch(
    source("app/editor/page.tsx"),
    /session-attach|attachAfcDiagnosticSessionBestEffort/,
  );
  for (const relative of [
    "lib/vibode-stage/partner-portal-catalog.server.ts",
    "lib/vibode-stage/partner-portal-http.ts",
    "lib/vibode-stage/pi5g1-partner-portal.test.ts",
  ]) {
    assert.doesNotMatch(
      source(relative),
      /session-attach|attachAfcDiagnosticSessionBestEffort/,
    );
  }
  assert.equal(AFC_DIAGNOSTIC_CASE_TABLE, "vibode_afc_diagnostic_cases");
});

test("adapter does not import diagnostics; attach helper is the only analyze-route seam", () => {
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  const persistence = source("lib/afc-v2-production/production-persistence.server.ts");
  const authority = source("lib/afc-v2-production/production-authority-contract.ts");
  const runtime = source("lib/afc-v2-runtime/runtime-authority.ts");
  for (const text of [adapter, persistence, authority, runtime]) {
    assert.doesNotMatch(text, /afc-v2-diagnostics|session-attach|ensureAfcDiagnosticSessionMembership/);
  }
  const analyze = source("app/api/vibode/afc/analyze/route.ts");
  assert.match(analyze, /attachAfcDiagnosticSessionBestEffort/);
  assert.match(analyze, /onGenerationCreated: attachAfcDiagnosticSessionBestEffort/);
  const attach = source("lib/afc-v2-diagnostics/session-attach.server.ts");
  assert.match(attach, /ensureAfcDiagnosticSessionMembership/);
  assert.match(attach, /import "server-only"/);
  assert.doesNotMatch(attach, /runProductionAfcAnalysis|production-adapter/);
});

test("attach helper does not log for enabled:false and swallows primitive throws", async () => {
  const logs: AfcDiagnosticSessionAttachLog[] = [];
  const disabled = await attachAfcDiagnosticSessionBestEffort({
    userId: USER_ID,
    roomId: ROOM_ID,
    originalSha256: originalBasis.sha256,
    baseAssetId: null,
    generationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    intent: "analyze",
  }, {
    env: { VIBODE_AFC_QA_MODE: "off" },
    store: throwingDiagnosticStore(),
    log: (entry) => logs.push(entry),
  });
  assert.deepEqual(disabled, { enabled: false });
  assert.equal(logs.length, 0);

  const thrown = await attachAfcDiagnosticSessionBestEffort({
    userId: USER_ID,
    roomId: ROOM_ID,
    originalSha256: originalBasis.sha256,
    generationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    intent: "analyze",
  }, {
    ensureMembership: async () => {
      throw new Error("boom");
    },
    log: (entry) => logs.push(entry),
  });
  assert.equal(thrown, null);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.errorName, "Error");
  assert.equal("postgresCode" in (logs[0] ?? {}), false);
});

test("production core files under AFC still omit Case and Session writes", () => {
  for (const file of [
    ...walkTs(path.join(ROOT, "lib/afc-v2-production")),
    path.join(ROOT, "lib/afc-v2-runtime/runtime-authority.ts"),
    path.join(ROOT, "app/api/vibode/afc/restore/route.ts"),
    path.join(ROOT, "app/api/vibode/afc/runtime/route.ts"),
  ]) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /vibode_afc_diagnostic_/);
  }
});
