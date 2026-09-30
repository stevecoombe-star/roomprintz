/**
 * AFR-4A manual-perspective read and apply.
 *
 * Admin authentication is required, then the existing QA capability gate.
 * Apply re-solves on the server and writes only `manual_perspective`.
 * Settle, camera-realizability, production authority, and artifact lineage
 * are not updated.
 */

import "server-only";

import { getServiceRoleSupabaseClient } from "@/lib/adminServer";
import { isAfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";
import { resolveEffectiveProductionAuthority } from "@/lib/afc-v2-runtime/effective-production-authority";

import {
  afcDiagnosticsAdminJson,
  authorizeAfcDiagnosticsAdmin,
  type AfcDiagnosticsAdminAuth,
  type AuthorizeAfcDiagnosticsAdminOptions,
} from "./admin-auth.server";
import {
  assertAfcDiagnosticAdminPayloadPrivacy,
  parseAfcDiagnosticAdminUuid,
} from "./admin-read-model";
import {
  AFC_DIAGNOSTIC_CASE_TABLE,
  AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE,
  AFC_DIAGNOSTIC_SESSION_TABLE,
} from "./contracts";
import {
  type AfcDiagnosticAwaitableQuery,
  type AfcDiagnosticFilterQuery,
  type AfcDiagnosticSelectHead,
  type AfcDiagnosticTableClient,
} from "./diagnostic-db-client";
import {
  buildManualPerspectiveRecord,
  parseManualPerspectiveImagePoints,
  parseManualPerspectiveRecord,
  parseManualPerspectiveRecoverySummary,
  readAutomaticPerspectiveBaseline,
  readManualPerspectiveBootstrap,
  selectLatestManualRecoveryQuad,
  type ManualPerspectiveAutomaticBaseline,
  type ManualPerspectiveBootstrap,
  type ManualPerspectiveRecord,
  type ManualPerspectiveRuntime,
  type ManualRecoveryQuadCandidate,
} from "./manual-perspective";
import { solveManualPerspectiveCalibration } from "./manual-perspective-solve";
import type { ManualPerspectiveImagePoints } from "./manual-perspective-geometry";
import {
  resolveAfcQaCapability,
  type AfcQaCapabilityEnv,
} from "./qa-capability.server";

export const AFC_GENERATION_TABLE = "vibode_afc_generations";

export const MANUAL_PERSPECTIVE_GENERATION_COLUMNS = [
  "id",
  "room_id",
  "user_id",
  "status",
  "frame_width",
  "frame_height",
  "original_decoded_width",
  "original_decoded_height",
  "production_authority",
  "settle_decision",
  "camera_realizability_decision",
  "artifact_lineage_decision",
  "manual_perspective",
  "recovery_provenance",
].join(", ");

export type ManualPerspectiveGenerationRow = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  status: string;
  frameWidth: number | null;
  frameHeight: number | null;
  originalDecodedWidth: number | null;
  originalDecodedHeight: number | null;
  productionAuthority: unknown;
  settleDecision: unknown;
  cameraRealizability: unknown;
  artifactLineage: unknown;
  manualPerspective: unknown;
  recoveryProvenance?: unknown;
}>;

export type ManualPerspectiveStore = {
  loadGeneration(
    caseId: string,
    generationId: string,
  ): Promise<ManualPerspectiveGenerationRow | null>;
  saveManualPerspective(
    generationId: string,
    record: ManualPerspectiveRecord,
  ): Promise<void>;
  /**
   * Recovery rows for this room owner. Absent on older test doubles;
   * the editor then keeps the default bootstrap quad.
   */
  listRecoveryAttempts?(input: {
    roomId: string;
    userId: string;
  }): Promise<readonly ManualRecoveryQuadCandidate[]>;
};

export type ManualPerspectiveRouteDependencies = Readonly<{
  authorize?: (
    options?: AuthorizeAfcDiagnosticsAdminOptions,
  ) => Promise<AfcDiagnosticsAdminAuth>;
  authorizeOptions?: AuthorizeAfcDiagnosticsAdminOptions;
  store?: ManualPerspectiveStore;
  getStore?: () => ManualPerspectiveStore | null;
  env?: AfcQaCapabilityEnv;
  now?: () => string;
}>;

export class ManualPerspectiveStoreError extends Error {
  readonly code = "store_error" as const;
  constructor() {
    super("Store error.");
    this.name = "ManualPerspectiveStoreError";
  }
}

export async function handleManualPerspectiveGet(input: {
  request: Request;
  caseId: string;
  generationId: string;
  dependencies?: ManualPerspectiveRouteDependencies;
}) {
  const ready = await authorizeQa(input.request, input.dependencies);
  if (!ready.ok) return ready.response;
  const caseId = parseAfcDiagnosticAdminUuid(input.caseId);
  const generationId = parseAfcDiagnosticAdminUuid(input.generationId);
  if (!caseId || !generationId) return json({ error: "Not found." }, 404);
  try {
    const generation = await ready.store.loadGeneration(caseId, generationId);
    if (!generation || generation.id !== generationId) return json({ error: "Not found." }, 404);
    const restored = await restoredRecoveryQuad(ready.store, generation);
    return json(viewPayload(generation, restored), 200);
  } catch {
    return json({ error: "Server error." }, 500);
  }
}

export async function handleManualPerspectivePost(input: {
  request: Request;
  caseId: string;
  generationId: string;
  dependencies?: ManualPerspectiveRouteDependencies;
}) {
  const ready = await authorizeQa(input.request, input.dependencies);
  if (!ready.ok) return ready.response;
  const caseId = parseAfcDiagnosticAdminUuid(input.caseId);
  const generationId = parseAfcDiagnosticAdminUuid(input.generationId);
  if (!caseId || !generationId) return json({ error: "Not found." }, 404);
  let body: unknown;
  try {
    body = await input.request.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }
  const requestedPoints = parseApplyBody(body);
  if (!requestedPoints) return json({ error: "Invalid request." }, 400);
  try {
    const generation = await ready.store.loadGeneration(caseId, generationId);
    if (!generation || generation.id !== generationId) return json({ error: "Not found." }, 404);
    const available = availabilityFromGeneration(generation);
    if (!available) return json({ error: "No usable image frame." }, 409);
    const solution = solveManualPerspectiveCalibration({
      imagePoints: requestedPoints,
      sourceImageSize: available.sourceImageSize,
      frameSize: available.frameSize,
      referenceDepthM: available.referenceDepthM,
    });
    const appliedAt = input.dependencies?.now?.() ?? new Date().toISOString();
    const record = buildManualPerspectiveRecord({
      generationId: available.generationId,
      referenceDepthM: available.referenceDepthM,
      origin: available.origin,
      originalPoints: available.originalPoints,
      initialBootstrapPoints: available.initialBootstrapPoints,
      solution,
      appliedAt,
    });
    if (!record) return json({ error: "Manual perspective is not realizable." }, 409);
    if (available.runtime !== "overlay") {
      return json({
        error: "Manual perspective cannot drive STAGE.",
        code: "diagnostic_only",
      }, 409);
    }
    if (!effectiveAuthorityAccepts(generation.productionAuthority, record)) {
      return json({ error: "Manual perspective is not realizable." }, 409);
    }
    await ready.store.saveManualPerspective(generationId, record);
    const payload = { applied: record };
    assertAfcDiagnosticAdminPayloadPrivacy(payload);
    return json(payload, 200);
  } catch {
    return json({ error: "Server error." }, 500);
  }
}

function viewPayload(
  generation: ManualPerspectiveGenerationRow,
  restoredQuad: ManualPerspectiveImagePoints | null = null,
) {
  const available = availabilityFromGeneration(generation);
  const parsed = parseManualPerspectiveRecord(generation.manualPerspective);
  const sourceManual = parsed.ok ? parsed.record : null;
  const restored = sourceManual ? null : restoredQuad;
  const payload = {
    qaEnabled: true as const,
    automatic: available?.origin === "automatic_quad_adjustment" && available.baseline
      ? publicBaseline(available.baseline)
      : null,
    bootstrap: available?.origin === "manual_quad_bootstrap"
      ? publicBootstrap(available.bootstrap, restored)
      : null,
    runtime: available?.runtime ?? "unavailable",
    applied: parsed.ok ? parsed.record : { kind: "unreadable" as const },
    recovery: publicRecovery(generation.recoveryProvenance),
  };
  assertAfcDiagnosticAdminPayloadPrivacy(payload);
  return payload;
}

function publicBootstrap(
  bootstrap: ManualPerspectiveBootstrap,
  restoredQuad: ManualPerspectiveImagePoints | null,
) {
  return {
    generationId: bootstrap.generationId,
    imagePoints: restoredQuad ?? bootstrap.imagePoints,
    referenceDepthM: bootstrap.referenceDepthM,
    sourceImageSize: bootstrap.sourceImageSize,
    frameSize: bootstrap.frameSize,
    runtime: bootstrap.runtime,
    restoredFromRecovery: restoredQuad != null,
  };
}

async function restoredRecoveryQuad(
  store: ManualPerspectiveStore,
  generation: ManualPerspectiveGenerationRow,
): Promise<ManualPerspectiveImagePoints | null> {
  const available = availabilityFromGeneration(generation);
  if (available?.origin !== "manual_quad_bootstrap") return null;
  const parsed = parseManualPerspectiveRecord(generation.manualPerspective);
  if (parsed.ok && parsed.record) return null;
  if (!store.listRecoveryAttempts) return null;
  const attempts = await store.listRecoveryAttempts({
    roomId: generation.roomId,
    userId: generation.userId,
  });
  return selectLatestManualRecoveryQuad(generation.id, attempts);
}

function publicRecovery(value: unknown) {
  if (!isRecord(value)) return null;
  const summary = parseManualPerspectiveRecoverySummary({
    sourceGenerationId: value.sourceGenerationId,
    recoveryIntent: value.recoveryIntent,
    geometryAuthority: value.geometryAuthority,
    qaUserId: value.qaUserId,
    recoveredAt: value.recoveredAt,
  });
  return summary;
}

function publicBaseline(baseline: ManualPerspectiveAutomaticBaseline) {
  return {
    generationId: baseline.generationId,
    imagePoints: baseline.imagePoints,
    widthDepthRatio: baseline.widthDepthRatio,
    verticalFovDeg: baseline.verticalFovDeg,
    worldWidthM: baseline.worldWidthM,
    referenceDepthM: baseline.referenceDepthM,
    sourceImageSize: baseline.sourceImageSize,
    frameSize: baseline.frameSize,
  };
}

function effectiveAuthorityAccepts(
  productionAuthority: unknown,
  record: ManualPerspectiveRecord,
): boolean {
  if (!isAfcV2ProductionRoomAuthority(productionAuthority)) return false;
  return resolveEffectiveProductionAuthority(productionAuthority, record).kind === "manual";
}

export function baselineFromGeneration(
  generation: ManualPerspectiveGenerationRow,
): ManualPerspectiveAutomaticBaseline | null {
  return readAutomaticPerspectiveBaseline({
    generationId: generation.id,
    status: generation.status,
    frameWidth: generation.frameWidth,
    frameHeight: generation.frameHeight,
    originalDecodedWidth: generation.originalDecodedWidth,
    originalDecodedHeight: generation.originalDecodedHeight,
    productionAuthority: generation.productionAuthority,
  });
}

function availabilityFromGeneration(generation: ManualPerspectiveGenerationRow) {
  const baseline = baselineFromGeneration(generation);
  const authority = generation.productionAuthority;
  const complete = isAfcV2ProductionRoomAuthority(authority);
  if (baseline) {
    const runtime: ManualPerspectiveRuntime = complete ? "overlay" : "diagnostic_only";
    return {
      generationId: baseline.generationId,
      sourceImageSize: baseline.sourceImageSize,
      frameSize: baseline.frameSize,
      referenceDepthM: baseline.referenceDepthM,
      runtime,
      origin: "automatic_quad_adjustment" as const,
      originalPoints: baseline.imagePoints,
      initialBootstrapPoints: null,
      baseline,
      bootstrap: null as ManualPerspectiveBootstrap | null,
    };
  }
  const bootstrap = readManualPerspectiveBootstrap({
    generationId: generation.id,
    frameWidth: generation.frameWidth,
    frameHeight: generation.frameHeight,
    originalDecodedWidth: generation.originalDecodedWidth,
    originalDecodedHeight: generation.originalDecodedHeight,
    productionAuthority: authority,
    authorityComplete: complete,
    authorityReferenceDepthM: complete ? authority.floor.referenceDepthM : null,
  });
  if (!bootstrap) return null;
  return {
    generationId: bootstrap.generationId,
    sourceImageSize: bootstrap.sourceImageSize,
    frameSize: bootstrap.frameSize,
    referenceDepthM: bootstrap.referenceDepthM,
    runtime: bootstrap.runtime,
    origin: "manual_quad_bootstrap" as const,
    originalPoints: null,
    initialBootstrapPoints: bootstrap.imagePoints,
    baseline: null,
    bootstrap,
  };
}

function parseApplyBody(value: unknown) {
  if (!isRecord(value) || !exactKeys(value, ["imagePoints"])) return null;
  return parseManualPerspectiveImagePoints(value.imagePoints);
}

async function authorizeQa(
  request: Request,
  dependencies: ManualPerspectiveRouteDependencies | undefined,
): Promise<
  | { ok: true; store: ManualPerspectiveStore }
  | { ok: false; response: Response }
> {
  const authorize = dependencies?.authorize ?? authorizeAfcDiagnosticsAdmin;
  const auth = await authorize(dependencies?.authorizeOptions);
  if (!auth.ok) return { ok: false, response: auth.response };
  const capability = resolveAfcQaCapability(auth.admin.userId, dependencies?.env);
  if (!capability.enabled) return { ok: false, response: json({ error: "QA access required." }, 403) };
  try {
    const store = resolveStore(dependencies);
    return { ok: true, store };
  } catch {
    return { ok: false, response: json({ error: "Server error." }, 500) };
  }
}

function resolveStore(
  dependencies: ManualPerspectiveRouteDependencies | undefined,
): ManualPerspectiveStore {
  if (dependencies?.store) return dependencies.store;
  const created = dependencies?.getStore?.() ?? null;
  if (created) return created;
  if (dependencies?.getStore) throw new ManualPerspectiveStoreError();
  const supabase = getServiceRoleSupabaseClient();
  if (!supabase) throw new ManualPerspectiveStoreError();
  return createSupabaseManualPerspectiveStore(supabase);
}

type SelectChain<S> = AfcDiagnosticFilterQuery<S, "eq" | "not" | "maybeSingle"> &
  AfcDiagnosticAwaitableQuery;
type UpdateChain<U> = AfcDiagnosticFilterQuery<U, "eq"> & AfcDiagnosticAwaitableQuery;

export function createSupabaseManualPerspectiveStore<
  S extends SelectChain<S>,
  U extends UpdateChain<U>,
>(
  supabase: AfcDiagnosticTableClient<
    AfcDiagnosticSelectHead<S> & {
      update(values: Record<string, unknown>): U;
    }
  >,
): ManualPerspectiveStore {
  return {
    async loadGeneration(caseId, generationId) {
      const caseRow = await maybeSingle(
        supabase.from(AFC_DIAGNOSTIC_CASE_TABLE).select("id, session_id, room_id").eq("id", caseId),
      );
      if (!isRecord(caseRow)) return null;
      const sessionId = typeof caseRow.session_id === "string" ? caseRow.session_id : null;
      const roomId = typeof caseRow.room_id === "string" ? caseRow.room_id : null;
      if (!sessionId || !roomId) return null;
      const session = await maybeSingle(
        supabase
          .from(AFC_DIAGNOSTIC_SESSION_TABLE)
          .select("id, user_id, room_id")
          .eq("id", sessionId),
      );
      if (!isRecord(session) || session.room_id !== roomId) return null;
      const membership = await maybeSingle(
        supabase
          .from(AFC_DIAGNOSTIC_SESSION_GENERATION_TABLE)
          .select("session_id, generation_id")
          .eq("session_id", sessionId)
          .eq("generation_id", generationId),
      );
      if (!isRecord(membership)) return null;
      const row = await maybeSingle(
        supabase
          .from(AFC_GENERATION_TABLE)
          .select(MANUAL_PERSPECTIVE_GENERATION_COLUMNS)
          .eq("id", generationId),
      );
      const generation = parseGenerationRow(row);
      if (!generation) return null;
      if (generation.roomId !== roomId.toLowerCase()) return null;
      if (generation.userId !== String(session.user_id).toLowerCase()) return null;
      return generation;
    },
    async saveManualPerspective(generationId, record) {
      const { error } = await supabase
        .from(AFC_GENERATION_TABLE)
        .update({ manual_perspective: record })
        .eq("id", generationId);
      if (error) throw new ManualPerspectiveStoreError();
    },
    async listRecoveryAttempts({ roomId, userId }) {
      const { data, error } = await supabase
        .from(AFC_GENERATION_TABLE)
        .select("id, lineage_seq, recovery_provenance")
        .eq("room_id", roomId)
        .eq("user_id", userId)
        .not("recovery_provenance", "is", null);
      if (error) throw new ManualPerspectiveStoreError();
      if (!Array.isArray(data)) return [];
      return data.flatMap((row) => {
        const attempt = parseRecoveryAttempt(row);
        return attempt ? [attempt] : [];
      });
    },
  };
}

async function maybeSingle(query: { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> }) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new ManualPerspectiveStoreError();
  return data;
}

function parseGenerationRow(row: unknown): ManualPerspectiveGenerationRow | null {
  if (!isRecord(row)) return null;
  const id = parseAfcDiagnosticAdminUuid(row.id);
  const roomId = parseAfcDiagnosticAdminUuid(row.room_id);
  const userId = parseAfcDiagnosticAdminUuid(row.user_id);
  if (!id || !roomId || !userId) return null;
  if (typeof row.status !== "string") return null;
  return Object.freeze({
    id,
    roomId,
    userId,
    status: row.status,
    frameWidth: nullableFinite(row.frame_width),
    frameHeight: nullableFinite(row.frame_height),
    originalDecodedWidth: nullableFinite(row.original_decoded_width),
    originalDecodedHeight: nullableFinite(row.original_decoded_height),
    productionAuthority: row.production_authority ?? null,
    settleDecision: row.settle_decision ?? null,
    cameraRealizability: row.camera_realizability_decision ?? null,
    artifactLineage: row.artifact_lineage_decision ?? null,
    manualPerspective: Object.prototype.hasOwnProperty.call(row, "manual_perspective")
      ? row.manual_perspective ?? null
      : null,
    recoveryProvenance: Object.prototype.hasOwnProperty.call(row, "recovery_provenance")
      ? row.recovery_provenance ?? null
      : null,
  });
}

function parseRecoveryAttempt(row: unknown): ManualRecoveryQuadCandidate | null {
  if (!isRecord(row)) return null;
  const generationId = parseAfcDiagnosticAdminUuid(row.id);
  const lineageSeq = typeof row.lineage_seq === "number"
    ? row.lineage_seq
    : typeof row.lineage_seq === "string"
      ? Number(row.lineage_seq)
      : Number.NaN;
  if (!generationId || !Number.isFinite(lineageSeq)) return null;
  return {
    generationId,
    lineageSeq,
    recoveryProvenance: row.recovery_provenance ?? null,
  };
}

function nullableFinite(value: unknown): number | null {
  if (value == null) return null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function json(body: unknown, status: number) {
  const response = afcDiagnosticsAdminJson(body, status);
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
