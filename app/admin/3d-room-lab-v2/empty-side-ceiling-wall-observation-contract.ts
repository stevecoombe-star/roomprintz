import type {
  EmptyRoomObservationFailureDiagnostic,
  RoomObservationImageIdentity,
  SourceNormalizedPoint,
} from "./empty-room-observation-contract";

export const AFC_V2_EMPTY_SIDE_CEILING_WALL_OBSERVATION_VERSION =
  "afc-v2-empty-side-ceiling-wall-observation/v1" as const;
export const AFC_V2_EMPTY_SIDE_CEILING_WALL_COORDINATE_SPACE =
  "empty-source-normalized-image/v1" as const;
export const AFC_V2_EMPTY_SIDE_CEILING_WALL_AUTHORITY =
  "observation_only" as const;

export type FocusedSideCeilingWallSeam = Readonly<{
  id: string;
  category: "wall_ceiling";
  sourceNormalizedPolyline: readonly SourceNormalizedPoint[];
  endpointPolicy: "preserve_observed_open_endpoints";
  confidence: number;
  ambiguity: string | null;
  evidenceClass: "provider_reported_visible_evidence";
}>;

type CommonFocusedEvidence = Readonly<{
  schemaVersion: typeof AFC_V2_EMPTY_SIDE_CEILING_WALL_OBSERVATION_VERSION;
  basis: Readonly<{
    kind: "EMPTY";
    identity: RoomObservationImageIdentity;
    originalAncestorSha256: string;
    attemptId: string;
    loadGeneration: number;
    exactRetainedBytesConsumed: true;
  }>;
  coordinateSpace: typeof AFC_V2_EMPTY_SIDE_CEILING_WALL_COORDINATE_SPACE;
  authority: typeof AFC_V2_EMPTY_SIDE_CEILING_WALL_AUTHORITY;
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

export type FocusedSideCeilingWallAcceptedEvidence = CommonFocusedEvidence & Readonly<{
  observerStatus: "observed" | "partial";
  observedSeams: readonly FocusedSideCeilingWallSeam[];
  qualityGate: Readonly<{
    status: "accepted" | "partial";
    rejectedForbiddenProviderFields: readonly string[];
    parserRejections: readonly Readonly<{
      kind: "seam";
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

export type FocusedSideCeilingWallFailedEvidence = CommonFocusedEvidence & Readonly<{
  observerStatus: "failed";
  observedSeams: readonly [];
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

export type FocusedSideCeilingWallEvidence =
  | FocusedSideCeilingWallAcceptedEvidence
  | FocusedSideCeilingWallFailedEvidence;

export type FocusedSideCeilingWallEvidenceContext = Readonly<{
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

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const MAX_SEAMS = 8;
const MAX_POINTS = 96;
const MIN_POLYLINE_LENGTH = 0.0001;

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

function points(value: unknown): readonly SourceNormalizedPoint[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_POINTS) {
    return null;
  }
  const parsed = value.map(point);
  if (!parsed.every((item): item is SourceNormalizedPoint => item !== null)) {
    return null;
  }
  let length = 0;
  for (let index = 1; index < parsed.length; index += 1) {
    const segment = Math.hypot(
      parsed[index].x - parsed[index - 1].x,
      parsed[index].y - parsed[index - 1].y,
    );
    if (segment === 0) return null;
    length += segment;
  }
  return length >= MIN_POLYLINE_LENGTH ? Object.freeze(parsed) : null;
}

function common(
  context: FocusedSideCeilingWallEvidenceContext,
): CommonFocusedEvidence {
  return Object.freeze({
    schemaVersion: AFC_V2_EMPTY_SIDE_CEILING_WALL_OBSERVATION_VERSION,
    basis: Object.freeze({
      kind: "EMPTY" as const,
      identity: context.emptyIdentity,
      originalAncestorSha256: context.originalAncestorSha256,
      attemptId: context.attemptId,
      loadGeneration: context.loadGeneration,
      exactRetainedBytesConsumed: true as const,
    }),
    coordinateSpace: AFC_V2_EMPTY_SIDE_CEILING_WALL_COORDINATE_SPACE,
    authority: AFC_V2_EMPTY_SIDE_CEILING_WALL_AUTHORITY,
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
 * Maps untrusted focused-pass JSON into wall-ceiling-only image seams.
 * Invalid primitives are omitted. Geometry is never extended or invented.
 */
export function buildFocusedSideCeilingWallEvidence(
  raw: unknown,
  context: FocusedSideCeilingWallEvidenceContext,
): FocusedSideCeilingWallAcceptedEvidence {
  const root = record(raw) ?? {};
  const parserRejections: {
    kind: "seam";
    rawId: string | null;
    reason: string;
  }[] = [];
  const seamIds = new Set<string>();
  const seams: FocusedSideCeilingWallSeam[] = [];
  const rawSeams = Array.isArray(root.observedSeams)
    ? root.observedSeams.slice(0, MAX_SEAMS)
    : [];
  for (const value of rawSeams) {
    const candidate = record(value);
    const rawId = typeof candidate?.id === "string" ? candidate.id : null;
    const id = rawId && ID_PATTERN.test(rawId) && !seamIds.has(rawId)
      ? rawId
      : null;
    if (id) seamIds.add(id);
    const polyline = points(candidate?.sourceNormalizedPolyline);
    const certainty = typeof candidate?.confidence === "number" &&
        Number.isFinite(candidate.confidence) &&
        candidate.confidence >= 0 &&
        candidate.confidence <= 1
      ? candidate.confidence
      : null;
    const ambiguity = typeof candidate?.ambiguity === "string"
      ? candidate.ambiguity.replace(/\s+/g, " ").trim().slice(0, 240) || null
      : null;
    if (
      !candidate ||
      !id ||
      candidate.category !== "wall_ceiling" ||
      !polyline ||
      certainty === null ||
      candidate.visibility !== "observed"
    ) {
      parserRejections.push(Object.freeze({
        kind: "seam" as const,
        rawId: rawId && ID_PATTERN.test(rawId) ? rawId : null,
        reason: candidate?.category && candidate.category !== "wall_ceiling"
          ? "focused_pass_rejected_non_wall_ceiling_seam"
          : "malformed_or_nonvisible_focused_side_seam",
      }));
      if (id) seamIds.delete(id);
      continue;
    }
    seams.push(Object.freeze({
      id,
      category: "wall_ceiling" as const,
      sourceNormalizedPolyline: polyline,
      endpointPolicy: "preserve_observed_open_endpoints" as const,
      confidence: certainty,
      ambiguity,
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
    observedSeams: Object.freeze(seams),
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

export function buildFailedFocusedSideCeilingWallEvidence(
  context: FocusedSideCeilingWallEvidenceContext,
  failure: EmptyRoomObservationFailureDiagnostic,
): FocusedSideCeilingWallFailedEvidence {
  return Object.freeze({
    ...common(context),
    observerStatus: "failed",
    observedSeams: [] as const,
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

export function buildEmptyFocusedSideCeilingWallEvidence(
  context: FocusedSideCeilingWallEvidenceContext,
): FocusedSideCeilingWallAcceptedEvidence {
  return buildFocusedSideCeilingWallEvidence({
    observedSeams: [],
    unresolved: [],
  }, context);
}
