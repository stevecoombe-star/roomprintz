import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildEmptyRoomObservationEvidence,
  buildFailedEmptyRoomObservationEvidence,
  FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE,
  type EmptyRoomObservationAcceptedEvidence,
} from "./empty-room-observation-contract";
import {
  buildFailedFocusedSideFloorWallEvidence,
  buildFocusedSideFloorWallEvidence,
  type FocusedSideFloorWallEvidenceContext,
  type FocusedSideFloorWallSide,
} from "./empty-side-floor-wall-observation-contract";
import {
  FLOOR_WALL_MERGE_REASON,
  FOCUSED_SIDE_FLOOR_WALL_MIN_IMAGE_SPAN,
  IN_SPAN_FLOOR_FRONTIER_SAMPLE_T,
  focusedSeamPassesFloorFrontierConsistency,
  focusedSeamPassesInSpanFloorFrontier,
  mergeFocusedSideFloorWallObservation,
} from "./empty-side-floor-wall-observation-merge.server";
import { AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION } from "./empty-side-floor-wall-observation.server";
import { constructAfcV2RoomBoundaryAuthority } from "./room-boundary-authority.server";
import { constructAfcV2RoomCollisionAuthority } from "./room-collision-qualification.server";
import {
  classifyFocusedWallSupportingRegion,
  classifyFrontierVertex,
  distanceToPolygonFrontier,
  pointInPolygon,
  pointIsFrameAdjacent,
} from "./room-boundary-qualification.server";
import { ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE } from "./room-boundary-authority-contract";

const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const EMPTY_BYTES = Uint8Array.from([4, 5, 6]);
const emptyBasis = {
  sha256: sha(EMPTY_BYTES),
  byteCount: EMPTY_BYTES.byteLength,
  decodedWidth: 1200,
  decodedHeight: 800,
  mimeType: "image/png" as const,
  orientation: 1 as const,
};
const originalSha = "a".repeat(64);

const FLOOR_POLYGON = [
  { x: 0.06, y: 1 },
  { x: 0.96, y: 1 },
  { x: 0.8, y: 0.64 },
  { x: 0.18, y: 0.64 },
] as const;
const LEFT_SEAM = [
  { x: 0.06, y: 1 },
  { x: 0.18, y: 0.64 },
] as const;
const RIGHT_SEAM = [
  { x: 0.96, y: 1 },
  { x: 0.8, y: 0.64 },
] as const;
const BACK_SEAM = [
  { x: 0.18, y: 0.64 },
  { x: 0.8, y: 0.64 },
] as const;
/**
 * Generic left-biased back floor-wall: still bound floor+back wall, but
 * midpoint x <= 0.4. This is the false-duplicate class — not a left pair.
 */
const LEFT_BIASED_BACK_SEAM = [
  { x: 0.18, y: 0.64 },
  { x: 0.58, y: 0.64 },
] as const;
const LEFT_WALL = [
  { x: 0, y: 0.22 },
  { x: 0.18, y: 0.16 },
  { x: 0.18, y: 0.64 },
  { x: 0.06, y: 1 },
] as const;
/**
 * Focused wall region that contains the left floor-wall seam as an interior
 * chord. Rear sample is farther than 0.012 from the wall outline.
 */
const OVERSHOOT_LEFT_WALL = [
  { x: 0, y: 0.22 },
  { x: 0.18, y: 0.16 },
  { x: 0.24, y: 0.58 },
  { x: 0.24, y: 0.70 },
  { x: 0.06, y: 1 },
] as const;
const RIGHT_WALL = [
  { x: 1, y: 0.22 },
  { x: 0.8, y: 0.16 },
  { x: 0.8, y: 0.64 },
  { x: 0.96, y: 1 },
] as const;
const BACK_WALL = [
  { x: 0.18, y: 0.16 },
  { x: 0.8, y: 0.16 },
  { x: 0.8, y: 0.64 },
  { x: 0.18, y: 0.64 },
] as const;

/**
 * Architectural (Room-2-class) left floor frontier. Junction-sharing
 * patch-bottom seams can pass endpoint classification against this floor
 * while departing in-span.
 */
const ARCH_FLOOR = [
  { x: 0.045, y: 0.999 },
  { x: 0.955, y: 0.999 },
  { x: 0.80, y: 0.696 },
  { x: 0.078, y: 0.696 },
] as const;
const ARCH_LEFT_WALL = [
  { x: 0, y: 0 },
  { x: 0.078, y: 0.222 },
  { x: 0.078, y: 0.696 },
  { x: 0.045, y: 0.999 },
  { x: 0, y: 0.999 },
] as const;
const ARCH_LEFT_SEAM = [
  { x: 0.045, y: 0.999 },
  { x: 0.078, y: 0.696 },
] as const;
const ARCH_RIGHT_WALL = [
  { x: 1, y: 0 },
  { x: 0.80, y: 0.222 },
  { x: 0.80, y: 0.696 },
  { x: 0.955, y: 0.999 },
  { x: 1, y: 0.999 },
] as const;
const ARCH_RIGHT_SEAM = [
  { x: 0.955, y: 0.999 },
  { x: 0.80, y: 0.696 },
] as const;
const ARCH_BACK_WALL = [
  { x: 0.078, y: 0.222 },
  { x: 0.80, y: 0.222 },
  { x: 0.80, y: 0.696 },
  { x: 0.078, y: 0.696 },
] as const;
const ARCH_BACK_SEAM = [
  { x: 0.078, y: 0.696 },
  { x: 0.80, y: 0.696 },
] as const;
const ARCH_LEFT_BIASED_BACK_SEAM = [
  { x: 0.078, y: 0.696 },
  { x: 0.48, y: 0.696 },
] as const;
const WRONG_LEFT_PATCH_WALL = [
  { x: 0, y: 0.218 },
  { x: 0.078, y: 0.290 },
  { x: 0.078, y: 0.697 },
  { x: 0, y: 0.725 },
] as const;
const WRONG_LEFT_PATCH_SEAM = [
  { x: 0, y: 0.725 },
  { x: 0.078, y: 0.697 },
] as const;
const WRONG_RIGHT_PATCH_WALL = [
  { x: 1, y: 0.218 },
  { x: 0.80, y: 0.290 },
  { x: 0.80, y: 0.697 },
  { x: 1, y: 0.725 },
] as const;
const WRONG_RIGHT_PATCH_SEAM = [
  { x: 1, y: 0.725 },
  { x: 0.80, y: 0.697 },
] as const;
const FRAME_TRUNCATED_LEFT_SEAM = [
  { x: 0.045, y: 1 },
  { x: 0.078, y: 0.696 },
] as const;

/**
 * Canonical frame-truncated Room-2-class left floor: General left
 * frontier (.046,1)→(.076,.678). Focused long seam (0,1)→(.076,.696)
 * describes the same side but diverges toward the cropped endpoint.
 */
const TRUNC_FLOOR = [
  { x: 0.046, y: 1 },
  { x: 0.96, y: 1 },
  { x: 0.80, y: 0.678 },
  { x: 0.078, y: 0.678 },
] as const;
const TRUNC_BACK_WALL = [
  { x: 0.078, y: 0.16 },
  { x: 0.80, y: 0.16 },
  { x: 0.80, y: 0.678 },
  { x: 0.078, y: 0.678 },
] as const;
const TRUNC_BACK_SEAM = [
  { x: 0.078, y: 0.678 },
  { x: 0.80, y: 0.678 },
] as const;
const TRUNC_RIGHT_WALL = [
  { x: 1, y: 0.22 },
  { x: 0.80, y: 0.16 },
  { x: 0.80, y: 0.678 },
  { x: 0.96, y: 1 },
] as const;
const TRUNC_RIGHT_SEAM = [
  { x: 0.96, y: 1 },
  { x: 0.80, y: 0.678 },
] as const;
const TRUNC_LEFT_WALL = [
  { x: 0, y: 0.22 },
  { x: 0.076, y: 0.22 },
  { x: 0.076, y: 0.696 },
  { x: 0, y: 1 },
] as const;
const TRUNC_LEFT_GOOD_SEAM = [
  { x: 0, y: 1 },
  { x: 0.076, y: 0.696 },
] as const;
const TRUNC_LEFT_BOTTOM_SEAM = [
  { x: 0.008, y: 1 },
  { x: 0.076, y: 0.696 },
] as const;
const TRUNC_LEFT_LATERAL_SEAM = [
  { x: 0, y: 0.80 },
  { x: 0.076, y: 0.696 },
] as const;
const TRUNC_LEFT_FAR_JUNCTION_SEAM = [
  { x: 0, y: 1 },
  { x: 0.22, y: 0.696 },
] as const;
const TRUNC_LEFT_REARWARD_SEAM = [
  { x: 0, y: 1 },
  { x: 0.12, y: 0.52 },
  { x: 0.076, y: 0.696 },
] as const;
const TRUNC_NO_SIDE_FLOOR = [
  { x: 0.05, y: 0.705 },
  { x: 0.80, y: 0.705 },
  { x: 0.80, y: 0.50 },
  { x: 0.05, y: 0.50 },
] as const;
const TRUNC_RIGHT_GOOD_SEAM = TRUNC_LEFT_GOOD_SEAM.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const TRUNC_RIGHT_GOOD_WALL = TRUNC_LEFT_WALL.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const TRUNC_RIGHT_PATCH_SEAM = WRONG_LEFT_PATCH_SEAM.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const TRUNC_RIGHT_PATCH_WALL = WRONG_LEFT_PATCH_WALL.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_TRUNC_FLOOR = TRUNC_FLOOR.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_TRUNC_BACK_WALL = TRUNC_BACK_WALL.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_TRUNC_BACK_SEAM = TRUNC_BACK_SEAM.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_TRUNC_LEFT_WALL = TRUNC_RIGHT_WALL.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_TRUNC_LEFT_SEAM = TRUNC_RIGHT_SEAM.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));

/**
 * Off-axis Room-2-class geometry: back wall vertex-mean x <= 0.4, yet the
 * wall is structurally BACK (lateral floor-wall + wall-wall to right).
 */
const ROOM2_FLOOR = [
  { x: 0.046, y: 1 },
  { x: 1, y: 0.82 },
  { x: 0.415, y: 0.616 },
  { x: 0.078, y: 0.694 },
] as const;
const ROOM2_BACK_WALL = [
  { x: 0.078, y: 0.220 },
  { x: 0.415, y: 0.330 },
  { x: 0.415, y: 0.616 },
  { x: 0.078, y: 0.694 },
] as const;
const ROOM2_BACK_SEAM = [
  { x: 0.078, y: 0.694 },
  { x: 0.415, y: 0.616 },
] as const;
const ROOM2_RIGHT_WALL = [
  { x: 1, y: 0.22 },
  { x: 0.415, y: 0.330 },
  { x: 0.415, y: 0.616 },
  { x: 1, y: 0.82 },
] as const;
const ROOM2_RIGHT_SEAM = [
  { x: 0.415, y: 0.616 },
  { x: 1, y: 0.82 },
] as const;
const ROOM2_WALL_WALL_BACK_RIGHT = [
  { x: 0.415, y: 0.330 },
  { x: 0.415, y: 0.616 },
] as const;
const ROOM2_LEFT_WALL = [
  { x: 0, y: 0.22 },
  { x: 0.078, y: 0.220 },
  { x: 0.078, y: 0.694 },
  { x: 0.046, y: 1 },
  { x: 0, y: 1 },
] as const;
const ROOM2_LEFT_SEAM = [
  { x: 0.046, y: 1 },
  { x: 0.078, y: 0.694 },
] as const;
const ROOM2_CEILING = [
  { x: 0.078, y: 0.05 },
  { x: 0.415, y: 0.12 },
  { x: 0.415, y: 0.330 },
  { x: 0.078, y: 0.220 },
] as const;
const ROOM2_LEFT_WALL_CEILING = [
  { x: 0, y: 0.22 },
  { x: 0.078, y: 0.220 },
] as const;

const RIGHT_BIASED_BACK_WALL = ROOM2_BACK_WALL.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const RIGHT_BIASED_BACK_SEAM = ROOM2_BACK_SEAM.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_FLOOR = ROOM2_FLOOR.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_LEFT_WALL = ROOM2_RIGHT_WALL.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_LEFT_SEAM = ROOM2_RIGHT_SEAM.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_WALL_WALL = ROOM2_WALL_WALL_BACK_RIGHT.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_RIGHT_WALL = ROOM2_LEFT_WALL.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));
const MIRRORED_RIGHT_SEAM = ROOM2_LEFT_SEAM.map((point) => ({
  x: 1 - point.x,
  y: point.y,
}));

/**
 * Structurally LEFT side wall whose vertex-mean x sits in the center band.
 * Completeness must not require the 0.4 / 0.6 polygon-side bands.
 */
const CENTER_BAND_LEFT_WALL = [
  { x: 0.22, y: 0.10 },
  { x: 0.98, y: 0.10 },
  { x: 0.32, y: 0.64 },
  { x: 0.12, y: 1 },
] as const;
const CENTER_BAND_LEFT_SEAM = [
  { x: 0.12, y: 1 },
  { x: 0.32, y: 0.64 },
] as const;

const focusedContext: FocusedSideFloorWallEvidenceContext = {
  attemptId: "v2-s3g-floor-wall",
  loadGeneration: 31,
  emptyIdentity: emptyBasis,
  originalAncestorSha256: originalSha,
  provider: "controlled_fixture",
  model: "fixture",
  observerProfile: "empty-side-floor-wall-conservative/v1",
  promptVersion: AFC_V2_EMPTY_SIDE_FLOOR_WALL_PROMPT_VERSION,
  generatedAt: "2026-08-29T18:00:00.000Z",
};

function polylineMidpointX(
  line: readonly { x: number; y: number }[],
): number {
  return (line[0].x + line[line.length - 1].x) / 2;
}

function generalRaw(options: {
  includeLeft?: boolean;
  includeRight?: boolean;
  includeFloor?: boolean;
  extraSeams?: unknown[];
  extraPlanes?: unknown[];
  backSeamPolyline?: readonly { x: number; y: number }[];
  floorPolygon?: readonly { x: number; y: number }[];
  leftWall?: readonly { x: number; y: number }[];
  leftSeam?: readonly { x: number; y: number }[];
  rightWall?: readonly { x: number; y: number }[];
  rightSeam?: readonly { x: number; y: number }[];
  backWall?: readonly { x: number; y: number }[];
} = {}) {
  const includeFloor = options.includeFloor !== false;
  const includeLeft = options.includeLeft === true;
  const includeRight = options.includeRight !== false;
  const backSeamPolyline = options.backSeamPolyline ?? BACK_SEAM;
  const floorPolygon = options.floorPolygon ?? FLOOR_POLYGON;
  const leftWall = options.leftWall ?? LEFT_WALL;
  const leftSeam = options.leftSeam ?? LEFT_SEAM;
  const rightWall = options.rightWall ?? RIGHT_WALL;
  const rightSeam = options.rightSeam ?? RIGHT_SEAM;
  const backWall = options.backWall ?? BACK_WALL;
  return {
    observedPlanes: [
      ...(includeFloor
        ? [{
          id: "visible_floor",
          category: "floor",
          sourceNormalizedPolygon: [...floorPolygon],
          confidence: 0.94,
          visibility: "observed",
        }]
        : []),
      {
        id: "visible_back_wall",
        category: "wall",
        sourceNormalizedPolygon: [...backWall],
        confidence: 0.91,
        visibility: "observed",
      },
      ...(includeLeft
        ? [{
          id: "visible_left_wall",
          category: "wall",
          sourceNormalizedPolygon: [...leftWall],
          confidence: 0.88,
          visibility: "observed",
        }]
        : []),
      ...(includeRight
        ? [{
          id: "visible_right_wall",
          category: "wall",
          sourceNormalizedPolygon: [...rightWall],
          confidence: 0.88,
          visibility: "observed",
        }]
        : []),
      ...(options.extraPlanes ?? []),
    ],
    observedSeams: [
      {
        id: "floor_wall_back",
        category: "floor_wall",
        planeIds: ["visible_floor", "visible_back_wall"],
        sourceNormalizedPolyline: [...backSeamPolyline],
        confidence: 0.92,
        visibility: "observed",
      },
      ...(includeRight
        ? [{
          id: "floor_wall_right",
          category: "floor_wall",
          planeIds: ["visible_floor", "visible_right_wall"],
          sourceNormalizedPolyline: [...rightSeam],
          confidence: 0.9,
          visibility: "observed",
        }]
        : []),
      ...(includeLeft
        ? [{
          id: "floor_wall_left",
          category: "floor_wall",
          planeIds: ["visible_floor", "visible_left_wall"],
          sourceNormalizedPolyline: [...leftSeam],
          confidence: 0.9,
          visibility: "observed",
        }]
        : []),
      ...(options.extraSeams ?? []),
    ],
    observedOpenings: [],
    observedJunctions: [],
    unresolved: [],
  };
}

function generalEvidence(
  raw: unknown = generalRaw(),
): EmptyRoomObservationAcceptedEvidence {
  return buildEmptyRoomObservationEvidence(raw, {
    ...focusedContext,
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
  });
}

function architecturalRaw(options: {
  includeLeft?: boolean;
  includeRight?: boolean;
  extraSeams?: unknown[];
  extraPlanes?: unknown[];
  backSeamPolyline?: readonly { x: number; y: number }[];
} = {}) {
  return generalRaw({
    ...options,
    floorPolygon: ARCH_FLOOR,
    leftWall: ARCH_LEFT_WALL,
    leftSeam: ARCH_LEFT_SEAM,
    rightWall: ARCH_RIGHT_WALL,
    rightSeam: ARCH_RIGHT_SEAM,
    backWall: ARCH_BACK_WALL,
    backSeamPolyline: options.backSeamPolyline ?? ARCH_BACK_SEAM,
  });
}

function truncFloorRaw(options: {
  includeLeft?: boolean;
  includeRight?: boolean;
  floorPolygon?: readonly { x: number; y: number }[];
  extraSeams?: unknown[];
  extraPlanes?: unknown[];
} = {}) {
  return generalRaw({
    ...options,
    includeLeft: options.includeLeft === true,
    includeRight: options.includeRight !== false,
    floorPolygon: options.floorPolygon ?? TRUNC_FLOOR,
    leftWall: TRUNC_LEFT_WALL,
    leftSeam: TRUNC_LEFT_GOOD_SEAM,
    rightWall: TRUNC_RIGHT_WALL,
    rightSeam: TRUNC_RIGHT_SEAM,
    backWall: TRUNC_BACK_WALL,
    backSeamPolyline: TRUNC_BACK_SEAM,
  });
}

function truncFloorMirroredRaw(options: {
  includeLeft?: boolean;
  includeRight?: boolean;
} = {}) {
  return generalRaw({
    includeLeft: options.includeLeft !== false,
    includeRight: options.includeRight === true,
    floorPolygon: MIRRORED_TRUNC_FLOOR,
    leftWall: MIRRORED_TRUNC_LEFT_WALL,
    leftSeam: MIRRORED_TRUNC_LEFT_SEAM,
    rightWall: TRUNC_RIGHT_GOOD_WALL,
    rightSeam: TRUNC_RIGHT_GOOD_SEAM,
    backWall: MIRRORED_TRUNC_BACK_WALL,
    backSeamPolyline: MIRRORED_TRUNC_BACK_SEAM,
  });
}

function wallWallSeam(args: {
  id: string;
  planeAId: string;
  planeBId: string;
  polyline: readonly { x: number; y: number }[];
}) {
  return {
    id: args.id,
    category: "wall_wall",
    planeIds: [args.planeAId, args.planeBId],
    sourceNormalizedPolyline: [...args.polyline],
    confidence: 0.9,
    visibility: "observed",
  };
}

function ceilingPlane() {
  return {
    id: "visible_ceiling",
    category: "ceiling",
    sourceNormalizedPolygon: [...ROOM2_CEILING],
    confidence: 0.8,
    visibility: "observed",
  };
}

function wallCeilingSeam(args: {
  id: string;
  wallId: string;
  polyline: readonly { x: number; y: number }[];
  ambiguity?: string | null;
}) {
  return {
    id: args.id,
    category: "wall_ceiling",
    planeIds: [args.wallId, "visible_ceiling"],
    sourceNormalizedPolyline: [...args.polyline],
    confidence: 0.75,
    visibility: "observed",
    ambiguity: args.ambiguity ?? null,
  };
}

function room2ClassRaw(options: {
  includeLeft?: boolean;
  includeRight?: boolean;
  includeWallWall?: boolean;
  includeCeiling?: boolean;
  includeLeftCeilingWall?: boolean;
  extraSeams?: unknown[];
  extraPlanes?: unknown[];
} = {}) {
  const includeLeft = options.includeLeft === true;
  const includeRight = options.includeRight !== false;
  const includeWallWall = options.includeWallWall !== false && includeRight;
  return generalRaw({
    includeLeft,
    includeRight,
    floorPolygon: ROOM2_FLOOR,
    leftWall: ROOM2_LEFT_WALL,
    leftSeam: ROOM2_LEFT_SEAM,
    rightWall: ROOM2_RIGHT_WALL,
    rightSeam: ROOM2_RIGHT_SEAM,
    backWall: ROOM2_BACK_WALL,
    backSeamPolyline: ROOM2_BACK_SEAM,
    extraPlanes: [
      ...(options.includeCeiling || options.includeLeftCeilingWall
        ? [ceilingPlane()]
        : []),
      ...(options.extraPlanes ?? []),
    ],
    extraSeams: [
      ...(includeWallWall
        ? [wallWallSeam({
          id: "wall_wall_back_right",
          planeAId: "visible_back_wall",
          planeBId: "visible_right_wall",
          polyline: ROOM2_WALL_WALL_BACK_RIGHT,
        })]
        : []),
      ...(options.includeLeftCeilingWall
        ? [wallCeilingSeam({
          id: "wall_ceiling_left",
          wallId: "visible_left_wall",
          polyline: ROOM2_LEFT_WALL_CEILING,
        })]
        : []),
      ...(options.extraSeams ?? []),
    ],
  });
}

function alreadyPresent(merged: EmptyRoomObservationAcceptedEvidence) {
  return receiptOf(merged).resolutionReasons.includes(
    FLOOR_WALL_MERGE_REASON.alreadyPresent,
  );
}

function focusedRoom2Left() {
  return focusedSide({
    side: "left",
    polygon: ROOM2_LEFT_WALL,
    polyline: ROOM2_LEFT_SEAM,
  });
}

function focusedRoom2Right() {
  return focusedSide({
    side: "right",
    polygon: ROOM2_RIGHT_WALL,
    polyline: ROOM2_RIGHT_SEAM,
  });
}

function lerpPoint(
  start: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
) {
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

function focusedSide(args: {
  side: FocusedSideFloorWallSide;
  polygon?: readonly { x: number; y: number }[] | null;
  polyline?: readonly { x: number; y: number }[] | null;
  confidence?: number;
  ambiguity?: string | null;
  frameTruncated?: boolean;
}) {
  return {
    side: args.side,
    wallPlaneVisible: true,
    sourceNormalizedWallPolygon: args.polygon === null
      ? undefined
      : [...(args.polygon ?? (args.side === "left" ? LEFT_WALL : RIGHT_WALL))],
    sourceNormalizedFloorWallPolyline: args.polyline === null
      ? undefined
      : [...(args.polyline ?? (args.side === "left" ? LEFT_SEAM : RIGHT_SEAM))],
    confidence: args.confidence ?? 0.82,
    visibility: "observed",
    ambiguity: args.ambiguity ?? null,
    frameTruncated: args.frameTruncated ?? true,
  };
}

function focusedEvidence(
  sides: unknown[] = [focusedSide({ side: "left" })],
  extra: Record<string, unknown> = {},
) {
  return buildFocusedSideFloorWallEvidence({
    observedSides: sides,
    unresolved: [],
    ...extra,
  }, focusedContext);
}

function floorWallCount(observation: EmptyRoomObservationAcceptedEvidence) {
  return observation.observedSeams.filter((seam) => seam.category === "floor_wall")
    .length;
}

function wallCount(observation: EmptyRoomObservationAcceptedEvidence) {
  return observation.observedPlanes.filter((plane) => plane.category === "wall")
    .length;
}

function polygonCentroidX(
  polygon: readonly { x: number; y: number }[],
): number {
  return polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length;
}

function wallsOnSide(
  observation: EmptyRoomObservationAcceptedEvidence,
  side: FocusedSideFloorWallSide,
) {
  return observation.observedPlanes.filter((plane) => {
    if (plane.category !== "wall") return false;
    const x = polygonCentroidX(plane.sourceNormalizedPolygon);
    return side === "left" ? x <= 0.4 : x >= 0.6;
  });
}

function floorWallSeamsBoundTo(
  observation: EmptyRoomObservationAcceptedEvidence,
  wallId: string,
) {
  const floor = observation.observedPlanes.find((plane) =>
    plane.category === "floor"
  );
  assert.ok(floor);
  return observation.observedSeams.filter((seam) =>
    seam.category === "floor_wall" &&
    seam.planeIds.includes(floor.id) &&
    seam.planeIds.includes(wallId)
  );
}

function adjacencyForSeam(
  observation: EmptyRoomObservationAcceptedEvidence,
  seamId: string,
) {
  return observation.observedAdjacency.find((adjacency) =>
    adjacency.seamId === seamId
  );
}

function requireMerged(
  merged: ReturnType<typeof mergeFocusedSideFloorWallObservation>,
): EmptyRoomObservationAcceptedEvidence {
  assert.ok(merged && merged.observerStatus !== "failed");
  return merged;
}

function construction(observation: EmptyRoomObservationAcceptedEvidence) {
  return {
    attemptId: focusedContext.attemptId,
    loadGeneration: focusedContext.loadGeneration,
    observation,
    emptyIdentity: {
      sha256: emptyBasis.sha256,
      decodedWidth: emptyBasis.decodedWidth,
      decodedHeight: emptyBasis.decodedHeight,
      orientation: 1 as const,
    },
    originalIdentity: {
      sha256: originalSha,
      decodedWidth: 1200,
      decodedHeight: 800,
      orientation: 1 as const,
    },
    floor: {
      authorityKey: "floor-key",
      worldWidthM: 6,
      referenceDepthM: 4,
      widthDepthRatio: 1.5,
    },
    camera: {
      verticalFovDeg: 52,
      pose: {
        position: { x: 0.4, y: 1.8, z: 4.2 },
        lookAt: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 1, z: 0 },
      },
      frame: { width: 900, height: 600 },
    },
    freezeReceipt: {
      receiptVersion: "afc-sr1-calibrated-camera-freeze-receipt/v1",
      integrity: { payloadSha256: "f".repeat(64) },
    },
  };
}

test("general omits left wall and seam; focused frame-truncated pair is merged", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  assert.equal(wallCount(general), 2);
  assert.equal(floorWallCount(general), 2);
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence(),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(wallCount(merged), 3);
  assert.equal(floorWallCount(merged), 3);
  const leftSeam = merged.observedSeams.find((seam) =>
    seam.category === "floor_wall" &&
    seam.id.includes("left")
  );
  assert.ok(leftSeam);
  assert.equal(leftSeam.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.equal(leftSeam.endpointPolicy, "preserve_observed_open_endpoints");
  assert.equal(leftSeam.planeIds[0], "visible_floor");
  assert.ok(leftSeam.planeIds[1]);
  assert.notEqual(leftSeam.confidence, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.geometryManufactured, false);
  assert.equal(
    merged.qualityGate.focusedSideFloorWall.hiddenContinuationAdded,
    false,
  );
  assert.deepEqual(merged.observedPlanes.find((plane) => plane.category === "floor")
    ?.sourceNormalizedPolygon, [...FLOOR_POLYGON]);
});

test("general omits right wall and seam; focused valid pair is merged", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: true,
    includeRight: false,
  }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "right" })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(wallCount(merged), 3);
  assert.equal(floorWallCount(merged), 3);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 1);
});

test("general already has wall and seam: focused duplicate is a no-op", () => {
  const general = generalEvidence(generalRaw({ includeLeft: true }));
  const beforePlanes = general.observedPlanes.map((plane) => plane.id);
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence(),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.deepEqual(merged.observedPlanes.map((plane) => plane.id), beforePlanes);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
});

test("general has wall missing seam: focused reuses the wall and adds seam only", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    extraPlanes: [{
      id: "visible_left_wall",
      category: "wall",
      sourceNormalizedPolygon: [...LEFT_WALL],
      confidence: 0.88,
      visibility: "observed",
    }],
  }));
  assert.equal(wallCount(general), 3);
  assert.equal(floorWallCount(general), 2);
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence(),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(wallCount(merged), 3);
  assert.equal(floorWallCount(merged), 3);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  const added = merged.observedSeams.find((seam) =>
    merged.qualityGate.focusedSideFloorWall.addedSeamIds.includes(seam.id)
  );
  assert.deepEqual(added?.planeIds, ["visible_floor", "visible_left_wall"]);
});

test("general missing wall and focused seam-only cannot merge", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left", polygon: null })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(wallCount(merged), 2);
  assert.equal(floorWallCount(merged), 2);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.seamWithoutWall,
    ),
  );
});

test("general floor missing: focused side floor-wall cannot merge", () => {
  const general = generalEvidence(generalRaw({ includeFloor: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence(),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(floorWallCount(merged), 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.floorMissing,
    ),
  );
});

test("focused seam not near general floor frontier is rejected", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polyline: [{ x: 0.32, y: 0.88 }, { x: 0.48, y: 0.78 }],
      polygon: [
        { x: 0.28, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.48, y: 0.78 },
        { x: 0.32, y: 0.88 },
      ],
    })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(floorWallCount(merged), 2);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ) ||
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.occupancyIncoherent,
    ) ||
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.sideMismatch,
    ),
  );
});

test("focused seam with incoherent local occupancy is rejected", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polyline: [...LEFT_SEAM],
      polygon: [...FLOOR_POLYGON],
    })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.occupancyIncoherent,
    ) ||
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.backWallContinuation,
    ) ||
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.sideMismatch,
    ),
  );
});

test("focused frame-truncated seam is accepted without hidden continuation", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      frameTruncated: true,
    })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.equal(
    merged.qualityGate.focusedSideFloorWall.hiddenContinuationAdded,
    false,
  );
  assert.equal(merged.qualityGate.focusedSideFloorWall.geometryManufactured, false);
});

test("focused seam that extends beyond reported wall support is rejected", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: [
        { x: 0.02, y: 0.85 },
        { x: 0.12, y: 0.82 },
        { x: 0.12, y: 0.98 },
        { x: 0.04, y: 1 },
      ],
      polyline: [
        { x: 0.04, y: 1 },
        { x: 0.18, y: 0.64 },
        { x: 0.2, y: 0.2 },
      ],
    })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.beyondSupport,
    ) ||
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearWallFrontier,
    ) ||
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("baseboard-like false edge is rejected", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polyline: [{ x: 0.02, y: 0.92 }, { x: 0.12, y: 0.58 }],
      polygon: [
        { x: 0, y: 0.2 },
        { x: 0.12, y: 0.16 },
        { x: 0.12, y: 0.58 },
        { x: 0.02, y: 0.92 },
      ],
    })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
});

test("floor-interior diagonal is rejected", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polyline: [{ x: 0.28, y: 0.9 }, { x: 0.42, y: 0.78 }],
      polygon: [
        { x: 0.22, y: 0.55 },
        { x: 0.45, y: 0.55 },
        { x: 0.42, y: 0.78 },
        { x: 0.28, y: 0.9 },
      ],
    })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
});

test("wall-wall-like near-vertical edge is rejected", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polyline: [{ x: 0.05, y: 0.2 }, { x: 0.055, y: 0.92 }],
    })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.nearVertical,
    ),
  );
});

test("ambiguous focused output is not merged", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      ambiguity: "Could be a baseboard rather than the floor-wall junction.",
    })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.ambiguous,
    ),
  );
});

test("focused call failure keeps general observation unchanged", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const failed = buildFailedFocusedSideFloorWallEvidence(focusedContext, {
    failureClass: "transport",
    failureStage: "provider_invocation",
    provider: "controlled_fixture",
    model: "fixture",
    providerStatus: null,
    safeDetail: "Controlled focused side-floor-wall failure.",
    contractValidationReason: null,
  });
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: failed,
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(floorWallCount(merged), 2);
  assert.equal(wallCount(merged), 2);
  assert.equal(merged.qualityGate.focusedSideFloorWall.observerStatus, "failed");
  assert.equal(merged.qualityGate.focusedSideFloorWall.geometryManufactured, false);
});

test("focused empty result keeps general observation unchanged", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(floorWallCount(merged), 2);
  assert.equal(merged.qualityGate.focusedSideFloorWall.observerStatus, "empty");
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
});

test("mismatched EMPTY identity rejects focused merge", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const mismatched = buildFocusedSideFloorWallEvidence({
    observedSides: [focusedSide({ side: "left" })],
    unresolved: [],
  }, {
    ...focusedContext,
    emptyIdentity: {
      ...emptyBasis,
      sha256: "b".repeat(64),
    },
  });
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: mismatched,
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(floorWallCount(merged), 2);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.identityMismatch,
    ),
  );
});

test("merge never manufactures geometry or hidden continuation", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence(),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(merged.qualityGate.focusedSideFloorWall.geometryManufactured, false);
  assert.equal(
    merged.qualityGate.focusedSideFloorWall.hiddenContinuationAdded,
    false,
  );
  assert.equal(merged.qualityGate.normalization.geometryManufactured, false);
  assert.equal(merged.qualityGate.normalization.hiddenContinuationAdded, false);
});

test("focused wall polygon without seam is a no-op", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left", polyline: null })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(wallCount(merged), 2);
  assert.equal(floorWallCount(merged), 2);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.wallWithoutSeam,
    ),
  );
});

test("generic three-wall composition reaches S4A candidate enumeration", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence(),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(floorWallCount(merged), 3);
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(merged));
  assert.equal(receipt.summary.candidateCount, 3);
  assert.ok(receipt.candidates.some((candidate) =>
    candidate.source.category === "floor_wall" &&
    candidate.source.observationSource === FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE &&
    candidate.source.planeIds.includes("visible_floor") &&
    candidate.sourceSeamId.includes("left")
  ));
  assert.equal(receipt.geometryManufactured, false);
});

test("Room-3-style general with left/right/back no-ops focused recovery", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: true,
    includeRight: true,
  }));
  assert.equal(floorWallCount(general), 3);
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([
      focusedSide({ side: "left" }),
      focusedSide({ side: "right" }),
    ]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(floorWallCount(merged), 3);
  assert.equal(wallCount(merged), 3);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 0);
});

test("Room-4-style general with existing side seams no-ops", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: true,
    includeRight: true,
  }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
});

test("Room-1-style back-only observation is unchanged by empty focused pass", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    includeRight: false,
  }));
  assert.equal(floorWallCount(general), 1);
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(floorWallCount(merged), 1);
  assert.equal(merged.observedSeams[0]?.id, "floor_wall_back");
});

test("wall-ceiling edge is not merged as floor-wall", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    extraSeams: [{
      id: "wall_ceiling_left",
      category: "wall_ceiling",
      planeIds: ["visible_back_wall", "visible_back_wall"],
      sourceNormalizedPolyline: [{ x: 0, y: 0.22 }, { x: 0.18, y: 0.16 }],
      confidence: 0.8,
      visibility: "observed",
    }],
  }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polyline: [{ x: 0, y: 0.22 }, { x: 0.18, y: 0.16 }],
    })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.equal(
    merged.observedSeams.filter((seam) => seam.category === "floor_wall").length,
    2,
  );
});

test("very short side wedge fails the generic minimum span", () => {
  assert.ok(FOCUSED_SIDE_FLOOR_WALL_MIN_IMAGE_SPAN >= 0.04);
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polyline: [{ x: 0.05, y: 0.99 }, { x: 0.06, y: 0.97 }],
    })]),
  });
  assert.ok(merged && merged.observerStatus !== "failed");
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.minSpan,
    ),
  );
});

test("merge source does not promote floor polygon edges into seams", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "app/admin/3d-room-lab-v2/empty-side-floor-wall-observation-merge.server.ts",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /sourceNormalizedPolygon\s*\[|floor\.sourceNormalizedPolygon\.slice/,
  );
  assert.match(source, /evaluateFrontierProximity/);
  assert.match(source, /classifyFocusedWallSupportingRegion/);
  assert.match(source, /focused_admitted:supporting_region_overshoot/);
  assert.match(source, /evaluateOppositeOccupancy/);
  assert.match(source, /pointIsFrameAdjacent/);
  assert.match(source, /classifyFrontierVertex/);
  assert.match(source, /observationSource: FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE/);
  assert.match(source, /findCompleteGeneralSideFloorWallPair/);
  assert.match(source, /classifyGeneralWallRole/);
  assert.match(source, /classifyProvenSideWallSide/);
  assert.match(source, /classifySeamKindByTrihedral/);
  assert.match(source, /focusedSeamPassesInSpanFloorFrontier/);
  assert.match(source, /focusedSeamPassesFloorFrontierConsistency/);
  assert.match(source, /focusedSeamPassesFrameTruncatedSideFrontier/);
  assert.match(source, /IN_SPAN_FLOOR_FRONTIER_SAMPLE_T/);
  assert.doesNotMatch(source, /generalWallsOnRequestedSide/);
  assert.doesNotMatch(source, /matchingGeneralWalls/);
  assert.doesNotMatch(source, /id\.includes\(["']left["']\)/);
  assert.doesNotMatch(source, /id\.includes\(["']right["']\)/);
  assert.doesNotMatch(source, /id\.includes\(["']back["']\)/);
  assert.doesNotMatch(source, /focusedSeam:/);
  assert.doesNotMatch(source, /function sideFloorWallSeams/);
  assert.doesNotMatch(source, /Room2|room === ["']Room/);
  assert.doesNotMatch(
    source,
    /if\s*\(\s*(?:args\.|side\.)?frameTruncated\s*\)\s*(?:return\s*\{?\s*pass:\s*true|return true)/,
  );
  assert.equal(ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE, 0.012);
  assert.deepEqual([...IN_SPAN_FLOOR_FRONTIER_SAMPLE_T], [0.25, 0.5, 0.75]);
});

test("complete General left pair suppresses focused left and preserves General", () => {
  const general = generalEvidence(generalRaw({ includeLeft: true }));
  const beforePlanes = general.observedPlanes.map((plane) => plane.id);
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const beforeAdjacency = general.observedAdjacency.map((adjacency) =>
    adjacency.id
  );
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  }));
  assert.deepEqual(merged.observedPlanes.map((plane) => plane.id), beforePlanes);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.deepEqual(
    merged.observedAdjacency.map((adjacency) => adjacency.id),
    beforeAdjacency,
  );
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.skippedDuplicateSeamIds.includes(
      "left_floor_wall",
    ),
  );
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
});

test("General left wall present without bound seam: focused seam fills and reuses wall", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    extraPlanes: [{
      id: "visible_left_wall",
      category: "wall",
      sourceNormalizedPolygon: [...LEFT_WALL],
      confidence: 0.88,
      visibility: "observed",
    }],
  }));
  assert.equal(wallsOnSide(general, "left").length, 1);
  assert.equal(floorWallSeamsBoundTo(general, "visible_left_wall").length, 0);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  }));
  assert.equal(wallCount(merged), 3);
  assert.equal(floorWallCount(merged), 3);
  assert.equal(wallsOnSide(merged, "left").length, 1);
  const bound = floorWallSeamsBoundTo(merged, "visible_left_wall");
  assert.equal(bound.length, 1);
  assert.deepEqual(bound[0].planeIds, ["visible_floor", "visible_left_wall"]);
  assert.equal(bound[0].observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.addedSeamIds.includes(bound[0].id),
  );
  const adjacency = adjacencyForSeam(merged, bound[0].id);
  assert.ok(adjacency);
  assert.equal(adjacency.planeAId, "visible_floor");
  assert.equal(adjacency.planeBId, "visible_left_wall");
  assert.equal(adjacency.seamId, bound[0].id);
});

test("left-biased back floor-wall seam does not suppress focused left recovery", () => {
  assert.ok(polylineMidpointX(LEFT_BIASED_BACK_SEAM) <= 0.4);
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    backSeamPolyline: LEFT_BIASED_BACK_SEAM,
  }));
  assert.equal(wallsOnSide(general, "left").length, 0);
  assert.equal(wallCount(general), 2);
  assert.equal(floorWallCount(general), 2);
  const backSeam = general.observedSeams.find((seam) =>
    seam.id === "floor_wall_back"
  );
  assert.ok(backSeam);
  assert.deepEqual(backSeam.planeIds, ["visible_floor", "visible_back_wall"]);
  assert.ok(polylineMidpointX(backSeam.sourceNormalizedPolyline) <= 0.4);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  }));
  assert.equal(wallCount(merged), 3);
  assert.equal(floorWallCount(merged), 3);
  assert.equal(wallsOnSide(merged, "left").length, 1);
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeams = floorWallSeamsBoundTo(merged, leftWall.id);
  assert.equal(leftSeams.length, 1);
  assert.equal(leftSeams[0].observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.addedPlaneIds.includes(leftWall.id),
  );
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.addedSeamIds.includes(leftSeams[0].id),
  );
  assert.equal(
    merged.qualityGate.focusedSideFloorWall.skippedDuplicateSeamIds.includes(
      "left_floor_wall",
    ),
    false,
  );
  assert.equal(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
    false,
  );
  const adjacency = adjacencyForSeam(merged, leftSeams[0].id);
  assert.ok(adjacency);
  assert.equal(adjacency.planeAId, "visible_floor");
  assert.equal(adjacency.planeBId, leftWall.id);
});

test("General neither left wall nor left seam: focused complete left adds both", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  assert.equal(wallsOnSide(general, "left").length, 0);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  }));
  assert.equal(wallCount(merged), 3);
  assert.equal(floorWallCount(merged), 3);
  const leftWall = wallsOnSide(merged, "left")[0];
  assert.ok(leftWall);
  const leftSeams = floorWallSeamsBoundTo(merged, leftWall.id);
  assert.equal(leftSeams.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.ok(adjacencyForSeam(merged, leftSeams[0].id));
});

test("General floor polygon left edge is not duplicate evidence for focused left", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const floor = general.observedPlanes.find((plane) => plane.category === "floor");
  assert.ok(floor);
  assert.deepEqual(floor.sourceNormalizedPolygon, [...FLOOR_POLYGON]);
  assert.equal(wallsOnSide(general, "left").length, 0);
  assert.equal(
    general.observedSeams.filter((seam) =>
      seam.category === "floor_wall" &&
      seam.planeIds.some((id) => id.includes("left"))
    ).length,
    0,
  );
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(floorWallCount(merged), 3);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.deepEqual(
    merged.observedPlanes.find((plane) => plane.category === "floor")
      ?.sourceNormalizedPolygon,
    [...FLOOR_POLYGON],
  );
  assert.equal(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
    false,
  );
});

test("complete General right pair suppresses focused right", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    includeRight: true,
  }));
  const beforeRight = wallsOnSide(general, "right");
  assert.equal(beforeRight.length, 1);
  assert.equal(floorWallSeamsBoundTo(general, beforeRight[0].id).length, 1);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "right" })]),
  }));
  assert.equal(wallsOnSide(merged, "right").length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_right_wall").length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.skippedDuplicateSeamIds.includes(
      "right_floor_wall",
    ),
  );
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
});

test("both General sides complete: focused both sides are suppressed with no duplicates", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: true,
    includeRight: true,
  }));
  const beforePlanes = general.observedPlanes.map((plane) => plane.id);
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([
      focusedSide({ side: "left" }),
      focusedSide({ side: "right" }),
    ]),
  }));
  assert.deepEqual(merged.observedPlanes.map((plane) => plane.id), beforePlanes);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(wallsOnSide(merged, "right").length, 1);
  assert.equal(floorWallCount(merged), 3);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.skippedDuplicateSeamIds.includes(
      "left_floor_wall",
    ),
  );
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.skippedDuplicateSeamIds.includes(
      "right_floor_wall",
    ),
  );
});

test("left incomplete and right complete: focused left fills, focused right suppressed", () => {
  assert.ok(polylineMidpointX(LEFT_BIASED_BACK_SEAM) <= 0.4);
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    includeRight: true,
    backSeamPolyline: LEFT_BIASED_BACK_SEAM,
  }));
  assert.equal(wallsOnSide(general, "left").length, 0);
  assert.equal(wallsOnSide(general, "right").length, 1);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([
      focusedSide({ side: "left" }),
      focusedSide({ side: "right" }),
    ]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(wallsOnSide(merged, "right").length, 1);
  assert.equal(wallCount(merged), 3);
  assert.equal(floorWallCount(merged), 3);
  const leftWall = wallsOnSide(merged, "left")[0];
  assert.equal(floorWallSeamsBoundTo(merged, leftWall.id).length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_right_wall").length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.skippedDuplicateSeamIds.includes(
      "right_floor_wall",
    ),
  );
  assert.equal(
    merged.qualityGate.focusedSideFloorWall.skippedDuplicateSeamIds.includes(
      "left_floor_wall",
    ),
    false,
  );
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
});

test("back seam bound to floor+back wall is not a complete left-side pair", () => {
  assert.ok(polylineMidpointX(LEFT_BIASED_BACK_SEAM) <= 0.4);
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    backSeamPolyline: LEFT_BIASED_BACK_SEAM,
  }));
  const backSeam = general.observedSeams.find((seam) =>
    seam.id === "floor_wall_back"
  );
  assert.ok(backSeam);
  assert.deepEqual(backSeam.planeIds, ["visible_floor", "visible_back_wall"]);
  const backWall = general.observedPlanes.find((plane) =>
    plane.id === "visible_back_wall"
  );
  assert.ok(backWall);
  assert.ok(polygonCentroidX(backWall.sourceNormalizedPolygon) > 0.4);
  assert.ok(polygonCentroidX(backWall.sourceNormalizedPolygon) < 0.6);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  }));
  assert.equal(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
    false,
  );
  assert.equal(wallsOnSide(merged, "left").length, 1);
  const leftWall = wallsOnSide(merged, "left")[0];
  assert.notEqual(leftWall.id, "visible_back_wall");
  assert.equal(floorWallSeamsBoundTo(merged, leftWall.id).length, 1);
  assert.deepEqual(
    merged.observedSeams.find((seam) => seam.id === "floor_wall_back")?.planeIds,
    ["visible_floor", "visible_back_wall"],
  );
});

test("General left wall plus wrongly bound back seam still accepts focused left seam", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    backSeamPolyline: LEFT_BIASED_BACK_SEAM,
    extraPlanes: [{
      id: "visible_left_wall",
      category: "wall",
      sourceNormalizedPolygon: [...LEFT_WALL],
      confidence: 0.88,
      visibility: "observed",
    }],
  }));
  assert.equal(wallsOnSide(general, "left").length, 1);
  assert.equal(floorWallSeamsBoundTo(general, "visible_left_wall").length, 0);
  const backSeam = general.observedSeams.find((seam) =>
    seam.id === "floor_wall_back"
  );
  assert.ok(backSeam);
  assert.deepEqual(backSeam.planeIds, ["visible_floor", "visible_back_wall"]);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 1);
  const bound = floorWallSeamsBoundTo(merged, "visible_left_wall");
  assert.equal(bound.length, 1);
  assert.deepEqual(bound[0].planeIds, ["visible_floor", "visible_left_wall"]);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.ok(adjacencyForSeam(merged, bound[0].id));
});

test("multiple matching General left walls fail closed", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    extraPlanes: [
      {
        id: "visible_left_wall",
        category: "wall",
        sourceNormalizedPolygon: [...LEFT_WALL],
        confidence: 0.88,
        visibility: "observed",
      },
      {
        id: "visible_left_wall_alt",
        category: "wall",
        sourceNormalizedPolygon: [...LEFT_WALL],
        confidence: 0.84,
        visibility: "observed",
      },
    ],
  }));
  assert.ok(wallsOnSide(general, "left").length >= 2);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  }));
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 0);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall_alt").length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.ambiguousWallMatch,
    ),
  );
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.rejectedSeamIds.includes(
      "left_floor_wall",
    ),
  );
});

test("focused ambiguous left is not filled", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    backSeamPolyline: LEFT_BIASED_BACK_SEAM,
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      ambiguity: "Could be a baseboard rather than the floor-wall junction.",
    })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.ambiguous,
    ),
  );
});

test("focused near-vertical wall-wall-like rejection is unchanged", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    backSeamPolyline: LEFT_BIASED_BACK_SEAM,
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polyline: [{ x: 0.05, y: 0.2 }, { x: 0.055, y: 0.92 }],
    })]),
  }));
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.equal(wallsOnSide(merged, "left").length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.nearVertical,
    ),
  );
  assert.equal(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
    false,
  );
});

test("focused valid seam without usable wall and without matching General wall is rejected", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left", polygon: null })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 0);
  assert.equal(floorWallCount(merged), 2);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.seamWithoutWall,
    ),
  );
});

test("focused wall without coherent seam is not filled", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left", polyline: null })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 0);
  assert.equal(floorWallCount(merged), 2);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.wallWithoutSeam,
    ),
  );
});

test("successful complete General left still suppresses focused even with left-biased back seam", () => {
  assert.ok(polylineMidpointX(LEFT_BIASED_BACK_SEAM) <= 0.4);
  const general = generalEvidence(generalRaw({
    includeLeft: true,
    backSeamPolyline: LEFT_BIASED_BACK_SEAM,
  }));
  const beforePlanes = general.observedPlanes.map((plane) => plane.id);
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  }));
  assert.deepEqual(merged.observedPlanes.map((plane) => plane.id), beforePlanes);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 0);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 0);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
});

test("failed Room-2-style omission: left-biased back seam, no left pair, focused both sides", () => {
  assert.ok(polylineMidpointX(LEFT_BIASED_BACK_SEAM) <= 0.4);
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    includeRight: true,
    backSeamPolyline: LEFT_BIASED_BACK_SEAM,
  }));
  assert.equal(wallCount(general), 2);
  assert.equal(floorWallCount(general), 2);
  assert.equal(wallsOnSide(general, "left").length, 0);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([
      focusedSide({ side: "left" }),
      focusedSide({ side: "right" }),
    ]),
  }));
  assert.equal(wallCount(merged), 3);
  assert.equal(floorWallCount(merged), 3);
  const leftWall = wallsOnSide(merged, "left")[0];
  assert.ok(leftWall);
  const leftSeams = floorWallSeamsBoundTo(merged, leftWall.id);
  assert.equal(leftSeams.length, 1);
  assert.equal(leftSeams[0].observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.equal(wallsOnSide(merged, "right").length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_right_wall").length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.ok(
    merged.qualityGate.focusedSideFloorWall.skippedDuplicateSeamIds.includes(
      "right_floor_wall",
    ),
  );
  const adjacency = adjacencyForSeam(merged, leftSeams[0].id);
  assert.ok(adjacency);
  assert.equal(adjacency.planeAId, "visible_floor");
  assert.equal(adjacency.planeBId, leftWall.id);
});

test("focused-added left seam is enumerated by S4A and not rejected for focused provenance", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    includeRight: true,
    backSeamPolyline: LEFT_BIASED_BACK_SEAM,
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([
      focusedSide({ side: "left" }),
      focusedSide({ side: "right" }),
    ]),
  }));
  const leftWall = wallsOnSide(merged, "left")[0];
  assert.ok(leftWall);
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  assert.ok(leftSeam);
  assert.equal(leftSeam.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  const receipt = constructAfcV2RoomBoundaryAuthority(construction(merged));
  assert.ok(receipt.summary.candidateCount >= 3);
  const leftCandidate = receipt.candidates.find((candidate) =>
    candidate.sourceSeamId === leftSeam.id
  );
  assert.ok(leftCandidate);
  assert.equal(leftCandidate.source.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.equal(
    leftCandidate.reasons.includes("focused_observer_cannot_create_world_boundary"),
    false,
  );
  assert.notEqual(leftCandidate.status, "rejected");
});

test("failed general observation is not rewritten by focused recovery", () => {
  const failed = buildFailedEmptyRoomObservationEvidence({
    ...focusedContext,
    observerProfile: "empty-visible-architecture-conservative/v1",
    promptVersion: "afc-v2-empty-visible-room-observer/v5",
  }, {
    failureClass: "transport",
    failureStage: "provider_invocation",
    provider: "controlled_fixture",
    model: "fixture",
    providerStatus: null,
    safeDetail: "Controlled general failure.",
    contractValidationReason: null,
  });
  const merged = mergeFocusedSideFloorWallObservation({
    general: failed,
    focused: focusedEvidence(),
  });
  assert.equal(merged, failed);
});

function receiptOf(merged: EmptyRoomObservationAcceptedEvidence) {
  return merged.qualityGate.focusedSideFloorWall;
}

test("complete General correct left + focused correct duplicate is suppressed", () => {
  const general = generalEvidence(architecturalRaw({ includeLeft: true }));
  const beforePlanes = general.observedPlanes.map((plane) => plane.id);
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const beforeAdjacency = general.observedAdjacency.map((adjacency) =>
    adjacency.id
  );
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: ARCH_LEFT_WALL,
      polyline: ARCH_LEFT_SEAM,
    })]),
  }));
  assert.deepEqual(merged.observedPlanes.map((plane) => plane.id), beforePlanes);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.deepEqual(
    merged.observedAdjacency.map((adjacency) => adjacency.id),
    beforeAdjacency,
  );
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(receiptOf(merged).skippedDuplicateSeamIds.includes("left_floor_wall"));
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
});

test("complete General correct left + focused wrong patch-bottom is suppressed", () => {
  const general = generalEvidence(architecturalRaw({ includeLeft: true }));
  const beforePlanes = general.observedPlanes.map((plane) => plane.id);
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: WRONG_LEFT_PATCH_WALL,
      polyline: WRONG_LEFT_PATCH_SEAM,
    })]),
  }));
  assert.deepEqual(merged.observedPlanes.map((plane) => plane.id), beforePlanes);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(wallsOnSide(merged, "left")[0].id, "visible_left_wall");
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
  assert.equal(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
    false,
  );
});

test("General omits left + focused wrong patch-bottom is rejected in-span", () => {
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  assert.equal(wallsOnSide(general, "left").length, 0);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: WRONG_LEFT_PATCH_WALL,
      polyline: WRONG_LEFT_PATCH_SEAM,
    })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 0);
  assert.equal(floorWallCount(merged), floorWallCount(general));
  assert.equal(wallCount(merged), wallCount(general));
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(receiptOf(merged).rejectedSeamIds.includes("left_floor_wall"));
  assert.ok(receiptOf(merged).rejectedPlaneIds.includes("left_wall"));
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
  assert.equal(receiptOf(merged).geometryManufactured, false);
});

test("General omits left + focused correct long seam fills the omission", () => {
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: ARCH_LEFT_WALL,
      polyline: ARCH_LEFT_SEAM,
    })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 1);
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeams = floorWallSeamsBoundTo(merged, leftWall.id);
  assert.equal(leftSeams.length, 1);
  assert.equal(leftSeams[0].observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.ok(adjacencyForSeam(merged, leftSeams[0].id));
  assert.equal(receiptOf(merged).geometryManufactured, false);
});

test("General wall present seam missing + focused wrong patch-bottom is rejected", () => {
  const general = generalEvidence(architecturalRaw({
    includeLeft: false,
    extraPlanes: [{
      id: "visible_left_wall",
      category: "wall",
      sourceNormalizedPolygon: [...ARCH_LEFT_WALL],
      confidence: 0.88,
      visibility: "observed",
    }],
  }));
  assert.equal(wallsOnSide(general, "left").length, 1);
  assert.equal(floorWallSeamsBoundTo(general, "visible_left_wall").length, 0);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: WRONG_LEFT_PATCH_WALL,
      polyline: WRONG_LEFT_PATCH_SEAM,
    })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(wallsOnSide(merged, "left")[0].id, "visible_left_wall");
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 0);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("complete General right + focused wrong right patch is suppressed", () => {
  const general = generalEvidence(architecturalRaw({
    includeLeft: false,
    includeRight: true,
  }));
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "right",
      polygon: WRONG_RIGHT_PATCH_WALL,
      polyline: WRONG_RIGHT_PATCH_SEAM,
    })]),
  }));
  assert.equal(wallsOnSide(merged, "right").length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_right_wall").length, 1);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
});

test("General floor polygon edge only + focused correct long seam is allowed", () => {
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  const floor = general.observedPlanes.find((plane) => plane.category === "floor");
  assert.ok(floor);
  assert.deepEqual(floor.sourceNormalizedPolygon, [...ARCH_FLOOR]);
  assert.equal(wallsOnSide(general, "left").length, 0);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: ARCH_LEFT_WALL,
      polyline: ARCH_LEFT_SEAM,
    })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.deepEqual(
    merged.observedPlanes.find((plane) => plane.category === "floor")
      ?.sourceNormalizedPolygon,
    [...ARCH_FLOOR],
  );
});

test("endpoint junction pass + frame N/A + midpoint contradiction rejects focused", () => {
  const frameEnd = WRONG_LEFT_PATCH_SEAM[0];
  const junction = WRONG_LEFT_PATCH_SEAM[1];
  const midpoint = lerpPoint(frameEnd, junction, 0.5);
  assert.equal(pointIsFrameAdjacent(frameEnd), true);
  assert.equal(
    classifyFrontierVertex(junction, ARCH_FLOOR, []).status,
    "pass",
  );
  assert.equal(
    classifyFrontierVertex(frameEnd, ARCH_FLOOR, []).status,
    "not_applicable",
  );
  assert.equal(
    classifyFrontierVertex(midpoint, ARCH_FLOOR, []).status,
    "contradiction",
  );
  const inSpan = focusedSeamPassesInSpanFloorFrontier(
    WRONG_LEFT_PATCH_SEAM,
    ARCH_FLOOR,
  );
  assert.equal(inSpan.pass, false);
  assert.ok(inSpan.sampleStatuses.includes("contradiction"));
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: WRONG_LEFT_PATCH_WALL,
      polyline: WRONG_LEFT_PATCH_SEAM,
    })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("three in-span floor-frontier passes remain eligible", () => {
  assert.deepEqual([...IN_SPAN_FLOOR_FRONTIER_SAMPLE_T], [0.25, 0.5, 0.75]);
  const inSpan = focusedSeamPassesInSpanFloorFrontier(
    ARCH_LEFT_SEAM,
    ARCH_FLOOR,
  );
  assert.deepEqual([...inSpan.sampleStatuses], ["pass", "pass", "pass"]);
  assert.equal(inSpan.pass, true);
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: ARCH_LEFT_WALL,
      polyline: ARCH_LEFT_SEAM,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
});

test("one in-span contradiction rejects with no majority vote", () => {
  const bulge = [
    { x: 0.045, y: 0.999 },
    { x: 0.22, y: 0.847 },
    { x: 0.078, y: 0.696 },
  ] as const;
  const inSpan = focusedSeamPassesInSpanFloorFrontier(bulge, ARCH_FLOOR);
  assert.ok(inSpan.sampleStatuses.includes("contradiction"));
  const passCount = inSpan.sampleStatuses.filter((status) =>
    status === "pass"
  ).length;
  assert.equal(inSpan.pass, false);
  assert.ok(passCount < IN_SPAN_FLOOR_FRONTIER_SAMPLE_T.length);
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: ARCH_LEFT_WALL,
      polyline: bulge,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.equal(wallsOnSide(merged, "left").length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("General complete left + left-biased back seam + focused wrong patch still dominates", () => {
  assert.ok(polylineMidpointX(ARCH_LEFT_BIASED_BACK_SEAM) <= 0.4);
  const general = generalEvidence(architecturalRaw({
    includeLeft: true,
    backSeamPolyline: ARCH_LEFT_BIASED_BACK_SEAM,
  }));
  const beforePlanes = general.observedPlanes.map((plane) => plane.id);
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: WRONG_LEFT_PATCH_WALL,
      polyline: WRONG_LEFT_PATCH_SEAM,
    })]),
  }));
  assert.deepEqual(merged.observedPlanes.map((plane) => plane.id), beforePlanes);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
});

test("left-biased back seam without a General left wall is not complete-General dominance", () => {
  assert.ok(polylineMidpointX(ARCH_LEFT_BIASED_BACK_SEAM) <= 0.4);
  const general = generalEvidence(architecturalRaw({
    includeLeft: false,
    backSeamPolyline: ARCH_LEFT_BIASED_BACK_SEAM,
  }));
  assert.equal(wallsOnSide(general, "left").length, 0);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: ARCH_LEFT_WALL,
      polyline: ARCH_LEFT_SEAM,
    })]),
  }));
  assert.equal(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
    false,
  );
  assert.equal(wallsOnSide(merged, "left").length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
});

test("frame-truncated correct long focused seam is allowed", () => {
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  const inSpan = focusedSeamPassesInSpanFloorFrontier(
    FRAME_TRUNCATED_LEFT_SEAM,
    ARCH_FLOOR,
  );
  assert.equal(inSpan.pass, true);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: ARCH_LEFT_WALL,
      polyline: FRAME_TRUNCATED_LEFT_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).hiddenContinuationAdded, false);
  assert.equal(receiptOf(merged).geometryManufactured, false);
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  assert.ok(leftSeam);
  assert.deepEqual(
    leftSeam.sourceNormalizedPolyline,
    [...FRAME_TRUNCATED_LEFT_SEAM],
  );
  assert.ok(adjacencyForSeam(merged, leftSeam.id));
});

test("frame-left patch cut that departs the floor frontier is rejected", () => {
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: WRONG_LEFT_PATCH_WALL,
      polyline: WRONG_LEFT_PATCH_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 0);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(receiptOf(merged).rejectedSeamIds.includes("left_floor_wall"));
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("architectural focused recovery still reaches S4A as a candidate", () => {
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: ARCH_LEFT_WALL,
      polyline: ARCH_LEFT_SEAM,
    })]),
  }));
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  assert.ok(leftSeam);
  assert.equal(leftSeam.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  const s4a = constructAfcV2RoomBoundaryAuthority(construction(merged));
  const leftCandidate = s4a.candidates.find((candidate) =>
    candidate.sourceSeamId === leftSeam.id
  );
  assert.ok(leftCandidate);
  assert.equal(leftCandidate.source.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.equal(
    leftCandidate.reasons.includes("focused_observer_cannot_create_world_boundary"),
    false,
  );
  assert.notEqual(leftCandidate.status, "rejected");
});

test("canonical Room 2 back+right: left-biased back is not LEFT, focused left fills", () => {
  assert.ok(polygonCentroidX(ROOM2_BACK_WALL) <= 0.4);
  const general = generalEvidence(room2ClassRaw({ includeLeft: false }));
  assert.ok(general.observedPlanes.some((plane) =>
    plane.id === "visible_back_wall"
  ));
  assert.ok(general.observedPlanes.some((plane) =>
    plane.id === "visible_right_wall"
  ));
  assert.equal(
    general.observedPlanes.some((plane) => plane.id === "visible_left_wall"),
    false,
  );
  assert.ok(general.observedSeams.some((seam) =>
    seam.id === "floor_wall_back" &&
    seam.planeIds.includes("visible_back_wall")
  ));
  assert.ok(general.observedSeams.some((seam) =>
    seam.id === "floor_wall_right"
  ));
  assert.equal(
    general.observedSeams.some((seam) =>
      seam.category === "floor_wall" &&
      seam.planeIds.includes("visible_left_wall")
    ),
    false,
  );
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left(), focusedRoom2Right()]),
  }));
  assert.ok(
    receiptOf(merged).skippedDuplicateSeamIds.includes("right_floor_wall"),
  );
  assert.equal(
    receiptOf(merged).skippedDuplicateSeamIds.includes("left_floor_wall"),
    false,
  );
  assert.equal(
    receiptOf(merged).resolutionReasons.filter((reason) =>
      reason === FLOOR_WALL_MERGE_REASON.alreadyPresent
    ).length,
    1,
  );
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  const leftWallId = receiptOf(merged).addedPlaneIds[0];
  assert.notEqual(leftWallId, "visible_back_wall");
  const leftSeams = floorWallSeamsBoundTo(merged, leftWallId);
  assert.equal(leftSeams.length, 1);
  assert.deepEqual(leftSeams[0].planeIds, ["visible_floor", leftWallId]);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_right_wall").length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_back_wall").length, 1);
  assert.equal(floorWallCount(merged), 3);
  assert.ok(adjacencyForSeam(merged, leftSeams[0].id));
  assert.equal(receiptOf(merged).geometryManufactured, false);
});

test("left-biased back wall centroid without a true left wall is not left ownership", () => {
  assert.ok(polygonCentroidX(ROOM2_BACK_WALL) <= 0.4);
  const general = generalEvidence(room2ClassRaw({
    includeLeft: false,
    includeWallWall: false,
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left()]),
  }));
  assert.equal(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
    false,
  );
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.notEqual(receiptOf(merged).addedPlaneIds[0], "visible_back_wall");
});

test("right-biased back wall without a true right wall is not right ownership", () => {
  assert.ok(polygonCentroidX(RIGHT_BIASED_BACK_WALL) >= 0.6);
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    includeRight: false,
    floorPolygon: MIRRORED_FLOOR,
    backWall: RIGHT_BIASED_BACK_WALL,
    backSeamPolyline: RIGHT_BIASED_BACK_SEAM,
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "right",
      polygon: MIRRORED_RIGHT_WALL,
      polyline: MIRRORED_RIGHT_SEAM,
    })]),
  }));
  assert.equal(alreadyPresent(merged), false);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.notEqual(receiptOf(merged).addedPlaneIds[0], "visible_back_wall");
});

test("back floor-wall seam midpoint x <= 0.4 still is not left ownership", () => {
  assert.ok(polylineMidpointX(ROOM2_BACK_SEAM) <= 0.4);
  const general = generalEvidence(room2ClassRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left()]),
  }));
  assert.equal(alreadyPresent(merged), false);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
});

test("General complete left+back+right with left-biased back still owns left", () => {
  assert.ok(polygonCentroidX(ROOM2_BACK_WALL) <= 0.4);
  const general = generalEvidence(room2ClassRaw({ includeLeft: true }));
  const beforePlanes = general.observedPlanes.map((plane) => plane.id);
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left(), focusedRoom2Right()]),
  }));
  assert.deepEqual(merged.observedPlanes.map((plane) => plane.id), beforePlanes);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_right_wall").length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(receiptOf(merged).skippedDuplicateSeamIds.includes("left_floor_wall"));
  assert.ok(receiptOf(merged).skippedDuplicateSeamIds.includes("right_floor_wall"));
});

test("back+right only: right complete, left absent", () => {
  const general = generalEvidence(room2ClassRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left(), focusedRoom2Right()]),
  }));
  assert.ok(receiptOf(merged).skippedDuplicateSeamIds.includes("right_floor_wall"));
  assert.equal(
    receiptOf(merged).skippedDuplicateSeamIds.includes("left_floor_wall"),
    false,
  );
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_right_wall").length, 1);
});

test("back+left only: left complete, right absent", () => {
  const general = generalEvidence(room2ClassRaw({
    includeLeft: true,
    includeRight: false,
    includeWallWall: false,
    extraSeams: [wallWallSeam({
      id: "wall_wall_back_left",
      planeAId: "visible_back_wall",
      planeBId: "visible_left_wall",
      polyline: [
        { x: 0.078, y: 0.220 },
        { x: 0.078, y: 0.694 },
      ],
    })],
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([
      focusedRoom2Left(),
      focusedSide({
        side: "right",
        polygon: MIRRORED_RIGHT_WALL,
        polyline: MIRRORED_RIGHT_SEAM,
      }),
    ]),
  }));
  assert.ok(receiptOf(merged).skippedDuplicateSeamIds.includes("left_floor_wall"));
  assert.equal(
    receiptOf(merged).skippedDuplicateSeamIds.includes("right_floor_wall"),
    false,
  );
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
});

test("mirrored off-axis back occupying the right half remains BACK", () => {
  assert.ok(polygonCentroidX(RIGHT_BIASED_BACK_WALL) >= 0.6);
  const general = generalEvidence(generalRaw({
    includeLeft: true,
    includeRight: false,
    floorPolygon: MIRRORED_FLOOR,
    leftWall: MIRRORED_LEFT_WALL,
    leftSeam: MIRRORED_LEFT_SEAM,
    backWall: RIGHT_BIASED_BACK_WALL,
    backSeamPolyline: RIGHT_BIASED_BACK_SEAM,
    extraSeams: [wallWallSeam({
      id: "wall_wall_back_left",
      planeAId: "visible_back_wall",
      planeBId: "visible_left_wall",
      polyline: MIRRORED_WALL_WALL,
    })],
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([
      focusedSide({
        side: "left",
        polygon: MIRRORED_LEFT_WALL,
        polyline: MIRRORED_LEFT_SEAM,
      }),
      focusedSide({
        side: "right",
        polygon: MIRRORED_RIGHT_WALL,
        polyline: MIRRORED_RIGHT_SEAM,
      }),
    ]),
  }));
  assert.ok(receiptOf(merged).skippedDuplicateSeamIds.includes("left_floor_wall"));
  assert.equal(
    receiptOf(merged).skippedDuplicateSeamIds.includes("right_floor_wall"),
    false,
  );
  assert.equal(floorWallSeamsBoundTo(merged, "visible_back_wall").length, 1);
  assert.notEqual(
    receiptOf(merged).addedPlaneIds[0] ?? null,
    "visible_back_wall",
  );
});

test("structurally proven side wall with center-band centroid is still LEFT", () => {
  assert.ok(polygonCentroidX(CENTER_BAND_LEFT_WALL) > 0.4);
  assert.ok(polygonCentroidX(CENTER_BAND_LEFT_WALL) < 0.6);
  const general = generalEvidence(generalRaw({
    includeLeft: true,
    leftWall: CENTER_BAND_LEFT_WALL,
    leftSeam: CENTER_BAND_LEFT_SEAM,
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: CENTER_BAND_LEFT_WALL,
      polyline: CENTER_BAND_LEFT_SEAM,
    })]),
  }));
  assert.equal(alreadyPresent(merged), true);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
});

test("left floor-wall valid without left wall-ceiling still owns LEFT", () => {
  const general = generalEvidence(room2ClassRaw({ includeLeft: true }));
  assert.equal(
    general.observedSeams.some((seam) => seam.category === "wall_ceiling"),
    false,
  );
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left()]),
  }));
  assert.equal(alreadyPresent(merged), true);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
});

test("left wall-ceiling without left floor-wall is not complete floor-wall ownership", () => {
  const general = generalEvidence(room2ClassRaw({
    includeLeft: false,
    includeLeftCeilingWall: true,
    extraPlanes: [{
      id: "visible_left_wall",
      category: "wall",
      sourceNormalizedPolygon: [...ROOM2_LEFT_WALL],
      confidence: 0.88,
      visibility: "observed",
    }],
  }));
  assert.ok(general.observedSeams.some((seam) =>
    seam.category === "wall_ceiling"
  ));
  assert.equal(floorWallSeamsBoundTo(general, "visible_left_wall").length, 0);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left()]),
  }));
  assert.equal(alreadyPresent(merged), false);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
});

test("ambiguous left wall-ceiling does not block structurally valid left floor-wall", () => {
  const general = generalEvidence(room2ClassRaw({
    includeLeft: true,
    includeCeiling: true,
    extraSeams: [wallCeilingSeam({
      id: "wall_ceiling_left",
      wallId: "visible_left_wall",
      polyline: ROOM2_LEFT_WALL_CEILING,
      ambiguity: "Could be pelmet rather than the wall-ceiling junction.",
    })],
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left()]),
  }));
  assert.equal(alreadyPresent(merged), true);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
});

test("Room 2 General left wall present, seam missing: focused seam fills", () => {
  const general = generalEvidence(room2ClassRaw({
    includeLeft: false,
    extraPlanes: [{
      id: "visible_left_wall",
      category: "wall",
      sourceNormalizedPolygon: [...ROOM2_LEFT_WALL],
      confidence: 0.88,
      visibility: "observed",
    }],
  }));
  assert.equal(floorWallSeamsBoundTo(general, "visible_left_wall").length, 0);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left()]),
  }));
  assert.equal(alreadyPresent(merged), false);
  assert.equal(floorWallSeamsBoundTo(merged, "visible_left_wall").length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
});

test("General floor-wall on a non-side wall does not suppress focused side fill", () => {
  const general = generalEvidence(room2ClassRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left()]),
  }));
  assert.equal(alreadyPresent(merged), false);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
});

test("two structurally proven left side walls fail closed", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: true,
    extraPlanes: [{
      id: "visible_left_wall_alt",
      category: "wall",
      sourceNormalizedPolygon: [...LEFT_WALL],
      confidence: 0.84,
      visibility: "observed",
    }],
    extraSeams: [{
      id: "floor_wall_left_alt",
      category: "floor_wall",
      planeIds: ["visible_floor", "visible_left_wall_alt"],
      sourceNormalizedPolyline: [...LEFT_SEAM],
      confidence: 0.84,
      visibility: "observed",
    }],
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({ side: "left" })]),
  }));
  assert.equal(alreadyPresent(merged), false);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.ambiguousWallMatch,
    ),
  );
});

test("complete General left-biased-back room + focused wrong patch is suppressed", () => {
  const general = generalEvidence(room2ClassRaw({ includeLeft: true }));
  const beforePlanes = general.observedPlanes.map((plane) => plane.id);
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: WRONG_LEFT_PATCH_WALL,
      polyline: WRONG_LEFT_PATCH_SEAM,
    })]),
  }));
  assert.deepEqual(merged.observedPlanes.map((plane) => plane.id), beforePlanes);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.equal(alreadyPresent(merged), true);
  assert.equal(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
    false,
  );
});

test("incomplete General left-biased-back + focused wrong patch is rejected in-span, not suppressed", () => {
  const general = generalEvidence(room2ClassRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: WRONG_LEFT_PATCH_WALL,
      polyline: WRONG_LEFT_PATCH_SEAM,
    })]),
  }));
  assert.equal(alreadyPresent(merged), false);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("canonical Room 2 omission recovery reaches S4A with back, right, and left", () => {
  const general = generalEvidence(room2ClassRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedRoom2Left()]),
  }));
  const leftWallId = receiptOf(merged).addedPlaneIds[0];
  assert.ok(leftWallId);
  const leftSeam = floorWallSeamsBoundTo(merged, leftWallId)[0];
  assert.ok(leftSeam);
  assert.equal(leftSeam.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.ok(merged.observedPlanes.some((plane) =>
    plane.id === "visible_back_wall"
  ));
  assert.ok(merged.observedPlanes.some((plane) =>
    plane.id === "visible_right_wall"
  ));
  assert.ok(merged.observedPlanes.some((plane) => plane.id === leftWallId));
  assert.equal(floorWallCount(merged), 3);
  const s4a = constructAfcV2RoomBoundaryAuthority(construction(merged));
  assert.ok(s4a.summary.candidateCount >= 3);
  const leftCandidate = s4a.candidates.find((candidate) =>
    candidate.sourceSeamId === leftSeam.id
  );
  assert.ok(leftCandidate);
  assert.equal(leftCandidate.source.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.equal(
    leftCandidate.reasons.includes("focused_observer_cannot_create_world_boundary"),
    false,
  );
  const backCandidate = s4a.candidates.find((candidate) =>
    candidate.sourceSeamId === "floor_wall_back"
  );
  const rightCandidate = s4a.candidates.find((candidate) =>
    candidate.sourceSeamId === "floor_wall_right"
  );
  assert.ok(backCandidate);
  assert.ok(rightCandidate);
});

test("merge source keeps 0.4/0.6 bands and does not require wall_ceiling for role", () => {
  const source = readFileSync(
    path.join(
      process.cwd(),
      "app/admin/3d-room-lab-v2/empty-side-floor-wall-observation-merge.server.ts",
    ),
    "utf8",
  );
  assert.match(source, /x <= 0\.4/);
  assert.match(source, /x >= 0\.6/);
  assert.match(source, /wall_ceiling is never/);
  assert.match(source, /IN_SPAN_FLOOR_FRONTIER_SAMPLE_T/);
  assert.match(source, /focusedSeamPassesFloorFrontierConsistency/);
  assert.equal(ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE, 0.012);
});

function truncLeftFocused(args: {
  polyline: readonly { x: number; y: number }[];
  polygon?: readonly { x: number; y: number }[];
  frameTruncated?: boolean;
  ambiguity?: string | null;
}) {
  return focusedSide({
    side: "left",
    polygon: args.polygon ?? TRUNC_LEFT_WALL,
    polyline: args.polyline,
    frameTruncated: args.frameTruncated,
    ambiguity: args.ambiguity,
  });
}

test("non-truncated exact frontier still requires in-span 0.012 and passes", () => {
  const strict = focusedSeamPassesFloorFrontierConsistency({
    seam: ARCH_LEFT_SEAM,
    floorPolygon: ARCH_FLOOR,
    side: "left",
    frameTruncated: false,
  });
  const inSpan = focusedSeamPassesInSpanFloorFrontier(
    ARCH_LEFT_SEAM,
    ARCH_FLOOR,
  );
  assert.deepEqual([...inSpan.sampleStatuses], ["pass", "pass", "pass"]);
  assert.equal(inSpan.pass, true);
  assert.equal(strict.pass, true);
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: ARCH_LEFT_WALL,
      polyline: ARCH_LEFT_SEAM,
      frameTruncated: false,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
});

test("non-truncated interior divergence beyond 0.012 still rejects", () => {
  const bulge = [
    { x: 0.045, y: 0.999 },
    { x: 0.22, y: 0.847 },
    { x: 0.078, y: 0.696 },
  ] as const;
  const inSpan = focusedSeamPassesInSpanFloorFrontier(bulge, ARCH_FLOOR);
  assert.equal(inSpan.pass, false);
  const strict = focusedSeamPassesFloorFrontierConsistency({
    seam: bulge,
    floorPolygon: ARCH_FLOOR,
    side: "left",
    frameTruncated: false,
  });
  assert.equal(strict.pass, false);
  const general = generalEvidence(architecturalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: ARCH_LEFT_WALL,
      polyline: bulge,
      frameTruncated: false,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("canonical Room 2 frame-truncated good left seam passes merge consistency", () => {
  const inSpan = focusedSeamPassesInSpanFloorFrontier(
    TRUNC_LEFT_GOOD_SEAM,
    TRUNC_FLOOR,
  );
  assert.equal(inSpan.pass, false);
  const relaxed = focusedSeamPassesFloorFrontierConsistency({
    seam: TRUNC_LEFT_GOOD_SEAM,
    floorPolygon: TRUNC_FLOOR,
    side: "left",
    frameTruncated: true,
  });
  assert.equal(relaxed.pass, true);
  const general = generalEvidence(truncFloorRaw());
  assert.equal(wallsOnSide(general, "left").length, 0);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_GOOD_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.equal(wallsOnSide(merged, "left").length, 1);
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  assert.ok(leftSeam);
  assert.deepEqual(leftSeam.sourceNormalizedPolyline, [...TRUNC_LEFT_GOOD_SEAM]);
  assert.equal(leftSeam.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.ok(adjacencyForSeam(merged, leftSeam.id));
  assert.equal(receiptOf(merged).geometryManufactured, false);
  assert.equal(receiptOf(merged).hiddenContinuationAdded, false);
  assert.equal(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
    false,
  );
});

test("canonical old patch-bottom frame-truncated seam is rejected", () => {
  const relaxed = focusedSeamPassesFloorFrontierConsistency({
    seam: WRONG_LEFT_PATCH_SEAM,
    floorPolygon: TRUNC_FLOOR,
    side: "left",
    frameTruncated: true,
  });
  assert.equal(relaxed.pass, false);
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: WRONG_LEFT_PATCH_WALL,
      polyline: WRONG_LEFT_PATCH_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 0);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(receiptOf(merged).rejectedSeamIds.includes("left_floor_wall"));
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("junction pass plus high left-frame termination is rejected", () => {
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_LATERAL_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("junction pass plus correct bottom-frame region with numeric divergence passes", () => {
  const inSpan = focusedSeamPassesInSpanFloorFrontier(
    TRUNC_LEFT_BOTTOM_SEAM,
    TRUNC_FLOOR,
  );
  assert.equal(inSpan.pass, false);
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_BOTTOM_SEAM,
      polygon: [
        { x: 0.008, y: 0.22 },
        { x: 0.076, y: 0.22 },
        { x: 0.076, y: 0.696 },
        { x: 0.008, y: 1 },
      ],
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.equal(wallsOnSide(merged, "left").length, 1);
});

test("junction itself beyond 0.012 rejects even with good foreground direction", () => {
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_FAR_JUNCTION_SEAM,
      polygon: [
        { x: 0, y: 0.22 },
        { x: 0.22, y: 0.22 },
        { x: 0.22, y: 0.696 },
        { x: 0, y: 1 },
      ],
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("frameTruncated false with Room-2-style divergence stays in strict mode and rejects", () => {
  const strict = focusedSeamPassesFloorFrontierConsistency({
    seam: TRUNC_LEFT_GOOD_SEAM,
    floorPolygon: TRUNC_FLOOR,
    side: "left",
    frameTruncated: false,
  });
  assert.equal(strict.pass, false);
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_GOOD_SEAM,
      frameTruncated: false,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("right-side mirror of good frame-truncated seam passes", () => {
  const inSpan = focusedSeamPassesInSpanFloorFrontier(
    TRUNC_RIGHT_GOOD_SEAM,
    MIRRORED_TRUNC_FLOOR,
  );
  assert.equal(inSpan.pass, false);
  const general = generalEvidence(truncFloorMirroredRaw({ includeRight: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "right",
      polygon: TRUNC_RIGHT_GOOD_WALL,
      polyline: TRUNC_RIGHT_GOOD_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(wallsOnSide(merged, "right").length, 1);
});

test("right-side mirror of bad lateral patch seam is rejected", () => {
  const general = generalEvidence(truncFloorMirroredRaw({ includeRight: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "right",
      polygon: TRUNC_RIGHT_PATCH_WALL,
      polyline: TRUNC_RIGHT_PATCH_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.equal(wallsOnSide(merged, "right").length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("bottom-left corner endpoint is compatible with bottom-frame General endpoint", () => {
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_GOOD_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  assert.deepEqual(leftSeam.sourceNormalizedPolyline[0], { x: 0, y: 1 });
});

test("left-frame-high endpoint is incompatible with bottom-left General endpoint", () => {
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: WRONG_LEFT_PATCH_SEAM,
      polygon: WRONG_LEFT_PATCH_WALL,
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("correct frame region but rearward first step is rejected", () => {
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_REARWARD_SEAM,
      polygon: [
        { x: 0, y: 0.22 },
        { x: 0.12, y: 0.22 },
        { x: 0.12, y: 0.696 },
        { x: 0, y: 1 },
      ],
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("correct direction without a usable General side floor frontier fails closed", () => {
  const general = generalEvidence(truncFloorRaw({
    floorPolygon: TRUNC_NO_SIDE_FLOOR,
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_GOOD_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("focused ambiguity still rejects before frame-truncated relaxation", () => {
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_GOOD_SEAM,
      frameTruncated: true,
      ambiguity: "Could be a compact wall-patch bottom rather than the floor-wall.",
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.ambiguous,
    ),
  );
});

test("near-vertical wall-wall-like focused result still rejects before relaxation", () => {
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polyline: [{ x: 0.05, y: 0.2 }, { x: 0.055, y: 0.92 }],
      polygon: [
        { x: 0, y: 0.18 },
        { x: 0.06, y: 0.18 },
        { x: 0.06, y: 0.92 },
        { x: 0, y: 0.92 },
      ],
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.nearVertical,
    ),
  );
});

test("complete General left suppresses good frame-truncated focused before relaxation", () => {
  const general = generalEvidence(truncFloorRaw({ includeLeft: true }));
  const beforePlanes = general.observedPlanes.map((plane) => plane.id);
  const beforeSeams = general.observedSeams.map((seam) => seam.id);
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_GOOD_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.deepEqual(merged.observedPlanes.map((plane) => plane.id), beforePlanes);
  assert.deepEqual(merged.observedSeams.map((seam) => seam.id), beforeSeams);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
});

test("General incomplete plus good frame-truncated focused adds left wall and seam", () => {
  const general = generalEvidence(truncFloorRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_GOOD_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.equal(wallsOnSide(merged, "left").length, 1);
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  assert.ok(leftSeam);
  assert.ok(adjacencyForSeam(merged, leftSeam.id));
  assert.equal(merged.qualityGate.focusedSideFloorWall.geometryManufactured, false);
});

test("General incomplete plus bad frame-truncated focused is rejected", () => {
  const general = generalEvidence(truncFloorRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: WRONG_LEFT_PATCH_WALL,
      polyline: WRONG_LEFT_PATCH_SEAM,
      frameTruncated: true,
    })]),
  }));
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.equal(wallsOnSide(merged, "left").length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("canonical good frame-truncated recovery preserves observation object shape", () => {
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_GOOD_SEAM,
      frameTruncated: true,
    })]),
  }));
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  assert.ok(leftWall);
  assert.ok(leftSeam);
  assert.equal(leftWall.category, "wall");
  assert.equal(leftSeam.category, "floor_wall");
  assert.ok(merged.observedPlanes.some((plane) => plane.id === "visible_back_wall"));
  assert.ok(merged.observedPlanes.some((plane) => plane.id === "visible_right_wall"));
  assert.ok(merged.observedSeams.some((seam) => seam.id === "floor_wall_back"));
  assert.ok(merged.observedSeams.some((seam) => seam.id === "floor_wall_right"));
  assert.ok(adjacencyForSeam(merged, leftSeam.id));
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedPlaneIds.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.addedSeamIds.length, 1);
  assert.equal(merged.qualityGate.focusedSideFloorWall.geometryManufactured, false);
  assert.equal(
    merged.qualityGate.focusedSideFloorWall.hiddenContinuationAdded,
    false,
  );
});

test("canonical good frame-truncated left reaches S4A with back and right", () => {
  const general = generalEvidence(truncFloorRaw());
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([truncLeftFocused({
      polyline: TRUNC_LEFT_GOOD_SEAM,
      frameTruncated: true,
    })]),
  }));
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  assert.ok(leftSeam);
  assert.equal(leftSeam.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  const s4a = constructAfcV2RoomBoundaryAuthority(construction(merged));
  assert.ok(s4a.summary.candidateCount >= 3);
  const leftCandidate = s4a.candidates.find((candidate) =>
    candidate.sourceSeamId === leftSeam.id
  );
  assert.ok(leftCandidate);
  assert.equal(leftCandidate.source.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.equal(
    leftCandidate.reasons.includes("focused_observer_cannot_create_world_boundary"),
    false,
  );
  assert.ok(s4a.candidates.some((candidate) =>
    candidate.sourceSeamId === "floor_wall_back"
  ));
  assert.ok(s4a.candidates.some((candidate) =>
    candidate.sourceSeamId === "floor_wall_right"
  ));
});

test("Test A: supporting-region overshoot admits focused left wall and seam", () => {
  const rear = LEFT_SEAM[1];
  const rearDistance = distanceToPolygonFrontier(rear, OVERSHOOT_LEFT_WALL);
  assert.equal(pointInPolygon(rear, OVERSHOOT_LEFT_WALL), true);
  assert.ok(rearDistance !== null && rearDistance > ROOM_BOUNDARY_IMAGE_FRONTIER_MAX_DISTANCE);
  assert.equal(
    classifyFocusedWallSupportingRegion(LEFT_SEAM, OVERSHOOT_LEFT_WALL, FLOOR_POLYGON),
    "supporting_region_interior_overshoot",
  );
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: OVERSHOOT_LEFT_WALL,
      polyline: LEFT_SEAM,
      frameTruncated: false,
    })]),
  }));
  assert.equal(wallsOnSide(merged, "left").length, 1);
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  assert.ok(leftSeam);
  assert.equal(leftSeam.observationSource, FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.supportingRegionOvershoot,
    ),
  );
  const diagnostic = receiptOf(merged).observedSideDiagnostics.find((item) =>
    item.side === "left"
  );
  assert.ok(diagnostic);
  assert.equal(
    diagnostic.supportingRegionClass,
    "supporting_region_interior_overshoot",
  );
  assert.deepEqual(diagnostic.sourceNormalizedWallPolygon, [...OVERSHOOT_LEFT_WALL]);
  assert.deepEqual(diagnostic.sourceNormalizedFloorWallPolyline, [...LEFT_SEAM]);
});

test("Test B: tight focused wall outline remains admitted", () => {
  assert.equal(
    classifyFocusedWallSupportingRegion(LEFT_SEAM, LEFT_WALL, FLOOR_POLYGON),
    "outline_coherent",
  );
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: LEFT_WALL,
      polyline: LEFT_SEAM,
      frameTruncated: false,
    })]),
  }));
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.equal(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.supportingRegionOvershoot,
    ),
    false,
  );
  assert.equal(
    receiptOf(merged).observedSideDiagnostics[0]?.supportingRegionClass,
    "outline_coherent",
  );
});

test("Test C: radiator / interior false edge remains rejected", () => {
  const radiator = [
    { x: 0.07, y: 0.38 },
    { x: 0.14, y: 0.34 },
  ] as const;
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: OVERSHOOT_LEFT_WALL,
      polyline: radiator,
      frameTruncated: false,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("Test D: floating unrelated seam remains rejected", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: [
        { x: 0, y: 0.08 },
        { x: 0.10, y: 0.08 },
        { x: 0.10, y: 0.28 },
        { x: 0, y: 0.28 },
      ],
      polyline: LEFT_SEAM,
      frameTruncated: false,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.beyondSupport,
    ) ||
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearWallFrontier,
    ) ||
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.notNearFloorFrontier,
    ),
  );
});

test("Test E: general duplicate remains suppressed", () => {
  const general = generalEvidence(generalRaw({ includeLeft: true }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: OVERSHOOT_LEFT_WALL,
      polyline: LEFT_SEAM,
      frameTruncated: false,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 0);
  assert.equal(receiptOf(merged).addedPlaneIds.length, 0);
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
});

test("Test F: right duplicate suppression does not block left supporting-region admission", () => {
  const general = generalEvidence(generalRaw({
    includeLeft: false,
    includeRight: true,
  }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([
      focusedSide({
        side: "left",
        polygon: OVERSHOOT_LEFT_WALL,
        polyline: LEFT_SEAM,
        frameTruncated: false,
      }),
      focusedSide({ side: "right" }),
    ]),
  }));
  assert.equal(receiptOf(merged).addedPlaneIds.length, 1);
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  assert.ok(
    receiptOf(merged).skippedDuplicateSeamIds.includes("right_floor_wall"),
  );
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.alreadyPresent,
    ),
  );
  assert.ok(
    receiptOf(merged).resolutionReasons.includes(
      FLOOR_WALL_MERGE_REASON.supportingRegionOvershoot,
    ),
  );
  const leftWall = wallsOnSide(merged, "left")[0];
  assert.ok(leftWall);
  assert.equal(
    floorWallSeamsBoundTo(merged, leftWall.id)[0]?.observationSource,
    FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE,
  );
});

test("Test G/H: S4A enumerates focused overshoot and does not re-veto wall outline", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: OVERSHOOT_LEFT_WALL,
      polyline: LEFT_SEAM,
      frameTruncated: false,
    })]),
  }));
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  assert.ok(leftSeam);
  const s4a = constructAfcV2RoomBoundaryAuthority(construction(merged));
  const leftCandidate = s4a.candidates.find((candidate) =>
    candidate.sourceSeamId === leftSeam.id
  );
  assert.ok(leftCandidate);
  assert.equal(
    leftCandidate.source.observationSource,
    FOCUSED_SIDE_FLOOR_WALL_OBSERVATION_SOURCE,
  );
  assert.equal(
    leftCandidate.reasons.includes("focused_observer_cannot_create_world_boundary"),
    false,
  );
  assert.equal(
    leftCandidate.reasons.includes("seam_not_near_wall_polygon_frontier"),
    false,
  );
  assert.ok(
    leftCandidate.reasons.includes("focused_supporting_region_wall_outline_overshoot") ||
      leftCandidate.imageEvidence.frontier?.nearWallFrontier === true,
  );
});

test("self-audit: supporting-region overshoot through S4A and S4B", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: OVERSHOOT_LEFT_WALL,
      polyline: LEFT_SEAM,
      frameTruncated: false,
    })]),
  }));
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  const s4a = constructAfcV2RoomBoundaryAuthority(construction(merged));
  const leftCandidate = s4a.candidates.find((candidate) =>
    candidate.sourceSeamId === leftSeam.id
  );
  assert.ok(leftCandidate);
  assert.equal(leftCandidate.status, "accepted");
  assert.equal(leftCandidate.authority.collision, false);
  assert.equal(s4a.collisionAuthority, false);
  const s4b = constructAfcV2RoomCollisionAuthority({
    roomBoundary: s4a,
    observation: merged,
  });
  const leftCollision = s4b.boundaries.find((boundary) =>
    boundary.sourceSeamId === leftSeam.id
  );
  assert.ok(leftCollision);
  assert.equal(
    leftCollision.collisionEnabled,
    true,
    leftCollision.qualificationReasons.join(" | "),
  );
});

test("Test J: focused supporting-region admission is not collision authority", () => {
  const general = generalEvidence(generalRaw({ includeLeft: false }));
  const merged = requireMerged(mergeFocusedSideFloorWallObservation({
    general,
    focused: focusedEvidence([focusedSide({
      side: "left",
      polygon: OVERSHOOT_LEFT_WALL,
      polyline: LEFT_SEAM,
      frameTruncated: false,
    })]),
  }));
  assert.equal(receiptOf(merged).addedSeamIds.length, 1);
  const s4a = constructAfcV2RoomBoundaryAuthority({
    ...construction(merged),
    originalIdentity: {
      sha256: "b".repeat(64),
      decodedWidth: 400,
      decodedHeight: 900,
      orientation: 1 as const,
    },
  });
  const leftWall = wallsOnSide(merged, "left")[0];
  const leftSeam = floorWallSeamsBoundTo(merged, leftWall.id)[0];
  const leftCandidate = s4a.candidates.find((candidate) =>
    candidate.sourceSeamId === leftSeam.id
  );
  assert.ok(leftCandidate);
  assert.notEqual(leftCandidate.status, "accepted");
  assert.equal(s4a.collisionAuthority, false);
  const s4b = constructAfcV2RoomCollisionAuthority({
    roomBoundary: s4a,
    observation: merged,
  });
  const leftCollision = s4b.boundaries.find((boundary) =>
    boundary.sourceSeamId === leftSeam.id
  );
  assert.ok(leftCollision);
  assert.equal(leftCollision.collisionEnabled, false);
});

