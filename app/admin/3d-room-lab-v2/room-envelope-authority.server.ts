import type { EmptyRoomObservationEvidence } from "./empty-room-observation-contract";
import type { AfcV2EmptyOriginalRegistrationAuthorityReceipt } from "./empty-original-registration-authority-contract";
import type {
  AfcV2RoomBoundaryAuthorityReceipt,
  RoomBoundaryCandidate,
} from "./room-boundary-authority-contract";
import type { AfcV2RoomCollisionAuthorityReceipt } from "./room-collision-authority-contract";
import {
  AFC_V2_ROOM_ENVELOPE_AUTHORITY_VERSION,
  AFC_V2_ROOM_ENVELOPE_COORDINATE_SPACE,
  ROOM_ENVELOPE_REASON,
  envelopeLineageFromUpstream,
  freezeRoomEnvelopeAuthorityReceipt,
  type AfcV2RoomEnvelopeAuthorityReceipt,
  type RoomEnvelopeOpening,
  type RoomEnvelopeSolidBaseSpan,
  type RoomEnvelopeWall,
} from "./room-envelope-authority-contract";
import { qualifyObservationOpeningsForCandidate } from "./room-envelope-opening-qualification";
import {
  residualWorldSegments,
  subtractParameterIntervals,
  worldLength,
} from "./room-envelope-span-subtraction";
import { mergeParameterIntervals } from "./room-opening-intersection-geometry";

export type RoomEnvelopeConstructionInput = Readonly<{
  registration: AfcV2EmptyOriginalRegistrationAuthorityReceipt | null;
  roomBoundary: AfcV2RoomBoundaryAuthorityReceipt | null;
  roomCollision: AfcV2RoomCollisionAuthorityReceipt | null;
  observation: EmptyRoomObservationEvidence | null;
}>;

export function constructAfcV2RoomEnvelopeAuthority(
  input: RoomEnvelopeConstructionInput,
): AfcV2RoomEnvelopeAuthorityReceipt {
  try {
    return constructUnchecked(input);
  } catch {
    return emptyEnvelope(input, [ROOM_ENVELOPE_REASON.constructionFailedClosed]);
  }
}

function constructUnchecked(
  input: RoomEnvelopeConstructionInput,
): AfcV2RoomEnvelopeAuthorityReceipt {
  const walls: RoomEnvelopeWall[] = [];
  const openingById = new Map<string, RoomEnvelopeOpening>();
  const solidBaseSpans: RoomEnvelopeSolidBaseSpan[] = [];
  const candidates = input.roomBoundary?.candidates ?? [];

  for (const candidate of candidates) {
    const qualified = qualifyObservationOpeningsForCandidate({
      observation: input.observation,
      candidate,
      registration: input.registration,
    });
    const relevant = qualified.filter((item) =>
      item.opening.hostPlaneId === null ||
      item.opening.hostPlaneId === candidate.source.wallPlaneId
    );
    const acceptedGaps = relevant.filter((item) =>
      item.result.accepted && item.result.interval
    );
    for (const item of relevant) {
      const recorded = openingById.get(item.opening.id);
      if (recorded?.status === "qualified_floor_gap") continue;
      openingById.set(item.opening.id, Object.freeze({
        id: item.opening.id,
        category: item.opening.category,
        hostPlaneId: item.opening.hostPlaneId,
        status: item.result.accepted ? "qualified_floor_gap" : "refused",
        sourceBoundaryId: item.result.accepted ? candidate.id : null,
        floorContactInterval: item.result.interval,
        refusalReasons: Object.freeze([...item.result.reasons]),
      }));
    }

    const world = worldSegment(candidate);
    const gapIntervals = mergeParameterIntervals(
      acceptedGaps.map((item) => item.result.interval!),
    );
    const residuals = world
      ? subtractParameterIntervals({ t0: 0, t1: 1 }, gapIntervals)
      : [];
    const residualWorld = world ? residualWorldSegments(world, residuals) : [];
    const openingIds = acceptedGaps.map((item) => item.opening.id);
    const spans: RoomEnvelopeSolidBaseSpan[] = residualWorld.map((segment, index) => {
      const interval = residuals[index] ?? { t0: 0, t1: 1 };
      return Object.freeze({
        id: `${candidate.id}__solid_${index}`,
        sourceBoundaryId: candidate.id,
        sourceSeamId: candidate.sourceSeamId,
        sourceOpeningIds: Object.freeze([...openingIds]),
        t0: interval.t0,
        t1: interval.t1,
        world: Object.freeze({
          a: Object.freeze({ ...segment.a }),
          b: Object.freeze({ ...segment.b }),
        }),
        registrationReceiptSha256: input.registration?.receiptSha256 ?? null,
        registrationClass: input.registration?.registrationClass ?? null,
        hiddenContinuation: false as const,
        geometryDerivation: "observed_interval_subtraction" as const,
      });
    }).filter((span) => worldLength(span.world) > 0);

    const subtracted = acceptedGaps.length > 0 &&
      !(residuals.length === 1 && residuals[0]?.t0 === 0 && residuals[0]?.t1 === 1);
    if (subtracted) {
      solidBaseSpans.push(...spans);
    }

    walls.push(Object.freeze({
      id: candidate.id,
      sourceBoundaryId: candidate.id,
      sourceSeamId: candidate.sourceSeamId,
      sourceWallPlaneId: candidate.source.wallPlaneId,
      status: candidate.status === "accepted"
        ? subtracted ? "accepted" : "not_enriched"
        : candidate.status,
      finiteBaseSegment: world
        ? Object.freeze({
          a: Object.freeze({ ...world.a }),
          b: Object.freeze({ ...world.b }),
        })
        : null,
      residualSolidSpans: Object.freeze(subtracted ? spans : []),
      openingGapIntervals: Object.freeze(
        acceptedGaps.flatMap((item) =>
          item.result.interval
            ? [Object.freeze({
              openingId: item.opening.id,
              t0: item.result.interval.t0,
              t1: item.result.interval.t1,
            })]
            : []
        ),
      ),
      reasons: Object.freeze(
        subtracted
          ? []
          : uniqueReasons(relevant.flatMap((item) => [...item.result.reasons])),
      ),
    }));
  }

  const openings = Object.freeze([
    ...openingById.values(),
    ...(input.observation && input.observation.observerStatus !== "failed"
      ? input.observation.observedOpenings
        .filter((opening) => !openingById.has(opening.id))
        .map((opening) => Object.freeze({
          id: opening.id,
          category: opening.category,
          hostPlaneId: opening.hostPlaneId,
          status: "refused" as const,
          sourceBoundaryId: null,
          floorContactInterval: null,
          refusalReasons: Object.freeze([
            opening.hostPlaneId === null
              ? ROOM_ENVELOPE_REASON.nullHostPlane
              : ROOM_ENVELOPE_REASON.wrongHostWall,
          ]),
        }))
      : []),
  ]);

  const geometryDerivation = solidBaseSpans.length > 0
    ? "observed_interval_subtraction" as const
    : "none" as const;

  return freezeRoomEnvelopeAuthorityReceipt({
    schemaVersion: AFC_V2_ROOM_ENVELOPE_AUTHORITY_VERSION,
    coordinateSpace: AFC_V2_ROOM_ENVELOPE_COORDINATE_SPACE,
    authority: "partial_room_envelope_authority",
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    geometryDerivation,
    walls: Object.freeze(walls),
    openings: Object.freeze(openings),
    solidBaseSpans: Object.freeze(solidBaseSpans),
    corners: Object.freeze([]),
    verticalExtents: Object.freeze([]),
    ceiling: Object.freeze({ status: "not_evaluated" as const }),
    lineage: envelopeLineageFromUpstream(input),
    constructionReasons: Object.freeze([]),
  });
}

function worldSegment(candidate: RoomBoundaryCandidate): {
  a: { x: number; z: number };
  b: { x: number; z: number };
} | null {
  const geometry = candidate.worldGeometry;
  if (!geometry) return null;
  return {
    a: { x: geometry.baseStart.x, z: geometry.baseStart.z },
    b: { x: geometry.baseEnd.x, z: geometry.baseEnd.z },
  };
}

function emptyEnvelope(
  input: RoomEnvelopeConstructionInput,
  reasons: readonly string[],
): AfcV2RoomEnvelopeAuthorityReceipt {
  return freezeRoomEnvelopeAuthorityReceipt({
    schemaVersion: AFC_V2_ROOM_ENVELOPE_AUTHORITY_VERSION,
    coordinateSpace: AFC_V2_ROOM_ENVELOPE_COORDINATE_SPACE,
    authority: "partial_room_envelope_authority",
    geometryManufactured: false,
    hiddenContinuation: false,
    closedTopology: false,
    geometryDerivation: "none",
    walls: Object.freeze([]),
    openings: Object.freeze([]),
    solidBaseSpans: Object.freeze([]),
    corners: Object.freeze([]),
    verticalExtents: Object.freeze([]),
    ceiling: Object.freeze({ status: "not_evaluated" as const }),
    lineage: envelopeLineageFromUpstream(input),
    constructionReasons: Object.freeze([...reasons]),
  });
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
