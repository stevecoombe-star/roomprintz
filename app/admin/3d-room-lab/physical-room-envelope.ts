export const PHYSICAL_ROOM_ENVELOPE_VERSION = "physical-room-envelope/v1" as const;
export const PHYSICAL_ROOM_ENVELOPE_COORDINATE_SPACE = "calibrated-world-xz/v1" as const;
export const EMPTY_PHYSICAL_BOUNDARY_SOURCE_COORDINATE_SPACE = "empty-source-normalized/v1" as const;

export type PhysicalRoomEnvelopeEdgeState =
  | "physical_wall"
  | "frame_truncated"
  | "open"
  | "unknown";

export type PhysicalRoomEnvelopePointXZ = Readonly<{
  x: number;
  z: number;
}>;

export type PhysicalRoomEnvelopeSourcePoint = Readonly<{
  x: number;
  y: number;
}>;

export type PhysicalRoomEnvelopeImageEvidence = Readonly<{
  coordinateSpace: typeof EMPTY_PHYSICAL_BOUNDARY_SOURCE_COORDINATE_SPACE;
  start: PhysicalRoomEnvelopeSourcePoint;
  end: PhysicalRoomEnvelopeSourcePoint;
}>;

export type PhysicalRoomEnvelopeProvenance = Readonly<{
  source: "attempt_bound_empty";
  detectorId: string;
  detectorVersion: string;
  emptyImageSha256: string | null;
  emptyBasisDigest: string | null;
  originalBasisDigest: string | null;
}>;

export type PhysicalRoomEnvelopeEdge = Readonly<{
  id: string;
  state: PhysicalRoomEnvelopeEdgeState;
  startXZ: PhysicalRoomEnvelopePointXZ;
  endXZ: PhysicalRoomEnvelopePointXZ;
  imageEvidence: PhysicalRoomEnvelopeImageEvidence | null;
}>;

/**
 * A physical-room boundary observation in the calibrated world's X/Z plane.
 * It is deliberately a segment set, never a presumed closed polygon.
 */
export type PhysicalRoomEnvelope = Readonly<{
  version: typeof PHYSICAL_ROOM_ENVELOPE_VERSION;
  coordinateSpace: typeof PHYSICAL_ROOM_ENVELOPE_COORDINATE_SPACE;
  provenance: PhysicalRoomEnvelopeProvenance;
  edges: readonly PhysicalRoomEnvelopeEdge[];
}>;

export type PhysicalRoomEnvelopeInput = Readonly<{
  provenance: PhysicalRoomEnvelopeProvenance;
  edges: readonly PhysicalRoomEnvelopeEdge[];
}>;

function finitePointXZ(point: PhysicalRoomEnvelopePointXZ): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z);
}

function finiteSourcePoint(point: PhysicalRoomEnvelopeSourcePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function nonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function edgeState(value: string): value is PhysicalRoomEnvelopeEdgeState {
  return value === "physical_wall" || value === "frame_truncated" || value === "open" || value === "unknown";
}

function cloneEdge(edge: PhysicalRoomEnvelopeEdge): PhysicalRoomEnvelopeEdge | null {
  if (
    !nonEmpty(edge.id) ||
    !edgeState(edge.state) ||
    !finitePointXZ(edge.startXZ) ||
    !finitePointXZ(edge.endXZ)
  ) {
    return null;
  }
  if (
    edge.imageEvidence &&
    (edge.imageEvidence.coordinateSpace !== EMPTY_PHYSICAL_BOUNDARY_SOURCE_COORDINATE_SPACE ||
      !finiteSourcePoint(edge.imageEvidence.start) ||
      !finiteSourcePoint(edge.imageEvidence.end))
  ) {
    return null;
  }
  return Object.freeze({
    id: edge.id,
    state: edge.state,
    startXZ: Object.freeze({ x: edge.startXZ.x, z: edge.startXZ.z }),
    endXZ: Object.freeze({ x: edge.endXZ.x, z: edge.endXZ.z }),
    imageEvidence: edge.imageEvidence
      ? Object.freeze({
          coordinateSpace: EMPTY_PHYSICAL_BOUNDARY_SOURCE_COORDINATE_SPACE,
          start: Object.freeze({ x: edge.imageEvidence.start.x, y: edge.imageEvidence.start.y }),
          end: Object.freeze({ x: edge.imageEvidence.end.x, y: edge.imageEvidence.end.y }),
        })
      : null,
  });
}

/**
 * Returns a frozen partial envelope without inferring closure or promoting any
 * non-wall state to a collision candidate. Null means its supplied evidence is
 * malformed, not that the room has a known closed boundary.
 */
export function createPhysicalRoomEnvelope(input: PhysicalRoomEnvelopeInput): PhysicalRoomEnvelope | null {
  if (
    input.provenance.source !== "attempt_bound_empty" ||
    !nonEmpty(input.provenance.detectorId) ||
    !nonEmpty(input.provenance.detectorVersion)
  ) {
    return null;
  }
  const ids = new Set<string>();
  const edges: PhysicalRoomEnvelopeEdge[] = [];
  for (const edge of input.edges) {
    const cloned = cloneEdge(edge);
    if (!cloned || ids.has(cloned.id)) return null;
    ids.add(cloned.id);
    edges.push(cloned);
  }
  return Object.freeze({
    version: PHYSICAL_ROOM_ENVELOPE_VERSION,
    coordinateSpace: PHYSICAL_ROOM_ENVELOPE_COORDINATE_SPACE,
    provenance: Object.freeze({ ...input.provenance }),
    edges: Object.freeze(edges),
  });
}

/** Only directly observed physical walls may become future collision inputs. */
export function physicalWallEdges(envelope: PhysicalRoomEnvelope): readonly PhysicalRoomEnvelopeEdge[] {
  return envelope.edges.filter((edge) => edge.state === "physical_wall");
}
