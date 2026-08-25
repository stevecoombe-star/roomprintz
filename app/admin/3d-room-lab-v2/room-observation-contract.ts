export const AFC_V2_ROOM_OBSERVATION_VERSION =
  "afc-v2-room-observation/v1" as const;
export const AFC_V2_ROOM_OBSERVATION_COORDINATE_SPACE =
  "fully-tiled-source-normalized-image/v1" as const;

export type RoomObservationImageIdentity = Readonly<{
  sha256: string;
  byteCount: number;
  decodedWidth: number;
  decodedHeight: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  orientation: 1;
}>;

export type SourceNormalizedPoint = Readonly<{ x: number; y: number }>;
export type SourceNormalizedSegment = Readonly<{
  start: SourceNormalizedPoint;
  end: SourceNormalizedPoint;
}>;

export type ObservedPlaneCategory =
  | "floor"
  | "wall"
  | "ceiling"
  | "unknown";
export type ObservedSeamCategory =
  | "floor_wall"
  | "wall_wall"
  | "wall_ceiling"
  | "unknown";
export type ObservedOpeningCategory =
  | "window"
  | "door"
  | "passage"
  | "unknown_discontinuity";

export type ObservedPlane = Readonly<{
  id: string;
  category: ObservedPlaneCategory;
  imagePolygon: readonly SourceNormalizedPoint[];
  gridFamilyIds: readonly string[];
  confidence: number;
  ambiguity: string | null;
  evidenceClass: "provider_reported_visible_evidence";
}>;

export type ObservedGridFamily = Readonly<{
  id: string;
  planeId: string;
  axis: "axis_a" | "axis_b" | "unresolved";
  lineSegments: readonly SourceNormalizedSegment[];
  confidence: number;
  evidenceClass: "provider_reported_visible_evidence";
}>;

export type ObservedSeam = Readonly<{
  id: string;
  category: ObservedSeamCategory;
  planeIds: readonly string[];
  imagePolyline: readonly SourceNormalizedPoint[];
  confidence: number;
  ambiguity: string | null;
  evidenceClass: "provider_reported_visible_evidence";
}>;

export type ObservedOpening = Readonly<{
  id: string;
  category: ObservedOpeningCategory;
  hostPlaneId: string | null;
  imageBoundary: readonly SourceNormalizedPoint[];
  confidence: number;
  ambiguity: string | null;
  tiledFieldInterruption: true;
  evidenceClass: "provider_reported_visible_evidence";
}>;

export type ObservedAdjacency = Readonly<{
  id: string;
  planeAId: string;
  planeBId: string;
  seamId: string;
  confidence: number;
  evidenceClass: "conservative_seam_supported_inference";
}>;

export type RoomObservationContract = Readonly<{
  representationIdentity: Readonly<{
    kind: "FULLY_TILED";
    identity: RoomObservationImageIdentity;
    generatedFrom: "ORIGINAL";
    parentOriginalSha256: string;
    generationId: string;
  }>;
  observationVersion: typeof AFC_V2_ROOM_OBSERVATION_VERSION;
  sourceBasis: Readonly<{
    coordinateSpace: typeof AFC_V2_ROOM_OBSERVATION_COORDINATE_SPACE;
    original: RoomObservationImageIdentity;
    fullyTiled: RoomObservationImageIdentity;
    primitivesBasis: "FULLY_TILED";
    calibratedFloorReferenceBasis: "FULLY_TILED";
    cameraRealizationBasis: "ORIGINAL";
    transfer: "aspect_ratio_compatible_source_normalized";
    crossBasisAlignment: "generation_prompt_preserved_not_pixel_verified";
  }>;
  calibratedCameraReference: Readonly<{
    authority: "certified_floor_camera";
    attemptId: string;
    floorResultId: string;
    authorityKey: string;
    originalBasisSha256: string;
    frozenSnapshotDigest: string;
    role: "consumed_reference_only";
  }>;
  observedPlanes: readonly ObservedPlane[];
  observedSeams: readonly ObservedSeam[];
  observedOpenings: readonly ObservedOpening[];
  observedGridFamilies: readonly ObservedGridFamily[];
  adjacency: readonly ObservedAdjacency[];
  diagnostics: Readonly<{
    provider: string;
    model: string;
    promptVersion: string;
    generatedAt: string;
    rejected: Readonly<{
      planes: number;
      gridFamilies: number;
      seams: number;
      openings: number;
      adjacency: number;
    }>;
    unresolved: readonly string[];
    worldGeometryProduced: false;
    providerEvidenceStatus:
      "schema_validated_provider_report_not_pixel_verified";
    hiddenSurfacePolicy: "prohibited_and_explicit_hidden_claims_filtered";
    cameraAuthority: "certified_floor_camera_reference_only";
  }>;
}>;

type ContractContext = Readonly<{
  originalIdentity: RoomObservationImageIdentity;
  fullyTiledIdentity: RoomObservationImageIdentity;
  generationId: string;
  attemptId: string;
  floorResultId: string;
  cameraAuthorityKey: string;
  frozenSnapshotDigest: string;
  provider: string;
  model: string;
  promptVersion: string;
  generatedAt: string;
}>;

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const MAX_PLANES = 16;
const MAX_GRID_FAMILIES = 32;
const MAX_SEGMENTS_PER_FAMILY = 64;
const MAX_SEAMS = 32;
const MAX_OPENINGS = 32;
const MAX_ADJACENCY = 64;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function confidence(value: unknown): number | null {
  return typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value <= 1
    ? value
    : null;
}

function point(value: unknown): SourceNormalizedPoint | null {
  const candidate = record(value);
  if (
    !candidate ||
    typeof candidate.x !== "number" ||
    typeof candidate.y !== "number" ||
    !Number.isFinite(candidate.x) ||
    !Number.isFinite(candidate.y) ||
    candidate.x < 0 ||
    candidate.x > 1 ||
    candidate.y < 0 ||
    candidate.y > 1
  ) {
    return null;
  }
  return Object.freeze({ x: candidate.x, y: candidate.y });
}

function points(
  value: unknown,
  minimum: number,
  maximum = 64,
): readonly SourceNormalizedPoint[] | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    return null;
  }
  const parsed = value.map(point);
  return parsed.every((candidate): candidate is SourceNormalizedPoint =>
    candidate !== null
  )
    ? Object.freeze(parsed)
    : null;
}

function segment(value: unknown): SourceNormalizedSegment | null {
  const candidate = record(value);
  const start = point(candidate?.start);
  const end = point(candidate?.end);
  if (
    !start ||
    !end ||
    (start.x === end.x && start.y === end.y)
  ) {
    return null;
  }
  return Object.freeze({ start, end });
}

function ambiguity(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 240) : null;
}

function id(value: unknown): string | null {
  return typeof value === "string" && ID_PATTERN.test(value) ? value : null;
}

function uniqueId(value: unknown, seen: Set<string>): string | null {
  const parsed = id(value);
  if (!parsed || seen.has(parsed)) return null;
  seen.add(parsed);
  return parsed;
}

function planeCategory(value: unknown): ObservedPlaneCategory {
  return value === "floor" || value === "wall" || value === "ceiling"
    ? value
    : "unknown";
}

function seamCategory(value: unknown): ObservedSeamCategory {
  return value === "floor_wall" ||
      value === "wall_wall" ||
      value === "wall_ceiling"
    ? value
    : "unknown";
}

function openingCategory(value: unknown): ObservedOpeningCategory {
  return value === "window" || value === "door" || value === "passage"
    ? value
    : "unknown_discontinuity";
}

/**
 * Maps untrusted provider JSON into the V2-S3 contract. Invalid, unbound, or
 * hidden/inferred evidence is dropped; an empty observation set remains a
 * valid conservative result.
 */
export function buildRoomObservationContract(
  raw: unknown,
  context: ContractContext,
): RoomObservationContract {
  const root = record(raw) ?? {};
  const rejected = {
    planes: 0,
    gridFamilies: 0,
    seams: 0,
    openings: 0,
    adjacency: 0,
  };

  const planeIds = new Set<string>();
  const rawPlanes = Array.isArray(root.observedPlanes)
    ? root.observedPlanes.slice(0, MAX_PLANES)
    : [];
  const planesWithoutGridIds: Omit<ObservedPlane, "gridFamilyIds">[] = [];
  for (const value of rawPlanes) {
    const candidate = record(value);
    const planeId = uniqueId(candidate?.id, planeIds);
    const imagePolygon = points(candidate?.imagePolygon, 3);
    const certainty = confidence(candidate?.confidence);
    if (
      !candidate ||
      !planeId ||
      !imagePolygon ||
      certainty === null ||
      candidate.visibility !== "observed"
    ) {
      rejected.planes += 1;
      if (planeId) planeIds.delete(planeId);
      continue;
    }
    planesWithoutGridIds.push(Object.freeze({
      id: planeId,
      category: planeCategory(candidate.category),
      imagePolygon,
      confidence: certainty,
      ambiguity: ambiguity(candidate.ambiguity),
      evidenceClass: "provider_reported_visible_evidence",
    }));
  }

  const gridIds = new Set<string>();
  const rawGridFamilies = Array.isArray(root.observedGridFamilies)
    ? root.observedGridFamilies.slice(0, MAX_GRID_FAMILIES)
    : [];
  const observedGridFamilies: ObservedGridFamily[] = [];
  for (const value of rawGridFamilies) {
    const candidate = record(value);
    const gridId = uniqueId(candidate?.id, gridIds);
    const planeId = id(candidate?.planeId);
    const certainty = confidence(candidate?.confidence);
    const rawSegments = Array.isArray(candidate?.lineSegments)
      ? candidate.lineSegments.slice(0, MAX_SEGMENTS_PER_FAMILY)
      : [];
    const lineSegments = rawSegments.map(segment);
    if (
      !candidate ||
      !gridId ||
      !planeId ||
      !planeIds.has(planeId) ||
      certainty === null ||
      candidate.visibility !== "observed" ||
      lineSegments.length === 0 ||
      !lineSegments.every((item): item is SourceNormalizedSegment => item !== null)
    ) {
      rejected.gridFamilies += 1;
      if (gridId) gridIds.delete(gridId);
      continue;
    }
    observedGridFamilies.push(Object.freeze({
      id: gridId,
      planeId,
      axis: candidate.axis === "axis_a" || candidate.axis === "axis_b"
        ? candidate.axis
        : "unresolved",
      lineSegments: Object.freeze(lineSegments),
      confidence: certainty,
      evidenceClass: "provider_reported_visible_evidence",
    }));
  }

  const observedPlanes: ObservedPlane[] = planesWithoutGridIds.map((plane) =>
    Object.freeze({
      ...plane,
      gridFamilyIds: Object.freeze(
        observedGridFamilies
          .filter((family) => family.planeId === plane.id)
          .map((family) => family.id),
      ),
    })
  );

  const seamIds = new Set<string>();
  const rawSeams = Array.isArray(root.observedSeams)
    ? root.observedSeams.slice(0, MAX_SEAMS)
    : [];
  const observedSeams: ObservedSeam[] = [];
  for (const value of rawSeams) {
    const candidate = record(value);
    const seamId = uniqueId(candidate?.id, seamIds);
    const imagePolyline = points(candidate?.imagePolyline, 2);
    const certainty = confidence(candidate?.confidence);
    const referencedPlaneIds = Array.isArray(candidate?.planeIds)
      ? [...new Set(candidate.planeIds.map(id).filter((item): item is string =>
        item !== null && planeIds.has(item)
      ))].slice(0, 2)
      : [];
    if (
      !candidate ||
      !seamId ||
      !imagePolyline ||
      certainty === null ||
      candidate.visibility !== "observed" ||
      referencedPlaneIds.length === 0
    ) {
      rejected.seams += 1;
      if (seamId) seamIds.delete(seamId);
      continue;
    }
    observedSeams.push(Object.freeze({
      id: seamId,
      category: seamCategory(candidate.category),
      planeIds: Object.freeze(referencedPlaneIds),
      imagePolyline,
      confidence: certainty,
      ambiguity: ambiguity(candidate.ambiguity),
      evidenceClass: "provider_reported_visible_evidence",
    }));
  }

  const openingIds = new Set<string>();
  const rawOpenings = Array.isArray(root.observedOpenings)
    ? root.observedOpenings.slice(0, MAX_OPENINGS)
    : [];
  const observedOpenings: ObservedOpening[] = [];
  for (const value of rawOpenings) {
    const candidate = record(value);
    const openingId = uniqueId(candidate?.id, openingIds);
    const imageBoundary = points(candidate?.imageBoundary, 3);
    const certainty = confidence(candidate?.confidence);
    const parsedHostPlaneId = candidate?.hostPlaneId === null
      ? null
      : id(candidate?.hostPlaneId);
    if (
      !candidate ||
      !openingId ||
      !imageBoundary ||
      certainty === null ||
      candidate.visibility !== "observed" ||
      (parsedHostPlaneId !== null && !planeIds.has(parsedHostPlaneId))
    ) {
      rejected.openings += 1;
      if (openingId) openingIds.delete(openingId);
      continue;
    }
    observedOpenings.push(Object.freeze({
      id: openingId,
      category: openingCategory(candidate.category),
      hostPlaneId: parsedHostPlaneId,
      imageBoundary,
      confidence: certainty,
      ambiguity: ambiguity(candidate.ambiguity),
      tiledFieldInterruption: true,
      evidenceClass: "provider_reported_visible_evidence",
    }));
  }

  const adjacencyIds = new Set<string>();
  const rawAdjacency = Array.isArray(root.adjacency)
    ? root.adjacency.slice(0, MAX_ADJACENCY)
    : [];
  const adjacency: ObservedAdjacency[] = [];
  for (const value of rawAdjacency) {
    const candidate = record(value);
    const adjacencyId = uniqueId(candidate?.id, adjacencyIds);
    const planeAId = id(candidate?.planeAId);
    const planeBId = id(candidate?.planeBId);
    const seamId = id(candidate?.seamId);
    const certainty = confidence(candidate?.confidence);
    const seam = observedSeams.find((item) => item.id === seamId);
    if (
      !candidate ||
      !adjacencyId ||
      !planeAId ||
      !planeBId ||
      planeAId === planeBId ||
      !seamId ||
      !seam ||
      certainty === null ||
      !seam.planeIds.includes(planeAId) ||
      !seam.planeIds.includes(planeBId)
    ) {
      rejected.adjacency += 1;
      if (adjacencyId) adjacencyIds.delete(adjacencyId);
      continue;
    }
    adjacency.push(Object.freeze({
      id: adjacencyId,
      planeAId,
      planeBId,
      seamId,
      confidence: certainty,
      evidenceClass: "conservative_seam_supported_inference",
    }));
  }

  const unresolved = Array.isArray(root.unresolved)
    ? root.unresolved
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().slice(0, 240))
      .filter(Boolean)
      .slice(0, 32)
    : [];

  return Object.freeze({
    representationIdentity: Object.freeze({
      kind: "FULLY_TILED",
      identity: context.fullyTiledIdentity,
      generatedFrom: "ORIGINAL",
      parentOriginalSha256: context.originalIdentity.sha256,
      generationId: context.generationId,
    }),
    observationVersion: AFC_V2_ROOM_OBSERVATION_VERSION,
    sourceBasis: Object.freeze({
      coordinateSpace: AFC_V2_ROOM_OBSERVATION_COORDINATE_SPACE,
      original: context.originalIdentity,
      fullyTiled: context.fullyTiledIdentity,
      primitivesBasis: "FULLY_TILED",
      calibratedFloorReferenceBasis: "FULLY_TILED",
      cameraRealizationBasis: "ORIGINAL",
      transfer: "aspect_ratio_compatible_source_normalized",
      crossBasisAlignment: "generation_prompt_preserved_not_pixel_verified",
    }),
    calibratedCameraReference: Object.freeze({
      authority: "certified_floor_camera",
      attemptId: context.attemptId,
      floorResultId: context.floorResultId,
      authorityKey: context.cameraAuthorityKey,
      originalBasisSha256: context.originalIdentity.sha256,
      frozenSnapshotDigest: context.frozenSnapshotDigest,
      role: "consumed_reference_only",
    }),
    observedPlanes: Object.freeze(observedPlanes),
    observedSeams: Object.freeze(observedSeams),
    observedOpenings: Object.freeze(observedOpenings),
    observedGridFamilies: Object.freeze(observedGridFamilies),
    adjacency: Object.freeze(adjacency),
    diagnostics: Object.freeze({
      provider: context.provider,
      model: context.model,
      promptVersion: context.promptVersion,
      generatedAt: context.generatedAt,
      rejected: Object.freeze(rejected),
      unresolved: Object.freeze(unresolved),
      worldGeometryProduced: false,
      providerEvidenceStatus:
        "schema_validated_provider_report_not_pixel_verified",
      hiddenSurfacePolicy: "prohibited_and_explicit_hidden_claims_filtered",
      cameraAuthority: "certified_floor_camera_reference_only",
    }),
  });
}
