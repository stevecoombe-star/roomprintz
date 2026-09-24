/**
 * AFR-2B selected-attempt clipboard export.
 *
 * Pure projection of the already-authorized Admin Case Detail DTOs.
 * No database reads, no network, and no raw authority or provider JSON.
 */

import {
  isReportedAfcDiagnosticInspectorAttempt,
  type AfcDiagnosticInspectorArtifactSummary,
  type AfcDiagnosticInspectorCaseDetail,
  type AfcDiagnosticInspectorEngineFingerprint,
  type AfcDiagnosticInspectorGenerationEvidence,
  type AfcDiagnosticInspectorSessionAttempt,
  type AfcDiagnosticInspectorSessionDetail,
  type AfcDiagnosticInspectorSourceSummary,
} from "./admin-case-inspector.client";
import {
  parseAfcDiagnosticAdminLegacyMetricConclusion,
  parseAfcDiagnosticAdminMetricDecisionDto,
  publishAfcDiagnosticMetricDetail,
  publishAfcDiagnosticMetricHash,
  publishAfcDiagnosticMetricToken,
  type AfcDiagnosticAdminLegacyMetricConclusion,
  type AfcDiagnosticAdminMetricDecision,
} from "./admin-metric-decision-dto";

export const AFC_DIAGNOSTIC_SELECTED_ATTEMPT_EXPORT_SCHEMA_VERSION =
  "vibode-afc-selected-attempt-export/v1" as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const ISSUE_CODE = /^[a-z0-9_]{1,80}$/;

const RECOVERY_STATES = ["none", "metric_fallback", "collision_empty"] as const;

const ARTIFACT_SOURCES = ["durable", "generated"] as const;

export type AfcDiagnosticSelectedAttemptExportSource = Readonly<{
  caseDetail: AfcDiagnosticInspectorCaseDetail;
  session: AfcDiagnosticInspectorSessionDetail | null;
  attempt: AfcDiagnosticInspectorSessionAttempt | null;
  generation: AfcDiagnosticInspectorGenerationEvidence;
  associatedAt: string | null;
  attemptOrdinal: number | null;
}>;

export type AfcDiagnosticSelectedAttemptExport = Readonly<{
  schemaVersion: typeof AFC_DIAGNOSTIC_SELECTED_ATTEMPT_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  case: Readonly<{
    caseId: string | null;
    reviewStatus: string | null;
    origin: string | null;
    trigger: string | null;
    taxonomyVersion: string | null;
    issueCodes: readonly string[];
    machineStatusSnapshot: string | null;
    submittedAt: string | null;
    reportedAttemptOrdinal: number | null;
    reportedGenerationId: string | null;
    source: Readonly<{
      sha256: string | null;
      decodedWidth: number | null;
      decodedHeight: number | null;
      byteCount: number | null;
    }>;
  }>;
  session: Readonly<{
    sessionId: string | null;
    status: string | null;
    roomId: string | null;
    attemptCount: number | null;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  attempt: Readonly<{
    attemptOrdinal: number | null;
    reported: boolean;
    intent: string | null;
    associatedAt: string | null;
    generationId: string | null;
    parentGenerationId: string | null;
    lineageSeq: number | null;
    runId: string | null;
    createdAt: string | null;
    completedAt: string | null;
  }>;
  generation: Readonly<{
    status: string | null;
    failureReason: string | null;
  }>;
  analysis: Readonly<{
    metricStatus: string | null;
    collisionStatus: string | null;
    analysisStatus: string | null;
    analysisReason: string | null;
    recoverySafeFailureState: string | null;
    frame: Readonly<{ width: number; height: number }> | null;
  }>;
  engineFingerprint: Readonly<{
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
  }> | null;
  productionAuthority: Readonly<{
    metricStatus: string | null;
    collisionStatus: string | null;
    recoverySafeFailureState: string | null;
    camera: Readonly<{
      calibrationVersion: string;
      authorityVersion: string;
    }> | null;
    collision: Readonly<{
      version: string;
      emptyAuthoritativeVersion: string;
    }> | null;
  }>;
  metricDecision: AfcDiagnosticAdminMetricDecision;
  legacyMetricConclusion: AfcDiagnosticAdminLegacyMetricConclusion | null;
  artifacts: Readonly<{
    empty: Readonly<{
      present: boolean;
      sha256: string | null;
      artifactSource: string | null;
    }>;
    tiled: Readonly<{
      present: boolean;
      sha256: string | null;
      artifactSource: string | null;
    }>;
    original: Readonly<{
      sha256: string | null;
      decodedWidth: number | null;
      decodedHeight: number | null;
      byteCount: number | null;
      mimeType: string | null;
      orientation: number | null;
    }> | null;
  }>;
}>;

function token(value: unknown): string | null {
  return typeof value === "string" ? publishAfcDiagnosticMetricToken(value) : null;
}

function detail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const published = publishAfcDiagnosticMetricDetail(value);
  if (published == null) return null;
  if (/bearer\b|authorization\s*:/i.test(published)) return null;
  return published;
}

function hash(value: unknown): string | null {
  return typeof value === "string" ? publishAfcDiagnosticMetricHash(value) : null;
}

function uuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim().toLowerCase();
  return UUID.test(id) ? id : null;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!Number.isFinite(Date.parse(trimmed))) return null;
  if (/https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function recoveryState(value: unknown): string | null {
  return typeof value === "string" &&
    (RECOVERY_STATES as readonly string[]).includes(value)
    ? value
    : null;
}

function exportTimestamp(value: string): string {
  if (!ISO_UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error("selected attempt export timestamp must be ISO 8601 UTC");
  }
  return value;
}

function projectFingerprint(
  value: AfcDiagnosticInspectorEngineFingerprint | null,
): AfcDiagnosticSelectedAttemptExport["engineFingerprint"] {
  if (value == null) return null;
  const fingerprintSchemaVersion = token(value.fingerprintSchemaVersion);
  const productionSchemaVersion = token(value.productionSchemaVersion);
  const observationModelId = token(value.observationModelId);
  const liveProduct = token(value.engineVersions.liveProduct);
  const autoMetric = token(value.engineVersions.autoMetric);
  const cameraCalibration = token(value.engineVersions.cameraCalibration);
  const cameraAuthority = token(value.engineVersions.cameraAuthority);
  const collision = token(value.engineVersions.collision);
  const emptyAuthoritativeCollision = token(
    value.engineVersions.emptyAuthoritativeCollision,
  );
  const generatorId = token(value.tiled.generatorId);
  const profileId = token(value.tiled.profileId);
  const researchPreset = token(value.tiled.researchPreset);
  const requestedModelId = token(value.tiled.requestedModelId);
  if (
    fingerprintSchemaVersion == null ||
    productionSchemaVersion == null ||
    observationModelId == null ||
    liveProduct == null ||
    autoMetric == null ||
    cameraCalibration == null ||
    cameraAuthority == null ||
    collision == null ||
    emptyAuthoritativeCollision == null ||
    generatorId == null ||
    profileId == null ||
    researchPreset == null ||
    requestedModelId == null
  ) {
    return null;
  }
  const gitSha = value.gitSha == null ? null : token(value.gitSha);
  if (value.gitSha != null && gitSha == null) return null;
  const readerVersion =
    value.tiled.readerVersion == null ? null : token(value.tiled.readerVersion);
  if (value.tiled.readerVersion != null && readerVersion == null) return null;
  return {
    fingerprintSchemaVersion,
    productionSchemaVersion,
    gitSha,
    observationModelId,
    engineVersions: {
      liveProduct,
      autoMetric,
      cameraCalibration,
      cameraAuthority,
      collision,
      emptyAuthoritativeCollision,
    },
    tiled: {
      generatorId,
      profileId,
      researchPreset,
      requestedModelId,
      readerVersion,
    },
  };
}

function projectArtifact(
  artifact: AfcDiagnosticInspectorArtifactSummary,
): AfcDiagnosticSelectedAttemptExport["artifacts"]["empty"] {
  const sha256 = hash(artifact.sha256);
  const artifactSource =
    typeof artifact.artifactSource === "string" &&
    (ARTIFACT_SOURCES as readonly string[]).includes(artifact.artifactSource)
      ? artifact.artifactSource
      : null;
  const present = artifact.present === true && sha256 != null;
  return {
    present,
    sha256: present ? sha256 : null,
    artifactSource: present ? artifactSource : null,
  };
}

function projectOriginal(
  original: AfcDiagnosticInspectorSourceSummary | null,
): AfcDiagnosticSelectedAttemptExport["artifacts"]["original"] {
  if (original == null) return null;
  return {
    sha256: hash(original.originalSha256),
    decodedWidth: finiteNumber(original.decodedWidth),
    decodedHeight: finiteNumber(original.decodedHeight),
    byteCount: finiteNumber(original.byteCount),
    mimeType: token(original.mimeType),
    orientation: finiteNumber(original.orientation),
  };
}

function projectFrame(
  frame: AfcDiagnosticInspectorGenerationEvidence["frame"],
): AfcDiagnosticSelectedAttemptExport["analysis"]["frame"] {
  if (frame == null) return null;
  const width = finiteNumber(frame.width);
  const height = finiteNumber(frame.height);
  if (width == null || height == null) return null;
  return { width, height };
}

export function buildAfcDiagnosticSelectedAttemptExport(
  source: AfcDiagnosticSelectedAttemptExportSource,
  exportedAt: string,
): AfcDiagnosticSelectedAttemptExport {
  const { caseDetail, generation } = source;
  const session = source.session ?? caseDetail.session;
  const attemptOrdinal = integer(source.attemptOrdinal);
  const reported = isReportedAfcDiagnosticInspectorAttempt({
    attemptOrdinal: attemptOrdinal ?? caseDetail.reportedAttemptOrdinal ?? 0,
    generationId: generation.generationId,
    reportedAttemptOrdinal: caseDetail.reportedAttemptOrdinal,
    reportedGenerationId: caseDetail.reportedGenerationId,
  });
  const fingerprint = projectFingerprint(generation.engineFingerprint);
  const metricStatus = token(generation.metricStatus);
  const collisionStatus = token(generation.collisionStatus);
  const recoverySafeFailureState = recoveryState(generation.recoverySafeFailureState);
  const issueCodes = caseDetail.issueCodes.filter((code) => ISSUE_CODE.test(code));

  return {
    schemaVersion: AFC_DIAGNOSTIC_SELECTED_ATTEMPT_EXPORT_SCHEMA_VERSION,
    exportedAt: exportTimestamp(exportedAt),
    case: {
      caseId: uuid(caseDetail.caseId),
      reviewStatus: token(caseDetail.review.reviewStatus),
      origin: token(caseDetail.origin),
      trigger: token(caseDetail.trigger),
      taxonomyVersion: token(caseDetail.taxonomyVersion),
      issueCodes,
      machineStatusSnapshot: token(caseDetail.machineStatusSnapshot),
      submittedAt: timestamp(caseDetail.submittedAt),
      reportedAttemptOrdinal: integer(caseDetail.reportedAttemptOrdinal),
      reportedGenerationId: uuid(caseDetail.reportedGenerationId),
      source: {
        sha256: hash(caseDetail.source.originalSha256),
        decodedWidth: finiteNumber(caseDetail.source.decodedWidth),
        decodedHeight: finiteNumber(caseDetail.source.decodedHeight),
        byteCount: finiteNumber(caseDetail.source.byteCount),
      },
    },
    session: {
      sessionId: uuid(session.sessionId),
      status: token(session.status),
      roomId: uuid(session.roomId),
      attemptCount: integer(session.attemptCount),
      createdAt: timestamp(session.createdAt),
      updatedAt: timestamp(session.updatedAt),
    },
    attempt: {
      attemptOrdinal,
      reported,
      intent: token(source.attempt?.intent ?? generation.intent),
      associatedAt: timestamp(source.attempt?.associatedAt ?? source.associatedAt),
      generationId: uuid(generation.generationId),
      parentGenerationId: uuid(generation.parentGenerationId),
      lineageSeq: integer(generation.lineageSeq),
      runId: token(generation.runId),
      createdAt: timestamp(generation.createdAt),
      completedAt: timestamp(generation.completedAt),
    },
    generation: {
      status: token(generation.status),
      failureReason: detail(generation.failureReason),
    },
    analysis: {
      metricStatus,
      collisionStatus,
      analysisStatus: token(generation.analysisStatus),
      analysisReason: detail(generation.analysisReason),
      recoverySafeFailureState,
      frame: projectFrame(generation.frame),
    },
    engineFingerprint: fingerprint,
    productionAuthority: {
      metricStatus,
      collisionStatus,
      recoverySafeFailureState,
      camera: fingerprint
        ? {
            calibrationVersion: fingerprint.engineVersions.cameraCalibration,
            authorityVersion: fingerprint.engineVersions.cameraAuthority,
          }
        : null,
      collision: fingerprint
        ? {
            version: fingerprint.engineVersions.collision,
            emptyAuthoritativeVersion:
              fingerprint.engineVersions.emptyAuthoritativeCollision,
          }
        : null,
    },
    metricDecision: parseAfcDiagnosticAdminMetricDecisionDto(generation.metricDecision),
    legacyMetricConclusion: parseAfcDiagnosticAdminLegacyMetricConclusion(
      generation.legacyMetricConclusion,
    ),
    artifacts: {
      empty: projectArtifact(generation.empty),
      tiled: projectArtifact(generation.tiled),
      original: projectOriginal(generation.original),
    },
  };
}

export function serializeAfcDiagnosticSelectedAttemptExport(
  bundle: AfcDiagnosticSelectedAttemptExport,
): string {
  return JSON.stringify(bundle, null, 2);
}

async function defaultWriteText(text: string): Promise<void> {
  if (typeof navigator === "undefined" || typeof navigator.clipboard?.writeText !== "function") {
    throw new Error("clipboard unavailable");
  }
  await navigator.clipboard.writeText(text);
}

export async function copyAfcDiagnosticSelectedAttemptExport(
  source: AfcDiagnosticSelectedAttemptExportSource,
  options?: Readonly<{
    now?: () => Date;
    writeText?: (text: string) => Promise<void>;
  }>,
): Promise<
  | { ok: true; text: string }
  | { ok: false; text: string | null }
> {
  let text: string | null = null;
  try {
    const now = options?.now ?? (() => new Date());
    const bundle = buildAfcDiagnosticSelectedAttemptExport(
      source,
      now().toISOString(),
    );
    text = serializeAfcDiagnosticSelectedAttemptExport(bundle);
    await (options?.writeText ?? defaultWriteText)(text);
    return { ok: true, text };
  } catch {
    return { ok: false, text };
  }
}
