import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import path from "node:path";
import test from "node:test";

import { freezeAppliedTiledAfcCamera } from "@/app/admin/3d-room-lab/afc-calibrated-camera-authority-freeze";
import type { AfcSr1LiveAuthoritativeGeometry } from "@/app/admin/3d-room-lab/afc-sr1-live-product-contract";
import { buildEmptyRoomObservationEvidence } from "@/app/admin/3d-room-lab-v2/empty-room-observation-contract";
import { buildUnavailableMetricRoomPriorReceipt } from "@/app/admin/3d-room-lab-v2/metric-room-prior-contract";
import type { AfcDiagnosticsAdminAuth } from "@/lib/afc-v2-diagnostics/admin-auth.server";
import { afcQaAccessConfig } from "@/lib/afc-v2-diagnostics/qa-access";
import {
  handleManualPerspectiveRecoveryGet,
  handleManualPerspectiveRecoveryPost,
} from "@/lib/afc-v2-diagnostics/manual-perspective-recovery.server";
import type { ManualPerspectiveStore } from "@/lib/afc-v2-diagnostics/manual-perspective.server";
import { manualPerspectiveImageQuadValid } from "@/lib/afc-v2-diagnostics/manual-perspective-geometry";
import { acceptedAfcGeometryAuthority } from "@/lib/afc-v2-production/manual-source-quad";
import { isAfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";
import {
  createMemoryAfcProductionStore,
  type AfcGenerationRecord,
  type AfcProductionStore,
  type MemoryAfcProductionStore,
} from "@/lib/afc-v2-production/production-store";
import { resolvePersistedSceneCompatibility } from "@/lib/afc-v2-runtime/persisted-scene";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const QA_USER_ID = "55555555-5555-4555-8555-555555555555";
const CASE_ID = "66666666-6666-4666-8666-666666666666";
const ORIGINAL_BYTES = Uint8Array.from([9, 8, 7, 6]);
const EMPTY_BYTES = Uint8Array.from([4, 5, 6]);
const TILED_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);
const SOURCE_URL = "https://example.test/original.jpg";
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
const QUAD = {
  NL: { x: 0.1, y: 0.9 },
  NR: { x: 0.9, y: 0.9 },
  FR: { x: 0.65, y: 0.55 },
  FL: { x: 0.35, y: 0.55 },
};

function authorize(ok: boolean): () => Promise<AfcDiagnosticsAdminAuth> {
  return async () =>
    ok
      ? { ok: true, admin: { userId: QA_USER_ID, email: "qa@example.com" } }
      : {
        ok: false,
        response: NextResponse.json({ error: "Unauthorized." }, { status: 401 }),
      };
}

function observation() {
  return buildEmptyRoomObservationEvidence({
    observedPlanes: [],
    observedSeams: [{
      id: "visible_floor_wall",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_wall"],
      sourceNormalizedPolyline: [
        { x: 0.2, y: 0.62 },
        { x: 0.8, y: 0.62 },
      ],
      confidence: 0.9,
      visibility: "observed",
    }],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  }, {
    attemptId: "recovery",
    loadGeneration: 0,
    emptyIdentity: emptyBasis,
    originalAncestorSha256: originalBasis.sha256,
    provider: "controlled_fixture",
    model: "fixture",
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
    generatedAt: "2026-09-30T17:00:00.000Z",
  });
}

function manualStore(production: AfcProductionStore): ManualPerspectiveStore {
  return {
    async loadGeneration(_caseId, generationId) {
      const generation = await production.getGeneration(generationId);
      if (!generation || generation.roomId !== ROOM_ID) return null;
      return {
        id: generation.id,
        roomId: generation.roomId,
        userId: generation.userId,
        status: generation.status,
        frameWidth: generation.frame?.width ?? null,
        frameHeight: generation.frame?.height ?? null,
        originalDecodedWidth: generation.original?.decodedWidth ?? null,
        originalDecodedHeight: generation.original?.decodedHeight ?? null,
        productionAuthority: generation.productionAuthority,
        settleDecision: generation.settleDecision,
        cameraRealizability: generation.cameraRealizability,
        artifactLineage: generation.artifactLineage,
        manualPerspective: generation.manualPerspective,
        recoveryProvenance: generation.recoveryProvenance,
      };
    },
    async saveManualPerspective() {
      throw new Error("recovery must not write manual_perspective");
    },
  };
}

async function seedRoom(): Promise<MemoryAfcProductionStore> {
  const store = createMemoryAfcProductionStore();
  await store.createRoom?.({
    id: ROOM_ID,
    userId: USER_ID,
    currentAfcGenerationId: null,
    baseStorageBucket: "vibode-base-images",
    baseStoragePath: "users/base.jpg",
    baseAsset: null,
  });
  const ready = await store.createGeneration({
    roomId: ROOM_ID,
    userId: USER_ID,
    parentGenerationId: null,
    runId: crypto.randomUUID(),
    intent: "analyze",
    tiledForceRegeneration: false,
  });
  await store.updateGeneration(ready.id, {
    status: "ready",
    completedAt: "2026-09-30T16:00:00.000Z",
    original: originalBasis,
    frame: { width: 1200, height: 800 },
    productionAuthority: { marker: "previous-ready" } as never,
  });
  await store.activateGeneration({
    roomId: ROOM_ID,
    userId: USER_ID,
    generationId: ready.id,
  });
  return store;
}

async function seedFailed(
  store: MemoryAfcProductionStore,
  patch: Partial<{
    empty: boolean;
    tiled: boolean;
    sha: string;
  }> = {},
): Promise<AfcGenerationRecord> {
  const generation = await store.createGeneration({
    roomId: ROOM_ID,
    userId: USER_ID,
    parentGenerationId: (await store.getRoom(ROOM_ID))?.currentAfcGenerationId ?? null,
    runId: crypto.randomUUID(),
    intent: "run_again",
    tiledForceRegeneration: false,
  });
  const emptyPath = `users/${USER_ID}/rooms/${ROOM_ID}/afc/${generation.id}/empty.png`;
  const tiledPath = `users/${USER_ID}/rooms/${ROOM_ID}/afc/${generation.id}/tiled.png`;
  if (patch.empty !== false) {
    await store.putArtifact({ path: emptyPath, bytes: EMPTY_BYTES, contentType: "image/png" });
  }
  if (patch.tiled !== false) {
    await store.putArtifact({ path: tiledPath, bytes: TILED_PNG, contentType: "image/png" });
  }
  return store.updateGeneration(generation.id, {
    status: "failed",
    completedAt: "2026-09-30T16:30:00.000Z",
    original: {
      ...originalBasis,
      sha256: patch.sha ?? originalBasis.sha256,
    },
    empty: patch.empty === false ? null : emptyBasis,
    tiled: patch.tiled === false ? null : tiledBasis,
    emptyStoragePath: patch.empty === false ? null : emptyPath,
    tiledStoragePath: patch.tiled === false ? null : tiledPath,
    frame: { width: 1200, height: 800 },
    failureReason: "No usable floor quad.",
    settleDecision: { marker: "failed-settle" } as never,
    diagnosticPayload: { marker: "failed-diagnostic" },
    metricStatus: "none",
    collisionStatus: "none",
  });
}

function counts() {
  return { empty: 0, tiled: 0, reader: 0, observeRoom: 0, metricPrior: 0 };
}

function analysisDependencies(call: ReturnType<typeof counts>) {
  return {
    product: {
      createResultId: () => "recovery-result",
      resolveEmpty: async () => {
        call.empty += 1;
        throw new Error("EMPTY regeneration is not allowed");
      },
      generateTiled: async () => {
        call.tiled += 1;
        throw new Error("TILED regeneration is not allowed");
      },
      readTiledPerspective: async () => {
        call.reader += 1;
        throw new Error("TILED perspective reader is not allowed");
      },
    },
    observeRoom: async () => {
      call.observeRoom += 1;
      return observation();
    },
    estimateMetricRoom: async () => {
      call.metricPrior += 1;
      return buildUnavailableMetricRoomPriorReceipt({
        sourceImageHash: originalBasis.sha256,
        originalAncestorSha256: originalBasis.sha256,
        attemptId: "recovery",
        loadGeneration: 0,
        provider: "controlled_fixture",
        model: "fixture",
      }, {
        failureClass: "configuration",
        failureStage: "configuration",
        provider: "controlled_fixture",
        model: "fixture",
        providerStatus: null,
        safeDetail: "AFR-4C fixture metric prior unavailable.",
        contractValidationReason: "afr4c_fixture",
      });
    },
  };
}

function dependencies(
  store: AfcProductionStore,
  options: {
    qa?: boolean;
    bytes?: Uint8Array;
    calls?: ReturnType<typeof counts>;
    executeAnalysis?: NonNullable<
      Parameters<typeof handleManualPerspectiveRecoveryPost>[0]["dependencies"]
    > extends infer T
      ? T extends { executeAnalysis?: infer E }
        ? E
        : never
      : never;
  } = {},
) {
  const calls = options.calls ?? counts();
  return {
    calls,
    value: {
      authorize: authorize(true),
      qaAccess: options.qa === false
        ? afcQaAccessConfig(false, QA_USER_ID)
        : afcQaAccessConfig(true, QA_USER_ID),
      store: manualStore(store),
      productionStore: store,
      now: () => "2026-09-30T17:05:00.000Z",
      loadOriginal: async () => ({
        ok: true as const,
        bytes: options.bytes ?? ORIGINAL_BYTES,
        sourceImageUrl: SOURCE_URL,
      }),
      validateTiledLineage: async () => ({
        tiledIdentity: tiledBasis,
        authority: { lineageEvidenceDigest: "d".repeat(64) },
      }) as never,
      analysisDependencies: analysisDependencies(calls),
      onGenerationCreated: async () => ({ attached: false }),
      ...(options.executeAnalysis ? { executeAnalysis: options.executeAnalysis } : {}),
    },
  };
}

function post(
  store: AfcProductionStore,
  generationId: string,
  body: unknown,
  options: Parameters<typeof dependencies>[1] = {},
) {
  const wired = dependencies(store, options);
  return {
    calls: wired.calls,
    response: handleManualPerspectiveRecoveryPost({
      request: new Request("http://local/recover", {
        method: "POST",
        body: JSON.stringify(body),
      }),
      caseId: CASE_ID,
      generationId,
      dependencies: wired.value,
    }),
  };
}

test("manual geometry authority is accepted and an unapproved authority is not", async () => {
  assert.equal(
    acceptedAfcGeometryAuthority(
      "manual_source_quad",
      "manual-source-quad/v1",
    ),
    true,
  );
  assert.equal(
    acceptedAfcGeometryAuthority(
      "tiled_perspective_reader",
      "afc-sr1-tiled-perspective-reader/s1",
    ),
    true,
  );
  assert.equal(
    acceptedAfcGeometryAuthority(
      "manual_source_quad",
      "afc-sr1-tiled-perspective-reader/s1",
    ),
    false,
  );
  assert.equal(acceptedAfcGeometryAuthority("supported_domain_near_side_derived", "nope"), false);
  const quad = [QUAD.NL, QUAD.NR, QUAD.FR, QUAD.FL];
  const rejected = await freezeAppliedTiledAfcCamera({
    appliedSnapshot: {
      sourceFloorPolygon: quad,
    } as never,
    liveResult: {
      status: "authoritative_geometry",
      geometry: {
        mode: "tiled-perspective-core",
        geometryAuthority: "supported_domain_near_side_derived",
        sourceNormalizedPolygon: quad,
        tiledPerspective: { readerVersion: "afc-sr1-tiled-perspective-reader/s1" },
      },
      metric: { perspectiveAuthority: "tiled_perspective_core" },
    } as unknown as AfcSr1LiveAuthoritativeGeometry,
    pending: {} as never,
    settle: {} as never,
    candidate: {} as never,
    candidateEvaluation: {} as never,
    basisQualified: true,
    frozenAtIso: "2026-09-30T17:00:00.000Z",
    perspectiveAdjustment: null,
  });
  assert.equal(rejected.ok, false);
  if (rejected.ok) return;
  assert.equal(rejected.reason, "tiled_provenance_unavailable");
});

test("failed generation with reusable artifacts and a valid quad is recoverable", async () => {
  assert.equal(manualPerspectiveImageQuadValid(QUAD), true);
  const store = await seedRoom();
  const failed = await seedFailed(store);
  const currentBefore = (await store.getRoom(ROOM_ID))?.currentAfcGenerationId;
  const wired = dependencies(store);
  const response = await handleManualPerspectiveRecoveryGet({
    request: new Request("http://local/recover"),
    caseId: CASE_ID,
    generationId: failed.id,
    dependencies: wired.value,
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.eligible, true);
  assert.equal((await store.getRoom(ROOM_ID))?.currentAfcGenerationId, currentBefore);
});

test("missing EMPTY, missing TILED, SHA mismatch, invalid quad, and non-QA are refused", async () => {
  const store = await seedRoom();
  const failed = await seedFailed(store);
  let createdDuringRefusal = 0;
  const originalCreate = store.createGeneration.bind(store);
  store.createGeneration = async (input) => {
    createdDuringRefusal += 1;
    return originalCreate(input);
  };

  const missingEmpty = await seedFailed(store, { empty: false });
  const emptyResponse = await post(store, missingEmpty.id, { imagePoints: QUAD }).response;
  assert.equal(emptyResponse.status, 409);
  assert.equal((await emptyResponse.json()).code, "empty_unavailable");

  const missingTiled = await seedFailed(store, { tiled: false });
  const tiledResponse = await post(store, missingTiled.id, { imagePoints: QUAD }).response;
  assert.equal(tiledResponse.status, 409);
  assert.equal((await tiledResponse.json()).code, "tiled_unavailable");

  const mismatch = await post(store, failed.id, { imagePoints: QUAD }, {
    bytes: Uint8Array.from([1, 2, 3, 4]),
  }).response;
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).code, "original_sha_mismatch");

  const invalid = await post(store, failed.id, {
    imagePoints: {
      NL: { x: 2, y: 0.9 },
      NR: { x: 0.9, y: 0.9 },
      FR: { x: 0.65, y: 0.55 },
      FL: { x: 0.35, y: 0.55 },
    },
  }).response;
  assert.equal(invalid.status, 409);
  assert.equal((await invalid.json()).code, "manual_quad_invalid");

  const denied = await post(store, failed.id, { imagePoints: QUAD }, { qa: false }).response;
  assert.equal(denied.status, 403);
  assert.equal(createdDuringRefusal, 2);
  assert.equal((await store.getRoom(ROOM_ID))?.currentAfcGenerationId === failed.id, false);
});

test("recovery creates a ready generation, reuses artifacts, skips the reader, and promotes once", async () => {
  const store = await seedRoom();
  const failed = await seedFailed(store);
  const sourceBefore = stable(await store.getGeneration(failed.id));
  const currentBefore = (await store.getRoom(ROOM_ID))?.currentAfcGenerationId;
  let currentAtCreate: string | null = "unset";
  const originalCreate = store.createGeneration.bind(store);
  store.createGeneration = async (input) => {
    const created = await originalCreate(input);
    currentAtCreate = (await store.getRoom(ROOM_ID))?.currentAfcGenerationId ?? null;
    return created;
  };
  const submitted = post(store, failed.id, { imagePoints: QUAD });
  const response = await submitted.response;
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.created, true);
  assert.equal(body.status, "ready");
  assert.notEqual(body.generationId, failed.id);
  assert.equal(currentAtCreate, currentBefore);
  assert.equal(body.currentGenerationId, body.generationId);
  assert.equal(submitted.calls.empty, 0);
  assert.equal(submitted.calls.tiled, 0);
  assert.equal(submitted.calls.reader, 0);
  assert.equal(submitted.calls.observeRoom, 1);
  assert.equal(submitted.calls.metricPrior, 1);
  assert.equal(body.timings.tiledPerspectiveReaderCalls, 0);
  assert.equal(body.timings.emptyRegenerationCalls, 0);
  assert.equal(body.timings.tiledRegenerationCalls, 0);
  assert.equal(body.provenance.geometryAuthority, "manual_source_quad");
  assert.equal(body.provenance.recoveryIntent, "manual_perspective_recovery");
  assert.equal(body.provenance.sourceGenerationId, failed.id);
  assert.equal(body.provenance.qaUserId, QA_USER_ID);
  assert.deepEqual(stable(await store.getGeneration(failed.id)), sourceBefore);

  const recovered = await store.getGeneration(body.generationId);
  assert.ok(recovered);
  assert.equal(recovered.status, "ready");
  assert.equal(recovered.parentGenerationId, failed.id);
  assert.ok(recovered.lineageSeq > failed.lineageSeq);
  assert.equal(recovered.intent, "run_again");
  assert.equal(recovered.manualPerspective, null);
  assert.equal(recovered.emptyArtifactSource, "durable");
  assert.equal(recovered.tiledArtifactSource, "durable");
  assert.equal(recovered.tiledForceRegeneration, false);
  assert.equal(recovered.providerProvenance.readerRerun, false);
  assert.equal(recovered.providerProvenance.geometryAuthority, "manual_source_quad");
  assert.equal(isAfcV2ProductionRoomAuthority(recovered.productionAuthority), true);
  if (!isAfcV2ProductionRoomAuthority(recovered.productionAuthority)) return;
  assert.deepEqual(
    recovered.productionAuthority.floor.sourceNormalizedPolygon.map((point) => ({
      x: point.x,
      y: point.y,
    })),
    [QUAD.NL, QUAD.NR, QUAD.FR, QUAD.FL],
  );
  assert.equal(recovered.productionAuthority.tiled.readerVersion, null);
  assert.equal(JSON.stringify(recovered.productionAuthority).includes("manual_perspective_recovery"), false);
  assert.equal(recovered.metricDecision == null, false);
  assert.equal(Number.isFinite(recovered.productionAuthority.metric.metricScale), true);
  assert.equal(
    recovered.productionAuthority.metric.metricScale,
    recovered.productionAuthority.metric.autoMetricScale,
  );
  assert.notEqual(recovered.collisionStatus, "none");
  const diagnostic = recovered.diagnosticPayload as {
    executionCounts?: {
      tiledFloorReader?: number;
      roomObserver?: number;
      focusedSideCeilingObserver?: number;
      focusedSideFloorWallObserver?: number;
    };
  };
  assert.equal(diagnostic.executionCounts?.tiledFloorReader, 0);
  assert.equal(diagnostic.executionCounts?.roomObserver, 1);
  assert.equal(diagnostic.executionCounts?.focusedSideCeilingObserver, 1);
  assert.equal(diagnostic.executionCounts?.focusedSideFloorWallObserver, 1);
  const lineage = recovered.artifactLineage as { reader?: { status?: string | null; readerVersion?: string | null } };
  assert.equal(lineage?.reader?.readerVersion ?? null, null);
  assert.equal(lineage?.reader?.status ?? null, null);
  assert.equal(typeof body.timings.calibrationMs, "number");
  assert.ok(body.timings.analysisMs > 0);
});

test("a failed recovery stays immutable and a retry creates another generation", async () => {
  const store = await seedRoom();
  const failed = await seedFailed(store);
  const currentBefore = (await store.getRoom(ROOM_ID))?.currentAfcGenerationId;
  const first = await post(store, failed.id, { imagePoints: QUAD }, {
    executeAnalysis: async () => {
      throw new Error("forced downstream failure");
    },
  }).response;
  assert.equal(first.status, 422);
  const firstBody = await first.json();
  assert.equal(firstBody.created, true);
  assert.equal(firstBody.status, "failed");
  assert.equal(firstBody.currentGenerationId, currentBefore);
  const failedRecovery = await store.getGeneration(firstBody.generationId);
  assert.equal(failedRecovery?.status, "failed");
  assert.equal(failedRecovery?.productionAuthority, null);
  assert.equal((await store.getGeneration(failed.id))?.status, "failed");

  const second = await post(store, failed.id, { imagePoints: QUAD }).response;
  const secondBody = await second.json();
  assert.equal(second.status, 200, JSON.stringify(secondBody));
  assert.notEqual(secondBody.generationId, firstBody.generationId);
  assert.equal(secondBody.currentGenerationId, secondBody.generationId);
  assert.equal((await store.getGeneration(firstBody.generationId))?.status, "failed");
  assert.equal((await store.getGeneration(firstBody.generationId))?.productionAuthority, null);
});

test("an old generation scene does not load into the recovered generation", () => {
  const compatibility = resolvePersistedSceneCompatibility({
    storedAfcGenerationId: "11111111-1111-4111-8111-111111111111",
    currentAfcGenerationId: "22222222-2222-4222-8222-222222222222",
  });
  assert.equal(compatibility.ok, false);
  if (compatibility.ok) return;
  assert.equal(compatibility.reason, "afc_generation_mismatch");
  const recovery = readFileSync(
    path.join(process.cwd(), "lib/afc-v2-diagnostics/manual-perspective-recovery.server.ts"),
    "utf8",
  );
  assert.doesNotMatch(recovery, /createInheritedChildScene|effective-floor-remap|effectiveFloorRemap/);
  const adapter = readFileSync(
    path.join(process.cwd(), "lib/afc-v2-production/production-adapter.server.ts"),
    "utf8",
  );
  assert.match(adapter, /manualSourceQuad: recovery\.manualSourceQuad/);
  assert.doesNotMatch(adapter, /createInheritedChildScene/);
});

function stable(generation: AfcGenerationRecord | null) {
  return {
    id: generation?.id,
    status: generation?.status,
    productionAuthority: generation?.productionAuthority,
    settleDecision: generation?.settleDecision,
    diagnosticPayload: generation?.diagnosticPayload,
    failureReason: generation?.failureReason,
    manualPerspective: generation?.manualPerspective,
    recoveryProvenance: generation?.recoveryProvenance,
  };
}
