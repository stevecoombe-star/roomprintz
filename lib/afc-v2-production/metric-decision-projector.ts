/**
 * AFR-1C observational projector for generation-scoped metric decisions.
 *
 * Reads receipts the production metric pass already computed. It does not
 * call Gemini, select a path, accept a candidate, or change scale.
 */

import type { AutoMetricScaleReceipt } from "@/app/admin/3d-room-lab-v2/metric-auto-scale-contract";
import type { MetricCorrespondenceSelection } from "@/app/admin/3d-room-lab-v2/metric-correspondence-span-contract";
import type { MetricRoomPriorReceipt } from "@/app/admin/3d-room-lab-v2/metric-room-prior-contract";
import type { ObservedSpanMetricSelection } from "@/app/admin/3d-room-lab-v2/observed-span-metric-candidate-contract";
import type { ObservedSpanPhysicalEstimateReceipt } from "@/app/admin/3d-room-lab-v2/observed-span-physical-estimate-contract";

import {
  AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
  AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME,
  parseAfcV2MetricDecision,
  type AfcV2MetricCatastrophicSanity,
  type AfcV2MetricDecisionDiagnosticV1,
  type AfcV2MetricDecisionPersistedValue,
  type AfcV2MetricPathADiagnosticV1,
  type AfcV2MetricPathAExactGridV1,
  type AfcV2MetricPathBDiagnosticV1,
  type AfcV2MetricPathBLineageStatus,
} from "./metric-decision-diagnostic";
import type { AfcV2ProductionRoomAuthority } from "./production-authority-contract";
import type {
  ProductionAutoMetric,
  ProductionMetricObservation,
} from "./production-auto-metric";

const AUTO_METRIC_VERSION = "afc-v2-auto-metric-scale/v1" as const;

const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_REASON_CODES = 32;
const MAX_REJECTED_ALTERNATIVES = 24;

const PROVIDERS = ["google_gemini", "controlled_fixture"] as const;
const ROOM_PRIOR_HOST_CLASSES = [
  "accepted",
  "weak_rejected",
  "implausible_rejected",
  "unobservable_rejected",
  "unavailable",
] as const;
const ROOM_PRIOR_OBSERVABILITY = ["recoverable", "weak", "not_recoverable"] as const;
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
] as const;
const ROOM_PRIOR_FAILURE_STAGES = [
  "configuration",
  "basis_validation",
  "provider_invocation",
  "provider_response",
  "response_extraction",
  "json_parse",
  "contract_validation",
] as const;
const SPAN_SOURCES = ["s4a_floor_wall", "ol_floor_wall"] as const;
const SPAN_ROLES = [
  "back_floor_wall",
  "left_floor_wall",
  "right_floor_wall",
  "other_floor_wall",
] as const;
const REJECTED_ROLES = [...SPAN_ROLES, "unknown"] as const;
const SPAN_TRUST = ["trusted", "candidate"] as const;
const CORRESPONDENCE_SOURCES = ["identity_uv", "original_localization", "none"] as const;
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
] as const;
const PATH_A_SELECTION_STATUSES = ["selected", "no_eligible_finite_span"] as const;
const REGISTRATION_TIERS = [
  "exact_grid_compatible",
  "aspect_compatible_rescaled",
  "incompatible",
  "unavailable",
] as const;
const COLLISION_TIERS = [
  "exact_grid_compatible",
  "aspect_compatible_rescaled",
  "incompatible",
] as const;
const PATH_B_SELECTION_STATUSES = [
  "selected",
  "no_eligible_observed_span",
  "suppressed_by_path_a",
] as const;
const LAUNCH_DISPOSITIONS = [
  "suppressed_complete_back_geometry",
  "not_launched_no_candidate",
  "not_launched_empty_bytes_missing",
  "not_launched_empty_mime_invalid",
  "not_launched_controlled_fixture",
  "launched",
  "launch_failed",
  "not_reached",
] as const;
const OBSERVED_HOST_CLASSES = [
  "accepted",
  "weak_rejected",
  "implausible_rejected",
  "unobservable_rejected",
  "lineage_rejected",
  "forbidden_geometry_rejected",
  "unavailable",
] as const;
const ESTIMATE_STATUSES = ["recoverable", "weak", "not_recoverable"] as const;
const JUNCTION_TYPES = [
  "two_accepted_s4a_floor_wall",
  "wall_wall_corroboration",
] as const;
const METRIC_AUTHORITIES = [
  "none",
  "gemini_width_back_span_experimental",
  "gemini_observed_span_physical_estimate",
] as const;
const SELECTED_PATHS = ["path_a", "path_b", "none"] as const;
const SAFE_FAILURE_STATES = ["none", "metric_fallback", "collision_empty"] as const;

export type AfcV2MetricDecisionProjectionInput = Readonly<{
  generationId: string;
  terminalStatus: "ready" | "failed";
  attemptId: string | null;
  loadGeneration: number | null;
  authority: AfcV2ProductionRoomAuthority | null;
  autoMetric: ProductionAutoMetric | null;
  observation: ProductionMetricObservation | null;
  roomPrior: MetricRoomPriorReceipt | null;
  correspondence: MetricCorrespondenceSelection | null;
  observedSpanSelection: ObservedSpanMetricSelection | null;
  observedSpanEstimate: ObservedSpanPhysicalEstimateReceipt | null;
  launchDisposition: string | null;
  floorAuthorityKey: string | null;
  freezeReceiptVersion: string | null;
  freezePayloadSha256: string | null;
  suppressWhenCompleteBackGeometryExists: boolean | null;
  oldCompatibilityTier: string | null;
  emptyAuthoritativeCompatibilityTier: string | null;
  roomBoundaryCompatibilityTier: string | null;
}>;

export function projectAfcV2MetricDecisionDiagnostic(
  input: AfcV2MetricDecisionProjectionInput,
): AfcV2MetricDecisionDiagnosticV1 {
  const pathAEvaluated = input.terminalStatus === "ready" &&
    input.observation?.pathAReceipt != null;
  const pathA = projectPathA(input, pathAEvaluated);
  const pathB = projectPathB(input, pathAEvaluated);
  const finalDecision = projectFinalDecision(input, pathA, pathB);
  const fallbackUsed = input.terminalStatus === "ready" &&
    input.authority?.metric.fallbackApplied === true;
  const winningReasons = input.terminalStatus === "ready"
    ? reasonCodes(input.autoMetric?.receipt.reasons)
    : [];
  return {
    schemaVersion: AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    captureStatus: "recorded",
    generationId: input.generationId,
    lineage: {
      attemptId: nonEmpty(input.attemptId),
      loadGeneration: finiteOrNull(input.loadGeneration),
      autoMetricVersion: AUTO_METRIC_VERSION,
    },
    finalDecision,
    pathA,
    pathB,
    fallback: {
      used: fallbackUsed,
      numericFallback: fallbackUsed
        ? finiteOrNull(input.authority?.metric.autoMetricScale)
        : null,
      constantName: AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME,
      reasonCodes: winningReasons,
      winningPathReceipt: finalDecision.selectedPath,
    },
  };
}

export function captureAfcV2MetricDecision(
  input: AfcV2MetricDecisionProjectionInput,
  dependencies: Readonly<{
    project?: (value: AfcV2MetricDecisionProjectionInput) => unknown;
  }> = {},
): AfcV2MetricDecisionPersistedValue {
  const project = dependencies.project ?? projectAfcV2MetricDecisionDiagnostic;
  try {
    const projected = project(input);
    const parsed = parseAfcV2MetricDecision(projected);
    if (
      parsed.ok &&
      parsed.decision &&
      typeof parsed.decision === "object" &&
      "captureStatus" in parsed.decision &&
      parsed.decision.captureStatus === "recorded"
    ) {
      return parsed.decision;
    }
    logMetricDecisionCaptureFailure(
      input.generationId,
      parsed.ok ? "parser_unexpected" : parsed.reason,
    );
    return captureFailedEnvelope(input.generationId);
  } catch (error) {
    logMetricDecisionCaptureFailure(
      input.generationId,
      error instanceof Error ? error.name : "projector_threw",
    );
    return captureFailedEnvelope(input.generationId);
  }
}

function captureFailedEnvelope(
  generationId: string,
): AfcV2MetricDecisionPersistedValue {
  const parsed = parseAfcV2MetricDecision({
    schemaVersion: AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    captureStatus: "capture_failed",
    generationId,
  });
  if (
    parsed.ok &&
    parsed.decision &&
    typeof parsed.decision === "object" &&
    "captureStatus" in parsed.decision &&
    parsed.decision.captureStatus === "capture_failed"
  ) {
    return parsed.decision;
  }
  logMetricDecisionCaptureFailure(generationId, "capture_failed_envelope_invalid");
  return null;
}

function logMetricDecisionCaptureFailure(
  generationId: string,
  category: string,
): void {
  const safeCategory = /^[A-Za-z0-9_.]+$/.test(category)
    ? category
    : "capture_failed";
  const safeGenerationId = typeof generationId === "string" &&
      generationId.length > 0 &&
      generationId.length <= 80
    ? generationId
    : "unknown";
  console.error(JSON.stringify({
    event: "afc_v2_metric_decision_capture_failed",
    generationId: safeGenerationId,
    category: safeCategory,
  }));
}

function projectPathA(
  input: AfcV2MetricDecisionProjectionInput,
  evaluated: boolean,
): AfcV2MetricPathADiagnosticV1 {
  const receipt = evaluated ? input.observation?.pathAReceipt ?? null : null;
  const roomPrior = input.roomPrior;
  const estimate = roomPrior?.estimate ?? null;
  const width = copyTriple(estimate?.estimatedRoomWidthM);
  const selected = input.correspondence?.selected ?? null;
  const candidate = pathACandidateScale(receipt, input.observation);
  const reasons = reasonCodes(receipt?.reasons);
  return {
    disposition: evaluated ? "evaluated" : "not_reached",
    roomPrior: {
      attempted: roomPrior != null,
      provider: oneOf(roomPrior?.provider, PROVIDERS),
      model: nonEmpty(roomPrior?.model),
      promptVersion: nonEmpty(roomPrior?.promptVersion),
      evidenceSchemaVersion: nonEmpty(roomPrior?.schemaVersion),
      estimatePresent: estimate != null,
      failure: projectRoomPriorFailure(roomPrior?.failure ?? null),
      observability: oneOf(estimate?.observability, ROOM_PRIOR_OBSERVABILITY),
      estimatedRoomWidthM: width,
      estimatedRoomDepthM: copyTriple(estimate?.estimatedRoomDepthM),
      estimatedCeilingHeightM: finiteOrNull(estimate?.estimatedCeilingHeightM),
      modelConfidence: finiteOrNull(estimate?.modelConfidence),
      hostAcceptance: roomPrior
        ? projectRoomPriorHost(roomPrior)
        : null,
    },
    geometryCorrespondence: {
      selectionStatus: oneOf(
        input.correspondence?.selectionStatus,
        PATH_A_SELECTION_STATUSES,
      ),
      selectionReasonCodes: reasonCodes(input.correspondence?.selectionReasons),
      selectedSpan: projectSelectedSpan(selected),
      rejectedAlternatives: projectRejectedAlternatives(
        input.correspondence?.rejectedAlternatives,
      ),
    },
    spanTrust: evaluated
      ? {
        trusted: input.observation?.spanTrust?.trusted ?? null,
        reasonCodes: reasonCodes(input.observation?.spanTrust?.reasons),
        s4aSafetyPresent: input.observation?.s4aSafety != null,
        observedSpanOnly: input.observation?.s4aSafety?.observedSpanOnly ?? null,
        hiddenContinuation: input.observation?.s4aSafety?.hiddenContinuation ?? null,
        geometryManufactured: input.observation?.s4aSafety?.geometryManufactured ?? null,
      }
      : {
        trusted: null,
        reasonCodes: [],
        s4aSafetyPresent: null,
        observedSpanOnly: null,
        hiddenContinuation: null,
        geometryManufactured: null,
      },
    exactGrid: projectExactGrid(input, evaluated),
    derivation: {
      physicalMetres: receipt?.physicalSource?.kind === "gemini_room_width"
        ? finiteOrNull(receipt.physicalSource.metres)
        : null,
      parsedWidthBest: finiteOrNull(width?.best),
      canonicalGaugeLength: finiteOrNull(receipt?.canonicalSource?.gaugeLength),
      candidateScaleBeforeFallback: candidate,
      candidateFinite: candidate != null,
      catastrophicSanity: catastrophicSanity(reasons, candidate, receipt?.accepted === true),
      accepted: receipt?.accepted === true,
      reasonCodes: reasons,
      authority: oneOf(receipt?.authority, METRIC_AUTHORITIES) ?? "none",
    },
  };
}

function projectExactGrid(
  input: AfcV2MetricDecisionProjectionInput,
  evaluated: boolean,
): AfcV2MetricPathAExactGridV1 {
  const consulted = evaluated ? input.observation?.compatibilityTier ?? null : null;
  return {
    consultedTier: oneOf(consulted, REGISTRATION_TIERS),
    trustSelectedBackSpanAsFullWidth: evaluated
      ? input.observation?.trustSelectedBackSpanAsFullWidth === true
      : null,
    exactGridCompatible: evaluated ? consulted === "exact_grid_compatible" : null,
    oldCompatibilityTier: oneOf(input.oldCompatibilityTier, REGISTRATION_TIERS),
    emptyAuthoritativeCompatibilityTier: oneOf(
      input.emptyAuthoritativeCompatibilityTier,
      COLLISION_TIERS,
    ),
    roomBoundaryCompatibilityTier: oneOf(
      input.roomBoundaryCompatibilityTier,
      COLLISION_TIERS,
    ),
  };
}

function projectPathB(
  input: AfcV2MetricDecisionProjectionInput,
  pathAEvaluated: boolean,
): AfcV2MetricPathBDiagnosticV1 {
  const selection = input.observedSpanSelection;
  const estimate = input.observedSpanEstimate;
  const candidate = selection?.selected ?? null;
  const receipt = pathAEvaluated ? input.observation?.pathBReceipt ?? null : null;
  const hostScale = finiteOrNull(estimate?.hostAcceptance.autoMetricScale);
  const candidateScale = pathBCandidateScale(receipt, hostScale);
  const reasons = reasonCodes(receipt?.reasons);
  const hostClass = oneOf(estimate?.hostAcceptance.class, OBSERVED_HOST_CLASSES);
  const lineageStatus: AfcV2MetricPathBLineageStatus = !estimate
    ? "not_evaluated"
    : hostClass === "lineage_rejected"
    ? "lineage_rejected"
    : "not_lineage_rejected";
  const parsedEstimate = estimate?.estimate ?? null;
  return {
    selection: {
      selectionAttempted: selection != null,
      selectionStatus: oneOf(selection?.selectionStatus, PATH_B_SELECTION_STATUSES),
      selectionReasonCodes: reasonCodes(selection?.selectionReasons),
      selectedCandidateId: nonEmpty(candidate?.id),
      pathAGeometry: {
        exists: selection?.pathAGeometry.exists === true,
        selectedId: nonEmpty(selection?.pathAGeometry.selectedId),
        reasonCodes: reasonCodes(selection?.pathAGeometry.reasons),
      },
      suppressWhenCompleteBackGeometryExists:
        input.suppressWhenCompleteBackGeometryExists ?? true,
    },
    launchDisposition: oneOf(input.launchDisposition, LAUNCH_DISPOSITIONS) ??
      "not_reached",
    hostGeometry: projectHostGeometry(input, candidate),
    modelCall: {
      estimatorLaunched: selection?.estimatorLaunched === true,
      provider: oneOf(estimate?.provider, PROVIDERS),
      model: nonEmpty(estimate?.model),
      promptVersion: nonEmpty(estimate?.promptVersion),
      schemaVersion: nonEmpty(estimate?.schemaVersion),
    },
    modelEstimate: {
      status: oneOf(parsedEstimate?.status, ESTIMATE_STATUSES),
      estimatedLengthM: copyTriple(parsedEstimate?.estimatedLengthM),
      modelConfidence: finiteOrNull(parsedEstimate?.modelConfidence),
      hostAcceptance: estimate && hostClass
        ? {
          class: hostClass,
          reasonCodes: reasonCodes(estimate.hostAcceptance.reasons),
          candidateScale: hostScale,
        }
        : null,
    },
    derivation: {
      candidateScaleBeforeFallback: pathAEvaluated ? candidateScale : null,
      lineageStatus,
      catastrophicSanity: pathAEvaluated
        ? catastrophicSanity(reasons, candidateScale, receipt?.accepted === true)
        : "not_evaluated",
      accepted: receipt?.accepted === true,
      authority: oneOf(receipt?.authority, METRIC_AUTHORITIES) ?? "none",
      reasonCodes: reasons,
    },
  };
}

function projectFinalDecision(
  input: AfcV2MetricDecisionProjectionInput,
  pathA: AfcV2MetricPathADiagnosticV1,
  pathB: AfcV2MetricPathBDiagnosticV1,
): AfcV2MetricDecisionDiagnosticV1["finalDecision"] {
  const authority = input.terminalStatus === "ready" ? input.authority : null;
  if (!authority) {
    return {
      terminalStatus: input.terminalStatus,
      authorityBuilt: false,
      selectedPath: "none",
      accepted: false,
      authority: "none",
      metricScale: null,
      autoMetricScale: null,
      fallbackApplied: false,
      safeFailureState: null,
      winningReasonCodes: [],
      rejectedCandidatePresent: false,
      rejectedCandidateScale: null,
      rejectedCandidateFinite: false,
      fallbackSubstitutedAfterRejection: false,
    };
  }
  const selectedPath = oneOf(authority.metric.path, SELECTED_PATHS) ?? "none";
  const accepted = authority.metric.accepted === true;
  const pathACandidate = pathA.derivation.candidateScaleBeforeFallback;
  const pathBCandidate = pathB.derivation.candidateScaleBeforeFallback;
  const rejectedCandidateScale = accepted ? null : pathACandidate ?? pathBCandidate;
  const rejectedCandidatePresent = rejectedCandidateScale != null;
  return {
    terminalStatus: "ready",
    authorityBuilt: true,
    selectedPath,
    accepted,
    authority: oneOf(authority.metric.authority, METRIC_AUTHORITIES) ?? "none",
    metricScale: finiteOrNull(authority.metric.metricScale),
    autoMetricScale: finiteOrNull(authority.metric.autoMetricScale),
    fallbackApplied: authority.metric.fallbackApplied === true,
    safeFailureState: oneOf(authority.recovery.safeFailureState, SAFE_FAILURE_STATES),
    winningReasonCodes: reasonCodes(input.autoMetric?.receipt.reasons),
    rejectedCandidatePresent,
    rejectedCandidateScale,
    rejectedCandidateFinite: rejectedCandidatePresent,
    fallbackSubstitutedAfterRejection: rejectedCandidatePresent &&
      authority.metric.fallbackApplied === true,
  };
}

function pathACandidateScale(
  receipt: AutoMetricScaleReceipt | null,
  observation: ProductionMetricObservation | null,
): number | null {
  if (receipt?.accepted === true) return finiteOrNull(receipt.autoMetricScale);
  return finiteOrNull(observation?.pathACandidateScaleBeforeFallback);
}

function pathBCandidateScale(
  receipt: AutoMetricScaleReceipt | null,
  hostScale: number | null,
): number | null {
  if (receipt?.accepted === true) return finiteOrNull(receipt.autoMetricScale);
  return hostScale;
}

function catastrophicSanity(
  reasons: readonly string[],
  candidate: number | null,
  accepted: boolean,
): AfcV2MetricCatastrophicSanity {
  if (reasons.includes("candidate_outside_catastrophic_sanity_bounds")) {
    return "outside";
  }
  if (accepted || candidate != null) return "inside";
  return "not_evaluated";
}

function projectRoomPriorFailure(
  failure: MetricRoomPriorReceipt["failure"] | null,
) {
  if (!failure) return null;
  const failureClass = oneOf(failure.failureClass, ROOM_PRIOR_FAILURE_CLASSES);
  const failureStage = oneOf(failure.failureStage, ROOM_PRIOR_FAILURE_STAGES);
  if (!failureClass || !failureStage) return null;
  return {
    failureClass,
    failureStage,
    providerStatus: finiteOrNull(failure.providerStatus),
    contractValidationReason: typeof failure.contractValidationReason === "string"
      ? failure.contractValidationReason
      : null,
    safeDetail: typeof failure.safeDetail === "string" ? failure.safeDetail : "",
  };
}

function projectRoomPriorHost(roomPrior: MetricRoomPriorReceipt) {
  const hostClass = oneOf(roomPrior.hostAcceptance.class, ROOM_PRIOR_HOST_CLASSES);
  if (!hostClass) return null;
  return {
    class: hostClass,
    reasonCodes: reasonCodes(roomPrior.hostAcceptance.reasons),
  };
}

function projectSelectedSpan(
  selected: MetricCorrespondenceSelection["selected"] | null,
): AfcV2MetricPathADiagnosticV1["geometryCorrespondence"]["selectedSpan"] {
  if (!selected) return null;
  const source = oneOf(selected.source, SPAN_SOURCES);
  const role = oneOf(selected.role, SPAN_ROLES);
  const trust = oneOf(selected.spanTrust, SPAN_TRUST);
  const imageA = copyPoint(selected.imageA);
  const imageB = copyPoint(selected.imageB);
  const canonicalLength = finiteOrNull(selected.canonicalLength);
  if (!source || !role || !trust || !imageA || !imageB || canonicalLength == null) {
    return null;
  }
  if (typeof selected.id !== "string" || selected.id.length === 0) return null;
  return {
    id: selected.id,
    source,
    role,
    canonicalLength,
    imageA,
    imageB,
    correspondenceSpanTrust: trust,
    correspondenceSource: oneOf(selected.correspondenceSource, CORRESPONDENCE_SOURCES),
    lineage: {
      s4aCandidateId: nonEmpty(selected.lineage.s4aCandidateId),
      sourceSeamId: nonEmpty(selected.lineage.sourceSeamId),
    },
  };
}

function projectRejectedAlternatives(
  alternatives: MetricCorrespondenceSelection["rejectedAlternatives"] | undefined,
): AfcV2MetricPathADiagnosticV1["geometryCorrespondence"]["rejectedAlternatives"] {
  if (!alternatives) return [];
  const projected = [];
  for (const alternative of alternatives.slice(0, MAX_REJECTED_ALTERNATIVES)) {
    const reason = oneOf(alternative.reason, PATH_A_REJECTION_REASONS);
    const role = oneOf(alternative.role, REJECTED_ROLES);
    if (!reason || !role || typeof alternative.id !== "string" || alternative.id.length === 0) {
      continue;
    }
    projected.push({ id: alternative.id, role, reason });
  }
  return projected;
}

function projectHostGeometry(
  input: AfcV2MetricDecisionProjectionInput,
  candidate: ObservedSpanMetricSelection["selected"] | null,
): AfcV2MetricPathBDiagnosticV1["hostGeometry"] {
  if (!candidate) return null;
  const role = oneOf(candidate.role, SPAN_ROLES);
  const imageA = copyPoint(candidate.imageA);
  const imageB = copyPoint(candidate.imageB);
  const canonicalLength = finiteOrNull(candidate.canonicalLength);
  const sourceSeamId = nonEmpty(candidate.lineage.sourceSeamId);
  const s4aCandidateId = nonEmpty(candidate.lineage.s4aCandidateId);
  const floorAuthorityKey = nonEmpty(input.observedSpanEstimate?.lineage.floorAuthorityKey) ??
    nonEmpty(input.floorAuthorityKey);
  if (
    !role ||
    !imageA ||
    !imageB ||
    canonicalLength == null ||
    !sourceSeamId ||
    !s4aCandidateId ||
    !floorAuthorityKey ||
    typeof candidate.id !== "string" ||
    candidate.id.length === 0
  ) {
    return null;
  }
  const overlay = nonEmpty(input.observedSpanEstimate?.overlayImageHash);
  return {
    id: candidate.id,
    role,
    imageA,
    imageB,
    canonicalLength,
    sourceSeamId,
    floorAuthorityKey,
    s4aCandidateId,
    freezeReceiptVersion: nonEmpty(input.observedSpanEstimate?.lineage.freezeReceiptVersion) ??
      nonEmpty(input.freezeReceiptVersion),
    freezePayloadSha256: nonEmpty(input.observedSpanEstimate?.lineage.freezePayloadSha256) ??
      nonEmpty(input.freezePayloadSha256),
    overlayImageHash: overlay,
    junctionType: oneOf(candidate.junction?.type, JUNCTION_TYPES),
  };
}

function reasonCodes(values: readonly string[] | null | undefined): readonly string[] {
  if (!values) return [];
  const codes: string[] = [];
  for (const value of values) {
    if (codes.length >= MAX_REASON_CODES) break;
    if (typeof value === "string" && REASON_CODE.test(value)) codes.push(value);
  }
  return codes;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T)
    ? value as T
    : null;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function copyTriple(
  value: Readonly<{ low: number; best: number; high: number }> | null | undefined,
) {
  if (!value) return null;
  const low = finiteOrNull(value.low);
  const best = finiteOrNull(value.best);
  const high = finiteOrNull(value.high);
  if (low == null || best == null || high == null) return null;
  return { low, best, high };
}

function copyPoint(value: Readonly<{ x: number; y: number }> | null | undefined) {
  if (!value) return null;
  const x = finiteOrNull(value.x);
  const y = finiteOrNull(value.y);
  if (x == null || y == null) return null;
  return { x, y };
}
