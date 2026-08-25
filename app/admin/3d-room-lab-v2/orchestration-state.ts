import type { RepresentationKind } from "./representation-state";

export type AfcShellStatus =
  | "idle"
  | "original_loaded"
  | "not_implemented";

export type AfcOrchestrationState = {
  selectedRepresentation: RepresentationKind;
  status: AfcShellStatus;
};

export type AfcOrchestrationEvent =
  | {
      type: "representation_selected";
      representation: RepresentationKind;
    }
  | { type: "original_loaded" }
  | { type: "analysis_requested" };

export const INITIAL_AFC_ORCHESTRATION_STATE: AfcOrchestrationState = {
  selectedRepresentation: "ORIGINAL",
  status: "idle",
};

export const AFC_STATUS_LABELS: Record<AfcShellStatus, string> = {
  idle: "Idle",
  original_loaded: "Original loaded",
  not_implemented: "Not implemented in V2-S1",
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
    case "original_loaded":
      return {
        selectedRepresentation: "ORIGINAL",
        status: "original_loaded",
      };
    case "analysis_requested":
      return {
        ...state,
        status: "not_implemented",
      };
  }
}
