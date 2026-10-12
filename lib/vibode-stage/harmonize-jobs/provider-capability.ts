/**
 * Approved Nano Banana Pro shapes.
 *
 * 4:3 is the only ratio with a verified direct generation. The job table and
 * claim lifecycle do not encode that ratio. Callers ask this module before
 * enqueueing a composite or accepting provider bytes.
 */

import { HARMONIZE_ASPECT_RELATIVE_TOLERANCE } from "@/lib/vibode-stage/harmonize-export";
import {
  HARMONIZE_NBP_ASPECT_RATIO,
  assessHarmonizeNbpFraming,
} from "@/lib/vibode-stage/harmonize-nbp-proof";

const APPROVED_ASPECT_RATIOS = [HARMONIZE_NBP_ASPECT_RATIO] as const;

export function harmonizeProviderAcceptsComposite(
  width: number,
  height: number,
): Readonly<{ ok: true; aspectRatio: typeof HARMONIZE_NBP_ASPECT_RATIO }> | Readonly<{ ok: false; code: "unsupported_aspect" | "unsupported_dimensions" }> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return { ok: false, code: "unsupported_dimensions" };
  }
  const approved = APPROVED_ASPECT_RATIOS.find((ratio) => ratio === HARMONIZE_NBP_ASPECT_RATIO);
  if (!approved) return { ok: false, code: "unsupported_aspect" };
  const target = ratioValue(approved);
  const aspectError = Math.abs(width / height - target) / target;
  if (aspectError > HARMONIZE_ASPECT_RELATIVE_TOLERANCE) {
    return { ok: false, code: "unsupported_aspect" };
  }
  return { ok: true, aspectRatio: approved };
}

export function harmonizeProviderAcceptsOutput(input: Readonly<{
  width: number;
  height: number;
  inputWidth: number;
  inputHeight: number;
}>): boolean {
  return assessHarmonizeNbpFraming(input).accepted;
}

function ratioValue(ratio: typeof HARMONIZE_NBP_ASPECT_RATIO): number {
  const [width, height] = ratio.split(":").map(Number);
  return width / height;
}
