/**
 * Server-side Auto Metric for production AFC.
 *
 * Uses certified Path A / Path B helpers. Lab trust checkbox and
 * userWorldScale are not production controls: metricScale equals
 * autoMetricScale, and Path A trust follows the certified exact-grid
 * default. Fail closed to autoMetricScale = 1.
 */

import type { AfcV2AnalyzeResult } from "@/app/admin/3d-room-lab-v2/afc-v2-analysis.server";
import {
  defaultTrustSelectedBackSpanAsFullWidth,
  labCompatibilityTierForTrustDefault,
} from "@/app/admin/3d-room-lab-v2/metric-lab-ux";
import {
  deriveAutoMetricScale,
  evaluateTrustedBackWallWidthSpan,
  type AutoMetricCandidateObservation,
  type TrustedBackWallWidthSpanResult,
} from "@/app/admin/3d-room-lab-v2/metric-auto-scale";
import type {
  AutoMetricS4aSafetyEvidence,
  AutoMetricScaleReceipt,
} from "@/app/admin/3d-room-lab-v2/metric-auto-scale-contract";
import {
  appliedAutoMetricPath,
  deriveObservedSpanAutoMetricScale,
  selectAppliedAutoMetricScale,
} from "@/app/admin/3d-room-lab-v2/observed-span-auto-metric-scale";
import { AUTO_METRIC_SCALE } from "@/app/admin/3d-room-lab-v2/scene-metric-world-realization";

export type ProductionAutoMetric = Readonly<{
  receipt: AutoMetricScaleReceipt;
  path: "path_a" | "path_b" | "none";
  metricScale: number;
}>;

/**
 * Write-only evidence retained from the production metric pass.
 * `deriveProductionAutoMetric` never reads these fields back.
 */
export type ProductionMetricObservation = {
  pathAReceipt: AutoMetricScaleReceipt | null;
  pathBReceipt: AutoMetricScaleReceipt | null;
  pathACandidateScaleBeforeFallback: number | null;
  spanTrust: TrustedBackWallWidthSpanResult | null;
  s4aSafety: AutoMetricS4aSafetyEvidence | null;
  compatibilityTier: string | null;
  trustSelectedBackSpanAsFullWidth: boolean | null;
  completeBackGeometryExists: boolean | null;
};

export function createProductionMetricObservation(): ProductionMetricObservation {
  return {
    pathAReceipt: null,
    pathBReceipt: null,
    pathACandidateScaleBeforeFallback: null,
    spanTrust: null,
    s4aSafety: null,
    compatibilityTier: null,
    trustSelectedBackSpanAsFullWidth: null,
    completeBackGeometryExists: null,
  };
}

function s4aSafetyFromApplied(
  analysis: Extract<AfcV2AnalyzeResult, { status: "applied" }>,
) {
  const selected = analysis.metricCorrespondence?.selected ?? null;
  const candidateId = selected?.lineage.s4aCandidateId ?? null;
  const matched = candidateId
    ? analysis.roomBoundaries?.candidates.find(
      (candidate) => candidate.id === candidateId,
    ) ?? null
    : null;
  if (!matched) return null;
  return {
    observedSpanOnly: matched.limitations.observedSpanOnly,
    hiddenContinuation: matched.limitations.hiddenContinuation,
    geometryManufactured: matched.limitations.geometryManufactured,
  };
}

export function deriveProductionAutoMetric(
  analysis: Extract<AfcV2AnalyzeResult, { status: "applied" }>,
  observation?: ProductionMetricObservation,
): ProductionAutoMetric {
  const selected = analysis.metricCorrespondence?.selected ?? null;
  const s4aSafety = s4aSafetyFromApplied(analysis);
  const compatibilityTier = labCompatibilityTierForTrustDefault({
    oldCompatibilityTier:
      analysis.emptyOriginalRegistration?.oldCompatibilityTier,
    emptyAuthoritativeCompatibilityTier:
      analysis.emptyAuthoritativeCollision?.lineage.compatibilityTier,
    roomBoundaryCompatibilityTier:
      analysis.roomCollision?.lineage.roomBoundary.compatibilityTier,
  });
  const trustSelectedBackSpanAsFullWidth =
    defaultTrustSelectedBackSpanAsFullWidth(compatibilityTier);
  const pathACandidate: AutoMetricCandidateObservation = {
    candidateScaleBeforeFallback: null,
  };
  const pathA = deriveAutoMetricScale({
    roomPrior: analysis.metricRoomPrior,
    selected,
    s4aSafety,
    trustSelectedBackSpanAsFullWidth,
  }, observation ? pathACandidate : undefined);
  const spanTrust = evaluateTrustedBackWallWidthSpan(selected, s4aSafety);
  const completeBackGeometryExists = spanTrust.trusted;
  const pathB = deriveObservedSpanAutoMetricScale({
    estimate: analysis.observedSpanPhysicalEstimate,
    candidate: analysis.observedSpanMetricSelection?.selected ?? null,
    completeBackGeometryExists,
  });
  const receipt = selectAppliedAutoMetricScale({
    pathA,
    pathB,
    completeBackGeometryExists,
  });
  const autoMetricScale = Number.isFinite(receipt.autoMetricScale) &&
      receipt.autoMetricScale > 0
    ? receipt.autoMetricScale
    : AUTO_METRIC_SCALE;
  if (observation) {
    observation.pathAReceipt = pathA;
    observation.pathBReceipt = pathB;
    observation.pathACandidateScaleBeforeFallback =
      pathACandidate.candidateScaleBeforeFallback;
    observation.spanTrust = spanTrust;
    observation.s4aSafety = s4aSafety;
    observation.compatibilityTier = compatibilityTier;
    observation.trustSelectedBackSpanAsFullWidth =
      trustSelectedBackSpanAsFullWidth;
    observation.completeBackGeometryExists = completeBackGeometryExists;
  }
  return Object.freeze({
    receipt,
    path: appliedAutoMetricPath(receipt),
    metricScale: autoMetricScale,
  });
}
