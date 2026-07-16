// --- Phase B3D-1: Pure All-Root Grunert P3P Diagnostic Evaluator ------------
// LAB-ONLY, DIAGNOSTIC-FIRST, READ-ONLY. A pure, deterministic Type B P3P
// diagnostic evaluator built on the committed B3A / B3B-R / B3C / B3D-R
// contracts. It consumes ONE frozen Type B evidence snapshot plus ONE B3C
// tuple-generation result and emits a `TypeBP3pDiagnosticRunRecord`.
//
// It performs EXACTLY one P3P evaluation per unique poseProbeEquivalenceKey,
// reads the primary latent-depth product DIRECTLY from the equivalence class,
// enumerates ALL real, positive-distance, proper-rigid Grunert P3P roots, keeps
// every surviving root UNRANKED, and records construction + plausibility
// observations. It NEVER chooses a camera pose, root, product class, aspect
// member, or FOV.
//
// ABSOLUTE SCOPE (Phase B3D-1). This module does NOT implement or perform any
// of: DLT / homography / four-corner reconstruction / virtual quadrilateral;
// generic nonlinear optimization; sign-sweep-only or bisection-only root
// finding; FOV topology validation; FOV corridor formation; branch association;
// crop-compatibility inequality; near-corner projection / recovery; endpoint-
// role re-derivation; snapshot capture; UI; preview; controlled load; Apply;
// calibration mutation; candidate / polygon / dimension / FOV / readiness
// mutation; persistence; API; Type A routing; ranking; score; confidence;
// winner; recommendation; selection; auto-load; auto-apply.
//
// It leaves FOV topology (`fovTopology: null`), branch corridors
// (`branchCorridors: []`), crop-compatibility evaluation, and near-coincident
// root separation for later phases (B3D-2 / B3D-3).
//
// Runtime imports are restricted to PURE constants / helpers from committed
// Type B contract modules. It has NO React, browser, Three.js, Type A,
// homography-solver, calibration, persistence, API, or routing import and no
// external mathematics dependency.

import {
  TYPE_B_EVALUATOR_FAMILY,
  TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA,
  TYPE_B_PLAUSIBILITY_CHECK_IDS,
  TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
  makeTypeBPoseProbeEquivalenceKey,
} from "./type-b-evaluator-contract";
import type {
  TypeBConstructionObservation,
  TypeBDeclaredEndpointRole,
  TypeBEvidenceSnapshot,
  TypeBEvidenceSnapshotBasis,
  TypeBFrozenDeclaredLineEvidence,
  TypeBLatentDepthEquivalenceClass,
  TypeBLatentDepthProduct,
  TypeBPlausibilityObservation,
  TypeBPoseHypothesis,
  TypeBPoseProbeEquivalence,
  TypeBPosePlausibilityState,
  TypeBPoseStageResult,
  TypeBRotationMatrix3,
  TypeBVec3,
} from "./type-b-evaluator-contract";
import { TYPE_B_P3P_DIAGNOSTIC_SCHEMA } from "./type-b-p3p-diagnostic-contract";
import type {
  TypeBMemberCompatibilityRecord,
  TypeBP3pDiagnosticRunRecord,
  TypeBP3pRootCensus,
  TypeBPoseProbeDiagnosticRecord,
} from "./type-b-p3p-diagnostic-contract";
import {
  TYPE_B_FOV_PROBE_MAX_DEG,
  TYPE_B_FOV_PROBE_MIN_DEG,
  TYPE_B_TUPLE_GENERATION_SCHEMA,
} from "./type-b-tuple-generation";
import type { TypeBTupleGenerationResult } from "./type-b-tuple-generation";

// --- Named numeric constants (each documented) ------------------------------

// Fixed, small number of Newton refinement iterations applied to a candidate
// real Grunert root on the ORIGINAL polynomial. A fixed count keeps the path
// deterministic (no convergence-dependent branching) and never uses random
// initialization or a bounded grid scan.
const NEWTON_POLISH_ITERATIONS = 8;

// Relative tolerance used ONLY to treat two solver roots as the SAME real root
// (numeric identity). Roots are never rounded for identity; the true value is
// preserved and only near-duplicates within this relative tolerance collapse.
const ROOT_NUMERIC_IDENTITY_REL_TOL = 1e-9;

// Relative tolerance used ONLY to collapse numerically identical reconstructed
// P3P distance triples (s1, s2, s3) into one hypothesis. This is the ONLY
// deduplication B3D-1 performs; near-coincident branch interpretation is B3D-2.
const DISTANCE_TRIPLE_IDENTITY_REL_TOL = 1e-7;

// Relative threshold below which a polynomial's leading coefficient is treated
// as zero, giving an HONEST degree reduction (quartic -> cubic -> quadratic ->
// linear -> constant). Compared against the largest-magnitude coefficient.
const LEADING_COEFFICIENT_REL_EPSILON = 1e-12;

// Relative threshold below which a discriminant is treated as zero, so an
// even-multiplicity / tangential real root is INCLUDED (never missed the way a
// sign-change scan would miss it).
const DISCRIMINANT_REL_EPSILON = 1e-12;

// Relative threshold below which the depressed-quartic linear term is treated
// as zero, selecting the biquadratic path instead of the full Ferrari path.
const BIQUADRATIC_LINEAR_REL_EPSILON = 1e-12;

// Absolute magnitude below which a raw vector is treated as a zero-length ray
// (true image-ray degeneracy), never a soft-conditioning threshold.
const ZERO_LENGTH_VECTOR_EPSILON = 1e-12;

// Absolute |cos| above which two normalized rays are treated as coincident /
// indistinguishable (structural image-ray degeneracy). NOT an empirical
// conditioning gate: it only detects genuinely parallel / anti-parallel rays.
const COINCIDENT_RAY_ABS_COS = 1 - 1e-12;

// Absolute area below which the world control triangle (J, R, S) is treated as
// degenerate. For valid positive world scalars the triangle is never
// degenerate; this only guards malformed inputs.
const DEGENERATE_WORLD_TRIANGLE_EPSILON = 1e-12;

// Absolute magnitude below which the Grunert (cos_gamma - v * cos_alpha)
// denominator is treated as mathematically undefined for that candidate root,
// so the recovered auxiliary ratio u cannot be formed and the root is dropped.
const GRUNERT_DENOMINATOR_EPSILON = 1e-12;

// Absolute tolerances for the proper-rigid rotation health check. A recovered
// rotation must have determinant within ROTATION_DETERMINANT_TOLERANCE of +1
// and orthonormality error within ROTATION_ORTHONORMALITY_TOLERANCE, else the
// root is a HARD BRANCH REJECTION (not a plausibility observation).
const ROTATION_DETERMINANT_TOLERANCE = 1e-6;
const ROTATION_ORTHONORMALITY_TOLERANCE = 1e-6;

// Absolute epsilon guarding division by a near-zero D = 1 + v^2 - 2 v cos_beta
// (the squared first camera-ray distance denominator) and by a projected depth.
const POSITIVE_DENOMINATOR_EPSILON = 1e-12;

// The exact evidence-family literal. B1 exports this as a TYPE only, so it is
// inlined here exactly as the committed B3C generator does.
const TYPE_B_EVIDENCE_FAMILY_LITERAL = "rear_seam_plus_strong_side_seam";

// The two authorized latent side-terminus conditions for this first family.
const LATENT_CONDITION_FRAME_TRUNCATED = "frame_truncated";
const LATENT_CONDITION_OCCLUDED = "occluded";

// Position-certain endpoint statuses (per the frozen endpoint-role contract).
const POSITION_CERTAIN_STATUSES: ReadonlySet<string> = new Set([
  "visible",
  "near_frame",
]);

// --- Pure primitive helpers -------------------------------------------------

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// --- Pure 3-vector helpers --------------------------------------------------

type V3 = { readonly x: number; readonly y: number; readonly z: number };

function subV3(a: V3, b: V3): V3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleV3(a: V3, s: number): V3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dotV3(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function crossV3(a: V3, b: V3): V3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function lengthV3(a: V3): number {
  return Math.sqrt(dotV3(a, a));
}

function normalizeV3(a: V3): V3 | null {
  const len = lengthV3(a);
  if (!Number.isFinite(len) || len < ZERO_LENGTH_VECTOR_EPSILON) return null;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

function isFiniteV3(a: V3): boolean {
  return isFiniteNumber(a.x) && isFiniteNumber(a.y) && isFiniteNumber(a.z);
}

// --- Pure polynomial helpers (ascending coefficient arrays) -----------------
// A polynomial is stored as [c0, c1, c2, ...] meaning c0 + c1 x + c2 x^2 + ...

function polyEval(coeffsAscending: readonly number[], x: number): number {
  let acc = 0;
  for (let i = coeffsAscending.length - 1; i >= 0; i -= 1) {
    acc = acc * x + coeffsAscending[i];
  }
  return acc;
}

function polyDerivativeEval(coeffsAscending: readonly number[], x: number): number {
  let acc = 0;
  for (let i = coeffsAscending.length - 1; i >= 1; i -= 1) {
    acc = acc * x + i * coeffsAscending[i];
  }
  return acc;
}

function polyMul(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      out[i + j] += a[i] * b[j];
    }
  }
  return out;
}

function polyAdd(a: readonly number[], b: readonly number[]): number[] {
  const n = Math.max(a.length, b.length);
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  }
  return out;
}

function polyScale(a: readonly number[], s: number): number[] {
  return a.map((c) => c * s);
}

// Effective polynomial degree honoring an honest leading-coefficient reduction.
// Returns -1 when every coefficient is negligible (no finite polynomial).
function effectiveDegree(coeffsAscending: readonly number[]): number {
  let maxAbs = 0;
  for (const c of coeffsAscending) {
    const a = Math.abs(c);
    if (a > maxAbs) maxAbs = a;
  }
  if (!(maxAbs > 0)) return -1;
  let deg = coeffsAscending.length - 1;
  while (
    deg > 0 &&
    Math.abs(coeffsAscending[deg]) <= LEADING_COEFFICIENT_REL_EPSILON * maxAbs
  ) {
    deg -= 1;
  }
  return deg;
}

// Collapse near-equal roots (numeric identity only) and return ascending order.
function dedupeAscending(
  roots: readonly number[],
  relTol: number
): number[] {
  const finite = roots.filter((r) => Number.isFinite(r)).slice().sort((a, b) => a - b);
  const out: number[] = [];
  for (const r of finite) {
    const last = out.length > 0 ? out[out.length - 1] : null;
    if (
      last !== null &&
      Math.abs(r - last) <= relTol * (1 + Math.max(Math.abs(r), Math.abs(last)))
    ) {
      continue;
    }
    out.push(r);
  }
  return out;
}

// --- Analytic real-root solvers (no sign-change scanning, no randomness) ----

// Real roots of c1 x + c0 = 0 (c1 assumed non-negligible by the dispatcher).
function solveLinearAscending(c: readonly number[]): number[] {
  const [c0, c1] = c;
  return [-c0 / c1];
}

// Real roots of c2 x^2 + c1 x + c0 = 0. A tangential (double) root is INCLUDED
// once via the discriminant-zero branch, so it can never be scanned past.
function solveQuadraticAscending(c: readonly number[]): number[] {
  const [c0, c1, c2] = c;
  const disc = c1 * c1 - 4 * c2 * c0;
  const scale = c1 * c1 + Math.abs(4 * c2 * c0);
  const discTol = DISCRIMINANT_REL_EPSILON * (scale + 1);
  if (disc < -discTol) return [];
  if (disc <= discTol) return [-c1 / (2 * c2)];
  const sq = Math.sqrt(disc);
  return [(-c1 - sq) / (2 * c2), (-c1 + sq) / (2 * c2)];
}

// Real roots of c3 x^3 + c2 x^2 + c1 x + c0 = 0 via the depressed-cubic
// discriminant (Cardano for one real root, the trigonometric form for three).
// A cubic always has at least one real root; double/triple roots are included.
function solveCubicAscending(c: readonly number[]): number[] {
  const [c0, c1, c2, c3] = c;
  const B = c2 / c3;
  const C = c1 / c3;
  const D = c0 / c3;
  const shift = B / 3;
  // Depressed cubic t^3 + p t + q = 0 with x = t - B/3.
  const p = C - (B * B) / 3;
  const q = (2 * B * B * B) / 27 - (B * C) / 3 + D;
  const roots: number[] = [];
  const pScale = Math.abs(p) + Math.abs(q) + 1;
  if (Math.abs(p) <= DISCRIMINANT_REL_EPSILON * pScale) {
    // t^3 + q = 0 -> single real cube root (any multiplicity collapses later).
    roots.push(Math.cbrt(-q) - shift);
    return roots;
  }
  const halfQ = q / 2;
  const discriminant = halfQ * halfQ + (p * p * p) / 27;
  const discScale = halfQ * halfQ + Math.abs((p * p * p) / 27) + 1;
  if (discriminant > DISCRIMINANT_REL_EPSILON * discScale) {
    const sqrtDisc = Math.sqrt(discriminant);
    const t = Math.cbrt(-halfQ + sqrtDisc) + Math.cbrt(-halfQ - sqrtDisc);
    roots.push(t - shift);
    return roots;
  }
  if (discriminant >= -DISCRIMINANT_REL_EPSILON * discScale) {
    // Δ ≈ 0: a single and a double real root (or a triple when q ≈ 0 too).
    const u = Math.cbrt(-halfQ);
    roots.push(2 * u - shift);
    roots.push(-u - shift);
    return roots;
  }
  // Δ < 0: three distinct real roots via the trigonometric form.
  const m = 2 * Math.sqrt(-p / 3);
  const arg = Math.max(-1, Math.min(1, (3 * q) / (p * m)));
  const theta = Math.acos(arg);
  for (let k = 0; k < 3; k += 1) {
    roots.push(m * Math.cos((theta - 2 * Math.PI * k) / 3) - shift);
  }
  return roots;
}

// Real roots of c4 x^4 + ... + c0 = 0 via a depressed quartic plus Ferrari's
// resolvent-cubic factorization into two quadratics (analytic, all-root). The
// biquadratic case is handled directly. No sign-change scan is used anywhere.
function solveQuarticAscending(c: readonly number[]): number[] {
  const [c0, c1, c2, c3, c4] = c;
  const B = c3 / c4;
  const C = c2 / c4;
  const D = c1 / c4;
  const E = c0 / c4;
  // Depress x = y - B/4 -> y^4 + p y^2 + q y + r.
  const p = C - (3 * B * B) / 8;
  const q = D - (B * C) / 2 + (B * B * B) / 8;
  const r =
    E - (B * D) / 4 + (B * B * C) / 16 - (3 * B * B * B * B) / 256;
  const shift = B / 4;
  const ys: number[] = [];
  const qScale = Math.abs(D) + Math.abs(B * C) + Math.abs(B * B * B) + 1;
  if (Math.abs(q) <= BIQUADRATIC_LINEAR_REL_EPSILON * qScale) {
    // Biquadratic: w^2 + p w + r = 0 with w = y^2.
    for (const w of solveQuadraticAscending([r, p, 1])) {
      if (w < 0) {
        if (w >= -DISCRIMINANT_REL_EPSILON * (Math.abs(p) + Math.abs(r) + 1)) {
          ys.push(0);
        }
        continue;
      }
      const root = Math.sqrt(w);
      if (root <= ZERO_LENGTH_VECTOR_EPSILON) {
        ys.push(0);
      } else {
        ys.push(root, -root);
      }
    }
    return dedupeAscending(
      ys.map((y) => y - shift),
      ROOT_NUMERIC_IDENTITY_REL_TOL
    );
  }
  // Ferrari: resolvent cubic z^3 + 2p z^2 + (p^2 - 4r) z - q^2 = 0. A positive
  // real root always exists (value at z = 0 is -q^2 < 0). Pick the largest.
  const resolventRoots = solveCubicAscending([
    -(q * q),
    p * p - 4 * r,
    2 * p,
    1,
  ]);
  let z = Number.NEGATIVE_INFINITY;
  for (const candidate of resolventRoots) {
    if (candidate > z) z = candidate;
  }
  if (!Number.isFinite(z) || z <= 0) {
    return [];
  }
  const alpha = Math.sqrt(z);
  const beta = (p + z) / 2 - q / (2 * alpha);
  const gamma = (p + z) / 2 + q / (2 * alpha);
  // Factor into (y^2 + alpha y + beta)(y^2 - alpha y + gamma).
  for (const y of solveQuadraticAscending([beta, alpha, 1])) ys.push(y);
  for (const y of solveQuadraticAscending([gamma, -alpha, 1])) ys.push(y);
  return dedupeAscending(
    ys.map((y) => y - shift),
    ROOT_NUMERIC_IDENTITY_REL_TOL
  );
}

// Dispatch by honest effective degree.
function solveRealPolynomialAscending(coeffsAscending: readonly number[]): number[] {
  const deg = effectiveDegree(coeffsAscending);
  const c = coeffsAscending.slice(0, deg + 1);
  let roots: number[];
  switch (deg) {
    case 1:
      roots = solveLinearAscending(c);
      break;
    case 2:
      roots = solveQuadraticAscending(c);
      break;
    case 3:
      roots = solveCubicAscending(c);
      break;
    case 4:
      roots = solveQuarticAscending(c);
      break;
    default:
      // Degree 0 (non-zero constant) or all-negligible: no finite real roots.
      roots = [];
  }
  return dedupeAscending(roots, ROOT_NUMERIC_IDENTITY_REL_TOL);
}

// --- Exported narrow real-quartic helper (for focused unit testing only) ----
//
// Interprets the tuple as a4 x^4 + a3 x^3 + a2 x^2 + a1 x + a0 = 0, i.e. index 0
// is the QUARTIC (leading) coefficient and index 4 is the constant term. It
// returns all DISTINCT real roots in ascending numeric order, supports honest
// degree reductions (cubic / quadratic / linear / constant), includes even-
// multiplicity / tangential real roots, returns [] for no finite real roots,
// and never throws for malformed / non-finite coefficients. This is internal
// mathematics exposed only for direct testing; it is NOT a general app-wide
// solver utility.
export function solveTypeBRealQuarticRoots(
  coefficients: readonly [number, number, number, number, number]
): readonly number[] {
  if (!Array.isArray(coefficients) || coefficients.length !== 5) return [];
  const [a4, a3, a2, a1, a0] = coefficients;
  if (![a0, a1, a2, a3, a4].every((value) => isFiniteNumber(value))) return [];
  // Convert to ascending [a0, a1, a2, a3, a4] for the internal solver.
  return solveRealPolynomialAscending([a0, a1, a2, a3, a4]);
}

// --- Camera intrinsics (existing project convention) ------------------------
// Vertical FOV, square pixels (fx = fy), principal point at the SOURCE-frame
// center, inclusive FOV range 20-90 degrees (TYPE_B_FOV_PROBE_MIN/MAX_DEG).

type Intrinsics = {
  readonly fx: number;
  readonly fy: number;
  readonly cx: number;
  readonly cy: number;
};

function buildIntrinsics(
  width: number,
  height: number,
  verticalFovDeg: number
): Intrinsics | null {
  if (!isFinitePositive(width) || !isFinitePositive(height)) return null;
  if (
    !isFiniteNumber(verticalFovDeg) ||
    verticalFovDeg < TYPE_B_FOV_PROBE_MIN_DEG ||
    verticalFovDeg > TYPE_B_FOV_PROBE_MAX_DEG
  ) {
    return null;
  }
  const fovRad = (verticalFovDeg * Math.PI) / 180;
  const fy = height / (2 * Math.tan(fovRad / 2));
  const fx = fy;
  const cx = width / 2;
  const cy = height / 2;
  if (![fx, fy, cx, cy].every((v) => isFiniteNumber(v)) || fx <= 0 || fy <= 0) {
    return null;
  }
  return { fx, fy, cx, cy };
}

// Normalized CV ray for a source pixel: [(u - cx)/fx, (v - cy)/fy, 1].
function pixelToRay(px: { x: number; y: number }, k: Intrinsics): V3 {
  return { x: (px.x - k.cx) / k.fx, y: (px.y - k.cy) / k.fy, z: 1 };
}

// CV projection of a camera-frame point into source pixels (returns null when
// the point is not strictly in front of the camera or is non-finite).
function projectCameraPoint(
  cameraPoint: V3,
  k: Intrinsics
): { x: number; y: number } | null {
  if (!isFiniteV3(cameraPoint)) return null;
  if (!(cameraPoint.z > POSITIVE_DENOMINATOR_EPSILON)) return null;
  const u = k.fx * (cameraPoint.x / cameraPoint.z) + k.cx;
  const v = k.fy * (cameraPoint.y / cameraPoint.z) + k.cy;
  if (!isFiniteNumber(u) || !isFiniteNumber(v)) return null;
  return { x: u, y: v };
}

// --- Rotation helpers -------------------------------------------------------

// Deterministic orthonormal triad from three points: e1 along (p2 - p1), e2 the
// Gram-Schmidt residual of (p3 - p1), e3 = e1 x e2. Returns null when the three
// points are collinear / degenerate.
function orthonormalTriad(p1: V3, p2: V3, p3: V3): [V3, V3, V3] | null {
  const e1 = normalizeV3(subV3(p2, p1));
  if (!e1) return null;
  const d3 = subV3(p3, p1);
  const proj = scaleV3(e1, dotV3(d3, e1));
  const e2 = normalizeV3(subV3(d3, proj));
  if (!e2) return null;
  const e3 = crossV3(e1, e2);
  return [e1, e2, e3];
}

// Proper rotation registering world triad {e_k} onto camera triad {f_k} as
// R = sum_k f_k e_k^T (row-major). Maps world directions into camera frame.
function registerRotation(
  worldTriad: [V3, V3, V3],
  cameraTriad: [V3, V3, V3]
): number[] {
  const R = new Array<number>(9).fill(0);
  for (let k = 0; k < 3; k += 1) {
    const f = [cameraTriad[k].x, cameraTriad[k].y, cameraTriad[k].z];
    const e = [worldTriad[k].x, worldTriad[k].y, worldTriad[k].z];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        R[3 * i + j] += f[i] * e[j];
      }
    }
  }
  return R;
}

function matrixTransposeVec(R: readonly number[], v: V3): V3 {
  return {
    x: R[0] * v.x + R[3] * v.y + R[6] * v.z,
    y: R[1] * v.x + R[4] * v.y + R[7] * v.z,
    z: R[2] * v.x + R[5] * v.y + R[8] * v.z,
  };
}

function matrixDeterminant(R: readonly number[]): number {
  return (
    R[0] * (R[4] * R[8] - R[5] * R[7]) -
    R[1] * (R[3] * R[8] - R[5] * R[6]) +
    R[2] * (R[3] * R[7] - R[4] * R[6])
  );
}

// Sum of orthonormality defects of the three rotation rows (0 for a perfect
// orthonormal matrix). Used only for the numerical-health hard branch reject.
function rotationOrthonormalityError(R: readonly number[]): number {
  const rows: V3[] = [
    { x: R[0], y: R[1], z: R[2] },
    { x: R[3], y: R[4], z: R[5] },
    { x: R[6], y: R[7], z: R[8] },
  ];
  let err = 0;
  for (let i = 0; i < 3; i += 1) {
    for (let j = i; j < 3; j += 1) {
      const target = i === j ? 1 : 0;
      err += Math.abs(dotV3(rows[i], rows[j]) - target);
    }
  }
  return err;
}

function perpendicularDistanceToLine(
  point: { x: number; y: number },
  lineA: { x: number; y: number },
  lineB: { x: number; y: number }
): number | null {
  const dx = lineB.x - lineA.x;
  const dy = lineB.y - lineA.y;
  const lineLen = Math.hypot(dx, dy);
  if (!isFiniteNumber(lineLen) || lineLen < ZERO_LENGTH_VECTOR_EPSILON) {
    return null;
  }
  const cross = Math.abs(dx * (lineA.y - point.y) - dy * (lineA.x - point.x));
  const residual = cross / lineLen;
  return isFiniteNumber(residual) ? residual : null;
}

// --- Grunert all-root P3P core ----------------------------------------------

type Pixel = { readonly x: number; readonly y: number };

// Resolved, frozen-role-driven P3P evidence for one pose-probe unit.
type ResolvedP3pEvidence = {
  // World control points in the junction-anchored Type B frame.
  readonly worldJunctionRear: V3; // J = (0, 0, 0)
  readonly worldNonJunctionRear: V3; // R = (worldWidth, 0, 0)
  readonly worldSideTerminus: V3; // S = (0, 0, product * worldWidth)
  // Observed source pixels for the three P3P correspondences.
  readonly pxJunctionRear: Pixel;
  readonly pxNonJunctionRear: Pixel;
  readonly pxSideTerminus: Pixel;
  // Declared side-chord endpoints (frozen junction-side endpoint + terminus).
  readonly pxDeclaredSideJunction: Pixel;
  readonly pxDeclaredSideTerminus: Pixel;
  readonly intrinsics: Intrinsics;
};

type PositiveRootCandidate = {
  readonly polishedRoot: number;
  readonly distances: readonly [number, number, number];
  readonly rotation: TypeBRotationMatrix3;
  readonly cameraPositionWorld: V3;
  readonly translation: V3;
};

// Result of the pure P3P core: the pose-stage result plus the honest census.
type P3pCoreResult = {
  readonly poseStageResult: TypeBPoseStageResult;
  readonly census: TypeBP3pRootCensus;
};

const ZERO_CENSUS: TypeBP3pRootCensus = {
  algebraicCandidateCount: 0,
  realRootCount: 0,
  positiveDistanceRootCount: 0,
  deduplicatedRootCount: 0,
};

// Builds the Grunert one-variable polynomial (ascending in v = s3 / s1) from the
// three world distances and the three unit image rays, using exact polynomial
// arithmetic. Returns null when the construction is mathematically undefined.
function buildGrunertPolynomial(
  worldPoints: readonly [V3, V3, V3],
  rays: readonly [V3, V3, V3]
): {
  coeffsAscending: number[];
  numeratorCoeffs: readonly number[];
  cosAlpha: number;
  cosBeta: number;
  cosGamma: number;
  bSq: number;
} | null {
  const [P1, P2, P3] = worldPoints;
  const [v1, v2, v3] = rays;
  const a = lengthV3(subV3(P2, P3));
  const b = lengthV3(subV3(P1, P3));
  const c = lengthV3(subV3(P1, P2));
  const aSq = a * a;
  const bSq = b * b;
  const cSq = c * c;
  if (!(bSq > 0) || !(cSq > 0) || !(aSq > 0)) return null;
  const cosAlpha = dotV3(v2, v3);
  const cosBeta = dotV3(v1, v3);
  const cosGamma = dotV3(v1, v2);
  if (![cosAlpha, cosBeta, cosGamma].every((v) => isFiniteNumber(v))) return null;
  const m = (aSq - cSq) / bSq;
  // N(v) = (m + 1) + (-2 m cosBeta) v + (m - 1) v^2
  const N = [m + 1, -2 * m * cosBeta, m - 1];
  // Den(v) = 2 cosGamma - 2 cosAlpha v
  const Den = [2 * cosGamma, -2 * cosAlpha];
  // (1 - (cSq/bSq) * (1 - 2 cosBeta v + v^2))
  const cr = cSq / bSq;
  const oneMinus = [1 - cr, 2 * cr * cosBeta, -cr];
  const NN = polyMul(N, N);
  const term2 = polyScale(polyMul(N, Den), -2 * cosGamma);
  const DenSq = polyMul(Den, Den);
  const term3 = polyMul(oneMinus, DenSq);
  const coeffsAscending = polyAdd(polyAdd(NN, term2), term3);
  if (!coeffsAscending.every((v) => isFiniteNumber(v))) return null;
  return {
    coeffsAscending,
    numeratorCoeffs: N,
    cosAlpha,
    cosBeta,
    cosGamma,
    bSq,
  };
}

// Pure P3P core. Enumerates every real, positive-distance, proper-rigid Grunert
// root as an UNRANKED hypothesis in ascending polished-root order, or returns a
// typed pose-stage refusal for true degeneracy / no cheirality-valid root.
function solveGrunertAllRoots(evidence: ResolvedP3pEvidence): P3pCoreResult {
  const worldPoints: [V3, V3, V3] = [
    evidence.worldJunctionRear,
    evidence.worldNonJunctionRear,
    evidence.worldSideTerminus,
  ];
  const rawRays: [V3, V3, V3] = [
    pixelToRay(evidence.pxJunctionRear, evidence.intrinsics),
    pixelToRay(evidence.pxNonJunctionRear, evidence.intrinsics),
    pixelToRay(evidence.pxSideTerminus, evidence.intrinsics),
  ];
  // --- True image-ray degeneracy (structural only) --------------------------
  const unitRays: V3[] = [];
  for (const raw of rawRays) {
    if (!isFiniteV3(raw)) {
      return { poseStageResult: degenerate(), census: ZERO_CENSUS };
    }
    const unit = normalizeV3(raw);
    if (!unit) {
      return { poseStageResult: degenerate(), census: ZERO_CENSUS };
    }
    unitRays.push(unit);
  }
  for (let i = 0; i < 3; i += 1) {
    for (let j = i + 1; j < 3; j += 1) {
      if (Math.abs(dotV3(unitRays[i], unitRays[j])) >= COINCIDENT_RAY_ABS_COS) {
        return { poseStageResult: degenerate(), census: ZERO_CENSUS };
      }
    }
  }
  const worldTriangleArea =
    lengthV3(
      crossV3(
        subV3(worldPoints[1], worldPoints[0]),
        subV3(worldPoints[2], worldPoints[0])
      )
    ) / 2;
  if (!(worldTriangleArea > DEGENERATE_WORLD_TRIANGLE_EPSILON)) {
    return { poseStageResult: degenerate(), census: ZERO_CENSUS };
  }
  const rays: [V3, V3, V3] = [unitRays[0], unitRays[1], unitRays[2]];
  const built = buildGrunertPolynomial(worldPoints, rays);
  if (!built) {
    return { poseStageResult: degenerate(), census: ZERO_CENSUS };
  }
  const { coeffsAscending, numeratorCoeffs, cosAlpha, cosBeta, cosGamma, bSq } =
    built;
  const degree = effectiveDegree(coeffsAscending);
  if (degree < 1) {
    // Mathematically undefined polynomial construction -> true degeneracy.
    return { poseStageResult: degenerate(), census: ZERO_CENSUS };
  }
  const algebraicCandidateCount = degree;
  const realRoots = solveRealPolynomialAscending(coeffsAscending);
  const realRootCount = realRoots.length;

  const positiveCandidates: PositiveRootCandidate[] = [];
  for (const rawRoot of realRoots) {
    // Newton polish on the ORIGINAL polynomial (fixed iterations, guarded).
    let v = rawRoot;
    for (let iter = 0; iter < NEWTON_POLISH_ITERATIONS; iter += 1) {
      const f = polyEval(coeffsAscending, v);
      const df = polyDerivativeEval(coeffsAscending, v);
      if (!isFiniteNumber(df) || Math.abs(df) < POSITIVE_DENOMINATOR_EPSILON) break;
      const next = v - f / df;
      if (!isFiniteNumber(next)) break;
      v = next;
    }
    // D = 1 - 2 cosBeta v + v^2 must be positive for a real first distance.
    const D = 1 - 2 * cosBeta * v + v * v;
    if (!(D > POSITIVE_DENOMINATOR_EPSILON)) continue;
    const s1 = Math.sqrt(bSq / D);
    // u = N(v) / (2 (cosGamma - v cosAlpha)); the denominator vanishing marks a
    // mathematically undefined auxiliary ratio, so that root is dropped.
    const den = 2 * (cosGamma - v * cosAlpha);
    if (Math.abs(den) < GRUNERT_DENOMINATOR_EPSILON) continue;
    const u = polyEval(numeratorCoeffs, v) / den;
    if (!isFiniteNumber(u)) continue;
    const s2 = u * s1;
    const s3 = v * s1;
    if (!(isFinitePositive(s1) && isFinitePositive(s2) && isFinitePositive(s3))) {
      continue;
    }
    // Reconstruct camera-frame points and register a proper rigid transform.
    const camPoints: [V3, V3, V3] = [
      scaleV3(rays[0], s1),
      scaleV3(rays[1], s2),
      scaleV3(rays[2], s3),
    ];
    const camTriad = orthonormalTriad(camPoints[0], camPoints[1], camPoints[2]);
    const worldTriad = orthonormalTriad(
      worldPoints[0],
      worldPoints[1],
      worldPoints[2]
    );
    if (!camTriad || !worldTriad) continue;
    const R = registerRotation(worldTriad, camTriad);
    if (!R.every((value) => isFiniteNumber(value))) continue;
    const det = matrixDeterminant(R);
    const orthoErr = rotationOrthonormalityError(R);
    if (
      !isFiniteNumber(det) ||
      Math.abs(det - 1) > ROTATION_DETERMINANT_TOLERANCE ||
      !isFiniteNumber(orthoErr) ||
      orthoErr > ROTATION_ORTHONORMALITY_TOLERANCE
    ) {
      // Non-finite or improper rotation is a HARD BRANCH REJECTION.
      continue;
    }
    // t = Pc1 - R * J = Pc1 (J is the frame origin). C = -R^T t.
    const t = camPoints[0];
    const cameraPositionWorld = scaleV3(matrixTransposeVec(R, t), -1);
    if (!isFiniteV3(cameraPositionWorld)) continue;
    positiveCandidates.push({
      polishedRoot: v,
      distances: [s1, s2, s3],
      rotation: R as unknown as TypeBRotationMatrix3,
      cameraPositionWorld,
      translation: t,
    });
  }
  const positiveDistanceRootCount = positiveCandidates.length;

  // Ascending polished-root order, then collapse numerically identical triples.
  positiveCandidates.sort((a, b) => a.polishedRoot - b.polishedRoot);
  const deduped: PositiveRootCandidate[] = [];
  for (const candidate of positiveCandidates) {
    const isDuplicate = deduped.some((kept) =>
      distanceTriplesIdentical(kept.distances, candidate.distances)
    );
    if (!isDuplicate) deduped.push(candidate);
  }
  const deduplicatedRootCount = deduped.length;

  const census: TypeBP3pRootCensus = {
    algebraicCandidateCount,
    realRootCount,
    positiveDistanceRootCount,
    deduplicatedRootCount,
  };

  if (deduped.length === 0) {
    // No proper-rigid, positive-distance root survived.
    const reason =
      realRootCount > 0
        ? "pose_stage_cheirality_failed"
        : "pose_stage_no_rigid_solution";
    return { poseStageResult: { kind: "refusal", reason }, census };
  }

  const hypotheses: TypeBPoseHypothesis[] = deduped.map((candidate, index) =>
    buildHypothesis(candidate, index, evidence)
  );
  return {
    poseStageResult: { kind: "pose_hypotheses", hypotheses },
    census,
  };
}

function distanceTriplesIdentical(
  a: readonly [number, number, number],
  b: readonly [number, number, number]
): boolean {
  for (let i = 0; i < 3; i += 1) {
    const scale = 1 + Math.max(Math.abs(a[i]), Math.abs(b[i]));
    if (Math.abs(a[i] - b[i]) > DISTANCE_TRIPLE_IDENTITY_REL_TOL * scale) {
      return false;
    }
  }
  return true;
}

function degenerate(): TypeBPoseStageResult {
  return { kind: "refusal", reason: "pose_stage_degenerate_configuration" };
}

// Source-pixel reprojection residual of a world point through (R, t), or null
// when the point does not project (behind camera / non-finite): a numerical
// failure, NOT a low-confidence signal.
function reprojectionResidual(
  worldPoint: V3,
  candidate: PositiveRootCandidate,
  observedPx: Pixel,
  k: Intrinsics
): number | null {
  const cameraPoint = {
    x:
      candidate.rotation[0] * worldPoint.x +
      candidate.rotation[1] * worldPoint.y +
      candidate.rotation[2] * worldPoint.z +
      candidate.translation.x,
    y:
      candidate.rotation[3] * worldPoint.x +
      candidate.rotation[4] * worldPoint.y +
      candidate.rotation[5] * worldPoint.z +
      candidate.translation.y,
    z:
      candidate.rotation[6] * worldPoint.x +
      candidate.rotation[7] * worldPoint.y +
      candidate.rotation[8] * worldPoint.z +
      candidate.translation.z,
  };
  const projected = projectCameraPoint(cameraPoint, k);
  if (!projected) return null;
  const residual = Math.hypot(projected.x - observedPx.x, projected.y - observedPx.y);
  return isFiniteNumber(residual) ? residual : null;
}

// Builds ONE unranked pose hypothesis: junction-anchored frame identity, the
// recovered proper rotation + camera position, the four construction-satisfying
// observations, and the five exact B3D-R plausibility observations. The plural
// results are ordered by ascending polished root; `hypothesisIndex` is a stable
// 0-based enumeration ONLY (never a rank / score / preference).
function buildHypothesis(
  candidate: PositiveRootCandidate,
  hypothesisIndex: number,
  evidence: ResolvedP3pEvidence
): TypeBPoseHypothesis {
  const k = evidence.intrinsics;
  const junctionRearResidual = reprojectionResidual(
    evidence.worldJunctionRear,
    candidate,
    evidence.pxJunctionRear,
    k
  );
  const nonJunctionRearResidual = reprojectionResidual(
    evidence.worldNonJunctionRear,
    candidate,
    evidence.pxNonJunctionRear,
    k
  );
  const sideTerminusResidual = reprojectionResidual(
    evidence.worldSideTerminus,
    candidate,
    evidence.pxSideTerminus,
    k
  );

  // Side-chord alignment: project J and S, form the recovered side direction,
  // and measure the declared side chord's agreement with that image line. This
  // stays construction-satisfying and never filters or scores a root.
  const projJ = projectWorldPoint(evidence.worldJunctionRear, candidate, k);
  const projS = projectWorldPoint(evidence.worldSideTerminus, candidate, k);
  let sideChordResidual: number | null = null;
  if (projJ && projS) {
    const dJunction = perpendicularDistanceToLine(
      evidence.pxDeclaredSideJunction,
      projJ,
      projS
    );
    const dTerminus = perpendicularDistanceToLine(
      evidence.pxDeclaredSideTerminus,
      projJ,
      projS
    );
    if (dJunction !== null && dTerminus !== null) {
      sideChordResidual = (dJunction + dTerminus) / 2;
    }
  }

  const constructionObservations: TypeBConstructionObservation[] = [
    {
      kind: "junction_rear_point",
      residualPx: junctionRearResidual,
      interpretation: "construction_satisfying",
    },
    {
      kind: "non_junction_rear_point",
      residualPx: nonJunctionRearResidual,
      interpretation: "construction_satisfying",
    },
    {
      kind: "side_terminus_point",
      residualPx: sideTerminusResidual,
      interpretation: "construction_satisfying",
    },
    {
      kind: "side_chord_alignment",
      residualPx: sideChordResidual,
      interpretation: "construction_satisfying",
    },
  ];

  const cameraAboveFloor: TypeBPosePlausibilityState =
    candidate.cameraPositionWorld.y > 0 ? "passed" : "failed";
  const cameraNearSide: TypeBPosePlausibilityState =
    candidate.cameraPositionWorld.z > 0 ? "passed" : "failed";
  const plausibility: TypeBPlausibilityObservation[] = [
    // A surviving hypothesis already passed the finite proper-rotation gate.
    { checkId: TYPE_B_PLAUSIBILITY_CHECK_IDS.rotationNumericalHealth, state: "passed" },
    // A surviving hypothesis came from a structurally nondegenerate solve.
    { checkId: TYPE_B_PLAUSIBILITY_CHECK_IDS.imageRayConditioning, state: "passed" },
    { checkId: TYPE_B_PLAUSIBILITY_CHECK_IDS.cameraAboveFloor, state: cameraAboveFloor },
    { checkId: TYPE_B_PLAUSIBILITY_CHECK_IDS.cameraNearSideOfRearSeam, state: cameraNearSide },
    // Near-coincident root separation is deferred to B3D-2.
    { checkId: TYPE_B_PLAUSIBILITY_CHECK_IDS.rootSeparation, state: "not_evaluated" },
  ];

  const cameraPositionWorld: TypeBVec3 = {
    x: candidate.cameraPositionWorld.x,
    y: candidate.cameraPositionWorld.y,
    z: candidate.cameraPositionWorld.z,
  };

  return {
    hypothesisIndex,
    poseComparisonReferenceFrame: TYPE_B_POSE_COMPARISON_REFERENCE_FRAME,
    cameraPositionWorld,
    worldToCameraRotation: candidate.rotation,
    constructionObservations,
    plausibility,
  };
}

function projectWorldPoint(
  worldPoint: V3,
  candidate: PositiveRootCandidate,
  k: Intrinsics
): Pixel | null {
  const cameraPoint = {
    x:
      candidate.rotation[0] * worldPoint.x +
      candidate.rotation[1] * worldPoint.y +
      candidate.rotation[2] * worldPoint.z +
      candidate.translation.x,
    y:
      candidate.rotation[3] * worldPoint.x +
      candidate.rotation[4] * worldPoint.y +
      candidate.rotation[5] * worldPoint.z +
      candidate.translation.y,
    z:
      candidate.rotation[6] * worldPoint.x +
      candidate.rotation[7] * worldPoint.y +
      candidate.rotation[8] * worldPoint.z +
      candidate.translation.z,
  };
  return projectCameraPoint(cameraPoint, k);
}

// --- Frozen endpoint-role resolution + per-probe preflight ------------------

function oppositeRole(role: TypeBDeclaredEndpointRole): TypeBDeclaredEndpointRole {
  return role === "start" ? "end" : "start";
}

type SeamEndpoint = {
  readonly norm: { readonly x: number; readonly y: number };
  readonly status: string;
};

// Resolves one declared endpoint (norm + observed status) by role WITHOUT any
// closest-endpoint re-derivation: the frozen role is used exactly as captured.
function endpointByRole(
  seam: TypeBFrozenDeclaredLineEvidence,
  role: TypeBDeclaredEndpointRole
): SeamEndpoint | null {
  if (!isObjectRecord(seam)) return null;
  const norm = role === "start" ? seam.startNorm : seam.endNorm;
  const status = role === "start" ? seam.startEndpointStatus : seam.endEndpointStatus;
  if (!isObjectRecord(norm)) return null;
  if (!isFiniteNumber(norm.x) || !isFiniteNumber(norm.y)) return null;
  if (typeof status !== "string") return null;
  return { norm: { x: norm.x, y: norm.y }, status };
}

type PreflightResult =
  | { readonly ok: true; readonly evidence: ResolvedP3pEvidence }
  | { readonly ok: false };

// Per-probe P3P preflight: verifies ONLY the structural evidence conditions
// required to attempt a P3P solve (schema + family identifiers, positive source
// frame / world width, valid frozen roles, position-certain junction / non-
// junction rear endpoints, a latent side terminus matching the snapshot
// condition, and a valid FOV). It re-runs NO B1 / B3 eligibility. On failure the
// caller emits the typed `pose_stage_unsupported_constraint_set` refusal.
function preflightPoseProbe(
  snapshot: TypeBEvidenceSnapshot,
  product: TypeBLatentDepthProduct,
  fovProbeDeg: number
): PreflightResult {
  if (!isObjectRecord(snapshot)) return { ok: false };
  if (snapshot.schema !== TYPE_B_EVIDENCE_SNAPSHOT_SCHEMA) return { ok: false };
  if (snapshot.evidenceFamily !== TYPE_B_EVIDENCE_FAMILY_LITERAL) return { ok: false };
  if (snapshot.evaluatorFamily !== TYPE_B_EVALUATOR_FAMILY) return { ok: false };

  const floorAssumptions = snapshot.floorAssumptions;
  if (!isObjectRecord(floorAssumptions)) return { ok: false };
  const worldWidth = floorAssumptions.worldWidth;
  if (!isFinitePositive(worldWidth)) return { ok: false };

  const latentCondition = snapshot.latentNearCornerCondition;
  if (
    latentCondition !== LATENT_CONDITION_FRAME_TRUNCATED &&
    latentCondition !== LATENT_CONDITION_OCCLUDED
  ) {
    return { ok: false };
  }

  const roles = snapshot.endpointRoles;
  if (!isObjectRecord(roles)) return { ok: false };
  const junctionRearRole = roles.junctionRearEndpoint;
  const junctionSideRole = roles.junctionSideEndpoint;
  if (junctionRearRole !== "start" && junctionRearRole !== "end") return { ok: false };
  if (junctionSideRole !== "start" && junctionSideRole !== "end") return { ok: false };

  const rearSeam = snapshot.rearSeam;
  const sideSeam = snapshot.strongSideSeam;
  if (!isObjectRecord(rearSeam) || !isObjectRecord(sideSeam)) return { ok: false };

  const junctionRear = endpointByRole(rearSeam, junctionRearRole);
  const nonJunctionRear = endpointByRole(rearSeam, oppositeRole(junctionRearRole));
  const junctionSide = endpointByRole(sideSeam, junctionSideRole);
  const sideTerminus = endpointByRole(sideSeam, oppositeRole(junctionSideRole));
  if (!junctionRear || !nonJunctionRear || !junctionSide || !sideTerminus) {
    return { ok: false };
  }

  // Position-certain junction (rear + side) and non-junction rear endpoints.
  if (!POSITION_CERTAIN_STATUSES.has(junctionRear.status)) return { ok: false };
  if (!POSITION_CERTAIN_STATUSES.has(junctionSide.status)) return { ok: false };
  if (!POSITION_CERTAIN_STATUSES.has(nonJunctionRear.status)) return { ok: false };
  // The side terminus status must match the frozen latent condition exactly.
  if (sideTerminus.status !== latentCondition) return { ok: false };

  const basis = snapshot.basis;
  if (!isObjectRecord(basis)) return { ok: false };
  const sourceFrame = basis.sourceFrame;
  if (!isObjectRecord(sourceFrame)) return { ok: false };
  const width = sourceFrame.width;
  const height = sourceFrame.height;
  if (!isFinitePositive(width) || !isFinitePositive(height)) return { ok: false };

  const intrinsics = buildIntrinsics(width, height, fovProbeDeg);
  if (!intrinsics) return { ok: false };

  if (!isFinitePositive(product?.value)) return { ok: false };

  const toPixel = (endpoint: SeamEndpoint): Pixel => ({
    x: endpoint.norm.x * width,
    y: endpoint.norm.y * height,
  });

  const evidence: ResolvedP3pEvidence = {
    worldJunctionRear: { x: 0, y: 0, z: 0 },
    worldNonJunctionRear: { x: worldWidth, y: 0, z: 0 },
    worldSideTerminus: { x: 0, y: 0, z: product.value * worldWidth },
    pxJunctionRear: toPixel(junctionRear),
    pxNonJunctionRear: toPixel(nonJunctionRear),
    pxSideTerminus: toPixel(sideTerminus),
    pxDeclaredSideJunction: toPixel(junctionSide),
    pxDeclaredSideTerminus: toPixel(sideTerminus),
    intrinsics,
  };
  return { ok: true, evidence };
}

// --- Defensive B3C linkage validation ---------------------------------------
// B3D-1 must NOT regenerate, repair, reorder, or reinterpret B3C coverage. Any
// broken required relationship is a WHOLE-RUN refusal with zero solves.

function basesExactlyEqual(
  a: TypeBEvidenceSnapshotBasis | undefined,
  b: TypeBEvidenceSnapshotBasis | undefined
): boolean {
  if (!isObjectRecord(a) || !isObjectRecord(b)) return false;
  if (a.sourceImageIdentity !== b.sourceImageIdentity) return false;
  if (a.sourceFrameKey !== b.sourceFrameKey) return false;
  if (a.candidateIdentity !== b.candidateIdentity) return false;
  if (a.floorPolygonKey !== b.floorPolygonKey) return false;
  const fa = a.sourceFrame;
  const fb = b.sourceFrame;
  if (!isObjectRecord(fa) || !isObjectRecord(fb)) return false;
  if (fa.width !== fb.width || fa.height !== fb.height) return false;
  return true;
}

// Structural snapshot integrity required merely to LINK (containers present and
// correctly typed). Semantic evidence issues (endpoint statuses, terminus
// condition) are deferred to the per-probe preflight, not treated as linkage.
function snapshotStructurallyLinkable(snapshot: TypeBEvidenceSnapshot): boolean {
  if (!isObjectRecord(snapshot)) return false;
  if (!isObjectRecord(snapshot.endpointRoles)) return false;
  if (!isObjectRecord(snapshot.floorAssumptions)) return false;
  if (!isObjectRecord(snapshot.basis)) return false;
  if (!isObjectRecord(snapshot.basis.sourceFrame)) return false;
  const condition = snapshot.latentNearCornerCondition;
  if (
    condition !== LATENT_CONDITION_FRAME_TRUNCATED &&
    condition !== LATENT_CONDITION_OCCLUDED
  ) {
    return false;
  }
  return true;
}

function isLinkageValid(
  snapshot: TypeBEvidenceSnapshot,
  tupleGeneration: TypeBTupleGenerationResult
): boolean {
  // Check 1: exact B3C schema.
  if (!isObjectRecord(tupleGeneration)) return false;
  if (tupleGeneration.schema !== TYPE_B_TUPLE_GENERATION_SCHEMA) return false;
  // Check 12: snapshot endpoint-role / source-frame / floor / latent structure.
  if (!snapshotStructurallyLinkable(snapshot)) return false;
  // Check 2: snapshot basis exactly matches the echoed B3C snapshot basis.
  if (!basesExactlyEqual(snapshot.basis, tupleGeneration.snapshotBasis)) return false;

  const productClasses = Array.isArray(tupleGeneration.productClasses)
    ? tupleGeneration.productClasses
    : [];

  // Per-pose-probe-key consistency accumulator (check 11).
  const perKeyIdentity = new Map<
    string,
    { classKey: string; productValue: number; fovProbeDeg: number }
  >();

  for (const productClass of productClasses) {
    if (!isObjectRecord(productClass)) return false;
    const status = productClass.status;
    const members = Array.isArray(productClass.members) ? productClass.members : [];
    const equivalence = productClass.latentDepthEquivalence;

    if (status === "refused") {
      // Check 5: a refused class must carry no members.
      if (members.length > 0) return false;
      continue;
    }
    if (status !== "generated") return false;

    // Check 3: a generated class must carry a non-null equivalence identity.
    if (!isObjectRecord(equivalence)) return false;
    const classKey = equivalence.equivalenceClassKey;
    if (!isNonBlankString(classKey)) return false;
    const product = equivalence.latentDepthProduct;
    if (!isObjectRecord(product) || !isFinitePositive(product.value)) return false;
    const classProductValue = product.value;

    // Check 4: a generated class must carry at least one member.
    if (members.length === 0) return false;

    for (const member of members) {
      if (!isObjectRecord(member)) return false;
      const memberAspect = member.floorAspectRatio;
      const memberExtent = member.latentSideExtent;
      if (!isFinitePositive(memberAspect) || !isFinitePositive(memberExtent)) {
        return false;
      }
      // Check 10: member extent equals class product / member aspect (IEEE).
      if (memberExtent !== classProductValue / memberAspect) return false;

      const tuples = Array.isArray(member.tuples) ? member.tuples : [];
      if (tuples.length === 0) return false;
      for (const tupleRecord of tuples) {
        if (!isObjectRecord(tupleRecord)) return false;
        const tuple = tupleRecord.tuple;
        const poseProbeEquivalence = tupleRecord.poseProbeEquivalence;
        if (!isObjectRecord(tuple) || !isObjectRecord(poseProbeEquivalence)) {
          return false;
        }
        // Check 8: evaluator family.
        if (tuple.evaluatorFamily !== TYPE_B_EVALUATOR_FAMILY) return false;
        // Check 9: tuple aspect / extent agree exactly with the member.
        if (tuple.floorAspectRatio !== memberAspect) return false;
        if (tuple.latentSideExtent !== memberExtent) return false;

        const key = poseProbeEquivalence.poseProbeEquivalenceKey;
        // Check 6: pose-probe key is non-blank.
        if (!isNonBlankString(key)) return false;
        const fovProbeDeg = poseProbeEquivalence.fovProbeDeg;
        if (!isFiniteNumber(fovProbeDeg)) return false;
        // Tuple FOV must match its pose-probe FOV exactly.
        if (tuple.fovProbeDeg !== fovProbeDeg) return false;
        // The pose-probe equivalence must reference this class key.
        if (poseProbeEquivalence.latentDepthEquivalenceClassKey !== classKey) {
          return false;
        }
        // Check 7: the key equals the deterministically rebuilt key.
        const rebuilt = makeTypeBPoseProbeEquivalenceKey(classKey, fovProbeDeg);
        if (rebuilt === null || rebuilt !== key) return false;

        // Check 11: all tuples under one key agree on class key, exact product,
        // and exact FOV.
        const existing = perKeyIdentity.get(key);
        if (existing) {
          if (
            existing.classKey !== classKey ||
            existing.productValue !== classProductValue ||
            existing.fovProbeDeg !== fovProbeDeg
          ) {
            return false;
          }
        } else {
          perKeyIdentity.set(key, {
            classKey,
            productValue: classProductValue,
            fovProbeDeg,
          });
        }
      }
    }
  }
  return true;
}

// --- Main pure evaluator ----------------------------------------------------

// One resolved pose-probe execution unit (unique poseProbeEquivalenceKey).
type PoseProbeUnit = {
  readonly poseProbeEquivalence: TypeBPoseProbeEquivalence;
  readonly latentDepthEquivalence: TypeBLatentDepthEquivalenceClass;
  readonly latentDepthProduct: TypeBLatentDepthProduct;
  readonly fovProbeDeg: number;
};

function linkageRefusal(
  tupleGeneration: TypeBTupleGenerationResult
): TypeBP3pDiagnosticRunRecord {
  return {
    schema: TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
    snapshotBasis: (tupleGeneration?.snapshotBasis ??
      null) as TypeBEvidenceSnapshotBasis,
    tupleGeneration,
    poseProbeResults: [],
    memberCompatibilityRecords: [],
    branchCorridors: [],
    fovTopology: null,
    refusalReasons: ["invalid_tuple_generation_linkage"],
  };
}

function echoUpstream(
  tupleGeneration: TypeBTupleGenerationResult
): TypeBP3pDiagnosticRunRecord {
  return {
    schema: TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
    snapshotBasis: tupleGeneration.snapshotBasis,
    tupleGeneration,
    poseProbeResults: [],
    memberCompatibilityRecords: [],
    branchCorridors: [],
    fovTopology: null,
    refusalReasons: [],
  };
}

// Pure, deterministic Type B P3P diagnostic run. Consumes one frozen snapshot
// and one B3C tuple-generation result; returns a run record. It never mutates
// inputs, never reads live state, never throws for malformed runtime input,
// performs EXACTLY one P3P evaluation per unique poseProbeEquivalenceKey, keeps
// ALL surviving roots unranked, and leaves FOV topology / branch corridors /
// crop-compatibility evaluation for later phases. It selects NOTHING.
export function evaluateTypeBP3pDiagnosticRun(
  snapshot: TypeBEvidenceSnapshot,
  tupleGeneration: TypeBTupleGenerationResult
): TypeBP3pDiagnosticRunRecord {
  try {
    // Defensive B3C linkage validation BEFORE any solve.
    if (!isLinkageValid(snapshot, tupleGeneration)) {
      return linkageRefusal(tupleGeneration);
    }

    // Upstream B3C refusal: echo verbatim, zero solves, no coverage repair.
    if (tupleGeneration.status !== "generated") {
      return echoUpstream(tupleGeneration);
    }

    const productClasses = Array.isArray(tupleGeneration.productClasses)
      ? tupleGeneration.productClasses
      : [];

    // --- Collect unique pose-probe units in first-seen B3C order ------------
    const seenKeys = new Set<string>();
    const poseProbeUnits: PoseProbeUnit[] = [];
    // --- Collect member compatibility links (one per member x exact FOV) ----
    const memberCompatibilityRecords: TypeBMemberCompatibilityRecord[] = [];

    for (const productClass of productClasses) {
      if (productClass.status !== "generated") continue;
      const equivalence = productClass.latentDepthEquivalence;
      const product = equivalence.latentDepthProduct;
      for (const member of productClass.members) {
        for (const tupleRecord of member.tuples) {
          const poseProbeEquivalence = tupleRecord.poseProbeEquivalence;
          const key = poseProbeEquivalence.poseProbeEquivalenceKey;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            poseProbeUnits.push({
              poseProbeEquivalence,
              latentDepthEquivalence: equivalence,
              // Use the class's EXACT primary product directly (never a
              // recomputed member extent x aspect).
              latentDepthProduct: product,
              fovProbeDeg: poseProbeEquivalence.fovProbeDeg,
            });
          }
          memberCompatibilityRecords.push({
            primaryProductClassIdentity: productClass.primaryProductClassIdentity,
            floorAspectRatio: member.floorAspectRatio,
            latentSideExtent: member.latentSideExtent,
            // Copy B3C's deferred crop state ONLY; no crop test is run here.
            cropCompatibility: member.cropCompatibility,
            poseProbeEquivalenceKey: key,
          });
        }
      }
    }

    // --- Exactly one P3P evaluation per unique pose-probe key ---------------
    const poseProbeResults: TypeBPoseProbeDiagnosticRecord[] = poseProbeUnits.map(
      (unit) => {
        const preflight = preflightPoseProbe(
          snapshot,
          unit.latentDepthProduct,
          unit.fovProbeDeg
        );
        if (!preflight.ok) {
          return {
            poseProbeEquivalence: unit.poseProbeEquivalence,
            latentDepthEquivalence: unit.latentDepthEquivalence,
            latentDepthProduct: unit.latentDepthProduct,
            poseStageResult: {
              kind: "refusal",
              reason: "pose_stage_unsupported_constraint_set",
            },
            rootCensus: ZERO_CENSUS,
          };
        }
        const core = solveGrunertAllRoots(preflight.evidence);
        return {
          poseProbeEquivalence: unit.poseProbeEquivalence,
          latentDepthEquivalence: unit.latentDepthEquivalence,
          latentDepthProduct: unit.latentDepthProduct,
          poseStageResult: core.poseStageResult,
          rootCensus: core.census,
        };
      }
    );

    return {
      schema: TYPE_B_P3P_DIAGNOSTIC_SCHEMA,
      snapshotBasis: tupleGeneration.snapshotBasis,
      tupleGeneration,
      poseProbeResults,
      memberCompatibilityRecords,
      branchCorridors: [],
      fovTopology: null,
      refusalReasons: [],
    };
  } catch {
    // Ultimate safety net: never throw for malformed runtime input.
    return linkageRefusal(tupleGeneration);
  }
}

