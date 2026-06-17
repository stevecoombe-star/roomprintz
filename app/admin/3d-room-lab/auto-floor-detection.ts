import type { Vec2 } from "./perspective-solve";

// --- Phase 2B: Auto floor detection data model + mock harness ---------------
// This module defines the internal data model for "suggested calibration quads"
// and a deterministic mock generator used to develop the lab UI before any real
// vision/segmentation model is connected.
//
// Important concept: a calibration quad is NOT the irregular visible floor
// outline. It should represent a clean, plausible rectangular patch of the floor
// plane that is well-conditioned for homography/FOV/camera solving.
//
// Strict Phase 2B scope:
// - No real model detection, segmentation, or scoring.
// - No auto-apply to the manual floor polygon.
// - Pure, deterministic helpers only (no randomness, no I/O).

export type AutoFloorDetectionStatus =
  | "idle"
  | "mock_ready"
  | "ok"
  | "needs_review"
  | "failed";

export type AutoFloorCandidateSource =
  | "mock"
  | "vision_model_direct"
  | "segmentation_fit"
  | "hybrid"
  | "manual_seed";

export type AutoFloorCandidateConfidence = "high" | "medium" | "low";

/**
 * A single suggested calibration quad candidate.
 *
 * quadNorm uses normalized image/container coordinates in [0, 1] and is ordered
 * near-left, near-right, far-right, far-left (image y-down: larger y is nearer
 * the camera), matching the orderFloorCorners convention used elsewhere in the
 * lab. The quad is a clean rectangular floor patch, not the visible floor
 * outline.
 */
export type AutoFloorCalibrationCandidate = {
  id: string;
  label: string;
  source: AutoFloorCandidateSource;
  confidence: AutoFloorCandidateConfidence;
  confidenceScore: number;
  quadNorm: [Vec2, Vec2, Vec2, Vec2];
  notes: string[];
  risks: string[];
};

export type AutoFloorDetectionResult = {
  status: AutoFloorDetectionStatus;
  candidates: AutoFloorCalibrationCandidate[];
  selectedCandidateId: string | null;
  notes: string[];
  failureReasons: string[];
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

function roundNorm(value: number): number {
  return Number(clamp01(value).toFixed(4));
}

function makeQuad(
  nearLeft: Vec2,
  nearRight: Vec2,
  farRight: Vec2,
  farLeft: Vec2
): [Vec2, Vec2, Vec2, Vec2] {
  return [
    { x: roundNorm(nearLeft.x), y: roundNorm(nearLeft.y) },
    { x: roundNorm(nearRight.x), y: roundNorm(nearRight.y) },
    { x: roundNorm(farRight.x), y: roundNorm(farRight.y) },
    { x: roundNorm(farLeft.x), y: roundNorm(farLeft.y) },
  ];
}

/**
 * Computes a deterministic horizontal center from an optional current floor
 * polygon centroid. Falls back to 0.5 when no usable polygon is provided. This
 * lets mock suggestions loosely follow where the user has been working without
 * introducing any randomness.
 */
function deriveCenterXFromPolygon(polygon?: Vec2[]): number {
  if (!Array.isArray(polygon) || polygon.length < 3) return 0.5;
  let sum = 0;
  let count = 0;
  for (const point of polygon) {
    if (point && Number.isFinite(point.x)) {
      sum += clamp01(point.x);
      count += 1;
    }
  }
  if (count === 0) return 0.5;
  return clamp01(sum / count);
}

/**
 * Shifts a quad horizontally by `offset`, clamping the offset so all points stay
 * within [0, 1]. Deterministic given its inputs.
 */
function shiftQuadX(
  quad: [Vec2, Vec2, Vec2, Vec2],
  offset: number
): [Vec2, Vec2, Vec2, Vec2] {
  let minX = Infinity;
  let maxX = -Infinity;
  for (const point of quad) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
  }
  const lowerBound = -minX;
  const upperBound = 1 - maxX;
  const clampedOffset = Math.max(lowerBound, Math.min(upperBound, offset));
  return makeQuad(
    { x: quad[0].x + clampedOffset, y: quad[0].y },
    { x: quad[1].x + clampedOffset, y: quad[1].y },
    { x: quad[2].x + clampedOffset, y: quad[2].y },
    { x: quad[3].x + clampedOffset, y: quad[3].y }
  );
}

/**
 * Builds a deterministic mock auto-floor-detection result with several candidate
 * calibration quads. This is intentionally NOT connected to any AI/segmentation;
 * it exists to exercise the lab's selection, preview, and debug UI.
 *
 * Candidates returned (deterministic, never random):
 * 1. Good central calibration quad  — high confidence, clean trapezoid.
 * 2. Wide/ambitious quad            — medium confidence, more floor coverage.
 * 3. Rug-like / too-small quad      — low confidence, likely a rug/furniture footprint.
 */
export function createMockAutoFloorDetectionResult(
  currentFloorPolygon?: Vec2[]
): AutoFloorDetectionResult {
  const centerX = deriveCenterXFromPolygon(currentFloorPolygon);
  const centerOffset = centerX - 0.5;
  const hasPolygonSeed = Array.isArray(currentFloorPolygon) && currentFloorPolygon.length >= 3;

  const goodQuad = shiftQuadX(
    makeQuad(
      { x: 0.3, y: 0.88 },
      { x: 0.7, y: 0.88 },
      { x: 0.6, y: 0.62 },
      { x: 0.4, y: 0.62 }
    ),
    centerOffset
  );

  const wideQuad = shiftQuadX(
    makeQuad(
      { x: 0.12, y: 0.93 },
      { x: 0.88, y: 0.93 },
      { x: 0.72, y: 0.55 },
      { x: 0.28, y: 0.55 }
    ),
    centerOffset * 0.5
  );

  const rugQuad = shiftQuadX(
    makeQuad(
      { x: 0.42, y: 0.82 },
      { x: 0.58, y: 0.82 },
      { x: 0.55, y: 0.72 },
      { x: 0.45, y: 0.72 }
    ),
    centerOffset
  );

  const seedNote = hasPolygonSeed
    ? "Centered using current manual floor polygon as a loose seed."
    : "No current floor polygon seed; using default central placement.";

  const candidates: AutoFloorCalibrationCandidate[] = [
    {
      id: "mock-good-central",
      label: "Good central floor patch",
      source: "mock",
      confidence: "high",
      confidenceScore: 0.86,
      quadNorm: goodQuad,
      notes: [
        "Clean rectangular floor patch centered in the frame.",
        "Plausible trapezoid suited for homography/FOV solving.",
        seedNote,
      ],
      risks: [],
    },
    {
      id: "mock-wide-ambitious",
      label: "Wide / ambitious floor coverage",
      source: "mock",
      confidence: "medium",
      confidenceScore: 0.62,
      quadNorm: wideQuad,
      notes: [
        "Covers more of the visible floor area.",
        "May improve calibration spread if the patch is truly planar.",
      ],
      risks: [
        "May include occlusions (furniture) inside the patch.",
        "Far edge may bleed into wall/floor boundary rather than pure floor.",
      ],
    },
    {
      id: "mock-rug-small",
      label: "Rug-like / too-small patch",
      source: "mock",
      confidence: "low",
      confidenceScore: 0.34,
      quadNorm: rugQuad,
      notes: [
        "Small central patch; useful for testing candidate scoring/debug UI later.",
      ],
      risks: [
        "Likely describes a rug or furniture footprint, not the room floor plane.",
        "Too small to constrain a stable homography/camera solve.",
      ],
    },
  ];

  return {
    status: "mock_ready",
    candidates,
    selectedCandidateId: candidates[0]?.id ?? null,
    notes: [
      "Mock suggestions only — no AI/segmentation was used.",
      "Calibration quads are clean floor-plane patches, not the visible floor outline.",
      "Selecting a candidate updates preview/debug only; it does not modify the manual floor polygon.",
    ],
    failureReasons: [],
  };
}

/**
 * Returns the selected candidate for a result, or null when nothing is selected
 * or the selection id is stale.
 */
export function getSelectedAutoFloorCandidate(
  result: AutoFloorDetectionResult | null,
  selectedCandidateId: string | null
): AutoFloorCalibrationCandidate | null {
  if (!result) return null;
  const id = selectedCandidateId ?? result.selectedCandidateId;
  if (!id) return null;
  return result.candidates.find((candidate) => candidate.id === id) ?? null;
}
