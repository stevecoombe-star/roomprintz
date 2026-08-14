/**
 * AFC-SR1 Phase 2A deferred camera-apply transaction coherence gate.
 *
 * This validates only identity and already-committed live state. It never
 * derives a camera candidate, evaluates Apply eligibility, or mutates state.
 */
export type AfcLabCameraApplyToken = Readonly<{
  token: number;
  floorAuthorityKey: string;
  basisFingerprint: string;
  decodedWidth: number;
  decodedHeight: number;
  worldWidthM: number;
  worldDepthM: number;
  verticalFovDeg: number;
  frameWidth: number;
  frameHeight: number;
}>;

export type AfcLabCameraApplyLiveState = Readonly<{
  currentToken: number;
  floorAuthorityKey: string;
  basis: Readonly<{
    basisFingerprint: string;
    decodedWidth: number;
    decodedHeight: number;
  }> | null;
  worldWidthM: number;
  worldDepthM: number;
  verticalFovDeg: number;
  frameWidth: number;
  frameHeight: number;
  isCalibratedCameraActive: boolean;
}>;

export type AfcLabCameraApplyValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      reason:
        | "stale_token"
        | "floor_mismatch"
        | "basis_mismatch"
        | "mapping_mismatch"
        | "fov_mismatch"
        | "frame_mismatch"
        | "camera_already_active";
    }>;

export function validatePendingAfcLabCameraApply(
  pending: AfcLabCameraApplyToken,
  current: AfcLabCameraApplyLiveState
): AfcLabCameraApplyValidation {
  if (pending.token !== current.currentToken) return Object.freeze({ valid: false as const, reason: "stale_token" as const });
  if (
    !current.basis ||
    pending.basisFingerprint !== current.basis.basisFingerprint ||
    pending.decodedWidth !== current.basis.decodedWidth ||
    pending.decodedHeight !== current.basis.decodedHeight
  ) {
    return Object.freeze({ valid: false as const, reason: "basis_mismatch" as const });
  }
  if (pending.floorAuthorityKey !== current.floorAuthorityKey) {
    return Object.freeze({ valid: false as const, reason: "floor_mismatch" as const });
  }
  if (pending.worldWidthM !== current.worldWidthM || pending.worldDepthM !== current.worldDepthM) {
    return Object.freeze({ valid: false as const, reason: "mapping_mismatch" as const });
  }
  if (pending.verticalFovDeg !== current.verticalFovDeg) {
    return Object.freeze({ valid: false as const, reason: "fov_mismatch" as const });
  }
  if (pending.frameWidth !== current.frameWidth || pending.frameHeight !== current.frameHeight) {
    return Object.freeze({ valid: false as const, reason: "frame_mismatch" as const });
  }
  if (current.isCalibratedCameraActive) {
    return Object.freeze({ valid: false as const, reason: "camera_already_active" as const });
  }
  return Object.freeze({ valid: true as const });
}
