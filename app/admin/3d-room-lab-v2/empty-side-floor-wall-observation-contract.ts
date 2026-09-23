import type {
  EmptyRoomObservationFailureDiagnostic,
  RoomObservationImageIdentity,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";

export const AFC_V2_EMPTY_SIDE_FLOOR_WALL_OBSERVATION_VERSION =
  "afc-v2-empty-side-floor-wall-observation/v1" as const;
export const AFC_V2_EMPTY_SIDE_FLOOR_WALL_COORDINATE_SPACE =
  "empty-source-normalized-image/v1" as const;
export const AFC_V2_EMPTY_SIDE_FLOOR_WALL_AUTHORITY =
  "observation_only" as const;

export type FocusedSideFloorWallSide = "left" | "right";

export type FocusedSideFloorWallSideEvidence = Readonly<{
  side: FocusedSideFloorWallSide;
  wallPlaneVisible: true;
  sourceNormalizedWallPolygon: readonly SourceNormalizedPoint[] | null;
  sourceNormalizedFloorWallPolyline: readonly SourceNormalizedPoint[] | null;
  confidence: number;
  ambiguity: string | null;
  frameTruncated: boolean;
  noEvidenceReason: string | null;
  evidenceClass: "provider_reported_visible_evidence";
}>;

type CommonFocusedEvidence = Readonly<{
  schemaVersion: typeof AFC_V2_EMPTY_SIDE_FLOOR_WALL_OBSERVATION_VERSION;
  basis: Readonly<{
    kind: "EMPTY";
    identity: RoomObservationImageIdentity;
    originalAncestorSha256: string;
    attemptId: string;
    loadGeneration: number;
    exactRetainedBytesConsumed: true;
  }>;
  coordinateSpace: typeof AFC_V2_EMPTY_SIDE_FLOOR_WALL_COORDINATE_SPACE;
  authority: typeof AFC_V2_EMPTY_SIDE_FLOOR_WALL_AUTHORITY;
  observer: Readonly<{
    provider: string;
    model: string;
    profile: string;
    promptVersion: string;
    generatedAt: string;
  }>;
  authoritySeparation: Readonly<{
    cameraAuthorityConsumed: false;
    floorAuthorityConsumed: false;
    worldProjectionPerformed: false;
    tiledEvidenceConsumed: false;
    fullyTiledEvidenceConsumed: false;
  }>;
}>;

export type FocusedSideFloorWallAcceptedEvidence = CommonFocusedEvidence & Readonly<{
  observerStatus: "observed" | "partial";
  observedSides: readonly FocusedSideFloorWallSideEvidence[];
  qualityGate: Readonly<{
    status: "accepted" | "partial";
    rejectedForbiddenProviderFields: readonly string[];
    parserRejections: readonly Readonly<{
      kind: "side" | "plane" | "seam";
      rawId: string | null;
      reason: string;
    }>[];
    unresolved: readonly string[];
    partialReasons: readonly string[];
    geometryManufactured: false;
    hiddenContinuationAdded: false;
  }>;
  failure: null;
}>;

export type FocusedSideFloorWallFailedEvidence = CommonFocusedEvidence & Readonly<{
  observerStatus: "failed";
  observedSides: readonly [];
  qualityGate: Readonly<{
    status: "failed";
    rejectedForbiddenProviderFields: readonly [];
    parserRejections: readonly [];
    unresolved: readonly [];
    partialReasons: readonly [];
    geometryManufactured: false;
    hiddenContinuationAdded: false;
  }>;
  failure: EmptyRoomObservationFailureDiagnostic;
}>;

export type FocusedSideFloorWallEvidence =
  | FocusedSideFloorWallAcceptedEvidence
  | FocusedSideFloorWallFailedEvidence;

export type FocusedSideFloorWallEvidenceContext = Readonly<{
  attemptId: string;
  loadGeneration: number;
  emptyIdentity: RoomObservationImageIdentity;
  originalAncestorSha256: string;
  provider: EmptyRoomObservationFailureDiagnostic["provider"];
  model: string;
  observerProfile: string;
  promptVersion: string;
  generatedAt: string;
}>;

const MAX_SIDES = 4;
const MAX_POINTS = 96;
const MIN_POLYLINE_LENGTH = 0.0001;
const MIN_POLYGON_AREA = 0.000001;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function point(value: unknown): SourceNormalizedPoint | null {
  const candidate = record(value);
  return candidate &&
      typeof candidate.x === "number" &&
      typeof candidate.y === "number" &&
      Number.isFinite(candidate.x) &&
      Number.isFinite(candidate.y) &&
      candidate.x >= 0 &&
      candidate.x <= 1 &&
      candidate.y >= 0 &&
      candidate.y <= 1
    ? Object.freeze({ x: candidate.x, y: candidate.y })
    : null;
}

function polylineLength(points: readonly SourceNormalizedPoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(
      points[index].x - points[index - 1].x,
      points[index].y - points[index - 1].y,
    );
  }
  return length;
}

function polygonArea(points: readonly SourceNormalizedPoint[]): number {
  return Math.abs(points.reduce((sum, item, index) => {
    const next = points[(index + 1) % points.length];
    return sum + item.x * next.y - next.x * item.y;
  }, 0)) / 2;
}

function points(
  value: unknown,
  minimum: number,
): readonly SourceNormalizedPoint[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > MAX_POINTS) {
    return null;
  }
  const parsed = value.map(point);
  if (!parsed.every((item): item is SourceNormalizedPoint => item !== null)) {
    return null;
  }
  if (minimum >= 3) {
    return polygonArea(parsed) >= MIN_POLYGON_AREA ? Object.freeze(parsed) : null;
  }
  if (polylineLength(parsed) < MIN_POLYLINE_LENGTH) return null;
  for (let index = 1; index < parsed.length; index += 1) {
    if (
      parsed[index].x === parsed[index - 1].x &&
      parsed[index].y === parsed[index - 1].y
    ) {
      return null;
    }
  }
  return Object.freeze(parsed);
}

function common(
  context: FocusedSideFloorWallEvidenceContext,
): CommonFocusedEvidence {
  return Object.freeze({
    schemaVersion: AFC_V2_EMPTY_SIDE_FLOOR_WALL_OBSERVATION_VERSION,
    basis: Object.freeze({
      kind: "EMPTY" as const,
      identity: context.emptyIdentity,
      originalAncestorSha256: context.originalAncestorSha256,
      attemptId: context.attemptId,
      loadGeneration: context.loadGeneration,
      exactRetainedBytesConsumed: true as const,
    }),
    coordinateSpace: AFC_V2_EMPTY_SIDE_FLOOR_WALL_COORDINATE_SPACE,
    authority: AFC_V2_EMPTY_SIDE_FLOOR_WALL_AUTHORITY,
    observer: Object.freeze({
      provider: context.provider,
      model: context.model,
      profile: context.observerProfile,
      promptVersion: context.promptVersion,
      generatedAt: context.generatedAt,
    }),
    authoritySeparation: Object.freeze({
      cameraAuthorityConsumed: false as const,
      floorAuthorityConsumed: false as const,
      worldProjectionPerformed: false as const,
      tiledEvidenceConsumed: false as const,
      fullyTiledEvidenceConsumed: false as const,
    }),
  });
}

/**
 * Maps untrusted focused-pass JSON into left/right side floor-wall evidence.
 * Invalid primitives are omitted. Geometry is never extended or invented.
 */
export function buildFocusedSideFloorWallEvidence(
  raw: unknown,
  context: FocusedSideFloorWallEvidenceContext,
): FocusedSideFloorWallAcceptedEvidence {
  const root = record(raw) ?? {};
  const parserRejections: {
    kind: "side" | "plane" | "seam";
    rawId: string | null;
    reason: string;
  }[] = [];
  const seenSides = new Set<FocusedSideFloorWallSide>();
  const sides: FocusedSideFloorWallSideEvidence[] = [];
  const rawSides = Array.isArray(root.observedSides)
    ? root.observedSides.slice(0, MAX_SIDES)
    : [];
  for (const value of rawSides) {
    const candidate = record(value);
    const side = candidate?.side === "left" || candidate?.side === "right"
      ? candidate.side
      : null;
    const certainty = typeof candidate?.confidence === "number" &&
        Number.isFinite(candidate.confidence) &&
        candidate.confidence >= 0 &&
        candidate.confidence <= 1
      ? candidate.confidence
      : null;
    const ambiguity = typeof candidate?.ambiguity === "string"
      ? candidate.ambiguity.replace(/\s+/g, " ").trim().slice(0, 240) || null
      : null;
    const noEvidenceReason = typeof candidate?.noEvidenceReason === "string"
      ? candidate.noEvidenceReason.replace(/\s+/g, " ").trim().slice(0, 240) ||
        null
      : null;
    const polygon = candidate?.sourceNormalizedWallPolygon == null
      ? null
      : points(candidate.sourceNormalizedWallPolygon, 3);
    const polyline = candidate?.sourceNormalizedFloorWallPolyline == null
      ? null
      : points(candidate.sourceNormalizedFloorWallPolyline, 2);
    if (
      !candidate ||
      !side ||
      certainty === null ||
      candidate.visibility !== "observed"
    ) {
      parserRejections.push(Object.freeze({
        kind: "side" as const,
        rawId: side,
        reason: "malformed_or_nonvisible_focused_side_floor_wall",
      }));
      continue;
    }
    if (candidate.wallPlaneVisible !== true) {
      continue;
    }
    if (seenSides.has(side)) {
      parserRejections.push(Object.freeze({
        kind: "side" as const,
        rawId: side,
        reason: "duplicate_focused_side",
      }));
      continue;
    }
    if (candidate.sourceNormalizedWallPolygon != null && !polygon) {
      parserRejections.push(Object.freeze({
        kind: "plane" as const,
        rawId: side,
        reason: "malformed_focused_side_wall_polygon",
      }));
    }
    if (candidate.sourceNormalizedFloorWallPolyline != null && !polyline) {
      parserRejections.push(Object.freeze({
        kind: "seam" as const,
        rawId: side,
        reason: "malformed_focused_side_floor_wall_polyline",
      }));
    }
    seenSides.add(side);
    sides.push(Object.freeze({
      side,
      wallPlaneVisible: true as const,
      sourceNormalizedWallPolygon: polygon,
      sourceNormalizedFloorWallPolyline: polyline,
      confidence: certainty,
      ambiguity,
      frameTruncated: candidate.frameTruncated === true,
      noEvidenceReason,
      evidenceClass: "provider_reported_visible_evidence" as const,
    }));
  }

  const forbiddenProviderFields = [
    "camera",
    "calibratedCamera",
    "cameraPose",
    "fov",
    "verticalFovDeg",
    "floorAuthority",
    "authoritativeFloorQuad",
    "worldPlanes",
    "worldGeometry",
    "worldCoordinates",
    "wallHeights",
    "roomMesh",
    "collisionSurfaces",
    "supportSurfaces",
    "fullyTiled",
    "tiled",
  ].filter((field) => field in root);
  const unresolved = Array.isArray(root.unresolved)
    ? Object.freeze(
      root.unresolved
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.replace(/\s+/g, " ").trim().slice(0, 240))
        .filter(Boolean)
        .slice(0, 24),
    )
    : Object.freeze([] as string[]);
  const partialReasons = Object.freeze([
    ...(forbiddenProviderFields.length > 0
      ? ["provider_returned_forbidden_authority_or_world_fields"]
      : []),
    ...(parserRejections.length > 0 ? ["provider_primitives_rejected"] : []),
    ...(unresolved.length > 0 ? ["provider_or_topology_uncertainty_remains"] : []),
  ]);
  const status = partialReasons.length > 0
    ? "partial" as const
    : "accepted" as const;

  return Object.freeze({
    ...common(context),
    observerStatus: status === "accepted" ? "observed" as const : "partial" as const,
    observedSides: Object.freeze(sides),
    qualityGate: Object.freeze({
      status,
      rejectedForbiddenProviderFields: Object.freeze(forbiddenProviderFields),
      parserRejections: Object.freeze(parserRejections),
      unresolved,
      partialReasons,
      geometryManufactured: false as const,
      hiddenContinuationAdded: false as const,
    }),
    failure: null,
  });
}

export function buildFailedFocusedSideFloorWallEvidence(
  context: FocusedSideFloorWallEvidenceContext,
  failure: EmptyRoomObservationFailureDiagnostic,
): FocusedSideFloorWallFailedEvidence {
  return Object.freeze({
    ...common(context),
    observerStatus: "failed",
    observedSides: [] as const,
    qualityGate: Object.freeze({
      status: "failed" as const,
      rejectedForbiddenProviderFields: [] as const,
      parserRejections: [] as const,
      unresolved: [] as const,
      partialReasons: [] as const,
      geometryManufactured: false as const,
      hiddenContinuationAdded: false as const,
    }),
    failure,
  });
}

export function buildEmptyFocusedSideFloorWallEvidence(
  context: FocusedSideFloorWallEvidenceContext,
): FocusedSideFloorWallAcceptedEvidence {
  return buildFocusedSideFloorWallEvidence({
    observedSides: [],
    unresolved: [],
  }, context);
}
