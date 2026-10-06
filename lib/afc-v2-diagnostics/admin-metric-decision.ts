/**
 * AFR-1D read mapping for persisted metric_decision JSON.
 *
 * Calls the AFR-1B parser and emits a whitelist DTO. Does not project
 * runtime receipts, change capture, or infer missing history.
 */

import {
  parseAfcV2MetricDecision,
  type AfcV2MetricDecisionDiagnosticV1,
} from "@/lib/afc-v2-production/metric-decision-diagnostic";

import {
  AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION,
  AFC_DIAGNOSTIC_ADMIN_METRIC_FALLBACK_CONSTANT_NAME,
  parseAfcDiagnosticAdminLegacyMetricConclusion,
  parseAfcDiagnosticAdminMetricDecisionDto,
  publishAfcDiagnosticMetricCodes,
  publishAfcDiagnosticMetricDetail,
  publishAfcDiagnosticMetricFloorAuthorityKey,
  publishAfcDiagnosticMetricHash,
  publishAfcDiagnosticMetricToken,
  type AfcDiagnosticAdminLegacyMetricConclusion,
  type AfcDiagnosticAdminMetricDecision,
  type AfcDiagnosticAdminMetricDecisionRecordedValue,
  type AfcDiagnosticMetricAuthority,
  type AfcDiagnosticMetricPath,
  type AfcDiagnosticMetricSafeFailure,
} from "./admin-metric-decision-dto";

function unreadable(): AfcDiagnosticAdminMetricDecision {
  return Object.freeze({ kind: "unreadable" });
}

function finiteOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function triple(
  value: AfcV2MetricDecisionDiagnosticV1["pathA"]["roomPrior"]["estimatedRoomWidthM"],
): AfcDiagnosticAdminMetricDecisionRecordedValue["pathA"]["roomPrior"]["estimatedRoomWidthM"] {
  if (!value) return null;
  return Object.freeze({
    low: value.low,
    best: value.best,
    high: value.high,
  });
}

function point(
  value: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  return Object.freeze({ x: value.x, y: value.y });
}

function projectRecorded(
  decision: AfcV2MetricDecisionDiagnosticV1,
): AfcDiagnosticAdminMetricDecisionRecordedValue {
  const span = decision.pathA.geometryCorrespondence.selectedSpan;
  const selectedSpan = span == null ||
      publishAfcDiagnosticMetricToken(span.id) == null ||
      publishAfcDiagnosticMetricToken(span.source) == null ||
      publishAfcDiagnosticMetricToken(span.role) == null ||
      publishAfcDiagnosticMetricToken(span.correspondenceSpanTrust) == null
    ? null
    : Object.freeze({
        id: publishAfcDiagnosticMetricToken(span.id) as string,
        source: publishAfcDiagnosticMetricToken(span.source) as string,
        role: publishAfcDiagnosticMetricToken(span.role) as string,
        canonicalLength: span.canonicalLength,
        imageA: point(span.imageA),
        imageB: point(span.imageB),
        correspondenceSpanTrust: publishAfcDiagnosticMetricToken(
          span.correspondenceSpanTrust,
        ) as string,
        correspondenceSource: publishAfcDiagnosticMetricToken(span.correspondenceSource),
        s4aCandidateId: publishAfcDiagnosticMetricToken(span.lineage.s4aCandidateId),
        sourceSeamId: publishAfcDiagnosticMetricToken(span.lineage.sourceSeamId),
      });

  const rejectedAlternatives = decision.pathA.geometryCorrespondence.rejectedAlternatives
    .flatMap((alternative) => {
      const id = publishAfcDiagnosticMetricToken(alternative.id);
      const role = publishAfcDiagnosticMetricToken(alternative.role);
      const reasonCodes = publishAfcDiagnosticMetricCodes([alternative.reason]);
      if (!id || !role || reasonCodes.length !== 1) return [];
      return [Object.freeze({ id, role, reasonCode: reasonCodes[0] })];
    });

  const failure = decision.pathA.roomPrior.failure;
  const hostAcceptance = decision.pathA.roomPrior.hostAcceptance;
  const hostClass = hostAcceptance
    ? publishAfcDiagnosticMetricToken(hostAcceptance.class)
    : null;

  const geometry = decision.pathB.hostGeometry;
  const hostGeometry = geometry == null ||
      publishAfcDiagnosticMetricToken(geometry.id) == null ||
      publishAfcDiagnosticMetricToken(geometry.role) == null ||
      publishAfcDiagnosticMetricToken(geometry.sourceSeamId) == null ||
      publishAfcDiagnosticMetricFloorAuthorityKey(geometry.floorAuthorityKey) == null ||
      publishAfcDiagnosticMetricToken(geometry.s4aCandidateId) == null
    ? null
    : Object.freeze({
        id: publishAfcDiagnosticMetricToken(geometry.id) as string,
        role: publishAfcDiagnosticMetricToken(geometry.role) as string,
        canonicalLength: geometry.canonicalLength,
        imageA: point(geometry.imageA),
        imageB: point(geometry.imageB),
        sourceSeamId: publishAfcDiagnosticMetricToken(geometry.sourceSeamId) as string,
        floorAuthorityKey: publishAfcDiagnosticMetricFloorAuthorityKey(
          geometry.floorAuthorityKey,
        ) as string,
        s4aCandidateId: publishAfcDiagnosticMetricToken(geometry.s4aCandidateId) as string,
        freezeReceiptVersion: publishAfcDiagnosticMetricToken(geometry.freezeReceiptVersion),
        freezePayloadSha256: publishAfcDiagnosticMetricHash(geometry.freezePayloadSha256),
        overlayImageHash: publishAfcDiagnosticMetricHash(geometry.overlayImageHash),
      });

  const pathBHost = decision.pathB.modelEstimate.hostAcceptance;
  const pathBHostClass = pathBHost
    ? publishAfcDiagnosticMetricToken(pathBHost.class)
    : null;

  return Object.freeze({
    generationId: publishAfcDiagnosticMetricToken(decision.generationId) ?? "",
    finalDecision: Object.freeze({
      selectedPath: decision.finalDecision.selectedPath,
      accepted: decision.finalDecision.accepted,
      authority: decision.finalDecision.authority,
      metricScale: finiteOrNull(decision.finalDecision.metricScale),
      autoMetricScale: finiteOrNull(decision.finalDecision.autoMetricScale),
      fallbackApplied: decision.finalDecision.fallbackApplied,
      safeFailureState: decision.finalDecision.safeFailureState,
      winningReasonCodes: publishAfcDiagnosticMetricCodes(
        decision.finalDecision.winningReasonCodes,
      ),
      rejectedCandidatePresent: decision.finalDecision.rejectedCandidatePresent,
      rejectedCandidateScale: finiteOrNull(decision.finalDecision.rejectedCandidateScale),
      rejectedCandidateFinite: decision.finalDecision.rejectedCandidateFinite,
    }),
    pathA: Object.freeze({
      disposition: decision.pathA.disposition,
      roomPrior: Object.freeze({
        attempted: decision.pathA.roomPrior.attempted,
        provider: publishAfcDiagnosticMetricToken(decision.pathA.roomPrior.provider),
        model: publishAfcDiagnosticMetricToken(decision.pathA.roomPrior.model),
        promptVersion: publishAfcDiagnosticMetricToken(decision.pathA.roomPrior.promptVersion),
        observability: publishAfcDiagnosticMetricToken(decision.pathA.roomPrior.observability),
        estimatedRoomWidthM: triple(decision.pathA.roomPrior.estimatedRoomWidthM),
        estimatedRoomDepthM: triple(decision.pathA.roomPrior.estimatedRoomDepthM),
        estimatedCeilingHeightM: finiteOrNull(decision.pathA.roomPrior.estimatedCeilingHeightM),
        modelConfidence: finiteOrNull(decision.pathA.roomPrior.modelConfidence),
        hostAcceptance: hostAcceptance && hostClass
          ? Object.freeze({
              class: hostClass,
              reasonCodes: publishAfcDiagnosticMetricCodes(hostAcceptance.reasonCodes),
            })
          : null,
        failure: failure &&
            publishAfcDiagnosticMetricToken(failure.failureClass) &&
            publishAfcDiagnosticMetricToken(failure.failureStage)
          ? Object.freeze({
              failureClass: publishAfcDiagnosticMetricToken(failure.failureClass) as string,
              failureStage: publishAfcDiagnosticMetricToken(failure.failureStage) as string,
              providerStatus: finiteOrNull(failure.providerStatus),
              contractValidationReason: publishAfcDiagnosticMetricToken(
                failure.contractValidationReason,
              ),
              safeDetail: publishAfcDiagnosticMetricDetail(failure.safeDetail),
            })
          : null,
      }),
      geometryCorrespondence: Object.freeze({
        selectionStatus: publishAfcDiagnosticMetricToken(
          decision.pathA.geometryCorrespondence.selectionStatus,
        ),
        selectionReasonCodes: publishAfcDiagnosticMetricCodes(
          decision.pathA.geometryCorrespondence.selectionReasonCodes,
        ),
        selectedSpan,
        rejectedAlternatives: Object.freeze(rejectedAlternatives),
      }),
      spanTrust: Object.freeze({
        trusted: decision.pathA.spanTrust.trusted,
        reasonCodes: publishAfcDiagnosticMetricCodes(decision.pathA.spanTrust.reasonCodes),
        s4aSafetyPresent: decision.pathA.spanTrust.s4aSafetyPresent,
        observedSpanOnly: decision.pathA.spanTrust.observedSpanOnly,
        hiddenContinuation: decision.pathA.spanTrust.hiddenContinuation,
        geometryManufactured: decision.pathA.spanTrust.geometryManufactured,
      }),
      exactGrid: Object.freeze({
        consultedTier: publishAfcDiagnosticMetricToken(decision.pathA.exactGrid.consultedTier),
        trustSelectedBackSpanAsFullWidth:
          decision.pathA.exactGrid.trustSelectedBackSpanAsFullWidth,
        exactGridCompatible: decision.pathA.exactGrid.exactGridCompatible,
        oldCompatibilityTier: publishAfcDiagnosticMetricToken(
          decision.pathA.exactGrid.oldCompatibilityTier,
        ),
        emptyAuthoritativeCompatibilityTier: publishAfcDiagnosticMetricToken(
          decision.pathA.exactGrid.emptyAuthoritativeCompatibilityTier,
        ),
        roomBoundaryCompatibilityTier: publishAfcDiagnosticMetricToken(
          decision.pathA.exactGrid.roomBoundaryCompatibilityTier,
        ),
      }),
      derivation: Object.freeze({
        parsedWidthBest: finiteOrNull(decision.pathA.derivation.parsedWidthBest),
        physicalMetres: finiteOrNull(decision.pathA.derivation.physicalMetres),
        canonicalGaugeLength: finiteOrNull(decision.pathA.derivation.canonicalGaugeLength),
        candidateScaleBeforeFallback: finiteOrNull(
          decision.pathA.derivation.candidateScaleBeforeFallback,
        ),
        candidateFinite: decision.pathA.derivation.candidateFinite,
        catastrophicSanity: decision.pathA.derivation.catastrophicSanity,
        accepted: decision.pathA.derivation.accepted,
        authority: decision.pathA.derivation.authority,
        reasonCodes: publishAfcDiagnosticMetricCodes(decision.pathA.derivation.reasonCodes),
      }),
    }),
    pathB: Object.freeze({
      selection: Object.freeze({
        selectionAttempted: decision.pathB.selection.selectionAttempted,
        selectionStatus: publishAfcDiagnosticMetricToken(decision.pathB.selection.selectionStatus),
        selectionReasonCodes: publishAfcDiagnosticMetricCodes(
          decision.pathB.selection.selectionReasonCodes,
        ),
        selectedCandidateId: publishAfcDiagnosticMetricToken(
          decision.pathB.selection.selectedCandidateId,
        ),
        pathAGeometry: Object.freeze({
          exists: decision.pathB.selection.pathAGeometry.exists,
          selectedId: publishAfcDiagnosticMetricToken(
            decision.pathB.selection.pathAGeometry.selectedId,
          ),
          reasonCodes: publishAfcDiagnosticMetricCodes(
            decision.pathB.selection.pathAGeometry.reasonCodes,
          ),
        }),
        suppressWhenCompleteBackGeometryExists:
          decision.pathB.selection.suppressWhenCompleteBackGeometryExists,
      }),
      launchDisposition: decision.pathB.launchDisposition,
      estimatorLaunched: decision.pathB.modelCall.estimatorLaunched,
      hostGeometry,
      model: Object.freeze({
        provider: publishAfcDiagnosticMetricToken(decision.pathB.modelCall.provider),
        model: publishAfcDiagnosticMetricToken(decision.pathB.modelCall.model),
        promptVersion: publishAfcDiagnosticMetricToken(decision.pathB.modelCall.promptVersion),
        schemaVersion: publishAfcDiagnosticMetricToken(decision.pathB.modelCall.schemaVersion),
        estimateStatus: publishAfcDiagnosticMetricToken(decision.pathB.modelEstimate.status),
        estimatedLengthM: triple(decision.pathB.modelEstimate.estimatedLengthM),
        modelConfidence: finiteOrNull(decision.pathB.modelEstimate.modelConfidence),
        hostAcceptance: pathBHost && pathBHostClass
          ? Object.freeze({
              class: pathBHostClass,
              reasonCodes: publishAfcDiagnosticMetricCodes(pathBHost.reasonCodes),
              candidateScale: finiteOrNull(pathBHost.candidateScale),
            })
          : null,
      }),
      derivation: Object.freeze({
        candidateScaleBeforeFallback: finiteOrNull(
          decision.pathB.derivation.candidateScaleBeforeFallback,
        ),
        lineageStatus: decision.pathB.derivation.lineageStatus,
        catastrophicSanity: decision.pathB.derivation.catastrophicSanity,
        accepted: decision.pathB.derivation.accepted,
        authority: decision.pathB.derivation.authority,
        reasonCodes: publishAfcDiagnosticMetricCodes(decision.pathB.derivation.reasonCodes),
      }),
    }),
    fallback: Object.freeze({
      used: decision.fallback.used,
      numericFallback: finiteOrNull(decision.fallback.numericFallback),
      constantName: AFC_DIAGNOSTIC_ADMIN_METRIC_FALLBACK_CONSTANT_NAME,
      winningPath: decision.fallback.winningPathReceipt,
      reasonCodes: publishAfcDiagnosticMetricCodes(decision.fallback.reasonCodes),
    }),
  });
}

export function mapAfcDiagnosticAdminMetricDecision(
  value: unknown,
): AfcDiagnosticAdminMetricDecision {
  try {
    const parsed = parseAfcV2MetricDecision(value);
    if (!parsed.ok) return unreadable();
    if (parsed.decision === null) return null;
    if ("kind" in parsed.decision && parsed.decision.kind === "unsupported_schema") {
      return parseAfcDiagnosticAdminMetricDecisionDto({
        kind: "unsupported_schema",
        schemaVersion: publishAfcDiagnosticMetricToken(parsed.decision.schemaVersion) ??
          "unavailable",
      });
    }
    if (!("captureStatus" in parsed.decision)) return unreadable();
    if (parsed.decision.captureStatus === "capture_failed") {
      const generationId = publishAfcDiagnosticMetricToken(parsed.decision.generationId);
      if (!generationId) return unreadable();
      return parseAfcDiagnosticAdminMetricDecisionDto({
        kind: "capture_failed",
        schemaVersion: AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION,
        generationId,
      });
    }
    if (parsed.decision.schemaVersion !== AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION) {
      return unreadable();
    }
    return parseAfcDiagnosticAdminMetricDecisionDto({
      kind: "recorded",
      schemaVersion: AFC_DIAGNOSTIC_ADMIN_METRIC_DECISION_SCHEMA_VERSION,
      value: projectRecorded(parsed.decision),
    });
  } catch {
    return unreadable();
  }
}

function enumOrNull<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : null;
}

export function mapAfcDiagnosticAdminLegacyMetricConclusion(
  authority: unknown,
): AfcDiagnosticAdminLegacyMetricConclusion | null {
  try {
    if (!authority || typeof authority !== "object" || Array.isArray(authority)) {
      return null;
    }
    const record = authority as Record<string, unknown>;
    const metric = record.metric;
    if (!metric || typeof metric !== "object" || Array.isArray(metric)) return null;
    const metricRecord = metric as Record<string, unknown>;
    const recovery = record.recovery;
    const recoveryRecord = recovery && typeof recovery === "object" && !Array.isArray(recovery)
      ? recovery as Record<string, unknown>
      : null;
    const conclusion = {
      metricScale: typeof metricRecord.metricScale === "number" &&
          Number.isFinite(metricRecord.metricScale)
        ? metricRecord.metricScale
        : null,
      autoMetricScale: typeof metricRecord.autoMetricScale === "number" &&
          Number.isFinite(metricRecord.autoMetricScale)
        ? metricRecord.autoMetricScale
        : null,
      accepted: typeof metricRecord.accepted === "boolean" ? metricRecord.accepted : null,
      path: enumOrNull<AfcDiagnosticMetricPath>(metricRecord.path, [
        "path_a",
        "path_b",
        "none",
      ]),
      authority: enumOrNull<AfcDiagnosticMetricAuthority>(metricRecord.authority, [
        "none",
        "gemini_width_back_span_experimental",
        "gemini_observed_span_physical_estimate",
      ]),
      fallbackApplied: typeof metricRecord.fallbackApplied === "boolean"
        ? metricRecord.fallbackApplied
        : null,
      safeFailureState: enumOrNull<AfcDiagnosticMetricSafeFailure>(
        recoveryRecord?.safeFailureState,
        ["none", "metric_fallback", "collision_empty"],
      ),
    };
    return parseAfcDiagnosticAdminLegacyMetricConclusion(conclusion);
  } catch {
    return null;
  }
}
