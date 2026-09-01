import type {
  EmptyObservedOpening,
  EmptyObservedSeam,
  EmptyRoomObservationEvidence,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";
import {
  REGISTRATION_MIN_ANCHOR_TURN_RAD,
  REGISTRATION_MIN_DISTINCT_STRUCTURES,
  REGISTRATION_MIN_OPENING_EDGE_LENGTH,
  type EmptyOriginalFittedLine,
  type EmptyOriginalRegistrationEvidenceClass,
} from "./empty-original-registration-authority-contract";
import { fittedHesseLine, unitTangent } from "./empty-original-registration-geometry";

export type ArchitectureRegistrationPrior = Readonly<{
  priorId: string;
  structureId: string;
  parentStructureId: string | null;
  structureKind: string;
  evidenceClass: EmptyOriginalRegistrationEvidenceClass;
  empty: Readonly<{ u: number; v: number }>;
  tangent: Readonly<{ u: number; v: number }> | null;
  emptyLine: EmptyOriginalFittedLine | null;
}>;

const PRIOR_SEAM_CATEGORIES = new Set(["floor_wall", "wall_wall"]);
const PRIOR_JUNCTION_CATEGORIES = new Set([
  "room_corner",
  "seam_junction",
  "opening_boundary_intersection",
]);
const SAMPLE_SPACING = 0.07;
const MAX_SAMPLES_PER_STRUCTURE = 10;

/**
 * EMPTY observation is used only as a prior for candidate stable architecture.
 * Registration proof must come from independently locating the same structure
 * in ORIGINAL pixels.
 *
 * Classification:
 * - unique 2-D junctions / high-curvature corners → point_anchor
 * - long architectural seams and opening edges → ridge_normal
 */
export function collectArchitectureRegistrationPriors(
  observation: EmptyRoomObservationEvidence | null,
): readonly ArchitectureRegistrationPrior[] {
  if (!observation || observation.observerStatus === "failed") {
    return Object.freeze([]);
  }
  const priors: ArchitectureRegistrationPrior[] = [];
  const used = new Set<string>();
  const occupiedAnchorKeys = new Set<string>();

  for (const junction of observation.observedJunctions) {
    if (!PRIOR_JUNCTION_CATEGORIES.has(junction.category) || junction.ambiguity) {
      continue;
    }
    const empty = {
      u: junction.sourceNormalizedPoint.x,
      v: junction.sourceNormalizedPoint.y,
    };
    if (
      pushPrior(priors, used, {
        priorId: `junction:${junction.id}`,
        structureId: junction.id,
        parentStructureId: null,
        structureKind: junction.category,
        evidenceClass: "point_anchor",
        empty,
        tangent: null,
        emptyLine: null,
      })
    ) {
      occupiedAnchorKeys.add(anchorKey(empty));
    }
  }

  for (const seam of observation.observedSeams) {
    if (!PRIOR_SEAM_CATEGORIES.has(seam.category) || seam.ambiguity) continue;
    const polyline = seam.sourceNormalizedPolyline;
    const line = fittedHesseLine(
      polyline.map((point) => ({ u: point.x, v: point.y })),
    );
    const sampled = samplePolyline(polyline);
    for (const sample of sampled) {
      pushPrior(priors, used, {
        priorId: `seam:${seam.id}:${fmt(sample.point)}`,
        structureId: seam.id,
        parentStructureId: null,
        structureKind: seam.category,
        evidenceClass: "ridge_normal",
        empty: { u: sample.point.x, v: sample.point.y },
        tangent: sample.tangent,
        emptyLine: line,
      });
    }
  }

  for (const opening of observation.observedOpenings) {
    if (opening.ambiguity) continue;
    const classified = classifyOpeningBoundary(opening);
    for (const item of classified) {
      if (item.evidenceClass === "point_anchor") {
        if (occupiedAnchorKeys.has(anchorKey(item.empty))) continue;
        if (pushPrior(priors, used, item)) {
          occupiedAnchorKeys.add(anchorKey(item.empty));
        }
        continue;
      }
      pushPrior(priors, used, item);
    }
  }
  return Object.freeze(priors);
}

export function distinctArchitecturalStructureCount(
  priors: readonly ArchitectureRegistrationPrior[],
): number {
  return new Set(priors.map((prior) => evidenceUnitKey(prior))).size;
}

export function priorsHaveRequiredStructureDiversity(
  priors: readonly ArchitectureRegistrationPrior[],
): boolean {
  return distinctArchitecturalStructureCount(priors) >=
    REGISTRATION_MIN_DISTINCT_STRUCTURES;
}

export function evidenceUnitKey(
  prior: Pick<ArchitectureRegistrationPrior, "structureId" | "evidenceClass">,
): string {
  return `${prior.evidenceClass}:${prior.structureId}`;
}

export function classifyOpeningBoundary(
  opening: EmptyObservedOpening,
): ArchitectureRegistrationPrior[] {
  const boundary = opening.sourceNormalizedBoundary;
  if (boundary.length < 2) return [];
  const closed = opening.boundaryClosure === "complete_visible_outline" &&
    boundary.length >= 3;
  const corner = openingVertexIsCorner(boundary, closed);
  const priors: ArchitectureRegistrationPrior[] = [];
  for (let index = 0; index < boundary.length; index += 1) {
    if (!corner[index]) continue;
    const point = boundary[index]!;
    priors.push({
      priorId: `opening:${opening.id}:corner:${index}`,
      structureId: `opening:${opening.id}:corner:${index}`,
      parentStructureId: opening.id,
      structureKind: `opening_${opening.category}`,
      evidenceClass: "point_anchor",
      empty: { u: point.x, v: point.y },
      tangent: null,
      emptyLine: null,
    });
  }
  const edges = openingEdges(boundary, corner, closed);
  for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
    const edge = edges[edgeIndex]!;
    if (polylineLength(edge) < REGISTRATION_MIN_OPENING_EDGE_LENGTH) continue;
    const line = fittedHesseLine(edge.map((point) => ({ u: point.x, v: point.y })));
    const sampled = samplePolyline(edge);
    for (const sample of sampled) {
      priors.push({
        priorId: `opening:${opening.id}:edge:${edgeIndex}:${fmt(sample.point)}`,
        structureId: `opening:${opening.id}:edge:${edgeIndex}`,
        parentStructureId: opening.id,
        structureKind: `opening_${opening.category}`,
        evidenceClass: "ridge_normal",
        empty: { u: sample.point.x, v: sample.point.y },
        tangent: sample.tangent,
        emptyLine: line,
      });
    }
  }
  return priors;
}

export function openingVertexIsCorner(
  boundary: readonly SourceNormalizedPoint[],
  closed: boolean,
): boolean[] {
  const flags = boundary.map(() => false);
  if (boundary.length < 3) {
    return flags;
  }
  const last = boundary.length - 1;
  const start = closed ? 0 : 1;
  const end = closed ? last : last - 1;
  for (let index = start; index <= end; index += 1) {
    const prev = boundary[(index - 1 + boundary.length) % boundary.length]!;
    const curr = boundary[index]!;
    const next = boundary[(index + 1) % boundary.length]!;
    const incoming = unitTangent(
      { u: prev.x, v: prev.y },
      { u: curr.x, v: curr.y },
    );
    const outgoing = unitTangent(
      { u: curr.x, v: curr.y },
      { u: next.x, v: next.y },
    );
    if (!incoming || !outgoing) continue;
    const turn = Math.acos(
      clamp(incoming.u * outgoing.u + incoming.v * outgoing.v, -1, 1),
    );
    flags[index] = turn >= REGISTRATION_MIN_ANCHOR_TURN_RAD;
  }
  return flags;
}

function openingEdges(
  boundary: readonly SourceNormalizedPoint[],
  corner: readonly boolean[],
  closed: boolean,
): SourceNormalizedPoint[][] {
  if (boundary.length < 2) return [];
  const cornerIndices = boundary
    .map((_, index) => index)
    .filter((index) => corner[index]);
  if (cornerIndices.length === 0) {
    return [boundary.slice()];
  }
  if (!closed) {
    const edges: SourceNormalizedPoint[][] = [];
    let start = 0;
    for (const index of cornerIndices) {
      if (index > start) edges.push(boundary.slice(start, index + 1));
      start = index;
    }
    if (start < boundary.length - 1) {
      edges.push(boundary.slice(start));
    }
    return edges.filter((edge) => edge.length >= 2);
  }
  const edges: SourceNormalizedPoint[][] = [];
  for (let i = 0; i < cornerIndices.length; i += 1) {
    const a = cornerIndices[i]!;
    const b = cornerIndices[(i + 1) % cornerIndices.length]!;
    const edge: SourceNormalizedPoint[] = [];
    let cursor = a;
    while (true) {
      edge.push(boundary[cursor]!);
      if (cursor === b) break;
      cursor = (cursor + 1) % boundary.length;
      if (edge.length > boundary.length + 1) break;
    }
    if (edge.length >= 2) edges.push(edge);
  }
  return edges;
}

function samplePolyline(
  polyline: readonly SourceNormalizedPoint[],
): Array<{
  point: SourceNormalizedPoint;
  tangent: Readonly<{ u: number; v: number }> | null;
}> {
  if (polyline.length === 0) return [];
  if (polyline.length === 1) {
    return [{ point: polyline[0]!, tangent: null }];
  }
  let total = 0;
  const lengths: number[] = [];
  for (let index = 0; index < polyline.length - 1; index += 1) {
    const length = Math.hypot(
      polyline[index + 1]!.x - polyline[index]!.x,
      polyline[index + 1]!.y - polyline[index]!.y,
    );
    lengths.push(length);
    total += length;
  }
  const samples: Array<{
    point: SourceNormalizedPoint;
    tangent: Readonly<{ u: number; v: number }> | null;
  }> = [];
  const count = total <= 1e-12
    ? 2
    : Math.min(
      MAX_SAMPLES_PER_STRUCTURE,
      Math.max(3, Math.floor(total / SAMPLE_SPACING) + 1),
    );
  const skipEnds = count >= 4;
  for (let index = 0; index < count; index += 1) {
    if (skipEnds && (index === 0 || index === count - 1)) continue;
    const t = count === 1 ? 0 : index / (count - 1);
    const located = pointAndTangentAtNormalizedLength(polyline, lengths, total, t);
    if (located) samples.push(located);
  }
  return samples;
}

function pointAndTangentAtNormalizedLength(
  polyline: readonly SourceNormalizedPoint[],
  lengths: readonly number[],
  total: number,
  t: number,
): {
  point: SourceNormalizedPoint;
  tangent: Readonly<{ u: number; v: number }> | null;
} | null {
  if (polyline.length === 0) return null;
  if (total <= 1e-12) {
    return { point: polyline[0]!, tangent: null };
  }
  const target = t * total;
  let cursor = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index]!;
    if (cursor + length >= target || index === lengths.length - 1) {
      const local = length <= 1e-18 ? 0 : (target - cursor) / length;
      const start = polyline[index]!;
      const end = polyline[index + 1]!;
      return {
        point: {
          x: start.x + (end.x - start.x) * local,
          y: start.y + (end.y - start.y) * local,
        },
        tangent: unitTangent(
          { u: start.x, v: start.y },
          { u: end.x, v: end.y },
        ),
      };
    }
    cursor += length;
  }
  const last = polyline[polyline.length - 1]!;
  const prev = polyline[polyline.length - 2]!;
  return {
    point: last,
    tangent: unitTangent({ u: prev.x, v: prev.y }, { u: last.x, v: last.y }),
  };
}

function polylineLength(polyline: readonly SourceNormalizedPoint[]): number {
  let total = 0;
  for (let index = 0; index < polyline.length - 1; index += 1) {
    total += Math.hypot(
      polyline[index + 1]!.x - polyline[index]!.x,
      polyline[index + 1]!.y - polyline[index]!.y,
    );
  }
  return total;
}

function pushPrior(
  priors: ArchitectureRegistrationPrior[],
  used: Set<string>,
  prior: ArchitectureRegistrationPrior,
): boolean {
  const key = `${prior.evidenceClass}:${prior.structureId}:${prior.empty.u.toFixed(4)}:${prior.empty.v.toFixed(4)}`;
  if (used.has(key)) return false;
  if (
    prior.empty.u < 0 || prior.empty.u > 1 ||
    prior.empty.v < 0 || prior.empty.v > 1
  ) {
    return false;
  }
  used.add(key);
  priors.push(prior);
  return true;
}

function anchorKey(point: Readonly<{ u: number; v: number }>): string {
  return `${point.u.toFixed(4)}:${point.v.toFixed(4)}`;
}

function fmt(point: SourceNormalizedPoint): string {
  return `${point.x.toFixed(4)}_${point.y.toFixed(4)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function openingHasUsableCorners(
  opening: EmptyObservedOpening,
): boolean {
  return opening.sourceNormalizedBoundary.length >= 2;
}

export function seamIsArchitecturalPrior(seam: EmptyObservedSeam): boolean {
  return PRIOR_SEAM_CATEGORIES.has(seam.category) && !seam.ambiguity;
}
