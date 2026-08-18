import type {
  AfcSr1LiveAuthoritativeGeometry,
} from "./afc-sr1-live-product-contract";

export type AfcSr1LiveAcceptanceState = Readonly<{
  currentAttemptId: string | null;
  labLoadGeneration: number;
  qualifiedBasis: Readonly<{
    basisFingerprint: string;
    decodedWidth: number;
    decodedHeight: number;
    orientation: number;
  }> | null;
}>;

export type AfcSr1LiveAcceptanceResult =
  | Readonly<{ accepted: true }>
  | Readonly<{
      accepted: false;
      reason:
        | "attempt_superseded"
        | "load_generation_mismatch"
        | "source_basis_unavailable"
        | "source_sha_mismatch"
        | "source_dimensions_mismatch"
        | "source_orientation_mismatch";
    }>;

/** Pure pre-Floor gate. The host must call this immediately before realization. */
export function validateAfcSr1LiveResultAcceptance(
  result: AfcSr1LiveAuthoritativeGeometry,
  state: AfcSr1LiveAcceptanceState
): AfcSr1LiveAcceptanceResult {
  if (
    state.currentAttemptId !== result.attemptId
  ) {
    return Object.freeze({ accepted: false, reason: "attempt_superseded" });
  }
  if (state.labLoadGeneration !== result.labLoadGeneration) {
    return Object.freeze({
      accepted: false,
      reason: "load_generation_mismatch",
    });
  }
  if (!state.qualifiedBasis) {
    return Object.freeze({
      accepted: false,
      reason: "source_basis_unavailable",
    });
  }
  const expected = result.originalBasis;
  const current = state.qualifiedBasis;
  if (current.basisFingerprint !== expected.sha256) {
    return Object.freeze({ accepted: false, reason: "source_sha_mismatch" });
  }
  if (
    current.decodedWidth !== expected.decodedWidth ||
    current.decodedHeight !== expected.decodedHeight
  ) {
    return Object.freeze({
      accepted: false,
      reason: "source_dimensions_mismatch",
    });
  }
  if (current.orientation !== expected.orientation) {
    return Object.freeze({
      accepted: false,
      reason: "source_orientation_mismatch",
    });
  }
  return Object.freeze({ accepted: true });
}
