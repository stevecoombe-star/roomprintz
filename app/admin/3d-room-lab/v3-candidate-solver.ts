/**
 * Pure, non-authoritative calibrated-camera/v3 candidate solver.
 *
 * This module deliberately owns its narrow input contract and its camera math.
 * It neither reads nor writes production authority state.
 */

export const V3_SOLVER_CONTRACT_VERSION = "calibrated-camera-v3-candidate/v1" as const;
export const V3_SOLVER_CONFIG_VERSION = "v3-solver-config/v1" as const;

export type V3Vec2 = Readonly<{ x: number; y: number }>;
export type V3Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type V3Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

export type V3Theta = Readonly<{
  omegaXRad: number;
  omegaZRad: number;
  deltaTxM: number;
  deltaTyM: number;
  deltaTzM: number;
}>;

export type V3ActiveV2Snapshot = Readonly<{
  authorityVersion: string;
  appliedAtIso: string | null;
  calibrationVersion: string;
  solverIdentifier: string;
  frameSize: Readonly<{ width: number; height: number }>;
  imageBasis: Readonly<{ id: string; fingerprint: string; intrinsicWidth: number; intrinsicHeight: number }>;
  verticalFovDeg: number;
  /** CV camera convention: +X right, +Y down, +Z forward. */
  worldToCameraCv: V3Matrix3;
  position: V3Vec3;
  sourceFloorPolygon: readonly V3Vec2[];
  floor: Readonly<{ polygonKey: string; worldWidth: number; worldDepth: number }>;
}>;

export type V3CandidateObservation = Readonly<{
  observationId: string;
  physicalVerticalId: string;
  imageBasisId: string;
  imageBasisFingerprint: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  sourceNormalizedEndpoints: Readonly<{ lower: V3Vec2; upper: V3Vec2 }>;
  frozenWorldAnchor: V3Vec3;
  wallPolygonKey: string;
  frozenAnchorDerivationId: string;
  evidenceModelVersion: string;
  suggestionGeneratorVersion: string;
  operatorDecision: "selected" | "excluded" | "unreviewed";
  decisionAtIso: string | null;
  current: boolean;
  eligible: boolean;
}>;

export type V3SolverInput = Readonly<{
  activeV2: V3ActiveV2Snapshot | null;
  observations: readonly V3CandidateObservation[];
}>;

export type V3SolverConfig = Readonly<{
  sigmaFloorPx: number;
  sigmaVerticalRad: number;
  robustDelta: number;
  sigmaOmegaRad: number;
  sigmaTranslationM: number;
  omegaBoundRad: number;
  translationBoundM: number;
  duplicateDisagreementWarnDeg: number;
  tensionMinVerticalImprovementDeg: number;
  tensionMinFloorCostPx: number;
  unresolvedMinFloorCostPx: number;
  noOpOmegaTolRad: number;
  noOpTranslationTolM: number;
  conditioningMinSingularValue: number;
  bimodalGapDeg: number;
  bimodalGapMadRatio: number;
  bimodalEpsilonDeg: number;
}>;

/**
 * Pinned strictly within the experiment ranges. The values are intentionally
 * local to this research contract rather than product policy.
 */
export const V3_SOLVER_CONFIG: V3SolverConfig = Object.freeze({
  sigmaFloorPx: 3,
  sigmaVerticalRad: 0.005,
  robustDelta: 2,
  sigmaOmegaRad: 0.05236,
  sigmaTranslationM: 0.25,
  omegaBoundRad: 0.14,
  translationBoundM: 1,
  duplicateDisagreementWarnDeg: 1,
  tensionMinVerticalImprovementDeg: 0.8,
  tensionMinFloorCostPx: 3.5,
  unresolvedMinFloorCostPx: 17,
  conditioningMinSingularValue: 0.6,
  bimodalGapDeg: 1.5,
  bimodalGapMadRatio: 3,
  bimodalEpsilonDeg: 0.05,
  noOpOmegaTolRad: 1e-4,
  noOpTranslationTolM: 1e-4,
});

export type V3PrimaryStatus =
  | "unavailable"
  | "insufficient_evidence"
  | "ill_conditioned"
  | "incompatible_evidence"
  | "optimization_failed"
  | "candidate_bounded"
  | "no_op"
  | "candidate_ready";
export type V3ExploratoryOutcome = "interior_converged" | "bounded_converged" | "negligible_delta" | "optimization_failed";
export type V3Warning =
  | "dispersed_residuals"
  | "duplicate_disagreement"
  | "cross_block_tension"
  | "cross_block_unresolved"
  | "one_sided_anchor_distribution"
  | "prediction_excluded_observation"
  | "cheirality_constrained";

export type V3CandidatePose = Readonly<{
  position: V3Vec3;
  lookAt: V3Vec3;
  up: V3Vec3;
  verticalFovDeg: number;
  worldToCameraCv: V3Matrix3;
}>;

export type V3Bimodality = Readonly<{
  sortedGroupResidualsDeg: readonly Readonly<{ physicalVerticalId: string; residualDeg: number }>[];
  largestGapDeg: number;
  splitIndex: number | null;
  verdict: "unimodal" | "dispersed" | "bimodal";
  families: readonly Readonly<{ physicalVerticalId: string; family: "left" | "right" }>[];
  left: Readonly<{ count: number; meanDeg: number | null; medianDeg: number | null; madDeg: number | null }>;
  right: Readonly<{ count: number; meanDeg: number | null; medianDeg: number | null; madDeg: number | null }>;
}>;

export type V3Conditioning = Readonly<{
  singularValues: readonly [number, number];
  passes: boolean;
  observationIds: readonly string[];
}>;

export type V3CrossBlockDiagnostic =
  | Readonly<{
      evaluated: true;
      floorRmsAtV2Px: number;
      floorRmsAtProbePx: number;
      verticalMeanAbsAtV2Deg: number;
      verticalMeanAbsAtProbeDeg: number;
      probeVerticalImprovementDeg: number;
      probeFloorCostPx: number;
      tension: boolean;
      unresolved: boolean;
    }>
  | Readonly<{
      evaluated: false;
      reason: "bimodal_evidence" | "probe_unavailable" | "optimization_failed";
    }>;

type Admitted = Readonly<{ observation: V3CandidateObservation; groupSize: number }>;
type Evaluation = Readonly<{
  valid: boolean;
  reason: string | null;
  floorResidualsPx: readonly number[];
  verticals: readonly Readonly<{
    observationId: string;
    physicalVerticalId: string;
    residualRad: number;
    observedTiltRad: number;
    predictedTiltRad: number;
    structuralWeight: number;
    robustInfluence: number;
  }>[];
  objective: number;
  floorRmsPx: number | null;
  meanAbsGroupVerticalDeg: number | null;
}>;

export type V3Result = Readonly<{
  contractVersion: typeof V3_SOLVER_CONTRACT_VERSION;
  configVersion: typeof V3_SOLVER_CONFIG_VERSION;
  config: V3SolverConfig;
  status: V3PrimaryStatus;
  safety: Readonly<{ applied: false; authoritative: false; persisted: false; activeCameraUnchanged: true }>;
  fingerprint: string;
  warnings: readonly V3Warning[];
  excludedObservations: readonly Readonly<{ observationId: string; reason: string }>[];
  admittedObservationIds: readonly string[];
  rawObservationCount: number;
  distinctPhysicalVerticalCount: number;
  conditioning: V3Conditioning | null;
  bimodality: V3Bimodality | null;
  crossBlock: V3CrossBlockDiagnostic | null;
  initial: Readonly<{ objective: number | null; floorRmsPx: number | null }>;
  final: Readonly<{ objective: number | null; floorRmsPx: number | null; meanAbsGroupVerticalDeg: number | null }>;
  candidatePose: V3CandidatePose | null;
  theta: V3Theta | null;
  activeBounds: readonly string[];
  optimizer: Readonly<{ ran: boolean; convergenceReason: string | null; iterations: number; rejectedTrials: number; clampedTrialProposals: number }>;
  observations: readonly Readonly<{
    observationId: string; physicalVerticalId: string; residualRad: number; robustInfluence: number;
  }>[];
  groups: readonly Readonly<{ physicalVerticalId: string; meanResidualRad: number; residualRangeRad: number; observationIds: readonly string[] }>[];
  verticalOnlyProbe: Readonly<{ theta: V3Theta | null; floorRmsPx: number | null; outcome: V3ExploratoryOutcome }>;
  exploratory: Readonly<{ outcome: V3ExploratoryOutcome; pose: V3CandidatePose | null; theta: V3Theta | null }> | null;
}>;

const DEPTH_EPS = 1e-6;
const FD = 1e-6;
/** Physical-coordinate tolerance for deciding whether a converged parameter is at a hard research bound. */
const FINAL_BOUND_TOLERANCE = 1e-10;

const ZERO_THETA: V3Theta = Object.freeze({ omegaXRad: 0, omegaZRad: 0, deltaTxM: 0, deltaTyM: 0, deltaTzM: 0 });
const SAFETY = Object.freeze({ applied: false as const, authoritative: false as const, persisted: false as const, activeCameraUnchanged: true as const });

function finite(...values: number[]): boolean { return values.every(Number.isFinite); }
function sub(a: V3Vec3, b: V3Vec3): V3Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a: V3Vec3, b: V3Vec3): V3Vec3 { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function mul(m: V3Matrix3, p: V3Vec3): V3Vec3 {
  return { x: m[0] * p.x + m[1] * p.y + m[2] * p.z, y: m[3] * p.x + m[4] * p.y + m[5] * p.z, z: m[6] * p.x + m[7] * p.y + m[8] * p.z };
}
function transpose(m: V3Matrix3): V3Matrix3 { return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; }
function mm(a: V3Matrix3, b: V3Matrix3): V3Matrix3 {
  return [
    a[0]*b[0]+a[1]*b[3]+a[2]*b[6], a[0]*b[1]+a[1]*b[4]+a[2]*b[7], a[0]*b[2]+a[1]*b[5]+a[2]*b[8],
    a[3]*b[0]+a[4]*b[3]+a[5]*b[6], a[3]*b[1]+a[4]*b[4]+a[5]*b[7], a[3]*b[2]+a[4]*b[5]+a[5]*b[8],
    a[6]*b[0]+a[7]*b[3]+a[8]*b[6], a[6]*b[1]+a[7]*b[4]+a[8]*b[7], a[6]*b[2]+a[7]*b[5]+a[8]*b[8],
  ];
}
function thetaArray(t: V3Theta): number[] { return [t.omegaXRad, t.omegaZRad, t.deltaTxM, t.deltaTyM, t.deltaTzM]; }
function thetaFrom(a: readonly number[]): V3Theta { return { omegaXRad: a[0], omegaZRad: a[1], deltaTxM: a[2], deltaTyM: a[3], deltaTzM: a[4] }; }
function thetaInfinityNorms(t: V3Theta): { omega: number; translation: number } {
  return {
    omega: Math.max(Math.abs(t.omegaXRad), Math.abs(t.omegaZRad)),
    translation: Math.max(Math.abs(t.deltaTxM), Math.abs(t.deltaTyM), Math.abs(t.deltaTzM)),
  };
}
export function v3IsNoOpByInfinityNorm(theta: V3Theta, config: Pick<V3SolverConfig, "noOpOmegaTolRad" | "noOpTranslationTolM"> = V3_SOLVER_CONFIG): boolean {
  const norms = thetaInfinityNorms(theta);
  return norms.omega < config.noOpOmegaTolRad && norms.translation < config.noOpTranslationTolM;
}
export function v3WrapToMinusPiPlusPi(a: number): number { return Math.atan2(Math.sin(a), Math.cos(a)); }
function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b); const i = Math.floor(s.length / 2);
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}
function mean(values: readonly number[]): number | null { return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null; }
function diagnosticNumber(value: number): number { return Number(value.toPrecision(7)); }

/** Rodrigues' exponential for the strictly world-X/world-Z pure-swing vector. */
export function v3ExpPureSwing(omegaXRad: number, omegaZRad: number): V3Matrix3 {
  const angle = Math.hypot(omegaXRad, omegaZRad);
  if (angle < 1e-14) return [1, -omegaZRad, 0, omegaZRad, 1, -omegaXRad, 0, omegaXRad, 1];
  const x = omegaXRad / angle; const z = omegaZRad / angle; const s = Math.sin(angle); const c = Math.cos(angle); const d = 1 - c;
  return [c + x*x*d, -z*s, x*z*d, z*s, c, -x*s, x*z*d, x*s, c + z*z*d];
}

export function v3CandidateWorldToCamera(snapshot: V3ActiveV2Snapshot, theta: V3Theta): V3Matrix3 {
  return mm(snapshot.worldToCameraCv, transpose(v3ExpPureSwing(theta.omegaXRad, theta.omegaZRad)));
}

export function v3CandidatePose(snapshot: V3ActiveV2Snapshot, theta: V3Theta): V3CandidatePose {
  const worldToCameraCv = v3CandidateWorldToCamera(snapshot, theta);
  const cameraToWorld = transpose(worldToCameraCv);
  const position = add(snapshot.position, { x: theta.deltaTxM, y: theta.deltaTyM, z: theta.deltaTzM });
  const forward = mul(cameraToWorld, { x: 0, y: 0, z: 1 });
  const up = mul(cameraToWorld, { x: 0, y: -1, z: 0 });
  return { position, lookAt: add(position, forward), up, verticalFovDeg: snapshot.verticalFovDeg, worldToCameraCv };
}

export function v3IntrinsicCamera(snapshot: V3ActiveV2Snapshot): Readonly<{ scale: number; fx: number; fy: number; cx: number; cy: number }> | null {
  const { width: Fw, height: Fh } = snapshot.frameSize;
  const { intrinsicWidth: W, intrinsicHeight: H } = snapshot.imageBasis;
  const fov = snapshot.verticalFovDeg * Math.PI / 180;
  if (!finite(Fw, Fh, W, H, fov) || Fw <= 0 || Fh <= 0 || W <= 0 || H <= 0 || fov <= 0 || fov >= Math.PI) return null;
  const scaleCover = Math.max(Fw / W, Fh / H);
  const focal = Fh / (2 * Math.tan(fov / 2)) / scaleCover;
  return finite(scaleCover, focal) && focal > 0 ? { scale: scaleCover, fx: focal, fy: focal, cx: W / 2, cy: H / 2 } : null;
}

export function v3ProjectIntrinsic(snapshot: V3ActiveV2Snapshot, theta: V3Theta, point: V3Vec3): V3Vec2 | null {
  const k = v3IntrinsicCamera(snapshot); if (!k || !finite(point.x, point.y, point.z)) return null;
  const p = mul(v3CandidateWorldToCamera(snapshot, theta), sub(point, add(snapshot.position, { x: theta.deltaTxM, y: theta.deltaTyM, z: theta.deltaTzM })));
  if (!finite(p.x, p.y, p.z) || p.z <= DEPTH_EPS) return null;
  const projected = { x: k.fx * p.x / p.z + k.cx, y: k.fy * p.y / p.z + k.cy };
  return finite(projected.x, projected.y) ? projected : null;
}

function sourcePx(point: V3Vec2, snapshot: V3ActiveV2Snapshot): V3Vec2 | null {
  const { intrinsicWidth: width, intrinsicHeight: height } = snapshot.imageBasis;
  return finite(point.x, point.y, width, height) ? { x: point.x * width, y: point.y * height } : null;
}
function orderedFloor(polygon: readonly V3Vec2[]): V3Vec2[] | null {
  if (polygon.length !== 4 || !polygon.every(p => finite(p.x, p.y))) return null;
  const y = [...polygon].sort((a, b) => b.y - a.y);
  const near = [y[0], y[1]].sort((a, b) => a.x - b.x); const far = [y[2], y[3]].sort((a, b) => a.x - b.x);
  return [near[0], near[1], far[1], far[0]];
}
function floorCorners(snapshot: V3ActiveV2Snapshot): V3Vec3[] | null {
  const { worldWidth: w, worldDepth: d } = snapshot.floor;
  if (!finite(w, d) || w <= 0 || d <= 0) return null;
  return [{ x: -w/2, y: 0, z: d/2 }, { x: w/2, y: 0, z: d/2 }, { x: w/2, y: 0, z: -d/2 }, { x: -w/2, y: 0, z: -d/2 }];
}
function observationReason(o: V3CandidateObservation, snapshot: V3ActiveV2Snapshot): string | null {
  if (o.operatorDecision !== "selected") return "not_selected";
  if (!o.current) return "not_current";
  if (!o.eligible) return "not_eligible";
  if (o.imageBasisId !== snapshot.imageBasis.id || o.imageBasisFingerprint !== snapshot.imageBasis.fingerprint) return "image_basis_mismatch";
  if (o.intrinsicWidth !== snapshot.imageBasis.intrinsicWidth || o.intrinsicHeight !== snapshot.imageBasis.intrinsicHeight) return "intrinsic_dimensions_mismatch";
  const p = o.sourceNormalizedEndpoints;
  if (!finite(p.lower.x, p.lower.y, p.upper.x, p.upper.y, o.frozenWorldAnchor.x, o.frozenWorldAnchor.y, o.frozenWorldAnchor.z)) return "non_finite";
  if (Math.hypot(p.upper.x - p.lower.x, p.upper.y - p.lower.y) <= 1e-12) return "degenerate_endpoints";
  return null;
}
function groupAdmitted(observations: readonly V3CandidateObservation[]): Admitted[] {
  const sizes = new Map<string, number>();
  for (const o of observations) sizes.set(o.physicalVerticalId, (sizes.get(o.physicalVerticalId) ?? 0) + 1);
  return [...observations].sort((a, b) => a.observationId.localeCompare(b.observationId)).map(observation => ({ observation, groupSize: sizes.get(observation.physicalVerticalId)! }));
}
function pseudoHuber(z: number, delta: number): number { return delta * delta * (Math.sqrt(1 + z*z/(delta*delta)) - 1); }
export function v3PseudoHuberDerivative(z: number, delta: number): number { return z / Math.sqrt(1 + z*z/(delta*delta)); }
export function v3RobustInfluence(z: number, delta: number): number { return 1 / Math.sqrt(1 + z*z/(delta*delta)); }

function evaluate(snapshot: V3ActiveV2Snapshot, admitted: readonly Admitted[], theta: V3Theta, config: V3SolverConfig, floorWeight = 1): Evaluation {
  const corners = floorCorners(snapshot); const annotation = orderedFloor(snapshot.sourceFloorPolygon);
  if (!corners || !annotation) return { valid: false, reason: "invalid_floor", floorResidualsPx: [], verticals: [], objective: Number.NaN, floorRmsPx: null, meanAbsGroupVerticalDeg: null };
  const floorResidualsPx: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const projected = v3ProjectIntrinsic(snapshot, theta, corners[i]); const observed = sourcePx(annotation[i], snapshot);
    if (!projected || !observed) return { valid: false, reason: "floor_cheirality", floorResidualsPx, verticals: [], objective: Number.NaN, floorRmsPx: null, meanAbsGroupVerticalDeg: null };
    floorResidualsPx.push(projected.x - observed.x, projected.y - observed.y);
  }
  const verticals: Array<Evaluation["verticals"][number]> = [];
  for (const { observation: o, groupSize } of admitted) {
    const lower = sourcePx(o.sourceNormalizedEndpoints.lower, snapshot); const upper = sourcePx(o.sourceNormalizedEndpoints.upper, snapshot);
    const anchor = v3ProjectIntrinsic(snapshot, theta, o.frozenWorldAnchor);
    const probe = v3ProjectIntrinsic(snapshot, theta, add(o.frozenWorldAnchor, { x: 0, y: 1, z: 0 }));
    if (!lower || !upper || !anchor || !probe) return { valid: false, reason: `prediction_invalid:${o.observationId}`, floorResidualsPx, verticals, objective: Number.NaN, floorRmsPx: null, meanAbsGroupVerticalDeg: null };
    const probeLength = Math.hypot(probe.x - anchor.x, probe.y - anchor.y);
    if (!finite(probeLength) || probeLength < 1e-9) return { valid: false, reason: `prediction_degenerate:${o.observationId}`, floorResidualsPx, verticals, objective: Number.NaN, floorRmsPx: null, meanAbsGroupVerticalDeg: null };
    const observedTiltRad = Math.atan2(upper.x - lower.x, lower.y - upper.y);
    const predictedTiltRad = Math.atan2(probe.x - anchor.x, anchor.y - probe.y);
    const residualRad = v3WrapToMinusPiPlusPi(observedTiltRad - predictedTiltRad);
    const z = residualRad / config.sigmaVerticalRad;
    verticals.push({ observationId: o.observationId, physicalVerticalId: o.physicalVerticalId, residualRad, observedTiltRad, predictedTiltRad, structuralWeight: 1/groupSize, robustInfluence: v3RobustInfluence(z, config.robustDelta) });
  }
  const f = floorResidualsPx.reduce((s, r) => s + r*r, 0) * 0.5 * floorWeight / (config.sigmaFloorPx * config.sigmaFloorPx);
  const v = verticals.reduce((s, r) => s + r.structuralWeight * pseudoHuber(r.residualRad / config.sigmaVerticalRad, config.robustDelta), 0);
  const p = 0.5 * ((theta.omegaXRad/config.sigmaOmegaRad)**2 + (theta.omegaZRad/config.sigmaOmegaRad)**2 +
    (theta.deltaTxM/config.sigmaTranslationM)**2 + (theta.deltaTyM/config.sigmaTranslationM)**2 + (theta.deltaTzM/config.sigmaTranslationM)**2);
  const rms = Math.sqrt(floorResidualsPx.reduce((s, r) => s + r*r, 0) / floorResidualsPx.length);
  const groupValues = new Map<string, number[]>();
  for (const x of verticals) { const a = groupValues.get(x.physicalVerticalId) ?? []; a.push(Math.abs(x.residualRad)); groupValues.set(x.physicalVerticalId, a); }
  const groupMeans = [...groupValues.values()].map(a => mean(a)!);
  return { valid: finite(f + v + p), reason: null, floorResidualsPx, verticals, objective: f + v + p, floorRmsPx: rms, meanAbsGroupVerticalDeg: mean(groupMeans)?.valueOf() === undefined ? null : mean(groupMeans)! * 180 / Math.PI };
}

/** Exact scalar robust objective used for LM step acceptance and experiments. */
export function v3EvaluateExactObjective(
  snapshot: V3ActiveV2Snapshot,
  observations: readonly V3CandidateObservation[],
  theta: V3Theta,
  config: V3SolverConfig = V3_SOLVER_CONFIG,
  floorWeight = 1
): Readonly<{ valid: boolean; objective: number; floorRmsPx: number | null; verticalResidualsRad: readonly number[]; robustInfluences: readonly number[] }> {
  const admitted = groupAdmitted(observations);
  const value = evaluate(snapshot, admitted, theta, config, floorWeight);
  return {
    valid: value.valid,
    objective: value.objective,
    floorRmsPx: value.floorRmsPx,
    verticalResidualsRad: value.verticals.map(x => x.residualRad),
    robustInfluences: value.verticals.map(x => x.robustInfluence),
  };
}

function rowsForLm(snapshot: V3ActiveV2Snapshot, admitted: readonly Admitted[], theta: V3Theta, config: V3SolverConfig, floorWeight: number): number[] | null {
  const e = evaluate(snapshot, admitted, theta, config, floorWeight); if (!e.valid) return null;
  const rows: number[] = [];
  for (const r of e.floorResidualsPx) rows.push(Math.sqrt(floorWeight) * r / config.sigmaFloorPx);
  for (const r of e.verticals) rows.push(Math.sqrt(r.structuralWeight * r.robustInfluence) * r.residualRad / config.sigmaVerticalRad);
  rows.push(theta.omegaXRad / config.sigmaOmegaRad, theta.omegaZRad / config.sigmaOmegaRad);
  rows.push(theta.deltaTxM / config.sigmaTranslationM, theta.deltaTyM / config.sigmaTranslationM, theta.deltaTzM / config.sigmaTranslationM);
  return rows;
}
function clampTheta(theta: V3Theta, config: V3SolverConfig): { theta: V3Theta; bounds: string[] } {
  const caps = [config.omegaBoundRad, config.omegaBoundRad, config.translationBoundM, config.translationBoundM, config.translationBoundM];
  const keys = ["omegaXRad", "omegaZRad", "deltaTxM", "deltaTyM", "deltaTzM"];
  const a = thetaArray(theta); const bounds: string[] = [];
  const c = a.map((v, i) => { const q = Math.max(-caps[i], Math.min(caps[i], v)); if (q !== v) bounds.push(`${keys[i]}:${v < 0 ? "min" : "max"}`); return q; });
  return { theta: thetaFrom(c), bounds };
}
function finalBounds(theta: V3Theta, config: V3SolverConfig): string[] {
  const caps = [config.omegaBoundRad, config.omegaBoundRad, config.translationBoundM, config.translationBoundM, config.translationBoundM];
  const keys = ["omegaXRad", "omegaZRad", "deltaTxM", "deltaTyM", "deltaTzM"];
  return thetaArray(theta).flatMap((value, index) =>
    Math.abs(Math.abs(value) - caps[index]) <= FINAL_BOUND_TOLERANCE ? [`${keys[index]}:${value < 0 ? "min" : "max"}`] : []
  );
}
function choleskySolve(a: number[][], b: number[]): number[] | null {
  const n = b.length; const l = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i += 1) for (let j = 0; j <= i; j += 1) {
    let s = a[i][j]; for (let k = 0; k < j; k += 1) s -= l[i][k]*l[j][k];
    if (i === j) { if (!finite(s) || s <= 1e-14) return null; l[i][j] = Math.sqrt(s); } else l[i][j] = s / l[j][j];
  }
  const y = Array(n).fill(0); for (let i = 0; i < n; i += 1) { let s = b[i]; for (let k = 0; k < i; k += 1) s -= l[i][k]*y[k]; y[i] = s/l[i][i]; }
  const x = Array(n).fill(0); for (let i = n-1; i >= 0; i -= 1) { let s = y[i]; for (let k = i+1; k < n; k += 1) s -= l[k][i]*x[k]; x[i] = s/l[i][i]; }
  return x.every(Number.isFinite) ? x : null;
}
type Optimization = Readonly<{ ok: boolean; theta: V3Theta; bounds: readonly string[]; reason: string; iterations: number; rejectedTrials: number; clampedTrialProposals: number; cheiralityRejected: boolean }>;
function optimize(snapshot: V3ActiveV2Snapshot, admitted: readonly Admitted[], config: V3SolverConfig, floorWeight: number): Optimization {
  let theta = ZERO_THETA; let lambda = 1e-3; let rejected = 0; let clampedTrialProposals = 0; let cheiralityRejected = false;
  const scales = [config.sigmaOmegaRad, config.sigmaOmegaRad, config.sigmaTranslationM, config.sigmaTranslationM, config.sigmaTranslationM];
  let current = evaluate(snapshot, admitted, theta, config, floorWeight);
  if (!current.valid) return { ok: false, theta, bounds: finalBounds(theta, config), reason: current.reason ?? "initial_invalid", iterations: 0, rejectedTrials: 0, clampedTrialProposals, cheiralityRejected: true };
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const baseRows = rowsForLm(snapshot, admitted, theta, config, floorWeight); if (!baseRows) return { ok: false, theta, bounds: finalBounds(theta, config), reason: "rows_invalid", iterations: iteration, rejectedTrials: rejected, clampedTrialProposals, cheiralityRejected };
    const jac = baseRows.map(() => Array(5).fill(0));
    for (let j = 0; j < 5; j += 1) {
      const a = thetaArray(theta); const plus = [...a]; const minus = [...a]; plus[j] += FD; minus[j] -= FD;
      const rp = rowsForLm(snapshot, admitted, thetaFrom(plus), config, floorWeight); const rm = rowsForLm(snapshot, admitted, thetaFrom(minus), config, floorWeight);
      if (!rp || !rm || rp.length !== baseRows.length || rm.length !== baseRows.length) return { ok: false, theta, bounds: finalBounds(theta, config), reason: "jacobian_invalid", iterations: iteration, rejectedTrials: rejected, clampedTrialProposals, cheiralityRejected: true };
      for (let r = 0; r < baseRows.length; r += 1) jac[r][j] = (rp[r] - rm[r]) / (2 * FD) * scales[j];
    }
    const h = Array.from({ length: 5 }, () => Array(5).fill(0)); const g = Array(5).fill(0);
    for (let r = 0; r < baseRows.length; r += 1) for (let i = 0; i < 5; i += 1) { g[i] += jac[r][i]*baseRows[r]; for (let j = 0; j < 5; j += 1) h[i][j] += jac[r][i]*jac[r][j]; }
    if (Math.max(...g.map(Math.abs)) < 1e-12) return { ok: true, theta, bounds: finalBounds(theta, config), reason: "scaled_gradient", iterations: iteration, rejectedTrials: rejected, clampedTrialProposals, cheiralityRejected };
    let accepted = false;
    while (lambda <= 1e10) {
      const damped = h.map((r, i) => r.map((v, j) => v + (i === j ? lambda * h[i][i] : 0)));
      const step = choleskySolve(damped, g.map(x => -x)); if (!step) { lambda *= 10; rejected += 1; continue; }
      if (Math.max(...step.map(Math.abs)) < 1e-10) return { ok: true, theta, bounds: finalBounds(theta, config), reason: "scaled_step", iterations: iteration, rejectedTrials: rejected, clampedTrialProposals, cheiralityRejected };
      const proposed = thetaArray(theta).map((v, i) => v + step[i] * scales[i]); const clamped = clampTheta(thetaFrom(proposed), config);
      if (clamped.bounds.length) clampedTrialProposals += 1;
      const trial = evaluate(snapshot, admitted, clamped.theta, config, floorWeight);
      if (!trial.valid) { cheiralityRejected = true; lambda *= 10; rejected += 1; continue; }
      const decrease = current.objective - trial.objective;
      if (decrease > 0) {
        theta = clamped.theta; current = trial; lambda /= 3; accepted = true;
        if (decrease / Math.max(1, Math.abs(current.objective)) < 1e-12) return { ok: true, theta, bounds: finalBounds(theta, config), reason: "relative_objective", iterations: iteration + 1, rejectedTrials: rejected, clampedTrialProposals, cheiralityRejected };
        break;
      }
      lambda *= 10; rejected += 1;
    }
    if (!accepted) return { ok: false, theta, bounds: finalBounds(theta, config), reason: "damping_limit", iterations: iteration + 1, rejectedTrials: rejected, clampedTrialProposals, cheiralityRejected };
  }
  return { ok: true, theta, bounds: finalBounds(theta, config), reason: "maximum_iterations", iterations: 100, rejectedTrials: rejected, clampedTrialProposals, cheiralityRejected };
}

function conditioning(snapshot: V3ActiveV2Snapshot, admitted: readonly Admitted[], config: V3SolverConfig): V3Conditioning | null {
  const rows: number[][] = [];
  for (const { observation, groupSize } of admitted) {
    const derivatives: number[] = [];
    for (const key of ["omegaXRad", "omegaZRad"] as const) {
      const plus = { ...ZERO_THETA, [key]: FD }; const minus = { ...ZERO_THETA, [key]: -FD };
      const a = evaluate(snapshot, [{ observation, groupSize }], plus, config); const b = evaluate(snapshot, [{ observation, groupSize }], minus, config);
      if (!a.valid || !b.valid || !a.verticals[0] || !b.verticals[0]) return null;
      derivatives.push((a.verticals[0].residualRad - b.verticals[0].residualRad) / (2*FD));
    }
    rows.push(derivatives.map(x => Math.sqrt(1/groupSize) * config.sigmaOmegaRad / config.sigmaVerticalRad * x));
  }
  let a = 0, b = 0, d = 0;
  for (const r of rows) { a += r[0]*r[0]; b += r[0]*r[1]; d += r[1]*r[1]; }
  const trace = a+d; const disc = Math.max(0, (a-d)*(a-d) + 4*b*b); const hi = Math.max(0, (trace + Math.sqrt(disc))/2); const lo = Math.max(0, (trace - Math.sqrt(disc))/2);
  const singular: [number, number] = [Math.sqrt(hi), Math.sqrt(lo)];
  return { singularValues: singular, passes: singular[1] >= config.conditioningMinSingularValue, observationIds: admitted.map(x => x.observation.observationId) };
}

export function v3AnalyzeBimodality(snapshot: V3ActiveV2Snapshot, admitted: readonly Admitted[], config = V3_SOLVER_CONFIG): V3Bimodality | null {
  const e = evaluate(snapshot, admitted, ZERO_THETA, config); if (!e.valid) return null;
  const values = new Map<string, number[]>();
  for (const x of e.verticals) { const a = values.get(x.physicalVerticalId) ?? []; a.push(x.residualRad * 180 / Math.PI); values.set(x.physicalVerticalId, a); }
  const sorted = [...values.entries()].map(([physicalVerticalId, v]) => ({ physicalVerticalId, residualDeg: mean(v)! }))
    .sort((a, b) => a.residualDeg - b.residualDeg || a.physicalVerticalId.localeCompare(b.physicalVerticalId));
  let gap = 0; let split: number | null = null;
  for (let i = 0; i < sorted.length - 1; i += 1) { const g = sorted[i+1].residualDeg - sorted[i].residualDeg; if (g > gap) { gap = g; split = i; } }
  const leftValues = split === null ? [] : sorted.slice(0, split+1).map(x => x.residualDeg); const rightValues = split === null ? [] : sorted.slice(split+1).map(x => x.residualDeg);
  const stats = (x: number[]) => { const med = median(x); const mad = med === null ? null : median(x.map(v => Math.abs(v-med))); return { count: x.length, meanDeg: mean(x), medianDeg: med, madDeg: mad }; };
  const left = stats(leftValues); const right = stats(rightValues);
  const gapPass = gap > config.bimodalGapDeg && gap > config.bimodalGapMadRatio * ((left.madDeg ?? 0) + (right.madDeg ?? 0) + config.bimodalEpsilonDeg);
  const verdict = !gapPass ? "unimodal" : left.count >= 2 && right.count >= 2 ? "bimodal" : "dispersed";
  const families = split === null ? [] : sorted.map((x, i) => ({ physicalVerticalId: x.physicalVerticalId, family: (i <= split ? "left" : "right") as "left" | "right" }));
  return { sortedGroupResidualsDeg: sorted, largestGapDeg: gap, splitIndex: split, verdict, families, left, right };
}

function canonical(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? value.toPrecision(17) : String(value);
  if (typeof value === "string" || typeof value === "boolean" || value === null) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return String(value);
}
function fingerprint(input: V3SolverInput, admitted: readonly Admitted[], config: V3SolverConfig): string {
  const payload = {
    contractVersion: V3_SOLVER_CONTRACT_VERSION, configVersion: V3_SOLVER_CONFIG_VERSION, config,
    activeV2: input.activeV2,
    admitted: admitted.map(x => x.observation).sort((a,b) => a.observationId.localeCompare(b.observationId)),
  };
  let h = 0x811c9dc5; const text = canonical(payload);
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return `v3fnv1a-${(h >>> 0).toString(16).padStart(8, "0")}`;
}
function emptyResult(input: V3SolverInput, status: V3PrimaryStatus, exclusions: V3Result["excludedObservations"] = []): V3Result {
  return { contractVersion: V3_SOLVER_CONTRACT_VERSION, configVersion: V3_SOLVER_CONFIG_VERSION, config: V3_SOLVER_CONFIG, status, safety: SAFETY,
    fingerprint: fingerprint(input, [], V3_SOLVER_CONFIG), warnings: [], excludedObservations: exclusions, admittedObservationIds: [], rawObservationCount: 0, distinctPhysicalVerticalCount: 0,
    conditioning: null, bimodality: null, crossBlock: null, initial: { objective: null, floorRmsPx: null }, final: { objective: null, floorRmsPx: null, meanAbsGroupVerticalDeg: null },
    candidatePose: null, theta: null, activeBounds: [], optimizer: { ran: false, convergenceReason: null, iterations: 0, rejectedTrials: 0, clampedTrialProposals: 0 },
    observations: [], groups: [], verticalOnlyProbe: { theta: null, floorRmsPx: null, outcome: "optimization_failed" }, exploratory: null };
}

/** Runs the bounded candidate experiment; its output is intentionally ephemeral. */
export function solveV3Candidate(input: V3SolverInput, config: V3SolverConfig = V3_SOLVER_CONFIG): V3Result {
  if (!input.activeV2 || !v3IntrinsicCamera(input.activeV2)) return emptyResult(input, "unavailable");
  const snapshot = input.activeV2;
  const exclusions: { observationId: string; reason: string }[] = [];
  const preliminary: V3CandidateObservation[] = [];
  for (const o of input.observations) { const reason = observationReason(o, snapshot); if (reason) exclusions.push({ observationId: o.observationId, reason }); else preliminary.push(o); }
  let admitted = groupAdmitted(preliminary);
  // Initial-pose prediction checks are admission checks, unlike trial-pose failures.
  const initialEligible: Admitted[] = [];
  for (const a of admitted) {
    const test = evaluate(snapshot, [a], ZERO_THETA, config);
    if (!test.valid) exclusions.push({ observationId: a.observation.observationId, reason: test.reason ?? "initial_prediction_invalid" }); else initialEligible.push(a);
  }
  admitted = groupAdmitted(initialEligible.map(x => x.observation));
  const rawCount = admitted.length; const groupsCount = new Set(admitted.map(x => x.observation.physicalVerticalId)).size;
  if (rawCount < 2 || groupsCount < 2) {
    const out = emptyResult(input, "insufficient_evidence", exclusions);
    return { ...out, fingerprint: fingerprint(input, admitted, config), rawObservationCount: rawCount, distinctPhysicalVerticalCount: groupsCount, admittedObservationIds: admitted.map(x => x.observation.observationId) };
  }
  const initial = evaluate(snapshot, admitted, ZERO_THETA, config);
  const condition = conditioning(snapshot, admitted, config);
  const bimodality = v3AnalyzeBimodality(snapshot, admitted, config);
  const baseWarnings: V3Warning[] = [];
  if (bimodality?.verdict === "dispersed") baseWarnings.push("dispersed_residuals");
  if (exclusions.some(x => x.reason.startsWith("prediction_"))) baseWarnings.push("prediction_excluded_observation");
  const initialGroups = groupDiagnostics(initial.verticals);
  if (initialGroups.some(x => x.residualRangeRad * 180 / Math.PI > config.duplicateDisagreementWarnDeg)) baseWarnings.push("duplicate_disagreement");
  if (!condition?.passes) {
    const out = emptyResult(input, "ill_conditioned", exclusions);
    return { ...out, config, fingerprint: fingerprint(input, admitted, config), warnings: baseWarnings, admittedObservationIds: admitted.map(x => x.observation.observationId), rawObservationCount: rawCount, distinctPhysicalVerticalCount: groupsCount, conditioning: condition, bimodality, initial: { objective: initial.objective, floorRmsPx: initial.floorRmsPx } };
  }
  const optimized = optimize(snapshot, admitted, config, 1);
  const final = optimized.ok ? evaluate(snapshot, admitted, optimized.theta, config) : initial;
  const verticalOptimization = optimize(snapshot, admitted, config, 0);
  const verticalEval = verticalOptimization.ok ? evaluate(snapshot, admitted, verticalOptimization.theta, config) : null;
  if (optimized.cheiralityRejected) baseWarnings.push("cheirality_constrained");
  const crossBlock = crossBlockDiagnostic({ bimodality, optimized, verticalOptimization, initial, verticalEval, config });
  if (crossBlock?.evaluated && crossBlock.tension) baseWarnings.push("cross_block_tension");
  if (crossBlock?.evaluated && crossBlock.unresolved) baseWarnings.push("cross_block_unresolved");
  const groups = groupDiagnostics(final.verticals);
  const theta = optimized.ok ? optimized.theta : null;
  const noOp = theta ? v3IsNoOpByInfinityNorm(theta, config) : false;
  const outcome: V3ExploratoryOutcome = !optimized.ok ? "optimization_failed" : optimized.bounds.length ? "bounded_converged" : noOp ? "negligible_delta" : "interior_converged";
  let status: V3PrimaryStatus;
  let candidatePose: V3CandidatePose | null = null;
  let exploratory: V3Result["exploratory"] = null;
  if (bimodality?.verdict === "bimodal") {
    status = "incompatible_evidence";
    exploratory = { outcome, pose: theta ? v3CandidatePose(snapshot, theta) : null, theta };
  } else if (!optimized.ok) status = "optimization_failed";
  else if (optimized.bounds.length) { status = "candidate_bounded"; candidatePose = v3CandidatePose(snapshot, optimized.theta); }
  else if (noOp) { status = "no_op"; candidatePose = v3CandidatePose(snapshot, optimized.theta); }
  else { status = "candidate_ready"; candidatePose = v3CandidatePose(snapshot, optimized.theta); }
  return {
    contractVersion: V3_SOLVER_CONTRACT_VERSION, configVersion: V3_SOLVER_CONFIG_VERSION, config, status, safety: SAFETY, fingerprint: fingerprint(input, admitted, config),
    warnings: [...new Set(baseWarnings)].sort(), excludedObservations: exclusions.sort((a,b) => a.observationId.localeCompare(b.observationId)), admittedObservationIds: admitted.map(x => x.observation.observationId),
    rawObservationCount: rawCount, distinctPhysicalVerticalCount: groupsCount, conditioning: condition, bimodality, crossBlock, initial: { objective: initial.objective, floorRmsPx: initial.floorRmsPx },
    final: { objective: final.objective, floorRmsPx: final.floorRmsPx, meanAbsGroupVerticalDeg: final.meanAbsGroupVerticalDeg }, candidatePose, theta, activeBounds: optimized.bounds,
    optimizer: { ran: true, convergenceReason: optimized.reason, iterations: optimized.iterations, rejectedTrials: optimized.rejectedTrials, clampedTrialProposals: optimized.clampedTrialProposals },
    observations: final.verticals.map(x => ({ observationId: x.observationId, physicalVerticalId: x.physicalVerticalId, residualRad: x.residualRad, robustInfluence: x.robustInfluence })),
    groups, verticalOnlyProbe: { theta: verticalOptimization.ok ? verticalOptimization.theta : null, floorRmsPx: verticalEval?.floorRmsPx ?? null, outcome: !verticalOptimization.ok ? "optimization_failed" : verticalOptimization.bounds.length ? "bounded_converged" : "interior_converged" },
    exploratory,
  };
}

function crossBlockDiagnostic(input: Readonly<{
  bimodality: V3Bimodality | null;
  optimized: Optimization;
  verticalOptimization: Optimization;
  initial: Evaluation;
  verticalEval: Evaluation | null;
  config: V3SolverConfig;
}>): V3CrossBlockDiagnostic {
  if (input.bimodality?.verdict === "bimodal") return { evaluated: false, reason: "bimodal_evidence" };
  if (!input.optimized.ok) return { evaluated: false, reason: "optimization_failed" };
  if (!input.verticalOptimization.ok || !input.verticalEval?.valid) return { evaluated: false, reason: "probe_unavailable" };
  const floorRmsAtV2Px = input.initial.floorRmsPx;
  const floorRmsAtProbePx = input.verticalEval.floorRmsPx;
  const verticalMeanAbsAtV2Deg = input.initial.meanAbsGroupVerticalDeg;
  const verticalMeanAbsAtProbeDeg = input.verticalEval.meanAbsGroupVerticalDeg;
  if (
    floorRmsAtV2Px === null ||
    floorRmsAtProbePx === null ||
    verticalMeanAbsAtV2Deg === null ||
    verticalMeanAbsAtProbeDeg === null
  ) {
    return { evaluated: false, reason: "probe_unavailable" };
  }
  const probeVerticalImprovementDeg = verticalMeanAbsAtV2Deg - verticalMeanAbsAtProbeDeg;
  const probeFloorCostPx = floorRmsAtProbePx - floorRmsAtV2Px;
  const tension =
    probeVerticalImprovementDeg >= input.config.tensionMinVerticalImprovementDeg &&
    probeFloorCostPx >= input.config.tensionMinFloorCostPx;
  const unresolved = tension && probeFloorCostPx >= input.config.unresolvedMinFloorCostPx;
  return {
    evaluated: true,
    floorRmsAtV2Px: diagnosticNumber(floorRmsAtV2Px),
    floorRmsAtProbePx: diagnosticNumber(floorRmsAtProbePx),
    verticalMeanAbsAtV2Deg: diagnosticNumber(verticalMeanAbsAtV2Deg),
    verticalMeanAbsAtProbeDeg: diagnosticNumber(verticalMeanAbsAtProbeDeg),
    probeVerticalImprovementDeg: diagnosticNumber(probeVerticalImprovementDeg),
    probeFloorCostPx: diagnosticNumber(probeFloorCostPx),
    tension,
    unresolved,
  };
}

function groupDiagnostics(verticals: readonly Evaluation["verticals"][number][]): V3Result["groups"] {
  const all = new Map<string, typeof verticals>();
  for (const v of verticals) all.set(v.physicalVerticalId, [...(all.get(v.physicalVerticalId) ?? []), v]);
  return [...all.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([physicalVerticalId, values]) => {
    const rs = values.map(v => v.residualRad); return { physicalVerticalId, meanResidualRad: mean(rs)!, residualRangeRad: Math.max(...rs) - Math.min(...rs), observationIds: values.map(v => v.observationId).sort() };
  });
}

