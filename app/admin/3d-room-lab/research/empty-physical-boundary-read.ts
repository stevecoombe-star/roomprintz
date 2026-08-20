import type { EmptyToWorldXZProjectionInput, WorldXZ } from "../empty-to-world-xz-projection";
import { projectEmptyFloorPointToWorldXZ } from "../empty-to-world-xz-projection";
import {
  createPhysicalRoomEnvelope,
  type PhysicalRoomEnvelope,
  type PhysicalRoomEnvelopeEdgeState,
} from "../physical-room-envelope";

/**
 * Immutable research-only, manually authored EMPTY image evidence. It is an
 * oracle for later reader research, never a runtime boundary reader or camera
 * authority. False physical walls are more severe than omitted coverage.
 */
export const EMPTY_PHYSICAL_BOUNDARY_FIXTURE_VERSION = "p2-s1-empty-physical-boundary/v1" as const;
export const EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE = "empty-source-normalized/v1" as const;
export const EMPTY_PHYSICAL_BOUNDARY_DEFAULT_CORRIDOR_SOURCE_PX = 6;

export type EmptyPhysicalBoundaryEndpointStatus =
  | "visible"
  | "near_frame"
  | "frame_truncated"
  | "occluded"
  | "unresolved";

export type EmptyPhysicalBoundaryFrameContact =
  | "no_frame_contact"
  | "contacts_frame"
  | "frame_contact_ambiguous"
  | "unknown";

export type EmptyPhysicalBoundaryInterpretation =
  | "rear_floor_wall_seam"
  | "side_floor_boundary"
  | "side_wall_floor_seam"
  | "physical_floor_wall_seam";

export type EmptyPhysicalBoundaryEvidenceKind = "direct_visible" | "partially_visible";
export type EmptyPhysicalBoundaryState = PhysicalRoomEnvelopeEdgeState;

export type EmptyPhysicalBoundaryFixture = Readonly<{
  version: typeof EMPTY_PHYSICAL_BOUNDARY_FIXTURE_VERSION;
  roomId: string;
  coordinateSpace: typeof EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE;
  emptyImage: Readonly<{
    sha256: string;
    dimensions: Readonly<{ width: number; height: number }>;
    generatorId: string;
    generatedFromOriginalSha256: string;
    manifestFileName: string;
  }>;
  evaluationCorridorSourcePx: number;
  annotations: readonly EmptyPhysicalBoundaryAnnotation[];
}>;

export type EmptyPhysicalBoundaryAnnotation = Readonly<{
  id: string;
  pointsSourceNormalized: readonly Readonly<{ x: number; y: number }>[];
  interpretation: EmptyPhysicalBoundaryInterpretation;
  evidenceKind: EmptyPhysicalBoundaryEvidenceKind;
  boundaryState: EmptyPhysicalBoundaryState;
  collisionEligible: boolean;
  startEndpoint: Readonly<{
    status: EmptyPhysicalBoundaryEndpointStatus;
    frameContact: EmptyPhysicalBoundaryFrameContact;
  }>;
  endEndpoint: Readonly<{
    status: EmptyPhysicalBoundaryEndpointStatus;
    frameContact: EmptyPhysicalBoundaryFrameContact;
  }>;
  notes: string;
}>;

export type EmptyPhysicalBoundaryFixtureParseResult =
  | Readonly<{ ok: true; fixture: EmptyPhysicalBoundaryFixture }>
  | Readonly<{ ok: false; reason: string }>;

export type EmptyPhysicalBoundaryImageIdentity = Readonly<{
  sha256: string;
  dimensions: Readonly<{ width: number; height: number }>;
}>;

export type EmptyPhysicalBoundaryProjectionResult =
  | Readonly<{ ok: true; worldXZ: readonly WorldXZ[] }>
  | Readonly<{ ok: false; reason: string }>;

export type WorldXZLineResidual = Readonly<{
  meanDistance: number;
  maxDistance: number;
}>;

const SHA_256 = /^[a-f0-9]{64}$/;
const ROOM_ID = /^room-[a-z0-9-]+$/;
const MANIFEST_FILE_NAME = /^afc-r3c-room-[a-z0-9-]+\.image-manifest\.v1\.json$/;
const ENDPOINT_STATUS = new Set<EmptyPhysicalBoundaryEndpointStatus>([
  "visible", "near_frame", "frame_truncated", "occluded", "unresolved",
]);
const FRAME_CONTACT = new Set<EmptyPhysicalBoundaryFrameContact>([
  "no_frame_contact", "contacts_frame", "frame_contact_ambiguous", "unknown",
]);
const INTERPRETATION = new Set<EmptyPhysicalBoundaryInterpretation>([
  "rear_floor_wall_seam", "side_floor_boundary", "side_wall_floor_seam", "physical_floor_wall_seam",
]);
const EVIDENCE_KIND = new Set<EmptyPhysicalBoundaryEvidenceKind>(["direct_visible", "partially_visible"]);
const BOUNDARY_STATE = new Set<EmptyPhysicalBoundaryState>(["physical_wall", "frame_truncated", "open", "unknown"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sourcePoint(value: unknown): value is Readonly<{ x: number; y: number }> {
  return record(value) && exactKeys(value, ["x", "y"]) &&
    finite(value.x) && finite(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;
}

function endpoint(value: unknown): value is EmptyPhysicalBoundaryAnnotation["startEndpoint"] {
  return record(value) && exactKeys(value, ["status", "frameContact"]) &&
    typeof value.status === "string" && ENDPOINT_STATUS.has(value.status as EmptyPhysicalBoundaryEndpointStatus) &&
    typeof value.frameContact === "string" && FRAME_CONTACT.has(value.frameContact as EmptyPhysicalBoundaryFrameContact);
}

function annotation(value: unknown): value is EmptyPhysicalBoundaryAnnotation {
  if (!record(value) || !exactKeys(value, [
    "id", "pointsSourceNormalized", "interpretation", "evidenceKind", "boundaryState",
    "collisionEligible", "startEndpoint", "endEndpoint", "notes",
  ])) return false;
  if (!nonEmpty(value.id) || !Array.isArray(value.pointsSourceNormalized) || value.pointsSourceNormalized.length < 2 ||
    !value.pointsSourceNormalized.every(sourcePoint) || !nonEmpty(value.notes) ||
    typeof value.interpretation !== "string" || !INTERPRETATION.has(value.interpretation as EmptyPhysicalBoundaryInterpretation) ||
    typeof value.evidenceKind !== "string" || !EVIDENCE_KIND.has(value.evidenceKind as EmptyPhysicalBoundaryEvidenceKind) ||
    typeof value.boundaryState !== "string" || !BOUNDARY_STATE.has(value.boundaryState as EmptyPhysicalBoundaryState) ||
    typeof value.collisionEligible !== "boolean" || !endpoint(value.startEndpoint) || !endpoint(value.endEndpoint)) return false;

  // Collision geometry is reserved for a declared visible physical wall chain.
  // Truncated/occluded endpoint labels describe only the observed endpoint; they
  // never authorize an off-frame or hidden continuation.
  return !value.collisionEligible ||
    (value.boundaryState === "physical_wall" && value.evidenceKind === "direct_visible");
}

/** Parses immutable fixture JSON without clamping or repairing malformed evidence. */
export function parseEmptyPhysicalBoundaryFixture(value: unknown): EmptyPhysicalBoundaryFixtureParseResult {
  if (!record(value) || !exactKeys(value, [
    "version", "roomId", "coordinateSpace", "emptyImage", "evaluationCorridorSourcePx", "annotations",
  ])) return { ok: false, reason: "fixture shape is invalid" };
  if (value.version !== EMPTY_PHYSICAL_BOUNDARY_FIXTURE_VERSION) return { ok: false, reason: "fixture version is invalid" };
  if (!nonEmpty(value.roomId) || !ROOM_ID.test(value.roomId) || value.coordinateSpace !== EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE) {
    return { ok: false, reason: "fixture room or coordinate space is invalid" };
  }
  if (!record(value.emptyImage) || !exactKeys(value.emptyImage, [
    "sha256", "dimensions", "generatorId", "generatedFromOriginalSha256", "manifestFileName",
  ]) || !SHA_256.test(value.emptyImage.sha256 as string) || !SHA_256.test(value.emptyImage.generatedFromOriginalSha256 as string) ||
    !nonEmpty(value.emptyImage.generatorId) || !nonEmpty(value.emptyImage.manifestFileName) || !MANIFEST_FILE_NAME.test(value.emptyImage.manifestFileName) ||
    !record(value.emptyImage.dimensions) || !exactKeys(value.emptyImage.dimensions, ["width", "height"]) ||
    !finite(value.emptyImage.dimensions.width) || !Number.isInteger(value.emptyImage.dimensions.width) || value.emptyImage.dimensions.width <= 0 ||
    !finite(value.emptyImage.dimensions.height) || !Number.isInteger(value.emptyImage.dimensions.height) || value.emptyImage.dimensions.height <= 0) {
    return { ok: false, reason: "fixture EMPTY identity is invalid" };
  }
  if (!finite(value.evaluationCorridorSourcePx) || value.evaluationCorridorSourcePx <= 0) {
    return { ok: false, reason: "fixture evaluation corridor is invalid" };
  }
  if (!Array.isArray(value.annotations) || value.annotations.length === 0 || !value.annotations.every(annotation)) {
    return { ok: false, reason: "fixture annotations are invalid" };
  }
  const ids = value.annotations.map(item => item.id);
  if (new Set(ids).size !== ids.length) return { ok: false, reason: "fixture annotation IDs must be unique" };
  return { ok: true, fixture: value as EmptyPhysicalBoundaryFixture };
}

/** Exact EMPTY-byte digest and decoded dimensions are both required. */
export function verifyEmptyPhysicalBoundaryFixtureIdentity(
  fixture: EmptyPhysicalBoundaryFixture,
  observed: EmptyPhysicalBoundaryImageIdentity
): boolean {
  return SHA_256.test(observed.sha256) &&
    fixture.emptyImage.sha256 === observed.sha256 &&
    fixture.emptyImage.dimensions.width === observed.dimensions.width &&
    fixture.emptyImage.dimensions.height === observed.dimensions.height;
}

/** Converts the established six-source-pixel corridor without assuming image dimensions. */
export function sourcePixelCorridorToNormalized(
  dimensions: EmptyPhysicalBoundaryImageIdentity["dimensions"],
  sourcePixels = EMPTY_PHYSICAL_BOUNDARY_DEFAULT_CORRIDOR_SOURCE_PX
): Readonly<{ x: number; y: number }> | null {
  if (!finite(dimensions.width) || !finite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0 ||
    !finite(sourcePixels) || sourcePixels < 0) return null;
  return Object.freeze({ x: sourcePixels / dimensions.width, y: sourcePixels / dimensions.height });
}

/**
 * Uses P2-S0 unchanged: EMPTY -> Original transfer -> unclamped container
 * normalization -> already-applied calibrated camera ray -> world X/Z.
 */
export function projectEmptyPhysicalBoundaryAnnotation(
  annotationValue: EmptyPhysicalBoundaryAnnotation,
  input: Omit<EmptyToWorldXZProjectionInput, "emptySourceNormalized">
): EmptyPhysicalBoundaryProjectionResult {
  const worldXZ: WorldXZ[] = [];
  for (const emptySourceNormalized of annotationValue.pointsSourceNormalized) {
    const projected = projectEmptyFloorPointToWorldXZ({ ...input, emptySourceNormalized });
    if (!projected.ok) return { ok: false, reason: projected.reason };
    worldXZ.push(Object.freeze({ ...projected.worldXZ }));
  }
  return { ok: true, worldXZ: Object.freeze(worldXZ) };
}

/** Orthogonal residuals from a best-fit infinite X/Z line; null rejects degenerate chains. */
export function worldXZBestFitLineResidual(points: readonly WorldXZ[]): WorldXZLineResidual | null {
  if (points.length < 2 || !points.every(point => finite(point.x) && finite(point.z))) return null;
  const sum = points.reduce<{ x: number; z: number }>(
    (total, point) => ({ x: total.x + point.x, z: total.z + point.z }),
    { x: 0, z: 0 }
  );
  const center = { x: sum.x / points.length, z: sum.z / points.length };
  const covariance = points.reduce((sum, point) => {
    const x = point.x - center.x;
    const z = point.z - center.z;
    return { xx: sum.xx + x * x, xz: sum.xz + x * z, zz: sum.zz + z * z };
  }, { xx: 0, xz: 0, zz: 0 });
  const angle = 0.5 * Math.atan2(2 * covariance.xz, covariance.xx - covariance.zz);
  const direction = { x: Math.cos(angle), z: Math.sin(angle) };
  const spread = covariance.xx + covariance.zz;
  if (!finite(spread) || spread <= 1e-12) return null;
  const distances = points.map(point => Math.abs((point.x - center.x) * direction.z - (point.z - center.z) * direction.x));
  return Object.freeze({
    meanDistance: distances.reduce((sum, distance) => sum + distance, 0) / distances.length,
    maxDistance: Math.max(...distances),
  });
}

/**
 * Test-only handoff. It converts only explicitly collision-eligible,
 * direct-visible chains into consecutive partial-envelope segments; it never
 * adds a closing segment or represents an endpoint continuation.
 */
export function createTestOnlyPhysicalRoomEnvelopeFromAnnotation(
  fixture: EmptyPhysicalBoundaryFixture,
  annotationValue: EmptyPhysicalBoundaryAnnotation,
  worldXZ: readonly WorldXZ[]
): PhysicalRoomEnvelope | null {
  if (worldXZ.length !== annotationValue.pointsSourceNormalized.length || worldXZ.length < 2) return null;
  const state: PhysicalRoomEnvelopeEdgeState =
    annotationValue.collisionEligible && annotationValue.boundaryState === "physical_wall"
      ? "physical_wall"
      : annotationValue.boundaryState;
  return createPhysicalRoomEnvelope({
    provenance: {
      source: "attempt_bound_empty",
      detectorId: "p2-s1a-manual-physical-boundary-oracle",
      detectorVersion: EMPTY_PHYSICAL_BOUNDARY_FIXTURE_VERSION,
      emptyImageSha256: fixture.emptyImage.sha256,
      emptyBasisDigest: fixture.emptyImage.sha256,
      originalBasisDigest: fixture.emptyImage.generatedFromOriginalSha256,
    },
    edges: worldXZ.slice(1).map((endXZ, index) => ({
      id: `${annotationValue.id}:${index}`,
      state,
      startXZ: worldXZ[index],
      endXZ,
      imageEvidence: {
        coordinateSpace: EMPTY_PHYSICAL_BOUNDARY_FIXTURE_COORDINATE_SPACE,
        start: annotationValue.pointsSourceNormalized[index],
        end: annotationValue.pointsSourceNormalized[index + 1],
      },
    })),
  });
}
