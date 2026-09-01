import {
  EMPTY_ORIGINAL_REGISTRATION_REASON,
  REGISTRATION_DIAGNOSTIC_SCALE_ABS_MAX,
  REGISTRATION_DIAGNOSTIC_TX_ABS_MAX,
  REGISTRATION_DIAGNOSTIC_TY_ABS_MAX,
  REGISTRATION_MAX_IDENTITY_RESIDUAL,
  REGISTRATION_MAX_RIDGE_ORIENTATION_DELTA_RAD,
  REGISTRATION_MAX_RMS_RESIDUAL,
  REGISTRATION_MIN_ANCHOR_SEPARATION,
  REGISTRATION_MIN_HULL_AREA,
  REGISTRATION_MIN_INLIER_FRACTION,
  REGISTRATION_MIN_ORIENTATION_BINS,
  REGISTRATION_MIN_PARALLEL_RIDGE_SEPARATION,
  REGISTRATION_MIN_POINT_ANCHORS,
  REGISTRATION_MIN_QUADRANT_COUNT,
  REGISTRATION_MIN_RIDGE_MATCH_FRACTION,
  REGISTRATION_MIN_RIDGE_MATCHED_SAMPLES,
  REGISTRATION_MIN_RIDGE_SUPPORT_FOR_ANCHOR_ZOOM,
  REGISTRATION_MIN_SAME_OBJECT_ANCHORS,
  REGISTRATION_MIN_SECOND_PCA_RATIO,
  REGISTRATION_QUADRANT_CENTER_INSET,
  type EmptyOriginalDiagnosticSimilarity,
  type EmptyOriginalFittedLine,
  type EmptyOriginalNormalizedUv,
  type EmptyOriginalRegistrationCorrespondence,
  type EmptyOriginalRegistrationEvidenceClass,
  type EmptyOriginalRegistrationEvidenceStatus,
  type EmptyOriginalRegistrationZoomLockConfiguration,
  type EmptyOriginalRidgeSampleDiagnostics,
} from "./empty-original-registration-authority-contract";

export type IdentityResidual = Readonly<{
  du: number;
  dv: number;
  r: number;
}>;

export function identityResidual(
  empty: EmptyOriginalNormalizedUv,
  original: EmptyOriginalNormalizedUv,
): IdentityResidual {
  const du = empty.u - original.u;
  const dv = empty.v - original.v;
  return { du, dv, r: Math.hypot(du, dv) };
}

export function correspondenceResiduals(
  pairs: readonly Readonly<{
    empty: EmptyOriginalNormalizedUv;
    original: EmptyOriginalNormalizedUv;
  }>[],
): Readonly<{ max: number; rms: number; maxAbsU: number; maxAbsV: number }> {
  if (pairs.length === 0) {
    return { max: 0, rms: 0, maxAbsU: 0, maxAbsV: 0 };
  }
  let max = 0;
  let sumSq = 0;
  let maxAbsU = 0;
  let maxAbsV = 0;
  for (const pair of pairs) {
    const residual = identityResidual(pair.empty, pair.original);
    max = Math.max(max, residual.r);
    sumSq += residual.r * residual.r;
    maxAbsU = Math.max(maxAbsU, Math.abs(residual.du));
    maxAbsV = Math.max(maxAbsV, Math.abs(residual.dv));
  }
  return {
    max,
    rms: Math.sqrt(sumSq / pairs.length),
    maxAbsU,
    maxAbsV,
  };
}

export function unitTangent(
  from: EmptyOriginalNormalizedUv,
  to: EmptyOriginalNormalizedUv,
): EmptyOriginalNormalizedUv | null {
  const du = to.u - from.u;
  const dv = to.v - from.v;
  const length = Math.hypot(du, dv);
  if (!(length > 1e-18)) return null;
  return { u: du / length, v: dv / length };
}

export function perpendicular(
  tangent: EmptyOriginalNormalizedUv,
): EmptyOriginalNormalizedUv {
  const length = Math.hypot(tangent.u, tangent.v);
  if (!(length > 1e-18)) return { u: 1, v: 0 };
  return { u: -tangent.v / length, v: tangent.u / length };
}

/**
 * Acute angle between undirected line orientations. Period π, result in [0, π/2].
 */
export function acuteAngle(thetaA: number, thetaB: number): number {
  let delta = Math.abs(thetaA - thetaB) % Math.PI;
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return delta;
}

export function fittedHesseLine(
  points: readonly EmptyOriginalNormalizedUv[],
): EmptyOriginalFittedLine | null {
  if (points.length < 2 || !points.every((point) => Number.isFinite(point.u) && Number.isFinite(point.v))) {
    return null;
  }
  const origin = {
    u: points.reduce((sum, point) => sum + point.u, 0) / points.length,
    v: points.reduce((sum, point) => sum + point.v, 0) / points.length,
  };
  const covariance = points.reduce((sum, point) => {
    const u = point.u - origin.u;
    const v = point.v - origin.v;
    return { uu: sum.uu + u * u, uv: sum.uv + u * v, vv: sum.vv + v * v };
  }, { uu: 0, uv: 0, vv: 0 });
  const spread = covariance.uu + covariance.vv;
  if (!(spread > 1e-12)) return null;
  const angle = 0.5 * Math.atan2(2 * covariance.uv, covariance.uu - covariance.vv);
  const direction = { u: Math.cos(angle), v: Math.sin(angle) };
  const normal = perpendicular(direction);
  const theta = Math.atan2(normal.v, normal.u);
  const rho = origin.u * Math.cos(theta) + origin.v * Math.sin(theta);
  return { theta, rho, origin, direction };
}

export function signedNormalResidual(
  empty: EmptyOriginalNormalizedUv,
  original: EmptyOriginalNormalizedUv,
  tangent: EmptyOriginalNormalizedUv,
): number {
  const normal = perpendicular(tangent);
  return (original.u - empty.u) * normal.u + (original.v - empty.v) * normal.v;
}

export function signedTangentResidual(
  empty: EmptyOriginalNormalizedUv,
  original: EmptyOriginalNormalizedUv,
  tangent: EmptyOriginalNormalizedUv,
): number {
  const unit = unitTangent({ u: 0, v: 0 }, tangent) ?? tangent;
  return (original.u - empty.u) * unit.u + (original.v - empty.v) * unit.v;
}

export function detectBimodalOffsets(
  values: readonly number[],
  gap = REGISTRATION_MAX_IDENTITY_RESIDUAL,
): boolean {
  if (values.length < 4) return false;
  const sorted = [...values].sort((left, right) => left - right);
  let bestGap = 0;
  let split = -1;
  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index]! - sorted[index - 1]!;
    if (current > bestGap) {
      bestGap = current;
      split = index;
    }
  }
  if (bestGap <= gap || split < 0) return false;
  const left = split;
  const right = sorted.length - split;
  return left >= 2 &&
    right >= 2 &&
    left / sorted.length >= 0.3 &&
    right / sorted.length >= 0.3;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function rms(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sumSq = values.reduce((sum, value) => sum + value * value, 0);
  return Math.sqrt(sumSq / values.length);
}

export function variance(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sumSq = values.reduce((sum, value) => {
    const d = value - mean;
    return sum + d * d;
  }, 0);
  return sumSq / values.length;
}

export type HybridSampleMatch = Readonly<{
  priorId: string;
  structureId: string;
  parentStructureId: string | null;
  structureKind: string;
  evidenceClass: EmptyOriginalRegistrationEvidenceClass;
  empty: EmptyOriginalNormalizedUv;
  tangent: EmptyOriginalNormalizedUv | null;
  emptyLine: EmptyOriginalFittedLine | null;
  original: EmptyOriginalNormalizedUv | null;
  originalLine: EmptyOriginalFittedLine | null;
  ncc: number | null;
  pointResidual: IdentityResidual | null;
  normalResidual: number | null;
  orientationResidual: number | null;
  tangentDiagnostic: number | null;
  tangentLocalization: "localized" | "ambiguous" | "not_applicable";
  displaySnapped: boolean;
  matched: boolean;
}>;

export function aggregateHybridEvidenceUnits(
  samples: readonly HybridSampleMatch[],
): EmptyOriginalRegistrationCorrespondence[] {
  const groups = new Map<string, HybridSampleMatch[]>();
  for (const sample of samples) {
    const key = `${sample.evidenceClass}:${sample.structureId}`;
    const list = groups.get(key) ?? [];
    list.push(sample);
    groups.set(key, list);
  }
  const units: EmptyOriginalRegistrationCorrespondence[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    if (first.evidenceClass === "point_anchor") {
      units.push(aggregatePointAnchor(group));
    } else {
      units.push(aggregateRidgeStructure(group));
    }
  }
  return units;
}

export function aggregatePointAnchor(
  samples: readonly HybridSampleMatch[],
): EmptyOriginalRegistrationCorrespondence {
  const first = samples[0]!;
  const matched = samples.filter((sample) => sample.matched && sample.original && sample.pointResidual);
  if (matched.length === 0) {
    return unitFromSample(first, "no_match", false, null);
  }
  const representative = matched[0]!;
  const residual = representative.pointResidual!.r;
  const status: EmptyOriginalRegistrationEvidenceStatus =
    residual <= REGISTRATION_MAX_IDENTITY_RESIDUAL ? "inlier" : "contradiction";
  return unitFromSample(
    representative,
    status,
    status === "inlier",
    residual,
  );
}

export function aggregateRidgeStructure(
  samples: readonly HybridSampleMatch[],
): EmptyOriginalRegistrationCorrespondence {
  const first = samples[0]!;
  const matched = samples.filter((sample) =>
    sample.matched && sample.normalResidual !== null
  );
  const normals = matched.map((sample) => sample.normalResidual!);
  const orientations = matched
    .map((sample) => sample.orientationResidual)
    .filter((value): value is number => value !== null);
  const bimodal = detectBimodalOffsets(normals);
  const diagnostics: EmptyOriginalRidgeSampleDiagnostics = {
    sampleCount: samples.length,
    matchedSampleCount: matched.length,
    medianNormalResidual: median(normals.map((value) => Math.abs(value))),
    maxNormalResidual: normals.length === 0 ? null : Math.max(...normals.map((value) => Math.abs(value))),
    rmsNormalResidual: rms(normals),
    orientationResidual: median(orientations),
    normalResidualVariance: variance(normals),
    bimodalOffsetDetected: bimodal,
  };
  const sufficient = matched.length >= REGISTRATION_MIN_RIDGE_MATCHED_SAMPLES &&
    matched.length / samples.length >= REGISTRATION_MIN_RIDGE_MATCH_FRACTION;
  let status: EmptyOriginalRegistrationEvidenceStatus = "no_match";
  if (!sufficient) {
    status = "no_match";
  } else if (bimodal) {
    status = "ambiguous";
  } else if (
    (diagnostics.maxNormalResidual ?? 0) > REGISTRATION_MAX_IDENTITY_RESIDUAL
  ) {
    status = "contradiction";
  } else if (
    diagnostics.orientationResidual !== null &&
    diagnostics.orientationResidual > REGISTRATION_MAX_RIDGE_ORIENTATION_DELTA_RAD
  ) {
    status = "contradiction";
  } else if (
    (diagnostics.rmsNormalResidual ?? 0) > REGISTRATION_MAX_RMS_RESIDUAL
  ) {
    status = "ambiguous";
  } else {
    status = "inlier";
  }
  const originalLine = first.emptyLine && diagnostics.medianNormalResidual !== null
    ? offsetLine(first.emptyLine, median(normals) ?? 0)
    : matched[0]?.originalLine ?? null;
  const representativeEmpty = centroid(samples.map((sample) => sample.empty));
  const normalSigned = median(normals);
  return Object.freeze({
    priorId: first.structureId,
    structureId: first.structureId,
    parentStructureId: first.parentStructureId,
    structureKind: first.structureKind,
    kind: "ridge_normal" as const,
    empty: representativeEmpty,
    original: null,
    residual: diagnostics.maxNormalResidual,
    inlier: status === "inlier",
    status,
    emptyLine: first.emptyLine,
    originalLine,
    pointResidual: null,
    ridgeResidual: Object.freeze({
      normal: normalSigned ?? diagnostics.maxNormalResidual ?? 0,
      orientation: diagnostics.orientationResidual,
      tangentDiagnostic: null,
    }),
    tangentLocalization: "ambiguous" as const,
    sampleDiagnostics: Object.freeze(diagnostics),
    displaySnapped: false,
  });
}

function unitFromSample(
  sample: HybridSampleMatch,
  status: EmptyOriginalRegistrationEvidenceStatus,
  inlier: boolean,
  residual: number | null,
): EmptyOriginalRegistrationCorrespondence {
  return Object.freeze({
    priorId: sample.priorId,
    structureId: sample.structureId,
    parentStructureId: sample.parentStructureId,
    structureKind: sample.structureKind,
    kind: sample.evidenceClass,
    empty: sample.empty,
    original: sample.original,
    residual,
    inlier,
    status,
    emptyLine: sample.emptyLine,
    originalLine: sample.originalLine,
    pointResidual: sample.pointResidual
      ? Object.freeze({
        du: sample.pointResidual.du,
        dv: sample.pointResidual.dv,
        magnitude: sample.pointResidual.r,
      })
      : null,
    ridgeResidual: null,
    tangentLocalization: sample.tangentLocalization,
    sampleDiagnostics: null,
    displaySnapped: sample.displaySnapped,
  });
}

function offsetLine(
  line: EmptyOriginalFittedLine,
  signedNormal: number,
): EmptyOriginalFittedLine {
  const normal = { u: Math.cos(line.theta), v: Math.sin(line.theta) };
  return {
    theta: line.theta,
    rho: line.rho + signedNormal,
    origin: {
      u: line.origin.u + normal.u * signedNormal,
      v: line.origin.v + normal.v * signedNormal,
    },
    direction: line.direction,
  };
}

function centroid(
  points: readonly EmptyOriginalNormalizedUv[],
): EmptyOriginalNormalizedUv {
  if (points.length === 0) return { u: 0.5, v: 0.5 };
  return {
    u: points.reduce((sum, point) => sum + point.u, 0) / points.length,
    v: points.reduce((sum, point) => sum + point.v, 0) / points.length,
  };
}

export function quadrantCount(
  points: readonly EmptyOriginalNormalizedUv[],
): number {
  const seen = new Set<string>();
  for (const point of points) {
    if (
      Math.max(Math.abs(point.u - 0.5), Math.abs(point.v - 0.5)) <
        REGISTRATION_QUADRANT_CENTER_INSET
    ) {
      continue;
    }
    const x = point.u >= 0.5 ? "r" : "l";
    const y = point.v >= 0.5 ? "b" : "t";
    seen.add(`${x}${y}`);
  }
  return seen.size;
}

export function convexHullArea(
  points: readonly EmptyOriginalNormalizedUv[],
): number {
  const hull = convexHull(points);
  if (hull.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < hull.length; index += 1) {
    const current = hull[index]!;
    const next = hull[(index + 1) % hull.length]!;
    area += current.u * next.v - next.u * current.v;
  }
  return Math.abs(area) / 2;
}

export function pcaEigenvalueRatio(
  points: readonly EmptyOriginalNormalizedUv[],
): number {
  if (points.length < 2) return 0;
  let meanU = 0;
  let meanV = 0;
  for (const point of points) {
    meanU += point.u;
    meanV += point.v;
  }
  meanU /= points.length;
  meanV /= points.length;
  let cuu = 0;
  let cvv = 0;
  let cuv = 0;
  for (const point of points) {
    const du = point.u - meanU;
    const dv = point.v - meanV;
    cuu += du * du;
    cvv += dv * dv;
    cuv += du * dv;
  }
  const n = points.length;
  cuu /= n;
  cvv /= n;
  cuv /= n;
  const trace = cuu + cvv;
  const det = cuu * cvv - cuv * cuv;
  const disc = Math.max(0, trace * trace - 4 * det);
  const lambda1 = (trace + Math.sqrt(disc)) / 2;
  const lambda2 = (trace - Math.sqrt(disc)) / 2;
  if (!(lambda1 > 1e-18)) return 0;
  return Math.max(0, lambda2) / lambda1;
}

export function spreadAcceptable(
  points: readonly EmptyOriginalNormalizedUv[],
): Readonly<{
  ok: boolean;
  quadrantCount: number;
  hullArea: number;
  secondPcaRatio: number;
}> {
  const quadrants = quadrantCount(points);
  const hullArea = convexHullArea(points);
  const secondPcaRatio = pcaEigenvalueRatio(points);
  return {
    ok:
      (quadrants >= REGISTRATION_MIN_QUADRANT_COUNT ||
        hullArea >= REGISTRATION_MIN_HULL_AREA) &&
      secondPcaRatio >= REGISTRATION_MIN_SECOND_PCA_RATIO,
    quadrantCount: quadrants,
    hullArea,
    secondPcaRatio,
  };
}

/**
 * Uniform scale + translation diagnostic. Never applied as authority.
 * Consumes Class A raw anchors only. Do not feed ridge points with copied
 * tangent coordinates.
 */
export function fitDiagnosticSimilarity(
  pairs: readonly Readonly<{
    empty: EmptyOriginalNormalizedUv;
    original: EmptyOriginalNormalizedUv;
  }>[],
): EmptyOriginalDiagnosticSimilarity | null {
  if (pairs.length < 2) return null;
  let meanEu = 0;
  let meanEv = 0;
  let meanOu = 0;
  let meanOv = 0;
  for (const pair of pairs) {
    meanEu += pair.empty.u;
    meanEv += pair.empty.v;
    meanOu += pair.original.u;
    meanOv += pair.original.v;
  }
  const n = pairs.length;
  meanEu /= n;
  meanEv /= n;
  meanOu /= n;
  meanOv /= n;
  let numerator = 0;
  let denominator = 0;
  for (const pair of pairs) {
    const deu = pair.empty.u - meanEu;
    const dev = pair.empty.v - meanEv;
    numerator += deu * (pair.original.u - meanOu) + dev * (pair.original.v - meanOv);
    denominator += deu * deu + dev * dev;
  }
  if (!(denominator > 1e-18)) return null;
  const scale = numerator / denominator;
  const tx = meanOu - scale * meanEu;
  const ty = meanOv - scale * meanEv;
  if (![scale, tx, ty].every(Number.isFinite)) return null;
  return {
    scale,
    tx,
    ty,
    scaleAbsFromIdentity: Math.abs(scale - 1),
    txAbs: Math.abs(tx),
    tyAbs: Math.abs(ty),
    input: "class_a_raw_anchors",
  };
}

export function diagnosticSimilarityIsIdentity(
  similarity: EmptyOriginalDiagnosticSimilarity | null,
): boolean {
  if (!similarity) return false;
  return similarity.scaleAbsFromIdentity <= REGISTRATION_DIAGNOSTIC_SCALE_ABS_MAX &&
    similarity.txAbs <= REGISTRATION_DIAGNOSTIC_TX_ABS_MAX &&
    similarity.tyAbs <= REGISTRATION_DIAGNOSTIC_TY_ABS_MAX;
}

export type ZoomLockEvaluation = Readonly<{
  satisfied: boolean;
  configuration: EmptyOriginalRegistrationZoomLockConfiguration;
}>;

export function evaluateZoomLock(
  units: readonly EmptyOriginalRegistrationCorrespondence[],
): ZoomLockEvaluation {
  const anchors = units.filter((unit) =>
    unit.kind === "point_anchor" && unit.status === "inlier"
  );
  const ridges = units.filter((unit) =>
    unit.kind === "ridge_normal" && unit.status === "inlier"
  );
  if (anchorZoomLockSatisfied(anchors) &&
    ridges.length >= REGISTRATION_MIN_RIDGE_SUPPORT_FOR_ANCHOR_ZOOM
  ) {
    return { satisfied: true, configuration: "anchors_plus_ridges" };
  }
  if (parallelPairPlusNonparallel(ridges)) {
    return { satisfied: true, configuration: "parallel_pair_plus_nonparallel" };
  }
  return { satisfied: false, configuration: "unsatisfied" };
}

export function orientationBinCount(
  ridges: readonly EmptyOriginalRegistrationCorrespondence[],
): number {
  const thetas: number[] = [];
  for (const ridge of ridges) {
    const theta = ridge.emptyLine?.theta ?? ridge.ridgeResidual?.orientation;
    if (theta === null || theta === undefined) continue;
    let assigned = false;
    for (const existing of thetas) {
      if (acuteAngle(existing, theta) <= REGISTRATION_MAX_RIDGE_ORIENTATION_DELTA_RAD) {
        assigned = true;
        break;
      }
    }
    if (!assigned) thetas.push(theta);
  }
  return thetas.length;
}

export function diagnosticRidgeScaleFromParallelPair(
  units: readonly EmptyOriginalRegistrationCorrespondence[],
): number | null {
  const ridges = units.filter((unit) =>
    unit.kind === "ridge_normal" &&
    unit.status === "inlier" &&
    unit.emptyLine
  );
  let best: { emptySep: number; originalSep: number } | null = null;
  for (let i = 0; i < ridges.length; i += 1) {
    for (let j = i + 1; j < ridges.length; j += 1) {
      const a = ridges[i]!;
      const b = ridges[j]!;
      if (acuteAngle(a.emptyLine!.theta, b.emptyLine!.theta) >
        REGISTRATION_MAX_RIDGE_ORIENTATION_DELTA_RAD
      ) {
        continue;
      }
      const emptySep = Math.abs(a.emptyLine!.rho - b.emptyLine!.rho);
      if (emptySep < REGISTRATION_MIN_PARALLEL_RIDGE_SEPARATION) continue;
      const aOffset = a.ridgeResidual?.normal ?? 0;
      const bOffset = b.ridgeResidual?.normal ?? 0;
      const originalSep = Math.abs(
        (a.emptyLine!.rho + aOffset) - (b.emptyLine!.rho + bOffset),
      );
      if (!best || emptySep > best.emptySep) {
        best = { emptySep, originalSep };
      }
    }
  }
  if (!best || !(best.emptySep > 1e-9)) return null;
  return best.originalSep / best.emptySep;
}

function anchorZoomLockSatisfied(
  anchors: readonly EmptyOriginalRegistrationCorrespondence[],
): boolean {
  if (anchors.length < REGISTRATION_MIN_POINT_ANCHORS) return false;
  const parents = new Set(
    anchors.map((anchor) => anchor.parentStructureId).filter((id): id is string => !!id),
  );
  const allSameObject = parents.size === 1 &&
    anchors.every((anchor) => anchor.parentStructureId === [...parents][0]);
  const required = allSameObject
    ? REGISTRATION_MIN_SAME_OBJECT_ANCHORS
    : REGISTRATION_MIN_POINT_ANCHORS;
  if (anchors.length < required) return false;
  return hasSeparatedPair(anchors.map((anchor) => anchor.empty), REGISTRATION_MIN_ANCHOR_SEPARATION);
}

function parallelPairPlusNonparallel(
  ridges: readonly EmptyOriginalRegistrationCorrespondence[],
): boolean {
  if (ridges.length < 3 && ridges.filter((ridge) => ridge.emptyLine).length < 2) {
    return false;
  }
  for (let i = 0; i < ridges.length; i += 1) {
    for (let j = i + 1; j < ridges.length; j += 1) {
      const a = ridges[i]!;
      const b = ridges[j]!;
      if (!a.emptyLine || !b.emptyLine) continue;
      if (acuteAngle(a.emptyLine.theta, b.emptyLine.theta) >
        REGISTRATION_MAX_RIDGE_ORIENTATION_DELTA_RAD
      ) {
        continue;
      }
      if (
        Math.hypot(a.empty.u - b.empty.u, a.empty.v - b.empty.v) <
          REGISTRATION_MIN_PARALLEL_RIDGE_SEPARATION
      ) {
        continue;
      }
      const familyTheta = a.emptyLine.theta;
      const orthogonal = ridges.some((ridge) =>
        ridge.emptyLine &&
        acuteAngle(ridge.emptyLine.theta, familyTheta) >
          REGISTRATION_MAX_RIDGE_ORIENTATION_DELTA_RAD
      );
      if (orthogonal) return true;
    }
  }
  return false;
}

function hasSeparatedPair(
  points: readonly EmptyOriginalNormalizedUv[],
  minDistance: number,
): boolean {
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      if (
        Math.hypot(points[i]!.u - points[j]!.u, points[i]!.v - points[j]!.v) >=
          minDistance
      ) {
        return true;
      }
    }
  }
  return false;
}

export type HybridGateEvaluation = Readonly<{
  accepted: boolean;
  inlierCount: number;
  attemptedCount: number;
  inlierFraction: number;
  outlierCount: number;
  contradictionCount: number;
  ambiguousCount: number;
  anchorCount: number;
  anchorInlierCount: number;
  ridgeStructureCount: number;
  ridgeInlierCount: number;
  independentEvidenceUnitCount: number;
  attemptedEvidenceUnitCount: number;
  orientationBinCount: number;
  zoomLock: ZoomLockEvaluation;
  residuals: Readonly<{
    max: number | null;
    rms: number | null;
    maxAbsU: number | null;
    maxAbsV: number | null;
    anchorMax: number | null;
    anchorRms: number | null;
    ridgeNormalMax: number | null;
    ridgeNormalRms: number | null;
    diagnosticSimilarity: EmptyOriginalDiagnosticSimilarity | null;
    diagnosticRidgeScale: number | null;
    diagnosticRidgeScaleAbsFromIdentity: number | null;
  }>;
  spread: ReturnType<typeof spreadAcceptable>;
  reasons: readonly string[];
  inlierCorrespondences: readonly EmptyOriginalRegistrationCorrespondence[];
}>;

/**
 * Hybrid identity gates. A confidently matched-wrong structure is a
 * contradiction and cannot be outvoted. One-outlier dropping is intentionally
 * absent.
 */
export function evaluateHybridRegistrationGates(
  units: readonly EmptyOriginalRegistrationCorrespondence[],
  spreadSamples: readonly EmptyOriginalNormalizedUv[],
): HybridGateEvaluation {
  const attempted = units;
  const inliers = units.filter((unit) => unit.status === "inlier");
  const contradictions = units.filter((unit) => unit.status === "contradiction");
  const ambiguous = units.filter((unit) => unit.status === "ambiguous");
  const anchors = units.filter((unit) => unit.kind === "point_anchor");
  const ridges = units.filter((unit) => unit.kind === "ridge_normal");
  const anchorInliers = inliers.filter((unit) => unit.kind === "point_anchor");
  const ridgeInliers = inliers.filter((unit) => unit.kind === "ridge_normal");
  const attemptedCount = attempted.length;
  const inlierCount = inliers.length;
  const inlierFraction = attemptedCount > 0 ? inlierCount / attemptedCount : 0;
  const zoomLock = evaluateZoomLock(units);
  const bins = orientationBinCount(ridgeInliers);
  const spread = spreadAcceptable(spreadSamples);
  const anchorPairs = anchorInliers.flatMap((unit) =>
    unit.original
      ? [{ empty: unit.empty, original: unit.original }]
      : []
  );
  const diagnosticSimilarity = fitDiagnosticSimilarity(anchorPairs);
  const diagnosticRidgeScale = diagnosticRidgeScaleFromParallelPair(units);
  const anchorResiduals = correspondenceResiduals(anchorPairs);
  const ridgeMax = ridgeInliers.length === 0
    ? null
    : Math.max(
      ...ridgeInliers.map((unit) => unit.sampleDiagnostics?.maxNormalResidual ??
        Math.abs(unit.ridgeResidual?.normal ?? 0)),
    );
  const ridgeRms = ridgeInliers.length === 0
    ? null
    : rms(
      ridgeInliers.map((unit) => unit.sampleDiagnostics?.rmsNormalResidual ??
        Math.abs(unit.ridgeResidual?.normal ?? 0)),
    );
  const reasons: string[] = [];
  if (contradictions.some((unit) => unit.kind === "ridge_normal")) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.ridgeNormalContradiction);
  }
  if (contradictions.some((unit) => unit.kind === "point_anchor")) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.pointAnchorContradiction);
  }
  if (ambiguous.some((unit) => unit.sampleDiagnostics?.bimodalOffsetDetected)) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.ridgeBimodalParallelFamily);
  } else if (ambiguous.length > 0) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.ridgeBimodalParallelFamily);
  }
  if (inlierFraction < REGISTRATION_MIN_INLIER_FRACTION) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.inlierFractionLow);
  }
  if (
    anchorInliers.length > 0 &&
    (anchorResiduals.max > REGISTRATION_MAX_IDENTITY_RESIDUAL)
  ) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.residualExceedsMax);
  }
  if (
    anchorInliers.length >= 3 &&
    anchorResiduals.rms > REGISTRATION_MAX_RMS_RESIDUAL
  ) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.residualExceedsRms);
  }
  if (
    ridgeMax !== null && ridgeMax > REGISTRATION_MAX_IDENTITY_RESIDUAL
  ) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.residualExceedsMax);
  }
  if (
    ridgeRms !== null && ridgeRms > REGISTRATION_MAX_RMS_RESIDUAL
  ) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.residualExceedsRms);
  }
  const orientationOk = bins >= REGISTRATION_MIN_ORIENTATION_BINS ||
    zoomLock.configuration === "anchors_plus_ridges";
  if (!orientationOk) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.orientationDiversityInsufficient);
  }
  if (!zoomLock.satisfied) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.zoomLockUnsatisfied);
  }
  if (!spread.ok) {
    reasons.push(
      spread.secondPcaRatio < REGISTRATION_MIN_SECOND_PCA_RATIO
        ? EMPTY_ORIGINAL_REGISTRATION_REASON.collinearCorrespondences
        : EMPTY_ORIGINAL_REGISTRATION_REASON.insufficientSpread,
    );
  }
  if (anchorPairs.length >= 2 && !diagnosticSimilarityIsIdentity(diagnosticSimilarity)) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.diagnosticSimilarityDivergent);
  }
  if (
    diagnosticRidgeScale !== null &&
    Math.abs(diagnosticRidgeScale - 1) > REGISTRATION_DIAGNOSTIC_SCALE_ABS_MAX
  ) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.ridgeScaleNonIdentity);
  }
  if (attemptedCount < 2) {
    reasons.push(EMPTY_ORIGINAL_REGISTRATION_REASON.insufficientIndependentGeometry);
  }
  return {
    accepted: reasons.length === 0,
    inlierCount,
    attemptedCount,
    inlierFraction,
    outlierCount: contradictions.length + ambiguous.length,
    contradictionCount: contradictions.length,
    ambiguousCount: ambiguous.length,
    anchorCount: anchors.length,
    anchorInlierCount: anchorInliers.length,
    ridgeStructureCount: ridges.length,
    ridgeInlierCount: ridgeInliers.length,
    independentEvidenceUnitCount: inlierCount,
    attemptedEvidenceUnitCount: attemptedCount,
    orientationBinCount: bins,
    zoomLock,
    residuals: {
      max: anchorInliers.length > 0 ? anchorResiduals.max : ridgeMax,
      rms: anchorInliers.length > 0 ? anchorResiduals.rms : ridgeRms,
      maxAbsU: anchorInliers.length > 0 ? anchorResiduals.maxAbsU : null,
      maxAbsV: anchorInliers.length > 0 ? anchorResiduals.maxAbsV : null,
      anchorMax: anchorInliers.length > 0 ? anchorResiduals.max : null,
      anchorRms: anchorInliers.length > 0 ? anchorResiduals.rms : null,
      ridgeNormalMax: ridgeMax,
      ridgeNormalRms: ridgeRms,
      diagnosticSimilarity,
      diagnosticRidgeScale,
      diagnosticRidgeScaleAbsFromIdentity: diagnosticRidgeScale === null
        ? null
        : Math.abs(diagnosticRidgeScale - 1),
    },
    spread,
    reasons: uniqueReasons(reasons),
    inlierCorrespondences: inliers,
  };
}

export function spreadSamplesForUnits(
  units: readonly EmptyOriginalRegistrationCorrespondence[],
  rawSamples: readonly HybridSampleMatch[],
): EmptyOriginalNormalizedUv[] {
  const inlierIds = new Set(
    units.filter((unit) => unit.status === "inlier").map((unit) =>
      `${unit.kind}:${unit.structureId}`
    ),
  );
  const points: EmptyOriginalNormalizedUv[] = [];
  for (const sample of rawSamples) {
    if (inlierIds.has(`${sample.evidenceClass}:${sample.structureId}`)) {
      points.push(sample.empty);
    }
  }
  if (points.length === 0) {
    for (const unit of units) {
      if (unit.status === "inlier") points.push(unit.empty);
    }
  }
  return points;
}

function convexHull(
  points: readonly EmptyOriginalNormalizedUv[],
): EmptyOriginalNormalizedUv[] {
  const unique = [...points].sort((left, right) =>
    left.u - right.u || left.v - right.v
  );
  if (unique.length <= 1) return unique;
  const lower: EmptyOriginalNormalizedUv[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper: EmptyOriginalNormalizedUv[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index]!;
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function cross(
  origin: EmptyOriginalNormalizedUv,
  a: EmptyOriginalNormalizedUv,
  b: EmptyOriginalNormalizedUv,
): number {
  return (a.u - origin.u) * (b.v - origin.v) - (a.v - origin.v) * (b.u - origin.u);
}

function uniqueReasons(reasons: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const reason of reasons) {
    if (seen.has(reason)) continue;
    seen.add(reason);
    unique.push(reason);
  }
  return unique;
}
