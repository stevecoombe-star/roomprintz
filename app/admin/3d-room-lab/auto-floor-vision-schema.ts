import {
  type AutoFloorCalibrationCandidate,
  type AutoFloorCandidateConfidence,
  type AutoFloorDetectionResult,
} from "./auto-floor-detection";
import { scoreAutoFloorCandidateGeometry } from "./auto-floor-scoring";
import { orderFloorCorners, type Vec2 } from "./perspective-solve";
import type { ImageFrameSize } from "./image-space";

// --- Phase 2F-B: Vision provider raw schema + validator (DISABLED) ----------
// Pure, side-effect-free schema + validation/mapping helpers for a FUTURE
// vision-model provider. Nothing here calls a model, an API, or the network,
// and the active provider remains "mock-local".
//
// Hard rule (from the Phase 2F Option A memo): the model response is an
// UNTRUSTED proposal. Everything arrives as `unknown` and must be validated.
// Vibode geometry scoring (scoreAutoFloorCandidateGeometry) is the source of
// truth for confidence/selection; model-provided confidence/labels/ordering are
// advisory only and are never trusted directly.

// ---------------------------------------------------------------------------
// Raw (untrusted) response shapes — every field is `unknown`.
// ---------------------------------------------------------------------------

export type RawVisionFloorResponse = {
  status?: unknown;
  candidates?: unknown;
  visibleFloorRegionNorm?: unknown;
  horizonHint?: unknown;
  modelNotes?: unknown;
  failureReasons?: unknown;
};

export type RawVisionCandidate = {
  quad?: unknown;
  corners?: unknown;
  confidence?: unknown;
  confidenceBand?: unknown;
  label?: unknown;
  notes?: unknown;
  risks?: unknown;
  occluded?: unknown;
};

// ---------------------------------------------------------------------------
// Validated / canonical intermediate types — trusted, normalized values.
// ---------------------------------------------------------------------------

export type ValidatedVisionFloorCandidate = {
  id: string;
  label: string;
  // Canonicalized via orderFloorCorners: [nearLeft, nearRight, farRight, farLeft].
  quadNorm: [Vec2, Vec2, Vec2, Vec2];
  // Advisory only — never used to set internal confidence directly.
  modelConfidenceScore: number | null;
  modelConfidenceBand: AutoFloorCandidateConfidence | null;
  notes: string[];
  risks: string[];
};

export type VisionCandidateValidation =
  | { ok: true; value: ValidatedVisionFloorCandidate }
  | { ok: false; reason: string };

export type MapRawVisionOptions = {
  frameSize: ImageFrameSize | null;
  floorRect: { widthMeters: number; depthMeters: number };
  maxCandidates?: number;
};

const DEFAULT_MAX_CANDIDATES = 3;
const GROSS_BOUND_MIN = -0.25;
const GROSS_BOUND_MAX = 1.25;
const NEAR_DUPLICATE_MEAN_DISTANCE = 0.02;
const MAX_TEXT_ITEMS = 8;
const MAX_TEXT_LENGTH = 200;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Strip any HTML-ish tags and collapse whitespace; cap length.
  const stripped = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (stripped.length === 0) return null;
  return stripped.slice(0, MAX_TEXT_LENGTH);
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const clean = sanitizeString(item);
    if (clean) out.push(clean);
    if (out.length >= MAX_TEXT_ITEMS) break;
  }
  return out;
}

function parsePoint(value: unknown): { ok: true; point: Vec2 } | { ok: false } {
  if (!isRecord(value)) return { ok: false };
  const { x, y } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return { ok: false };
  return { ok: true, point: { x, y } };
}

// Accept candidate points from candidate.quad (4-point array) OR candidate.corners
// (labeled object). Returns raw points in the model's order (NOT yet canonical).
function extractCandidatePoints(candidate: RawVisionCandidate): Vec2[] | null {
  if (Array.isArray(candidate.quad)) {
    if (candidate.quad.length !== 4) return null;
    const points: Vec2[] = [];
    for (const entry of candidate.quad) {
      const parsed = parsePoint(entry);
      if (!parsed.ok) return null;
      points.push(parsed.point);
    }
    return points;
  }

  if (isRecord(candidate.corners)) {
    const corners = candidate.corners;
    // Labels are advisory; we still re-canonicalize with orderFloorCorners.
    const labeled = [corners.nearLeft, corners.nearRight, corners.farRight, corners.farLeft];
    const points: Vec2[] = [];
    for (const entry of labeled) {
      const parsed = parsePoint(entry);
      if (!parsed.ok) return null;
      points.push(parsed.point);
    }
    return points;
  }

  return null;
}

function meanCornerDistance(a: [Vec2, Vec2, Vec2, Vec2], b: [Vec2, Vec2, Vec2, Vec2]): number {
  let total = 0;
  for (let i = 0; i < 4; i += 1) {
    total += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  }
  return total / 4;
}

function bandFromModelString(value: unknown): AutoFloorCandidateConfidence | null {
  if (value === "high" || value === "medium" || value === "low") return value;
  return null;
}

// ---------------------------------------------------------------------------
// Parsing + validation + canonicalization
// ---------------------------------------------------------------------------

/** Accepts only object-shaped raw responses; returns null otherwise. */
export function parseRawVisionFloorResponse(raw: unknown): RawVisionFloorResponse | null {
  if (!isRecord(raw)) return null;
  return raw as RawVisionFloorResponse;
}

/**
 * Canonicalizes 4 model-provided points into [nearLeft, nearRight, farRight,
 * farLeft] using the existing orderFloorCorners helper. Mildly out-of-range
 * points are clamped (with a disclosed risk); grossly out-of-range points are
 * rejected. Model ordering/labels are advisory only.
 */
export function canonicalizeVisionCandidateQuad(
  points: Vec2[]
):
  | { ok: true; quadNorm: [Vec2, Vec2, Vec2, Vec2]; risks: string[]; orderConfidence: "high" | "low" }
  | { ok: false; reason: string } {
  if (!Array.isArray(points) || points.length !== 4) {
    return { ok: false, reason: "expected exactly 4 points" };
  }

  const risks: string[] = [];
  const clamped: Vec2[] = [];
  let didClamp = false;
  for (const point of points) {
    if (!isFiniteNumber(point.x) || !isFiniteNumber(point.y)) {
      return { ok: false, reason: "non-finite coordinate" };
    }
    if (
      point.x < GROSS_BOUND_MIN ||
      point.x > GROSS_BOUND_MAX ||
      point.y < GROSS_BOUND_MIN ||
      point.y > GROSS_BOUND_MAX
    ) {
      return { ok: false, reason: "coordinate grossly out of range" };
    }
    const cx = clamp01(point.x);
    const cy = clamp01(point.y);
    if (cx !== point.x || cy !== point.y) didClamp = true;
    clamped.push({ x: cx, y: cy });
  }
  if (didClamp) risks.push("corner-out-of-frame-clamped");

  const ordered = orderFloorCorners(clamped);
  if (!ordered.ok) {
    return { ok: false, reason: `corner ordering failed: ${ordered.reason}` };
  }

  return {
    ok: true,
    quadNorm: ordered.value.asArray as [Vec2, Vec2, Vec2, Vec2],
    risks,
    orderConfidence: ordered.confidence,
  };
}

/**
 * Validates a single raw candidate into a canonical ValidatedVisionFloorCandidate.
 * Pure; returns a reason string on rejection.
 */
export function validateRawVisionCandidate(
  raw: unknown,
  index: number
): VisionCandidateValidation {
  if (!isRecord(raw)) return { ok: false, reason: `candidate ${index} is not an object` };
  const candidate = raw as RawVisionCandidate;

  const points = extractCandidatePoints(candidate);
  if (!points) {
    return { ok: false, reason: `candidate ${index} has no valid 4-point quad/corners` };
  }

  const canonical = canonicalizeVisionCandidateQuad(points);
  if (!canonical.ok) {
    return { ok: false, reason: `candidate ${index}: ${canonical.reason}` };
  }

  const label = sanitizeString(candidate.label) ?? `Vision candidate ${index + 1}`;
  const notes = sanitizeStringArray(candidate.notes);
  const risks = [...sanitizeStringArray(candidate.risks), ...canonical.risks];
  if (canonical.orderConfidence === "low") {
    risks.push("corner-ordering-low-confidence");
  }
  if (candidate.occluded === true) {
    risks.push("model-reports-occlusion");
  }

  const modelConfidenceScore = isFiniteNumber(candidate.confidence)
    ? clamp01(candidate.confidence)
    : null;
  const modelConfidenceBand = bandFromModelString(candidate.confidenceBand);

  return {
    ok: true,
    value: {
      id: `vision-cand-${index}`,
      label,
      quadNorm: canonical.quadNorm,
      modelConfidenceScore,
      modelConfidenceBand,
      notes,
      risks,
    },
  };
}

/** Drops near-duplicate quads (keeps the first). Simple + safe for this phase. */
function dedupeValidatedCandidates(
  candidates: ValidatedVisionFloorCandidate[]
): ValidatedVisionFloorCandidate[] {
  const kept: ValidatedVisionFloorCandidate[] = [];
  for (const candidate of candidates) {
    const isDuplicate = kept.some(
      (existing) => meanCornerDistance(existing.quadNorm, candidate.quadNorm) < NEAR_DUPLICATE_MEAN_DISTANCE
    );
    if (!isDuplicate) kept.push(candidate);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// Mapping to the internal AutoFloorDetectionResult
// ---------------------------------------------------------------------------

function bandToConfidence(band: "high" | "medium" | "low" | "invalid"): AutoFloorCandidateConfidence {
  if (band === "high") return "high";
  if (band === "medium") return "medium";
  // "low" and "invalid" both surface as low confidence in the existing UI.
  return "low";
}

/**
 * Scores each validated candidate with the existing geometry scorer and maps to
 * internal AutoFloorCalibrationCandidates. Internal confidence/confidenceScore
 * come from geometry scoring (NOT the model). selectedCandidateId is the
 * highest-scored non-invalid candidate.
 */
export function mapValidatedVisionCandidatesToAutoFloorDetectionResult(
  validated: ValidatedVisionFloorCandidate[],
  options: MapRawVisionOptions,
  carriedNotes: string[],
  carriedFailureReasons: string[]
): AutoFloorDetectionResult {
  const notes = [...carriedNotes];
  const failureReasons = [...carriedFailureReasons];

  if (validated.length === 0) {
    return {
      status: "failed",
      candidates: [],
      selectedCandidateId: null,
      notes,
      failureReasons:
        failureReasons.length > 0 ? failureReasons : ["No valid vision candidates after validation."],
    };
  }

  const frameSizeMissing = !options.frameSize || options.frameSize.width <= 0 || options.frameSize.height <= 0;

  const scored = validated.map((candidate) => {
    const provisional: AutoFloorCalibrationCandidate = {
      id: candidate.id,
      label: candidate.label,
      source: "vision_model_direct",
      confidence: "low",
      confidenceScore: 0,
      quadNorm: candidate.quadNorm,
      notes: candidate.notes,
      risks: candidate.risks,
    };
    const score = scoreAutoFloorCandidateGeometry(provisional, {
      frameSize: options.frameSize,
      floorRect: options.floorRect,
    });

    const modelConfidenceNote =
      candidate.modelConfidenceScore !== null || candidate.modelConfidenceBand !== null
        ? `Model self-reported confidence: ${
            candidate.modelConfidenceBand ?? "n/a"
          } (${candidate.modelConfidenceScore ?? "n/a"}) — advisory only; geometry score is authoritative.`
        : null;

    const mapped: AutoFloorCalibrationCandidate = {
      id: candidate.id,
      label: candidate.label,
      source: "vision_model_direct",
      confidence: bandToConfidence(score.scoreBand),
      confidenceScore: score.score,
      quadNorm: candidate.quadNorm,
      notes: modelConfidenceNote ? [...candidate.notes, modelConfidenceNote] : candidate.notes,
      risks:
        score.scoreBand === "invalid"
          ? [...candidate.risks, "geometry-score-invalid"]
          : candidate.risks,
    };

    return { mapped, scoreBand: score.scoreBand, score: score.score };
  });

  const candidates = scored.map((entry) => entry.mapped);

  // Default selection by geometry score: best non-invalid candidate.
  const nonInvalid = scored.filter((entry) => entry.scoreBand !== "invalid");
  const best = nonInvalid.reduce<typeof scored[number] | null>((acc, entry) => {
    if (!acc) return entry;
    return entry.score > acc.score ? entry : acc;
  }, null);

  if (frameSizeMissing) {
    notes.push("Frame size unavailable; homography validation skipped — review candidates before applying.");
    return {
      status: "needs_review",
      candidates,
      selectedCandidateId: best?.mapped.id ?? candidates[0]?.id ?? null,
      notes,
      failureReasons,
    };
  }

  if (!best) {
    return {
      status: "failed",
      candidates,
      selectedCandidateId: null,
      notes,
      failureReasons:
        failureReasons.length > 0
          ? failureReasons
          : ["All vision candidates scored as geometrically invalid."],
    };
  }

  // needs_review if the best we have is only "low"; otherwise ok.
  const status = best.scoreBand === "low" ? "needs_review" : "ok";
  if (status === "needs_review") {
    notes.push("Best vision candidate is low-confidence by geometry score; review before applying.");
  }

  return {
    status,
    candidates,
    selectedCandidateId: best.mapped.id,
    notes,
    failureReasons,
  };
}

/**
 * Top-level pure mapper: untrusted raw model response -> AutoFloorDetectionResult.
 * Never throws; malformed input becomes a failed result with reasons.
 */
export function mapRawVisionFloorResponseToDetectionResult(
  raw: unknown,
  options: MapRawVisionOptions
): AutoFloorDetectionResult {
  const parsed = parseRawVisionFloorResponse(raw);
  if (!parsed) {
    return {
      status: "failed",
      candidates: [],
      selectedCandidateId: null,
      notes: [],
      failureReasons: ["Raw vision response was not an object."],
    };
  }

  const carriedNotes = sanitizeStringArray(parsed.modelNotes);
  const carriedFailureReasons = sanitizeStringArray(parsed.failureReasons);

  // TODO(Phase 2F+): visibleFloorRegionNorm and horizonHint are intentionally
  // not stored in internal app state yet. Surface only a lightweight note.
  if (parsed.visibleFloorRegionNorm != null) {
    carriedNotes.push("Model returned a visible-floor region hint (ignored in this phase).");
  }
  if (parsed.horizonHint != null) {
    carriedNotes.push("Model returned a horizon/vanishing-point hint (ignored in this phase).");
  }

  if (!Array.isArray(parsed.candidates)) {
    return {
      status: "failed",
      candidates: [],
      selectedCandidateId: null,
      notes: carriedNotes,
      failureReasons:
        carriedFailureReasons.length > 0
          ? carriedFailureReasons
          : ["Raw vision response had no candidates array."],
    };
  }

  const maxCandidates = options.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const validated: ValidatedVisionFloorCandidate[] = [];
  const rejectionReasons: string[] = [];

  parsed.candidates.forEach((rawCandidate, index) => {
    const result = validateRawVisionCandidate(rawCandidate, index);
    if (result.ok) {
      validated.push(result.value);
    } else {
      rejectionReasons.push(result.reason);
    }
  });

  const deduped = dedupeValidatedCandidates(validated).slice(0, maxCandidates);

  return mapValidatedVisionCandidatesToAutoFloorDetectionResult(deduped, options, carriedNotes, [
    ...carriedFailureReasons,
    ...rejectionReasons,
  ]);
}
