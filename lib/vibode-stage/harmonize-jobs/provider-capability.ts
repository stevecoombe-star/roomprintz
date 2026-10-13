/**
 * Nano Banana Pro shapes Harmonize will request.
 *
 * The ratio comes from the shared AFC classifier. The job table and claim
 * lifecycle do not store it. Callers ask this module before enqueueing a
 * composite or accepting provider bytes.
 */

import {
  classifyNanoBananaProAspectRatio,
  type NanoBananaProAspectRatio,
} from "@/lib/afc-image-models";

import { assessHarmonizeNbpFraming } from "@/lib/vibode-stage/harmonize-nbp-proof";

export function harmonizeProviderAcceptsComposite(
  width: number,
  height: number,
): Readonly<{ ok: true; aspectRatio: NanoBananaProAspectRatio }> | Readonly<{ ok: false; code: "unsupported_aspect" | "unsupported_dimensions" }> {
  const classified = classifyNanoBananaProAspectRatio(width, height);
  if (!classified.ok) {
    return {
      ok: false,
      code: classified.reason === "Source image dimensions are not positive integers."
        ? "unsupported_dimensions"
        : "unsupported_aspect",
    };
  }
  return { ok: true, aspectRatio: classified.ratio };
}

export function harmonizeProviderAcceptsOutput(input: Readonly<{
  width: number;
  height: number;
  inputWidth: number;
  inputHeight: number;
}>): boolean {
  return assessHarmonizeNbpFraming(input).accepted;
}
