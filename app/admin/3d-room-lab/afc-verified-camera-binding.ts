import type { AfcQualifiedLiveImageBasis } from "./afc-verified-floor-apply";
import type { VerifiedAfcFloorCameraBinding } from "./afc-verified-camera-apply";

export type VerifiedAfcFloorApplyOutcome = "applied" | "no_change" | "rejected";

type VerifiedAfcFloorCameraBindingEstablishment = Readonly<{
  binding: VerifiedAfcFloorCameraBinding;
  nextGeneration: number;
}>;

function hasNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function hasPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value);
}

function hasValidLiveBasis(value: AfcQualifiedLiveImageBasis | null): value is AfcQualifiedLiveImageBasis {
  return !!value &&
    hasNonEmptyText(value.basisFingerprint) &&
    hasPositiveSafeInteger(value.decodedWidth) &&
    hasPositiveSafeInteger(value.decodedHeight);
}

/**
 * Builds the host's session-ephemeral AFC Floor camera binding after the
 * canonical Floor Apply outcome is known. Generation allocation deliberately
 * lives here, not in the pure camera qualification seam.
 */
export function establishVerifiedAfcFloorCameraBinding(input: Readonly<{
  outcome: VerifiedAfcFloorApplyOutcome;
  previousGeneration: number;
  floorAuthorityKey: string | null;
  liveBasis: AfcQualifiedLiveImageBasis | null;
}>): VerifiedAfcFloorCameraBindingEstablishment | null {
  if (
    (input.outcome !== "applied" && input.outcome !== "no_change") ||
    (!hasPositiveSafeInteger(input.previousGeneration) && input.previousGeneration !== 0) ||
    !hasNonEmptyText(input.floorAuthorityKey) ||
    !hasValidLiveBasis(input.liveBasis) ||
    input.previousGeneration >= Number.MAX_SAFE_INTEGER
  ) {
    return null;
  }

  const nextGeneration = input.previousGeneration + 1;
  if (!hasPositiveSafeInteger(nextGeneration)) return null;

  return Object.freeze({
    nextGeneration,
    binding: Object.freeze({
      floorAuthorityKey: input.floorAuthorityKey,
      basisFingerprint: input.liveBasis.basisFingerprint,
      decodedWidth: input.liveBasis.decodedWidth,
      decodedHeight: input.liveBasis.decodedHeight,
      bindingGeneration: nextGeneration,
    }),
  });
}

/** A binding survives only an unchanged durable Floor authority key. */
export function shouldClearVerifiedAfcFloorCameraBindingForFloorAuthorityChange(
  previousFloorAuthorityKey: string,
  nextFloorAuthorityKey: string
): boolean {
  return previousFloorAuthorityKey !== nextFloorAuthorityKey;
}
