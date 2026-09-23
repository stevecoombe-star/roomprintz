import "server-only";

import { createHash } from "node:crypto";

import { CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION } from "../calibration-image-basis";
import {
  RATIO_FOV_DEFAULT_DOMAINS,
  RATIO_FOV_HARNESS_CONTRACT_VERSION,
} from "./ratio-fov-harness";
import {
  validateSharedCandidateComparisonContext,
  type ValidSharedCandidateComparisonContext,
} from "./gemini-floor-proposal-manifest";

export type AfcUi2aSharedContextBuildResult =
  | Readonly<{ ok: true; context: ValidSharedCandidateComparisonContext }>
  | Readonly<{ ok: false }>;

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** Builds the only UI2A package comparison context from verified Original identity. */
export function buildAfcUi2aSharedComparisonContext(input: {
  roomId: string;
  originalSha256: string;
  originalWidth: number;
  originalHeight: number;
}): AfcUi2aSharedContextBuildResult {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(input.roomId) ||
    !sha256(input.originalSha256) ||
    !positiveInteger(input.originalWidth) ||
    !positiveInteger(input.originalHeight)) {
    return Object.freeze({ ok: false as const });
  }
  const validated = validateSharedCandidateComparisonContext({
    ratioFovContractVersion: RATIO_FOV_HARNESS_CONTRACT_VERSION,
    basisId: `${input.roomId}-original-${input.originalSha256.slice(0, 8)}-source-normalized-v1`,
    basisFingerprint: input.originalSha256,
    decoderId: CALIBRATION_IMAGE_BASIS_COORDINATE_SPACE_VERSION.decoderId,
    normalizationPolicyVersion: "source-normalized/v1",
    decodedWidth: input.originalWidth,
    decodedHeight: input.originalHeight,
    frameSize: { width: input.originalWidth, height: input.originalHeight },
    orientationApplied: false,
    basisKind: "original",
    ratioDomain: RATIO_FOV_DEFAULT_DOMAINS.ratio,
    fovDomain: RATIO_FOV_DEFAULT_DOMAINS.fov,
    refinement: RATIO_FOV_DEFAULT_DOMAINS.refinement,
    referenceDepth: 1,
  });
  return validated.ok
    ? Object.freeze({ ok: true as const, context: validated.value })
    : Object.freeze({ ok: false as const });
}

/** Compact canonical context bytes are part of prepared-package identity. */
export function afcUi2aSharedContextBytes(context: ValidSharedCandidateComparisonContext): Buffer {
  return Buffer.from(JSON.stringify(context), "utf8");
}

export function digestAfcUi2aSharedContext(context: ValidSharedCandidateComparisonContext): string {
  return createHash("sha256").update(afcUi2aSharedContextBytes(context)).digest("hex");
}
