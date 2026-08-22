import roomBIdentityValue from "./fixtures/p2-s2b-holdout-identity/room-b.json";
import roomDIdentityValue from "./fixtures/p2-s2b-holdout-identity/room-d.json";
import {
  parseP2S2BHoldoutIdentity,
  type P2S2BHoldoutIdentity,
} from "./p2-s2b-holdout-identity";
import type {
  EmptyPhysicalBoundaryAnnotation,
  EmptyPhysicalBoundaryEndpointStatus,
  EmptyPhysicalBoundaryEvidenceKind,
  EmptyPhysicalBoundaryFixture,
  EmptyPhysicalBoundaryFrameContact,
  EmptyPhysicalBoundaryInterpretation,
  EmptyPhysicalBoundaryState,
} from "./empty-physical-boundary-read";

export const P2_S2B_HOLDOUT_ORACLE_ROOMS = ["room-b", "room-d"] as const;
export const P2_S2B_HOLDOUT_ORACLE_FIXTURE_VERSION =
  "p2-s1-empty-physical-boundary/v1" as const;
export const P2_S2B_HOLDOUT_ORACLE_COORDINATE_SPACE =
  "empty-source-normalized/v1" as const;
export const P2_S2B_HOLDOUT_ORACLE_CORRIDOR_SOURCE_PX = 6 as const;

export const P2_S2B_HOLDOUT_ORACLE_INTERPRETATIONS = [
  "rear_floor_wall_seam",
  "side_floor_boundary",
  "side_wall_floor_seam",
  "physical_floor_wall_seam",
] as const satisfies readonly EmptyPhysicalBoundaryInterpretation[];

export const P2_S2B_HOLDOUT_ORACLE_EVIDENCE_KINDS = [
  "direct_visible",
  "partially_visible",
] as const satisfies readonly EmptyPhysicalBoundaryEvidenceKind[];

export const P2_S2B_HOLDOUT_ORACLE_BOUNDARY_STATES = [
  "physical_wall",
  "frame_truncated",
  "open",
  "unknown",
] as const satisfies readonly EmptyPhysicalBoundaryState[];

export const P2_S2B_HOLDOUT_ORACLE_ENDPOINT_STATUSES = [
  "visible",
  "near_frame",
  "frame_truncated",
  "occluded",
  "unresolved",
] as const satisfies readonly EmptyPhysicalBoundaryEndpointStatus[];

export const P2_S2B_HOLDOUT_ORACLE_FRAME_CONTACTS = [
  "no_frame_contact",
  "contacts_frame",
  "frame_contact_ambiguous",
  "unknown",
] as const satisfies readonly EmptyPhysicalBoundaryFrameContact[];

export type P2S2BHoldoutOracleRoomId =
  typeof P2_S2B_HOLDOUT_ORACLE_ROOMS[number];

export type P2S2BHoldoutOracleSourcePixelPoint = Readonly<{
  x: number;
  y: number;
}>;

export type P2S2BHoldoutOracleDraftAnnotation = Readonly<{
  id: string;
  pointsSourcePx: readonly P2S2BHoldoutOracleSourcePixelPoint[];
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

export type P2S2BHoldoutOracleDraftValidation = Readonly<{
  ok: boolean;
  errors: readonly string[];
}>;

function parsedIdentity(value: unknown): P2S2BHoldoutIdentity {
  const result = parseP2S2BHoldoutIdentity(value);
  if (!result.ok) throw new Error(result.reason);
  return result.identity;
}

const IDENTITIES: Readonly<
  Record<P2S2BHoldoutOracleRoomId, P2S2BHoldoutIdentity>
> = Object.freeze({
  "room-b": parsedIdentity(roomBIdentityValue),
  "room-d": parsedIdentity(roomDIdentityValue),
});

export function getP2S2BHoldoutOracleIdentity(
  roomId: P2S2BHoldoutOracleRoomId
): P2S2BHoldoutIdentity {
  return IDENTITIES[roomId];
}

export function isP2S2BHoldoutOracleRoomId(
  value: unknown
): value is P2S2BHoldoutOracleRoomId {
  return value === "room-b" || value === "room-d";
}

export function createP2S2BHoldoutOracleDraftAnnotation(
  ordinal: number
): P2S2BHoldoutOracleDraftAnnotation {
  return {
    id: `visible-span-${ordinal}`,
    pointsSourcePx: [],
    interpretation: "physical_floor_wall_seam",
    evidenceKind: "direct_visible",
    boundaryState: "unknown",
    collisionEligible: false,
    startEndpoint: {
      status: "unresolved",
      frameContact: "no_frame_contact",
    },
    endEndpoint: {
      status: "unresolved",
      frameContact: "no_frame_contact",
    },
    notes: "",
  };
}

function endpointErrors(
  annotationId: string,
  label: "start" | "end",
  endpoint: P2S2BHoldoutOracleDraftAnnotation["startEndpoint"]
): readonly string[] {
  const prefix = `${annotationId} ${label} endpoint`;
  if (
    endpoint.status === "frame_truncated" &&
    endpoint.frameContact !== "contacts_frame"
  ) {
    return [`${prefix} must contact the frame when frame-truncated`];
  }
  if (
    endpoint.frameContact === "contacts_frame" &&
    endpoint.status !== "frame_truncated"
  ) {
    return [`${prefix} may contact the frame only when frame-truncated`];
  }
  if (
    endpoint.status === "occluded" &&
    endpoint.frameContact === "contacts_frame"
  ) {
    return [`${prefix} cannot be both occluded and frame-contacting`];
  }
  return [];
}

function samePoint(
  left: P2S2BHoldoutOracleSourcePixelPoint,
  right: P2S2BHoldoutOracleSourcePixelPoint
): boolean {
  return left.x === right.x && left.y === right.y;
}

export function validateP2S2BHoldoutOracleDraft(
  roomId: P2S2BHoldoutOracleRoomId,
  annotations: readonly P2S2BHoldoutOracleDraftAnnotation[]
): P2S2BHoldoutOracleDraftValidation {
  const identity = getP2S2BHoldoutOracleIdentity(roomId);
  const errors: string[] = [];
  if (annotations.length === 0) {
    errors.push("at least one manually reviewed finite annotation is required");
  }

  const ids = new Set<string>();
  for (const [index, annotation] of annotations.entries()) {
    const label = annotation.id.trim() || `annotation ${index + 1}`;
    if (!annotation.id.trim()) errors.push(`annotation ${index + 1} needs an ID`);
    if (ids.has(annotation.id)) errors.push(`duplicate annotation ID: ${annotation.id}`);
    ids.add(annotation.id);
    if (annotation.pointsSourcePx.length < 2) {
      errors.push(`${label} needs at least two source-pixel points`);
    }
    annotation.pointsSourcePx.forEach((point, pointIndex) => {
      if (
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        point.x < 0 ||
        point.y < 0 ||
        point.x > identity.emptyDimensions.width - 1 ||
        point.y > identity.emptyDimensions.height - 1
      ) {
        errors.push(`${label} point ${pointIndex + 1} is outside the certified EMPTY`);
      }
      if (
        pointIndex > 0 &&
        samePoint(annotation.pointsSourcePx[pointIndex - 1], point)
      ) {
        errors.push(`${label} has duplicate adjacent points`);
      }
    });
    if (
      annotation.pointsSourcePx.length > 2 &&
      samePoint(
        annotation.pointsSourcePx[0],
        annotation.pointsSourcePx[annotation.pointsSourcePx.length - 1]
      )
    ) {
      errors.push(`${label} must remain an open finite polyline`);
    }
    if (!annotation.notes.trim()) errors.push(`${label} needs visible-evidence notes`);
    if (
      annotation.collisionEligible &&
      (
        annotation.boundaryState !== "physical_wall" ||
        annotation.evidenceKind !== "direct_visible"
      )
    ) {
      errors.push(`${label} collision requires a direct-visible physical wall`);
    }
    if (
      (annotation.boundaryState === "open" ||
        annotation.boundaryState === "unknown" ||
        annotation.boundaryState === "frame_truncated") &&
      annotation.collisionEligible
    ) {
      errors.push(`${label} ${annotation.boundaryState} evidence must be non-collision`);
    }
    errors.push(...endpointErrors(label, "start", annotation.startEndpoint));
    errors.push(...endpointErrors(label, "end", annotation.endEndpoint));
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

function normalized(
  value: number,
  extent: number
): number {
  return Number((value / extent).toFixed(6));
}

export function sourcePixelToP2S2BHoldoutOracleNormalized(
  roomId: P2S2BHoldoutOracleRoomId,
  point: P2S2BHoldoutOracleSourcePixelPoint
): Readonly<{ x: number; y: number }> {
  const dimensions = getP2S2BHoldoutOracleIdentity(roomId).emptyDimensions;
  return Object.freeze({
    x: normalized(point.x, dimensions.width),
    y: normalized(point.y, dimensions.height),
  });
}

export function buildP2S2BHoldoutOracleFixture(
  roomId: P2S2BHoldoutOracleRoomId,
  annotations: readonly P2S2BHoldoutOracleDraftAnnotation[]
): EmptyPhysicalBoundaryFixture {
  const validation = validateP2S2BHoldoutOracleDraft(roomId, annotations);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  const identity = getP2S2BHoldoutOracleIdentity(roomId);
  const normalizedAnnotations: EmptyPhysicalBoundaryAnnotation[] = annotations.map(
    annotation => ({
      id: annotation.id.trim(),
      pointsSourceNormalized: annotation.pointsSourcePx.map(point =>
        sourcePixelToP2S2BHoldoutOracleNormalized(roomId, point)
      ),
      interpretation: annotation.interpretation,
      evidenceKind: annotation.evidenceKind,
      boundaryState: annotation.boundaryState,
      collisionEligible: annotation.collisionEligible,
      startEndpoint: { ...annotation.startEndpoint },
      endEndpoint: { ...annotation.endEndpoint },
      notes: annotation.notes.trim(),
    })
  );
  return {
    version: P2_S2B_HOLDOUT_ORACLE_FIXTURE_VERSION,
    roomId,
    coordinateSpace: P2_S2B_HOLDOUT_ORACLE_COORDINATE_SPACE,
    emptyImage: {
      sha256: identity.emptySha256,
      dimensions: { ...identity.emptyDimensions },
      generatorId: identity.generatorId,
      generatedFromOriginalSha256: identity.originalSha256,
      manifestFileName: identity.manifestFileName,
    },
    evaluationCorridorSourcePx: P2_S2B_HOLDOUT_ORACLE_CORRIDOR_SOURCE_PX,
    annotations: normalizedAnnotations,
  };
}

export function serializeP2S2BHoldoutOracleFixture(
  roomId: P2S2BHoldoutOracleRoomId,
  annotations: readonly P2S2BHoldoutOracleDraftAnnotation[]
): string {
  return `${JSON.stringify(
    buildP2S2BHoldoutOracleFixture(roomId, annotations),
    null,
    2
  )}\n`;
}
