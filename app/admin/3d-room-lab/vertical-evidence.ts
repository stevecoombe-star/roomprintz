import type { CalibrationImageBasis } from "./calibration-image-basis";
import {
  isFrameCoincidentStructuralEdge,
  type ProjectionCoherencePoint2,
  type StructuralVerticalObservation,
} from "./projection-coherence-diagnostics";
import {
  applyHomography,
  floorVec3ToPlane2D,
  getFloorRectCorners,
  orderFloorCorners,
  solvePlaneHomography,
} from "./perspective-solve";
import { buildWallPolygonKey, type WallPolygon, type WallSupportKind } from "./wall-support-geometry";

export const VERTICAL_EVIDENCE_MODEL_VERSION = "vertical-evidence-model/v1";
export const VERTICAL_EVIDENCE_SUGGESTION_GENERATOR_VERSION = "wall-edge-suggestions/v1";
export const VERTICAL_EVIDENCE_ANCHOR_DERIVATION_VERSION = "source-floor-homography/v1";

export type VerticalEvidenceOperatorDecision = "unreviewed" | "selected" | "excluded";
export type VerticalEvidenceUsability = "current" | "needs_review" | "stale" | "hard_rejected";
export type VerticalEvidenceCollectionAssessment = "insufficient" | "unclassified";
export type PhysicalVerticalId = "back_left" | "back_right" | "front_left" | "front_right";
export type SourceNormalizedEndpoints = Readonly<{
  lower: Readonly<{ x: number; y: number }>;
  upper: Readonly<{ x: number; y: number }>;
}>;

export type VerticalEvidenceSuggestion = Readonly<{
  suggestionId: string;
  imageBasisId: string;
  imageBasisFingerprint: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  wallKind: WallSupportKind;
  wallPolygonKey: string;
  physicalVerticalId: PhysicalVerticalId;
  sourceNormalizedEndpoints: SourceNormalizedEndpoints;
  suggestionGeneratorVersion: typeof VERTICAL_EVIDENCE_SUGGESTION_GENERATOR_VERSION;
  sourceResidualDeg: number | null;
}>;

export type FrozenWorldAnchor = Readonly<{ x: number; y: 0; z: number }>;

export type VerticalEvidenceObservation = Readonly<{
  observationId: string;
  evidenceModelVersion: typeof VERTICAL_EVIDENCE_MODEL_VERSION;
  imageBasisId: string;
  imageBasisFingerprint: string;
  intrinsicWidth: number;
  intrinsicHeight: number;
  sourceNormalizedEndpoints: SourceNormalizedEndpoints;
  physicalVerticalId: PhysicalVerticalId;
  suggestionSourceId: string;
  wallKind: WallSupportKind;
  wallPolygonKey: string;
  suggestionGeneratorVersion: typeof VERTICAL_EVIDENCE_SUGGESTION_GENERATOR_VERSION;
  floorProvenance: Readonly<{
    floorPolygonKey: string;
    worldWidth: number;
    worldDepth: number;
  }>;
  frozenWorldAnchor: FrozenWorldAnchor;
  frozenAnchorDerivationId: string;
  operatorDecision: VerticalEvidenceOperatorDecision;
  decisionAtIso: string | null;
  historicalContext: Readonly<{
    nonBinding: true;
    cameraVersion: string | null;
    cameraAppliedAtIso: string | null;
    frameWidth: number | null;
    frameHeight: number | null;
  }>;
  supersession: Readonly<{
    supersedesObservationId: string;
    reason: string;
    atIso: string;
  }> | null;
}>;

export type VerticalEvidenceSection = Readonly<{
  evidenceModelVersion: typeof VERTICAL_EVIDENCE_MODEL_VERSION;
  observations: readonly VerticalEvidenceObservation[];
}>;

export type VerticalEvidenceRuntimeContext = Readonly<{
  imageBasis: CalibrationImageBasis | null;
  intrinsicWidth: number | null;
  intrinsicHeight: number | null;
  floor: Readonly<{
    polygonKey: string | null;
    worldWidth: number;
    worldDepth: number;
  }>;
  walls: Readonly<Record<WallSupportKind, WallPolygon | null>>;
}>;

export type VerticalEvidenceObservationRuntime = Readonly<{
  observation: VerticalEvidenceObservation;
  usability: VerticalEvidenceUsability;
  reasons: readonly string[];
  eligible: boolean;
  sourcePixelLength: number | null;
  normalizedSourceLength: number | null;
  activeRawResidualDeg: number | null;
}>;

export type VerticalEvidenceGroup = Readonly<{
  physicalVerticalId: PhysicalVerticalId;
  observationIds: readonly string[];
  withinGroupEndpointDisagreementNormalized: number | null;
  withinGroupFrozenAnchorDisagreementNormalized: number | null;
}>;

export type VerticalEvidenceMetrics = Readonly<{
  distinctPhysicalVerticalCount: number;
  observationsPerPhysicalVertical: readonly VerticalEvidenceGroup[];
  representedWallCount: number;
  representedWalls: readonly WallSupportKind[];
  sameWallOnly: boolean;
  normalizedSourceImageSeparation: number | null;
  normalizedWorldAnchorSeparation: number | null;
  normalizedObservationLengths: readonly Readonly<{ observationId: string; value: number | null }>[];
  floorQuadrantOccupancy: Readonly<{
    near_left: number;
    near_right: number;
    far_left: number;
    far_right: number;
    outside_or_unavailable: number;
  }>;
  activeRawResidualSummary: Readonly<{
    count: number;
    minimumDeg: number | null;
    maximumDeg: number | null;
    rangeDeg: number | null;
    averageDeg: number | null;
    note: string;
  }>;
}>;

export type VerticalEvidenceCollectionRuntime = Readonly<{
  suggestions: readonly VerticalEvidenceSuggestion[];
  observations: readonly VerticalEvidenceObservationRuntime[];
  assessment: VerticalEvidenceCollectionAssessment;
  metrics: VerticalEvidenceMetrics;
}>;

type CurrentWallInput = Readonly<{
  kind: WallSupportKind;
  polygon: WallPolygon | null;
  derivationOk: boolean;
  runtimeUsable: boolean;
}>;

type MaterializeInput = Readonly<{
  suggestion: VerticalEvidenceSuggestion;
  operatorDecision: Exclude<VerticalEvidenceOperatorDecision, "unreviewed">;
  decisionAtIso: string;
  floor: Readonly<{
    sourceNormalizedPolygon: readonly ProjectionCoherencePoint2[];
    polygonKey: string;
    worldWidth: number;
    worldDepth: number;
  }>;
  historicalContext: VerticalEvidenceObservation["historicalContext"];
  supersession?: VerticalEvidenceObservation["supersession"];
}>;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePoint(point: unknown): point is ProjectionCoherencePoint2 {
  return !!point && typeof point === "object" && finite((point as { x?: unknown }).x) && finite((point as { y?: unknown }).y);
}

function finiteFrozenWorldAnchor(anchor: FrozenWorldAnchor | null | undefined): anchor is FrozenWorldAnchor {
  return !!anchor && finite(anchor.x) && finite(anchor.y) && finite(anchor.z) && anchor.y === 0;
}

function copyEndpoints(endpoints: SourceNormalizedEndpoints): SourceNormalizedEndpoints {
  return {
    lower: { x: endpoints.lower.x, y: endpoints.lower.y },
    upper: { x: endpoints.upper.x, y: endpoints.upper.y },
  };
}

function canonicalNumber(value: number): string {
  return value.toFixed(8);
}

function endpointKey(endpoints: SourceNormalizedEndpoints): string {
  return [
    canonicalNumber(endpoints.lower.x),
    canonicalNumber(endpoints.lower.y),
    canonicalNumber(endpoints.upper.x),
    canonicalNumber(endpoints.upper.y),
  ].join(",");
}

function validSourceNormalizedEndpoints(endpoints: SourceNormalizedEndpoints): boolean {
  return [endpoints.lower, endpoints.upper].every(
    (point) => finite(point.x) && finite(point.y) && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1
  );
}

function sourcePixelLength(endpoints: SourceNormalizedEndpoints, width: number, height: number): number | null {
  if (!validSourceNormalizedEndpoints(endpoints) || !finite(width) || !finite(height) || width <= 0 || height <= 0) return null;
  const length = Math.hypot(
    (endpoints.upper.x - endpoints.lower.x) * width,
    (endpoints.upper.y - endpoints.lower.y) * height
  );
  return finite(length) ? length : null;
}

function normalizedEndpointSeparation(left: SourceNormalizedEndpoints, right: SourceNormalizedEndpoints): number | null {
  if (!validSourceNormalizedEndpoints(left) || !validSourceNormalizedEndpoints(right)) return null;
  const lower = Math.hypot(left.lower.x - right.lower.x, left.lower.y - right.lower.y);
  const upper = Math.hypot(left.upper.x - right.upper.x, left.upper.y - right.upper.y);
  const result = (lower + upper) / (2 * Math.SQRT2);
  return finite(result) ? result : null;
}

function normalizedAnchorSeparation(
  left: FrozenWorldAnchor,
  right: FrozenWorldAnchor,
  worldWidth: number,
  worldDepth: number
): number | null {
  const diagonal = Math.hypot(worldWidth, worldDepth);
  if (![left.x, left.z, right.x, right.z, diagonal].every(finite) || diagonal <= 0) return null;
  const result = Math.hypot(left.x - right.x, left.z - right.z) / diagonal;
  return finite(result) ? result : null;
}

function maxPairwise<T>(values: readonly T[], compare: (left: T, right: T) => number | null): number | null {
  let maximum: number | null = null;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const value = compare(values[left], values[right]);
      if (value !== null) maximum = maximum === null ? value : Math.max(maximum, value);
    }
  }
  return maximum;
}

function physicalVerticalId(value: unknown): value is PhysicalVerticalId {
  return value === "back_left" || value === "back_right" || value === "front_left" || value === "front_right";
}

function wallKind(value: unknown): value is WallSupportKind {
  return value === "wall_back" || value === "wall_left" || value === "wall_right";
}

export function buildVerticalEvidenceSuggestionId(input: {
  imageBasisId: string;
  imageBasisFingerprint: string;
  wallKind: WallSupportKind;
  wallPolygonKey: string;
  physicalVerticalId: PhysicalVerticalId;
  sourceNormalizedEndpoints: SourceNormalizedEndpoints;
  suggestionGeneratorVersion?: string;
}): string {
  return [
    "vertical-evidence-suggestion",
    input.suggestionGeneratorVersion ?? VERTICAL_EVIDENCE_SUGGESTION_GENERATOR_VERSION,
    input.imageBasisId,
    input.imageBasisFingerprint,
    input.wallKind,
    input.wallPolygonKey,
    input.physicalVerticalId,
    endpointKey(input.sourceNormalizedEndpoints),
  ].join(":");
}

export function buildVerticalEvidenceObservationId(suggestionSourceId: string): string {
  return `vertical-evidence-observation/v1:${suggestionSourceId}`;
}

export function buildFrozenAnchorDerivationId(input: {
  floorPolygonKey: string;
  worldWidth: number;
  worldDepth: number;
}): string {
  return [
    VERTICAL_EVIDENCE_ANCHOR_DERIVATION_VERSION,
    input.floorPolygonKey,
    canonicalNumber(input.worldWidth),
    canonicalNumber(input.worldDepth),
  ].join(":");
}

/**
 * Generates ephemeral wall-edge suggestions only. It intentionally does not
 * materialize observations or assign a decision.
 */
export function deriveVerticalEvidenceSuggestions(input: {
  imageBasis: CalibrationImageBasis | null;
  intrinsicWidth: number | null;
  intrinsicHeight: number | null;
  walls: readonly CurrentWallInput[];
  structuralObservations: readonly StructuralVerticalObservation[];
}): readonly VerticalEvidenceSuggestion[] {
  const { imageBasis, intrinsicWidth, intrinsicHeight } = input;
  if (!imageBasis || !finite(intrinsicWidth) || !finite(intrinsicHeight) || intrinsicWidth <= 0 || intrinsicHeight <= 0) return [];
  const wallByKind = new Map(input.walls.map((wall) => [wall.kind, wall]));
  const suggestions: VerticalEvidenceSuggestion[] = [];
  for (const edge of input.structuralObservations) {
    const wall = wallByKind.get(edge.wallKind);
    if (
      !wall ||
      !wall.polygon ||
      !wall.derivationOk ||
      !wall.runtimeUsable ||
      edge.inclusion !== "included" ||
      !physicalVerticalId(edge.physicalVerticalId)
    ) continue;
    const endpoints: SourceNormalizedEndpoints = {
      lower: { ...edge.sourceNormalizedEndpoints.lower },
      upper: { ...edge.sourceNormalizedEndpoints.upper },
    };
    if (!validSourceNormalizedEndpoints(endpoints)) continue;
    const wallPolygonKey = buildWallPolygonKey(wall.polygon);
    const suggestionId = buildVerticalEvidenceSuggestionId({
      imageBasisId: imageBasis.basisId,
      imageBasisFingerprint: imageBasis.basisFingerprint,
      wallKind: edge.wallKind,
      wallPolygonKey,
      physicalVerticalId: edge.physicalVerticalId,
      sourceNormalizedEndpoints: endpoints,
    });
    suggestions.push({
      suggestionId,
      imageBasisId: imageBasis.basisId,
      imageBasisFingerprint: imageBasis.basisFingerprint,
      intrinsicWidth,
      intrinsicHeight,
      wallKind: edge.wallKind,
      wallPolygonKey,
      physicalVerticalId: edge.physicalVerticalId,
      sourceNormalizedEndpoints: endpoints,
      suggestionGeneratorVersion: VERTICAL_EVIDENCE_SUGGESTION_GENERATOR_VERSION,
      sourceResidualDeg: finite(edge.locationMatchedResidualDeg) ? edge.locationMatchedResidualDeg : null,
    });
  }
  return suggestions.sort((left, right) => left.suggestionId.localeCompare(right.suggestionId));
}

/**
 * The anchor is a source-image-to-Floor homography projection of the lower
 * photographed endpoint. It deliberately receives no wall or camera inputs.
 */
export function deriveFrozenVerticalEvidenceAnchor(input: {
  sourceNormalizedFloorPolygon: readonly ProjectionCoherencePoint2[];
  intrinsicWidth: number;
  intrinsicHeight: number;
  worldWidth: number;
  worldDepth: number;
  lowerSourceNormalizedEndpoint: ProjectionCoherencePoint2;
}): { ok: true; anchor: FrozenWorldAnchor } | { ok: false; reason: string } {
  if (
    !finite(input.intrinsicWidth) ||
    !finite(input.intrinsicHeight) ||
    input.intrinsicWidth <= 0 ||
    input.intrinsicHeight <= 0 ||
    !finite(input.worldWidth) ||
    !finite(input.worldDepth) ||
    input.worldWidth <= 0 ||
    input.worldDepth <= 0 ||
    !finitePoint(input.lowerSourceNormalizedEndpoint)
  ) return { ok: false, reason: "invalid source image, Floor mapping, or lower endpoint" };
  const orderedFloor = orderFloorCorners(input.sourceNormalizedFloorPolygon.map((point) => ({ x: point.x, y: point.y })));
  if (!orderedFloor.ok) return { ok: false, reason: `Floor order unavailable: ${orderedFloor.reason}` };
  const floorRect = getFloorRectCorners({ widthMeters: input.worldWidth, depthMeters: input.worldDepth });
  if (!floorRect.ok) return { ok: false, reason: `Floor mapping unavailable: ${floorRect.reason}` };
  const homography = solvePlaneHomography(
    orderedFloor.value.asArray.map((point) => ({
      x: point.x * input.intrinsicWidth,
      y: point.y * input.intrinsicHeight,
    })),
    floorRect.value.asArray.map(floorVec3ToPlane2D)
  );
  if (!homography.ok) return { ok: false, reason: `Floor homography unavailable: ${homography.reason}` };
  const mapped = applyHomography(homography.value, {
    x: input.lowerSourceNormalizedEndpoint.x * input.intrinsicWidth,
    y: input.lowerSourceNormalizedEndpoint.y * input.intrinsicHeight,
  });
  if (!mapped) return { ok: false, reason: "lower endpoint could not map through Floor homography" };
  return { ok: true, anchor: { x: mapped.x, y: 0, z: mapped.y } };
}

export function materializeVerticalEvidenceObservation(input: MaterializeInput):
  | { ok: true; observation: VerticalEvidenceObservation }
  | { ok: false; reason: string } {
  if (!isStrictIso(input.decisionAtIso)) return { ok: false, reason: "decision timestamp must be strict UTC ISO" };
  if (!validSourceNormalizedEndpoints(input.suggestion.sourceNormalizedEndpoints)) return { ok: false, reason: "suggestion endpoints are invalid" };
  const anchor = deriveFrozenVerticalEvidenceAnchor({
    sourceNormalizedFloorPolygon: input.floor.sourceNormalizedPolygon,
    intrinsicWidth: input.suggestion.intrinsicWidth,
    intrinsicHeight: input.suggestion.intrinsicHeight,
    worldWidth: input.floor.worldWidth,
    worldDepth: input.floor.worldDepth,
    lowerSourceNormalizedEndpoint: input.suggestion.sourceNormalizedEndpoints.lower,
  });
  if (!anchor.ok) return anchor;
  const expectedSuggestionId = buildVerticalEvidenceSuggestionId(input.suggestion);
  if (input.suggestion.suggestionId !== expectedSuggestionId) return { ok: false, reason: "suggestion identity does not match canonical source fields" };
  const supersession = input.supersession ?? null;
  if (supersession && (!isStrictIso(supersession.atIso) || !supersession.supersedesObservationId || !supersession.reason.trim())) {
    return { ok: false, reason: "supersession linkage is invalid" };
  }
  return {
    ok: true,
    observation: {
      observationId: buildVerticalEvidenceObservationId(input.suggestion.suggestionId),
      evidenceModelVersion: VERTICAL_EVIDENCE_MODEL_VERSION,
      imageBasisId: input.suggestion.imageBasisId,
      imageBasisFingerprint: input.suggestion.imageBasisFingerprint,
      intrinsicWidth: input.suggestion.intrinsicWidth,
      intrinsicHeight: input.suggestion.intrinsicHeight,
      sourceNormalizedEndpoints: copyEndpoints(input.suggestion.sourceNormalizedEndpoints),
      physicalVerticalId: input.suggestion.physicalVerticalId,
      suggestionSourceId: input.suggestion.suggestionId,
      wallKind: input.suggestion.wallKind,
      wallPolygonKey: input.suggestion.wallPolygonKey,
      suggestionGeneratorVersion: VERTICAL_EVIDENCE_SUGGESTION_GENERATOR_VERSION,
      floorProvenance: {
        floorPolygonKey: input.floor.polygonKey,
        worldWidth: input.floor.worldWidth,
        worldDepth: input.floor.worldDepth,
      },
      frozenWorldAnchor: anchor.anchor,
      frozenAnchorDerivationId: buildFrozenAnchorDerivationId({
        floorPolygonKey: input.floor.polygonKey,
        worldWidth: input.floor.worldWidth,
        worldDepth: input.floor.worldDepth,
      }),
      operatorDecision: input.operatorDecision,
      decisionAtIso: input.decisionAtIso,
      historicalContext: { ...input.historicalContext },
      supersession: supersession ? { ...supersession } : null,
    },
  };
}

export function changeVerticalEvidenceDecision(input: {
  observation: VerticalEvidenceObservation;
  operatorDecision: VerticalEvidenceOperatorDecision;
  decisionAtIso: string | null;
}): VerticalEvidenceObservation | null {
  if ((input.operatorDecision === "selected" || input.operatorDecision === "excluded") && (!input.decisionAtIso || !isStrictIso(input.decisionAtIso))) {
    return null;
  }
  if (input.operatorDecision === "unreviewed" && input.decisionAtIso !== null) return null;
  return {
    ...input.observation,
    operatorDecision: input.operatorDecision,
    decisionAtIso: input.decisionAtIso,
  };
}

function observationHardRejectionReason(observation: VerticalEvidenceObservation): string | null {
  if (!finiteFrozenWorldAnchor(observation.frozenWorldAnchor)) return "frozen_anchor_invalid";
  const endpoints = observation.sourceNormalizedEndpoints;
  if (!validSourceNormalizedEndpoints(endpoints)) return "source_endpoints_invalid";
  const length = sourcePixelLength(endpoints, observation.intrinsicWidth, observation.intrinsicHeight);
  if (length === null || length === 0) return "source_segment_degenerate";
  if (isFrameCoincidentStructuralEdge(endpoints.lower, endpoints.upper, {
    intrinsicWidth: observation.intrinsicWidth,
    intrinsicHeight: observation.intrinsicHeight,
  })) return "frame_coincident_edge";
  return null;
}

export function evaluateVerticalEvidenceObservation(
  observation: VerticalEvidenceObservation,
  context: VerticalEvidenceRuntimeContext
): VerticalEvidenceObservationRuntime {
  // Currentness is intentionally source-provenance-only after materialization:
  // live wall runtime state and active-camera identity control new suggestions,
  // not the validity of a captured photographed observation.
  const hardRejection = observationHardRejectionReason(observation);
  if (hardRejection) {
    return {
      observation,
      usability: "hard_rejected",
      reasons: [hardRejection],
      eligible: false,
      sourcePixelLength: null,
      normalizedSourceLength: null,
      activeRawResidualDeg: null,
    };
  }
  const reasons: string[] = [];
  let usability: VerticalEvidenceUsability = "current";
  if (observation.evidenceModelVersion !== VERTICAL_EVIDENCE_MODEL_VERSION) {
    usability = "needs_review";
    reasons.push("evidence_model_version_incompatible");
  }
  if (
    !context.imageBasis ||
    context.imageBasis.basisFingerprint !== observation.imageBasisFingerprint ||
    !finite(context.intrinsicWidth) ||
    !finite(context.intrinsicHeight) ||
    context.intrinsicWidth !== observation.intrinsicWidth ||
    context.intrinsicHeight !== observation.intrinsicHeight
  ) {
    usability = "stale";
    reasons.push("image_basis_fingerprint_or_intrinsic_dimensions_changed");
  } else if (context.imageBasis.basisId !== observation.imageBasisId) {
    usability = "needs_review";
    reasons.push("image_basis_identity_changed");
  }
  if (
    context.floor.polygonKey !== observation.floorProvenance.floorPolygonKey ||
    context.floor.worldWidth !== observation.floorProvenance.worldWidth ||
    context.floor.worldDepth !== observation.floorProvenance.worldDepth
  ) {
    if (usability !== "stale") usability = "needs_review";
    reasons.push("Floor_polygon_or_mapping_changed");
  }
  const wall = context.walls[observation.wallKind];
  if (!wall || buildWallPolygonKey(wall) !== observation.wallPolygonKey) {
    if (usability !== "stale") usability = "needs_review";
    reasons.push("source_wall_polygon_or_identity_changed");
  }
  const length = sourcePixelLength(observation.sourceNormalizedEndpoints, observation.intrinsicWidth, observation.intrinsicHeight);
  const imageDiagonal = Math.hypot(observation.intrinsicWidth, observation.intrinsicHeight);
  return {
    observation,
    usability,
    reasons,
    eligible: observation.operatorDecision === "selected" && usability === "current",
    sourcePixelLength: length,
    normalizedSourceLength: length !== null && imageDiagonal > 0 ? length / imageDiagonal : null,
    activeRawResidualDeg: null,
  };
}

function matchCurrentResidual(
  observation: VerticalEvidenceObservation,
  structuralObservations: readonly StructuralVerticalObservation[]
): number | null {
  const matched = structuralObservations.find((edge) =>
    edge.wallKind === observation.wallKind &&
    edge.physicalVerticalId === observation.physicalVerticalId &&
    endpointKey(edge.sourceNormalizedEndpoints) === endpointKey(observation.sourceNormalizedEndpoints)
  );
  return matched && finite(matched.locationMatchedResidualDeg) ? matched.locationMatchedResidualDeg : null;
}

// Classification-only hygiene for source-homography roundoff at a Floor edge.
// This is not an evidence-quality, acceptance, or solver threshold.
const FLOOR_QUADRANT_CLASSIFICATION_TOLERANCE = 1e-9;

function quadrant(anchor: FrozenWorldAnchor, width: number, depth: number): keyof VerticalEvidenceMetrics["floorQuadrantOccupancy"] {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  if (
    ![anchor.x, anchor.z, width, depth].every(finite) ||
    width <= 0 ||
    depth <= 0 ||
    Math.abs(anchor.x) > halfWidth + FLOOR_QUADRANT_CLASSIFICATION_TOLERANCE ||
    Math.abs(anchor.z) > halfDepth + FLOOR_QUADRANT_CLASSIFICATION_TOLERANCE
  ) {
    return "outside_or_unavailable";
  }
  // Clamp only after the tolerance admission above; persisted anchors remain untouched.
  const classificationX = Math.max(-halfWidth, Math.min(halfWidth, anchor.x));
  const classificationZ = Math.max(-halfDepth, Math.min(halfDepth, anchor.z));
  if (classificationZ >= 0) return classificationX < 0 ? "near_left" : "near_right";
  return classificationX < 0 ? "far_left" : "far_right";
}

function buildMetrics(
  observations: readonly VerticalEvidenceObservationRuntime[],
  context: VerticalEvidenceRuntimeContext
): VerticalEvidenceMetrics {
  const all = observations.map((runtime) => runtime.observation);
  const groups = [...new Set(all.map((observation) => observation.physicalVerticalId))].sort().map((physicalVerticalId) => {
    const members = all.filter((observation) => observation.physicalVerticalId === physicalVerticalId);
    return {
      physicalVerticalId: physicalVerticalId as PhysicalVerticalId,
      observationIds: members.map((observation) => observation.observationId).sort(),
      withinGroupEndpointDisagreementNormalized: maxPairwise(
        members,
        (left, right) => normalizedEndpointSeparation(left.sourceNormalizedEndpoints, right.sourceNormalizedEndpoints)
      ),
      withinGroupFrozenAnchorDisagreementNormalized: maxPairwise(
        members,
        (left, right) => normalizedAnchorSeparation(
          left.frozenWorldAnchor,
          right.frozenWorldAnchor,
          context.floor.worldWidth,
          context.floor.worldDepth
        )
      ),
    };
  });
  const representedWalls = [...new Set(all.map((observation) => observation.wallKind))].sort() as WallSupportKind[];
  const sourceSeparations = maxPairwise(all, (left, right) =>
    normalizedEndpointSeparation(left.sourceNormalizedEndpoints, right.sourceNormalizedEndpoints)
  );
  const worldSeparations = maxPairwise(all, (left, right) =>
    normalizedAnchorSeparation(left.frozenWorldAnchor, right.frozenWorldAnchor, context.floor.worldWidth, context.floor.worldDepth)
  );
  const occupancy = { near_left: 0, near_right: 0, far_left: 0, far_right: 0, outside_or_unavailable: 0 };
  all.forEach((observation) => { occupancy[quadrant(observation.frozenWorldAnchor, context.floor.worldWidth, context.floor.worldDepth)] += 1; });
  const residuals = observations.map((runtime) => runtime.activeRawResidualDeg).filter((value): value is number => value !== null);
  return {
    distinctPhysicalVerticalCount: groups.length,
    observationsPerPhysicalVertical: groups,
    representedWallCount: representedWalls.length,
    representedWalls,
    sameWallOnly: all.length > 0 && representedWalls.length === 1,
    normalizedSourceImageSeparation: sourceSeparations,
    normalizedWorldAnchorSeparation: worldSeparations,
    normalizedObservationLengths: observations.map((runtime) => ({
      observationId: runtime.observation.observationId,
      value: runtime.normalizedSourceLength,
    })),
    floorQuadrantOccupancy: occupancy,
    activeRawResidualSummary: {
      count: residuals.length,
      minimumDeg: residuals.length ? Math.min(...residuals) : null,
      maximumDeg: residuals.length ? Math.max(...residuals) : null,
      rangeDeg: residuals.length ? Math.max(...residuals) - Math.min(...residuals) : null,
      averageDeg: residuals.length ? residuals.reduce((sum, value) => sum + value, 0) / residuals.length : null,
      note: "Read-only raw active-v2 residual observability; not a solver weight or verdict.",
    },
  };
}

export function deriveVerticalEvidenceCollectionRuntime(input: {
  section: VerticalEvidenceSection | null;
  context: VerticalEvidenceRuntimeContext;
  suggestions: readonly VerticalEvidenceSuggestion[];
  structuralObservations: readonly StructuralVerticalObservation[];
}): VerticalEvidenceCollectionRuntime {
  const baseRuntimes = (input.section?.observations ?? []).map((observation) =>
    evaluateVerticalEvidenceObservation(observation, input.context)
  );
  const observations = baseRuntimes.map((runtime) => ({
    ...runtime,
    activeRawResidualDeg: matchCurrentResidual(runtime.observation, input.structuralObservations),
  }));
  const selectedCurrent = observations.filter((runtime) => runtime.eligible);
  const distinctSelectedCurrent = new Set(selectedCurrent.map((runtime) => runtime.observation.physicalVerticalId));
  const assessment: VerticalEvidenceCollectionAssessment =
    distinctSelectedCurrent.size < 2 ||
    selectedCurrent.length === 0 ||
    selectedCurrent.some((runtime) => !finiteFrozenWorldAnchor(runtime.observation.frozenWorldAnchor))
      ? "insufficient"
      : "unclassified";
  return {
    suggestions: input.suggestions,
    observations,
    assessment,
    metrics: buildMetrics(observations, input.context),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStrictIso(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function parseEndpoints(value: unknown): SourceNormalizedEndpoints | null {
  if (!isRecord(value) || !finitePoint(value.lower) || !finitePoint(value.upper)) return null;
  const endpoints = { lower: { ...value.lower }, upper: { ...value.upper } };
  return validSourceNormalizedEndpoints(endpoints) ? endpoints : null;
}

function parseObservation(value: unknown): VerticalEvidenceObservation | null {
  if (!isRecord(value) || value.evidenceModelVersion !== VERTICAL_EVIDENCE_MODEL_VERSION) return null;
  const endpoints = parseEndpoints(value.sourceNormalizedEndpoints);
  if (
    typeof value.observationId !== "string" ||
    typeof value.imageBasisId !== "string" ||
    typeof value.imageBasisFingerprint !== "string" ||
    !finite(value.intrinsicWidth) || value.intrinsicWidth <= 0 ||
    !finite(value.intrinsicHeight) || value.intrinsicHeight <= 0 ||
    !endpoints ||
    !physicalVerticalId(value.physicalVerticalId) ||
    typeof value.suggestionSourceId !== "string" ||
    !wallKind(value.wallKind) ||
    typeof value.wallPolygonKey !== "string" ||
    value.suggestionGeneratorVersion !== VERTICAL_EVIDENCE_SUGGESTION_GENERATOR_VERSION ||
    !isRecord(value.floorProvenance) ||
    typeof value.floorProvenance.floorPolygonKey !== "string" ||
    !finite(value.floorProvenance.worldWidth) || value.floorProvenance.worldWidth <= 0 ||
    !finite(value.floorProvenance.worldDepth) || value.floorProvenance.worldDepth <= 0 ||
    !isRecord(value.frozenWorldAnchor) ||
    !finite(value.frozenWorldAnchor.x) || value.frozenWorldAnchor.y !== 0 || !finite(value.frozenWorldAnchor.z) ||
    typeof value.frozenAnchorDerivationId !== "string" ||
    (value.operatorDecision !== "unreviewed" && value.operatorDecision !== "selected" && value.operatorDecision !== "excluded") ||
    !isRecord(value.historicalContext) ||
    value.historicalContext.nonBinding !== true ||
    (value.historicalContext.cameraVersion !== null && typeof value.historicalContext.cameraVersion !== "string") ||
    (value.historicalContext.cameraAppliedAtIso !== null && !isStrictIso(value.historicalContext.cameraAppliedAtIso)) ||
    (value.historicalContext.frameWidth !== null && (!finite(value.historicalContext.frameWidth) || value.historicalContext.frameWidth <= 0)) ||
    (value.historicalContext.frameHeight !== null && (!finite(value.historicalContext.frameHeight) || value.historicalContext.frameHeight <= 0))
  ) return null;
  if (
    (value.operatorDecision === "unreviewed" && value.decisionAtIso !== null) ||
    (value.operatorDecision !== "unreviewed" && !isStrictIso(value.decisionAtIso))
  ) return null;
  const expectedSuggestionId = buildVerticalEvidenceSuggestionId({
    imageBasisId: value.imageBasisId,
    imageBasisFingerprint: value.imageBasisFingerprint,
    wallKind: value.wallKind,
    wallPolygonKey: value.wallPolygonKey,
    physicalVerticalId: value.physicalVerticalId,
    sourceNormalizedEndpoints: endpoints,
  });
  if (
    value.suggestionSourceId !== expectedSuggestionId ||
    value.observationId !== buildVerticalEvidenceObservationId(expectedSuggestionId) ||
    value.frozenAnchorDerivationId !== buildFrozenAnchorDerivationId({
      floorPolygonKey: value.floorProvenance.floorPolygonKey as string,
      worldWidth: value.floorProvenance.worldWidth as number,
      worldDepth: value.floorProvenance.worldDepth as number,
    })
  ) return null;
  let supersession: VerticalEvidenceObservation["supersession"] = null;
  const rawSupersession = typeof value.supersession === "undefined" ? null : value.supersession;
  if (rawSupersession !== null) {
    if (!isRecord(rawSupersession) || typeof rawSupersession.supersedesObservationId !== "string" || !rawSupersession.supersedesObservationId ||
      typeof rawSupersession.reason !== "string" || !rawSupersession.reason.trim() || !isStrictIso(rawSupersession.atIso)) return null;
    supersession = {
      supersedesObservationId: rawSupersession.supersedesObservationId,
      reason: rawSupersession.reason,
      atIso: rawSupersession.atIso,
    };
  }
  return {
    observationId: value.observationId,
    evidenceModelVersion: VERTICAL_EVIDENCE_MODEL_VERSION,
    imageBasisId: value.imageBasisId,
    imageBasisFingerprint: value.imageBasisFingerprint,
    intrinsicWidth: value.intrinsicWidth,
    intrinsicHeight: value.intrinsicHeight,
    sourceNormalizedEndpoints: endpoints,
    physicalVerticalId: value.physicalVerticalId,
    suggestionSourceId: value.suggestionSourceId,
    wallKind: value.wallKind,
    wallPolygonKey: value.wallPolygonKey,
    suggestionGeneratorVersion: VERTICAL_EVIDENCE_SUGGESTION_GENERATOR_VERSION,
    floorProvenance: {
      floorPolygonKey: value.floorProvenance.floorPolygonKey,
      worldWidth: value.floorProvenance.worldWidth,
      worldDepth: value.floorProvenance.worldDepth,
    },
    frozenWorldAnchor: { x: value.frozenWorldAnchor.x, y: 0, z: value.frozenWorldAnchor.z },
    frozenAnchorDerivationId: value.frozenAnchorDerivationId,
    operatorDecision: value.operatorDecision,
    decisionAtIso: value.decisionAtIso as string | null,
    historicalContext: {
      nonBinding: true,
      cameraVersion: value.historicalContext.cameraVersion,
      cameraAppliedAtIso: value.historicalContext.cameraAppliedAtIso,
      frameWidth: value.historicalContext.frameWidth,
      frameHeight: value.historicalContext.frameHeight,
    },
    supersession,
  };
}

export function parseVerticalEvidenceSection(value: unknown):
  | { kind: "absent" }
  | { kind: "valid"; value: VerticalEvidenceSection }
  | { kind: "degraded"; reason: string } {
  if (typeof value === "undefined") return { kind: "absent" };
  if (!isRecord(value) || value.evidenceModelVersion !== VERTICAL_EVIDENCE_MODEL_VERSION || !Array.isArray(value.observations)) {
    return { kind: "degraded", reason: "vertical evidence section has an unsupported version or malformed shape" };
  }
  const observations = value.observations.map(parseObservation);
  if (observations.some((observation) => !observation)) {
    return { kind: "degraded", reason: "vertical evidence section contains a malformed observation" };
  }
  const valid = observations as VerticalEvidenceObservation[];
  const ids = valid.map((observation) => observation.observationId);
  if (new Set(ids).size !== ids.length) return { kind: "degraded", reason: "vertical evidence section contains duplicate observation IDs" };
  return {
    kind: "valid",
    value: {
      evidenceModelVersion: VERTICAL_EVIDENCE_MODEL_VERSION,
      observations: valid.sort((left, right) => left.observationId.localeCompare(right.observationId)),
    },
  };
}

export function serializeVerticalEvidenceSection(section: VerticalEvidenceSection | null): VerticalEvidenceSection | undefined {
  if (!section) return undefined;
  return {
    evidenceModelVersion: VERTICAL_EVIDENCE_MODEL_VERSION,
    observations: [...section.observations]
      .sort((left, right) => left.observationId.localeCompare(right.observationId))
      .map((observation) => ({
        ...observation,
        sourceNormalizedEndpoints: copyEndpoints(observation.sourceNormalizedEndpoints),
        floorProvenance: { ...observation.floorProvenance },
        frozenWorldAnchor: { ...observation.frozenWorldAnchor },
        historicalContext: { ...observation.historicalContext },
        supersession: observation.supersession ? { ...observation.supersession } : null,
      })),
  };
}
