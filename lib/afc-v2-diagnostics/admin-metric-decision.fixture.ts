import { AFC_V2_AUTO_METRIC_SCALE_VERSION } from "@/app/admin/3d-room-lab-v2/metric-auto-scale-contract";
import {
  AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
  AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME,
  type AfcV2MetricDecisionDiagnosticV1,
} from "@/lib/afc-v2-production/metric-decision-diagnostic";

export const AFC_DIAGNOSTIC_METRIC_FIXTURE_GENERATION_ID =
  "95b0d26f-0056-4fd1-8e78-2c05abc5ed70";

type MutableDecision = {
  -readonly [K in keyof AfcV2MetricDecisionDiagnosticV1]: AfcV2MetricDecisionDiagnosticV1[K];
};

function minimal(): AfcV2MetricDecisionDiagnosticV1 {
  return {
    schemaVersion: AFC_V2_METRIC_DECISION_DIAGNOSTIC_SCHEMA_VERSION,
    captureStatus: "recorded",
    generationId: AFC_DIAGNOSTIC_METRIC_FIXTURE_GENERATION_ID,
    lineage: {
      attemptId: null,
      loadGeneration: null,
      autoMetricVersion: AFC_V2_AUTO_METRIC_SCALE_VERSION,
    },
    finalDecision: {
      terminalStatus: "ready",
      authorityBuilt: true,
      selectedPath: "none",
      accepted: false,
      authority: "none",
      metricScale: null,
      autoMetricScale: null,
      fallbackApplied: false,
      safeFailureState: "none",
      winningReasonCodes: [],
      rejectedCandidatePresent: false,
      rejectedCandidateScale: null,
      rejectedCandidateFinite: false,
      fallbackSubstitutedAfterRejection: false,
    },
    pathA: {
      disposition: "not_reached",
      roomPrior: {
        attempted: false,
        provider: null,
        model: null,
        promptVersion: null,
        evidenceSchemaVersion: null,
        estimatePresent: false,
        failure: null,
        observability: null,
        estimatedRoomWidthM: null,
        estimatedRoomDepthM: null,
        estimatedCeilingHeightM: null,
        modelConfidence: null,
        hostAcceptance: null,
      },
      geometryCorrespondence: {
        selectionStatus: null,
        selectionReasonCodes: [],
        selectedSpan: null,
        rejectedAlternatives: [],
      },
      spanTrust: {
        trusted: null,
        reasonCodes: [],
        s4aSafetyPresent: null,
        observedSpanOnly: null,
        hiddenContinuation: null,
        geometryManufactured: null,
      },
      exactGrid: {
        consultedTier: null,
        trustSelectedBackSpanAsFullWidth: null,
        exactGridCompatible: null,
        oldCompatibilityTier: null,
        emptyAuthoritativeCompatibilityTier: null,
        roomBoundaryCompatibilityTier: null,
      },
      derivation: {
        physicalMetres: null,
        parsedWidthBest: null,
        canonicalGaugeLength: null,
        candidateScaleBeforeFallback: null,
        candidateFinite: false,
        catastrophicSanity: "not_evaluated",
        accepted: false,
        reasonCodes: [],
        authority: "none",
      },
    },
    pathB: {
      selection: {
        selectionAttempted: false,
        selectionStatus: null,
        selectionReasonCodes: [],
        selectedCandidateId: null,
        pathAGeometry: {
          exists: false,
          selectedId: null,
          reasonCodes: [],
        },
        suppressWhenCompleteBackGeometryExists: true,
      },
      launchDisposition: "not_reached",
      hostGeometry: null,
      modelCall: {
        estimatorLaunched: false,
        provider: null,
        model: null,
        promptVersion: null,
        schemaVersion: null,
      },
      modelEstimate: {
        status: null,
        estimatedLengthM: null,
        modelConfidence: null,
        hostAcceptance: null,
      },
      derivation: {
        candidateScaleBeforeFallback: null,
        lineageStatus: "not_evaluated",
        catastrophicSanity: "not_evaluated",
        accepted: false,
        authority: "none",
        reasonCodes: [],
      },
    },
    fallback: {
      used: false,
      numericFallback: null,
      constantName: AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME,
      reasonCodes: [],
      winningPathReceipt: "none",
    },
  };
}

function editable(): MutableDecision {
  return structuredClone(minimal()) as MutableDecision;
}

export function minimalMetricDecisionRaw(): AfcV2MetricDecisionDiagnosticV1 {
  return minimal();
}

export function pathAAcceptedMetricDecisionRaw(): AfcV2MetricDecisionDiagnosticV1 {
  const decision = editable();
  decision.finalDecision = {
    ...decision.finalDecision,
    selectedPath: "path_a",
    accepted: true,
    authority: "gemini_width_back_span_experimental",
    metricScale: 1.25,
    autoMetricScale: 1.25,
    fallbackApplied: false,
    safeFailureState: "none",
    winningReasonCodes: ["host_accepted_width_prior"],
  };
  decision.pathA = {
    ...decision.pathA,
    disposition: "evaluated",
    roomPrior: {
      attempted: true,
      provider: "google_gemini",
      model: "gemini-3.5-flash",
      promptVersion: "afc-v2-metric-room-prior/v1",
      evidenceSchemaVersion: "afc-v2-metric-room-prior-evidence/v1",
      estimatePresent: true,
      failure: null,
      observability: "recoverable",
      estimatedRoomWidthM: { low: 3.2, best: 4.1, high: 5 },
      estimatedRoomDepthM: { low: 2.8, best: 3.4, high: 4 },
      estimatedCeilingHeightM: 2.4,
      modelConfidence: 0.8,
      hostAcceptance: {
        class: "accepted",
        reasonCodes: ["host_accepted_width_prior"],
      },
    },
    geometryCorrespondence: {
      selectionStatus: "selected",
      selectionReasonCodes: ["back_floor_wall"],
      selectedSpan: {
        id: "span-back",
        source: "s4a_floor_wall",
        role: "back_floor_wall",
        canonicalLength: 3.28,
        imageA: { x: 0.123, y: 0.842 },
        imageB: { x: 0.774, y: 0.837 },
        correspondenceSpanTrust: "trusted",
        correspondenceSource: "identity_uv",
        lineage: {
          s4aCandidateId: "s4a-1",
          sourceSeamId: "seam-1",
        },
      },
      rejectedAlternatives: [
        {
          id: "span-left",
          role: "left_floor_wall",
          reason: "too_short_in_image",
        },
      ],
    },
    spanTrust: {
      trusted: true,
      reasonCodes: ["trusted_back_wall"],
      s4aSafetyPresent: true,
      observedSpanOnly: false,
      hiddenContinuation: false,
      geometryManufactured: false,
    },
    exactGrid: {
      consultedTier: "exact_grid_compatible",
      trustSelectedBackSpanAsFullWidth: true,
      exactGridCompatible: true,
      oldCompatibilityTier: "exact_grid_compatible",
      emptyAuthoritativeCompatibilityTier: "exact_grid_compatible",
      roomBoundaryCompatibilityTier: "exact_grid_compatible",
    },
    derivation: {
      physicalMetres: 4.1,
      parsedWidthBest: 4.1,
      canonicalGaugeLength: 3.28,
      candidateScaleBeforeFallback: 1.25,
      candidateFinite: true,
      catastrophicSanity: "inside",
      accepted: true,
      reasonCodes: ["host_accepted_width_prior"],
      authority: "gemini_width_back_span_experimental",
    },
  };
  decision.pathB = {
    ...decision.pathB,
    selection: {
      selectionAttempted: true,
      selectionStatus: "suppressed_by_path_a",
      selectionReasonCodes: ["path_a_complete_back_geometry_present"],
      selectedCandidateId: null,
      pathAGeometry: {
        exists: true,
        selectedId: "span-back",
        reasonCodes: ["complete_back_geometry_present"],
      },
      suppressWhenCompleteBackGeometryExists: true,
    },
    launchDisposition: "suppressed_complete_back_geometry",
  };
  decision.fallback = {
    ...decision.fallback,
    used: false,
    numericFallback: null,
    winningPathReceipt: "path_a",
    reasonCodes: ["host_accepted_width_prior"],
  };
  return decision;
}

/**
 * Representative future equivalent of a scale-1 hard fallback.
 * This is not a reconstruction of any historical Case.
 */
export function hardFallbackMetricDecisionRaw(): AfcV2MetricDecisionDiagnosticV1 {
  const decision = editable();
  decision.finalDecision = {
    ...decision.finalDecision,
    selectedPath: "none",
    accepted: false,
    authority: "none",
    metricScale: 1,
    autoMetricScale: 1,
    fallbackApplied: true,
    safeFailureState: "metric_fallback",
    winningReasonCodes: ["lab_trust_not_enabled", "completeness_not_certified"],
    rejectedCandidatePresent: true,
    rejectedCandidateScale: 0.42,
    rejectedCandidateFinite: true,
    fallbackSubstitutedAfterRejection: true,
  };
  decision.pathA = {
    ...decision.pathA,
    disposition: "evaluated",
    roomPrior: {
      attempted: true,
      provider: "google_gemini",
      model: "gemini-3.5-flash",
      promptVersion: "afc-v2-metric-room-prior/v1",
      evidenceSchemaVersion: "afc-v2-metric-room-prior-evidence/v1",
      estimatePresent: true,
      failure: null,
      observability: "recoverable",
      estimatedRoomWidthM: { low: 3.2, best: 4.1, high: 5 },
      estimatedRoomDepthM: { low: 2.8, best: 3.4, high: 4 },
      estimatedCeilingHeightM: null,
      modelConfidence: 0.8,
      hostAcceptance: {
        class: "accepted",
        reasonCodes: ["host_accepted_width_prior"],
      },
    },
    geometryCorrespondence: {
      selectionStatus: "selected",
      selectionReasonCodes: ["back_floor_wall"],
      selectedSpan: {
        id: "span-back",
        source: "s4a_floor_wall",
        role: "back_floor_wall",
        canonicalLength: 3.28,
        imageA: { x: 0.123, y: 0.842 },
        imageB: { x: 0.774, y: 0.837 },
        correspondenceSpanTrust: "trusted",
        correspondenceSource: "identity_uv",
        lineage: {
          s4aCandidateId: "s4a-1",
          sourceSeamId: "seam-1",
        },
      },
      rejectedAlternatives: [
        {
          id: "span-left",
          role: "left_floor_wall",
          reason: "too_short_in_image",
        },
      ],
    },
    spanTrust: {
      trusted: false,
      reasonCodes: [
        "lab_trust_not_enabled",
        "completeness_not_certified",
        "The model wrote a long note about the room",
      ],
      s4aSafetyPresent: true,
      observedSpanOnly: false,
      hiddenContinuation: false,
      geometryManufactured: false,
    },
    exactGrid: {
      consultedTier: "exact_grid_compatible",
      trustSelectedBackSpanAsFullWidth: false,
      exactGridCompatible: false,
      oldCompatibilityTier: "exact_grid_compatible",
      emptyAuthoritativeCompatibilityTier: "exact_grid_compatible",
      roomBoundaryCompatibilityTier: "exact_grid_compatible",
    },
    derivation: {
      physicalMetres: 4.1,
      parsedWidthBest: 4.1,
      canonicalGaugeLength: 3.28,
      candidateScaleBeforeFallback: 0.42,
      candidateFinite: true,
      catastrophicSanity: "inside",
      accepted: false,
      reasonCodes: ["lab_trust_not_enabled", "completeness_not_certified"],
      authority: "none",
    },
  };
  decision.pathB = {
    ...decision.pathB,
    selection: {
      selectionAttempted: true,
      selectionStatus: "no_eligible_observed_span",
      selectionReasonCodes: ["no_candidate"],
      selectedCandidateId: null,
      pathAGeometry: {
        exists: true,
        selectedId: "span-back",
        reasonCodes: ["path_a_geometry_present"],
      },
      suppressWhenCompleteBackGeometryExists: true,
    },
    launchDisposition: "not_launched_no_candidate",
  };
  decision.fallback = {
    used: true,
    numericFallback: 1,
    constantName: AFC_V2_METRIC_DECISION_FALLBACK_CONSTANT_NAME,
    reasonCodes: ["lab_trust_not_enabled", "completeness_not_certified"],
    winningPathReceipt: "none",
  };
  return decision;
}

export function pathBLaunchedUnusableMetricDecisionRaw(): AfcV2MetricDecisionDiagnosticV1 {
  const decision = editable();
  decision.pathB = {
    ...decision.pathB,
    selection: {
      ...decision.pathB.selection,
      selectionAttempted: true,
      selectionStatus: "selected",
      selectedCandidateId: "span-observed",
    },
    launchDisposition: "launched",
    modelCall: {
      estimatorLaunched: true,
      provider: "google_gemini",
      model: "gemini-3.5-flash",
      promptVersion: "afc-v2-observed-span/v1",
      schemaVersion: "afc-v2-observed-span-evidence/v1",
    },
    modelEstimate: {
      status: "not_recoverable",
      estimatedLengthM: null,
      modelConfidence: null,
      hostAcceptance: {
        class: "unobservable_rejected",
        reasonCodes: ["estimate_unusable"],
        candidateScale: null,
      },
    },
    derivation: {
      candidateScaleBeforeFallback: null,
      lineageStatus: "not_evaluated",
      catastrophicSanity: "not_evaluated",
      accepted: false,
      authority: "none",
      reasonCodes: ["estimate_unusable"],
    },
  };
  return decision;
}

export function pathBAcceptedMetricDecisionRaw(): AfcV2MetricDecisionDiagnosticV1 {
  const decision = editable();
  decision.finalDecision = {
    ...decision.finalDecision,
    selectedPath: "path_b",
    accepted: true,
    authority: "gemini_observed_span_physical_estimate",
    metricScale: 1.1,
    autoMetricScale: 1.1,
    fallbackApplied: false,
    safeFailureState: "none",
    winningReasonCodes: ["host_accepted_observed_span"],
  };
  decision.pathB = {
    selection: {
      selectionAttempted: true,
      selectionStatus: "selected",
      selectionReasonCodes: ["observed_span_selected"],
      selectedCandidateId: "span-observed",
      pathAGeometry: {
        exists: false,
        selectedId: null,
        reasonCodes: [],
      },
      suppressWhenCompleteBackGeometryExists: true,
    },
    launchDisposition: "launched",
    hostGeometry: {
      id: "span-observed",
      role: "back_floor_wall",
      imageA: { x: 0.21, y: 0.73 },
      imageB: { x: 0.68, y: 0.74 },
      canonicalLength: 2.4,
      sourceSeamId: "seam-b",
      floorAuthorityKey: "floor-authority-1",
      s4aCandidateId: "s4a-b",
      freezeReceiptVersion: "afc-v2-freeze/v1",
      freezePayloadSha256: "ab".repeat(32),
      overlayImageHash: "cd".repeat(32),
      junctionType: null,
    },
    modelCall: {
      estimatorLaunched: true,
      provider: "google_gemini",
      model: "gemini-3.5-flash",
      promptVersion: "afc-v2-observed-span/v1",
      schemaVersion: "afc-v2-observed-span-evidence/v1",
    },
    modelEstimate: {
      status: "recoverable",
      estimatedLengthM: { low: 2.1, best: 2.4, high: 2.7 },
      modelConfidence: 0.7,
      hostAcceptance: {
        class: "accepted",
        reasonCodes: ["host_accepted_observed_span"],
        candidateScale: 1.1,
      },
    },
    derivation: {
      candidateScaleBeforeFallback: 1.1,
      lineageStatus: "not_lineage_rejected",
      catastrophicSanity: "inside",
      accepted: true,
      authority: "gemini_observed_span_physical_estimate",
      reasonCodes: ["host_accepted_observed_span"],
    },
  };
  decision.fallback = {
    ...decision.fallback,
    used: false,
    winningPathReceipt: "path_b",
    reasonCodes: ["host_accepted_observed_span"],
  };
  return decision;
}

export function roomPriorFailureMetricDecisionRaw(): AfcV2MetricDecisionDiagnosticV1 {
  const decision = editable();
  decision.pathA = {
    ...decision.pathA,
    disposition: "evaluated",
    roomPrior: {
      ...decision.pathA.roomPrior,
      attempted: true,
      provider: "google_gemini",
      model: "gemini-3.5-flash",
      promptVersion: "afc-v2-metric-room-prior/v1",
      failure: {
        failureClass: "provider_http",
        failureStage: "provider_response",
        providerStatus: 503,
        contractValidationReason: "response_shape_invalid",
        safeDetail: "provider_status_503",
      },
    },
  };
  return decision;
}
