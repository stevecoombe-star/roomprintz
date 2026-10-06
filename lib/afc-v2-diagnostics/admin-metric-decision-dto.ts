/**
 * Browser-safe Admin metric-decision DTO.
 *
 * This module decodes the sanitized inspector payload. It does not read
 * database JSON and does not import the runtime metric parser.
 */

export const AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION =
  "afc-v2-metric-decision-diagnostic/v1" as const;

export const AFC_DIAGNOSTIC_ADMIN_METRIC_FALLBACK_CONSTANT_NAME =
  "AUTO_METRIC_SCALE" as const;

export const AFC_DIAGNOSTIC_METRIC_PATHS = ["path_a", "path_b", "none"] as const;
export type AfcDiagnosticMetricPath = (typeof AFC_DIAGNOSTIC_METRIC_PATHS)[number];

export const AFC_DIAGNOSTIC_METRIC_AUTHORITIES = [
  "none",
  "gemini_width_back_span_experimental",
  "gemini_observed_span_physical_estimate",
] as const;
export type AfcDiagnosticMetricAuthority =
  (typeof AFC_DIAGNOSTIC_METRIC_AUTHORITIES)[number];

export const AFC_DIAGNOSTIC_METRIC_SAFE_FAILURES = [
  "none",
  "metric_fallback",
  "collision_empty",
] as const;
export type AfcDiagnosticMetricSafeFailure =
  (typeof AFC_DIAGNOSTIC_METRIC_SAFE_FAILURES)[number];

export const AFC_DIAGNOSTIC_METRIC_DISPOSITIONS = [
  "not_reached",
  "evaluated",
] as const;
export type AfcDiagnosticMetricDisposition =
  (typeof AFC_DIAGNOSTIC_METRIC_DISPOSITIONS)[number];

export const AFC_DIAGNOSTIC_METRIC_SANITY = [
  "inside",
  "outside",
  "not_evaluated",
] as const;
export type AfcDiagnosticMetricSanity =
  (typeof AFC_DIAGNOSTIC_METRIC_SANITY)[number];

export const AFC_DIAGNOSTIC_METRIC_LAUNCH_DISPOSITIONS = [
  "suppressed_complete_back_geometry",
  "not_launched_no_candidate",
  "not_launched_empty_bytes_missing",
  "not_launched_empty_mime_invalid",
  "not_launched_controlled_fixture",
  "launched",
  "launch_failed",
  "not_reached",
] as const;
export type AfcDiagnosticMetricLaunchDisposition =
  (typeof AFC_DIAGNOSTIC_METRIC_LAUNCH_DISPOSITIONS)[number];

export const AFC_DIAGNOSTIC_METRIC_LINEAGE_STATUSES = [
  "lineage_rejected",
  "not_lineage_rejected",
  "not_evaluated",
] as const;
export type AfcDiagnosticMetricLineageStatus =
  (typeof AFC_DIAGNOSTIC_METRIC_LINEAGE_STATUSES)[number];

const TOKEN = /^[A-Za-z0-9_.:/+-]{1,160}$/;
const REASON = /^[a-z0-9_]{1,80}$/;
const HASH = /^[a-f0-9]{16,128}$/i;
/** Durable floor keys are `x,y|x,y|x,y|x,y`, not reason tokens. */
const FLOOR_AUTHORITY_KEY = /^[A-Za-z0-9_.:/+|,-]{1,320}$/;

const PRIVATE_TEXT = [
  "storage_bucket",
  "storage_path",
  "signedurl",
  "signed_url",
  "provider_provenance",
  "providerprovenance",
  "service_role",
  "access_token",
  "supabase_service_role",
  "vibode_admin_email",
  "x-amz-signature",
  "storage/v1/object",
  "token=",
  "diagnostic_payload",
  "production_authority",
];

const FAIL = Symbol("metric-decision-dto-fail");
type Fail = typeof FAIL;

function isFail(value: unknown): value is Fail {
  return value === FAIL;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function publishAfcDiagnosticMetricToken(
  value: string | null,
): string | null {
  if (value == null) return null;
  return TOKEN.test(value) ? value : null;
}

export function publishAfcDiagnosticMetricFloorAuthorityKey(
  value: string | null,
): string | null {
  if (value == null) return null;
  if (/\s|https?:\/\//i.test(value)) return null;
  return FLOOR_AUTHORITY_KEY.test(value) ? value : null;
}

export function publishAfcDiagnosticMetricHash(
  value: string | null,
): string | null {
  if (value == null) return null;
  return HASH.test(value) ? value : null;
}

export function publishAfcDiagnosticMetricCodes(
  codes: readonly string[],
): readonly string[] {
  return Object.freeze(codes.filter((code) => REASON.test(code)));
}

export function publishAfcDiagnosticMetricDetail(
  value: string | null,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 160) return null;
  if (/https?:\/\//i.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (PRIVATE_TEXT.some((needle) => lower.includes(needle))) return null;
  if (/[^\x20-\x7E]/.test(trimmed)) return null;
  return trimmed;
}

export type AfcDiagnosticAdminMetricNumericTriple = Readonly<{
  low: number;
  best: number;
  high: number;
}>;

export type AfcDiagnosticAdminMetricPoint = Readonly<{
  x: number;
  y: number;
}>;

export type AfcDiagnosticAdminMetricHostAcceptance = Readonly<{
  class: string;
  reasonCodes: readonly string[];
}>;

export type AfcDiagnosticAdminMetricPathBHostAcceptance = Readonly<{
  class: string;
  reasonCodes: readonly string[];
  candidateScale: number | null;
}>;

export type AfcDiagnosticAdminMetricDecisionRecordedValue = Readonly<{
  generationId: string;
  finalDecision: Readonly<{
    selectedPath: AfcDiagnosticMetricPath;
    accepted: boolean;
    authority: AfcDiagnosticMetricAuthority;
    metricScale: number | null;
    autoMetricScale: number | null;
    fallbackApplied: boolean;
    safeFailureState: AfcDiagnosticMetricSafeFailure | null;
    winningReasonCodes: readonly string[];
    rejectedCandidatePresent: boolean;
    rejectedCandidateScale: number | null;
    rejectedCandidateFinite: boolean;
  }>;
  pathA: Readonly<{
    disposition: AfcDiagnosticMetricDisposition;
    roomPrior: Readonly<{
      attempted: boolean;
      provider: string | null;
      model: string | null;
      promptVersion: string | null;
      observability: string | null;
      estimatedRoomWidthM: AfcDiagnosticAdminMetricNumericTriple | null;
      estimatedRoomDepthM: AfcDiagnosticAdminMetricNumericTriple | null;
      estimatedCeilingHeightM: number | null;
      modelConfidence: number | null;
      hostAcceptance: AfcDiagnosticAdminMetricHostAcceptance | null;
      failure: Readonly<{
        failureClass: string;
        failureStage: string;
        providerStatus: number | null;
        contractValidationReason: string | null;
        safeDetail: string | null;
      }> | null;
    }>;
    geometryCorrespondence: Readonly<{
      selectionStatus: string | null;
      selectionReasonCodes: readonly string[];
      selectedSpan: Readonly<{
        id: string;
        source: string;
        role: string;
        canonicalLength: number;
        imageA: AfcDiagnosticAdminMetricPoint;
        imageB: AfcDiagnosticAdminMetricPoint;
        correspondenceSpanTrust: string;
        correspondenceSource: string | null;
        s4aCandidateId: string | null;
        sourceSeamId: string | null;
      }> | null;
      rejectedAlternatives: readonly Readonly<{
        id: string;
        role: string;
        reasonCode: string;
      }>[];
    }>;
    spanTrust: Readonly<{
      trusted: boolean | null;
      reasonCodes: readonly string[];
      s4aSafetyPresent: boolean | null;
      observedSpanOnly: boolean | null;
      hiddenContinuation: boolean | null;
      geometryManufactured: boolean | null;
    }>;
    exactGrid: Readonly<{
      consultedTier: string | null;
      trustSelectedBackSpanAsFullWidth: boolean | null;
      exactGridCompatible: boolean | null;
      oldCompatibilityTier: string | null;
      emptyAuthoritativeCompatibilityTier: string | null;
      roomBoundaryCompatibilityTier: string | null;
    }>;
    derivation: Readonly<{
      parsedWidthBest: number | null;
      physicalMetres: number | null;
      canonicalGaugeLength: number | null;
      candidateScaleBeforeFallback: number | null;
      candidateFinite: boolean;
      catastrophicSanity: AfcDiagnosticMetricSanity;
      accepted: boolean;
      authority: AfcDiagnosticMetricAuthority;
      reasonCodes: readonly string[];
    }>;
  }>;
  pathB: Readonly<{
    selection: Readonly<{
      selectionAttempted: boolean;
      selectionStatus: string | null;
      selectionReasonCodes: readonly string[];
      selectedCandidateId: string | null;
      pathAGeometry: Readonly<{
        exists: boolean;
        selectedId: string | null;
        reasonCodes: readonly string[];
      }>;
      suppressWhenCompleteBackGeometryExists: boolean;
    }>;
    launchDisposition: AfcDiagnosticMetricLaunchDisposition;
    estimatorLaunched: boolean;
    hostGeometry: Readonly<{
      id: string;
      role: string;
      canonicalLength: number;
      imageA: AfcDiagnosticAdminMetricPoint;
      imageB: AfcDiagnosticAdminMetricPoint;
      sourceSeamId: string;
      floorAuthorityKey: string;
      s4aCandidateId: string;
      freezeReceiptVersion: string | null;
      freezePayloadSha256: string | null;
      overlayImageHash: string | null;
    }> | null;
    model: Readonly<{
      provider: string | null;
      model: string | null;
      promptVersion: string | null;
      schemaVersion: string | null;
      estimateStatus: string | null;
      estimatedLengthM: AfcDiagnosticAdminMetricNumericTriple | null;
      modelConfidence: number | null;
      hostAcceptance: AfcDiagnosticAdminMetricPathBHostAcceptance | null;
    }>;
    derivation: Readonly<{
      candidateScaleBeforeFallback: number | null;
      lineageStatus: AfcDiagnosticMetricLineageStatus;
      catastrophicSanity: AfcDiagnosticMetricSanity;
      accepted: boolean;
      authority: AfcDiagnosticMetricAuthority;
      reasonCodes: readonly string[];
    }>;
  }>;
  fallback: Readonly<{
    used: boolean;
    numericFallback: number | null;
    constantName: typeof AFC_DIAGNOSTIC_ADMIN_METRIC_FALLBACK_CONSTANT_NAME;
    winningPath: AfcDiagnosticMetricPath;
    reasonCodes: readonly string[];
  }>;
}>;

export type AfcDiagnosticAdminMetricDecision =
  | Readonly<{
      kind: "recorded";
      schemaVersion: typeof AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION;
      value: AfcDiagnosticAdminMetricDecisionRecordedValue;
    }>
  | Readonly<{
      kind: "capture_failed";
      schemaVersion: typeof AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION;
      generationId: string;
    }>
  | Readonly<{
      kind: "unsupported_schema";
      schemaVersion: string;
    }>
  | Readonly<{ kind: "unreadable" }>
  | null;

export type AfcDiagnosticAdminLegacyMetricConclusion = Readonly<{
  metricScale: number | null;
  autoMetricScale: number | null;
  accepted: boolean | null;
  path: AfcDiagnosticMetricPath | null;
  authority: AfcDiagnosticMetricAuthority | null;
  fallbackApplied: boolean | null;
  safeFailureState: AfcDiagnosticMetricSafeFailure | null;
}>;

function unreadable(): AfcDiagnosticAdminMetricDecision {
  return Object.freeze({ kind: "unreadable" });
}

function optToken(value: unknown): string | null | Fail {
  if (value == null) return null;
  if (typeof value !== "string") return FAIL;
  const published = publishAfcDiagnosticMetricToken(value);
  return published ?? FAIL;
}

function reqToken(value: unknown): string | Fail {
  const published = optToken(value);
  if (isFail(published) || published == null) return FAIL;
  return published;
}

function optBool(value: unknown): boolean | null | Fail {
  if (value == null) return null;
  if (typeof value !== "boolean") return FAIL;
  return value;
}

function reqBool(value: unknown): boolean | Fail {
  if (typeof value !== "boolean") return FAIL;
  return value;
}

function optNum(value: unknown): number | null | Fail {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return FAIL;
  return value;
}

function reqNum(value: unknown): number | Fail {
  if (typeof value !== "number" || !Number.isFinite(value)) return FAIL;
  return value;
}

function reqCodes(value: unknown): readonly string[] | Fail {
  if (!Array.isArray(value)) return FAIL;
  const codes: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !REASON.test(item)) return FAIL;
    codes.push(item);
  }
  return Object.freeze(codes);
}

function reqEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | Fail {
  if (typeof value !== "string" || !allowed.includes(value as T)) return FAIL;
  return value as T;
}

function optEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null | Fail {
  if (value == null) return null;
  return reqEnum(value, allowed);
}

function optDetail(value: unknown): string | null | Fail {
  if (value == null) return null;
  if (typeof value !== "string") return FAIL;
  return publishAfcDiagnosticMetricDetail(value);
}

function readTriple(
  value: unknown,
): AfcDiagnosticAdminMetricNumericTriple | null | Fail {
  if (value == null) return null;
  if (!isRecord(value)) return FAIL;
  const low = reqNum(value.low);
  if (isFail(low)) return FAIL;
  const best = reqNum(value.best);
  if (isFail(best)) return FAIL;
  const high = reqNum(value.high);
  if (isFail(high)) return FAIL;
  return Object.freeze({ low, best, high });
}

function readPoint(value: unknown): AfcDiagnosticAdminMetricPoint | Fail {
  if (!isRecord(value)) return FAIL;
  const x = reqNum(value.x);
  if (isFail(x)) return FAIL;
  const y = reqNum(value.y);
  if (isFail(y)) return FAIL;
  return Object.freeze({ x, y });
}

function readHostAcceptance(
  value: unknown,
): AfcDiagnosticAdminMetricHostAcceptance | null | Fail {
  if (value == null) return null;
  if (!isRecord(value)) return FAIL;
  const hostClass = reqToken(value.class);
  if (isFail(hostClass)) return FAIL;
  const reasonCodes = reqCodes(value.reasonCodes);
  if (isFail(reasonCodes)) return FAIL;
  return Object.freeze({ class: hostClass, reasonCodes });
}

function readFailure(
  value: unknown,
): AfcDiagnosticAdminMetricDecisionRecordedValue["pathA"]["roomPrior"]["failure"] | Fail {
  if (value == null) return null;
  if (!isRecord(value)) return FAIL;
  const failureClass = reqToken(value.failureClass);
  if (isFail(failureClass)) return FAIL;
  const failureStage = reqToken(value.failureStage);
  if (isFail(failureStage)) return FAIL;
  const providerStatus = optNum(value.providerStatus);
  if (isFail(providerStatus)) return FAIL;
  const contractValidationReason = optToken(value.contractValidationReason);
  if (isFail(contractValidationReason)) return FAIL;
  const safeDetail = optDetail(value.safeDetail);
  if (isFail(safeDetail)) return FAIL;
  return Object.freeze({
    failureClass,
    failureStage,
    providerStatus,
    contractValidationReason,
    safeDetail,
  });
}

function readFinal(
  value: unknown,
): AfcDiagnosticAdminMetricDecisionRecordedValue["finalDecision"] | null {
  if (!isRecord(value)) return null;
  const selectedPath = reqEnum(value.selectedPath, AFC_DIAGNOSTIC_METRIC_PATHS);
  if (isFail(selectedPath)) return null;
  const accepted = reqBool(value.accepted);
  if (isFail(accepted)) return null;
  const authority = reqEnum(value.authority, AFC_DIAGNOSTIC_METRIC_AUTHORITIES);
  if (isFail(authority)) return null;
  const metricScale = optNum(value.metricScale);
  if (isFail(metricScale)) return null;
  const autoMetricScale = optNum(value.autoMetricScale);
  if (isFail(autoMetricScale)) return null;
  const fallbackApplied = reqBool(value.fallbackApplied);
  if (isFail(fallbackApplied)) return null;
  const safeFailureState = optEnum(
    value.safeFailureState,
    AFC_DIAGNOSTIC_METRIC_SAFE_FAILURES,
  );
  if (isFail(safeFailureState)) return null;
  const winningReasonCodes = reqCodes(value.winningReasonCodes);
  if (isFail(winningReasonCodes)) return null;
  const rejectedCandidatePresent = reqBool(value.rejectedCandidatePresent);
  if (isFail(rejectedCandidatePresent)) return null;
  const rejectedCandidateScale = optNum(value.rejectedCandidateScale);
  if (isFail(rejectedCandidateScale)) return null;
  const rejectedCandidateFinite = reqBool(value.rejectedCandidateFinite);
  if (isFail(rejectedCandidateFinite)) return null;
  return Object.freeze({
    selectedPath,
    accepted,
    authority,
    metricScale,
    autoMetricScale,
    fallbackApplied,
    safeFailureState,
    winningReasonCodes,
    rejectedCandidatePresent,
    rejectedCandidateScale,
    rejectedCandidateFinite,
  });
}

function readRoomPrior(
  value: unknown,
): AfcDiagnosticAdminMetricDecisionRecordedValue["pathA"]["roomPrior"] | null {
  if (!isRecord(value)) return null;
  const attempted = reqBool(value.attempted);
  if (isFail(attempted)) return null;
  const provider = optToken(value.provider);
  if (isFail(provider)) return null;
  const model = optToken(value.model);
  if (isFail(model)) return null;
  const promptVersion = optToken(value.promptVersion);
  if (isFail(promptVersion)) return null;
  const observability = optToken(value.observability);
  if (isFail(observability)) return null;
  const estimatedRoomWidthM = readTriple(value.estimatedRoomWidthM);
  if (isFail(estimatedRoomWidthM)) return null;
  const estimatedRoomDepthM = readTriple(value.estimatedRoomDepthM);
  if (isFail(estimatedRoomDepthM)) return null;
  const estimatedCeilingHeightM = optNum(value.estimatedCeilingHeightM);
  if (isFail(estimatedCeilingHeightM)) return null;
  const modelConfidence = optNum(value.modelConfidence);
  if (isFail(modelConfidence)) return null;
  const hostAcceptance = readHostAcceptance(value.hostAcceptance);
  if (isFail(hostAcceptance)) return null;
  const failure = readFailure(value.failure);
  if (isFail(failure)) return null;
  return Object.freeze({
    attempted,
    provider,
    model,
    promptVersion,
    observability,
    estimatedRoomWidthM,
    estimatedRoomDepthM,
    estimatedCeilingHeightM,
    modelConfidence,
    hostAcceptance,
    failure,
  });
}

function readSelectedSpan(
  value: unknown,
): AfcDiagnosticAdminMetricDecisionRecordedValue["pathA"]["geometryCorrespondence"]["selectedSpan"] | Fail {
  if (value == null) return null;
  if (!isRecord(value)) return FAIL;
  const id = reqToken(value.id);
  if (isFail(id)) return FAIL;
  const source = reqToken(value.source);
  if (isFail(source)) return FAIL;
  const role = reqToken(value.role);
  if (isFail(role)) return FAIL;
  const canonicalLength = reqNum(value.canonicalLength);
  if (isFail(canonicalLength)) return FAIL;
  const imageA = readPoint(value.imageA);
  if (isFail(imageA)) return FAIL;
  const imageB = readPoint(value.imageB);
  if (isFail(imageB)) return FAIL;
  const correspondenceSpanTrust = reqToken(value.correspondenceSpanTrust);
  if (isFail(correspondenceSpanTrust)) return FAIL;
  const correspondenceSource = optToken(value.correspondenceSource);
  if (isFail(correspondenceSource)) return FAIL;
  const s4aCandidateId = optToken(value.s4aCandidateId);
  if (isFail(s4aCandidateId)) return FAIL;
  const sourceSeamId = optToken(value.sourceSeamId);
  if (isFail(sourceSeamId)) return FAIL;
  return Object.freeze({
    id,
    source,
    role,
    canonicalLength,
    imageA,
    imageB,
    correspondenceSpanTrust,
    correspondenceSource,
    s4aCandidateId,
    sourceSeamId,
  });
}

function readAlternatives(
  value: unknown,
): AfcDiagnosticAdminMetricDecisionRecordedValue["pathA"]["geometryCorrespondence"]["rejectedAlternatives"] | Fail {
  if (!Array.isArray(value)) return FAIL;
  const alternatives = [];
  for (const item of value) {
    if (!isRecord(item)) return FAIL;
    const id = reqToken(item.id);
    if (isFail(id)) return FAIL;
    const role = reqToken(item.role);
    if (isFail(role)) return FAIL;
    if (typeof item.reasonCode !== "string" || !REASON.test(item.reasonCode)) {
      return FAIL;
    }
    alternatives.push(Object.freeze({
      id,
      role,
      reasonCode: item.reasonCode,
    }));
  }
  return Object.freeze(alternatives);
}

function readPathA(
  value: unknown,
): AfcDiagnosticAdminMetricDecisionRecordedValue["pathA"] | null {
  if (!isRecord(value)) return null;
  const disposition = reqEnum(value.disposition, AFC_DIAGNOSTIC_METRIC_DISPOSITIONS);
  if (isFail(disposition)) return null;
  const roomPrior = readRoomPrior(value.roomPrior);
  if (!roomPrior) return null;
  if (!isRecord(value.geometryCorrespondence)) return null;
  const geometry = value.geometryCorrespondence;
  const selectionStatus = optToken(geometry.selectionStatus);
  if (isFail(selectionStatus)) return null;
  const selectionReasonCodes = reqCodes(geometry.selectionReasonCodes);
  if (isFail(selectionReasonCodes)) return null;
  const selectedSpan = readSelectedSpan(geometry.selectedSpan);
  if (isFail(selectedSpan)) return null;
  const rejectedAlternatives = readAlternatives(geometry.rejectedAlternatives);
  if (isFail(rejectedAlternatives)) return null;
  if (!isRecord(value.spanTrust)) return null;
  const trust = value.spanTrust;
  const trusted = optBool(trust.trusted);
  if (isFail(trusted)) return null;
  const trustReasonCodes = reqCodes(trust.reasonCodes);
  if (isFail(trustReasonCodes)) return null;
  const s4aSafetyPresent = optBool(trust.s4aSafetyPresent);
  if (isFail(s4aSafetyPresent)) return null;
  const observedSpanOnly = optBool(trust.observedSpanOnly);
  if (isFail(observedSpanOnly)) return null;
  const hiddenContinuation = optBool(trust.hiddenContinuation);
  if (isFail(hiddenContinuation)) return null;
  const geometryManufactured = optBool(trust.geometryManufactured);
  if (isFail(geometryManufactured)) return null;
  if (!isRecord(value.exactGrid)) return null;
  const grid = value.exactGrid;
  const consultedTier = optToken(grid.consultedTier);
  if (isFail(consultedTier)) return null;
  const trustSelectedBackSpanAsFullWidth = optBool(grid.trustSelectedBackSpanAsFullWidth);
  if (isFail(trustSelectedBackSpanAsFullWidth)) return null;
  const exactGridCompatible = optBool(grid.exactGridCompatible);
  if (isFail(exactGridCompatible)) return null;
  const oldCompatibilityTier = optToken(grid.oldCompatibilityTier);
  if (isFail(oldCompatibilityTier)) return null;
  const emptyAuthoritativeCompatibilityTier = optToken(
    grid.emptyAuthoritativeCompatibilityTier,
  );
  if (isFail(emptyAuthoritativeCompatibilityTier)) return null;
  const roomBoundaryCompatibilityTier = optToken(grid.roomBoundaryCompatibilityTier);
  if (isFail(roomBoundaryCompatibilityTier)) return null;
  if (!isRecord(value.derivation)) return null;
  const derivation = value.derivation;
  const parsedWidthBest = optNum(derivation.parsedWidthBest);
  if (isFail(parsedWidthBest)) return null;
  const physicalMetres = optNum(derivation.physicalMetres);
  if (isFail(physicalMetres)) return null;
  const canonicalGaugeLength = optNum(derivation.canonicalGaugeLength);
  if (isFail(canonicalGaugeLength)) return null;
  const candidateScaleBeforeFallback = optNum(derivation.candidateScaleBeforeFallback);
  if (isFail(candidateScaleBeforeFallback)) return null;
  const candidateFinite = reqBool(derivation.candidateFinite);
  if (isFail(candidateFinite)) return null;
  const catastrophicSanity = reqEnum(
    derivation.catastrophicSanity,
    AFC_DIAGNOSTIC_METRIC_SANITY,
  );
  if (isFail(catastrophicSanity)) return null;
  const accepted = reqBool(derivation.accepted);
  if (isFail(accepted)) return null;
  const authority = reqEnum(derivation.authority, AFC_DIAGNOSTIC_METRIC_AUTHORITIES);
  if (isFail(authority)) return null;
  const reasonCodes = reqCodes(derivation.reasonCodes);
  if (isFail(reasonCodes)) return null;
  return Object.freeze({
    disposition,
    roomPrior,
    geometryCorrespondence: Object.freeze({
      selectionStatus,
      selectionReasonCodes,
      selectedSpan,
      rejectedAlternatives,
    }),
    spanTrust: Object.freeze({
      trusted,
      reasonCodes: trustReasonCodes,
      s4aSafetyPresent,
      observedSpanOnly,
      hiddenContinuation,
      geometryManufactured,
    }),
    exactGrid: Object.freeze({
      consultedTier,
      trustSelectedBackSpanAsFullWidth,
      exactGridCompatible,
      oldCompatibilityTier,
      emptyAuthoritativeCompatibilityTier,
      roomBoundaryCompatibilityTier,
    }),
    derivation: Object.freeze({
      parsedWidthBest,
      physicalMetres,
      canonicalGaugeLength,
      candidateScaleBeforeFallback,
      candidateFinite,
      catastrophicSanity,
      accepted,
      authority,
      reasonCodes,
    }),
  });
}

function readPathBHostAcceptance(
  value: unknown,
): AfcDiagnosticAdminMetricPathBHostAcceptance | null | Fail {
  if (value == null) return null;
  if (!isRecord(value)) return FAIL;
  const hostClass = reqToken(value.class);
  if (isFail(hostClass)) return FAIL;
  const reasonCodes = reqCodes(value.reasonCodes);
  if (isFail(reasonCodes)) return FAIL;
  const candidateScale = optNum(value.candidateScale);
  if (isFail(candidateScale)) return FAIL;
  return Object.freeze({ class: hostClass, reasonCodes, candidateScale });
}

function readHostGeometry(
  value: unknown,
): AfcDiagnosticAdminMetricDecisionRecordedValue["pathB"]["hostGeometry"] | Fail {
  if (value == null) return null;
  if (!isRecord(value)) return FAIL;
  const id = reqToken(value.id);
  if (isFail(id)) return FAIL;
  const role = reqToken(value.role);
  if (isFail(role)) return FAIL;
  const canonicalLength = reqNum(value.canonicalLength);
  if (isFail(canonicalLength)) return FAIL;
  const imageA = readPoint(value.imageA);
  if (isFail(imageA)) return FAIL;
  const imageB = readPoint(value.imageB);
  if (isFail(imageB)) return FAIL;
  const sourceSeamId = reqToken(value.sourceSeamId);
  if (isFail(sourceSeamId)) return FAIL;
  const floorAuthorityKey = publishAfcDiagnosticMetricFloorAuthorityKey(
    typeof value.floorAuthorityKey === "string" ? value.floorAuthorityKey : null,
  );
  if (floorAuthorityKey == null) return FAIL;
  const s4aCandidateId = reqToken(value.s4aCandidateId);
  if (isFail(s4aCandidateId)) return FAIL;
  const freezeReceiptVersion = optToken(value.freezeReceiptVersion);
  if (isFail(freezeReceiptVersion)) return FAIL;
  const freezePayloadSha256 = value.freezePayloadSha256 == null
    ? null
    : publishAfcDiagnosticMetricHash(
        typeof value.freezePayloadSha256 === "string" ? value.freezePayloadSha256 : null,
      );
  if (value.freezePayloadSha256 != null && freezePayloadSha256 == null) return FAIL;
  const overlayImageHash = value.overlayImageHash == null
    ? null
    : publishAfcDiagnosticMetricHash(
        typeof value.overlayImageHash === "string" ? value.overlayImageHash : null,
      );
  if (value.overlayImageHash != null && overlayImageHash == null) return FAIL;
  return Object.freeze({
    id,
    role,
    canonicalLength,
    imageA,
    imageB,
    sourceSeamId,
    floorAuthorityKey,
    s4aCandidateId,
    freezeReceiptVersion,
    freezePayloadSha256,
    overlayImageHash,
  });
}

function readPathB(
  value: unknown,
): AfcDiagnosticAdminMetricDecisionRecordedValue["pathB"] | null {
  if (!isRecord(value)) return null;
  if (!isRecord(value.selection)) return null;
  const selection = value.selection;
  const selectionAttempted = reqBool(selection.selectionAttempted);
  if (isFail(selectionAttempted)) return null;
  const selectionStatus = optToken(selection.selectionStatus);
  if (isFail(selectionStatus)) return null;
  const selectionReasonCodes = reqCodes(selection.selectionReasonCodes);
  if (isFail(selectionReasonCodes)) return null;
  const selectedCandidateId = optToken(selection.selectedCandidateId);
  if (isFail(selectedCandidateId)) return null;
  if (!isRecord(selection.pathAGeometry)) return null;
  const pathAExists = reqBool(selection.pathAGeometry.exists);
  if (isFail(pathAExists)) return null;
  const pathASelectedId = optToken(selection.pathAGeometry.selectedId);
  if (isFail(pathASelectedId)) return null;
  const pathAReasonCodes = reqCodes(selection.pathAGeometry.reasonCodes);
  if (isFail(pathAReasonCodes)) return null;
  const suppressWhenCompleteBackGeometryExists = reqBool(
    selection.suppressWhenCompleteBackGeometryExists,
  );
  if (isFail(suppressWhenCompleteBackGeometryExists)) return null;
  const launchDisposition = reqEnum(
    value.launchDisposition,
    AFC_DIAGNOSTIC_METRIC_LAUNCH_DISPOSITIONS,
  );
  if (isFail(launchDisposition)) return null;
  const estimatorLaunched = reqBool(value.estimatorLaunched);
  if (isFail(estimatorLaunched)) return null;
  const hostGeometry = readHostGeometry(value.hostGeometry);
  if (isFail(hostGeometry)) return null;
  if (!isRecord(value.model)) return null;
  const model = value.model;
  const provider = optToken(model.provider);
  if (isFail(provider)) return null;
  const modelName = optToken(model.model);
  if (isFail(modelName)) return null;
  const promptVersion = optToken(model.promptVersion);
  if (isFail(promptVersion)) return null;
  const schemaVersion = optToken(model.schemaVersion);
  if (isFail(schemaVersion)) return null;
  const estimateStatus = optToken(model.estimateStatus);
  if (isFail(estimateStatus)) return null;
  const estimatedLengthM = readTriple(model.estimatedLengthM);
  if (isFail(estimatedLengthM)) return null;
  const modelConfidence = optNum(model.modelConfidence);
  if (isFail(modelConfidence)) return null;
  const hostAcceptance = readPathBHostAcceptance(model.hostAcceptance);
  if (isFail(hostAcceptance)) return null;
  if (!isRecord(value.derivation)) return null;
  const derivation = value.derivation;
  const candidateScaleBeforeFallback = optNum(derivation.candidateScaleBeforeFallback);
  if (isFail(candidateScaleBeforeFallback)) return null;
  const lineageStatus = reqEnum(
    derivation.lineageStatus,
    AFC_DIAGNOSTIC_METRIC_LINEAGE_STATUSES,
  );
  if (isFail(lineageStatus)) return null;
  const catastrophicSanity = reqEnum(
    derivation.catastrophicSanity,
    AFC_DIAGNOSTIC_METRIC_SANITY,
  );
  if (isFail(catastrophicSanity)) return null;
  const accepted = reqBool(derivation.accepted);
  if (isFail(accepted)) return null;
  const authority = reqEnum(derivation.authority, AFC_DIAGNOSTIC_METRIC_AUTHORITIES);
  if (isFail(authority)) return null;
  const reasonCodes = reqCodes(derivation.reasonCodes);
  if (isFail(reasonCodes)) return null;
  return Object.freeze({
    selection: Object.freeze({
      selectionAttempted,
      selectionStatus,
      selectionReasonCodes,
      selectedCandidateId,
      pathAGeometry: Object.freeze({
        exists: pathAExists,
        selectedId: pathASelectedId,
        reasonCodes: pathAReasonCodes,
      }),
      suppressWhenCompleteBackGeometryExists,
    }),
    launchDisposition,
    estimatorLaunched,
    hostGeometry,
    model: Object.freeze({
      provider,
      model: modelName,
      promptVersion,
      schemaVersion,
      estimateStatus,
      estimatedLengthM,
      modelConfidence,
      hostAcceptance,
    }),
    derivation: Object.freeze({
      candidateScaleBeforeFallback,
      lineageStatus,
      catastrophicSanity,
      accepted,
      authority,
      reasonCodes,
    }),
  });
}

function readFallback(
  value: unknown,
): AfcDiagnosticAdminMetricDecisionRecordedValue["fallback"] | null {
  if (!isRecord(value)) return null;
  const used = reqBool(value.used);
  if (isFail(used)) return null;
  const numericFallback = optNum(value.numericFallback);
  if (isFail(numericFallback)) return null;
  if (value.constantName !== AFC_DIAGNOSTIC_ADMIN_METRIC_FALLBACK_CONSTANT_NAME) {
    return null;
  }
  const winningPath = reqEnum(value.winningPath, AFC_DIAGNOSTIC_METRIC_PATHS);
  if (isFail(winningPath)) return null;
  const reasonCodes = reqCodes(value.reasonCodes);
  if (isFail(reasonCodes)) return null;
  return Object.freeze({
    used,
    numericFallback,
    constantName: AFC_DIAGNOSTIC_ADMIN_METRIC_FALLBACK_CONSTANT_NAME,
    winningPath,
    reasonCodes,
  });
}

function readRecorded(
  value: unknown,
): AfcDiagnosticAdminMetricDecisionRecordedValue | null {
  if (!isRecord(value)) return null;
  const generationId = reqToken(value.generationId);
  if (isFail(generationId)) return null;
  const finalDecision = readFinal(value.finalDecision);
  if (!finalDecision) return null;
  const pathA = readPathA(value.pathA);
  if (!pathA) return null;
  const pathB = readPathB(value.pathB);
  if (!pathB) return null;
  const fallback = readFallback(value.fallback);
  if (!fallback) return null;
  return Object.freeze({
    generationId,
    finalDecision,
    pathA,
    pathB,
    fallback,
  });
}

export function parseAfcDiagnosticAdminMetricDecisionDto(
  value: unknown,
): AfcDiagnosticAdminMetricDecision {
  if (value == null) return null;
  if (!isRecord(value) || typeof value.kind !== "string") return unreadable();
  if (value.kind === "unreadable") return unreadable();
  if (value.kind === "unsupported_schema") {
    const schemaVersion = typeof value.schemaVersion === "string"
      ? publishAfcDiagnosticMetricToken(value.schemaVersion) ?? "unavailable"
      : "unavailable";
    return Object.freeze({ kind: "unsupported_schema", schemaVersion });
  }
  if (value.kind === "capture_failed") {
    if (value.schemaVersion !== AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION) {
      return unreadable();
    }
    const generationId = typeof value.generationId === "string"
      ? publishAfcDiagnosticMetricToken(value.generationId)
      : null;
    if (!generationId) return unreadable();
    return Object.freeze({
      kind: "capture_failed",
      schemaVersion: AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION,
      generationId,
    });
  }
  if (value.kind === "recorded") {
    if (value.schemaVersion !== AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION) {
      return unreadable();
    }
    const recorded = readRecorded(value.value);
    if (!recorded) return unreadable();
    return Object.freeze({
      kind: "recorded",
      schemaVersion: AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION,
      value: recorded,
    });
  }
  return unreadable();
}

export function parseAfcDiagnosticAdminLegacyMetricConclusion(
  value: unknown,
): AfcDiagnosticAdminLegacyMetricConclusion | null {
  if (!isRecord(value)) return null;
  const metricScale = typeof value.metricScale === "number" && Number.isFinite(value.metricScale)
    ? value.metricScale
    : null;
  const autoMetricScale = typeof value.autoMetricScale === "number" &&
      Number.isFinite(value.autoMetricScale)
    ? value.autoMetricScale
    : null;
  const accepted = typeof value.accepted === "boolean" ? value.accepted : null;
  const path = typeof value.path === "string" &&
      AFC_DIAGNOSTIC_METRIC_PATHS.includes(value.path as AfcDiagnosticMetricPath)
    ? value.path as AfcDiagnosticMetricPath
    : null;
  const authority = typeof value.authority === "string" &&
      AFC_DIAGNOSTIC_METRIC_AUTHORITIES.includes(
        value.authority as AfcDiagnosticMetricAuthority,
      )
    ? value.authority as AfcDiagnosticMetricAuthority
    : null;
  const fallbackApplied = typeof value.fallbackApplied === "boolean"
    ? value.fallbackApplied
    : null;
  const safeFailureState = typeof value.safeFailureState === "string" &&
      AFC_DIAGNOSTIC_METRIC_SAFE_FAILURES.includes(
        value.safeFailureState as AfcDiagnosticMetricSafeFailure,
      )
    ? value.safeFailureState as AfcDiagnosticMetricSafeFailure
    : null;
  if (
    metricScale == null &&
    autoMetricScale == null &&
    accepted == null &&
    path == null &&
    authority == null &&
    fallbackApplied == null
  ) {
    return null;
  }
  return Object.freeze({
    metricScale,
    autoMetricScale,
    accepted,
    path,
    authority,
    fallbackApplied,
    safeFailureState,
  });
}
