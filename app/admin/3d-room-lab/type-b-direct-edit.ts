// --- Phase B2A: Type B direct-overlay edit helpers (pure) -------------------
// LAB-ONLY, DIAGNOSTIC-FIRST support for placing and dragging DECLARED Type B
// seam endpoints directly on the room-image overlay. This module owns the SMALL
// pure logic that backs that interaction so it can be unit-tested without a DOM:
//   - the transient placement-target vocabulary;
//   - mapping a placement/drag target to a specific declared seam + endpoint;
//   - safe normalized-point sanitization ([0,1] clamp, non-finite reject);
//   - a single-endpoint patch on the ephemeral review state that PRESERVES all
//     other declared metadata (status / frame-contact / occlusion / role /
//     notes) and never touches the other seam or any non-review field.
//
// ABSOLUTE SCOPE (unchanged from B1/B2): nothing here runs a Type B (or Type A)
// solver / FOV / search / preview / load / Apply, mutates a candidate / floor
// polygon / dimensions / FOV / calibration / readiness / Type A state, performs
// routing / mode switching, persists, infers an off-frame corner, extends a
// line, or creates any virtual / inferred endpoint. It only edits exactly ONE
// operator-declared endpoint coordinate and defers ALL qualification to the
// committed pure B1 modules.
//
// It imports ONLY pure helpers/types (the B2 review helper + B1 type aliases).

import {
  applyDeclaredLinePatch,
  sanitizeNormComponent,
  type TypeBEvidenceReviewState,
} from "./type-b-evidence-review";
import type { TypeBVec2 } from "./type-b-evidence-types";

// One of the four operator-declared endpoints that may be placed or dragged.
export type TypeBEndpointTarget =
  | "rear_start"
  | "rear_end"
  | "side_start"
  | "side_end";

// Transient UI placement-arming state. `null` means nothing is armed. This is
// ephemeral UI state only; it is never persisted and never becomes evidence.
export type TypeBPlacementTarget = TypeBEndpointTarget | null;

// The rear seam role is pinned; the side seam role stays operator-declared and
// is NEVER inferred from a placed/dragged coordinate.
const REAR_ROLE = "rear_floor_wall_seam" as const;

// Which declared seam an endpoint target belongs to.
export function typeBEndpointTargetSeam(
  target: TypeBEndpointTarget
): "rear" | "side" {
  return target === "rear_start" || target === "rear_end" ? "rear" : "side";
}

// Whether an endpoint target addresses the seam's start (vs end) endpoint.
export function typeBEndpointTargetIsStart(
  target: TypeBEndpointTarget
): boolean {
  return target === "rear_start" || target === "side_start";
}

// Clamp a raw point to a safe normalized [0,1] point. Returns null when EITHER
// component is non-finite, so an invalid pointer conversion is never silently
// converted into declared evidence. Reuses the committed component sanitizer so
// clamping is identical to the numeric-input path.
export function sanitizeTypeBNormPoint(
  raw: { x: number; y: number } | null | undefined
): TypeBVec2 | null {
  if (!raw) return null;
  const x = sanitizeNormComponent(raw.x);
  const y = sanitizeNormComponent(raw.y);
  if (x === null || y === null) return null;
  return { x, y };
}

export type TypeBEndpointPatchResult = {
  // Next review state. Same reference as `state` when nothing changed.
  next: TypeBEvidenceReviewState;
  // True only when exactly the targeted endpoint coordinate was written.
  changed: boolean;
};

// Apply a placement/drag to exactly ONE declared endpoint of the review state.
//
// It sanitizes the incoming point first; a non-finite conversion is a NO-OP
// (returns the same state reference, changed:false) so invalid pointer input
// never mutates evidence. On a valid point it patches ONLY the targeted seam's
// targeted endpoint coordinate via the committed applyDeclaredLinePatch helper,
// which preserves every other field (endpoint status, frame-contact, occlusion,
// role, notes) and leaves the OTHER seam untouched (same reference). It never
// creates the other seam, never infers a role, never extends or intersects a
// line, and never touches any non-seam review field.
export function patchTypeBReviewEndpoint(
  state: TypeBEvidenceReviewState,
  target: TypeBEndpointTarget,
  rawPoint: { x: number; y: number } | null | undefined
): TypeBEndpointPatchResult {
  const point = sanitizeTypeBNormPoint(rawPoint);
  if (!point) {
    return { next: state, changed: false };
  }
  const isStart = typeBEndpointTargetIsStart(target);
  const seam = typeBEndpointTargetSeam(target);
  const coordPatch = isStart
    ? { startNorm: { x: point.x, y: point.y } }
    : { endNorm: { x: point.x, y: point.y } };

  if (seam === "rear") {
    return {
      next: {
        ...state,
        rearSeam: applyDeclaredLinePatch(state.rearSeam, REAR_ROLE, coordPatch),
      },
      changed: true,
    };
  }
  return {
    next: {
      ...state,
      strongSideSeam: applyDeclaredLinePatch(state.strongSideSeam, null, coordPatch),
    },
    changed: true,
  };
}

// Resolve the next placement-target given whether the active review was just
// cleared/invalidated. A cleared/invalidated review always cancels arming; this
// is a tiny pure helper so the cancellation rule is unit-testable.
export function resolveTypeBPlacementTargetAfterReconcile(
  current: TypeBPlacementTarget,
  reviewCleared: boolean
): TypeBPlacementTarget {
  return reviewCleared ? null : current;
}
