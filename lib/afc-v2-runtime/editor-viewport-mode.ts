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
