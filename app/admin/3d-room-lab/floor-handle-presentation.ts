// AFC-CP1A hardening: presentation-only boundary proxy for Floor handles.
//
// Since the Floor projection pair became lossless, a source-normalized Floor
// corner can truthfully project OUTSIDE [0,1] in container space. The polygon
// outline must keep that truthful geometry, but an interactive handle rendered
// at a truthful off-frame coordinate is clipped by the viewport and the SVG,
// leaving the corner invisible and unreachable.
//
// This module resolves where an interactive handle should be DRAWN. It is
// presentation-only:
//
//   - it never touches floorPolygon or sourceNormalizedFloorPolygon;
//   - it never calls a setter or an authority transform;
//   - its output is never written back into Floor state.
//
// The clamped result is a proxy target the operator can actually reach. Moving
// a corner only ever happens through the existing pointer-down handler, which
// is an explicit operator action, not an automatic correction.
//
// Dependency-neutral by design: no React, no DOM, no authority imports, no
// provider/compositor/capture/research imports.

/** A container-normalized point. Structurally compatible with FloorPoint. */
export type FloorHandlePoint = Readonly<{ x: number; y: number }>;

/**
 * Which side of the visible frame the truthful corner lies beyond.
 *
 * The container y axis grows downward, so y < 0 is "above" the frame and
 * y > 1 is "below" it.
 */
export type FloorHandleOffFrameDirection = "left" | "right" | "above" | "below";

export type FloorHandlePresentation = Readonly<{
  /** Where the interactive handle must be drawn. Always inside [0,1]. */
  point: FloorHandlePoint;
  /** True when the truthful corner lies outside the visible frame. */
  offFrame: boolean;
  /** Deterministic order: x-axis direction first, then y-axis direction. */
  directions: readonly FloorHandleOffFrameDirection[];
}>;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Resolves the render/hit target for one Floor handle.
 *
 * An in-frame point is returned unchanged by value. An off-frame point is
 * reported as off-frame and its render target is clamped to the frame
 * boundary, so the handle stays visible and reachable while the polygon
 * outline keeps drawing the truthful coordinate.
 *
 * Coordinates exactly on 0 or 1 are in-frame.
 *
 * Fails closed: a missing point or a non-finite coordinate returns null,
 * because there is no honest boundary target for it.
 */
export function resolveFloorHandlePresentation(
  point: FloorHandlePoint | null | undefined
): FloorHandlePresentation | null {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;

  const directions: FloorHandleOffFrameDirection[] = [];
  if (point.x < 0) directions.push("left");
  else if (point.x > 1) directions.push("right");
  if (point.y < 0) directions.push("above");
  else if (point.y > 1) directions.push("below");

  const offFrame = directions.length > 0;

  return deepFreeze({
    point: offFrame ? { x: clamp01(point.x), y: clamp01(point.y) } : { x: point.x, y: point.y },
    offFrame,
    directions,
  });
}

const DIRECTION_PHRASES: Readonly<Record<FloorHandleOffFrameDirection, string>> = Object.freeze({
  left: "left of",
  right: "right of",
  above: "above",
  below: "below",
});

/**
 * Builds the accessible label for one Floor handle.
 *
 * An in-frame handle keeps its existing label verbatim. An off-frame handle
 * additionally names the semantic corner, states that it is a boundary proxy,
 * and says which way the real corner lies.
 */
export function describeFloorHandleAccessibleLabel(
  handleIndex: number,
  cornerLabel: string,
  presentation: FloorHandlePresentation
): string {
  const base = `Floor polygon handle ${handleIndex + 1}`;
  if (!presentation.offFrame) return base;
  const phrase = presentation.directions.map((d) => DIRECTION_PHRASES[d]).join(" and ");
  return `${base} (${cornerLabel}) — off-frame boundary proxy; actual corner lies ${phrase} the visible frame`;
}
