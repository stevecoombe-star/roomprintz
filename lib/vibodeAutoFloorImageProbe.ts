import "server-only";

// --- Phase 2H-D: lab-only structural-preservation heuristic ------------------
// A coarse, server-only edge-correlation probe between the ORIGINAL room image
// and the generated EMPTY-ROOM image. Its ONLY job is to give the empty-primary
// policy a cheap signal for whether the fixed room shell (walls/ceiling/far
// wall) was structurally preserved by the empty-room generation.
//
// HARD design constraints (see Phase 2H-C memo):
//   * Heuristic, lab-tunable — NOT ground truth.
//   * DOWNGRADE-ONLY. A strong score never *approves* / *promotes* anything; a
//     weak score only lowers confidence (verified -> review). It is never a
//     silent approval gate and never blocks on its own.
//   * Biased toward STATIC room-shell regions (upper wall/ceiling, side-wall
//     strips, far-wall band). The lower-center floor region — where furniture
//     removal legitimately changes pixels — is explicitly EXCLUDED so that
//     successful furniture removal is not mistaken for structural drift.
//
// No DB, no network, no persistence. `sharp` (already a dependency) is the only
// IO and is used purely to decode + downsample to a small grayscale grid.

export type StructuralPreservationBand = "strong" | "ok" | "uncertain" | "weak" | "unavailable";

export type StructuralPreservationProbeResult = {
  // True only when the probe ran end-to-end and produced a usable score.
  ok: boolean;
  // Weighted edge-correlation in [0,1] over the included static-shell regions
  // (max(0, weighted Pearson r) of gradient magnitudes). null when unavailable.
  score: number | null;
  band: StructuralPreservationBand;
  // Number of grid pixels that contributed (weight > 0) to the correlation.
  includedPixelCount: number;
  // Human-facing description of which regions were used / excluded.
  regionsUsed: string[];
  excludedRegions: string[];
  reason: string | null;
  // Always true: this is a heuristic, lab-tunable signal — never authoritative.
  heuristic: true;
  note: string;
};

// --- Lab-tunable thresholds --------------------------------------------------
// Downsample grid: small + cheap; correlation is over coarse edge structure,
// not fine detail. Width fixed; height preserves aspect.
const GRID_WIDTH = 96;
const GRID_MAX_HEIGHT = 256;
const MIN_INCLUDED_PIXELS = 64;

// Score -> band thresholds (lab-tunable). Bands at/above "ok" do NOT downgrade;
// "uncertain"/"weak"/"unavailable" cause a confidence downgrade in the policy.
const BAND_STRONG = 0.8;
const BAND_OK = 0.6;
const BAND_UNCERTAIN = 0.4;

const PROBE_NOTE =
  "Heuristic edge-correlation over static room-shell regions (upper wall/ceiling, side-wall strips, far-wall band); lower-center floor excluded. Lab-tunable, downgrade-only — never approves or promotes a candidate.";

const REGIONS_USED = ["upper-wall-ceiling", "side-wall-strips", "far-wall-band"];
const EXCLUDED_REGIONS = ["lower-center-floor"];

function unavailable(reason: string): StructuralPreservationProbeResult {
  return {
    ok: false,
    score: null,
    band: "unavailable",
    includedPixelCount: 0,
    regionsUsed: REGIONS_USED,
    excludedRegions: EXCLUDED_REGIONS,
    reason,
    heuristic: true,
    note: PROBE_NOTE,
  };
}

function bandFromScore(score: number): StructuralPreservationBand {
  if (score >= BAND_STRONG) return "strong";
  if (score >= BAND_OK) return "ok";
  if (score >= BAND_UNCERTAIN) return "uncertain";
  return "weak";
}

/**
 * Region weight for normalized image coordinates u (col, left->right) and
 * v (row, top->bottom), both in [0,1]. Higher weight = more trusted as a fixed
 * room-shell region.
 *
 *   - upper band (ceiling / upper walls):           weight 1.0
 *   - side-wall strips (far left / far right):       weight 0.8
 *   - far-wall band (mid-height, away from floor):   weight 0.6
 *   - lower-center FLOOR region:                     weight 0.0 (excluded)
 *   - everything else (e.g. lower corners):          weight 0.2
 */
function regionWeight(u: number, v: number): number {
  // Exclude the lower-center floor region: furniture removal changes these
  // pixels legitimately, so it must not count as structural drift.
  if (v >= 0.55 && u >= 0.15 && u <= 0.85) return 0;

  let w = 0.2;
  if (v <= 0.3) w = Math.max(w, 1.0); // ceiling / upper walls
  if (u <= 0.15 || u >= 0.85) w = Math.max(w, 0.8); // side-wall strips
  if (v > 0.3 && v <= 0.55) w = Math.max(w, 0.6); // far-wall band
  return w;
}

// Gradient magnitude via central differences on a single-channel grid (clamped
// at borders). Captures structural edges (wall/ceiling seams) while being
// largely invariant to global brightness shifts.
function gradientMagnitude(gray: Uint8Array | Buffer, width: number, height: number): Float64Array {
  const out = new Float64Array(width * height);
  const at = (r: number, c: number) => gray[r * width + c];
  for (let r = 0; r < height; r += 1) {
    const rUp = r > 0 ? r - 1 : r;
    const rDown = r < height - 1 ? r + 1 : r;
    for (let c = 0; c < width; c += 1) {
      const cLeft = c > 0 ? c - 1 : c;
      const cRight = c < width - 1 ? c + 1 : c;
      const gx = at(r, cRight) - at(r, cLeft);
      const gy = at(rDown, c) - at(rUp, c);
      out[r * width + c] = Math.hypot(gx, gy);
    }
  }
  return out;
}

/**
 * Runs the structural-preservation heuristic between two already-verified,
 * coordinate-compatible image buffers (same intrinsic dimensions + orientation;
 * the route enforces this before calling). Returns "unavailable" on any decode
 * problem so the policy treats it as a downgrade rather than a hard failure.
 */
export async function probeStructuralPreservation(
  originalBuffer: Buffer,
  emptyBuffer: Buffer
): Promise<StructuralPreservationProbeResult> {
  try {
    const sharp = (await import("sharp")).default;

    const baseMeta = await sharp(originalBuffer).metadata();
    const srcW = typeof baseMeta.width === "number" ? baseMeta.width : 0;
    const srcH = typeof baseMeta.height === "number" ? baseMeta.height : 0;
    if (srcW <= 0 || srcH <= 0) return unavailable("Original image could not be decoded for the structural probe.");

    const gridW = GRID_WIDTH;
    const gridH = Math.max(1, Math.min(GRID_MAX_HEIGHT, Math.round((GRID_WIDTH * srcH) / srcW)));

    const toGray = async (buf: Buffer): Promise<Buffer> =>
      sharp(buf)
        .resize(gridW, gridH, { fit: "fill" })
        .removeAlpha()
        .greyscale()
        .raw()
        .toBuffer();

    const [grayA, grayB] = await Promise.all([toGray(originalBuffer), toGray(emptyBuffer)]);
    const expected = gridW * gridH;
    if (grayA.length < expected || grayB.length < expected) {
      return unavailable("Structural probe could not produce a comparable grayscale grid.");
    }

    const gradA = gradientMagnitude(grayA, gridW, gridH);
    const gradB = gradientMagnitude(grayB, gridW, gridH);

    // Weighted Pearson correlation of gradient magnitudes over included pixels.
    let sumW = 0;
    let sumWX = 0;
    let sumWY = 0;
    let sumWXX = 0;
    let sumWYY = 0;
    let sumWXY = 0;
    let includedPixelCount = 0;

    const denomW = gridW > 1 ? gridW - 1 : 1;
    const denomH = gridH > 1 ? gridH - 1 : 1;

    for (let r = 0; r < gridH; r += 1) {
      const v = r / denomH;
      for (let c = 0; c < gridW; c += 1) {
        const u = c / denomW;
        const w = regionWeight(u, v);
        if (w <= 0) continue;
        const idx = r * gridW + c;
        const x = gradA[idx];
        const y = gradB[idx];
        sumW += w;
        sumWX += w * x;
        sumWY += w * y;
        sumWXX += w * x * x;
        sumWYY += w * y * y;
        sumWXY += w * x * y;
        includedPixelCount += 1;
      }
    }

    if (includedPixelCount < MIN_INCLUDED_PIXELS || sumW <= 0) {
      return unavailable("Structural probe had too few static-region pixels to score.");
    }

    const meanX = sumWX / sumW;
    const meanY = sumWY / sumW;
    const covXY = sumWXY / sumW - meanX * meanY;
    const varX = sumWXX / sumW - meanX * meanX;
    const varY = sumWYY / sumW - meanY * meanY;

    if (varX <= 1e-9 || varY <= 1e-9) {
      // Flat static regions (e.g. blank walls) carry no edge signal to correlate.
      return unavailable("Static regions were too flat for the structural probe to score.");
    }

    const r = covXY / Math.sqrt(varX * varY);
    const score = Math.max(0, Math.min(1, r));
    const band = bandFromScore(score);

    return {
      ok: true,
      score: Number(score.toFixed(3)),
      band,
      includedPixelCount,
      regionsUsed: REGIONS_USED,
      excludedRegions: EXCLUDED_REGIONS,
      reason: null,
      heuristic: true,
      note: PROBE_NOTE,
    };
  } catch {
    return unavailable("Structural probe failed to decode one of the images.");
  }
}
