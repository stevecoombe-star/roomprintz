import { wrapSceneRotationDeg } from "@/lib/afc-v2-runtime/viewport-interaction";

export const STAGE_ROTATION_SNAP_DEGS = Object.freeze([
  0, 45, 90, 135, 180, -45, -90, -135,
]);

export const STAGE_ROTATION_SNAP_WINDOW_DEG = 3;

export function formatRotationDeg(degrees: number): string {
  const rounded = Math.round(wrapSceneRotationDeg(degrees));
  return `${rounded}°`;
}

export function snapRotationDegIfNear(degrees: number): number {
  const wrapped = wrapSceneRotationDeg(degrees);
  for (const snap of STAGE_ROTATION_SNAP_DEGS) {
    if (Math.abs(wrapped - snap) <= STAGE_ROTATION_SNAP_WINDOW_DEG) {
      return wrapSceneRotationDeg(snap);
    }
    if (Math.abs(Math.abs(wrapped) - 180) <= STAGE_ROTATION_SNAP_WINDOW_DEG && Math.abs(snap) === 180) {
      return 180;
    }
  }
  return wrapped;
}

export function rotationSliderValue(degrees: number): number {
  return wrapSceneRotationDeg(degrees);
}
