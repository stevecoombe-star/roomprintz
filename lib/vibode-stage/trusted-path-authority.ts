/**
 * Read-only selection of the certified AFC path for Room Scale display.
 *
 * Path A uses the trusted span's physical metres. Path B uses the accepted
 * observed-span estimate. Image endpoints stay the diagnostic span. This
 * module does not recompute AFC, and it does not write a scaled length back.
 */

import { classifyAfcR3cImagePairCompatibility } from "@/app/admin/3d-room-lab/research/afc-r3c-image-pair-compatibility";
import { parseAfcV2MetricDecision } from "@/lib/afc-v2-production/metric-decision-diagnostic";

import {
  parseTrustedPathBaseline,
  type TrustedPathBaseline,
  type TrustedPathImagePoint,
} from "./trusted-path";

export function trustedPathBaselineFromGeneration(input: Readonly<{
  metricDecision: unknown;
  originalWidth: number;
  originalHeight: number;
  emptyWidth: number;
  emptyHeight: number;
}>): TrustedPathBaseline | null {
  const parsed = parseAfcV2MetricDecision(input.metricDecision);
  if (!parsed.ok || parsed.decision == null) return null;
  if (
    !("captureStatus" in parsed.decision) ||
    parsed.decision.captureStatus !== "recorded"
  ) {
    return null;
  }
  const decision = parsed.decision;
  if (
    decision.finalDecision.selectedPath === "path_a" &&
    decision.finalDecision.accepted === true &&
    decision.pathA.spanTrust.trusted === true &&
    decision.pathA.derivation.accepted === true
  ) {
    const metres = decision.pathA.derivation.physicalMetres;
    const span = decision.pathA.geometryCorrespondence.selectedSpan;
    if (!positiveLength(metres) || !span) return null;
    return baseline(metres, span.imageA, span.imageB);
  }
  if (
    decision.finalDecision.selectedPath === "path_b" &&
    decision.finalDecision.accepted === true &&
    decision.pathB.derivation.accepted === true &&
    pathBBasisAdmitted(input)
  ) {
    const metres = decision.pathB.modelEstimate.estimatedLengthM?.best;
    const geometry = decision.pathB.hostGeometry;
    if (!positiveLength(metres) || !geometry) return null;
    return baseline(metres, geometry.imageA, geometry.imageB);
  }
  return null;
}

function baseline(
  metres: number,
  imageA: TrustedPathImagePoint,
  imageB: TrustedPathImagePoint,
): TrustedPathBaseline | null {
  return parseTrustedPathBaseline({
    baselineLengthMeters: metres,
    imageA,
    imageB,
  });
}

function positiveLength(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Path B endpoints are EMPTY-normalized. The AFC transfer copies those
 * numbers onto the original when the pair is exact-grid or an
 * aspect-compatible rescale. An incompatible pair stays unavailable.
 * Orientation is 1 because production identities are stored that way.
 * The fingerprint is only the classifier's image shape; the tier uses
 * dimensions and orientation.
 */
function pathBBasisAdmitted(input: Readonly<{
  originalWidth: number;
  originalHeight: number;
  emptyWidth: number;
  emptyHeight: number;
}>): boolean {
  const compatibility = classifyAfcR3cImagePairCompatibility(
    {
      fingerprint: "original",
      decodedWidth: input.originalWidth,
      decodedHeight: input.originalHeight,
      orientation: 1,
    },
    {
      fingerprint: "empty",
      decodedWidth: input.emptyWidth,
      decodedHeight: input.emptyHeight,
      orientation: 1,
    },
  );
  return compatibility.tier === "exact_grid_compatible" ||
    compatibility.tier === "aspect_compatible_rescaled";
}
