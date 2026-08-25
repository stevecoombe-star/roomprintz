import type { RepresentationKind } from "./representation-state";

export type AfcShellStatus =
  | "idle"
  | "preparing_original"
  | "original_ready"
  | "generating_empty"
  | "generating_fully_tiled"
  | "reading_floor"
  | "calibrating_camera"
  | "observing_room"
  | "applied"
  | "failed";

export type AfcOrchestrationState = {
  selectedRepresentation: RepresentationKind;
  status: AfcShellStatus;
};

export type AfcOrchestrationEvent =
  | {
      type: "representation_selected";
      representation: RepresentationKind;
    }
  | { type: "original_preparation_started" }
  | { type: "original_ready" }
  | { type: "analysis_stage"; status: Exclude<AfcShellStatus, "idle" | "preparing_original" | "original_ready" | "applied" | "failed"> }
  | { type: "analysis_applied" }
  | { type: "analysis_failed" };

export const INITIAL_AFC_ORCHESTRATION_STATE: AfcOrchestrationState = {
  selectedRepresentation: "ORIGINAL",
  status: "idle",
};

export const AFC_STATUS_LABELS: Record<AfcShellStatus, string> = {
  idle: "Idle",
  preparing_original: "Preparing Original",
  original_ready: "Original ready",
  generating_empty: "Generating EMPTY",
  generating_fully_tiled: "Generating FULLY TILED",
  reading_floor: "Reading Floor from FULLY TILED",
  calibrating_camera: "Calibrating camera",
  observing_room: "Observing visible room envelope",
  applied: "Applied",
  failed: "Failed",
};

export function reduceAfcOrchestrationState(
  state: AfcOrchestrationState,
  event: AfcOrchestrationEvent,
): AfcOrchestrationState {
  switch (event.type) {
    case "representation_selected":
      return {
        ...state,
        selectedRepresentation: event.representation,
      };
    case "original_preparation_started":
      return {
        selectedRepresentation: "ORIGINAL",
        status: "preparing_original",
      };
    case "original_ready":
      return {
        ...state,
        status: "original_ready",
      };
    case "analysis_stage":
      return {
        ...state,
        status: event.status,
      };
    case "analysis_applied":
      return {
        selectedRepresentation: "ORIGINAL",
        status: "applied",
      };
    case "analysis_failed":
      return {
        ...state,
        status: "failed",
      };
  }
}
