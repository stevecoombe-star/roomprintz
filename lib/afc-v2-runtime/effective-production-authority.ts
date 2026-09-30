/**
 * Read-time effective production authority.
 *
 * A valid applied manual perspective replaces the source floor quad, the
 * centered world rectangle, the camera, and the collision walls on a copy of
 * the automatic authority. metricScale is copied unchanged. The stored
 * production_authority is not written.
 */

import { buildDurableSourceFloorAuthorityKey } from "@/app/admin/3d-room-lab/floor-source-authority";
import { imagePointsFromQuad } from "@/lib/afc-v2-diagnostics/manual-perspective-geometry";
import {
  parseManualPerspectiveRecord,
  type ManualPerspectiveRecord,
} from "@/lib/afc-v2-diagnostics/manual-perspective";
import {
  isAfcV2ProductionRoomAuthority,
  type AfcV2ProductionRoomAuthority,
} from "@/lib/afc-v2-production/production-authority-contract";

import {
  remapCollisionWalls,
  type FloorRemapCamera,
} from "./effective-floor-remap";

export type EffectiveProductionAuthority = Readonly<{
  kind: "automatic" | "manual";
  authority: AfcV2ProductionRoomAuthority;
}>;

export function resolveEffectiveProductionAuthority(
  automatic: AfcV2ProductionRoomAuthority,
  manualPerspective: unknown,
): EffectiveProductionAuthority {
  const parsed = parseManualPerspectiveRecord(manualPerspective);
  if (!parsed.ok || !parsed.record) {
    return { kind: "automatic", authority: automatic };
  }
  const record = parsed.record;
  if (record.baseGenerationId !== automatic.generationId) {
    return { kind: "automatic", authority: automatic };
  }
  if (!manualQuadMatchesAuthority(record, automatic.floor.sourceNormalizedPolygon)) {
    return { kind: "automatic", authority: automatic };
  }
  if (record.derivedFloor.referenceDepthM !== automatic.floor.referenceDepthM) {
    return { kind: "automatic", authority: automatic };
  }
  const from = floorCamera(automatic);
  const to: FloorRemapCamera = {
    verticalFovDeg: record.resultingCamera.verticalFovDeg,
    pose: record.resultingCamera,
    frame: automatic.frozenCamera.frame,
  };
  const walls = remapCollisionWalls(automatic.collision.walls, from, to);
  if (!walls) return { kind: "automatic", authority: automatic };
  const polygon = record.adjustedSourceQuad.map((point) =>
    Object.freeze({ x: point.x, y: point.y }),
  );
  const authority: AfcV2ProductionRoomAuthority = {
    ...automatic,
    floor: Object.freeze({
      ...automatic.floor,
      authorityKey: buildDurableSourceFloorAuthorityKey(polygon),
      sourceNormalizedPolygon: Object.freeze(polygon),
      worldWidthM: record.derivedFloor.worldWidthM,
      referenceDepthM: record.derivedFloor.referenceDepthM,
      widthDepthRatio: record.derivedFloor.widthDepthRatio,
    }),
    frozenCamera: Object.freeze({
      ...automatic.frozenCamera,
      verticalFovDeg: record.resultingCamera.verticalFovDeg,
      pose: Object.freeze({
        position: Object.freeze({ ...record.resultingCamera.position }),
        lookAt: Object.freeze({ ...record.resultingCamera.lookAt }),
        up: Object.freeze({ ...record.resultingCamera.up }),
      }),
    }),
    collision: Object.freeze({
      ...automatic.collision,
      walls,
    }),
  };
  if (!isAfcV2ProductionRoomAuthority(authority)) {
    return { kind: "automatic", authority: automatic };
  }
  return { kind: "manual", authority };
}

function floorCamera(authority: AfcV2ProductionRoomAuthority): FloorRemapCamera {
  return {
    verticalFovDeg: authority.frozenCamera.verticalFovDeg,
    pose: authority.frozenCamera.pose,
    frame: authority.frozenCamera.frame,
  };
}

function manualQuadMatchesAuthority(
  record: ManualPerspectiveRecord,
  polygon: readonly { x: number; y: number }[],
): boolean {
  if (!record) return false;
  if (record.origin === "manual_quad_bootstrap") {
    return record.originalSourceQuad == null && !usableSourceQuad(polygon);
  }
  return record.originalSourceQuad != null && quadMatches(record.originalSourceQuad, polygon);
}

function usableSourceQuad(polygon: readonly { x: number; y: number }[]): boolean {
  return imagePointsFromQuad(polygon) != null;
}

function quadMatches(
  quad: readonly { x: number; y: number }[],
  polygon: readonly { x: number; y: number }[],
): boolean {
  if (quad.length !== polygon.length) return false;
  return quad.every((point, index) => {
    const stored = polygon[index];
    return stored != null && point.x === stored.x && point.y === stored.y;
  });
}
