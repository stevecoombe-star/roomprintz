// --- Phase 2O-D: Constrained Diagnostic Trial generation --------------------
// Pure, deterministic, NON-MUTATING generation of temporary diagnostic trial
// quads bounded entirely by operator-approved manual seam authority.
//
// HARD GUARANTEES:
// - Never mutates the input candidate; always clones the container-normalized
//   quad tuple before replacing any permitted corner.
// - Never imports the solver (quad-solvability / evaluateQuadSolvability),
//   Apply/FOV/snapshot/scene-state, or any UI/state setters.
// - Abstain mode => no trial run (returns null). Direct mode => baseline only.
// - A support state NEVER grants free movement; movement requires explicit,
//   validating seam authority (mode + authority + seam + corridor + span).
//
// Coordinate spaces:
// - Candidate / trial quads: container-normalized, canonical order [NL,NR,FR,FL].
// - Manual seam geometry: source-image normalized.
// - Conversions go through trial-geometry wrappers (cover-crop image-space).

import type {
  FloorCornerLabel,
  ManualFloorSupportAnnotation,
} from "./manual-floor-support-types";
import { validateManualFloorSupportAnnotation } from "./manual-floor-support-validation";
import {
  CANONICAL_CORNER_INDEX,
  TRIAL_MIN_PAIR_SEPARATION_SOURCE_PX,
  TRIAL_SAMPLE_STEP_SOURCE_PX,
  arcPxAtT,
  buildUsableSeam,
  checkCoupledSeamConstraints,
  cloneQuad,
  containerToSourceForAnchor,
  gateTrialQuad,
  isFiniteQuadInUnitRange,
  isNearFrameEdge,
  nearestPointOnUsableSeam,
  pointAtArcPx,
  pointAtT,
  sourceToContainerForTrial,
  tAtArcPx,
  type ImageFrameSize,
  type ImageIntrinsicSize,
  type UsableSeam,
} from "./manual-floor-support-trial-geometry";
import {
  MANUAL_FLOOR_SUPPORT_TRIAL_SET_SCHEMA,
  MANUAL_TRIAL_MAX_COUPLED_SAMPLES,
  MANUAL_TRIAL_MAX_PER_RUN,
  MANUAL_TRIAL_MAX_SINGLE_CORNER_SAMPLES,
  createEvaluableConstraintStatus,
  mergeConstraintStatus,
  type ManualFloorSupportTrial,
  type ManualFloorSupportTrialSet,
  type ManualTrialConstraintStatus,
  type TrialPoint,
  type TrialQuadNorm,
} from "./manual-floor-support-trial-types";

// Minimal candidate shape: decouples generation from auto-floor-detection.
export type TrialGenerationCandidate = {
  id: string;
  quadNorm: TrialQuadNorm;
};

export type TrialGenerationInput = {
  candidate: TrialGenerationCandidate;
  annotation: ManualFloorSupportAnnotation;
  intrinsic: ImageIntrinsicSize | null;
  frame: ImageFrameSize | null;
};

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

// Deterministic sample count from a source-pixel span and a per-run cap.
function sampleCountForSpan(spanPx: number, cap: number): { count: number; truncated: boolean } {
  if (!(spanPx > 0)) return { count: 1, truncated: false };
  const desired = Math.round(spanPx / TRIAL_SAMPLE_STEP_SOURCE_PX) + 1;
  const count = Math.max(2, Math.min(cap, desired));
  return { count, truncated: desired > cap };
}

function convertSampleIntoQuad(
  baselineQuad: TrialQuadNorm,
  cornerIndices: number[],
  sourcePoints: { x: number; y: number }[],
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): { quad: TrialQuadNorm; status: ManualTrialConstraintStatus } {
  const quad = cloneQuad(baselineQuad);
  let status = createEvaluableConstraintStatus();
  for (let k = 0; k < cornerIndices.length; k += 1) {
    const idx = cornerIndices[k];
    const conv = sourceToContainerForTrial(sourcePoints[k], intrinsic, frame);
    if (!conv) {
      status = mergeConstraintStatus(status, {
        hardReasons: [`source->container conversion failed for corner ${idx}`],
      });
      continue;
    }
    const containerPoint: TrialPoint = { x: conv.container.x, y: conv.container.y };
    quad[idx] = containerPoint;
    if (!conv.visibleInFrame) {
      status = mergeConstraintStatus(status, {
        hardReasons: [
          `corner ${idx} sample off-frame (overshoot ${conv.maxOvershoot.toFixed(4)})`,
        ],
      });
    } else if (isNearFrameEdge(containerPoint)) {
      status = mergeConstraintStatus(status, {
        warnings: [`corner ${idx} sample near frame edge`],
      });
    }
  }
  return { quad, status };
}

/**
 * Generates a temporary, non-mutating diagnostic trial set for a candidate.
 *
 * Returns null when no trial run is appropriate:
 * - invalid annotation;
 * - abstain mode (operator chose abstention; no baseline is fabricated);
 * - missing image/frame context;
 * - invalid candidate quad.
 *
 * Otherwise returns a set whose trials[0] is always the baseline (the cloned,
 * unchanged candidate quad). Movement families append after the baseline. The
 * baseline is preserved even when a movement family is rejected.
 */
export function generateManualFloorSupportTrials(
  input: TrialGenerationInput
): ManualFloorSupportTrialSet | null {
  const { candidate, annotation, intrinsic, frame } = input;

  const validation = validateManualFloorSupportAnnotation(annotation);
  if (!validation.ok) return null;
  if (annotation.mode === "abstain") return null;
  if (!intrinsic || !frame) return null;
  if (!candidate || !isFiniteQuadInUnitRange(candidate.quadNorm)) return null;

  const baseId = candidate.id;
  const baselineQuad = cloneQuad(candidate.quadNorm);
  const authority = annotation.adjustmentAuthority;

  const notes: string[] = [];
  let truncated = false;

  const evidenceMode = annotation.mode;
  const authorityKind = authority.kind;
  const determiningEdgeSeamId = annotation.determiningEdge?.seamId ?? null;

  // --- Baseline -------------------------------------------------------------
  const baselineConstraint = gateTrialQuad({
    quad: baselineQuad,
    baselineQuad,
    changedCornerIndices: [],
  });
  const baseline: ManualFloorSupportTrial = {
    trialId: `${baseId}::baseline`,
    sourceCandidateId: baseId,
    kind: "baseline",
    changedCorners: [],
    quadNorm: baselineQuad,
    generation: { sampleIndex: 0 },
    sampledCornerMoves: [],
    evidenceRefs: {
      seamId: null,
      mode: evidenceMode,
      authorityKind,
      determiningEdgeSeamId,
    },
    constraint: baselineConstraint,
    solver: null,
    provenance: "diagnostic_trial_only",
  };

  const trials: ManualFloorSupportTrial[] = [baseline];

  const finalize = (): ManualFloorSupportTrialSet => {
    let finalTrials = trials;
    if (finalTrials.length > MANUAL_TRIAL_MAX_PER_RUN) {
      finalTrials = finalTrials.slice(0, MANUAL_TRIAL_MAX_PER_RUN);
      truncated = true;
    }
    return {
      schema: MANUAL_FLOOR_SUPPORT_TRIAL_SET_SCHEMA,
      sourceCandidateId: baseId,
      baselineTrialId: baseline.trialId,
      generatedFor: { mode: evidenceMode, authorityKind },
      trials: finalTrials,
      truncated,
      notes,
    };
  };

  // --- Direct: baseline only ------------------------------------------------
  if (annotation.mode === "direct") {
    return finalize();
  }

  // --- Single-corner constrained --------------------------------------------
  if (annotation.mode === "single_corner_constrained") {
    if (authority.kind !== "single_corner") {
      notes.push("single-corner mode without single_corner authority; baseline only.");
      return finalize();
    }
    const seam = annotation.seams.find((s) => s.id === authority.seamId);
    if (!seam) {
      notes.push("single-corner authority seam not found; baseline only.");
      return finalize();
    }
    const usable = buildUsableSeam(seam, intrinsic);
    if (!usable) {
      notes.push("single-corner usable seam invalid; baseline only.");
      return finalize();
    }
    const corner = authority.corner;
    const cornerIndex = CANONICAL_CORNER_INDEX[corner];
    const { startT, endT } = authority.allowedSpan;
    const spanPx = (endT - startT) * usable.totalArcPx;
    const { count, truncated: spanTruncated } = sampleCountForSpan(
      spanPx,
      MANUAL_TRIAL_MAX_SINGLE_CORNER_SAMPLES
    );
    if (spanTruncated) truncated = true;

    for (let i = 0; i < count; i += 1) {
      const t = count <= 1 ? startT : startT + (endT - startT) * (i / (count - 1));
      const srcPt = pointAtT(usable, t);
      const { quad, status: convStatus } = convertSampleIntoQuad(
        baselineQuad,
        [cornerIndex],
        [srcPt],
        intrinsic,
        frame
      );
      let status = convStatus;
      if (status.canEvaluate) {
        status = mergeConstraintStatus(
          status,
          gateTrialQuad({ quad, baselineQuad, changedCornerIndices: [cornerIndex] })
        );
      }
      trials.push({
        trialId: `${baseId}::single::${corner}::${i}`,
        sourceCandidateId: baseId,
        kind: "single_corner",
        changedCorners: [corner],
        quadNorm: quad,
        generation: { sampleIndex: i, tAlongUsableSpan: t, perpendicularOffsetSourcePx: 0 },
        sampledCornerMoves: [
          {
            corner,
            seamId: authority.seamId,
            t,
            sourceNorm: { x: srcPt.x, y: srcPt.y },
            sourcePx: { x: srcPt.x * intrinsic.width, y: srcPt.y * intrinsic.height },
            containerNorm: { x: quad[cornerIndex].x, y: quad[cornerIndex].y },
          },
        ],
        evidenceRefs: {
          seamId: authority.seamId,
          mode: evidenceMode,
          authorityKind,
          determiningEdgeSeamId,
        },
        constraint: status,
        solver: null,
        provenance: "diagnostic_trial_only",
      });
    }
    return finalize();
  }

  // --- Coupled far-edge constrained -----------------------------------------
  if (annotation.mode === "coupled_far_edge_constrained") {
    if (authority.kind !== "coupled_far_edge") {
      notes.push("coupled mode without coupled_far_edge authority; baseline only.");
      return finalize();
    }
    const seam = annotation.seams.find((s) => s.id === authority.seamId);
    if (!seam) {
      notes.push("coupled authority seam not found; baseline only.");
      return finalize();
    }
    const usable = buildUsableSeam(seam, intrinsic);
    if (!usable) {
      notes.push("coupled usable seam invalid; baseline only.");
      return finalize();
    }

    const flIndex = CANONICAL_CORNER_INDEX.FL; // 3
    const frIndex = CANONICAL_CORNER_INDEX.FR; // 2

    // 1-2. Read baseline FL/FR and convert each independently to source space.
    const flSrc = containerToSourceForAnchor(baselineQuad[flIndex], intrinsic, frame);
    const frSrc = containerToSourceForAnchor(baselineQuad[frIndex], intrinsic, frame);
    if (!flSrc || !frSrc) {
      notes.push("coupled baseline far-edge corners could not be converted; baseline only.");
      return finalize();
    }

    // 3. Project each baseline point independently to the usable seam.
    const nFL = nearestPointOnUsableSeam(usable, flSrc);
    const nFR = nearestPointOnUsableSeam(usable, frSrc);

    // 4. Clamp each projected anchor only to its OWN allowed span.
    const tAnchorFL = clamp(
      nFL.tGlobal,
      authority.flAllowedSpan.startT,
      authority.flAllowedSpan.endT
    );
    const tAnchorFR = clamp(
      nFR.tGlobal,
      authority.frAllowedSpan.startT,
      authority.frAllowedSpan.endT
    );

    const arcAnchorFL = arcPxAtT(usable, tAnchorFL);
    const arcAnchorFR = arcPxAtT(usable, tAnchorFR);

    // 5-6. Require distinctness, preserved order, and minimum separation.
    const sepPx = Math.abs(arcAnchorFR - arcAnchorFL);
    if (sepPx < TRIAL_MIN_PAIR_SEPARATION_SOURCE_PX) {
      notes.push(
        "coupled run rejected: far-edge anchors collapse or fail minimum separation; baseline only."
      );
      return finalize();
    }

    // Critical shared-delta rule: derive each corner's allowed delta interval
    // from its OWN anchor + span, then sample only the INTERSECTION. This keeps
    // the longitudinal movement genuinely shared (no independent clamping).
    const flLoArc = arcPxAtT(usable, authority.flAllowedSpan.startT);
    const flHiArc = arcPxAtT(usable, authority.flAllowedSpan.endT);
    const frLoArc = arcPxAtT(usable, authority.frAllowedSpan.startT);
    const frHiArc = arcPxAtT(usable, authority.frAllowedSpan.endT);

    const deltaLo = Math.max(flLoArc - arcAnchorFL, frLoArc - arcAnchorFR);
    const deltaHi = Math.min(flHiArc - arcAnchorFL, frHiArc - arcAnchorFR);

    if (deltaLo > deltaHi + 1e-9) {
      notes.push("coupled run rejected: shared-delta interval is empty; baseline only.");
      return finalize();
    }

    const widthPx = Math.max(0, deltaHi - deltaLo);
    const { count, truncated: deltaTruncated } = sampleCountForSpan(
      widthPx,
      MANUAL_TRIAL_MAX_COUPLED_SAMPLES
    );
    if (deltaTruncated) truncated = true;

    const baselineDiffArc = arcAnchorFR - arcAnchorFL;

    for (let i = 0; i < count; i += 1) {
      const delta = count <= 1 ? deltaLo : deltaLo + widthPx * (i / (count - 1));
      const arcFL = arcAnchorFL + delta;
      const arcFR = arcAnchorFR + delta;
      const srcFL = pointAtArcPx(usable, arcFL);
      const srcFR = pointAtArcPx(usable, arcFR);

      // cornerIndices ordered to match sourcePoints: [FL, FR].
      const { quad, status: convStatus } = convertSampleIntoQuad(
        baselineQuad,
        [flIndex, frIndex],
        [srcFL, srcFR],
        intrinsic,
        frame
      );
      let status = convStatus;

      status = mergeConstraintStatus(
        status,
        checkCoupledSeamConstraints({
          arcFL,
          arcFR,
          baselineArcFL: arcAnchorFL,
          baselineArcFR: arcAnchorFR,
          minSeparationSourcePx: TRIAL_MIN_PAIR_SEPARATION_SOURCE_PX,
          maxRelativeAlongSeamDeltaSourcePx:
            authority.coupling.maxRelativeAlongSeamDeltaSourcePx,
        })
      );

      if (status.canEvaluate) {
        status = mergeConstraintStatus(
          status,
          gateTrialQuad({
            quad,
            baselineQuad,
            changedCornerIndices: [flIndex, frIndex],
          })
        );
      }

      const changedCorners: FloorCornerLabel[] = ["FL", "FR"];
      const tFLsample = tAtArcPx(usable, arcFL);
      const tFRsample = tAtArcPx(usable, arcFR);
      trials.push({
        trialId: `${baseId}::coupled::FL-FR::${i}`,
        sourceCandidateId: baseId,
        kind: "coupled_far_edge",
        changedCorners,
        quadNorm: quad,
        sampledCornerMoves: [
          {
            corner: "FL",
            seamId: authority.seamId,
            t: tFLsample,
            sourceNorm: { x: srcFL.x, y: srcFL.y },
            sourcePx: { x: srcFL.x * intrinsic.width, y: srcFL.y * intrinsic.height },
            containerNorm: { x: quad[flIndex].x, y: quad[flIndex].y },
          },
          {
            corner: "FR",
            seamId: authority.seamId,
            t: tFRsample,
            sourceNorm: { x: srcFR.x, y: srcFR.y },
            sourcePx: { x: srcFR.x * intrinsic.width, y: srcFR.y * intrinsic.height },
            containerNorm: { x: quad[frIndex].x, y: quad[frIndex].y },
          },
        ],
        generation: {
          sampleIndex: i,
          sharedDeltaSourcePx: delta,
          tAlongUsableSpan: tFLsample,
          perpendicularOffsetSourcePx: 0,
        },
        evidenceRefs: {
          seamId: authority.seamId,
          mode: evidenceMode,
          authorityKind,
          determiningEdgeSeamId,
        },
        constraint: status,
        solver: null,
        provenance: "diagnostic_trial_only",
      });
    }
    // baselineDiffArc retained for clarity of the preserved relationship.
    void baselineDiffArc;
    return finalize();
  }

  return finalize();
}

export type { UsableSeam };
