import type { AutoFloorCalibrationCandidate } from "./auto-floor-detection";
import { normToPixels, type ImageFrameSize } from "./image-space";
import {
  computeReprojectionError,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  orderFloorCorners,
  solvePlaneHomography,
  type Vec2,
} from "./perspective-solve";

// --- Phase 2C: Auto floor candidate geometry scoring (preview only) ---------
// Pure, deterministic scoring of a suggested calibration quad. This is a debug
// preview layer that answers: "Does this suggested quad behave like a plausible
// calibration quad for the existing homography / FOV / calibrated camera
// pipeline?"
//
// Strict Phase 2C scope:
// - No Apply, no floorPolygon mutation, no auto-apply.
// - No real model detection / segmentation / external calls.
// - Reuse existing perspective-solve helpers (orderFloorCorners,
//   solvePlaneHomography, computeReprojectionError) rather than duplicating the
//   heavy math. Only small geometry sanity helpers live here.

export type AutoFloorCandidateScoreBand = "high" | "medium" | "low" | "invalid";

export type AutoFloorCandidateGeometryScore = {
  candidateId: string;
  scoreBand: AutoFloorCandidateScoreBand;
  score: number;

  polygon: {
    ok: boolean;
    areaNorm: number | null;
    convex: boolean;
    selfIntersecting: boolean;
    nearFarOrderingOk: boolean;
    skinnyRisk: boolean;
    notes: string[];
  };

  cornerOrdering: {
    ok: boolean;
    confidence: string | number | null;
    orderedLabels?: string[];
    notes: string[];
  };

  homography: {
    ok: boolean;
    sourceReprojectionErrorPx?: number | null;
    targetReprojectionError?: number | null;
    notes: string[];
  };

  overallNotes: string[];
  risks: string[];
};

export type AutoFloorScoringInputs = {
  // Visible render frame size in pixels (same space used by existing homography
  // diagnostics). When null, homography is not attempted (treated as a soft,
  // non-blocking limitation rather than a geometry failure).
  frameSize: ImageFrameSize | null;
  // Floor rectangle assumption, mirroring the existing homography diagnostic.
  floorRect: { widthMeters: number; depthMeters: number };
};

// Deterministic thresholds for the preview scoring. These are intentionally
// simple; this is not production calibration intelligence.
const BLOCKING_TINY_AREA_NORM = 0.004;
const SMALL_AREA_RISK_NORM = 0.04;
const MIN_EDGE_LEN_NORM = 0.05;
const SKINNY_ASPECT_RATIO = 6;
const HIGH_SOURCE_REPROJECTION_PX = 2;

function isFiniteVec2(point: Vec2 | null | undefined): point is Vec2 {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function shoelaceArea(points: Vec2[]): number {
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    area += points[j].x * points[i].y - points[i].x * points[j].y;
  }
  return Math.abs(area / 2);
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function crossZ(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function isConvexQuad(points: [Vec2, Vec2, Vec2, Vec2]): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    const cross = crossZ(a, b, c);
    if (Math.abs(cross) < 1e-9) continue;
    const currentSign = cross > 0 ? 1 : -1;
    if (sign === 0) {
      sign = currentSign;
    } else if (currentSign !== sign) {
      return false;
    }
  }
  return sign !== 0;
}

function segmentsProperlyIntersect(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): boolean {
  const o1 = crossZ(a1, a2, b1);
  const o2 = crossZ(a1, a2, b2);
  const o3 = crossZ(b1, b2, a1);
  const o4 = crossZ(b1, b2, a2);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

// Self-intersection for an ordered quad [NL, NR, FR, FL]: near edge crossing far
// edge, or right edge crossing left edge.
function isSelfIntersectingOrderedQuad(points: [Vec2, Vec2, Vec2, Vec2]): boolean {
  const [nl, nr, fr, fl] = points;
  return segmentsProperlyIntersect(nl, nr, fr, fl) || segmentsProperlyIntersect(nr, fr, fl, nl);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function bandFromScore(score: number, blocking: boolean): AutoFloorCandidateScoreBand {
  if (blocking) return "invalid";
  if (score >= 0.75) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

/**
 * Scores a single auto-floor calibration candidate's geometry for preview.
 * Deterministic and side-effect free.
 */
export function scoreAutoFloorCandidateGeometry(
  candidate: AutoFloorCalibrationCandidate,
  inputs: AutoFloorScoringInputs
): AutoFloorCandidateGeometryScore {
  const polygonNotes: string[] = [];
  const orderingNotes: string[] = [];
  const homographyNotes: string[] = [];
  const overallNotes: string[] = [];
  const risks: string[] = [];

  const rawPoints = candidate.quadNorm as Vec2[];

  // 1) Polygon sanity ---------------------------------------------------------
  const hasFourPoints = Array.isArray(rawPoints) && rawPoints.length === 4;
  const allFinite = hasFourPoints && rawPoints.every(isFiniteVec2);
  const inRange = allFinite && rawPoints.every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);

  if (!hasFourPoints) {
    polygonNotes.push(`Expected exactly 4 points (got ${Array.isArray(rawPoints) ? rawPoints.length : 0}).`);
  }
  if (hasFourPoints && !allFinite) {
    polygonNotes.push("Polygon has non-finite coordinates.");
  }
  if (allFinite && !inRange) {
    polygonNotes.push("Polygon coordinates fall outside the normalized [0,1] range.");
  }

  // 2) Corner ordering (reuse existing helper) --------------------------------
  const orderingResult = allFinite ? orderFloorCorners(rawPoints) : null;
  const cornerOrderingOk = !!orderingResult && orderingResult.ok;
  let cornerOrderConfidence: string | number | null = null;
  let orderedQuad: [Vec2, Vec2, Vec2, Vec2] | null = null;

  if (!orderingResult) {
    orderingNotes.push("Corner ordering not attempted (invalid points).");
  } else if (!orderingResult.ok) {
    orderingNotes.push(`Corner ordering failed: ${orderingResult.reason}`);
  } else {
    cornerOrderConfidence = orderingResult.confidence;
    orderedQuad = orderingResult.value.asArray;
    orderingNotes.push(`Corner ordering ok (confidence ${orderingResult.confidence}).`);
    if (orderingResult.note) orderingNotes.push(orderingResult.note);
  }

  // Derived geometry checks on the canonical ordered quad.
  let areaNorm: number | null = null;
  let convex = false;
  let selfIntersecting = false;
  let nearFarOrderingOk = false;
  let skinnyRisk = false;
  let tinyArea = false;

  if (orderedQuad) {
    areaNorm = shoelaceArea(orderedQuad);
    convex = isConvexQuad(orderedQuad);
    selfIntersecting = isSelfIntersectingOrderedQuad(orderedQuad);

    const [nl, nr, fr, fl] = orderedQuad;
    const nearAvgY = (nl.y + nr.y) / 2;
    const farAvgY = (fr.y + fl.y) / 2;
    nearFarOrderingOk = nearAvgY > farAvgY;

    const edges = [distance(nl, nr), distance(nr, fr), distance(fr, fl), distance(fl, nl)];
    const minEdge = Math.min(...edges);
    const maxEdge = Math.max(...edges);
    const aspectRatio = minEdge > 1e-9 ? maxEdge / minEdge : Infinity;

    tinyArea = areaNorm < BLOCKING_TINY_AREA_NORM;
    skinnyRisk = areaNorm < SMALL_AREA_RISK_NORM || minEdge < MIN_EDGE_LEN_NORM || aspectRatio > SKINNY_ASPECT_RATIO;

    if (!convex) polygonNotes.push("Polygon is non-convex.");
    if (selfIntersecting) polygonNotes.push("Polygon edges self-intersect.");
    if (!nearFarOrderingOk) {
      polygonNotes.push("Near edge is not below the far edge (weak perspective ordering).");
      risks.push("Near/far ordering is weak; may not behave like a floor-plane quad.");
    }
    if (tinyArea) {
      polygonNotes.push(`Polygon area is degenerate (areaNorm=${areaNorm.toFixed(4)}).`);
    } else if (skinnyRisk) {
      polygonNotes.push(`Polygon is small/skinny (areaNorm=${areaNorm.toFixed(4)}).`);
      risks.push("Small or skinny patch may describe a rug/furniture footprint, not the room floor.");
    }
  }

  const polygonOk = hasFourPoints && allFinite && convex && !selfIntersecting && !tinyArea;

  // 3) Homography solve (reuse existing path) ---------------------------------
  let homographyOk = false;
  let homographyAttempted = false;
  let sourceReprojectionErrorPx: number | null = null;
  let targetReprojectionError: number | null = null;

  if (orderedQuad && inputs.frameSize && inputs.frameSize.width > 0 && inputs.frameSize.height > 0) {
    const sourceImagePointsPx: Vec2[] = [];
    let pixelConversionOk = true;
    for (const point of orderedQuad) {
      const pixels = normToPixels(point, inputs.frameSize);
      if (!pixels) {
        pixelConversionOk = false;
        break;
      }
      sourceImagePointsPx.push(pixels);
    }

    if (!pixelConversionOk) {
      homographyNotes.push("Could not convert ordered corners from normalized to frame pixels.");
    } else {
      const floorRectResult = getFloorRectCorners({
        widthMeters: inputs.floorRect.widthMeters,
        depthMeters: inputs.floorRect.depthMeters,
      });
      if (!floorRectResult.ok) {
        homographyNotes.push(`Floor rect assumption invalid: ${floorRectResult.reason}`);
      } else {
        homographyAttempted = true;
        const targetFloorPoints2D = floorRectResult.value.asArray.map((point) => floorVec3ToPlane2D(point));
        const solveResult = solvePlaneHomography(sourceImagePointsPx, targetFloorPoints2D);
        if (!solveResult.ok) {
          homographyNotes.push(`Homography solve failed: ${solveResult.reason}`);
        } else {
          homographyOk = true;
          homographyNotes.push(`Homography solve ok (confidence ${solveResult.confidence}).`);
          const reprojection = computeReprojectionError(solveResult.value, sourceImagePointsPx, targetFloorPoints2D);
          if (reprojection.ok) {
            targetReprojectionError = reprojection.value.maxTargetUnits;
            sourceReprojectionErrorPx = reprojection.value.maxSourcePixels;
            if (sourceReprojectionErrorPx !== null && sourceReprojectionErrorPx > HIGH_SOURCE_REPROJECTION_PX) {
              homographyNotes.push(
                `Elevated source reprojection error (max=${sourceReprojectionErrorPx.toFixed(2)}px).`
              );
            }
          } else {
            homographyNotes.push(`Reprojection diagnostics unavailable: ${reprojection.reason}`);
          }
        }
      }
    }
  } else if (!inputs.frameSize || inputs.frameSize.width <= 0 || inputs.frameSize.height <= 0) {
    homographyNotes.push("Frame pixel size unavailable; homography not attempted.");
  }

  // 4) Overall score + band ---------------------------------------------------
  // Blocking failures => invalid geometry.
  const blocking =
    !hasFourPoints ||
    !allFinite ||
    !cornerOrderingOk ||
    !convex ||
    selfIntersecting ||
    tinyArea ||
    (homographyAttempted && !homographyOk);

  let score = 1;
  if (skinnyRisk && !tinyArea) {
    // Small/skinny but usable patch is the dominant risk for the mock rug case.
    score -= areaNorm !== null && areaNorm < SMALL_AREA_RISK_NORM ? 0.55 : 0.2;
  }
  if (!nearFarOrderingOk && orderedQuad) score -= 0.25;
  if (cornerOrderConfidence === "low") score -= 0.15;
  if (!homographyAttempted) {
    score -= 0.1;
    overallNotes.push("Homography not verified (no frame size); score is geometry-only.");
  } else if (homographyOk && sourceReprojectionErrorPx !== null && sourceReprojectionErrorPx > HIGH_SOURCE_REPROJECTION_PX) {
    score -= 0.2;
  }
  score = clamp01(score);
  if (blocking) score = 0;

  const scoreBand = bandFromScore(score, blocking);

  if (blocking) {
    overallNotes.push("Geometry cannot be used for calibration as-is.");
  } else if (scoreBand === "high") {
    overallNotes.push("Plausible calibration quad for the homography/FOV pipeline.");
  } else if (scoreBand === "medium") {
    overallNotes.push("Usable calibration quad with some risks.");
  } else {
    overallNotes.push("Weak calibration quad; review before relying on it.");
  }

  return {
    candidateId: candidate.id,
    scoreBand,
    score: Number(score.toFixed(3)),
    polygon: {
      ok: polygonOk,
      areaNorm: areaNorm === null ? null : Number(areaNorm.toFixed(4)),
      convex,
      selfIntersecting,
      nearFarOrderingOk,
      skinnyRisk,
      notes: polygonNotes,
    },
    cornerOrdering: {
      ok: cornerOrderingOk,
      confidence: cornerOrderConfidence,
      orderedLabels: orderedQuad ? ["nearLeft", "nearRight", "farRight", "farLeft"] : undefined,
      notes: orderingNotes,
    },
    homography: {
      ok: homographyOk,
      sourceReprojectionErrorPx,
      targetReprojectionError,
      notes: homographyNotes,
    },
    overallNotes,
    risks,
  };
}
