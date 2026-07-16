import type { ImageFrameSize } from "./image-space";
import type { FloorPoint } from "./scene-state";

function roundFloorPoint(point: FloorPoint): FloorPoint {
  return {
    x: Number(point.x.toFixed(3)),
    y: Number(point.y.toFixed(3)),
  };
}

export function buildFloorPolygonAuthorityKey(polygon: FloorPoint[]): string {
  return JSON.stringify(polygon.map((point) => roundFloorPoint(point)));
}

export function shouldDropAuthorityOnFrameChange(
  snapshotFrameSize: ImageFrameSize,
  liveFrameSize: ImageFrameSize
): boolean {
  if (
    !Number.isFinite(snapshotFrameSize.width) ||
    !Number.isFinite(snapshotFrameSize.height) ||
    !Number.isFinite(liveFrameSize.width) ||
    !Number.isFinite(liveFrameSize.height) ||
    snapshotFrameSize.width <= 0 ||
    snapshotFrameSize.height <= 0 ||
    liveFrameSize.width <= 0 ||
    liveFrameSize.height <= 0
  ) {
    return false;
  }
  return (
    snapshotFrameSize.width !== liveFrameSize.width ||
    snapshotFrameSize.height !== liveFrameSize.height
  );
}

export function shouldDropAuthorityOnManualAdjustment(
  previousAuthorityPolygonKey: string,
  nextAuthorityPolygonKey: string
): boolean {
  return previousAuthorityPolygonKey !== nextAuthorityPolygonKey;
}

export function shouldDiscardAttestedResponse(
  currentBasisFingerprint: string | null,
  attestedBasisFingerprint: string | null
): boolean {
  if (!currentBasisFingerprint || !attestedBasisFingerprint) return false;
  return currentBasisFingerprint !== attestedBasisFingerprint;
}
