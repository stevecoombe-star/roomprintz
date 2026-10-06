/**
 * AFR-1B persistence contract for generation-scoped Auto Metric evidence.
 *
 * This module is a structural decoder for `metric_decision` JSON. It does
 * not project runtime receipts, call Gemini, or apply metric acceptance.
 * Null is the legacy and not-captured state. Unknown future schema versions
 * stay unsupported and are not read as V1.
 */

import type {
  AFC_V2_AUTO_METRIC_SCALE_VERSION,
  AutoMetricScaleAuthority,
} from "@/app/admin/3d-room-lab-v2/metric-auto-scale-contract";
import type {
  MetricCorrespondenceRejectionReason,
  MetricCorrespondenceSelection,
  MetricCorrespondenceSpanRole,
  MetricCorrespondenceSpanSource,
  MetricCorrespondenceSpanTrust,
  MetricSpanCorrespondenceSource,
} from "@/app/admin/3d-room-lab-v2/metric-correspondence-span-contract";
import type {
  MetricRangeM,
  MetricRoomPriorFailure,
  MetricRoomPriorHostAcceptanceClass,
  MetricRoomPriorObservability,
} from "@/app/admin/3d-room-lab-v2/metric-room-prior-contract";
import type { EmptyAuthoritativeCompatibilityTier } from "@/app/admin/3d-room-lab-v2/empty-authoritative-collision-authority-contract";
import type { EmptyOriginalCompatibilityTier } from "@/app/admin/3d-room-lab-v2/empty-original-registration-authority-contract";
import type {
  ObservedSpanEstimateHostAcceptanceClass,
  ObservedSpanPhysicalEstimate,
} from "@/app/admin/3d-room-lab-v2/observed-span-physical-estimate-contract";
import type {
  ObservedSpanJunctionProofType,
  ObservedSpanMetricSelection,
} from "@/app/admin/3d-room-lab-v2/observed-span-metric-candidate-contract";
import type { RoomCollisionAuthorityLineage } from "@/app/admin/3d-room-lab-v2/room-collision-authority-contract";

import type { AfcV2ProductionRoomAuthority } from "./production-authority-contract";
import type { ProductionAutoMetric } from "./production-auto-metric";
import type { AfcGenerationStatus } from "./production-store";

export const AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION =
  "afc-v2-metric-decision-diagnostic/v1" as const;

export const AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME =
  "AUTO_METRIC_SCALE" as const;

/**
 * Finite low/best/high triple. This is `MetricRangeM`. AFR-1B checks that
 * each component is a finite number and does not reorder or threshold it.
 */
export type AfcV2MetricNumericTriple = MetricRangeM;

export type AfcV2MetricDecisionProvider =
  | "google_gemini"
  | "controlled_fixture";

export type AfcV2MetricDecisionTerminalStatus = Exclude<
  AfcGenerationStatus,
  "running"
>;

export type AfcV2MetricDecisionSelectedPath = ProductionAutoMetric["path"];

export type AfcV2MetricDecisionSafeFailureState =
  | AfcV2ProductionRoomAuthority["recovery"]["safeFailureState"]
  | null;

export type AfcV2MetricCatastrophicSanity =
  | "inside"
  | "outside"
  | "not_evaluated";

export type AfcV2MetricPathBLineageStatus =
  | "lineage_rejected"
  | "not_lineage_rejected"
  | "not_evaluated";

export type AfcV2MetricPathBLaunchDisposition =
  | "suppressed_complete_back_geometry"
  | "not_launched_no_candidate"
  | "not_launched_empty_bytes_missing"
  | "not_launched_empty_mime_invalid"
  | "not_launched_controlled_fixture"
  | "launched"
  | "launch_failed"
  | "not_reached";

export type AfcV2MetricDecisionImagePoint = Readonly<{
  x: number;
  y: number;
}>;

export type AfcV2MetricDecisionLineageV1 = Readonly<{
  attemptId: string | null;
  loadGeneration: number | null;
  autoMetricVersion: typeof AFC_V2_AUTO_METRIC_SCALE_VERSION;
}>;

export type AfcV2MetricFinalDecisionV1 = Readonly<{
  terminalStatus: AfcV2MetricDecisionTerminalStatus;
  authorityBuilt: boolean;
  selectedPath: AfcV2MetricDecisionSelectedPath;
  accepted: boolean;
  authority: AutoMetricScaleAuthority;
  metricScale: number | null;
  autoMetricScale: number | null;
  fallbackApplied: boolean;
  safeFailureState: AfcV2MetricDecisionSafeFailureState;
  winningReasonCodes: readonly string[];
  rejectedCandidatePresent: boolean;
  rejectedCandidateScale: number | null;
  rejectedCandidateFinite: boolean;
  fallbackSubstitutedAfterRejection: boolean;
}>;

export type AfcV2MetricPathARoomPriorFailureV1 = Readonly<{
  failureClass: MetricRoomPriorFailure["failureClass"];
  failureStage: MetricRoomPriorFailure["failureStage"];
  providerStatus: number | null;
  contractValidationReason: string | null;
  safeDetail: string;
}>;

export type AfcV2MetricPathARoomPriorHostAcceptanceV1 = Readonly<{
  class: MetricRoomPriorHostAcceptanceClass;
  reasonCodes: readonly string[];
}>;

export type AfcV2MetricPathARoomPriorV1 = Readonly<{
  attempted: boolean;
  provider: AfcV2MetricDecisionProvider | null;
  model: string | null;
  promptVersion: string | null;
  evidenceSchemaVersion: string | null;
  estimatePresent: boolean;
  failure: AfcV2MetricPathARoomPriorFailureV1 | null;
  observability: MetricRoomPriorObservability | null;
  estimatedRoomWidthM: AfcV2MetricNumericTriple | null;
  estimatedRoomDepthM: AfcV2MetricNumericTriple | null;
  estimatedCeilingHeightM: number | null;
  modelConfidence: number | null;
  hostAcceptance: AfcV2MetricPathARoomPriorHostAcceptanceV1 | null;
}>;

export type AfcV2MetricPathASelectedSpanV1 = Readonly<{
  id: string;
  source: MetricCorrespondenceSpanSource;
  role: MetricCorrespondenceSpanRole;
  canonicalLength: number;
  imageA: AfcV2MetricDecisionImagePoint;
  imageB: AfcV2MetricDecisionImagePoint;
  correspondenceSpanTrust: MetricCorrespondenceSpanTrust;
  correspondenceSource: MetricSpanCorrespondenceSource | null;
  lineage: Readonly<{
    s4aCandidateId: string | null;
    sourceSeamId: string | null;
  }>;
}>;

export type AfcV2MetricPathARejectedAlternativeV1 = Readonly<{
  id: string;
  role: MetricCorrespondenceSpanRole | "unknown";
  reason: MetricCorrespondenceRejectionReason;
}>;

export type AfcV2MetricPathAGeometryCorrespondenceV1 = Readonly<{
  selectionStatus: MetricCorrespondenceSelection["selectionStatus"] | null;
  selectionReasonCodes: readonly string[];
  selectedSpan: AfcV2MetricPathASelectedSpanV1 | null;
  rejectedAlternatives: readonly AfcV2MetricPathARejectedAlternativeV1[];
}>;

export type AfcV2MetricPathASpanTrustV1 = Readonly<{
  trusted: boolean | null;
  reasonCodes: readonly string[];
  s4aSafetyPresent: boolean | null;
  observedSpanOnly: boolean | null;
  hiddenContinuation: boolean | null;
  geometryManufactured: boolean | null;
}>;

export type AfcV2MetricPathAExactGridV1 = Readonly<{
  consultedTier: EmptyOriginalCompatibilityTier | null;
  trustSelectedBackSpanAsFullWidth: boolean | null;
  exactGridCompatible: boolean | null;
  oldCompatibilityTier: EmptyOriginalCompatibilityTier | null;
  emptyAuthoritativeCompatibilityTier: EmptyAuthoritativeCompatibilityTier;
  roomBoundaryCompatibilityTier:
    RoomCollisionAuthorityLineage["roomBoundary"]["compatibilityTier"];
}>;

export type AfcV2MetricPathADerivationV1 = Readonly<{
  physicalMetres: number | null;
  parsedWidthBest: number | null;
  canonicalGaugeLength: number | null;
  candidateScaleBeforeFallback: number | null;
  candidateFinite: boolean;
  catastrophicSanity: AfcV2MetricCatastrophicSanity;
  accepted: boolean;
  reasonCodes: readonly string[];
  authority: AutoMetricScaleAuthority;
}>;

export type AfcV2MetricPathADiagnosticV1 = Readonly<{
  disposition: "not_reached" | "evaluated";
  roomPrior: AfcV2MetricPathARoomPriorV1;
  geometryCorrespondence: AfcV2MetricPathAGeometryCorrespondenceV1;
  spanTrust: AfcV2MetricPathASpanTrustV1;
  exactGrid: AfcV2MetricPathAExactGridV1;
  derivation: AfcV2MetricPathADerivationV1;
}>;

export type AfcV2MetricPathBHostGeometryV1 = Readonly<{
  id: string;
  role: MetricCorrespondenceSpanRole;
  imageA: AfcV2MetricDecisionImagePoint;
  imageB: AfcV2MetricDecisionImagePoint;
  canonicalLength: number;
  sourceSeamId: string;
  floorAuthorityKey: string;
  s4aCandidateId: string;
  freezeReceiptVersion: string | null;
  freezePayloadSha256: string | null;
  overlayImageHash: string | null;
  junctionType: ObservedSpanJunctionProofType | null;
}>;

export type AfcV2MetricPathBModelEstimateHostAcceptanceV1 = Readonly<{
  class: ObservedSpanEstimateHostAcceptanceClass;
  reasonCodes: readonly string[];
  candidateScale: number | null;
}>;

export type AfcV2MetricPathBDiagnosticV1 = Readonly<{
  selection: Readonly<{
    selectionAttempted: boolean;
    selectionStatus: ObservedSpanMetricSelection["selectionStatus"] | null;
    selectionReasonCodes: readonly string[];
    selectedCandidateId: string | null;
    pathAGeometry: Readonly<{
      exists: boolean;
      selectedId: string | null;
      reasonCodes: readonly string[];
    }>;
    suppressWhenCompleteBackGeometryExists: boolean;
  }>;
  launchDisposition: AfcV2MetricPathBLaunchDisposition;
  hostGeometry: AfcV2MetricPathBHostGeometryV1 | null;
  modelCall: Readonly<{
    estimatorLaunched: boolean;
    provider: AfcV2MetricDecisionProvider | null;
    model: string | null;
    promptVersion: string | null;
    schemaVersion: string | null;
  }>;
  modelEstimate: Readonly<{
    status: ObservedSpanPhysicalEstimate["status"] | null;
    estimatedLengthM: AfcV2MetricNumericTriple | null;
    modelConfidence: number | null;
    hostAcceptance: AfcV2MetricPathBModelEstimateHostAcceptanceV1 | null;
  }>;
  derivation: Readonly<{
    candidateScaleBeforeFallback: number | null;
    lineageStatus: AfcV2MetricPathBLineageStatus;
    catastrophicSanity: AfcV2MetricCatastrophicSanity;
    accepted: boolean;
    authority: AutoMetricScaleAuthority;
    reasonCodes: readonly string[];
  }>;
}>;

export type AfcV2MetricFallbackDiagnosticV1 = Readonly<{
  used: boolean;
  numericFallback: number | null;
  constantName: typeof AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME;
  reasonCodes: readonly string[];
  winningPathReceipt: AfcV2MetricDecisionSelectedPath;
}>;

export type AfcV2MetricDecisionDiagnosticV1 = Readonly<{
  schemaVersion: typeof AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION;
  captureStatus: "recorded";
  generationId: string;
  lineage: AfcV2MetricDecisionLineageV1;
  finalDecision: AfcV2MetricFinalDecisionV1;
  pathA: AfcV2MetricPathADiagnosticV1;
  pathB: AfcV2MetricPathBDiagnosticV1;
  fallback: AfcV2MetricFallbackDiagnosticV1;
}>;

export type AfcV2MetricDecisionCaptureFailedV1 = Readonly<{
  schemaVersion: typeof AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION;
  captureStatus: "capture_failed";
  generationId: string;
}>;

export type AfcV2MetricDecisionUnsupportedSchema = Readonly<{
  kind: "unsupported_schema";
  schemaVersion: string;
}>;

export type AfcV2MetricDecisionPersistedValue =
  | null
  | AfcV2MetricDecisionDiagnosticV1
  | AfcV2MetricDecisionCaptureFailedV1
  | AfcV2MetricDecisionUnsupportedSchema;

export type AfcV2MetricDecisionParseResult =
  | Readonly<{ ok: true; decision: AfcV2MetricDecisionPersistedValue }>
  | Readonly<{ ok: false; reason: string }>;

const AUTO_METRIC_VERSION =
  "afc-v2-auto-metric-scale/v1" as const satisfies typeof AFC_V2_AUTO_METRIC_SCALE_VERSION;

const METRIC_AUTHORITIES = [
  "none",
  "gemini_width_back_span_experimental",
  "gemini_observed_span_physical_estimate",
] as const satisfies readonly AutoMetricScaleAuthority[];

const SELECTED_PATHS = [
  "path_a",
  "path_b",
  "none",
] as const satisfies readonly AfcV2MetricDecisionSelectedPath[];

const TERMINAL_STATUSES = [
  "ready",
  "failed",
] as const satisfies readonly AfcV2MetricDecisionTerminalStatus[];

const SAFE_FAILURE_STATES = [
  "none",
  "metric_fallback",
  "collision_empty",
] as const satisfies readonly Exclude<
  AfcV2MetricDecisionSafeFailureState,
  null
>[];

const PROVIDERS = [
  "google_gemini",
  "controlled_fixture",
] as const satisfies readonly AfcV2MetricDecisionProvider[];

const PATH_A_DISPOSITIONS = ["not_reached", "evaluated"] as const;

const ROOM_PRIOR_HOST_CLASSES = [
  "accepted",
  "weak_rejected",
  "implausible_rejected",
  "unobservable_rejected",
  "unavailable",
] as const satisfies readonly MetricRoomPriorHostAcceptanceClass[];

const ROOM_PRIOR_OBSERVABILITY = [
  "recoverable",
  "weak",
  "not_recoverable",
] as const satisfies readonly MetricRoomPriorObservability[];

const ROOM_PRIOR_FAILURE_CLASSES = [
  "configuration",
  "basis_validation",
  "transport",
  "provider_http",
  "provider_response",
  "json_parse",
  "contract_validation",
  "timeout",
  "unknown",
] as const satisfies readonly MetricRoomPriorFailure["failureClass"][];

const ROOM_PRIOR_FAILURE_STAGES = [
  "configuration",
  "basis_validation",
  "provider_invocation",
  "provider_response",
  "response_extraction",
  "json_parse",
  "contract_validation",
] as const satisfies readonly MetricRoomPriorFailure["failureStage"][];

const SPAN_SOURCES = [
  "s4a_floor_wall",
  "ol_floor_wall",
] as const satisfies readonly MetricCorrespondenceSpanSource[];

const SPAN_ROLES = [
  "back_floor_wall",
  "left_floor_wall",
  "right_floor_wall",
  "other_floor_wall",
] as const satisfies readonly MetricCorrespondenceSpanRole[];

const REJECTED_ALTERNATIVE_ROLES = [
  ...SPAN_ROLES,
  "unknown",
] as const satisfies readonly (MetricCorrespondenceSpanRole | "unknown")[];

const SPAN_TRUST = [
  "trusted",
  "candidate",
] as const satisfies readonly MetricCorrespondenceSpanTrust[];

const CORRESPONDENCE_SOURCES = [
  "identity_uv",
  "original_localization",
  "none",
] as const satisfies readonly MetricSpanCorrespondenceSource[];

const PATH_A_REJECTION_REASONS = [
  "not_floor_wall",
  "not_accepted",
  "missing_world_geometry",
  "frame_truncated",
  "overlay_unsafe",
  "degenerate",
  "too_short_in_image",
  "ambiguous_competing_trace",
  "registration_unavailable",
  "other",
] as const satisfies readonly MetricCorrespondenceRejectionReason[];

const PATH_A_SELECTION_STATUSES = [
  "selected",
  "no_eligible_finite_span",
] as const satisfies readonly MetricCorrespondenceSelection["selectionStatus"][];

const REGISTRATION_TIERS = [
  "exact_grid_compatible",
  "aspect_compatible_rescaled",
  "incompatible",
  "unavailable",
] as const satisfies readonly EmptyOriginalCompatibilityTier[];

const COLLISION_TIERS = [
  "exact_grid_compatible",
  "aspect_compatible_rescaled",
  "incompatible",
] as const satisfies readonly Exclude<EmptyAuthoritativeCompatibilityTier, null>[];

const CATASTROPHIC_SANITY = [
  "inside",
  "outside",
  "not_evaluated",
] as const satisfies readonly AfcV2MetricCatastrophicSanity[];

const PATH_B_SELECTION_STATUSES = [
  "selected",
  "no_eligible_observed_span",
  "suppressed_by_path_a",
] as const satisfies readonly ObservedSpanMetricSelection["selectionStatus"][];

const PATH_B_LAUNCH_DISPOSITIONS = [
  "suppressed_complete_back_geometry",
  "not_launched_no_candidate",
  "not_launched_empty_bytes_missing",
  "not_launched_empty_mime_invalid",
  "not_launched_controlled_fixture",
  "launched",
  "launch_failed",
  "not_reached",
] as const satisfies readonly AfcV2MetricPathBLaunchDisposition[];

const PATH_B_LINEAGE_STATUSES = [
  "lineage_rejected",
  "not_lineage_rejected",
  "not_evaluated",
] as const satisfies readonly AfcV2MetricPathBLineageStatus[];

const OBSERVED_SPAN_HOST_CLASSES = [
  "accepted",
  "weak_rejected",
  "implausible_rejected",
  "unobservable_rejected",
  "lineage_rejected",
  "forbidden_geometry_rejected",
  "unavailable",
] as const satisfies readonly ObservedSpanEstimateHostAcceptanceClass[];

const OBSERVED_SPAN_ESTIMATE_STATUSES = [
  "recoverable",
  "weak",
  "not_recoverable",
] as const satisfies readonly ObservedSpanPhysicalEstimate["status"][];

const JUNCTION_TYPES = [
  "two_accepted_s4a_floor_wall",
  "wall_wall_corroboration",
] as const satisfies readonly ObservedSpanJunctionProofType[];

const CAPTURE_FAILED_KEYS = [
  "schemaVersion",
  "captureStatus",
  "generationId",
] as const;

type Parsed<T> = Readonly<
  { ok: true; value: T } | { ok: false; reason: string }
>;

function ok<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

function err(reason: string): Parsed<never> {
  return { ok: false, reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function required<T>(
  record: Record<string, unknown>,
  key: string,
  path: string,
  parse: (value: unknown, reasonPath: string) => Parsed<T>,
): Parsed<T> {
  const reasonPath = path.length > 0 ? `${path}.${key}` : key;
  if (!hasOwn(record, key)) return err(`${reasonPath}_missing`);
  return parse(record[key], reasonPath);
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  reasonPath: string,
): Parsed<T> {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return err(`${reasonPath}_invalid`);
  }
  return ok(value as T);
}

function parseNullableEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  reasonPath: string,
): Parsed<T | null> {
  if (value === null) return ok(null);
  return parseEnum(value, allowed, reasonPath);
}

function parseBoolean(value: unknown, reasonPath: string): Parsed<boolean> {
  if (typeof value !== "boolean") return err(`${reasonPath}_invalid`);
  return ok(value);
}

function parseNullableBoolean(
  value: unknown,
  reasonPath: string,
): Parsed<boolean | null> {
  if (value === null) return ok(null);
  return parseBoolean(value, reasonPath);
}

function parseNonEmptyString(
  value: unknown,
  reasonPath: string,
): Parsed<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return err(`${reasonPath}_invalid`);
  }
  return ok(value);
}

function parseNullableNonEmptyString(
  value: unknown,
  reasonPath: string,
): Parsed<string | null> {
  if (value === null) return ok(null);
  return parseNonEmptyString(value, reasonPath);
}

function parseString(value: unknown, reasonPath: string): Parsed<string> {
  if (typeof value !== "string") return err(`${reasonPath}_invalid`);
  return ok(value);
}

function parseNullableString(
  value: unknown,
  reasonPath: string,
): Parsed<string | null> {
  if (value === null) return ok(null);
  return parseString(value, reasonPath);
}

function parseFiniteNumber(value: unknown, reasonPath: string): Parsed<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return err(`${reasonPath}_invalid`);
  }
  return ok(value);
}

function parseNullableFiniteNumber(
  value: unknown,
  reasonPath: string,
): Parsed<number | null> {
  if (value === null) return ok(null);
  return parseFiniteNumber(value, reasonPath);
}

function parseReasonCodes(
  value: unknown,
  reasonPath: string,
): Parsed<readonly string[]> {
  if (!Array.isArray(value)) return err(`${reasonPath}_invalid`);
  const codes: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return err(`${reasonPath}_invalid`);
    codes.push(item);
  }
  return ok(Object.freeze(codes));
}

function parseNumericTriple(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricNumericTriple | null> {
  if (value === null) return ok(null);
  if (!isRecord(value)) return err(`${reasonPath}_invalid`);
  if (!hasOwn(value, "low") || !hasOwn(value, "best") || !hasOwn(value, "high")) {
    return err(`${reasonPath}_invalid`);
  }
  const low = parseFiniteNumber(value.low, reasonPath);
  const best = parseFiniteNumber(value.best, reasonPath);
  const high = parseFiniteNumber(value.high, reasonPath);
  if (!low.ok || !best.ok || !high.ok) return err(`${reasonPath}_invalid`);
  return ok(Object.freeze({ low: low.value, best: best.value, high: high.value }));
}

function parseImagePoint(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricDecisionImagePoint> {
  if (!isRecord(value) || !hasOwn(value, "x") || !hasOwn(value, "y")) {
    return err(`${reasonPath}_invalid`);
  }
  const x = parseFiniteNumber(value.x, reasonPath);
  const y = parseFiniteNumber(value.y, reasonPath);
  if (!x.ok || !y.ok) return err(`${reasonPath}_invalid`);
  return ok(Object.freeze({ x: x.value, y: y.value }));
}

function parseObject(
  value: unknown,
  reasonPath: string,
): Parsed<Record<string, unknown>> {
  if (!isRecord(value)) return err(`${reasonPath}_invalid`);
  return ok(value);
}

function parseLineage(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricDecisionLineageV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const attemptId = required(
    record.value,
    "attemptId",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!attemptId.ok) return attemptId;
  const loadGeneration = required(
    record.value,
    "loadGeneration",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!loadGeneration.ok) return loadGeneration;
  const autoMetricVersion = required(
    record.value,
    "autoMetricVersion",
    reasonPath,
    (item, path) =>
      item === AUTO_METRIC_VERSION
        ? ok(AUTO_METRIC_VERSION)
        : err(`${path}_invalid`),
  );
  if (!autoMetricVersion.ok) return autoMetricVersion;
  return ok(Object.freeze({
    attemptId: attemptId.value,
    loadGeneration: loadGeneration.value,
    autoMetricVersion: autoMetricVersion.value,
  }));
}

function parseFinalDecision(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricFinalDecisionV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const terminalStatus = required(record.value, "terminalStatus", reasonPath, (
    item,
    path,
  ) => parseEnum(item, TERMINAL_STATUSES, path));
  if (!terminalStatus.ok) return terminalStatus;
  const authorityBuilt = required(
    record.value,
    "authorityBuilt",
    reasonPath,
    parseBoolean,
  );
  if (!authorityBuilt.ok) return authorityBuilt;
  const selectedPath = required(record.value, "selectedPath", reasonPath, (
    item,
    path,
  ) => parseEnum(item, SELECTED_PATHS, path));
  if (!selectedPath.ok) return selectedPath;
  const accepted = required(record.value, "accepted", reasonPath, parseBoolean);
  if (!accepted.ok) return accepted;
  const authority = required(record.value, "authority", reasonPath, (
    item,
    path,
  ) => parseEnum(item, METRIC_AUTHORITIES, path));
  if (!authority.ok) return authority;
  const metricScale = required(
    record.value,
    "metricScale",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!metricScale.ok) return metricScale;
  const autoMetricScale = required(
    record.value,
    "autoMetricScale",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!autoMetricScale.ok) return autoMetricScale;
  const fallbackApplied = required(
    record.value,
    "fallbackApplied",
    reasonPath,
    parseBoolean,
  );
  if (!fallbackApplied.ok) return fallbackApplied;
  const safeFailureState = required(
    record.value,
    "safeFailureState",
    reasonPath,
    (item, path) => parseNullableEnum(item, SAFE_FAILURE_STATES, path),
  );
  if (!safeFailureState.ok) return safeFailureState;
  const winningReasonCodes = required(
    record.value,
    "winningReasonCodes",
    reasonPath,
    parseReasonCodes,
  );
  if (!winningReasonCodes.ok) return winningReasonCodes;
  const rejectedCandidatePresent = required(
    record.value,
    "rejectedCandidatePresent",
    reasonPath,
    parseBoolean,
  );
  if (!rejectedCandidatePresent.ok) return rejectedCandidatePresent;
  const rejectedCandidateScale = required(
    record.value,
    "rejectedCandidateScale",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!rejectedCandidateScale.ok) return rejectedCandidateScale;
  const rejectedCandidateFinite = required(
    record.value,
    "rejectedCandidateFinite",
    reasonPath,
    parseBoolean,
  );
  if (!rejectedCandidateFinite.ok) return rejectedCandidateFinite;
  const fallbackSubstitutedAfterRejection = required(
    record.value,
    "fallbackSubstitutedAfterRejection",
    reasonPath,
    parseBoolean,
  );
  if (!fallbackSubstitutedAfterRejection.ok) {
    return fallbackSubstitutedAfterRejection;
  }
  return ok(Object.freeze({
    terminalStatus: terminalStatus.value,
    authorityBuilt: authorityBuilt.value,
    selectedPath: selectedPath.value,
    accepted: accepted.value,
    authority: authority.value,
    metricScale: metricScale.value,
    autoMetricScale: autoMetricScale.value,
    fallbackApplied: fallbackApplied.value,
    safeFailureState: safeFailureState.value,
    winningReasonCodes: winningReasonCodes.value,
    rejectedCandidatePresent: rejectedCandidatePresent.value,
    rejectedCandidateScale: rejectedCandidateScale.value,
    rejectedCandidateFinite: rejectedCandidateFinite.value,
    fallbackSubstitutedAfterRejection: fallbackSubstitutedAfterRejection.value,
  }));
}

function parseRoomPriorFailure(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathARoomPriorFailureV1 | null> {
  if (value === null) return ok(null);
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const failureClass = required(record.value, "failureClass", reasonPath, (
    item,
    path,
  ) => parseEnum(item, ROOM_PRIOR_FAILURE_CLASSES, path));
  if (!failureClass.ok) return failureClass;
  const failureStage = required(record.value, "failureStage", reasonPath, (
    item,
    path,
  ) => parseEnum(item, ROOM_PRIOR_FAILURE_STAGES, path));
  if (!failureStage.ok) return failureStage;
  const providerStatus = required(
    record.value,
    "providerStatus",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!providerStatus.ok) return providerStatus;
  const contractValidationReason = required(
    record.value,
    "contractValidationReason",
    reasonPath,
    parseNullableString,
  );
  if (!contractValidationReason.ok) return contractValidationReason;
  const safeDetail = required(record.value, "safeDetail", reasonPath, parseString);
  if (!safeDetail.ok) return safeDetail;
  return ok(Object.freeze({
    failureClass: failureClass.value,
    failureStage: failureStage.value,
    providerStatus: providerStatus.value,
    contractValidationReason: contractValidationReason.value,
    safeDetail: safeDetail.value,
  }));
}

function parseRoomPriorHostAcceptance(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathARoomPriorHostAcceptanceV1 | null> {
  if (value === null) return ok(null);
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const hostClass = required(record.value, "class", reasonPath, (item, path) =>
    parseEnum(item, ROOM_PRIOR_HOST_CLASSES, path));
  if (!hostClass.ok) return hostClass;
  const reasonCodes = required(
    record.value,
    "reasonCodes",
    reasonPath,
    parseReasonCodes,
  );
  if (!reasonCodes.ok) return reasonCodes;
  return ok(Object.freeze({
    class: hostClass.value,
    reasonCodes: reasonCodes.value,
  }));
}

function parseRoomPrior(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathARoomPriorV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const attempted = required(record.value, "attempted", reasonPath, parseBoolean);
  if (!attempted.ok) return attempted;
  const provider = required(record.value, "provider", reasonPath, (item, path) =>
    parseNullableEnum(item, PROVIDERS, path));
  if (!provider.ok) return provider;
  const model = required(
    record.value,
    "model",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!model.ok) return model;
  const promptVersion = required(
    record.value,
    "promptVersion",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!promptVersion.ok) return promptVersion;
  const evidenceSchemaVersion = required(
    record.value,
    "evidenceSchemaVersion",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!evidenceSchemaVersion.ok) return evidenceSchemaVersion;
  const estimatePresent = required(
    record.value,
    "estimatePresent",
    reasonPath,
    parseBoolean,
  );
  if (!estimatePresent.ok) return estimatePresent;
  const failure = required(
    record.value,
    "failure",
    reasonPath,
    parseRoomPriorFailure,
  );
  if (!failure.ok) return failure;
  const observability = required(
    record.value,
    "observability",
    reasonPath,
    (item, path) => parseNullableEnum(item, ROOM_PRIOR_OBSERVABILITY, path),
  );
  if (!observability.ok) return observability;
  const estimatedRoomWidthM = required(
    record.value,
    "estimatedRoomWidthM",
    reasonPath,
    parseNumericTriple,
  );
  if (!estimatedRoomWidthM.ok) return estimatedRoomWidthM;
  const estimatedRoomDepthM = required(
    record.value,
    "estimatedRoomDepthM",
    reasonPath,
    parseNumericTriple,
  );
  if (!estimatedRoomDepthM.ok) return estimatedRoomDepthM;
  const estimatedCeilingHeightM = required(
    record.value,
    "estimatedCeilingHeightM",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!estimatedCeilingHeightM.ok) return estimatedCeilingHeightM;
  const modelConfidence = required(
    record.value,
    "modelConfidence",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!modelConfidence.ok) return modelConfidence;
  const hostAcceptance = required(
    record.value,
    "hostAcceptance",
    reasonPath,
    parseRoomPriorHostAcceptance,
  );
  if (!hostAcceptance.ok) return hostAcceptance;
  return ok(Object.freeze({
    attempted: attempted.value,
    provider: provider.value,
    model: model.value,
    promptVersion: promptVersion.value,
    evidenceSchemaVersion: evidenceSchemaVersion.value,
    estimatePresent: estimatePresent.value,
    failure: failure.value,
    observability: observability.value,
    estimatedRoomWidthM: estimatedRoomWidthM.value,
    estimatedRoomDepthM: estimatedRoomDepthM.value,
    estimatedCeilingHeightM: estimatedCeilingHeightM.value,
    modelConfidence: modelConfidence.value,
    hostAcceptance: hostAcceptance.value,
  }));
}

function parseSelectedSpanLineage(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathASelectedSpanV1["lineage"]> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const s4aCandidateId = required(
    record.value,
    "s4aCandidateId",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!s4aCandidateId.ok) return s4aCandidateId;
  const sourceSeamId = required(
    record.value,
    "sourceSeamId",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!sourceSeamId.ok) return sourceSeamId;
  return ok(Object.freeze({
    s4aCandidateId: s4aCandidateId.value,
    sourceSeamId: sourceSeamId.value,
  }));
}

function parseSelectedSpan(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathASelectedSpanV1 | null> {
  if (value === null) return ok(null);
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const id = required(record.value, "id", reasonPath, parseNonEmptyString);
  if (!id.ok) return id;
  const source = required(record.value, "source", reasonPath, (item, path) =>
    parseEnum(item, SPAN_SOURCES, path));
  if (!source.ok) return source;
  const role = required(record.value, "role", reasonPath, (item, path) =>
    parseEnum(item, SPAN_ROLES, path));
  if (!role.ok) return role;
  const canonicalLength = required(
    record.value,
    "canonicalLength",
    reasonPath,
    parseFiniteNumber,
  );
  if (!canonicalLength.ok) return canonicalLength;
  const imageA = required(record.value, "imageA", reasonPath, parseImagePoint);
  if (!imageA.ok) return imageA;
  const imageB = required(record.value, "imageB", reasonPath, parseImagePoint);
  if (!imageB.ok) return imageB;
  const correspondenceSpanTrust = required(
    record.value,
    "correspondenceSpanTrust",
    reasonPath,
    (item, path) => parseEnum(item, SPAN_TRUST, path),
  );
  if (!correspondenceSpanTrust.ok) return correspondenceSpanTrust;
  const correspondenceSource = required(
    record.value,
    "correspondenceSource",
    reasonPath,
    (item, path) => parseNullableEnum(item, CORRESPONDENCE_SOURCES, path),
  );
  if (!correspondenceSource.ok) return correspondenceSource;
  const lineage = required(
    record.value,
    "lineage",
    reasonPath,
    parseSelectedSpanLineage,
  );
  if (!lineage.ok) return lineage;
  return ok(Object.freeze({
    id: id.value,
    source: source.value,
    role: role.value,
    canonicalLength: canonicalLength.value,
    imageA: imageA.value,
    imageB: imageB.value,
    correspondenceSpanTrust: correspondenceSpanTrust.value,
    correspondenceSource: correspondenceSource.value,
    lineage: lineage.value,
  }));
}

function parseRejectedAlternative(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathARejectedAlternativeV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const id = required(record.value, "id", reasonPath, parseNonEmptyString);
  if (!id.ok) return id;
  const role = required(record.value, "role", reasonPath, (item, path) =>
    parseEnum(item, REJECTED_ALTERNATIVE_ROLES, path));
  if (!role.ok) return role;
  const reason = required(record.value, "reason", reasonPath, (item, path) =>
    parseEnum(item, PATH_A_REJECTION_REASONS, path));
  if (!reason.ok) return reason;
  return ok(Object.freeze({
    id: id.value,
    role: role.value,
    reason: reason.value,
  }));
}

function parseRejectedAlternatives(
  value: unknown,
  reasonPath: string,
): Parsed<readonly AfcV2MetricPathARejectedAlternativeV1[]> {
  if (!Array.isArray(value)) return err(`${reasonPath}_invalid`);
  const alternatives: AfcV2MetricPathARejectedAlternativeV1[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseRejectedAlternative(value[index], `${reasonPath}[${index}]`);
    if (!parsed.ok) return parsed;
    alternatives.push(parsed.value);
  }
  return ok(Object.freeze(alternatives));
}

function parseGeometryCorrespondence(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathAGeometryCorrespondenceV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const selectionStatus = required(
    record.value,
    "selectionStatus",
    reasonPath,
    (item, path) => parseNullableEnum(item, PATH_A_SELECTION_STATUSES, path),
  );
  if (!selectionStatus.ok) return selectionStatus;
  const selectionReasonCodes = required(
    record.value,
    "selectionReasonCodes",
    reasonPath,
    parseReasonCodes,
  );
  if (!selectionReasonCodes.ok) return selectionReasonCodes;
  const selectedSpan = required(
    record.value,
    "selectedSpan",
    reasonPath,
    parseSelectedSpan,
  );
  if (!selectedSpan.ok) return selectedSpan;
  const rejectedAlternatives = required(
    record.value,
    "rejectedAlternatives",
    reasonPath,
    parseRejectedAlternatives,
  );
  if (!rejectedAlternatives.ok) return rejectedAlternatives;
  return ok(Object.freeze({
    selectionStatus: selectionStatus.value,
    selectionReasonCodes: selectionReasonCodes.value,
    selectedSpan: selectedSpan.value,
    rejectedAlternatives: rejectedAlternatives.value,
  }));
}

function parseSpanTrust(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathASpanTrustV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const trusted = required(
    record.value,
    "trusted",
    reasonPath,
    parseNullableBoolean,
  );
  if (!trusted.ok) return trusted;
  const reasonCodes = required(
    record.value,
    "reasonCodes",
    reasonPath,
    parseReasonCodes,
  );
  if (!reasonCodes.ok) return reasonCodes;
  const s4aSafetyPresent = required(
    record.value,
    "s4aSafetyPresent",
    reasonPath,
    parseNullableBoolean,
  );
  if (!s4aSafetyPresent.ok) return s4aSafetyPresent;
  const observedSpanOnly = required(
    record.value,
    "observedSpanOnly",
    reasonPath,
    parseNullableBoolean,
  );
  if (!observedSpanOnly.ok) return observedSpanOnly;
  const hiddenContinuation = required(
    record.value,
    "hiddenContinuation",
    reasonPath,
    parseNullableBoolean,
  );
  if (!hiddenContinuation.ok) return hiddenContinuation;
  const geometryManufactured = required(
    record.value,
    "geometryManufactured",
    reasonPath,
    parseNullableBoolean,
  );
  if (!geometryManufactured.ok) return geometryManufactured;
  return ok(Object.freeze({
    trusted: trusted.value,
    reasonCodes: reasonCodes.value,
    s4aSafetyPresent: s4aSafetyPresent.value,
    observedSpanOnly: observedSpanOnly.value,
    hiddenContinuation: hiddenContinuation.value,
    geometryManufactured: geometryManufactured.value,
  }));
}

function parseExactGrid(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathAExactGridV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const consultedTier = required(
    record.value,
    "consultedTier",
    reasonPath,
    (item, path) => parseNullableEnum(item, REGISTRATION_TIERS, path),
  );
  if (!consultedTier.ok) return consultedTier;
  const trustSelectedBackSpanAsFullWidth = required(
    record.value,
    "trustSelectedBackSpanAsFullWidth",
    reasonPath,
    parseNullableBoolean,
  );
  if (!trustSelectedBackSpanAsFullWidth.ok) return trustSelectedBackSpanAsFullWidth;
  const exactGridCompatible = required(
    record.value,
    "exactGridCompatible",
    reasonPath,
    parseNullableBoolean,
  );
  if (!exactGridCompatible.ok) return exactGridCompatible;
  const oldCompatibilityTier = required(
    record.value,
    "oldCompatibilityTier",
    reasonPath,
    (item, path) => parseNullableEnum(item, REGISTRATION_TIERS, path),
  );
  if (!oldCompatibilityTier.ok) return oldCompatibilityTier;
  const emptyAuthoritativeCompatibilityTier = required(
    record.value,
    "emptyAuthoritativeCompatibilityTier",
    reasonPath,
    (item, path) => parseNullableEnum(item, COLLISION_TIERS, path),
  );
  if (!emptyAuthoritativeCompatibilityTier.ok) {
    return emptyAuthoritativeCompatibilityTier;
  }
  const roomBoundaryCompatibilityTier = required(
    record.value,
    "roomBoundaryCompatibilityTier",
    reasonPath,
    (item, path) => parseNullableEnum(item, COLLISION_TIERS, path),
  );
  if (!roomBoundaryCompatibilityTier.ok) return roomBoundaryCompatibilityTier;
  return ok(Object.freeze({
    consultedTier: consultedTier.value,
    trustSelectedBackSpanAsFullWidth: trustSelectedBackSpanAsFullWidth.value,
    exactGridCompatible: exactGridCompatible.value,
    oldCompatibilityTier: oldCompatibilityTier.value,
    emptyAuthoritativeCompatibilityTier: emptyAuthoritativeCompatibilityTier.value,
    roomBoundaryCompatibilityTier: roomBoundaryCompatibilityTier.value,
  }));
}

function parsePathADerivation(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathADerivationV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const physicalMetres = required(
    record.value,
    "physicalMetres",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!physicalMetres.ok) return physicalMetres;
  const parsedWidthBest = required(
    record.value,
    "parsedWidthBest",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!parsedWidthBest.ok) return parsedWidthBest;
  const canonicalGaugeLength = required(
    record.value,
    "canonicalGaugeLength",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!canonicalGaugeLength.ok) return canonicalGaugeLength;
  const candidateScaleBeforeFallback = required(
    record.value,
    "candidateScaleBeforeFallback",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!candidateScaleBeforeFallback.ok) return candidateScaleBeforeFallback;
  const candidateFinite = required(
    record.value,
    "candidateFinite",
    reasonPath,
    parseBoolean,
  );
  if (!candidateFinite.ok) return candidateFinite;
  const catastrophicSanity = required(
    record.value,
    "catastrophicSanity",
    reasonPath,
    (item, path) => parseEnum(item, CATASTROPHIC_SANITY, path),
  );
  if (!catastrophicSanity.ok) return catastrophicSanity;
  const accepted = required(record.value, "accepted", reasonPath, parseBoolean);
  if (!accepted.ok) return accepted;
  const reasonCodes = required(
    record.value,
    "reasonCodes",
    reasonPath,
    parseReasonCodes,
  );
  if (!reasonCodes.ok) return reasonCodes;
  const authority = required(record.value, "authority", reasonPath, (item, path) =>
    parseEnum(item, METRIC_AUTHORITIES, path));
  if (!authority.ok) return authority;
  return ok(Object.freeze({
    physicalMetres: physicalMetres.value,
    parsedWidthBest: parsedWidthBest.value,
    canonicalGaugeLength: canonicalGaugeLength.value,
    candidateScaleBeforeFallback: candidateScaleBeforeFallback.value,
    candidateFinite: candidateFinite.value,
    catastrophicSanity: catastrophicSanity.value,
    accepted: accepted.value,
    reasonCodes: reasonCodes.value,
    authority: authority.value,
  }));
}

function parsePathA(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathADiagnosticV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const disposition = required(record.value, "disposition", reasonPath, (
    item,
    path,
  ) => parseEnum(item, PATH_A_DISPOSITIONS, path));
  if (!disposition.ok) return disposition;
  const roomPrior = required(record.value, "roomPrior", reasonPath, parseRoomPrior);
  if (!roomPrior.ok) return roomPrior;
  const geometryCorrespondence = required(
    record.value,
    "geometryCorrespondence",
    reasonPath,
    parseGeometryCorrespondence,
  );
  if (!geometryCorrespondence.ok) return geometryCorrespondence;
  const spanTrust = required(record.value, "spanTrust", reasonPath, parseSpanTrust);
  if (!spanTrust.ok) return spanTrust;
  const exactGrid = required(record.value, "exactGrid", reasonPath, parseExactGrid);
  if (!exactGrid.ok) return exactGrid;
  const derivation = required(
    record.value,
    "derivation",
    reasonPath,
    parsePathADerivation,
  );
  if (!derivation.ok) return derivation;
  return ok(Object.freeze({
    disposition: disposition.value,
    roomPrior: roomPrior.value,
    geometryCorrespondence: geometryCorrespondence.value,
    spanTrust: spanTrust.value,
    exactGrid: exactGrid.value,
    derivation: derivation.value,
  }));
}

function parsePathBPathAGeometry(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathBDiagnosticV1["selection"]["pathAGeometry"]> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const exists = required(record.value, "exists", reasonPath, parseBoolean);
  if (!exists.ok) return exists;
  const selectedId = required(
    record.value,
    "selectedId",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!selectedId.ok) return selectedId;
  const reasonCodes = required(
    record.value,
    "reasonCodes",
    reasonPath,
    parseReasonCodes,
  );
  if (!reasonCodes.ok) return reasonCodes;
  return ok(Object.freeze({
    exists: exists.value,
    selectedId: selectedId.value,
    reasonCodes: reasonCodes.value,
  }));
}

function parsePathBSelection(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathBDiagnosticV1["selection"]> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const selectionAttempted = required(
    record.value,
    "selectionAttempted",
    reasonPath,
    parseBoolean,
  );
  if (!selectionAttempted.ok) return selectionAttempted;
  const selectionStatus = required(
    record.value,
    "selectionStatus",
    reasonPath,
    (item, path) => parseNullableEnum(item, PATH_B_SELECTION_STATUSES, path),
  );
  if (!selectionStatus.ok) return selectionStatus;
  const selectionReasonCodes = required(
    record.value,
    "selectionReasonCodes",
    reasonPath,
    parseReasonCodes,
  );
  if (!selectionReasonCodes.ok) return selectionReasonCodes;
  const selectedCandidateId = required(
    record.value,
    "selectedCandidateId",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!selectedCandidateId.ok) return selectedCandidateId;
  const pathAGeometry = required(
    record.value,
    "pathAGeometry",
    reasonPath,
    parsePathBPathAGeometry,
  );
  if (!pathAGeometry.ok) return pathAGeometry;
  const suppressWhenCompleteBackGeometryExists = required(
    record.value,
    "suppressWhenCompleteBackGeometryExists",
    reasonPath,
    parseBoolean,
  );
  if (!suppressWhenCompleteBackGeometryExists.ok) {
    return suppressWhenCompleteBackGeometryExists;
  }
  return ok(Object.freeze({
    selectionAttempted: selectionAttempted.value,
    selectionStatus: selectionStatus.value,
    selectionReasonCodes: selectionReasonCodes.value,
    selectedCandidateId: selectedCandidateId.value,
    pathAGeometry: pathAGeometry.value,
    suppressWhenCompleteBackGeometryExists:
      suppressWhenCompleteBackGeometryExists.value,
  }));
}

function parseHostGeometry(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathBHostGeometryV1 | null> {
  if (value === null) return ok(null);
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const id = required(record.value, "id", reasonPath, parseNonEmptyString);
  if (!id.ok) return id;
  const role = required(record.value, "role", reasonPath, (item, path) =>
    parseEnum(item, SPAN_ROLES, path));
  if (!role.ok) return role;
  const imageA = required(record.value, "imageA", reasonPath, parseImagePoint);
  if (!imageA.ok) return imageA;
  const imageB = required(record.value, "imageB", reasonPath, parseImagePoint);
  if (!imageB.ok) return imageB;
  const canonicalLength = required(
    record.value,
    "canonicalLength",
    reasonPath,
    parseFiniteNumber,
  );
  if (!canonicalLength.ok) return canonicalLength;
  const sourceSeamId = required(
    record.value,
    "sourceSeamId",
    reasonPath,
    parseNonEmptyString,
  );
  if (!sourceSeamId.ok) return sourceSeamId;
  const floorAuthorityKey = required(
    record.value,
    "floorAuthorityKey",
    reasonPath,
    parseNonEmptyString,
  );
  if (!floorAuthorityKey.ok) return floorAuthorityKey;
  const s4aCandidateId = required(
    record.value,
    "s4aCandidateId",
    reasonPath,
    parseNonEmptyString,
  );
  if (!s4aCandidateId.ok) return s4aCandidateId;
  const freezeReceiptVersion = required(
    record.value,
    "freezeReceiptVersion",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!freezeReceiptVersion.ok) return freezeReceiptVersion;
  const freezePayloadSha256 = required(
    record.value,
    "freezePayloadSha256",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!freezePayloadSha256.ok) return freezePayloadSha256;
  const overlayImageHash = required(
    record.value,
    "overlayImageHash",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!overlayImageHash.ok) return overlayImageHash;
  const junctionType = required(
    record.value,
    "junctionType",
    reasonPath,
    (item, path) => parseNullableEnum(item, JUNCTION_TYPES, path),
  );
  if (!junctionType.ok) return junctionType;
  return ok(Object.freeze({
    id: id.value,
    role: role.value,
    imageA: imageA.value,
    imageB: imageB.value,
    canonicalLength: canonicalLength.value,
    sourceSeamId: sourceSeamId.value,
    floorAuthorityKey: floorAuthorityKey.value,
    s4aCandidateId: s4aCandidateId.value,
    freezeReceiptVersion: freezeReceiptVersion.value,
    freezePayloadSha256: freezePayloadSha256.value,
    overlayImageHash: overlayImageHash.value,
    junctionType: junctionType.value,
  }));
}

function parseModelCall(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathBDiagnosticV1["modelCall"]> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const estimatorLaunched = required(
    record.value,
    "estimatorLaunched",
    reasonPath,
    parseBoolean,
  );
  if (!estimatorLaunched.ok) return estimatorLaunched;
  const provider = required(record.value, "provider", reasonPath, (item, path) =>
    parseNullableEnum(item, PROVIDERS, path));
  if (!provider.ok) return provider;
  const model = required(
    record.value,
    "model",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!model.ok) return model;
  const promptVersion = required(
    record.value,
    "promptVersion",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!promptVersion.ok) return promptVersion;
  const schemaVersion = required(
    record.value,
    "schemaVersion",
    reasonPath,
    parseNullableNonEmptyString,
  );
  if (!schemaVersion.ok) return schemaVersion;
  return ok(Object.freeze({
    estimatorLaunched: estimatorLaunched.value,
    provider: provider.value,
    model: model.value,
    promptVersion: promptVersion.value,
    schemaVersion: schemaVersion.value,
  }));
}

function parseObservedHostAcceptance(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathBModelEstimateHostAcceptanceV1 | null> {
  if (value === null) return ok(null);
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const hostClass = required(record.value, "class", reasonPath, (item, path) =>
    parseEnum(item, OBSERVED_SPAN_HOST_CLASSES, path));
  if (!hostClass.ok) return hostClass;
  const reasonCodes = required(
    record.value,
    "reasonCodes",
    reasonPath,
    parseReasonCodes,
  );
  if (!reasonCodes.ok) return reasonCodes;
  const candidateScale = required(
    record.value,
    "candidateScale",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!candidateScale.ok) return candidateScale;
  return ok(Object.freeze({
    class: hostClass.value,
    reasonCodes: reasonCodes.value,
    candidateScale: candidateScale.value,
  }));
}

function parseModelEstimate(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathBDiagnosticV1["modelEstimate"]> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const status = required(record.value, "status", reasonPath, (item, path) =>
    parseNullableEnum(item, OBSERVED_SPAN_ESTIMATE_STATUSES, path));
  if (!status.ok) return status;
  const estimatedLengthM = required(
    record.value,
    "estimatedLengthM",
    reasonPath,
    parseNumericTriple,
  );
  if (!estimatedLengthM.ok) return estimatedLengthM;
  const modelConfidence = required(
    record.value,
    "modelConfidence",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!modelConfidence.ok) return modelConfidence;
  const hostAcceptance = required(
    record.value,
    "hostAcceptance",
    reasonPath,
    parseObservedHostAcceptance,
  );
  if (!hostAcceptance.ok) return hostAcceptance;
  return ok(Object.freeze({
    status: status.value,
    estimatedLengthM: estimatedLengthM.value,
    modelConfidence: modelConfidence.value,
    hostAcceptance: hostAcceptance.value,
  }));
}

function parsePathBDerivation(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathBDiagnosticV1["derivation"]> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const candidateScaleBeforeFallback = required(
    record.value,
    "candidateScaleBeforeFallback",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!candidateScaleBeforeFallback.ok) return candidateScaleBeforeFallback;
  const lineageStatus = required(
    record.value,
    "lineageStatus",
    reasonPath,
    (item, path) => parseEnum(item, PATH_B_LINEAGE_STATUSES, path),
  );
  if (!lineageStatus.ok) return lineageStatus;
  const catastrophicSanity = required(
    record.value,
    "catastrophicSanity",
    reasonPath,
    (item, path) => parseEnum(item, CATASTROPHIC_SANITY, path),
  );
  if (!catastrophicSanity.ok) return catastrophicSanity;
  const accepted = required(record.value, "accepted", reasonPath, parseBoolean);
  if (!accepted.ok) return accepted;
  const authority = required(record.value, "authority", reasonPath, (item, path) =>
    parseEnum(item, METRIC_AUTHORITIES, path));
  if (!authority.ok) return authority;
  const reasonCodes = required(
    record.value,
    "reasonCodes",
    reasonPath,
    parseReasonCodes,
  );
  if (!reasonCodes.ok) return reasonCodes;
  return ok(Object.freeze({
    candidateScaleBeforeFallback: candidateScaleBeforeFallback.value,
    lineageStatus: lineageStatus.value,
    catastrophicSanity: catastrophicSanity.value,
    accepted: accepted.value,
    authority: authority.value,
    reasonCodes: reasonCodes.value,
  }));
}

function parsePathB(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricPathBDiagnosticV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const selection = required(
    record.value,
    "selection",
    reasonPath,
    parsePathBSelection,
  );
  if (!selection.ok) return selection;
  const launchDisposition = required(
    record.value,
    "launchDisposition",
    reasonPath,
    (item, path) => parseEnum(item, PATH_B_LAUNCH_DISPOSITIONS, path),
  );
  if (!launchDisposition.ok) return launchDisposition;
  const hostGeometry = required(
    record.value,
    "hostGeometry",
    reasonPath,
    parseHostGeometry,
  );
  if (!hostGeometry.ok) return hostGeometry;
  const modelCall = required(record.value, "modelCall", reasonPath, parseModelCall);
  if (!modelCall.ok) return modelCall;
  const modelEstimate = required(
    record.value,
    "modelEstimate",
    reasonPath,
    parseModelEstimate,
  );
  if (!modelEstimate.ok) return modelEstimate;
  const derivation = required(
    record.value,
    "derivation",
    reasonPath,
    parsePathBDerivation,
  );
  if (!derivation.ok) return derivation;
  return ok(Object.freeze({
    selection: selection.value,
    launchDisposition: launchDisposition.value,
    hostGeometry: hostGeometry.value,
    modelCall: modelCall.value,
    modelEstimate: modelEstimate.value,
    derivation: derivation.value,
  }));
}

function parseFallback(
  value: unknown,
  reasonPath: string,
): Parsed<AfcV2MetricFallbackDiagnosticV1> {
  const record = parseObject(value, reasonPath);
  if (!record.ok) return record;
  const used = required(record.value, "used", reasonPath, parseBoolean);
  if (!used.ok) return used;
  const numericFallback = required(
    record.value,
    "numericFallback",
    reasonPath,
    parseNullableFiniteNumber,
  );
  if (!numericFallback.ok) return numericFallback;
  const constantName = required(record.value, "constantName", reasonPath, (
    item,
    path,
  ) =>
    item === AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME
      ? ok(AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME)
      : err(`${path}_invalid`));
  if (!constantName.ok) return constantName;
  const reasonCodes = required(
    record.value,
    "reasonCodes",
    reasonPath,
    parseReasonCodes,
  );
  if (!reasonCodes.ok) return reasonCodes;
  const winningPathReceipt = required(
    record.value,
    "winningPathReceipt",
    reasonPath,
    (item, path) => parseEnum(item, SELECTED_PATHS, path),
  );
  if (!winningPathReceipt.ok) return winningPathReceipt;
  return ok(Object.freeze({
    used: used.value,
    numericFallback: numericFallback.value,
    constantName: constantName.value,
    reasonCodes: reasonCodes.value,
    winningPathReceipt: winningPathReceipt.value,
  }));
}

function parseCaptureFailed(
  value: Record<string, unknown>,
): AfcV2MetricDecisionParseResult {
  for (const key of Object.keys(value)) {
    if (!CAPTURE_FAILED_KEYS.includes(key as (typeof CAPTURE_FAILED_KEYS)[number])) {
      return Object.freeze({ ok: false, reason: "capture_failed_not_minimal" });
    }
  }
  const generationId = required(value, "generationId", "", parseNonEmptyString);
  if (!generationId.ok) {
    return Object.freeze({ ok: false, reason: generationId.reason });
  }
  return Object.freeze({
    ok: true,
    decision: Object.freeze({
      schemaVersion: AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
      captureStatus: "capture_failed" as const,
      generationId: generationId.value,
    }),
  });
}

function parseRecorded(
  value: Record<string, unknown>,
): AfcV2MetricDecisionParseResult {
  const generationId = required(value, "generationId", "", parseNonEmptyString);
  if (!generationId.ok) {
    return Object.freeze({ ok: false, reason: generationId.reason });
  }
  const lineage = required(value, "lineage", "", parseLineage);
  if (!lineage.ok) return Object.freeze({ ok: false, reason: lineage.reason });
  const finalDecision = required(value, "finalDecision", "", parseFinalDecision);
  if (!finalDecision.ok) {
    return Object.freeze({ ok: false, reason: finalDecision.reason });
  }
  const pathA = required(value, "pathA", "", parsePathA);
  if (!pathA.ok) return Object.freeze({ ok: false, reason: pathA.reason });
  const pathB = required(value, "pathB", "", parsePathB);
  if (!pathB.ok) return Object.freeze({ ok: false, reason: pathB.reason });
  const fallback = required(value, "fallback", "", parseFallback);
  if (!fallback.ok) return Object.freeze({ ok: false, reason: fallback.reason });
  return Object.freeze({
    ok: true,
    decision: Object.freeze({
      schemaVersion: AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
      captureStatus: "recorded" as const,
      generationId: generationId.value,
      lineage: lineage.value,
      finalDecision: finalDecision.value,
      pathA: pathA.value,
      pathB: pathB.value,
      fallback: fallback.value,
    }),
  });
}

function isUnsupportedSchema(
  decision: AfcV2MetricDecisionPersistedValue,
): decision is AfcV2MetricDecisionUnsupportedSchema {
  return !!decision && "kind" in decision && decision.kind === "unsupported_schema";
}

/**
 * Decode persisted `metric_decision` JSON.
 *
 * Null is legacy or not captured. A recognized V1 object becomes a typed
 * recorded or capture_failed value. An unknown schemaVersion becomes an
 * unsupported wrapper and is not interpreted as V1. Malformed V1 fails.
 * The input is not mutated, and missing fields are not filled in.
 */
export function parseAfcV2MetricDecision(
  value: unknown,
): AfcV2MetricDecisionParseResult {
  if (value === null) return Object.freeze({ ok: true, decision: null });
  if (!isRecord(value)) {
    return Object.freeze({ ok: false, reason: "metric_decision_not_object" });
  }
  if (!hasOwn(value, "schemaVersion")) {
    return Object.freeze({ ok: false, reason: "schemaVersion_missing" });
  }
  if (typeof value.schemaVersion !== "string" || value.schemaVersion.trim().length === 0) {
    return Object.freeze({ ok: false, reason: "schemaVersion_invalid" });
  }
  if (value.schemaVersion !== AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION) {
    return Object.freeze({
      ok: true,
      decision: Object.freeze({
        kind: "unsupported_schema" as const,
        schemaVersion: value.schemaVersion,
      }),
    });
  }
  if (!hasOwn(value, "captureStatus")) {
    return Object.freeze({ ok: false, reason: "captureStatus_missing" });
  }
  if (value.captureStatus === "capture_failed") return parseCaptureFailed(value);
  if (value.captureStatus === "recorded") return parseRecorded(value);
  return Object.freeze({ ok: false, reason: "captureStatus_invalid" });
}

export function isAfcV2MetricDecisionDiagnosticV1(
  value: unknown,
): value is AfcV2MetricDecisionDiagnosticV1 {
  const parsed = parseAfcV2MetricDecision(value);
  return parsed.ok &&
    parsed.decision !== null &&
    !isUnsupportedSchema(parsed.decision) &&
    parsed.decision.captureStatus === "recorded";
}

export function isAfcV2MetricDecisionCaptureFailedV1(
  value: unknown,
): value is AfcV2MetricDecisionCaptureFailedV1 {
  const parsed = parseAfcV2MetricDecision(value);
  return parsed.ok &&
    parsed.decision !== null &&
    !isUnsupportedSchema(parsed.decision) &&
    parsed.decision.captureStatus === "capture_failed";
}
