// --- Phase 2O-B1: Manual Seam / Support Annotation types --------------------
// Pure type vocabulary for a LAB-ONLY, DIAGNOSTIC-ONLY, NON-PERSISTENT manual
// evidence editor. Nothing in this module (or anything that consumes it in
// Phase 2O-B1) may move/mutate floorPolygon, alter Auto Floor candidate
// geometry, change candidate selection/ranking/defaulting, invoke solver math,
// invoke or change FOV scanning, change Apply / Scan & Apply, or touch
// snapshot/scene-state/JSON persistence.
//
// Governing rule (Phase 2O):
//   Physical visible floor-wall seam first. Detected guide geometry second.
//   Solver result third.
//
// Manual seam evidence is INDEPENDENT image truth captured by the operator. The
// canonical NL/NR/FR/FL labels belong to the current quad/candidate model; any
// relationship between a manual seam and those labels is explicit
// operator-entered metadata and is NEVER inferred from guide geometry.
//
// This module intentionally has NO imports so the pure validation module that
// depends on it stays free of solver/camera/FOV/Apply/candidate dependencies.

// Source-image normalized coordinates ([0,1] over the true intrinsic image,
// NOT the displayed container). All stored seam geometry uses this space so it
// stays aligned across container resize and object-cover cropping.
export type SourceNormPoint = {
  x: number;
  y: number;
};

// Canonical corner labels. This MIRRORS the existing canonical order used by
// AUTO_FLOOR_CORNER_LABELS / CALIBRATION_CORNER_LABELS:
//   NL = near/front, viewer-left
//   NR = near/front, viewer-right
//   FR = far/rear,  viewer-right
//   FL = far/rear,  viewer-left
// The physical rear floor-wall edge corresponds to FL -> FR. Declared locally
// (not imported) only to keep this types module dependency-free; the ordering
// is NOT redefined.
export type FloorCornerLabel = "NL" | "NR" | "FR" | "FL";

export const FLOOR_CORNER_LABELS: readonly FloorCornerLabel[] = [
  "NL",
  "NR",
  "FR",
  "FL",
] as const;

export const MANUAL_FLOOR_SUPPORT_ANNOTATION_SCHEMA =
  "vibode-manual-floor-support-annotation/v0" as const;

// A single physical visible floor-wall seam, recorded by the operator as an
// editable polyline in source-normalized image coordinates.
export type ManualPhysicalSeam = {
  id: string;
  kind: "physical_floor_wall_seam";

  // Ordered polyline vertices; minimum two points.
  points: SourceNormPoint[];

  // The portion of the polyline the operator considers usable evidence. For
  // Phase 2O-B1 this defaults to the full seam (0 .. points.length - 1).
  usableSpan: {
    startVertexIndex: number;
    endVertexIndex: number;
  };

  // Narrow tolerance corridor around the seam, expressed in source pixels.
  corridor: {
    halfWidthSourcePx: number;
  };

  notes?: string;
};

// Operator declaration of visible evidence at a canonical corner. This is NOT a
// claim of crop truth, occlusion continuation, solver correctness, or any
// permission to move the corner.
export type ManualCornerSupportState =
  | "trustworthy"
  | "frame_truncated"
  | "occluded"
  | "uncertain";

export type ManualCornerSupport = {
  state: ManualCornerSupportState;
  note?: string;
  linkedSeamId?: string;
};

// Diagnostic-only search/authority mode. NO mode is permitted to alter
// calibration state, candidate selection, or any geometry search in this phase.
export type ManualSearchMode =
  | "direct"
  | "single_corner_constrained"
  | "coupled_far_edge_constrained"
  | "abstain";

// Explicit authority metadata. Captured and validated only; it is NOT consumed
// for trial generation or any mutation in Phase 2O-B1.
export type ManualAdjustmentAuthority =
  | {
      kind: "none";
    }
  | {
      kind: "single_corner";
      corner: FloorCornerLabel;
      seamId: string;
      allowedSpan: {
        startT: number;
        endT: number;
      };
    }
  | {
      kind: "coupled_far_edge";
      corners: ["FL", "FR"];
      seamId: string;
      flAllowedSpan: {
        startT: number;
        endT: number;
      };
      frAllowedSpan: {
        startT: number;
        endT: number;
      };
      coupling: {
        preserveOrder: true;
        preserveEdgeDirection: true;
        maxRelativeAlongSeamDeltaSourcePx: number;
      };
    };

// Operator-asserted Longest Determining Edge. NEVER auto-selected from measured
// length; measured length may be displayed diagnostically only.
export type ManualDeterminingEdge = {
  seamId: string;

  role: "rear_floor_wall_edge" | "other_visible_floor_boundary";

  intendedCanonicalSupport: FloorCornerLabel[];
};

export type ManualFloorSupportAnnotation = {
  schema: typeof MANUAL_FLOOR_SUPPORT_ANNOTATION_SCHEMA;

  seams: ManualPhysicalSeam[];
  cornerSupport: Partial<Record<FloorCornerLabel, ManualCornerSupport>>;

  mode: ManualSearchMode;
  adjustmentAuthority: ManualAdjustmentAuthority;

  determiningEdge: ManualDeterminingEdge | null;
};

// Default narrow corridor half-width (source pixels) used when adding a seam.
export const DEFAULT_SEAM_CORRIDOR_HALF_WIDTH_SOURCE_PX = 6;

// Default coupling tolerance (source pixels) used when arming coupled far-edge
// authority. Captured/validated only; never consumed for mutation here.
export const DEFAULT_COUPLED_MAX_RELATIVE_DELTA_SOURCE_PX = 12;

export function createEmptyManualFloorSupportAnnotation(): ManualFloorSupportAnnotation {
  return {
    schema: MANUAL_FLOOR_SUPPORT_ANNOTATION_SCHEMA,
    seams: [],
    cornerSupport: {},
    mode: "direct",
    adjustmentAuthority: { kind: "none" },
    determiningEdge: null,
  };
}
