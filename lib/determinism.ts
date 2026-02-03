// lib/determinism.ts
// ==============================
// Determinism helpers
// - Remove micro-drift between generations
// - Keep layout stable across rebuilds
// ==============================

export const DETERMINISM = {
    // Snap inches to quarter-inch increments (great balance of stability + precision)
    IN_SNAP: 0.25,
  
    // Snap rotations to half-degree increments
    ROT_SNAP_DEG: 0.5,
  
    // Snap px values to half-pixel increments to reduce float jitter
    PX_SNAP: 0.5,
  } as const;
  
  export function snapToStep(n: number, step: number): number {
    if (!Number.isFinite(n) || !Number.isFinite(step) || step <= 0) return n;
    return Math.round(n / step) * step;
  }
  
  export function snapRotationDeg(
    deg: number,
    stepDeg: number = DETERMINISM.ROT_SNAP_DEG
  ): number {
    if (!Number.isFinite(deg)) return deg;
  
    // Normalize to [-180, 180)
    let d = ((deg % 360) + 360) % 360;
    if (d >= 180) d -= 360;
  
    return snapToStep(d, stepDeg);
  }
  
  export function snapPx(px: number, stepPx: number = DETERMINISM.PX_SNAP): number {
    return snapToStep(px, stepPx);
  }
  