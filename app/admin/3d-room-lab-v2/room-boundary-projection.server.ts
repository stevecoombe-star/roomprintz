import type { PerspectiveCamera } from "three";

import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "../3d-room-lab/calibrated-camera-readonly-projection";
import { intersectOverlayRayWithFloorPlane } from "../3d-room-lab/calibrated-floor-ray";
import {
  projectEmptyFloorPointToWorldXZ,
  type EmptyToWorldXZProjectionResult,
} from "../3d-room-lab/empty-to-world-xz-projection";
import {
  sourceNormToContainerNormUnclamped,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "../3d-room-lab/image-space";
import type { AfcR3cImagePairCompatibility } from "../3d-room-lab/research/afc-r3c-image-pair-compatibility";
import type { SourceNormalizedPoint } from "./empty-room-observation-contract";
import {
  AFC_V2_ROOM_BOUNDARY_PROJECTION_KERNEL_VERSION,
  type FrozenRoomBoundaryCameraSnapshot,
  type RoomBoundaryPerPointProjection,
  type RoomBoundaryProjectionFailureReason,
  type RoomBoundaryWorldXyz,
} from "./room-boundary-authority-contract";

export { AFC_V2_ROOM_BOUNDARY_PROJECTION_KERNEL_VERSION };

export const ROOM_BOUNDARY_PROJECTION_NEAR =
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR;
export const ROOM_BOUNDARY_PROJECTION_FAR =
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR;

export type RoomBoundaryProjectionIdentities = Readonly<{
  emptyIntrinsicSize: ImageIntrinsicSize;
  originalIntrinsicSize: ImageIntrinsicSize;
  compatibility: AfcR3cImagePairCompatibility;
}>;

export type RealizedRoomBoundaryCamera =
  | Readonly<{ ok: true; camera: PerspectiveCamera }>
  | Readonly<{ ok: false; reason: string }>;

export type OriginalWorldProjectionResult =
  | Readonly<{
      ok: true;
      originalSourceNormalized: SourceNormalizedPoint;
      containerNormalized: SourceNormalizedPoint;
      world: RoomBoundaryWorldXyz;
    }>
  | Readonly<{
      ok: false;
      reason: RoomBoundaryProjectionFailureReason;
      detail: string;
    }>;

/**
 * Realize the frozen V2 snapshot exactly as the certified ORIGINAL viewer does.
 * Never uses live-resized V1 host camera state.
 */
export function realizeFrozenRoomBoundaryCamera(
  snapshot: FrozenRoomBoundaryCameraSnapshot,
): RealizedRoomBoundaryCamera {
  return buildCalibratedReadOnlyProjectionCamera({
    fovDeg: snapshot.verticalFovDeg,
    pose: snapshot.pose,
    frameSize: snapshot.frame,
    near: ROOM_BOUNDARY_PROJECTION_NEAR,
    far: ROOM_BOUNDARY_PROJECTION_FAR,
  });
}

/**
 * Authority mapping: Original source-normalized → unclamped cover container.
 * Always run, even when frame aspect appears matched.
 */
export function mapOriginalSourceNormalizedToContainer(
  originalSourceNormalized: SourceNormalizedPoint,
  originalIntrinsicSize: ImageIntrinsicSize,
  frame: ImageFrameSize,
): SourceNormalizedPoint | null {
  return sourceNormToContainerNormUnclamped(
    originalSourceNormalized,
    originalIntrinsicSize,
    frame,
  );
}

function mapEmptyProjectionFailure(
  result: Extract<EmptyToWorldXZProjectionResult, { ok: false }>,
): Extract<RoomBoundaryPerPointProjection, { ok: false }>["reason"] {
  return result.reason;
}

function mapRayFailure(
  reason: string,
): RoomBoundaryProjectionFailureReason {
  if (
    reason === "camera unavailable" ||
    reason === "non-finite input" ||
    reason === "invalid ray direction" ||
    reason === "ray parallel to floor" ||
    reason === "invalid intersection distance" ||
    reason === "intersection behind camera" ||
    reason === "non-finite intersection point"
  ) {
    return reason;
  }
  if (reason === "ray_parallel_to_floor") return "ray_parallel_to_floor";
  if (reason === "ray_intersection_behind_camera") {
    return "ray_intersection_behind_camera";
  }
  return "ray_projection_failed";
}

export function projectOriginalSourceNormalizedToWorld(
  originalSourceNormalized: SourceNormalizedPoint,
  originalIntrinsicSize: ImageIntrinsicSize,
  frame: ImageFrameSize,
  camera: PerspectiveCamera,
): OriginalWorldProjectionResult {
  const containerNormalized = mapOriginalSourceNormalizedToContainer(
    originalSourceNormalized,
    originalIntrinsicSize,
    frame,
  );
  if (!containerNormalized) {
    return {
      ok: false,
      reason: "invalid_input",
      detail: "Original source point cannot map to the container.",
    };
  }
  const ray = intersectOverlayRayWithFloorPlane(containerNormalized, camera, 0);
  if (!ray.ok) {
    return {
      ok: false,
      reason: mapRayFailure(ray.reason),
      detail: ray.reason,
    };
  }
  return {
    ok: true,
    originalSourceNormalized,
    containerNormalized,
    world: {
      x: ray.worldPoint.x,
      y: ray.worldPoint.y,
      z: ray.worldPoint.z,
    },
  };
}

export function projectEmptySourceNormalizedToWorld(
  emptySourceNormalized: SourceNormalizedPoint,
  identities: RoomBoundaryProjectionIdentities,
  frame: ImageFrameSize,
  camera: PerspectiveCamera,
): RoomBoundaryPerPointProjection {
  const projected = projectEmptyFloorPointToWorldXZ({
    emptySourceNormalized,
    emptyIntrinsicSize: identities.emptyIntrinsicSize,
    originalIntrinsicSize: identities.originalIntrinsicSize,
    compatibility: identities.compatibility,
    containerSize: frame,
    calibratedCamera: camera,
  });
  if (!projected.ok) {
    return {
      ok: false,
      emptySourceNormalized,
      reason: mapEmptyProjectionFailure(projected),
      detail: projected.detail,
    };
  }
  return {
    ok: true,
    emptySourceNormalized,
    originalSourceNormalized: projected.originalSourceNormalized,
    containerNormalized: projected.containerNormalized,
    world: {
      x: projected.worldXZ.x,
      y: 0,
      z: projected.worldXZ.z,
    },
  };
}

/**
 * Every vertex is projected and retained in diagnostics. Residual-supported
 * floor-wall callers still require every sample. Residual-underdetermined
 * floor-wall callers may keep the observed endpoint span when an interior
 * sample fails; they must not invent a replacement endpoint.
 */
export function projectEmptyPolylineToWorld(
  polyline: readonly SourceNormalizedPoint[],
  identities: RoomBoundaryProjectionIdentities,
  frame: ImageFrameSize,
  camera: PerspectiveCamera,
): readonly RoomBoundaryPerPointProjection[] {
  return polyline.map((point) =>
    projectEmptySourceNormalizedToWorld(point, identities, frame, camera)
  );
}

export function projectFloorAuthorityPolygonToWorld(
  sourceNormalizedPolygon: readonly SourceNormalizedPoint[],
  originalIntrinsicSize: ImageIntrinsicSize,
  frame: ImageFrameSize,
  camera: PerspectiveCamera,
): readonly OriginalWorldProjectionResult[] {
  return sourceNormalizedPolygon.map((point) =>
    projectOriginalSourceNormalizedToWorld(
      point,
      originalIntrinsicSize,
      frame,
      camera,
    )
  );
}
