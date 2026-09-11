/**
 * Client contract for per-version 3D scene persistence.
 *
 * Does not import the AFC engine, providers, or Lab analysis.
 */

import type { PersistedSceneIdentity, PersistedVersionScene } from "./persisted-scene";
import type { SerializedRuntimeScene } from "./types";

export const AFC_V2_3D_SCENE_PATH = "/api/vibode/3d-scene";

export type VersionSceneLoadResponse =
  | Readonly<{
      status: "ready";
      scene: PersistedVersionScene;
      currentAfcGenerationId: string;
    }>
  | Readonly<{
      status: "none";
      scene: null;
      currentAfcGenerationId: string;
    }>
  | Readonly<{
      status: "incompatible" | "malformed";
      scene: null;
      reason: string;
      currentAfcGenerationId: string;
      storedAfcGenerationId?: string;
    }>
  | Readonly<{
      status: "error";
      message: string;
    }>;

export type VersionSceneSaveResponse =
  | Readonly<{ status: "saved"; scene: PersistedVersionScene }>
  | Readonly<{ status: "error"; message: string }>;

export function versionSceneUrl(identity: PersistedSceneIdentity): string {
  const params = new URLSearchParams({
    roomId: identity.roomId,
    versionId: identity.versionId,
    afcGenerationId: identity.afcGenerationId,
  });
  return `${AFC_V2_3D_SCENE_PATH}?${params.toString()}`;
}

export function versionScenePutBody(
  identity: PersistedSceneIdentity,
  serialized: SerializedRuntimeScene,
): PersistedVersionScene {
  return {
    roomId: identity.roomId,
    versionId: identity.versionId,
    afcGenerationId: identity.afcGenerationId,
    coordinateSpace: "calibrated-world-xz/v1",
    objects: serialized.objects,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function interpretVersionSceneLoadResponse(input: Readonly<{
  ok: boolean;
  payload: unknown;
}>): VersionSceneLoadResponse {
  const payload = asRecord(input.payload);
  if (!input.ok) {
    return {
      status: "error",
      message: readOptionalString(payload?.error) ?? "Failed to load 3D scene.",
    };
  }
  const status = payload?.status;
  if (status === "ready" && payload?.scene && typeof payload.scene === "object") {
    return {
      status: "ready",
      scene: payload.scene as PersistedVersionScene,
      currentAfcGenerationId: readOptionalString(payload.currentAfcGenerationId) ?? "",
    };
  }
  if (status === "none") {
    return {
      status: "none",
      scene: null,
      currentAfcGenerationId: readOptionalString(payload?.currentAfcGenerationId) ?? "",
    };
  }
  if (status === "incompatible" || status === "malformed") {
    return {
      status,
      scene: null,
      reason: readOptionalString(payload?.reason) ?? "Stored 3D scene cannot be restored.",
      currentAfcGenerationId: readOptionalString(payload?.currentAfcGenerationId) ?? "",
      storedAfcGenerationId: readOptionalString(payload?.storedAfcGenerationId) ?? undefined,
    };
  }
  return {
    status: "error",
    message: readOptionalString(payload?.error) ?? "Failed to load 3D scene.",
  };
}

export function interpretVersionSceneSaveResponse(input: Readonly<{
  ok: boolean;
  payload: unknown;
}>): VersionSceneSaveResponse {
  const payload = asRecord(input.payload);
  if (!input.ok) {
    return {
      status: "error",
      message: readOptionalString(payload?.error) ?? "Couldn't save this 3D scene.",
    };
  }
  if (payload?.status === "saved" && payload.scene && typeof payload.scene === "object") {
    return {
      status: "saved",
      scene: payload.scene as PersistedVersionScene,
    };
  }
  return {
    status: "error",
    message: readOptionalString(payload?.error) ?? "Couldn't save this 3D scene.",
  };
}
