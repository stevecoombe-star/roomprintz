/**
 * Editor presentation mode for sibling 2D (Konva) and 3D (AFC) renderers.
 *
 * This is UI state only. It is not AFC generation identity, Camera, Floor,
 * collision, metric scale, or version identity.
 */

import type { Prepare3dRoomPhase } from "./prepare-3d-room-client";

export type EditorViewportMode = "2d" | "3d";

export type EditorRightPanelSurface = "workflow" | "3d";

export type IntegratedAfcRuntimeRestoreInput = Readonly<{
  roomId: string;
  enabled: boolean;
}>;

export function createInitialEditorViewportMode(): EditorViewportMode {
  return "2d";
}

export function editorViewportShowsCanvas(mode: EditorViewportMode): boolean {
  return mode === "2d";
}

export function editorViewportShowsAfcRuntime(mode: EditorViewportMode): boolean {
  return mode === "3d";
}

export function editorRightPanelSurface(
  mode: EditorViewportMode,
): EditorRightPanelSurface {
  return mode === "3d" ? "3d" : "workflow";
}

export function shouldRestoreIntegratedAfcRuntime(input: Readonly<{
  viewportMode: EditorViewportMode;
  preparePhase: Prepare3dRoomPhase;
}>): boolean {
  return input.viewportMode === "3d" && input.preparePhase === "ready";
}

export function shouldAutoPrepareIntegrated3d(input: Readonly<{
  viewportMode: EditorViewportMode;
  preparePhase: Prepare3dRoomPhase;
}>): boolean {
  return input.viewportMode === "3d" && input.preparePhase === "idle";
}

export function integratedAfcRuntimeRestoreInput(input: Readonly<{
  roomId: string;
  viewportMode: EditorViewportMode;
  preparePhase: Prepare3dRoomPhase;
}>): IntegratedAfcRuntimeRestoreInput {
  return {
    roomId: input.roomId,
    enabled: shouldRestoreIntegratedAfcRuntime(input),
  };
}

export function afcRuntimeRestoreIdentity(
  roomId: string,
): Readonly<{ roomId: string }> {
  return { roomId };
}

export const INTEGRATED_3D_LOADING_MESSAGE = "Loading 3D room…";
export const INTEGRATED_3D_PREPARING_MESSAGE = "Preparing 3D room…";
export const INTEGRATED_3D_RESTORE_ERROR_MESSAGE =
  "We couldn't load this 3D room.";

const INTEGRATED_3D_DEVELOPER_COPY =
  /AFC|generationId|ORIGINAL|authority|runtime restore|collision|metricScale|provider|failureReason|restore contract/i;

export type Integrated3dViewportSurface =
  | "status"
  | "prepare-error"
  | "restore-error"
  | "viewer";

export type Integrated3dViewportPresentation = Readonly<{
  surface: Integrated3dViewportSurface;
  phase:
    | "checking"
    | "preparing"
    | "running"
    | "restoring"
    | "error"
    | "ready";
  message: string | null;
}>;

export function sanitizeIntegrated3dRuntimeError(
  error: string | null | undefined,
): string {
  if (typeof error !== "string") return INTEGRATED_3D_RESTORE_ERROR_MESSAGE;
  const trimmed = error.trim();
  if (!trimmed || INTEGRATED_3D_DEVELOPER_COPY.test(trimmed)) {
    return INTEGRATED_3D_RESTORE_ERROR_MESSAGE;
  }
  return trimmed;
}

export function integrated3dViewportPresentation(input: Readonly<{
  preparePhase: Prepare3dRoomPhase;
  runtimeLoading: boolean;
  runtimeError: string | null;
  hasAuthority: boolean;
  hasOriginalImage: boolean;
}>): Integrated3dViewportPresentation {
  if (input.preparePhase === "checking") {
    return {
      surface: "status",
      phase: "checking",
      message: INTEGRATED_3D_LOADING_MESSAGE,
    };
  }
  if (input.preparePhase === "idle") {
    return {
      surface: "status",
      phase: "preparing",
      message: INTEGRATED_3D_PREPARING_MESSAGE,
    };
  }
  if (input.preparePhase === "running") {
    return {
      surface: "status",
      phase: "running",
      message: INTEGRATED_3D_PREPARING_MESSAGE,
    };
  }
  if (input.preparePhase !== "ready") {
    return {
      surface: "prepare-error",
      phase: "error",
      message: null,
    };
  }
  if (input.runtimeLoading) {
    return {
      surface: "status",
      phase: "restoring",
      message: INTEGRATED_3D_LOADING_MESSAGE,
    };
  }
  if (input.runtimeError || !input.hasAuthority || !input.hasOriginalImage) {
    return {
      surface: "restore-error",
      phase: "error",
      message: sanitizeIntegrated3dRuntimeError(input.runtimeError),
    };
  }
  return {
    surface: "viewer",
    phase: "ready",
    message: null,
  };
}

export function isIntegrated3dModeBusy(input: Readonly<{
  viewportMode: EditorViewportMode;
  preparePhase: Prepare3dRoomPhase;
  runtimeLoading: boolean;
}>): boolean {
  if (input.viewportMode !== "3d") return false;
  if (
    input.preparePhase === "checking" ||
    input.preparePhase === "idle" ||
    input.preparePhase === "running"
  ) {
    return true;
  }
  return input.preparePhase === "ready" && input.runtimeLoading;
}

export function isEditor3dModeButtonDisabled(input: Readonly<{
  hasRoom: boolean;
  busy: boolean;
}>): boolean {
  return !input.hasRoom || input.busy;
}

export function canEscapeIntegrated3dTo2d(): boolean {
  return true;
}
