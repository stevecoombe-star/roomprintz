import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import type { AfcV2RoomBoundaryAuthorityReceipt } from "./room-boundary-authority-contract";
import type { AfcV2RoomCollisionAuthorityReceipt } from "./room-collision-authority-contract";

export const AFC_V2_ROOM_ENVELOPE_AUTHORITY_VERSION =
  "afc-v2-room-envelope-authority/v1" as const;
export const AFC_V2_ROOM_ENVELOPE_COORDINATE_SPACE =
  "calibrated-world-xz/v1" as const;
export const AFC_V2_ROOM_ENVELOPE_OPENING_QUALIFICATION_VERSION =
  "afc-v2-room-envelope-opening-qualification/v1" as const;

export const FLOOR_REACHING_OPENING_CATEGORIES = [
  "door",
  "doorway",
  "archway",
  "pass_through",
] as const;

export const ROOM_ENVELOPE_REASON = {
  registrationNotCollisionReady: "registration_not_collision_ready",
  s4aNotAccepted: "s4a_not_accepted",
  s4aGeometryIncomplete: "s4a_geometry_incomplete",
  nullHostPlane: "opening_host_plane_null",
  wrongHostWall: "opening_host_wall_mismatch",
  categoryNotFloorReaching: "opening_category_not_floor_reaching",
  doesNotMeetSeam: "opening_does_not_meet_floor_wall_seam",
  oneJambOnly: "opening_one_jamb_only",
  endpointTouchOnly: "opening_endpoint_touch_only",
  extendsIntoFloor: "opening_extends_into_floor_not_wall",
  partialOpenBoundary: "opening_partial_or_open_boundary",
  frameTruncated: "opening_frame_truncated_one_sided",
  ambiguousOpening: "opening_ambiguous",
  bothIntersectionsRequired: "opening_seam_intersections_not_defensible",
  constructionFailedClosed: "envelope_construction_failed_closed",
} as const;

export type RoomEnvelopeGeometryDerivation =
  | "none"
  | "observed_interval_subtraction";

export type RoomEnvelopeWorldXz = Readonly<{
  x: number;
  z: number;
}>;

export type RoomEnvelopeCeiling = Readonly<{
  status: "not_evaluated";
}>;

export type RoomEnvelopeOpeningStatus =
  | "qualified_floor_gap"
  | "refused";

export type RoomEnvelopeOpening = Readonly<{
  id: string;
  category: string;
  hostPlaneId: string | null;
  status: RoomEnvelopeOpeningStatus;
  sourceBoundaryId: string | null;
  floorContactInterval: Readonly<{ t0: number; t1: number }> | null;
  refusalReasons: readonly string[];
}>;

export type RoomEnvelopeSolidBaseSpan = Readonly<{
  id: string;
  sourceBoundaryId: string;
  sourceSeamId: string;
  sourceOpeningIds: readonly string[];
  t0: number;
  t1: number;
  world: Readonly<{
    a: RoomEnvelopeWorldXz;
    b: RoomEnvelopeWorldXz;
  }>;
  registrationReceiptSha256: string | null;
  registrationClass: string | null;
  hiddenContinuation: false;
  geometryDerivation: "observed_interval_subtraction";
}>;

export type RoomEnvelopeWall = Readonly<{
  id: string;
  sourceBoundaryId: string;
  sourceSeamId: string;
  sourceWallPlaneId: string | null;
  status: "accepted" | "ambiguous" | "insufficient" | "rejected" | "not_enriched";
  finiteBaseSegment: Readonly<{
    a: RoomEnvelopeWorldXz;
    b: RoomEnvelopeWorldXz;
  }> | null;
  residualSolidSpans: readonly RoomEnvelopeSolidBaseSpan[];
  openingGapIntervals: readonly Readonly<{
    openingId: string;
    t0: number;
    t1: number;
  }>[];
  reasons: readonly string[];
}>;

export type RoomEnvelopeAuthorityLineage = Readonly<{
  registration: Readonly<{
    schemaVersion: string | null;
    receiptSha256: string | null;
    registrationClass: string | null;
    methodVersion: string | null;
  }>;
  roomBoundary: Readonly<{
    schemaVersion: string | null;
    attemptId: string | null;
  }>;
  roomCollision: Readonly<{
    schemaVersion: string | null;
    qualificationVersion: string | null;
  }>;
  observation: Readonly<{
    schemaVersion: string | null;
    authority: "observation_only" | null;
    worldProjectionPerformed: false;
  }>;
  floor: Readonly<{
    authorityKey: string | null;
    worldWidthM: number | null;
    referenceDepthM: number | null;
  }>;
  camera: Readonly<{
    verticalFovDeg: number | null;
    freezeReceiptVersion: string | null;
    freezePayloadSha256: string | null;
  }>;
  openingQualificationVersion: typeof AFC_V2_ROOM_ENVELOPE_OPENING_QUALIFICATION_VERSION;
}>;

export type AfcV2RoomEnvelopeAuthorityReceipt = Readonly<{
  schemaVersion: typeof AFC_V2_ROOM_ENVELOPE_AUTHORITY_VERSION;
  coordinateSpace: typeof AFC_V2_ROOM_ENVELOPE_COORDINATE_SPACE;
  authority: "partial_room_envelope_authority";
  geometryManufactured: false;
  hiddenContinuation: false;
  closedTopology: false;
  geometryDerivation: RoomEnvelopeGeometryDerivation;
  walls: readonly RoomEnvelopeWall[];
  openings: readonly RoomEnvelopeOpening[];
  solidBaseSpans: readonly RoomEnvelopeSolidBaseSpan[];
  corners: readonly [];
  verticalExtents: readonly [];
  ceiling: RoomEnvelopeCeiling;
  lineage: RoomEnvelopeAuthorityLineage;
  constructionReasons: readonly string[];
}>;

export function freezeRoomEnvelopeAuthorityReceipt(
  receipt: AfcV2RoomEnvelopeAuthorityReceipt,
): AfcV2RoomEnvelopeAuthorityReceipt {
  return deepFreeze(receipt);
}

export function envelopeLineageFromUpstream(input: {
  registration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null;
  roomBoundary: AfcV2RoomBoundaryAuthorityReceipt | null;
  roomCollision: AfcV2RoomCollisionAuthorityReceipt | null;
}): RoomEnvelopeAuthorityLineage {
  const s4a = input.roomBoundary;
  const s4b = input.roomCollision;
  const registration = input.registration;
  return Object.freeze({
    registration: Object.freeze({
      schemaVersion: registration?.schemaVersion ?? null,
      receiptSha256: registration?.receiptSha256 ?? null,
      registrationClass: registration?.registrationClass ?? null,
      methodVersion: registration?.methodVersion ?? null,
    }),
    roomBoundary: Object.freeze({
      schemaVersion: s4a?.schemaVersion ?? null,
      attemptId: s4a?.lineage.attemptId ?? null,
    }),
    roomCollision: Object.freeze({
      schemaVersion: s4b?.schemaVersion ?? null,
      qualificationVersion: s4b?.qualificationVersion ?? null,
    }),
    observation: Object.freeze({
      schemaVersion: s4a?.lineage.observation.schemaVersion ?? null,
      authority: "observation_only" as const,
      worldProjectionPerformed: false as const,
    }),
    floor: Object.freeze({
      authorityKey: s4a?.lineage.floor.authorityKey ?? null,
      worldWidthM: s4a?.lineage.floor.worldWidthM ?? null,
      referenceDepthM: s4a?.lineage.floor.referenceDepthM ?? null,
    }),
    camera: Object.freeze({
      verticalFovDeg: s4a?.lineage.camera.verticalFovDeg ?? null,
      freezeReceiptVersion: s4a?.lineage.camera.freezeReceiptVersion ?? null,
      freezePayloadSha256: s4a?.lineage.camera.freezePayloadSha256 ?? null,
    }),
    openingQualificationVersion: AFC_V2_ROOM_ENVELOPE_OPENING_QUALIFICATION_VERSION,
  });
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value && typeof value === "object") {
    const object = value as object;
    if (seen.has(object)) return value;
    seen.add(object);
    for (const child of Object.values(object as Record<string, unknown>)) {
      deepFreeze(child, seen);
    }
    if (!Object.isFrozen(object)) Object.freeze(object);
  }
  return value;
}
