/**
 * AFD-4C1 admin Case + Session textual inspector helpers.
 *
 * Browser-safe. Consumes certified AFD-4A Case/Session detail DTOs only.
 * Does not import Node-only cursor encoding helpers or the server read-model.
 */

import {
  AFC_DIAGNOSTIC_INBOX_COPY,
  AFC_DIAGNOSTIC_INBOX_PAGE_PATH,
  afcDiagnosticInboxAttemptLabel,
  afcDiagnosticInboxIssueLabel,
  afcDiagnosticInboxMachineLabel,
  afcDiagnosticInboxOriginLabel,
  afcDiagnosticInboxReviewLabel,
  afcDiagnosticInboxSourceText,
  afcDiagnosticInboxTriggerLabel,
  formatAfcDiagnosticInboxSubmittedAt,
  isAfcDiagnosticInboxAbortError,
  orderedAfcDiagnosticInboxIssueCodes,
  parseAfcDiagnosticInboxUuid,
  shortAfcDiagnosticUuid,
  type AfcDiagnosticInboxIssueChip,
} from "./admin-case-inbox.client";
import {
  parseAfcDiagnosticAdminLegacyMetricConclusion,
  parseAfcDiagnosticAdminMetricDecisionDto,
  type AfcDiagnosticAdminLegacyMetricConclusion,
  type AfcDiagnosticAdminMetricDecision,
} from "./admin-metric-decision-dto";
import {
  isAfcDiagnosticCaseTrigger,
  isAfcDiagnosticMachineStatusSnapshot,
  isAfcDiagnosticReviewStatus,
  isAfcDiagnosticSessionStatus,
} from "./contracts";

export const AFC_DIAGNOSTIC_INSPECTOR_CASE_API_PATH =
  "/api/admin/afc-diagnostics/cases" as const;

export const AFC_DIAGNOSTIC_INSPECTOR_SESSION_API_PATH =
  "/api/admin/afc-diagnostics/sessions" as const;

export const AFC_DIAGNOSTIC_INSPECTOR_PAGE_PATH =
  AFC_DIAGNOSTIC_INBOX_PAGE_PATH;

export const AFC_DIAGNOSTIC_INSPECTOR_COPY = {
  title: AFC_DIAGNOSTIC_INBOX_COPY.detailTitle,
  inboxLink: "AFC Diagnostics",
  refresh: AFC_DIAGNOSTIC_INBOX_COPY.refresh,
  refreshing: AFC_DIAGNOSTIC_INBOX_COPY.refreshing,
  retry: AFC_DIAGNOSTIC_INBOX_COPY.retry,
  loadingCase: "Loading case...",
  loadingSession: "Loading session...",
  error401: AFC_DIAGNOSTIC_INBOX_COPY.error401,
  error403: AFC_DIAGNOSTIC_INBOX_COPY.error403,
  errorNotFound: "Case not found.",
  errorCaseGeneric: "Couldn't load diagnostic case. Try again.",
  errorSessionGeneric: "Couldn't load diagnostic session. Try again.",
  noNotes: "No notes provided.",
  notReviewedYet: "Not reviewed yet.",
  noReviewNotes: "No review notes.",
  reported: "Reported",
  reportedHelper: "This is the attempt the tester reported.",
  parentHelper: "Prior successful authority at creation time.",
  baseAssetCaption: "Supporting snapshot, not AFC authority.",
  attemptOriginalDiffers: "Attempt original differs from case source",
  engineUnavailable: "Not available.",
  frameUnavailable: "Not available",
  artifactNotPresent: "Not present",
  sessionOpen: "Session open",
  sessionClosed: "Session closed",
} as const;

export type AfcDiagnosticInspectorSourceSummary = Readonly<{
  originalSha256: string;
  decodedWidth: number | null;
  decodedHeight: number | null;
  byteCount: number | null;
  mimeType: string | null;
  orientation: number | null;
  baseAssetId: string | null;
}>;

export type AfcDiagnosticInspectorEngineFingerprint = Readonly<{
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

export type AfcDiagnosticInspectorArtifactSummary = Readonly<{
  present: boolean;
  sha256: string | null;
  artifactSource: string | null;
}>;

export type AfcDiagnosticInspectorGenerationEvidence = Readonly<{
  generationId: string;
  roomId: string;
  userId: string;
  parentGenerationId: string | null;
  lineageSeq: number;
  runId: string;
  intent: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  frame: Readonly<{ width: number; height: number }> | null;
  failureReason: string | null;
  metricStatus: string | null;
  collisionStatus: string | null;
  analysisStatus: string | null;
  analysisReason: string | null;
  recoverySafeFailureState: string | null;
  metricDecision: AfcDiagnosticAdminMetricDecision;
  legacyMetricConclusion: AfcDiagnosticAdminLegacyMetricConclusion | null;
  engineFingerprint: AfcDiagnosticInspectorEngineFingerprint | null;
  original: AfcDiagnosticInspectorSourceSummary | null;
  empty: AfcDiagnosticInspectorArtifactSummary;
  tiled: AfcDiagnosticInspectorArtifactSummary;
}>;

export type AfcDiagnosticInspectorCaseDetail = Readonly<{
  caseId: string;
  submittedAt: string;
  roomId: string;
  sessionId: string;
  reporterUserId: string;
  reportedGenerationId: string;
  reportedAttemptOrdinal: number | null;
  trigger: string;
  origin: string;
  taxonomyVersion: string;
  issueCodes: readonly string[];
  notes: string | null;
  machineStatusSnapshot: string;
  source: AfcDiagnosticInspectorSourceSummary;
  review: Readonly<{
    reviewStatus: string;
    reviewerUserId: string | null;
    reviewNotes: string | null;
    reviewedAt: string | null;
  }>;
  session: Readonly<{
    sessionId: string;
    status: string;
    sessionUserId: string;
    roomId: string;
    originalSha256: string;
    attemptCount: number;
    createdAt: string;
    updatedAt: string;
  }>;
  reportedGeneration: AfcDiagnosticInspectorGenerationEvidence;
}>;

export type AfcDiagnosticInspectorSessionAttempt = Readonly<{
  generationId: string;
  attemptOrdinal: number;
  intent: string;
  associatedAt: string;
  generation: AfcDiagnosticInspectorGenerationEvidence;
}>;

export type AfcDiagnosticInspectorSessionDetail = Readonly<{
  sessionId: string;
  status: string;
  roomId: string;
  sessionUserId: string;
  originalSha256: string;
  baseAssetId: string | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
  attempts: readonly AfcDiagnosticInspectorSessionAttempt[];
}>;

export type AfcDiagnosticInspectorTimestamp = Readonly<{
  display: string;
  title: string;
}>;

export type AfcDiagnosticInspectorSessionBegin =
  | { started: false }
  | {
      started: true;
      seq: number;
      sessionId: string;
      signal: AbortSignal;
    };

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
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!Number.isFinite(Date.parse(trimmed))) return null;
  return trimmed;
}

function parseOptionalString(value: unknown): string | null | undefined {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  return value;
}

function parseOptionalFiniteNumber(value: unknown): number | null | undefined {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function parseRequiredInteger(value: unknown, min: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min) {
    return null;
  }
  return value;
}

function parseOptionalUuid(value: unknown): string | null | undefined {
  if (value == null) return null;
  const parsed = parseAfcDiagnosticInboxUuid(value);
  return parsed ?? undefined;
}

function parseIssueCodes(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const codes: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return null;
    codes.push(entry);
  }
  return codes;
}

function parseSourceSummary(
  value: unknown,
  requireSha: boolean,
): AfcDiagnosticInspectorSourceSummary | null {
  if (!isRecord(value)) return null;
  if (typeof value.originalSha256 !== "string" || value.originalSha256.length === 0) {
    if (requireSha) return null;
    return null;
  }
  const decodedWidth = parseOptionalFiniteNumber(value.decodedWidth);
  if (decodedWidth === undefined) return null;
  const decodedHeight = parseOptionalFiniteNumber(value.decodedHeight);
  if (decodedHeight === undefined) return null;
  const byteCount = parseOptionalFiniteNumber(value.byteCount);
  if (byteCount === undefined) return null;
  const mimeType = parseOptionalString(value.mimeType);
  if (mimeType === undefined) return null;
  const orientation = parseOptionalFiniteNumber(value.orientation);
  if (orientation === undefined) return null;
  const baseAssetId = parseOptionalUuid(value.baseAssetId);
  if (baseAssetId === undefined) return null;
  return Object.freeze({
    originalSha256: value.originalSha256,
    decodedWidth,
    decodedHeight,
    byteCount,
    mimeType,
    orientation,
    baseAssetId,
  });
}

function parseArtifactSummary(
  value: unknown,
): AfcDiagnosticInspectorArtifactSummary | null {
  if (!isRecord(value)) return null;
  if (typeof value.present !== "boolean") return null;
  if (value.sha256 !== null && typeof value.sha256 !== "string") return null;
  if (value.artifactSource !== null && typeof value.artifactSource !== "string") {
    return null;
  }
  const sha256 =
    typeof value.sha256 === "string" && value.sha256.length > 0
      ? value.sha256
      : null;
  if (value.present && sha256 == null) return null;
  if (!value.present && sha256 != null) return null;
  return Object.freeze({
    present: value.present,
    sha256,
    artifactSource:
      typeof value.artifactSource === "string" && value.artifactSource.length > 0
        ? value.artifactSource
        : null,
  });
}

function parseFrame(
  value: unknown,
): Readonly<{ width: number; height: number }> | null | undefined {
  if (value == null) return null;
  if (!isRecord(value)) return undefined;
  if (
    typeof value.width !== "number" ||
    !Number.isFinite(value.width) ||
    typeof value.height !== "number" ||
    !Number.isFinite(value.height)
  ) {
    return undefined;
  }
  return Object.freeze({ width: value.width, height: value.height });
}

function parseEngineFingerprint(
  value: unknown,
): AfcDiagnosticInspectorEngineFingerprint | null | undefined {
  if (value == null) return null;
  if (!isRecord(value)) return undefined;
  if (typeof value.fingerprintSchemaVersion !== "string") return undefined;
  if (typeof value.productionSchemaVersion !== "string") return undefined;
  if (typeof value.observationModelId !== "string") return undefined;
  if (value.gitSha !== null && typeof value.gitSha !== "string") return undefined;
  if (!isRecord(value.engineVersions)) return undefined;
  for (const key of ENGINE_VERSION_KEYS) {
    if (typeof value.engineVersions[key] !== "string") return undefined;
  }
  if (!isRecord(value.tiled)) return undefined;
  for (const key of FINGERPRINT_TILED_KEYS) {
    if (typeof value.tiled[key] !== "string" || value.tiled[key].length === 0) {
      return undefined;
    }
  }
  if (
    value.tiled.readerVersion !== null &&
    typeof value.tiled.readerVersion !== "string"
  ) {
    return undefined;
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
      emptyAuthoritativeCollision: value.engineVersions
        .emptyAuthoritativeCollision as string,
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

function parseOptionalOriginal(
  value: unknown,
): AfcDiagnosticInspectorSourceSummary | null | undefined {
  if (value == null) return null;
  const parsed = parseSourceSummary(value, true);
  return parsed ?? undefined;
}

export function parseAfcDiagnosticInspectorGenerationEvidence(
  value: unknown,
): AfcDiagnosticInspectorGenerationEvidence | null {
  if (!isRecord(value)) return null;
  const generationId = parseAfcDiagnosticInboxUuid(value.generationId);
  if (!generationId) return null;
  const roomId = parseAfcDiagnosticInboxUuid(value.roomId);
  if (!roomId) return null;
  const userId = parseAfcDiagnosticInboxUuid(value.userId);
  if (!userId) return null;
  const parentGenerationId = parseOptionalUuid(value.parentGenerationId);
  if (parentGenerationId === undefined) return null;
  if (typeof value.lineageSeq !== "number" || !Number.isInteger(value.lineageSeq)) {
    return null;
  }
  if (typeof value.runId !== "string" || value.runId.length === 0) return null;
  if (typeof value.intent !== "string" || value.intent.length === 0) return null;
  if (typeof value.status !== "string" || value.status.length === 0) return null;
  const createdAt = parseTimestamp(value.createdAt);
  if (!createdAt) return null;
  if (value.completedAt !== null && typeof value.completedAt !== "string") {
    return null;
  }
  const completedAt =
    value.completedAt == null ? null : parseTimestamp(value.completedAt);
  if (value.completedAt != null && completedAt == null) return null;
  const frame = parseFrame(value.frame);
  if (frame === undefined) return null;
  const failureReason = parseOptionalString(value.failureReason);
  if (failureReason === undefined) return null;
  const metricStatus = parseOptionalString(value.metricStatus);
  if (metricStatus === undefined) return null;
  const collisionStatus = parseOptionalString(value.collisionStatus);
  if (collisionStatus === undefined) return null;
  const analysisStatus = parseOptionalString(value.analysisStatus);
  if (analysisStatus === undefined) return null;
  const analysisReason = parseOptionalString(value.analysisReason);
  if (analysisReason === undefined) return null;
  const recoverySafeFailureState = parseOptionalString(
    value.recoverySafeFailureState,
  );
  if (recoverySafeFailureState === undefined) return null;
  const metricDecision = Object.prototype.hasOwnProperty.call(value, "metricDecision")
    ? parseAfcDiagnosticAdminMetricDecisionDto(value.metricDecision)
    : null;
  const legacyMetricConclusion = Object.prototype.hasOwnProperty.call(
    value,
    "legacyMetricConclusion",
  )
    ? parseAfcDiagnosticAdminLegacyMetricConclusion(value.legacyMetricConclusion)
    : null;
  const engineFingerprint = parseEngineFingerprint(value.engineFingerprint);
  if (engineFingerprint === undefined) return null;
  const original = parseOptionalOriginal(value.original);
  if (original === undefined) return null;
  const empty = parseArtifactSummary(value.empty);
  if (!empty) return null;
  const tiled = parseArtifactSummary(value.tiled);
  if (!tiled) return null;
  return Object.freeze({
    generationId,
    roomId,
    userId,
    parentGenerationId,
    lineageSeq: value.lineageSeq,
    runId: value.runId,
    intent: value.intent,
    status: value.status,
    createdAt,
    completedAt,
    frame,
    failureReason,
    metricStatus,
    collisionStatus,
    analysisStatus,
    analysisReason,
    recoverySafeFailureState,
    metricDecision,
    legacyMetricConclusion,
    engineFingerprint,
    original,
    empty,
    tiled,
  });
}

export function parseAfcDiagnosticInspectorCaseDetail(
  value: unknown,
): AfcDiagnosticInspectorCaseDetail | null {
  if (!isRecord(value)) return null;
  const caseId = parseAfcDiagnosticInboxUuid(value.caseId);
  if (!caseId) return null;
  const submittedAt = parseTimestamp(value.submittedAt);
  if (!submittedAt) return null;
  const roomId = parseAfcDiagnosticInboxUuid(value.roomId);
  if (!roomId) return null;
  const sessionId = parseAfcDiagnosticInboxUuid(value.sessionId);
  if (!sessionId) return null;
  const reporterUserId = parseAfcDiagnosticInboxUuid(value.reporterUserId);
  if (!reporterUserId) return null;
  const reportedGenerationId = parseAfcDiagnosticInboxUuid(
    value.reportedGenerationId,
  );
  if (!reportedGenerationId) return null;
  if (
    value.reportedAttemptOrdinal !== null &&
    (typeof value.reportedAttemptOrdinal !== "number" ||
      !Number.isInteger(value.reportedAttemptOrdinal) ||
      value.reportedAttemptOrdinal < 1)
  ) {
    return null;
  }
  if (!isAfcDiagnosticCaseTrigger(value.trigger)) return null;
  if (value.origin !== "tester" && value.origin !== "admin") return null;
  if (typeof value.taxonomyVersion !== "string") return null;
  const issueCodes = parseIssueCodes(value.issueCodes);
  if (!issueCodes) return null;
  const notes = parseOptionalString(value.notes);
  if (notes === undefined) return null;
  if (!isAfcDiagnosticMachineStatusSnapshot(value.machineStatusSnapshot)) {
    return null;
  }
  const source = parseSourceSummary(value.source, true);
  if (!source) return null;
  if (!isRecord(value.review)) return null;
  if (!isAfcDiagnosticReviewStatus(value.review.reviewStatus)) return null;
  const reviewerUserId = parseOptionalUuid(value.review.reviewerUserId);
  if (reviewerUserId === undefined) return null;
  const reviewNotes = parseOptionalString(value.review.reviewNotes);
  if (reviewNotes === undefined) return null;
  if (
    value.review.reviewedAt !== null &&
    typeof value.review.reviewedAt !== "string"
  ) {
    return null;
  }
  const reviewedAt =
    value.review.reviewedAt == null
      ? null
      : parseTimestamp(value.review.reviewedAt);
  if (value.review.reviewedAt != null && reviewedAt == null) return null;
  if (!isRecord(value.session)) return null;
  const nestedSessionId = parseAfcDiagnosticInboxUuid(value.session.sessionId);
  if (!nestedSessionId) return null;
  if (!isAfcDiagnosticSessionStatus(value.session.status)) return null;
  const sessionUserId = parseAfcDiagnosticInboxUuid(value.session.sessionUserId);
  if (!sessionUserId) return null;
  const sessionRoomId = parseAfcDiagnosticInboxUuid(value.session.roomId);
  if (!sessionRoomId) return null;
  if (
    typeof value.session.originalSha256 !== "string" ||
    value.session.originalSha256.length === 0
  ) {
    return null;
  }
  const attemptCount = parseRequiredInteger(value.session.attemptCount, 0);
  if (attemptCount == null) return null;
  const sessionCreatedAt = parseTimestamp(value.session.createdAt);
  if (!sessionCreatedAt) return null;
  const sessionUpdatedAt = parseTimestamp(value.session.updatedAt);
  if (!sessionUpdatedAt) return null;
  const reportedGeneration = parseAfcDiagnosticInspectorGenerationEvidence(
    value.reportedGeneration,
  );
  if (!reportedGeneration) return null;
  return Object.freeze({
    caseId,
    submittedAt,
    roomId,
    sessionId,
    reporterUserId,
    reportedGenerationId,
    reportedAttemptOrdinal: value.reportedAttemptOrdinal,
    trigger: value.trigger,
    origin: value.origin,
    taxonomyVersion: value.taxonomyVersion,
    issueCodes: Object.freeze(issueCodes),
    notes,
    machineStatusSnapshot: value.machineStatusSnapshot,
    source,
    review: Object.freeze({
      reviewStatus: value.review.reviewStatus,
      reviewerUserId,
      reviewNotes,
      reviewedAt,
    }),
    session: Object.freeze({
      sessionId: nestedSessionId,
      status: value.session.status,
      sessionUserId,
      roomId: sessionRoomId,
      originalSha256: value.session.originalSha256,
      attemptCount,
      createdAt: sessionCreatedAt,
      updatedAt: sessionUpdatedAt,
    }),
    reportedGeneration,
  });
}

function parseSessionAttempt(
  value: unknown,
): AfcDiagnosticInspectorSessionAttempt | null {
  if (!isRecord(value)) return null;
  const generationId = parseAfcDiagnosticInboxUuid(value.generationId);
  if (!generationId) return null;
  const attemptOrdinal = parseRequiredInteger(value.attemptOrdinal, 1);
  if (attemptOrdinal == null) return null;
  if (typeof value.intent !== "string" || value.intent.length === 0) return null;
  const associatedAt = parseTimestamp(value.associatedAt);
  if (!associatedAt) return null;
  const generation = parseAfcDiagnosticInspectorGenerationEvidence(
    value.generation,
  );
  if (!generation) return null;
  return Object.freeze({
    generationId,
    attemptOrdinal,
    intent: value.intent,
    associatedAt,
    generation,
  });
}

export function parseAfcDiagnosticInspectorSessionDetail(
  value: unknown,
): AfcDiagnosticInspectorSessionDetail | null {
  if (!isRecord(value)) return null;
  const sessionId = parseAfcDiagnosticInboxUuid(value.sessionId);
  if (!sessionId) return null;
  if (!isAfcDiagnosticSessionStatus(value.status)) return null;
  const roomId = parseAfcDiagnosticInboxUuid(value.roomId);
  if (!roomId) return null;
  const sessionUserId = parseAfcDiagnosticInboxUuid(value.sessionUserId);
  if (!sessionUserId) return null;
  if (typeof value.originalSha256 !== "string" || value.originalSha256.length === 0) {
    return null;
  }
  const baseAssetId = parseOptionalUuid(value.baseAssetId);
  if (baseAssetId === undefined) return null;
  const attemptCount = parseRequiredInteger(value.attemptCount, 0);
  if (attemptCount == null) return null;
  const createdAt = parseTimestamp(value.createdAt);
  if (!createdAt) return null;
  const updatedAt = parseTimestamp(value.updatedAt);
  if (!updatedAt) return null;
  if (!Array.isArray(value.attempts)) return null;
  const attempts: AfcDiagnosticInspectorSessionAttempt[] = [];
  for (const entry of value.attempts) {
    const attempt = parseSessionAttempt(entry);
    if (!attempt) return null;
    attempts.push(attempt);
  }
  return Object.freeze({
    sessionId,
    status: value.status,
    roomId,
    sessionUserId,
    originalSha256: value.originalSha256,
    baseAssetId,
    attemptCount,
    createdAt,
    updatedAt,
    attempts: Object.freeze(attempts),
  });
}

export function parseAfcDiagnosticInspectorUuid(value: unknown): string | null {
  return parseAfcDiagnosticInboxUuid(value);
}

export function isAfcDiagnosticInspectorUuid(value: unknown): boolean {
  return parseAfcDiagnosticInboxUuid(value) != null;
}

export function shortAfcDiagnosticInspectorUuid(id: string): string {
  return shortAfcDiagnosticUuid(id);
}

export function shortAfcDiagnosticInspectorSha(value: string): string {
  return value.slice(0, 8);
}

export function shortAfcDiagnosticInspectorRunId(runId: string): string {
  return runId.length > 8 ? runId.slice(0, 8) : runId;
}

export function formatAfcDiagnosticInspectorTimestamp(
  value: string | null | undefined,
): AfcDiagnosticInspectorTimestamp {
  if (value == null || value.trim().length === 0) {
    return { display: "—", title: "—" };
  }
  return formatAfcDiagnosticInboxSubmittedAt(value);
}

function formatDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function formatAfcDiagnosticInspectorBytes(
  value: unknown,
): AfcDiagnosticInspectorTimestamp {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return { display: "—", title: "—" };
  }
  const title = `${value} bytes`;
  if (value < 1024) {
    return { display: `${value} B`, title };
  }
  const kb = value / 1024;
  if (kb < 1024) {
    return { display: `${formatDecimal(kb)} KB`, title };
  }
  const mb = kb / 1024;
  return { display: `${formatDecimal(mb)} MB`, title };
}

export function afcDiagnosticInspectorIssueChips(
  codes: readonly string[],
): readonly AfcDiagnosticInboxIssueChip[] {
  return orderedAfcDiagnosticInboxIssueCodes(codes).map((code) => {
    const mapped = afcDiagnosticInboxIssueLabel(code);
    return {
      key: code,
      label: mapped.label,
      title: mapped.title,
    };
  });
}

export function afcDiagnosticInspectorIntentLabel(intent: string): string {
  if (intent === "analyze") return "Initial analysis";
  if (intent === "run_again") return "Run again";
  if (intent === "reread_perspective") return "Re-read perspective";
  return intent;
}

export function afcDiagnosticInspectorRecoveryLabel(
  value: string | null,
): string {
  if (value == null) return "—";
  if (value === "none") return "None";
  if (value === "metric_fallback") return "Metric fallback";
  if (value === "collision_empty") return "Collision empty";
  return value;
}

export function afcDiagnosticInspectorArtifactSourceLabel(
  value: string | null,
): string {
  if (value == null) return "—";
  if (value === "generated") return "Generated";
  if (value === "durable") return "Durable";
  return value;
}

export function afcDiagnosticInspectorSessionSentence(status: string): string {
  if (status === "open") return AFC_DIAGNOSTIC_INSPECTOR_COPY.sessionOpen;
  if (status === "closed") return AFC_DIAGNOSTIC_INSPECTOR_COPY.sessionClosed;
  return status;
}

export function afcDiagnosticInspectorMachineText(value: string | null): string {
  if (value == null || value.trim().length === 0) return "—";
  return value;
}

export function afcDiagnosticInspectorNotesText(
  notes: string | null,
): string {
  if (notes == null || notes.trim().length === 0) {
    return AFC_DIAGNOSTIC_INSPECTOR_COPY.noNotes;
  }
  return notes;
}

export function afcDiagnosticInspectorReviewNotesText(input: {
  reviewStatus: string;
  reviewerUserId: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
}): string {
  const emptyNotes =
    input.reviewNotes == null || input.reviewNotes.trim().length === 0;
  if (
    input.reviewStatus === "new" &&
    emptyNotes &&
    input.reviewerUserId == null &&
    input.reviewedAt == null
  ) {
    return AFC_DIAGNOSTIC_INSPECTOR_COPY.notReviewedYet;
  }
  if (emptyNotes) return AFC_DIAGNOSTIC_INSPECTOR_COPY.noReviewNotes;
  return input.reviewNotes as string;
}

export function afcDiagnosticInspectorIsUnreviewedNew(input: {
  reviewStatus: string;
  reviewerUserId: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
}): boolean {
  return (
    input.reviewStatus === "new" &&
    (input.reviewNotes == null || input.reviewNotes.trim().length === 0) &&
    input.reviewerUserId == null &&
    input.reviewedAt == null
  );
}

export function formatAfcDiagnosticInspectorDimensions(
  width: number | null,
  height: number | null,
): string {
  if (width == null || height == null) return "—";
  return `${width} × ${height}`;
}

export function orderedAfcDiagnosticInspectorAttempts<
  T extends { attemptOrdinal: number },
>(attempts: readonly T[]): T[] {
  return [...attempts].sort((a, b) => a.attemptOrdinal - b.attemptOrdinal);
}

export function defaultAfcDiagnosticInspectorAttemptOrdinal(input: {
  attempts: readonly Readonly<{
    attemptOrdinal: number;
    generationId: string;
  }>[];
  reportedAttemptOrdinal: number | null;
  reportedGenerationId: string;
  preserveOrdinal?: number | null;
}): number | null {
  const ordered = orderedAfcDiagnosticInspectorAttempts(input.attempts);
  if (ordered.length === 0) return null;
  if (
    input.preserveOrdinal != null &&
    ordered.some((attempt) => attempt.attemptOrdinal === input.preserveOrdinal)
  ) {
    return input.preserveOrdinal;
  }
  if (
    input.reportedAttemptOrdinal != null &&
    ordered.some(
      (attempt) => attempt.attemptOrdinal === input.reportedAttemptOrdinal,
    )
  ) {
    return input.reportedAttemptOrdinal;
  }
  const matched = ordered.find(
    (attempt) => attempt.generationId === input.reportedGenerationId,
  );
  if (matched) return matched.attemptOrdinal;
  return ordered[0]?.attemptOrdinal ?? null;
}

export function afcDiagnosticInspectorParentAttemptOrdinal(
  attempts: readonly Readonly<{
    attemptOrdinal: number;
    generationId: string;
  }>[],
  parentGenerationId: string | null,
  currentAttemptOrdinal?: number,
): number | null {
  if (parentGenerationId == null) return null;
  const match = attempts.find(
    (attempt) =>
      attempt.generationId === parentGenerationId &&
      (currentAttemptOrdinal == null ||
        attempt.attemptOrdinal !== currentAttemptOrdinal),
  );
  return match ? match.attemptOrdinal : null;
}

export function afcDiagnosticInspectorAttemptOriginalDiffers(
  caseSourceSha: string,
  attemptOriginalSha: string | null | undefined,
): boolean {
  if (attemptOriginalSha == null || attemptOriginalSha.length === 0) {
    return false;
  }
  return attemptOriginalSha !== caseSourceSha;
}

export function isReportedAfcDiagnosticInspectorAttempt(input: {
  attemptOrdinal: number;
  generationId: string;
  reportedAttemptOrdinal: number | null;
  reportedGenerationId: string;
}): boolean {
  if (
    input.reportedAttemptOrdinal != null &&
    input.attemptOrdinal === input.reportedAttemptOrdinal
  ) {
    return true;
  }
  return input.generationId === input.reportedGenerationId;
}

export function buildAfcDiagnosticInspectorCaseUrl(caseId: string): string {
  return `${AFC_DIAGNOSTIC_INSPECTOR_CASE_API_PATH}/${caseId}`;
}

export function buildAfcDiagnosticInspectorSessionUrl(sessionId: string): string {
  return `${AFC_DIAGNOSTIC_INSPECTOR_SESSION_API_PATH}/${sessionId}`;
}

export function afcDiagnosticInspectorCaseErrorMessage(
  status: number | "network",
): string {
  if (status === 401) return AFC_DIAGNOSTIC_INSPECTOR_COPY.error401;
  if (status === 403) return AFC_DIAGNOSTIC_INSPECTOR_COPY.error403;
  if (status === 400 || status === 404) {
    return AFC_DIAGNOSTIC_INSPECTOR_COPY.errorNotFound;
  }
  return AFC_DIAGNOSTIC_INSPECTOR_COPY.errorCaseGeneric;
}

export function afcDiagnosticInspectorSessionErrorMessage(
  status: number | "network",
): string {
  if (status === 401) return AFC_DIAGNOSTIC_INSPECTOR_COPY.error401;
  if (status === 403) return AFC_DIAGNOSTIC_INSPECTOR_COPY.error403;
  return AFC_DIAGNOSTIC_INSPECTOR_COPY.errorSessionGeneric;
}

export function isAfcDiagnosticInspectorAbortError(error: unknown): boolean {
  return isAfcDiagnosticInboxAbortError(error);
}

export function createAfcDiagnosticInspectorRequestCoordinator() {
  let latestSeq = 0;
  let caseController: AbortController | null = null;
  let sessionController: AbortController | null = null;
  let boundSessionId: string | null = null;

  return {
    beginCase(): { seq: number; signal: AbortSignal } {
      caseController?.abort();
      sessionController?.abort();
      latestSeq += 1;
      boundSessionId = null;
      caseController = new AbortController();
      sessionController = null;
      return { seq: latestSeq, signal: caseController.signal };
    },
    beginSession(
      seq: number,
      sessionId: string,
    ): AfcDiagnosticInspectorSessionBegin {
      if (seq !== latestSeq) return { started: false };
      sessionController?.abort();
      sessionController = new AbortController();
      boundSessionId = sessionId;
      return {
        started: true,
        seq,
        sessionId,
        signal: sessionController.signal,
      };
    },
    retrySession(): AfcDiagnosticInspectorSessionBegin {
      if (boundSessionId == null) return { started: false };
      sessionController?.abort();
      sessionController = new AbortController();
      return {
        started: true,
        seq: latestSeq,
        sessionId: boundSessionId,
        signal: sessionController.signal,
      };
    },
    isCurrentCase(seq: number): boolean {
      return seq === latestSeq;
    },
    shouldCommitSession(seq: number, sessionId: string): boolean {
      return seq === latestSeq && boundSessionId === sessionId;
    },
    currentSeq(): number {
      return latestSeq;
    },
    boundSessionId(): string | null {
      return boundSessionId;
    },
    abortAll(): void {
      caseController?.abort();
      sessionController?.abort();
      latestSeq += 1;
      boundSessionId = null;
    },
  };
}

export {
  afcDiagnosticInboxAttemptLabel as afcDiagnosticInspectorAttemptCountLabel,
  afcDiagnosticInboxIssueLabel as afcDiagnosticInspectorIssueLabel,
  afcDiagnosticInboxMachineLabel as afcDiagnosticInspectorMachineLabel,
  afcDiagnosticInboxOriginLabel as afcDiagnosticInspectorOriginLabel,
  afcDiagnosticInboxReviewLabel as afcDiagnosticInspectorReviewLabel,
  afcDiagnosticInboxSourceText as afcDiagnosticInspectorSourceText,
  afcDiagnosticInboxTriggerLabel as afcDiagnosticInspectorTriggerLabel,
};
