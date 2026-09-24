/**
 * AFD-4A admin diagnostics DTO contracts, query parsing, and strict mappers.
 *
 * Admin inspection types only. Not tester browser-safe DTOs, not a second
 * AFC authority layer, and not a mutation API.
 */

import {
  isAfcDiagnosticCaseTrigger,
  isAfcDiagnosticMachineStatusSnapshot,
  isAfcDiagnosticReviewStatus,
  isAfcDiagnosticSessionIntent,
  isAfcDiagnosticSessionStatus,
  type AfcDiagnosticCaseTrigger,
  type AfcDiagnosticMachineStatusSnapshot,
  type AfcDiagnosticReviewStatus,
  type AfcDiagnosticSessionIntent,
  type AfcDiagnosticSessionStatus,
} from "./contracts";
import {
  mapAfcDiagnosticAdminLegacyMetricConclusion,
  mapAfcDiagnosticAdminMetricDecision,
} from "./admin-metric-decision";
import type {
  AfcDiagnosticAdminLegacyMetricConclusion,
  AfcDiagnosticAdminMetricDecision,
} from "./admin-metric-decision-dto";
import { isAfcQaIssueCode } from "./taxonomy";

export const AFC_DIAGNOSTIC_ADMIN_CASE_LIST_DEFAULT_LIMIT = 25;
export const AFC_DIAGNOSTIC_ADMIN_CASE_LIST_MAX_LIMIT = 50;

export const AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION_V1 =
  "afc-v2-engine-fingerprint/v1" as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UNSAFE_CURSOR_TIMESTAMP_CHARS = /["\\,()]/;

const AFC_DIAGNOSTIC_ADMIN_GENERATION_STATUSES = [
  "running",
  "ready",
  "failed",
] as const;

export type AfcDiagnosticAdminGenerationStatus =
  (typeof AFC_DIAGNOSTIC_ADMIN_GENERATION_STATUSES)[number];

const GENERATION_STATUS_SET = new Set<string>(
  AFC_DIAGNOSTIC_ADMIN_GENERATION_STATUSES,
);

const ARTIFACT_SOURCES = ["durable", "generated"] as const;
export type AfcDiagnosticAdminArtifactSource =
  (typeof ARTIFACT_SOURCES)[number];

const ARTIFACT_SOURCE_SET = new Set<string>(ARTIFACT_SOURCES);

const RECOVERY_SAFE_FAILURE_STATES = [
  "none",
  "metric_fallback",
  "collision_empty",
] as const;

export type AfcDiagnosticAdminRecoverySafeFailureState =
  (typeof RECOVERY_SAFE_FAILURE_STATES)[number];

const RECOVERY_SAFE_FAILURE_SET = new Set<string>(RECOVERY_SAFE_FAILURE_STATES);

const ENGINE_VERSION_KEYS = [
  "liveProduct",
  "autoMetric",
  "cameraCalibration",
  "cameraAuthority",
  "collision",
  "emptyAuthoritativeCollision",
] as const;

const FINGERPRINT_TILED_KEYS = [
  "generatorId",
  "profileId",
  "researchPreset",
  "requestedModelId",
  "readerVersion",
] as const;

export type AfcDiagnosticAdminCaseOrigin = "tester" | "admin";

export type AfcDiagnosticAdminSourceSummary = Readonly<{
  originalSha256: string;
  decodedWidth: number | null;
  decodedHeight: number | null;
  byteCount: number | null;
  mimeType: string | null;
  orientation: number | null;
  baseAssetId: string | null;
}>;

export type AfcDiagnosticAdminEngineFingerprint = Readonly<{
  fingerprintSchemaVersion: string;
  productionSchemaVersion: string;
  gitSha: string | null;
  observationModelId: string;
  engineVersions: Readonly<{
    liveProduct: string;
    autoMetric: string;
    cameraCalibration: string;
    cameraAuthority: string;
    collision: string;
    emptyAuthoritativeCollision: string;
  }>;
  tiled: Readonly<{
    generatorId: string;
    profileId: string;
    researchPreset: string;
    requestedModelId: string;
    readerVersion: string | null;
  }>;
}>;

export type AfcDiagnosticAdminArtifactSummary = Readonly<{
  present: boolean;
  sha256: string | null;
  artifactSource: AfcDiagnosticAdminArtifactSource | null;
}>;

export type AfcDiagnosticAdminGenerationEvidence = Readonly<{
  generationId: string;
  roomId: string;
  userId: string;
  parentGenerationId: string | null;
  lineageSeq: number;
  runId: string;
  intent: AfcDiagnosticSessionIntent;
  status: AfcDiagnosticAdminGenerationStatus;
  createdAt: string;
  completedAt: string | null;

  frame: Readonly<{
    width: number;
    height: number;
  }> | null;

  failureReason: string | null;
  metricStatus: string | null;
  collisionStatus: string | null;

  analysisStatus: string | null;
  analysisReason: string | null;

  recoverySafeFailureState: AfcDiagnosticAdminRecoverySafeFailureState | null;

  metricDecision: AfcDiagnosticAdminMetricDecision;
  legacyMetricConclusion: AfcDiagnosticAdminLegacyMetricConclusion | null;

  engineFingerprint: AfcDiagnosticAdminEngineFingerprint | null;

  original: AfcDiagnosticAdminSourceSummary | null;

  empty: AfcDiagnosticAdminArtifactSummary;
  tiled: AfcDiagnosticAdminArtifactSummary;
}>;

export type AfcDiagnosticAdminCaseSummary = Readonly<{
  caseId: string;
  submittedAt: string;

  reviewStatus: AfcDiagnosticReviewStatus;

  trigger: AfcDiagnosticCaseTrigger;
  origin: AfcDiagnosticAdminCaseOrigin;

  issueCodes: readonly string[];
  taxonomyVersion: string;
  hasNotes: boolean;

  roomId: string;
  sessionId: string;

  sessionStatus: AfcDiagnosticSessionStatus;
  sessionAttemptCount: number;

  reportedGenerationId: string;
  machineStatusSnapshot: AfcDiagnosticMachineStatusSnapshot;

  reporterUserId: string;
}>;

export type AfcDiagnosticAdminCaseDetail = Readonly<{
  caseId: string;
  submittedAt: string;

  roomId: string;
  sessionId: string;
  reporterUserId: string;
  reportedGenerationId: string;

  reportedAttemptOrdinal: number | null;

  trigger: AfcDiagnosticCaseTrigger;
  origin: AfcDiagnosticAdminCaseOrigin;

  taxonomyVersion: string;
  issueCodes: readonly string[];
  notes: string | null;

  machineStatusSnapshot: AfcDiagnosticMachineStatusSnapshot;

  source: AfcDiagnosticAdminSourceSummary;

  review: Readonly<{
    reviewStatus: AfcDiagnosticReviewStatus;
    reviewerUserId: string | null;
    reviewNotes: string | null;
    reviewedAt: string | null;
  }>;

  session: Readonly<{
    sessionId: string;
    status: AfcDiagnosticSessionStatus;
    sessionUserId: string;
    roomId: string;
    originalSha256: string;
    attemptCount: number;
    createdAt: string;
    updatedAt: string;
  }>;

  reportedGeneration: AfcDiagnosticAdminGenerationEvidence;
}>;

export type AfcDiagnosticAdminSessionAttempt = Readonly<{
  generationId: string;
  attemptOrdinal: number;
  intent: AfcDiagnosticSessionIntent;
  associatedAt: string;
  generation: AfcDiagnosticAdminGenerationEvidence;
}>;

export type AfcDiagnosticAdminSessionDetail = Readonly<{
  sessionId: string;
  status: AfcDiagnosticSessionStatus;

  roomId: string;
  sessionUserId: string;

  originalSha256: string;
  baseAssetId: string | null;

  attemptCount: number;

  createdAt: string;
  updatedAt: string;

  attempts: readonly AfcDiagnosticAdminSessionAttempt[];
}>;

export type AfcDiagnosticAdminCaseListCursor = Readonly<{
  submittedAt: string;
  id: string;
}>;

export type AfcDiagnosticAdminCaseListQuery = Readonly<{
  reviewStatus: AfcDiagnosticReviewStatus | null;
  trigger: AfcDiagnosticCaseTrigger | null;
  issueCode: string | null;
  machineStatusSnapshot: AfcDiagnosticMachineStatusSnapshot | null;
  roomId: string | null;
  submittedFrom: string | null;
  submittedTo: string | null;
  limit: number;
  cursor: AfcDiagnosticAdminCaseListCursor | null;
}>;

export type AfcDiagnosticAdminCaseListResult = Readonly<{
  items: readonly AfcDiagnosticAdminCaseSummary[];
  nextCursor: string | null;
}>;

export type AfcDiagnosticAdminParseResult<T> =
  | { ok: true; value: T }
  | { ok: false };

export function parseAfcDiagnosticAdminUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return UUID.test(id) ? id.toLowerCase() : null;
}

export function afcDiagnosticAdminCaseOrigin(
  trigger: AfcDiagnosticCaseTrigger,
): AfcDiagnosticAdminCaseOrigin {
  return trigger === "admin_capture" ? "admin" : "tester";
}

export function afcDiagnosticAdminHasNotes(
  notes: string | null | undefined,
): boolean {
  return typeof notes === "string" && notes.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function optionalFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!Number.isFinite(Date.parse(trimmed))) return null;
  return trimmed;
}

function parseExactEnum<T extends string>(
  value: unknown,
  guard: (candidate: unknown) => candidate is T,
): T | "missing" | "invalid" {
  if (value == null || value === "") return "missing";
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (trimmed.length === 0) return "missing";
  return guard(trimmed) ? trimmed : "invalid";
}

function parseLimit(value: string | null): number | "invalid" {
  if (value == null || value.trim().length === 0) {
    return AFC_DIAGNOSTIC_ADMIN_CASE_LIST_DEFAULT_LIMIT;
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return "invalid";
  const parsed = Number.parseInt(trimmed, 10);
  if (
    parsed < 1 ||
    parsed > AFC_DIAGNOSTIC_ADMIN_CASE_LIST_MAX_LIMIT
  ) {
    return "invalid";
  }
  return parsed;
}

export function encodeAfcDiagnosticAdminCaseListCursor(
  cursor: AfcDiagnosticAdminCaseListCursor,
): string {
  return Buffer.from(
    JSON.stringify({
      submittedAt: cursor.submittedAt,
      id: cursor.id,
    }),
    "utf8",
  ).toString("base64url");
}

export function decodeAfcDiagnosticAdminCaseListCursor(
  raw: string,
): AfcDiagnosticAdminParseResult<AfcDiagnosticAdminCaseListCursor> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return { ok: false };
  }
  if (!isRecord(parsed)) return { ok: false };
  const keys = Object.keys(parsed);
  if (keys.length !== 2 || !("submittedAt" in parsed) || !("id" in parsed)) {
    return { ok: false };
  }
  if (typeof parsed.submittedAt !== "string") return { ok: false };
  if (parsed.submittedAt.trim().length === 0) return { ok: false };
  if (UNSAFE_CURSOR_TIMESTAMP_CHARS.test(parsed.submittedAt)) return { ok: false };
  if (!Number.isFinite(Date.parse(parsed.submittedAt))) return { ok: false };
  const id = parseAfcDiagnosticAdminUuid(parsed.id);
  if (!id) return { ok: false };
  return {
    ok: true,
    value: Object.freeze({
      submittedAt: parsed.submittedAt,
      id,
    }),
  };
}

export function parseAfcDiagnosticAdminCaseListQuery(
  searchParams: URLSearchParams,
): AfcDiagnosticAdminParseResult<AfcDiagnosticAdminCaseListQuery> {
  const reviewStatus = parseExactEnum(
    searchParams.get("reviewStatus"),
    isAfcDiagnosticReviewStatus,
  );
  if (reviewStatus === "invalid") return { ok: false };

  const trigger = parseExactEnum(
    searchParams.get("trigger"),
    isAfcDiagnosticCaseTrigger,
  );
  if (trigger === "invalid") return { ok: false };

  const machineStatusSnapshot = parseExactEnum(
    searchParams.get("machineStatusSnapshot"),
    isAfcDiagnosticMachineStatusSnapshot,
  );
  if (machineStatusSnapshot === "invalid") return { ok: false };

  const issueCodeRaw = searchParams.get("issueCode");
  let issueCode: string | null = null;
  if (issueCodeRaw != null && issueCodeRaw.trim().length > 0) {
    const trimmed = issueCodeRaw.trim();
    if (!isAfcQaIssueCode(trimmed)) return { ok: false };
    issueCode = trimmed;
  }

  const roomIdRaw = searchParams.get("roomId");
  let roomId: string | null = null;
  if (roomIdRaw != null && roomIdRaw.trim().length > 0) {
    roomId = parseAfcDiagnosticAdminUuid(roomIdRaw);
    if (!roomId) return { ok: false };
  }

  const submittedFromRaw = searchParams.get("submittedFrom");
  let submittedFrom: string | null = null;
  if (submittedFromRaw != null && submittedFromRaw.trim().length > 0) {
    submittedFrom = parseTimestamp(submittedFromRaw);
    if (!submittedFrom) return { ok: false };
  }

  const submittedToRaw = searchParams.get("submittedTo");
  let submittedTo: string | null = null;
  if (submittedToRaw != null && submittedToRaw.trim().length > 0) {
    submittedTo = parseTimestamp(submittedToRaw);
    if (!submittedTo) return { ok: false };
  }

  if (
    submittedFrom &&
    submittedTo &&
    Date.parse(submittedFrom) > Date.parse(submittedTo)
  ) {
    return { ok: false };
  }

  const limit = parseLimit(searchParams.get("limit"));
  if (limit === "invalid") return { ok: false };

  const cursorRaw = searchParams.get("cursor");
  let cursor: AfcDiagnosticAdminCaseListCursor | null = null;
  if (cursorRaw != null && cursorRaw.length > 0) {
    const decoded = decodeAfcDiagnosticAdminCaseListCursor(cursorRaw);
    if (!decoded.ok) return { ok: false };
    cursor = decoded.value;
  }

  return {
    ok: true,
    value: Object.freeze({
      reviewStatus: reviewStatus === "missing" ? null : reviewStatus,
      trigger: trigger === "missing" ? null : trigger,
      issueCode,
      machineStatusSnapshot:
        machineStatusSnapshot === "missing" ? null : machineStatusSnapshot,
      roomId,
      submittedFrom,
      submittedTo,
      limit,
      cursor,
    }),
  };
}

export function mapAfcDiagnosticAdminEngineFingerprint(
  value: unknown,
): AfcDiagnosticAdminEngineFingerprint | null {
  if (value == null) return null;
  if (!isRecord(value)) return null;
  if (value.fingerprintSchemaVersion !== AFC_V2_ENGINE_FINGERPRINT_SCHEMA_VERSION_V1) {
    return null;
  }
  if (typeof value.productionSchemaVersion !== "string") return null;
  if (typeof value.observationModelId !== "string") return null;
  if (value.gitSha !== null && typeof value.gitSha !== "string") return null;
  if (!isRecord(value.engineVersions)) return null;
  for (const key of ENGINE_VERSION_KEYS) {
    if (typeof value.engineVersions[key] !== "string") return null;
  }
  if (!isRecord(value.tiled)) return null;
  for (const key of FINGERPRINT_TILED_KEYS) {
    if (key === "readerVersion") continue;
    if (typeof value.tiled[key] !== "string" || value.tiled[key].length === 0) {
      return null;
    }
  }
  if (
    value.tiled.readerVersion !== null &&
    typeof value.tiled.readerVersion !== "string"
  ) {
    return null;
  }
  return Object.freeze({
    fingerprintSchemaVersion: value.fingerprintSchemaVersion,
    productionSchemaVersion: value.productionSchemaVersion,
    gitSha: value.gitSha,
    observationModelId: value.observationModelId,
    engineVersions: Object.freeze({
      liveProduct: value.engineVersions.liveProduct as string,
      autoMetric: value.engineVersions.autoMetric as string,
      cameraCalibration: value.engineVersions.cameraCalibration as string,
      cameraAuthority: value.engineVersions.cameraAuthority as string,
      collision: value.engineVersions.collision as string,
      emptyAuthoritativeCollision:
        value.engineVersions.emptyAuthoritativeCollision as string,
    }),
    tiled: Object.freeze({
      generatorId: value.tiled.generatorId as string,
      profileId: value.tiled.profileId as string,
      researchPreset: value.tiled.researchPreset as string,
      requestedModelId: value.tiled.requestedModelId as string,
      readerVersion:
        typeof value.tiled.readerVersion === "string"
          ? value.tiled.readerVersion
          : null,
    }),
  });
}

function mapArtifactSummary(
  sha256: unknown,
  artifactSource: unknown,
): AfcDiagnosticAdminArtifactSummary {
  const hash = typeof sha256 === "string" && sha256.length > 0 ? sha256 : null;
  return Object.freeze({
    present: hash != null,
    sha256: hash,
    artifactSource: ARTIFACT_SOURCE_SET.has(String(artifactSource))
      ? (artifactSource as AfcDiagnosticAdminArtifactSource)
      : null,
  });
}

function mapAnalysisFields(payload: unknown): {
  analysisStatus: string | null;
  analysisReason: string | null;
} {
  if (!isRecord(payload)) {
    return { analysisStatus: null, analysisReason: null };
  }
  return {
    analysisStatus:
      typeof payload.analysisStatus === "string" ? payload.analysisStatus : null,
    analysisReason: typeof payload.reason === "string" ? payload.reason : null,
  };
}

function mapRecoverySafeFailureState(
  authority: unknown,
): AfcDiagnosticAdminRecoverySafeFailureState | null {
  if (!isRecord(authority)) return null;
  const recovery = authority.recovery;
  if (!isRecord(recovery)) return null;
  const value = recovery.safeFailureState;
  return RECOVERY_SAFE_FAILURE_SET.has(String(value))
    ? (value as AfcDiagnosticAdminRecoverySafeFailureState)
    : null;
}

function mapSourceSummary(
  originalSha256: string,
  identity: unknown,
): AfcDiagnosticAdminSourceSummary {
  const record = isRecord(identity) ? identity : null;
  const baseAssetId = record
    ? parseAfcDiagnosticAdminUuid(record.baseAssetId)
    : null;
  return Object.freeze({
    originalSha256,
    decodedWidth: record ? optionalFiniteNumber(record.decodedWidth) : null,
    decodedHeight: record ? optionalFiniteNumber(record.decodedHeight) : null,
    byteCount: record ? optionalFiniteNumber(record.byteCount) : null,
    mimeType: record ? optionalString(record.mimeType) : null,
    orientation: record ? optionalFiniteNumber(record.orientation) : null,
    baseAssetId,
  });
}

export type AfcDiagnosticAdminGenerationRecord = Readonly<{
  id: string;
  roomId: string;
  userId: string;
  parentGenerationId: string | null;
  lineageSeq: number;
  runId: string;
  intent: AfcDiagnosticSessionIntent;
  status: AfcDiagnosticAdminGenerationStatus;
  createdAt: string;
  completedAt: string | null;
  frameWidth: number | null;
  frameHeight: number | null;
  failureReason: string | null;
  metricStatus: string | null;
  collisionStatus: string | null;
  diagnosticPayload: unknown;
  engineFingerprint: unknown;
  productionAuthority: unknown;
  metricDecision: unknown;
  originalSha256: string | null;
  originalDecodedWidth: number | null;
  originalDecodedHeight: number | null;
  originalByteCount: number | null;
  originalMimeType: string | null;
  originalOrientation: number | null;
  emptySha256: string | null;
  emptyArtifactSource: string | null;
  tiledSha256: string | null;
  tiledArtifactSource: string | null;
}>;

export function parseAfcDiagnosticAdminGenerationRecord(
  row: unknown,
): AfcDiagnosticAdminGenerationRecord | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (typeof row.room_id !== "string") return null;
  if (typeof row.user_id !== "string") return null;
  if (
    row.parent_generation_id != null &&
    typeof row.parent_generation_id !== "string"
  ) {
    return null;
  }
  const lineageSeq =
    typeof row.lineage_seq === "number"
      ? row.lineage_seq
      : typeof row.lineage_seq === "string"
        ? Number(row.lineage_seq)
        : NaN;
  if (!Number.isFinite(lineageSeq)) return null;
  if (typeof row.run_id !== "string") return null;
  if (!isAfcDiagnosticSessionIntent(row.intent)) return null;
  if (!GENERATION_STATUS_SET.has(String(row.status))) return null;
  if (typeof row.created_at !== "string") return null;
  if (row.completed_at != null && typeof row.completed_at !== "string") {
    return null;
  }
  return Object.freeze({
    id: row.id.toLowerCase(),
    roomId: row.room_id.toLowerCase(),
    userId: row.user_id.toLowerCase(),
    parentGenerationId: row.parent_generation_id
      ? String(row.parent_generation_id).toLowerCase()
      : null,
    lineageSeq,
    runId: row.run_id,
    intent: row.intent,
    status: row.status as AfcDiagnosticAdminGenerationStatus,
    createdAt: row.created_at,
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
    frameWidth: optionalFiniteNumber(row.frame_width),
    frameHeight: optionalFiniteNumber(row.frame_height),
    failureReason: optionalString(row.failure_reason),
    metricStatus: optionalString(row.metric_status),
    collisionStatus: optionalString(row.collision_status),
    diagnosticPayload: row.diagnostic_payload ?? null,
    engineFingerprint: row.engine_fingerprint ?? null,
    productionAuthority: row.production_authority ?? null,
    metricDecision: Object.prototype.hasOwnProperty.call(row, "metric_decision")
      ? row.metric_decision ?? null
      : null,
    originalSha256: optionalString(row.original_sha256),
    originalDecodedWidth: optionalFiniteNumber(row.original_decoded_width),
    originalDecodedHeight: optionalFiniteNumber(row.original_decoded_height),
    originalByteCount: optionalFiniteNumber(row.original_byte_count),
    originalMimeType: optionalString(row.original_mime_type),
    originalOrientation: optionalFiniteNumber(row.original_orientation),
    emptySha256: optionalString(row.empty_sha256),
    emptyArtifactSource: optionalString(row.empty_artifact_source),
    tiledSha256: optionalString(row.tiled_sha256),
    tiledArtifactSource: optionalString(row.tiled_artifact_source),
  });
}

function mapMetricDecision(value: unknown): AfcDiagnosticAdminMetricDecision {
  try {
    return mapAfcDiagnosticAdminMetricDecision(value);
  } catch {
    return Object.freeze({ kind: "unreadable" });
  }
}

function mapLegacyMetricConclusion(
  authority: unknown,
): AfcDiagnosticAdminLegacyMetricConclusion | null {
  try {
    return mapAfcDiagnosticAdminLegacyMetricConclusion(authority);
  } catch {
    return null;
  }
}

export function mapAfcDiagnosticAdminGenerationEvidence(
  record: AfcDiagnosticAdminGenerationRecord,
): AfcDiagnosticAdminGenerationEvidence {
  const analysis = mapAnalysisFields(record.diagnosticPayload);
  const original =
    record.originalSha256 && record.originalSha256.length > 0
      ? Object.freeze({
          originalSha256: record.originalSha256,
          decodedWidth: record.originalDecodedWidth,
          decodedHeight: record.originalDecodedHeight,
          byteCount: record.originalByteCount,
          mimeType: record.originalMimeType,
          orientation: record.originalOrientation,
          baseAssetId: null,
        })
      : null;
  const frame =
    record.frameWidth != null && record.frameHeight != null
      ? Object.freeze({
          width: record.frameWidth,
          height: record.frameHeight,
        })
      : null;
  return Object.freeze({
    generationId: record.id,
    roomId: record.roomId,
    userId: record.userId,
    parentGenerationId: record.parentGenerationId,
    lineageSeq: record.lineageSeq,
    runId: record.runId,
    intent: record.intent,
    status: record.status,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    frame,
    failureReason: record.failureReason,
    metricStatus: record.metricStatus,
    collisionStatus: record.collisionStatus,
    analysisStatus: analysis.analysisStatus,
    analysisReason: analysis.analysisReason,
    recoverySafeFailureState: mapRecoverySafeFailureState(
      record.productionAuthority,
    ),
    metricDecision: mapMetricDecision(record.metricDecision),
    legacyMetricConclusion: mapLegacyMetricConclusion(record.productionAuthority),
    engineFingerprint: mapAfcDiagnosticAdminEngineFingerprint(
      record.engineFingerprint,
    ),
    original,
    empty: mapArtifactSummary(record.emptySha256, record.emptyArtifactSource),
    tiled: mapArtifactSummary(record.tiledSha256, record.tiledArtifactSource),
  });
}

export type AfcDiagnosticAdminCaseListRecord = Readonly<{
  id: string;
  submittedAt: string;
  reviewStatus: AfcDiagnosticReviewStatus;
  trigger: AfcDiagnosticCaseTrigger;
  issueCodes: readonly string[];
  taxonomyVersion: string;
  notes: string | null;
  roomId: string;
  sessionId: string;
  reportedGenerationId: string;
  machineStatusSnapshot: AfcDiagnosticMachineStatusSnapshot;
  reporterUserId: string;
}>;

export function parseAfcDiagnosticAdminCaseListRecord(
  row: unknown,
): AfcDiagnosticAdminCaseListRecord | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (typeof row.submitted_at !== "string") return null;
  if (!isAfcDiagnosticReviewStatus(row.review_status)) return null;
  if (!isAfcDiagnosticCaseTrigger(row.trigger)) return null;
  if (!Array.isArray(row.issue_codes)) return null;
  if (typeof row.taxonomy_version !== "string") return null;
  if (row.notes != null && typeof row.notes !== "string") return null;
  if (typeof row.room_id !== "string") return null;
  if (typeof row.session_id !== "string") return null;
  if (typeof row.reported_generation_id !== "string") return null;
  if (!isAfcDiagnosticMachineStatusSnapshot(row.machine_status_snapshot)) {
    return null;
  }
  if (typeof row.reporter_user_id !== "string") return null;
  return Object.freeze({
    id: row.id.toLowerCase(),
    submittedAt: row.submitted_at,
    reviewStatus: row.review_status,
    trigger: row.trigger,
    issueCodes: row.issue_codes.map((code) => String(code)),
    taxonomyVersion: row.taxonomy_version,
    notes: row.notes ?? null,
    roomId: row.room_id.toLowerCase(),
    sessionId: row.session_id.toLowerCase(),
    reportedGenerationId: row.reported_generation_id.toLowerCase(),
    machineStatusSnapshot: row.machine_status_snapshot,
    reporterUserId: row.reporter_user_id.toLowerCase(),
  });
}

export function mapAfcDiagnosticAdminCaseSummary(input: {
  caseRow: AfcDiagnosticAdminCaseListRecord;
  sessionStatus: AfcDiagnosticSessionStatus;
  sessionAttemptCount: number;
}): AfcDiagnosticAdminCaseSummary {
  return Object.freeze({
    caseId: input.caseRow.id,
    submittedAt: input.caseRow.submittedAt,
    reviewStatus: input.caseRow.reviewStatus,
    trigger: input.caseRow.trigger,
    origin: afcDiagnosticAdminCaseOrigin(input.caseRow.trigger),
    issueCodes: Object.freeze([...input.caseRow.issueCodes]),
    taxonomyVersion: input.caseRow.taxonomyVersion,
    hasNotes: afcDiagnosticAdminHasNotes(input.caseRow.notes),
    roomId: input.caseRow.roomId,
    sessionId: input.caseRow.sessionId,
    sessionStatus: input.sessionStatus,
    sessionAttemptCount: input.sessionAttemptCount,
    reportedGenerationId: input.caseRow.reportedGenerationId,
    machineStatusSnapshot: input.caseRow.machineStatusSnapshot,
    reporterUserId: input.caseRow.reporterUserId,
  });
}

export type AfcDiagnosticAdminCaseDetailRecord = AfcDiagnosticAdminCaseListRecord &
  Readonly<{
    originalSha256: string;
    originalIdentity: unknown;
    reviewerUserId: string | null;
    reviewNotes: string | null;
    reviewedAt: string | null;
  }>;

export function parseAfcDiagnosticAdminCaseDetailRecord(
  row: unknown,
): AfcDiagnosticAdminCaseDetailRecord | null {
  const list = parseAfcDiagnosticAdminCaseListRecord(row);
  if (!list || !isRecord(row)) return null;
  if (typeof row.original_sha256 !== "string" || row.original_sha256.length === 0) {
    return null;
  }
  if (row.reviewer_user_id != null && typeof row.reviewer_user_id !== "string") {
    return null;
  }
  if (row.review_notes != null && typeof row.review_notes !== "string") {
    return null;
  }
  if (row.reviewed_at != null && typeof row.reviewed_at !== "string") {
    return null;
  }
  return Object.freeze({
    ...list,
    originalSha256: row.original_sha256,
    originalIdentity: row.original_identity ?? null,
    reviewerUserId: row.reviewer_user_id
      ? String(row.reviewer_user_id).toLowerCase()
      : null,
    reviewNotes: row.review_notes ?? null,
    reviewedAt: row.reviewed_at ?? null,
  });
}

export type AfcDiagnosticAdminSessionRecord = Readonly<{
  id: string;
  status: AfcDiagnosticSessionStatus;
  roomId: string;
  userId: string;
  originalSha256: string;
  baseAssetId: string | null;
  createdAt: string;
  updatedAt: string;
}>;

export type AfcDiagnosticAdminSessionStatusRow = Readonly<{
  id: string;
  status: AfcDiagnosticSessionStatus;
}>;

export function parseAfcDiagnosticAdminSessionStatusRow(
  row: unknown,
): AfcDiagnosticAdminSessionStatusRow | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (!isAfcDiagnosticSessionStatus(row.status)) return null;
  return Object.freeze({
    id: row.id.toLowerCase(),
    status: row.status,
  });
}

export function parseAfcDiagnosticAdminSessionRecord(
  row: unknown,
): AfcDiagnosticAdminSessionRecord | null {
  if (!isRecord(row)) return null;
  if (typeof row.id !== "string") return null;
  if (!isAfcDiagnosticSessionStatus(row.status)) return null;
  if (typeof row.room_id !== "string") return null;
  if (typeof row.user_id !== "string") return null;
  if (typeof row.original_sha256 !== "string") return null;
  if (row.base_asset_id != null && typeof row.base_asset_id !== "string") {
    return null;
  }
  if (typeof row.created_at !== "string") return null;
  if (typeof row.updated_at !== "string") return null;
  return Object.freeze({
    id: row.id.toLowerCase(),
    status: row.status,
    roomId: row.room_id.toLowerCase(),
    userId: row.user_id.toLowerCase(),
    originalSha256: row.original_sha256,
    baseAssetId: row.base_asset_id
      ? String(row.base_asset_id).toLowerCase()
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export type AfcDiagnosticAdminMembershipRecord = Readonly<{
  sessionId: string;
  generationId: string;
  attemptOrdinal: number;
  intent: AfcDiagnosticSessionIntent;
  associatedAt: string;
}>;

export function parseAfcDiagnosticAdminMembershipRecord(
  row: unknown,
): AfcDiagnosticAdminMembershipRecord | null {
  if (!isRecord(row)) return null;
  if (typeof row.session_id !== "string") return null;
  if (typeof row.generation_id !== "string") return null;
  const attemptOrdinal =
    typeof row.attempt_ordinal === "number"
      ? row.attempt_ordinal
      : Number(row.attempt_ordinal);
  if (!Number.isInteger(attemptOrdinal) || attemptOrdinal < 1) return null;
  if (!isAfcDiagnosticSessionIntent(row.intent)) return null;
  if (typeof row.associated_at !== "string") return null;
  return Object.freeze({
    sessionId: row.session_id.toLowerCase(),
    generationId: row.generation_id.toLowerCase(),
    attemptOrdinal,
    intent: row.intent,
    associatedAt: row.associated_at,
  });
}

export function mapAfcDiagnosticAdminCaseDetail(input: {
  caseRow: AfcDiagnosticAdminCaseDetailRecord;
  session: AfcDiagnosticAdminSessionRecord;
  membership: AfcDiagnosticAdminMembershipRecord;
  generation: AfcDiagnosticAdminGenerationEvidence;
  sessionAttemptCount: number;
}): AfcDiagnosticAdminCaseDetail {
  return Object.freeze({
    caseId: input.caseRow.id,
    submittedAt: input.caseRow.submittedAt,
    roomId: input.caseRow.roomId,
    sessionId: input.caseRow.sessionId,
    reporterUserId: input.caseRow.reporterUserId,
    reportedGenerationId: input.caseRow.reportedGenerationId,
    reportedAttemptOrdinal: input.membership.attemptOrdinal,
    trigger: input.caseRow.trigger,
    origin: afcDiagnosticAdminCaseOrigin(input.caseRow.trigger),
    taxonomyVersion: input.caseRow.taxonomyVersion,
    issueCodes: Object.freeze([...input.caseRow.issueCodes]),
    notes: input.caseRow.notes,
    machineStatusSnapshot: input.caseRow.machineStatusSnapshot,
    source: mapSourceSummary(
      input.caseRow.originalSha256,
      input.caseRow.originalIdentity,
    ),
    review: Object.freeze({
      reviewStatus: input.caseRow.reviewStatus,
      reviewerUserId: input.caseRow.reviewerUserId,
      reviewNotes: input.caseRow.reviewNotes,
      reviewedAt: input.caseRow.reviewedAt,
    }),
    session: Object.freeze({
      sessionId: input.session.id,
      status: input.session.status,
      sessionUserId: input.session.userId,
      roomId: input.session.roomId,
      originalSha256: input.session.originalSha256,
      attemptCount: input.sessionAttemptCount,
      createdAt: input.session.createdAt,
      updatedAt: input.session.updatedAt,
    }),
    reportedGeneration: input.generation,
  });
}

export function mapAfcDiagnosticAdminSessionDetail(input: {
  session: AfcDiagnosticAdminSessionRecord;
  attempts: readonly AfcDiagnosticAdminSessionAttempt[];
}): AfcDiagnosticAdminSessionDetail {
  return Object.freeze({
    sessionId: input.session.id,
    status: input.session.status,
    roomId: input.session.roomId,
    sessionUserId: input.session.userId,
    originalSha256: input.session.originalSha256,
    baseAssetId: input.session.baseAssetId,
    attemptCount: input.attempts.length,
    createdAt: input.session.createdAt,
    updatedAt: input.session.updatedAt,
    attempts: Object.freeze([...input.attempts]),
  });
}

export function mapAfcDiagnosticAdminSessionAttempt(input: {
  membership: AfcDiagnosticAdminMembershipRecord;
  generation: AfcDiagnosticAdminGenerationEvidence;
}): AfcDiagnosticAdminSessionAttempt {
  return Object.freeze({
    generationId: input.membership.generationId,
    attemptOrdinal: input.membership.attemptOrdinal,
    intent: input.membership.intent,
    associatedAt: input.membership.associatedAt,
    generation: input.generation,
  });
}

const FORBIDDEN_OBJECT_KEYS = new Set([
  "storage_bucket",
  "storageBucket",
  "storage_path",
  "storagePath",
  "empty_storage_path",
  "emptyStoragePath",
  "empty_storage_bucket",
  "emptyStorageBucket",
  "tiled_storage_path",
  "tiledStoragePath",
  "tiled_storage_bucket",
  "tiledStorageBucket",
  "signedUrl",
  "signed_url",
  "signedURL",
  "providerProvenance",
  "provider_provenance",
  "diagnosticPayload",
  "diagnostic_payload",
  "productionAuthority",
  "production_authority",
  "executionCounts",
  "execution_counts",
  "serviceRole",
  "service_role",
  "serviceRoleKey",
  "service_role_key",
  "accessToken",
  "access_token",
  "refreshToken",
  "refresh_token",
  "frozenCamera",
  "frozen_camera",
  "sourceNormalizedPolygon",
  "userWorldScale",
  "sourceImageUrl",
  "source_image_url",
  "emptyUrl",
  "tiledUrl",
  "adminUrl",
  "receipt",
  "receipts",
  "rawResponse",
  "email",
  "displayName",
  "display_name",
  "fullName",
  "full_name",
  "reporterEmail",
  "reporterName",
  "reason",
  "emptyArtifactSource",
  "tiledArtifactSource",
  "tiledForceRegeneration",
  "tiled_force_regeneration",
  "engineEmptyArtifactSource",
  "engineTiledArtifactSource",
]);

const FORBIDDEN_TEXT = [
  "storage_bucket",
  "storage_path",
  "signedUrl",
  "signed_url",
  "providerProvenance",
  "provider_provenance",
  "service_role",
  "service role",
  "access_token",
  "access token",
  "SUPABASE_SERVICE_ROLE_KEY",
  "VIBODE_ADMIN_EMAIL",
  "VIBODE_AFC_QA_MODE",
  "VIBODE_AFC_QA_USER_IDS",
  "X-Amz-Signature",
  "storage/v1/object",
  "token=",
  "diagnostic_payload",
  "production_authority",
  "executionCounts",
  "empty_storage_path",
  "tiled_storage_path",
];

const FREE_TEXT_KEYS = new Set(["notes", "reviewNotes"]);

function walkForbiddenKeys(
  value: unknown,
  path: string,
  found: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      walkForbiddenKeys(entry, `${path}[${index}]`, found);
    });
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const next = path ? `${path}.${key}` : key;
    if (FORBIDDEN_OBJECT_KEYS.has(key)) found.push(next);
    if (FREE_TEXT_KEYS.has(key)) continue;
    walkForbiddenKeys(child, next, found);
  }
}

function redactFreeText(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactFreeText);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = FREE_TEXT_KEYS.has(key) ? "[redacted]" : redactFreeText(child);
  }
  return out;
}

export function collectAfcDiagnosticAdminPayloadPrivacyViolations(
  payload: unknown,
): readonly string[] {
  const found: string[] = [];
  walkForbiddenKeys(payload, "", found);
  const serialized = JSON.stringify(redactFreeText(payload)) ?? "";
  for (const needle of FORBIDDEN_TEXT) {
    if (serialized.includes(needle)) found.push(`text:${needle}`);
  }
  if (/https?:\/\//i.test(serialized)) found.push("text:url");
  return Object.freeze(found);
}

export function assertAfcDiagnosticAdminPayloadPrivacy(payload: unknown): void {
  const violations = collectAfcDiagnosticAdminPayloadPrivacyViolations(payload);
  if (violations.length > 0) {
    throw new Error(
      `AFC diagnostic admin payload leaked privileged fields: ${violations.join(", ")}`,
    );
  }
}
