/**
 * Shared production AFC runtime restore contract.
 *
 * Both the diagnostic /editor/afc-3d page and the integrated Editor use
 * this interpreter. It does not import the AFC engine, providers, or
 * Lab analysis.
 */

import type { AfcV2ProductionRoomAuthority } from "@/lib/afc-v2-production/production-authority-contract";

export const AFC_PRODUCTION_RUNTIME_PATH = "/api/vibode/afc/runtime";

export type AfcProductionRuntimeLoadState = Readonly<{
  loading: boolean;
  error: string | null;
  authority: AfcV2ProductionRoomAuthority | null;
  originalImageUrl: string | null;
  generationId: string | null;
}>;

export const IDLE_AFC_PRODUCTION_RUNTIME_STATE: AfcProductionRuntimeLoadState = {
  loading: false,
  error: null,
  authority: null,
  originalImageUrl: null,
  generationId: null,
};

export type InterpretedProductionRuntimeResponse =
  | {
      status: "ready";
      authority: AfcV2ProductionRoomAuthority;
      originalImageUrl: string;
      generationId: string | null;
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
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
