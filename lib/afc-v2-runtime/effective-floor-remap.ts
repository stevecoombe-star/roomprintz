/**
 * Image-fixed remap between two calibrated floor cameras.
 *
 * A world point on Y=0 is projected through the automatic camera and
 * intersected again with Y=0 through the manual camera. Wall segments stay
 * segments. Furniture keeps a rigid pose: its floor origin and yaw move with
 * that same map. Metric scale is not applied.
 */

import * as THREE from "three";

import {
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
  buildCalibratedReadOnlyProjectionCamera,
} from "@/app/admin/3d-room-lab/calibrated-camera-readonly-projection";
import { intersectOverlayRayWithFloorPlane } from "@/app/admin/3d-room-lab/calibrated-floor-ray";

import { applyWorldTransformToPoint } from "./collision-footprint";
import type { RuntimeCollisionWall, WorldTransform } from "./types";

const MIN_SEGMENT_M = 1e-4;
const WITNESS_OFFSET_M = 0.05;

export type FloorRemapCamera = Readonly<{
  verticalFovDeg: number;
  pose: Readonly<{
    position: Readonly<{ x: number; y: number; z: number }>;
    lookAt: Readonly<{ x: number; y: number; z: number }>;
    up: Readonly<{ x: number; y: number; z: number }>;
  }>;
  frame: Readonly<{ width: number; height: number }>;
}>;

export function floorRemapCamerasMatch(
  left: FloorRemapCamera,
  right: FloorRemapCamera,
): boolean {
  return left.verticalFovDeg === right.verticalFovDeg &&
    left.frame.width === right.frame.width &&
    left.frame.height === right.frame.height &&
    vec3Match(left.pose.position, right.pose.position) &&
    vec3Match(left.pose.lookAt, right.pose.lookAt) &&
    vec3Match(left.pose.up, right.pose.up);
}

export function remapCanonicalFloorPoint(
  point: Readonly<{ x: number; z: number }>,
  from: FloorRemapCamera,
  to: FloorRemapCamera,
): { x: number; z: number } | null {
  if (floorRemapCamerasMatch(from, to)) {
    return { x: point.x, z: point.z };
  }
  const fromCamera = realize(from);
  const toCamera = realize(to);
  if (!fromCamera || !toCamera) return null;
  const image = projectToContainer(fromCamera, point.x, point.z);
  if (!image) return null;
  const hit = intersectOverlayRayWithFloorPlane(image, toCamera, 0);
  if (!hit.ok) return null;
  if (!Number.isFinite(hit.worldPoint.x) || !Number.isFinite(hit.worldPoint.z)) return null;
  return { x: hit.worldPoint.x, z: hit.worldPoint.z };
}

export function remapCollisionWall(
  wall: RuntimeCollisionWall,
  from: FloorRemapCamera,
  to: FloorRemapCamera,
): RuntimeCollisionWall | null {
  if (floorRemapCamerasMatch(from, to)) return wall;
  const a = remapCanonicalFloorPoint(wall.a, from, to);
  const b = remapCanonicalFloorPoint(wall.b, from, to);
  if (!a || !b) return null;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (!(length >= MIN_SEGMENT_M)) return null;
  const tangentX = dx / length;
  const tangentZ = dz / length;
  const normalX = -tangentZ;
  const normalZ = tangentX;
  const constant = -(normalX * a.x + normalZ * a.z);
  const interior = interiorPoint(wall);
  if (!interior) return null;
  const witness = remapCanonicalFloorPoint(interior, from, to);
  if (!witness) return null;
  const signed = normalX * witness.x + normalZ * witness.z + constant;
  if (!Number.isFinite(signed) || Math.abs(signed) < 1e-8) return null;
  const sideSign = signed > 0 ? 1 : -1;
  return Object.freeze({
    id: wall.id,
    sourceBoundaryId: wall.sourceBoundaryId,
    sourceSeamId: wall.sourceSeamId,
    a: Object.freeze(a),
    b: Object.freeze(b),
    supportPlaneNormal: Object.freeze({ x: normalX, y: 0, z: normalZ }),
    supportPlaneConstant: constant,
    sideSign,
  });
}

export function remapCollisionWalls(
  walls: readonly RuntimeCollisionWall[],
  from: FloorRemapCamera,
  to: FloorRemapCamera,
): readonly RuntimeCollisionWall[] | null {
  const mapped: RuntimeCollisionWall[] = [];
  for (const wall of walls) {
    const next = remapCollisionWall(wall, from, to);
    if (!next) return null;
    mapped.push(next);
  }
  return Object.freeze(mapped);
}

export function remapWorldTransform(
  transform: WorldTransform,
  from: FloorRemapCamera,
  to: FloorRemapCamera,
): WorldTransform | null {
  if (floorRemapCamerasMatch(from, to)) return transform;
  const origin = remapCanonicalFloorPoint(transform.position, from, to);
  if (!origin) return null;
  const aheadWorld = applyWorldTransformToPoint(
    { x: 0, y: 0, z: 1 },
    transform,
  );
  const ahead = remapCanonicalFloorPoint(aheadWorld, from, to);
  if (!ahead) return null;
  const dx = ahead.x - origin.x;
  const dz = ahead.z - origin.z;
  const heading = Math.hypot(dx, dz);
  const rotationY = heading < 1e-6
    ? transform.rotationDeg.y
    : (Math.atan2(dx, dz) * 180) / Math.PI;
  return Object.freeze({
    position: Object.freeze({
      x: origin.x,
      y: transform.position.y,
      z: origin.z,
    }),
    rotationDeg: Object.freeze({
      x: transform.rotationDeg.x,
      y: rotationY,
      z: transform.rotationDeg.z,
    }),
    uniformScale: transform.uniformScale,
  });
}

export function mapSceneObjectsBetweenCameras<T extends Readonly<{ transform: WorldTransform }>>(
  objects: readonly T[],
  from: FloorRemapCamera,
  to: FloorRemapCamera,
): readonly T[] | null {
  if (floorRemapCamerasMatch(from, to)) return objects;
  const mapped: T[] = [];
  for (const object of objects) {
    const transform = remapWorldTransform(object.transform, from, to);
    if (!transform) return null;
    mapped.push({ ...object, transform });
  }
  return Object.freeze(mapped);
}

function interiorPoint(wall: RuntimeCollisionWall): { x: number; z: number } | null {
  const nx = wall.supportPlaneNormal.x * wall.sideSign;
  const nz = wall.supportPlaneNormal.z * wall.sideSign;
  const length = Math.hypot(nx, nz);
  if (!(length > 1e-9)) return null;
  return {
    x: (wall.a.x + wall.b.x) / 2 + (nx / length) * WITNESS_OFFSET_M,
    z: (wall.a.z + wall.b.z) / 2 + (nz / length) * WITNESS_OFFSET_M,
  };
}

function realize(camera: FloorRemapCamera): THREE.PerspectiveCamera | null {
  const built = buildCalibratedReadOnlyProjectionCamera({
    fovDeg: camera.verticalFovDeg,
    pose: camera.pose,
    frameSize: camera.frame,
    near: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_NEAR,
    far: CALIBRATED_READ_ONLY_PROJECTION_RENDERER_FAR,
  });
  return built.ok ? built.camera : null;
}

function projectToContainer(
  camera: THREE.PerspectiveCamera,
  x: number,
  z: number,
): { x: number; y: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  camera.updateMatrixWorld(true);
  const cameraSpace = new THREE.Vector3(x, 0, z).applyMatrix4(camera.matrixWorldInverse);
  if (!(cameraSpace.z < -1e-6)) return null;
  const projected = new THREE.Vector3(x, 0, z).project(camera);
  if (
    !Number.isFinite(projected.x) ||
    !Number.isFinite(projected.y) ||
    !Number.isFinite(projected.z)
  ) {
    return null;
  }
  return {
    x: (projected.x + 1) / 2,
    y: (1 - projected.y) / 2,
  };
}

function vec3Match(
  left: Readonly<{ x: number; y: number; z: number }>,
  right: Readonly<{ x: number; y: number; z: number }>,
): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}
