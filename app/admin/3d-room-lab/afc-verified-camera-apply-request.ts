import {
  qualifyVerifiedAfcCameraApply,
  type VerifiedAfcCameraApplyQualificationInput,
} from "./afc-verified-camera-apply";

/**
 * Intent only: the displayed binding generation is not mutation authority and
 * deliberately carries neither a camera candidate nor any camera, Floor, or
 * image-basis payload.
 */
export type VerifiedAfcCameraApplyRequest = Readonly<{
  bindingGeneration: number;
}>;

export type VerifiedAfcCameraApplyRequestRevalidation =
  | Readonly<{
      ok: true;
      bindingGeneration: number;
    }>
  | Readonly<{
      ok: false;
      reason: "request_invalid" | "binding_superseded" | "invalidated_before_apply";
    }>;

function hasPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0 &&
    Number.isSafeInteger(value);
}

function hasValidRequest(
  value: VerifiedAfcCameraApplyRequest | null
): value is VerifiedAfcCameraApplyRequest {
  return !!value && hasPositiveSafeInteger(value.bindingGeneration);
}

/**
 * Pure host click-time revalidation. Current qualification is always
 * recomputed; the request is only a claim about its displayed binding
 * generation. A future host must separately re-read the latest solver
 * candidate and rerun evaluateCalibratedCameraApply before applying it.
 */
export function revalidateVerifiedAfcCameraApplyRequest(input: Readonly<{
  request: VerifiedAfcCameraApplyRequest | null;
  qualificationInput: VerifiedAfcCameraApplyQualificationInput;
}>): VerifiedAfcCameraApplyRequestRevalidation {
  if (!hasValidRequest(input.request)) {
    return Object.freeze({ ok: false as const, reason: "request_invalid" as const });
  }

  const currentQualification = qualifyVerifiedAfcCameraApply(input.qualificationInput);
  if (!currentQualification.ok) {
    return Object.freeze({ ok: false as const, reason: "invalidated_before_apply" as const });
  }
  if (input.request.bindingGeneration !== currentQualification.bindingGeneration) {
    return Object.freeze({ ok: false as const, reason: "binding_superseded" as const });
  }
  return Object.freeze({
    ok: true as const,
    bindingGeneration: currentQualification.bindingGeneration,
  });
}
