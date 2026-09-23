import {
  aabbIsValid,
  footprintFromLocalAabb,
} from "./collision-footprint";
import {
  NUMERICAL_DISTANCE_EPSILON,
  overlapPenetration,
  posePenetratesWalls,
  prepareCollisionWall,
  resolveSweptConvexTranslation,
  type CollisionTranslationStatus,
} from "./collision-geometry";
import type { LocalAabb, RuntimeCollisionWall, WorldTransform } from "./types";

export type SceneCollisionMode = "move" | "pose";

export type SceneCollisionStatus =
  | CollisionTranslationStatus
  | "rejected_pose";

export type SceneCollisionResult = Readonly<{
  transform: WorldTransform;
  status: SceneCollisionStatus;
  contactWallIds: readonly string[];
  skippedInvalidWallCount: number;
  unresolvedOverlap: boolean;
}>;

/**
 * Object runtime adapter. Consumes S4B-enabled walls only.
 * Does not inspect observation, S4A qualification, or manufacture geometry.
 */
export function resolveSceneObjectCollision(input: Readonly<{
  current: WorldTransform;
  proposed: WorldTransform;
  localAabb: LocalAabb | null;
  walls: readonly RuntimeCollisionWall[];
  mode: SceneCollisionMode;
}>): SceneCollisionResult {
  const walls = input.walls;
  if (walls.length === 0) {
    return passthrough(input.proposed);
  }
  if (!aabbIsValid(input.localAabb)) {
    return {
      transform: cloneTransform(input.current),
      status: "rejected_pose",
      contactWallIds: Object.freeze([]),
      skippedInvalidWallCount: 0,
      unresolvedOverlap: false,
    };
  }

  const prepared = walls.map(prepareCollisionWall);
  const skippedInvalidWallCount = prepared.filter((wall) => wall === null).length;
  const readyWalls = prepared.filter(
    (wall): wall is NonNullable<typeof wall> => wall !== null,
  );
  if (readyWalls.length === 0) {
    return {
      ...passthrough(input.proposed),
      skippedInvalidWallCount,
    };
  }

  const currentFootprint = footprintFromLocalAabb(input.localAabb, input.current);
  if (input.mode === "pose") {
    return resolvePose({
      current: input.current,
      proposed: input.proposed,
      localAabb: input.localAabb,
      currentFootprint,
      walls: readyWalls,
      skippedInvalidWallCount,
    });
  }

  const translation = {
    x: input.proposed.position.x - input.current.position.x,
    z: input.proposed.position.z - input.current.position.z,
  };
  const swept = resolveSweptConvexTranslation({
    startVertices: currentFootprint,
    translation,
    walls,
    allowSlide: true,
  });
  return {
    transform: {
      position: {
        x: input.current.position.x + swept.translation.x,
        y: input.proposed.position.y,
        z: input.current.position.z + swept.translation.z,
      },
      rotationDeg: { ...input.current.rotationDeg },
      uniformScale: input.current.uniformScale,
    },
    status: swept.status,
    contactWallIds: swept.contactWallIds,
    skippedInvalidWallCount: swept.skippedInvalidWallCount,
    unresolvedOverlap: swept.unresolvedOverlap,
  };
}

function resolvePose(input: {
  current: WorldTransform;
  proposed: WorldTransform;
  localAabb: LocalAabb;
  currentFootprint: ReturnType<typeof footprintFromLocalAabb>;
  walls: NonNullable<ReturnType<typeof prepareCollisionWall>>[];
  skippedInvalidWallCount: number;
}): SceneCollisionResult {
  const proposedFootprint = footprintFromLocalAabb(input.localAabb, input.proposed);
  const currentPenetrating = posePenetratesWalls(input.currentFootprint, input.walls);
  const proposedPenetrating = posePenetratesWalls(proposedFootprint, input.walls);

  if (!currentPenetrating) {
    if (!proposedPenetrating) return passthrough(input.proposed, input.skippedInvalidWallCount);
    return {
      transform: cloneTransform(input.current),
      status: "rejected_pose",
      contactWallIds: Object.freeze(
        input.walls
          .filter((wall) => overlapPenetration(proposedFootprint, wall) > NUMERICAL_DISTANCE_EPSILON)
          .map((wall) => wall.id)
          .sort(),
      ),
      skippedInvalidWallCount: input.skippedInvalidWallCount,
      unresolvedOverlap: false,
    };
  }

  const deeper = input.walls.some((wall) =>
    overlapPenetration(proposedFootprint, wall) >
      overlapPenetration(input.currentFootprint, wall) + NUMERICAL_DISTANCE_EPSILON
  );
  if (deeper) {
    return {
      transform: cloneTransform(input.current),
      status: "start_overlapping",
      contactWallIds: Object.freeze(
        input.walls
          .filter((wall) =>
            overlapPenetration(input.currentFootprint, wall) > NUMERICAL_DISTANCE_EPSILON
          )
          .map((wall) => wall.id)
          .sort(),
      ),
      skippedInvalidWallCount: input.skippedInvalidWallCount,
      unresolvedOverlap: true,
    };
  }
  return {
    transform: cloneTransform(input.proposed),
    status: "start_overlapping",
    contactWallIds: Object.freeze(
      input.walls
        .filter((wall) => overlapPenetration(proposedFootprint, wall) > NUMERICAL_DISTANCE_EPSILON)
        .map((wall) => wall.id)
        .sort(),
    ),
    skippedInvalidWallCount: input.skippedInvalidWallCount,
    unresolvedOverlap: proposedPenetrating,
  };
}

function passthrough(
  transform: WorldTransform,
  skippedInvalidWallCount = 0,
): SceneCollisionResult {
  return {
    transform: cloneTransform(transform),
    status: "accepted",
    contactWallIds: Object.freeze([]),
    skippedInvalidWallCount,
    unresolvedOverlap: false,
  };
}

function cloneTransform(transform: WorldTransform): WorldTransform {
  return {
    position: { ...transform.position },
    rotationDeg: { ...transform.rotationDeg },
    uniformScale: transform.uniformScale,
  };
}
