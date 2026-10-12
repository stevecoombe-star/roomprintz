/**
 * Shared production AFC runtime restore contract.
 *
 * Both the diagnostic /editor/afc-3d page and the integrated Editor use
 * this interpreter. It does not import the AFC engine, providers, or
 * Lab analysis.
 */

import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";
import {
  parseTrustedPathBaseline,
  type TrustedPathBaseline,
} from "@/lib/vibode-stage/trusted-path";

export const AFC_PRODUCTION_RUNTIME_PATH = "/api/vibode/afc/runtime";

export type CertifiedFrozenCamera = Readonly<{
  verticalFovDeg: number;
  frame: Readonly<{ width: number; height: number }>;
  pose: Readonly<{
    position: Readonly<{ x: number; y: number; z: number }>;
    lookAt: Readonly<{ x: number; y: number; z: number }>;
    up: Readonly<{ x: number; y: number; z: number }>;
  }>;
}>;

export type AfcProductionRuntimeLoadState = Readonly<{
  loading: boolean;
  error: string | null;
  authority: AfcV2ProductionRoomAuthority | null;
  originalImageUrl: string | null;
  generationId: string | null;
  trustedPath: TrustedPathBaseline | null;
  /** Stored production frozen camera. Independent of a manual perspective override. */
  certifiedFrozenCamera: CertifiedFrozenCamera | null;
}>;

export const IDLE_AFC_PRODUCTION_RUNTIME_STATE: AfcProductionRuntimeLoadState = {
  loading: false,
  error: null,
  authority: null,
  originalImageUrl: null,
  generationId: null,
  trustedPath: null,
  certifiedFrozenCamera: null,
};

export type InterpretedProductionRuntimeResponse =
  | {
      status: "ready";
      authority: AfcV2ProductionRoomAuthority;
      originalImageUrl: string;
      generationId: string | null;
      trustedPath: TrustedPathBaseline | null;
      certifiedFrozenCamera: CertifiedFrozenCamera | null;
    }
  | {
      status: "error";
      message: string;
      generationId: string | null;
    };

export function runtimeRestoreUrl(roomId: string): string {
  return `${AFC_PRODUCTION_RUNTIME_PATH}?roomId=${encodeURIComponent(roomId)}`;
}

export function createIdleAfcProductionRuntimeState(): AfcProductionRuntimeLoadState {
  return IDLE_AFC_PRODUCTION_RUNTIME_STATE;
}

export function interpretProductionRuntimeResponse(input: Readonly<{
  ok: boolean;
  payload: unknown;
}>): InterpretedProductionRuntimeResponse {
  const payload = asRecord(input.payload);
  const generationId = readOptionalString(payload?.generationId) ??
    readOptionalString(payload?.currentGenerationId);

  if (!input.ok) {
    return {
      status: "error",
      message: readOptionalString(payload?.error) ?? "Failed to restore AFC runtime.",
      generationId,
    };
  }

  const authority = payload?.authority;
  if (payload?.status !== "ready" || authority == null || typeof authority !== "object") {
    return {
      status: "error",
      message: readOptionalString(payload?.failureReason) ??
        "This room has no production-ready AFC generation.",
      generationId,
    };
  }

  const originalImageUrl = readOptionalString(payload?.originalImageUrl);
  if (!originalImageUrl) {
    return {
      status: "error",
      message: "ORIGINAL image URL is unavailable.",
      generationId,
    };
  }

  return {
    status: "ready",
    authority: authority as AfcV2ProductionRoomAuthority,
    originalImageUrl,
    generationId,
    trustedPath: parseTrustedPathBaseline(payload?.trustedPath),
    certifiedFrozenCamera: readCertifiedFrozenCamera(payload?.certifiedFrozenCamera),
  };
}

/** Copies a stored frozen camera. A missing pose is unavailable, not inferred. */
export function readCertifiedFrozenCamera(value: unknown): CertifiedFrozenCamera | null {
  const camera = asRecord(value);
  const frame = asRecord(camera?.frame);
  const pose = asRecord(camera?.pose);
  const verticalFovDeg = camera?.verticalFovDeg;
  const width = frame?.width;
  const height = frame?.height;
  if (typeof verticalFovDeg !== "number" || !(verticalFovDeg > 0) || !pose) return null;
  if (
    typeof width !== "number" || typeof height !== "number"
    || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1
  ) {
    return null;
  }
  const position = readVec(pose.position);
  const lookAt = readVec(pose.lookAt);
  const up = readVec(pose.up);
  if (!position || !lookAt || !up) return null;
  return {
    verticalFovDeg,
    frame: { width, height },
    pose: { position, lookAt, up },
  };
}

function readVec(value: unknown): Readonly<{ x: number; y: number; z: number }> | null {
  const point = asRecord(value);
  if (!point) return null;
  const { x, y, z } = point;
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return null;
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
