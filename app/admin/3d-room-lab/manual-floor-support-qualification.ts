// --- Phase 2O-N: Type A Support Qualification classifier --------------------
// Pure, deterministic, READ-ONLY classifier. It reports support-sufficiency
// FACTS and a conservative, descriptive classification. It NEVER moves a corner,
// infers/grants authority, chooses a movable corner, infers seam truth, selects
// a seed, ranks tuples, runs broad search / local refinement / solver / FOV
// scans, mutates any candidate / annotation / floor / FOV / dimension /
// calibration / scene state, switches modes, or applies calibration. It NEVER
// implements Type B.
//
// IMPORT BOUNDARY: this module imports ONLY pure type aliases, the pure
// annotation validator, the pure usable-seam / arc-length geometry helper, and
// the pure image-size guard. It imports NO React/UI, NO calibration / Scan &
// Apply / persistence / API / scene-state, and NO solver / FOV / coupled-search
// / local-refinement GENERATION or EVALUATION functions.

import { isValidImageSize, type ImageIntrinsicSize } from "./image-space";
import type { CoupledSearchPrimaryState } from "./manual-floor-support-coupled-search-types";
import {
  buildUsableSeam,
  type UsableSeam,
} from "./manual-floor-support-trial-geometry";
import type {
  ManualFloorSupportAnnotation,
  ManualPhysicalSeam,
} from "./manual-floor-support-types";
import { validateManualFloorSupportAnnotation } from "./manual-floor-support-validation";
import {
  DEFAULT_SUPPORT_QUALIFICATION_THRESHOLDS,
  TYPE_A_SUPPORT_QUALIFICATION_SCHEMA,
  type QualifyTypeASupportInput,
  type SupportQualificationAdvisoryFact,
  type SupportQualificationBroadSearchStateCounts,
  type SupportQualificationBroadSearchViability,
  type SupportQualificationExhaustion,
  type SupportQualificationFacts,
  type SupportQualificationThresholds,
  type SupportQualificationWeakIndicator,
  type TypeASupportQualification,
} from "./manual-floor-support-qualification-types";

// --- Small pure helpers -----------------------------------------------------

function resolveThresholds(
  overrides: Partial<SupportQualificationThresholds> | undefined
): SupportQualificationThresholds {
  const base = DEFAULT_SUPPORT_QUALIFICATION_THRESHOLDS;
  if (!overrides) {
    return { ...base };
  }
  const pick = (
    value: number | undefined,
    fallback: number
  ): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return {
    minUsableDeterminingSpanPx: pick(overrides.minUsableDeterminingSpanPx, base.minUsableDeterminingSpanPx),
    weakDeterminingSpanPx: pick(overrides.weakDeterminingSpanPx, base.weakDeterminingSpanPx),
    weakDeterminingSpanImageDiagonalRatio: pick(
      overrides.weakDeterminingSpanImageDiagonalRatio,
      base.weakDeterminingSpanImageDiagonalRatio
    ),
    frameEdgeMarginRatio: pick(overrides.frameEdgeMarginRatio, base.frameEdgeMarginRatio),
    weakDeterminingToMovableSpanRatio: pick(
      overrides.weakDeterminingToMovableSpanRatio,
      base.weakDeterminingToMovableSpanRatio
    ),
  };
}

function emptyFacts(): SupportQualificationFacts {
  return {
    intrinsicSize: null,
    frameSize: null,
    imageDiagonalSourcePx: null,
    movableSideSpanSourcePx: null,
    determiningSideSpanSourcePx: null,
    rearSeamSpanSourcePx: null,
    spanRatioDeterminingToMovable: null,
    determiningEndpointMinEdgeDistanceSourcePx: null,
    determiningEndpointNearFrame: null,
    determiningSeamFrameEdgeCollapsed: null,
    annotationValid: false,
    movableCorner: null,
    movableSeamId: null,
    determiningSeamId: null,
    broadSearchRun: false,
    broadSearchCurrent: false,
    broadSearchComplete: false,
    broadSearchTruncated: null,
    broadSearchTupleCount: null,
    broadSearchStateCounts: null,
    anyTupleHasHighConfidenceCorridor: null,
    eligibleLocalSeedExists: null,
  };
}

function findSeam(
  annotation: ManualFloorSupportAnnotation,
  seamId: string | null | undefined
): ManualPhysicalSeam | null {
  if (typeof seamId !== "string" || seamId.length === 0) return null;
  if (!Array.isArray(annotation.seams)) return null;
  return annotation.seams.find((s) => s && s.id === seamId) ?? null;
}

// Nearest source-frame-edge distance (source pixels) for a source-normalized
// point. The frame is the intrinsic source image itself, NOT the current
// object-cover crop, so a frame-edge fact is stable across container resize.
function minEdgeDistanceSourcePx(
  point: { x: number; y: number },
  intrinsic: ImageIntrinsicSize
): number {
  const px = point.x * intrinsic.width;
  const py = point.y * intrinsic.height;
  return Math.min(px, intrinsic.width - px, py, intrinsic.height - py);
}

type BroadSearchFacts = {
  broadSearchRun: boolean;
  broadSearchCurrent: boolean;
  broadSearchComplete: boolean;
  broadSearchTruncated: boolean | null;
  broadSearchTupleCount: number | null;
  stateCounts: SupportQualificationBroadSearchStateCounts | null;
  anyHighConfidenceCorridor: boolean | null;
};

function computeBroadSearchFacts(
  input: QualifyTypeASupportInput
): BroadSearchFacts {
  const set = input.broadSearch;
  if (!set) {
    return {
      broadSearchRun: false,
      broadSearchCurrent: false,
      broadSearchComplete: false,
      broadSearchTruncated: null,
      broadSearchTupleCount: null,
      stateCounts: null,
      anyHighConfidenceCorridor: null,
    };
  }

  const trials = Array.isArray(set.trials) ? set.trials : [];
  const counts: SupportQualificationBroadSearchStateCounts = {
    invalid_geometry: 0,
    no_pose: 0,
    pose_poor: 0,
    high_confidence_not_apply_safe: 0,
    apply_safe_diagnostic: 0,
  };
  let anyNullState = false;
  let anyHighConfidenceCorridor = false;
  for (const trial of trials) {
    const state: CoupledSearchPrimaryState | null = trial ? trial.state : null;
    if (state === null || typeof state === "undefined") {
      anyNullState = true;
    } else {
      counts[state] += 1;
    }
    const hc = trial?.fovCorridors?.highConfidence;
    if (Array.isArray(hc) && hc.length > 0) {
      anyHighConfidenceCorridor = true;
    }
  }

  const current =
    typeof input.broadSearchEvidenceSignature === "string" &&
    typeof input.currentEvidenceSignature === "string" &&
    input.broadSearchEvidenceSignature === input.currentEvidenceSignature;

  const complete = trials.length > 0 && !anyNullState;

  return {
    broadSearchRun: true,
    broadSearchCurrent: current,
    broadSearchComplete: complete,
    broadSearchTruncated: typeof set.truncated === "boolean" ? set.truncated : null,
    broadSearchTupleCount: trials.length,
    stateCounts: counts,
    anyHighConfidenceCorridor,
  };
}

// Evaluate the "no usable basin" (B) condition. Independent of weak support.
function computeExhaustion(
  input: QualifyTypeASupportInput,
  broad: BroadSearchFacts
): SupportQualificationExhaustion {
  const missing: string[] = [];

  if (!broad.broadSearchRun) missing.push("no_broad_search");
  if (broad.broadSearchRun && !broad.broadSearchCurrent) missing.push("broad_search_stale_or_signature_mismatch");
  if (broad.broadSearchTruncated === true) missing.push("broad_search_truncated");
  if (broad.broadSearchRun && !broad.broadSearchComplete) missing.push("broad_search_incomplete");
  if (broad.broadSearchRun && !(typeof broad.broadSearchTupleCount === "number" && broad.broadSearchTupleCount > 0)) {
    missing.push("no_tuples");
  }

  const counts = broad.stateCounts;
  if (broad.broadSearchRun && !counts) {
    missing.push("state_counts_unavailable");
  }
  if (counts) {
    if (counts.apply_safe_diagnostic !== 0) missing.push("apply_safe_diagnostic_present");
    if (counts.high_confidence_not_apply_safe !== 0) missing.push("high_confidence_not_apply_safe_present");
  }
  if (broad.anyHighConfidenceCorridor === true) missing.push("high_confidence_corridor_present");

  if (input.localSeedEligible === null || typeof input.localSeedEligible === "undefined") {
    missing.push("local_seed_eligibility_unknown");
  } else if (input.localSeedEligible !== false) {
    missing.push("local_seed_eligible");
  }

  // A DEFINITE no-usable-basin verdict is only assertible when the search is a
  // completed, current, non-truncated, non-empty run with available counts AND
  // local-seed eligibility is a known `false`. Otherwise it is unknown (null).
  const searchDeterminable =
    broad.broadSearchRun &&
    broad.broadSearchCurrent &&
    broad.broadSearchComplete &&
    broad.broadSearchTruncated === false &&
    typeof broad.broadSearchTupleCount === "number" &&
    broad.broadSearchTupleCount > 0 &&
    !!counts;

  let noUsableBasin: boolean | null;
  if (!searchDeterminable) {
    noUsableBasin = null;
  } else if (input.localSeedEligible === null || typeof input.localSeedEligible === "undefined") {
    noUsableBasin = null;
  } else {
    const qualityClear =
      counts!.apply_safe_diagnostic === 0 &&
      counts!.high_confidence_not_apply_safe === 0 &&
      broad.anyHighConfidenceCorridor === false;
    noUsableBasin = qualityClear && input.localSeedEligible === false;
  }

  return {
    eligible: noUsableBasin === true,
    missing,
    noUsableBasin,
  };
}

function buildProvenance(input: QualifyTypeASupportInput, tupleCount: number | null, truncated: boolean | null) {
  const set = input.broadSearch;
  if (!set) return null;
  const config = set.config;
  return {
    evidenceSignature: input.broadSearchEvidenceSignature ?? null,
    currentEvidenceSignature: input.currentEvidenceSignature ?? null,
    tupleCount,
    truncated,
    configSummary: config
      ? {
          tNearSampleCount:
            typeof config.tNearSamples === "number" ? config.tNearSamples : null,
          aspectRatioCount: Array.isArray(config.aspectRatios)
            ? config.aspectRatios.length
            : null,
          maxEvaluations:
            typeof config.maxEvaluations === "number" ? config.maxEvaluations : null,
        }
      : null,
  };
}

function isEmptyAnnotation(annotation: ManualFloorSupportAnnotation): boolean {
  const noSeams = !Array.isArray(annotation.seams) || annotation.seams.length === 0;
  const noAuthority =
    !annotation.adjustmentAuthority || annotation.adjustmentAuthority.kind === "none";
  const noDeterminingEdge = !annotation.determiningEdge;
  return noSeams && noAuthority && noDeterminingEdge;
}

// --- Classifier -------------------------------------------------------------

/**
 * Pure, deterministic Type A support-qualification classifier. Reports facts
 * separately from the descriptive verdict. See module header for the exhaustive
 * containment guarantees. The output is a fresh immutable-style record on every
 * call and never aliases or mutates any input.
 */
export function qualifyTypeASupport(
  input: QualifyTypeASupportInput
): TypeASupportQualification {
  const thresholds = resolveThresholds(input.thresholds);
  const facts = emptyFacts();
  const reasons: string[] = [];
  const weakSupportIndicators: SupportQualificationWeakIndicator[] = [];
  const advisoryEvidenceFacts: SupportQualificationAdvisoryFact[] = [];

  // Broad-search facts + provenance are read-only and computed regardless of the
  // structural verdict, so a readout can always show what evidence exists.
  const broad = computeBroadSearchFacts(input);
  facts.broadSearchRun = broad.broadSearchRun;
  facts.broadSearchCurrent = broad.broadSearchCurrent;
  facts.broadSearchComplete = broad.broadSearchComplete;
  facts.broadSearchTruncated = broad.broadSearchTruncated;
  facts.broadSearchTupleCount = broad.broadSearchTupleCount;
  facts.broadSearchStateCounts = broad.stateCounts;
  facts.anyTupleHasHighConfidenceCorridor = broad.anyHighConfidenceCorridor;
  facts.eligibleLocalSeedExists =
    typeof input.localSeedEligible === "boolean" ? input.localSeedEligible : null;

  const broadSearchProvenance = buildProvenance(
    input,
    broad.broadSearchTupleCount,
    broad.broadSearchTruncated
  );

  // Phase 2O-O-A: the broad-search axis is computed ONCE and independently of the
  // support axis. `noUsableBasin` is the single source of truth; viability is a
  // faithful projection of it (true => no basin, false => usable basin, null =>
  // not determinable). The classifier never runs the search itself.
  const broadExhaustion = computeExhaustion(input, broad);
  const broadSearchViability: SupportQualificationBroadSearchViability =
    broadExhaustion.noUsableBasin === true
      ? "broad_search_no_usable_basin_current_coverage"
      : broadExhaustion.noUsableBasin === false
        ? "broad_search_usable_basin_found"
        : "broad_search_not_run_or_unknown";

  const finalize = (
    classification: TypeASupportQualification["classification"],
    exhaustion: SupportQualificationExhaustion | null
  ): TypeASupportQualification => ({
    schema: TYPE_A_SUPPORT_QUALIFICATION_SCHEMA,
    classification,
    broadSearchViability,
    facts,
    weakSupportIndicators,
    advisoryEvidenceFacts,
    exhaustion,
    thresholdsUsed: thresholds,
    broadSearchProvenance,
    reasons,
    provenance: "diagnostic_support_qualification_only",
  });

  // --- 1. qualification_not_run ---------------------------------------------
  // "Not enough input supplied to begin qualification" — NOT "ambiguous".
  if (!input.annotation) {
    reasons.push("No annotation supplied; nothing to qualify.");
    return finalize("qualification_not_run", null);
  }
  const annotation = input.annotation;
  if (isEmptyAnnotation(annotation)) {
    reasons.push("Annotation has no seams, authority, or determining edge; qualification has not begun.");
    return finalize("qualification_not_run", null);
  }

  // --- 2. insufficient_support_or_unknown -----------------------------------
  const validation = validateManualFloorSupportAnnotation(annotation);
  facts.annotationValid = validation.ok;
  if (!validation.ok) {
    reasons.push("Annotation failed structural validation; cannot characterize support.");
    return finalize("insufficient_support_or_unknown", null);
  }

  if (!isValidImageSize(input.intrinsicSize)) {
    reasons.push("Intrinsic image size missing or invalid; source-pixel facts unavailable.");
    return finalize("insufficient_support_or_unknown", null);
  }
  const intrinsic: ImageIntrinsicSize = {
    width: input.intrinsicSize.width,
    height: input.intrinsicSize.height,
  };
  facts.intrinsicSize = { width: intrinsic.width, height: intrinsic.height };
  facts.imageDiagonalSourcePx = Math.hypot(intrinsic.width, intrinsic.height);
  if (input.frameSize && isValidImageSize(input.frameSize)) {
    facts.frameSize = { width: input.frameSize.width, height: input.frameSize.height };
  }

  // Valid Type A single-corner authority (NL or NR). Authority is READ-ONLY
  // evidence here; it is never inferred, granted, or altered.
  const authority = annotation.adjustmentAuthority;
  const isSingleCornerTypeA =
    annotation.mode === "single_corner_constrained" &&
    authority &&
    authority.kind === "single_corner" &&
    (authority.corner === "NL" || authority.corner === "NR");
  if (!isSingleCornerTypeA) {
    reasons.push("Annotation is not a valid Type A single-corner (NL/NR) configuration.");
    return finalize("insufficient_support_or_unknown", null);
  }
  facts.movableCorner = authority.corner === "NL" ? "NL" : "NR";
  facts.movableSeamId = authority.seamId;

  if (!annotation.determiningEdge) {
    reasons.push("No operator-declared determining edge; support cannot be characterized.");
    return finalize("insufficient_support_or_unknown", null);
  }
  facts.determiningSeamId = annotation.determiningEdge.seamId;

  // Resolve movable + determining seams through the pure usable-seam machinery.
  const movableSeam = findSeam(annotation, authority.seamId);
  const determiningSeam = findSeam(annotation, annotation.determiningEdge.seamId);
  if (!movableSeam) {
    reasons.push("Movable-corner seam could not be resolved from the annotation.");
    return finalize("insufficient_support_or_unknown", null);
  }
  if (!determiningSeam) {
    reasons.push("Determining-edge seam could not be resolved from the annotation.");
    return finalize("insufficient_support_or_unknown", null);
  }

  const movableUsable: UsableSeam | null = buildUsableSeam(movableSeam, intrinsic);
  const determiningUsable: UsableSeam | null = buildUsableSeam(determiningSeam, intrinsic);
  if (!movableUsable) {
    reasons.push("Movable-corner seam has no usable arc-length span.");
    return finalize("insufficient_support_or_unknown", null);
  }
  if (!determiningUsable) {
    reasons.push("Determining-edge seam has no usable arc-length span.");
    return finalize("insufficient_support_or_unknown", null);
  }

  const movableSpanPx = movableUsable.totalArcPx;
  const determiningSpanPx = determiningUsable.totalArcPx;
  facts.movableSideSpanSourcePx = movableSpanPx;
  facts.determiningSideSpanSourcePx = determiningSpanPx;
  facts.spanRatioDeterminingToMovable =
    movableSpanPx > 0 ? determiningSpanPx / movableSpanPx : null;

  // Rear seam is context only: the annotation model has no canonical rear-seam
  // pointer, so we report it ONLY when the determining edge itself is declared
  // as the rear floor-wall edge. Otherwise it stays unknown (null) rather than
  // guessing which seam is the rear.
  if (annotation.determiningEdge.role === "rear_floor_wall_edge") {
    facts.rearSeamSpanSourcePx = determiningSpanPx;
  }

  // Determining-endpoint frame-edge facts (source-image frame, not live crop).
  const startPt = determiningUsable.pointsSourceNorm[0];
  const endPt =
    determiningUsable.pointsSourceNorm[determiningUsable.pointsSourceNorm.length - 1];
  const startEdgeDistPx = minEdgeDistanceSourcePx(startPt, intrinsic);
  const endEdgeDistPx = minEdgeDistanceSourcePx(endPt, intrinsic);
  const marginPx =
    thresholds.frameEdgeMarginRatio * Math.min(intrinsic.width, intrinsic.height);
  const startNear = startEdgeDistPx <= marginPx;
  const endNear = endEdgeDistPx <= marginPx;
  facts.determiningEndpointMinEdgeDistanceSourcePx = [startEdgeDistPx, endEdgeDistPx];
  facts.determiningEndpointNearFrame = [startNear, endNear];

  // --- Structural insufficiency: determining span below the usable floor -----
  if (determiningSpanPx < thresholds.minUsableDeterminingSpanPx) {
    facts.determiningSeamFrameEdgeCollapsed = startNear || endNear;
    reasons.push(
      `Determining span ${determiningSpanPx.toFixed(1)}px is below the minimum usable span ` +
        `${thresholds.minUsableDeterminingSpanPx}px (structural lack of support).`
    );
    return finalize("insufficient_support_or_unknown", null);
  }

  // --- Advisory weak-support indicators (facts, never authority) -------------
  const diag = facts.imageDiagonalSourcePx ?? Math.hypot(intrinsic.width, intrinsic.height);
  const shortAbsolute = determiningSpanPx < thresholds.weakDeterminingSpanPx;
  const shortDiagonal =
    diag > 0 && determiningSpanPx / diag < thresholds.weakDeterminingSpanImageDiagonalRatio;
  const severeImbalance =
    movableSpanPx > 0 &&
    determiningSpanPx / movableSpanPx < thresholds.weakDeterminingToMovableSpanRatio;
  const nearFrameAny = startNear || endNear;
  // Frame-edge collapse requires BOTH a short span AND an endpoint near the
  // frame. A short-but-interior seam is NOT collapsed merely because it is short.
  const collapsed = (shortAbsolute || shortDiagonal) && nearFrameAny;
  facts.determiningSeamFrameEdgeCollapsed = collapsed;

  // SUBSTANTIVE support-geometry concerns (drive the support verdict).
  if (shortAbsolute) {
    weakSupportIndicators.push("short_determining_span_absolute");
    reasons.push(
      `Support concern: determining span ${determiningSpanPx.toFixed(1)}px is short ` +
        `(< ${thresholds.weakDeterminingSpanPx}px).`
    );
  }
  if (shortDiagonal) {
    weakSupportIndicators.push("short_determining_span_image_diagonal");
    reasons.push(
      `Support concern: determining span is a small fraction of the image diagonal ` +
        `(< ${thresholds.weakDeterminingSpanImageDiagonalRatio}).`
    );
  }
  if (severeImbalance) {
    weakSupportIndicators.push("severe_determining_to_movable_span_imbalance");
    reasons.push(
      `Support concern: severe determining/movable span imbalance ` +
        `(< ${thresholds.weakDeterminingToMovableSpanRatio}).`
    );
  }
  if (collapsed) {
    weakSupportIndicators.push("determining_seam_frame_edge_collapsed");
    reasons.push(
      "Support concern: determining seam is frame-edge-collapsed (short/weak span with a near-frame endpoint)."
    );
  }

  // ADVISORY, NON-ROUTING evidence fact. A near-frame endpoint alone never
  // weakens support and never implies Type B — it is reported for context only.
  if (nearFrameAny) {
    advisoryEvidenceFacts.push("determining_endpoint_near_frame");
    reasons.push(
      "Advisory: at least one determining endpoint is near the source-image frame edge. " +
        "This is an evidence fact only; it does not by itself weaken support or imply Type B."
    );
  }

  // Broad-search axis reason (independent of the support verdict).
  if (broadSearchViability === "broad_search_usable_basin_found") {
    reasons.push("Broad search: the current bounded Type A broad search found a usable basin.");
  } else if (broadSearchViability === "broad_search_no_usable_basin_current_coverage") {
    reasons.push(
      "Broad search: the current bounded Type A broad search found no usable basin, " +
        "conditional on current broad-search coverage/config."
    );
  } else {
    reasons.push(
      "Broad search: no current, complete broad-search basin evidence is available " +
        "(absent/stale/partial/unknown); broad-search viability is unknown."
    );
  }

  // --- 3. type_a_strong_support ----------------------------------------------
  // Strong whenever there is NO substantive support concern, regardless of a
  // near-frame advisory and regardless of broad-search viability.
  if (weakSupportIndicators.length === 0) {
    reasons.push("Support: valid Type A support with a healthy determining seam; no substantive support concerns.");
    if (broadSearchViability === "broad_search_no_usable_basin_current_coverage") {
      reasons.push(
        "Type A support is strong, but the current bounded broad search found no usable basin. " +
          "This does not imply Type B."
      );
    }
    return finalize("type_a_strong_support", null);
  }

  // --- 4 / 5. weak vs exhausted Type B candidate -----------------------------
  // Substantive concern(s) present. The Type B handoff candidate requires the
  // second axis to be a current, completed no-usable-basin result.
  if (broadSearchViability === "broad_search_no_usable_basin_current_coverage") {
    reasons.push(
      "Weak Type A support AND the current bounded broad search found no usable basin. " +
        "CONDITIONAL Type B handoff candidate, conditional on current broad-search coverage/config; " +
        "broader future Type A coverage could change this outcome."
    );
    return finalize("type_a_exhausted_type_b_candidate", broadExhaustion);
  }

  reasons.push(
    "Weak Type A support present; broad-search viability is not a current no-usable-basin result " +
      `(unmet: ${broadExhaustion.missing.join(", ") || "none"}). This is not a Type B candidate under current coverage.`
  );
  return finalize("type_a_weak_support", broadExhaustion);
}
