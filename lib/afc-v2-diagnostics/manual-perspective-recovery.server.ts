/**
 * AFR-4C manual perspective recovery.
 *
 * A failed generation stays unchanged. Recovery creates a new generation,
 * reuses that row's ORIGINAL / EMPTY / TILED bytes, and injects the human
 * quad as manual_source_quad. The TILED perspective reader is not called.
 */

import "server-only";

import { attachAfcDiagnosticSessionBestEffort } from "@/lib/afc-v2-diagnostics/session-attach.server";
import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import {
  buildAfcSr1TiledArtifactCacheKey,
  type AfcSr1GeneratedTiledArtifact,
} from "@/app/admin/3d-room-lab/afc-sr1-tiled-artifact-cache";
import { classifyAfcR3cImagePairCompatibility } from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";
import {
  AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
  AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
  AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
  AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
} from "@/app/admin/3d-room-lab/research/afc-sr1-tile-grid-scaffold";
import { validateAfcSr1TiledPerspectiveExactGridLineage } from "@/app/admin/3d-room-lab/research/afc-sr1-tiled-perspective-exact-grid-lineage";
import type { AfcV2AnalysisDependencies } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import {
  runProductionAfcAnalysis,
  type ProductionAfcGenerationCreated,
} from "@/lib/afc-v2-production/production-adapter.server";
import { durableArtifactBytesMatch, sha256Hex } from "@/lib/afc-v2-production/production-artifact-integrity";
import { MANUAL_SOURCE_QUAD_GEOMETRY_AUTHORITY } from "@/lib/afc-v2-production/manual-source-quad";
import {
  createProductionAfcStoreFromEnv,
  loadOwnedOriginalForProductionAnalysis,
} from "@/lib/afc-v2-production/production-persistence.server";
import type { AfcGenerationRecord, AfcProductionStore, AfcStoredImageIdentity } from "@/lib/afc-v2-production/production-store";
import {
  quadFromImagePoints,
  manualPerspectiveImageQuadValid,
  type ManualPerspectiveImagePoints,
} from "./manual-perspective-geometry";
import {
  parseManualPerspectiveImagePoints,
} from "./manual-perspective";
import {
  createSupabaseManualPerspectiveStore,
  type ManualPerspectiveGenerationRow,
  type ManualPerspectiveRouteDependencies,
  type ManualPerspectiveStore,
} from "./manual-perspective.server";
import { resolveAfcQaCapability } from "./qa-capability.server";
import {
  afcDiagnosticsAdminJson,
  authorizeAfcDiagnosticsAdmin,
} from "./admin-auth.server";
import {
  assertAfcDiagnosticAdminPayloadPrivacy,
  parseAfcDiagnosticAdminUuid,
} from "./admin-read-model";

export const MANUAL_PERSPECTIVE_RECOVERY_SCHEMA_VERSION =
  "afc-v2-manual-perspective-recovery/v1" as const;
export const MANUAL_PERSPECTIVE_RECOVERY_INTENT =
  "manual_perspective_recovery" as const;

export const MANUAL_PERSPECTIVE_RECOVERY_REFUSALS = [
  "source_not_failed",
  "frame_unavailable",
  "manual_quad_invalid",
  "original_sha_mismatch",
  "original_unavailable",
  "empty_unavailable",
  "tiled_unavailable",
  "artifact_identity_mismatch",
  "tiled_lineage_invalid",
  "room_mismatch",
] as const;

export type ManualPerspectiveRecoveryRefusal =
  (typeof MANUAL_PERSPECTIVE_RECOVERY_REFUSALS)[number];

const REFUSAL_MESSAGE: Record<ManualPerspectiveRecoveryRefusal, string> = {
  source_not_failed: "Recovery requires a failed generation.",
  frame_unavailable: "No usable image frame.",
  manual_quad_invalid: "Manual quad is not a valid floor polygon.",
  original_sha_mismatch: "Room image no longer matches this generation.",
  original_unavailable: "ORIGINAL image is unavailable.",
  empty_unavailable: "EMPTY artifact is not reusable.",
  tiled_unavailable: "TILED artifact is not reusable.",
  artifact_identity_mismatch: "Stored artifact bytes do not match the generation identity.",
  tiled_lineage_invalid: "EMPTY and TILED are not an exact-grid pair.",
  room_mismatch: "Generation does not belong to this room.",
};

export type ManualPerspectiveRecoveryProvenance = Readonly<{
  schemaVersion: typeof MANUAL_PERSPECTIVE_RECOVERY_SCHEMA_VERSION;
  recoveryIntent: typeof MANUAL_PERSPECTIVE_RECOVERY_INTENT;
  sourceGenerationId: string;
  qaUserId: string;
  recoveredAt: string;
  geometryAuthority: typeof MANUAL_SOURCE_QUAD_GEOMETRY_AUTHORITY;
  manualSourceQuad: ReturnType<typeof quadFromImagePoints>;
  appliedSourceQuad: ReturnType<typeof quadFromImagePoints>;
  artifactReuse: Readonly<{
    originalSha256: string;
    emptySha256: string;
    tiledSha256: string;
    reusedFromGenerationId: string;
  }>;
}>;

export type ManualPerspectiveRecoveryTimings = Readonly<{
  artifactLoadMs: number;
  calibrationMs: number | null;
  analysisMs: number;
  totalMs: number;
  tiledPerspectiveReaderCalls: 0;
  emptyRegenerationCalls: 0;
  tiledRegenerationCalls: 0;
}>;

export type ManualPerspectiveRecoveryDependencies = ManualPerspectiveRouteDependencies &
  Readonly<{
    productionStore?: AfcProductionStore;
    getProductionStore?: () => AfcProductionStore | null;
    loadOriginal?: (input: Readonly<{
      userId: string;
      roomId: string;
    }>) => Promise<
      | { ok: true; bytes: Uint8Array; sourceImageUrl: string }
      | { ok: false }
    >;
    validateTiledLineage?: typeof validateAfcSr1TiledPerspectiveExactGridLineage;
    analyze?: typeof runProductionAfcAnalysis;
    executeAnalysis?: NonNullable<Parameters<typeof runProductionAfcAnalysis>[0]["analyze"]>;
    analysisDependencies?: AfcV2AnalysisDependencies;
    onGenerationCreated?: (
      created: ProductionAfcGenerationCreated,
    ) => Promise<unknown> | unknown;
  }>;

type LoadedRecovery = Readonly<{
  generation: AfcGenerationRecord;
  originalBytes: Uint8Array;
  sourceImageUrl: string;
  emptyBytes: Uint8Array;
  tiledBytes: Uint8Array;
  artifactLoadMs: number;
}>;

export function manualPerspectiveRecoveryMessage(
  refusal: ManualPerspectiveRecoveryRefusal,
): string {
  return REFUSAL_MESSAGE[refusal];
}

export async function handleManualPerspectiveRecoveryGet(input: {
  request: Request;
  caseId: string;
  generationId: string;
  dependencies?: ManualPerspectiveRecoveryDependencies;
}) {
  const ready = await authorizeRecovery(input.request, input.dependencies);
  if (!ready.ok) return ready.response;
  const ids = parseIds(input.caseId, input.generationId);
  if (!ids) return json({ error: "Not found." }, 404);
  try {
    const loaded = await loadRecoveryArtifacts({
      caseId: ids.caseId,
      generationId: ids.generationId,
      dependencies: input.dependencies,
      manualStore: ready.manualStore,
      productionStore: ready.productionStore,
    });
    if (!loaded.ok) {
      if (loaded.refusal === "room_mismatch") return json({ error: "Not found." }, 404);
      const payload = {
        eligible: false as const,
        blocker: manualPerspectiveRecoveryMessage(loaded.refusal),
        code: loaded.refusal,
      };
      assertAfcDiagnosticAdminPayloadPrivacy(payload);
      return json(payload, 200);
    }
    const refusal = artifactRefusal(loaded.value.generation, null);
    const payload = refusal
      ? {
        eligible: false as const,
        blocker: manualPerspectiveRecoveryMessage(refusal),
        code: refusal,
      }
      : { eligible: true as const, blocker: null, code: null };
    assertAfcDiagnosticAdminPayloadPrivacy(payload);
    return json(payload, 200);
  } catch {
    return json({ error: "Server error." }, 500);
  }
}

export async function handleManualPerspectiveRecoveryPost(input: {
  request: Request;
  caseId: string;
  generationId: string;
  dependencies?: ManualPerspectiveRecoveryDependencies;
}) {
  const ready = await authorizeRecovery(input.request, input.dependencies);
  if (!ready.ok) return ready.response;
  const ids = parseIds(input.caseId, input.generationId);
  if (!ids) return json({ error: "Not found." }, 404);
  let body: unknown;
  try {
    body = await input.request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const imagePoints = parseRecoveryBody(body);
  if (!imagePoints || !manualPerspectiveImageQuadValid(imagePoints)) {
    return refusalResponse("manual_quad_invalid");
  }
  const started = nowMs();
  try {
    const loaded = await loadRecoveryArtifacts({
      caseId: ids.caseId,
      generationId: ids.generationId,
      dependencies: input.dependencies,
      manualStore: ready.manualStore,
      productionStore: ready.productionStore,
    });
    if (!loaded.ok) return refusalResponse(loaded.refusal);
    const generation = loaded.value.generation;
    const refusal = artifactRefusal(generation, imagePoints);
    if (refusal) return refusalResponse(refusal);
    const originalSha = sha256Hex(loaded.value.originalBytes);
    if (
      !generation.original ||
      originalSha !== generation.original.sha256 ||
      generation.original.byteCount !== loaded.value.originalBytes.byteLength
    ) {
      return refusalResponse("original_sha_mismatch");
    }
    if (!bytesMatch(loaded.value.emptyBytes, generation.empty)) {
      return refusalResponse("artifact_identity_mismatch");
    }
    if (!bytesMatch(loaded.value.tiledBytes, generation.tiled)) {
      return refusalResponse("artifact_identity_mismatch");
    }
    const tiled = reusedTiledArtifact({
      empty: generation.empty!,
      tiled: generation.tiled!,
      tiledBytes: loaded.value.tiledBytes,
      runId: generation.id,
      generatedAt: isoOrNow(generation.createdAt, input.dependencies?.now),
    });
    if (!tiled) return refusalResponse("tiled_lineage_invalid");
    const validateLineage = input.dependencies?.validateTiledLineage ??
      validateAfcSr1TiledPerspectiveExactGridLineage;
    try {
      await validateLineage(tiled, loaded.value.emptyBytes, loaded.value.tiledBytes);
    } catch {
      return refusalResponse("tiled_lineage_invalid");
    }
    const recoveredAt = input.dependencies?.now?.() ?? new Date().toISOString();
    const quad = quadFromImagePoints(imagePoints);
    const provenance: ManualPerspectiveRecoveryProvenance = Object.freeze({
      schemaVersion: MANUAL_PERSPECTIVE_RECOVERY_SCHEMA_VERSION,
      recoveryIntent: MANUAL_PERSPECTIVE_RECOVERY_INTENT,
      sourceGenerationId: generation.id,
      qaUserId: ready.qaUserId,
      recoveredAt,
      geometryAuthority: MANUAL_SOURCE_QUAD_GEOMETRY_AUTHORITY,
      manualSourceQuad: quad,
      appliedSourceQuad: quad,
      artifactReuse: Object.freeze({
        originalSha256: generation.original.sha256,
        emptySha256: generation.empty!.sha256,
        tiledSha256: generation.tiled!.sha256,
        reusedFromGenerationId: generation.id,
      }),
    });
    const beforeIds = generation.id;
    const sourceBefore = await ready.productionStore.getGeneration(beforeIds);
    let calibrationMs: number | null = null;
    const analysisStarted = nowMs();
    const callerDependencies = input.dependencies?.analysisDependencies;
    const run = input.dependencies?.analyze ?? runProductionAfcAnalysis;
    const result = await run({
      roomId: generation.roomId,
      userId: generation.userId,
      store: ready.productionStore,
      original: {
        bytes: loaded.value.originalBytes,
        sourceImageUrl: loaded.value.sourceImageUrl,
        identity: generation.original,
      },
      analysisDependencies: {
        ...callerDependencies,
        onTiledFloorCameraApplied: (applied) => {
          calibrationMs = nowMs() - analysisStarted;
          callerDependencies?.onTiledFloorCameraApplied?.(applied);
        },
        product: {
          ...callerDependencies?.product,
          validateTiledLineage: validateLineage,
        },
      },
      ...(input.dependencies?.executeAnalysis
        ? { analyze: input.dependencies.executeAnalysis }
        : {}),
      onGenerationCreated: input.dependencies?.onGenerationCreated ??
        attachAfcDiagnosticSessionBestEffort,
      recovery: {
        sourceGenerationId: generation.id,
        provenance,
        empty: {
          basis: generation.empty!,
          bytes: loaded.value.emptyBytes,
        },
        tiled: {
          result: tiled,
          bytes: loaded.value.tiledBytes,
          cacheKey: generation.tiledCacheKey ?? buildAfcSr1TiledArtifactCacheKey({
            emptySha256: generation.empty!.sha256,
          }),
        },
        manualSourceQuad: quad,
      },
    });
    const sourceAfter = await ready.productionStore.getGeneration(beforeIds);
    if (stableGeneration(sourceBefore) !== stableGeneration(sourceAfter)) {
      throw new Error("Failed source generation changed during recovery.");
    }
    const analysisMs = nowMs() - analysisStarted;
    const payload = {
      created: result.generationId !== null && result.generationId !== generation.id,
      status: result.status,
      generationId: result.generationId,
      currentGenerationId: result.currentGenerationId,
      failureReason: result.failureReason,
      sourceGenerationId: generation.id,
      provenance: {
        sourceGenerationId: provenance.sourceGenerationId,
        recoveryIntent: provenance.recoveryIntent,
        geometryAuthority: provenance.geometryAuthority,
        manualSourceQuad: provenance.manualSourceQuad,
        appliedSourceQuad: provenance.appliedSourceQuad,
        qaUserId: provenance.qaUserId,
        recoveredAt: provenance.recoveredAt,
        artifactReuse: provenance.artifactReuse,
      },
      timings: {
        artifactLoadMs: loaded.value.artifactLoadMs,
        calibrationMs,
        analysisMs,
        totalMs: nowMs() - started,
        tiledPerspectiveReaderCalls: 0 as const,
        emptyRegenerationCalls: 0 as const,
        tiledRegenerationCalls: 0 as const,
      } satisfies ManualPerspectiveRecoveryTimings,
    };
    assertAfcDiagnosticAdminPayloadPrivacy(payload);
    return json(payload, result.status === "ready" ? 200 : 422);
  } catch {
    return json({ error: "Server error." }, 500);
  }
}

function refusalResponse(refusal: ManualPerspectiveRecoveryRefusal) {
  const payload = {
    created: false as const,
    error: manualPerspectiveRecoveryMessage(refusal),
    code: refusal,
  };
  assertAfcDiagnosticAdminPayloadPrivacy(payload);
  return json(payload, refusal === "room_mismatch" ? 404 : 409);
}

function artifactRefusal(
  generation: AfcGenerationRecord,
  imagePoints: ManualPerspectiveImagePoints | null,
): ManualPerspectiveRecoveryRefusal | null {
  if (generation.status !== "failed") return "source_not_failed";
  if (!usableFrame(generation)) return "frame_unavailable";
  if (!generation.original) return "original_unavailable";
  if (!generation.empty || !generation.emptyStoragePath) return "empty_unavailable";
  if (
    !generation.tiled ||
    !generation.tiledStoragePath ||
    generation.tiled.mimeType !== "image/png"
  ) {
    return "tiled_unavailable";
  }
  if (imagePoints && !manualPerspectiveImageQuadValid(imagePoints)) {
    return "manual_quad_invalid";
  }
  return null;
}

function usableFrame(generation: AfcGenerationRecord): boolean {
  const frame = generation.frame;
  const original = generation.original;
  return Boolean(
    frame &&
    original &&
    frame.width > 0 &&
    frame.height > 0 &&
    original.decodedWidth === frame.width &&
    original.decodedHeight === frame.height,
  );
}

function bytesMatch(
  bytes: Uint8Array,
  identity: AfcStoredImageIdentity | null,
): identity is AfcStoredImageIdentity {
  if (!identity) return false;
  return durableArtifactBytesMatch({
    bytes,
    sha256: identity.sha256,
    byteCount: identity.byteCount,
  });
}

export function reusedTiledArtifact(input: Readonly<{
  empty: AfcStoredImageIdentity;
  tiled: AfcStoredImageIdentity;
  tiledBytes: Uint8Array;
  runId: string;
  generatedAt: string;
}>): AfcSr1GeneratedTiledArtifact | null {
  if (input.tiled.mimeType !== "image/png") return null;
  const empty = identityRecord(input.empty);
  const tiled = identityRecord(input.tiled);
  return Object.freeze({
    status: "generated" as const,
    input: empty,
    tiled: Object.freeze({
      base64: Buffer.from(input.tiledBytes).toString("base64"),
      identity: Object.freeze({
        ...tiled,
        mimeType: "image/png" as const,
      }),
    }),
    provenance: Object.freeze({
      generatorId: AFC_SR1_TILE_GRID_SCAFFOLD_GENERATOR_ID,
      profileId: AFC_SR1_TILE_GRID_SCAFFOLD_PROFILE,
      researchPreset: AFC_SR1_TILE_GRID_SCAFFOLD_PRESET,
      requestedModelId: AFC_SR1_TILE_GRID_SCAFFOLD_REQUESTED_MODEL_ID,
      runId: input.runId,
      generatedAt: input.generatedAt,
      appliedAspectRatio: null,
      imageTransport: "data_url" as const,
      generationStatus: "generated" as const,
    }),
    compatibility: classifyAfcR3cImagePairCompatibility(
      {
        fingerprint: empty.sha256,
        decodedWidth: empty.decodedWidth,
        decodedHeight: empty.decodedHeight,
        orientation: empty.orientation,
      },
      {
        fingerprint: tiled.sha256,
        decodedWidth: tiled.decodedWidth,
        decodedHeight: tiled.decodedHeight,
        orientation: tiled.orientation,
      },
    ),
  });
}

function identityRecord(identity: AfcStoredImageIdentity) {
  return Object.freeze({
    sha256: identity.sha256,
    byteCount: identity.byteCount,
    decodedWidth: identity.decodedWidth,
    decodedHeight: identity.decodedHeight,
    mimeType: identity.mimeType,
    orientation: identity.orientation,
  });
}

async function loadRecoveryArtifacts(input: {
  caseId: string;
  generationId: string;
  dependencies: ManualPerspectiveRecoveryDependencies | undefined;
  manualStore: ManualPerspectiveStore;
  productionStore: AfcProductionStore;
}): Promise<
  | { ok: true; value: LoadedRecovery }
  | { ok: false; refusal: ManualPerspectiveRecoveryRefusal }
> {
  const started = nowMs();
  const visible = await input.manualStore.loadGeneration(input.caseId, input.generationId);
  if (!visible || visible.id !== input.generationId) {
    return { ok: false, refusal: "room_mismatch" };
  }
  const generation = await input.productionStore.getGeneration(input.generationId);
  if (
    !generation ||
    generation.id !== visible.id ||
    generation.roomId !== visible.roomId ||
    generation.userId !== visible.userId
  ) {
    return { ok: false, refusal: "room_mismatch" };
  }
  const loadOriginal = input.dependencies?.loadOriginal ?? defaultLoadOriginal;
  const original = await loadOriginal({
    userId: generation.userId,
    roomId: generation.roomId,
  });
  if (!original.ok) return { ok: false, refusal: "original_unavailable" };
  if (!generation.emptyStoragePath) return { ok: false, refusal: "empty_unavailable" };
  if (!generation.tiledStoragePath) return { ok: false, refusal: "tiled_unavailable" };
  const emptyBytes = await input.productionStore.getArtifact(generation.emptyStoragePath);
  const tiledBytes = await input.productionStore.getArtifact(generation.tiledStoragePath);
  if (!emptyBytes) return { ok: false, refusal: "empty_unavailable" };
  if (!tiledBytes) return { ok: false, refusal: "tiled_unavailable" };
  return {
    ok: true,
    value: {
      generation,
      originalBytes: original.bytes,
      sourceImageUrl: original.sourceImageUrl,
      emptyBytes,
      tiledBytes,
      artifactLoadMs: nowMs() - started,
    },
  };
}

async function defaultLoadOriginal(input: Readonly<{ userId: string; roomId: string }>) {
  const store = createProductionAfcStoreFromEnv();
  const service = getServiceRoleSupabaseClient();
  if (!store || !service) return { ok: false as const };
  const room = await store.getRoom(input.roomId);
  if (!room || room.userId !== input.userId) return { ok: false as const };
  return loadOwnedOriginalForProductionAnalysis(service, {
    userId: input.userId,
    room,
  });
}

async function authorizeRecovery(
  request: Request,
  dependencies: ManualPerspectiveRecoveryDependencies | undefined,
): Promise<
  | {
    ok: true;
    qaUserId: string;
    manualStore: ManualPerspectiveStore;
    productionStore: AfcProductionStore;
  }
  | { ok: false; response: Response }
> {
  const authorize = dependencies?.authorize ?? authorizeAfcDiagnosticsAdmin;
  const auth = await authorize(dependencies?.authorizeOptions);
  if (!auth.ok) return { ok: false, response: auth.response };
  const capability = resolveAfcQaCapability(auth.admin.userId, dependencies?.env);
  if (!capability.enabled) {
    return { ok: false, response: json({ error: "QA access required." }, 403) };
  }
  try {
    const manualStore = resolveManualStore(dependencies);
    const productionStore = dependencies?.productionStore ??
      dependencies?.getProductionStore?.() ??
      createProductionAfcStoreFromEnv();
    if (!productionStore) {
      return { ok: false, response: json({ error: "Server error." }, 500) };
    }
    return {
      ok: true,
      qaUserId: auth.admin.userId,
      manualStore,
      productionStore,
    };
  } catch {
    return { ok: false, response: json({ error: "Server error." }, 500) };
  }
}

function resolveManualStore(
  dependencies: ManualPerspectiveRecoveryDependencies | undefined,
): ManualPerspectiveStore {
  if (dependencies?.store) return dependencies.store;
  const created = dependencies?.getStore?.() ?? null;
  if (created) return created;
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) throw new Error("Store error.");
  return createSupabaseManualPerspectiveStore(supabase);
}

function parseIds(caseId: string, generationId: string) {
  const parsedCase = parseAfcDiagnosticAdminUuid(caseId);
  const parsedGeneration = parseAfcDiagnosticAdminUuid(generationId);
  if (!parsedCase || !parsedGeneration) return null;
  return { caseId: parsedCase, generationId: parsedGeneration };
}

function parseRecoveryBody(value: unknown): ManualPerspectiveImagePoints | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("imagePoints" in record)) return null;
  return parseManualPerspectiveImagePoints(record.imagePoints);
}

function isoOrNow(value: string, now: (() => string) | undefined): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return now?.() ?? new Date().toISOString();
  const iso = new Date(parsed).toISOString();
  return iso === value ? value : now?.() ?? new Date().toISOString();
}

function nowMs(): number {
  return performance.now();
}

function stableGeneration(generation: AfcGenerationRecord | null): string {
  if (!generation) return "missing";
  return JSON.stringify({
    id: generation.id,
    status: generation.status,
    parentGenerationId: generation.parentGenerationId,
    lineageSeq: generation.lineageSeq,
    productionAuthority: generation.productionAuthority,
    settleDecision: generation.settleDecision,
    diagnosticPayload: generation.diagnosticPayload,
    failureReason: generation.failureReason,
    manualPerspective: generation.manualPerspective,
    recoveryProvenance: generation.recoveryProvenance,
    metricDecision: generation.metricDecision,
    cameraRealizability: generation.cameraRealizability,
    artifactLineage: generation.artifactLineage,
  });
}

function json(body: unknown, status: number) {
  return afcDiagnosticsAdminJson(body, status);
}
