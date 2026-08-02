export type FloorDragPoint = Readonly<{ x: number; y: number }>;

export type FloorDragOverlayRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type FloorHandleDragStart = Readonly<{
  cornerIndex: number;
  startPolygon: readonly [FloorDragPoint, FloorDragPoint, FloorDragPoint, FloorDragPoint];
  startCorner: FloorDragPoint;
  startPointer: FloorDragPoint;
  overlayRect: FloorDragOverlayRect;
}>;

function isFinitePoint(point: FloorDragPoint | null | undefined): point is FloorDragPoint {
  return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isValidOverlayRect(rect: FloorDragOverlayRect | null | undefined): rect is FloorDragOverlayRect {
  return (
    !!rect &&
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * Converts a pointer into the Floor drag's container-normalized coordinate
 * space. Unlike ordinary overlay input this deliberately preserves off-frame
 * magnitude for delta transfer; it does not grant pointer coordinates authority.
 */
export function floorDragPointerFromClient(
  clientX: number,
  clientY: number,
  rect: FloorDragOverlayRect | null | undefined
): FloorDragPoint | null {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || !isValidOverlayRect(rect)) return null;
  const point = {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
  };
  return isFinitePoint(point) ? point : null;
}

/**
 * Captures a frozen truthful Floor basis at pointer-down. The caller owns
 * pointer capture and authority planning; this helper owns neither.
 */
export function createFloorHandleDragStart(input: {
  cornerIndex: number;
  floorPolygon: readonly FloorDragPoint[];
  startPointer: FloorDragPoint;
  overlayRect: FloorDragOverlayRect;
}): FloorHandleDragStart | null {
  if (
    !Number.isInteger(input.cornerIndex) ||
    input.cornerIndex < 0 ||
    input.cornerIndex >= 4 ||
    input.floorPolygon.length !== 4 ||
    !input.floorPolygon.every(isFinitePoint) ||
    !isFinitePoint(input.startPointer) ||
    !isValidOverlayRect(input.overlayRect)
  ) {
    return null;
  }
  const startPolygon = input.floorPolygon.map((point) => ({ x: point.x, y: point.y })) as [
    FloorDragPoint,
    FloorDragPoint,
    FloorDragPoint,
    FloorDragPoint,
  ];
  return {
    cornerIndex: input.cornerIndex,
    startPolygon,
    startCorner: startPolygon[input.cornerIndex],
    startPointer: { x: input.startPointer.x, y: input.startPointer.y },
    overlayRect: { ...input.overlayRect },
  };
}

/**
 * Applies the current pointer delta to the truthful start corner. The proxy
 * draw/hit target never participates in this calculation.
 */
export function deriveFloorHandleDragCandidate(
  start: FloorHandleDragStart,
  currentPointer: FloorDragPoint
): readonly [FloorDragPoint, FloorDragPoint, FloorDragPoint, FloorDragPoint] | null {
  if (!isFinitePoint(currentPointer)) return null;
  const deltaX = currentPointer.x - start.startPointer.x;
  const deltaY = currentPointer.y - start.startPointer.y;
  const nextCorner = {
    x: start.startCorner.x + deltaX,
    y: start.startCorner.y + deltaY,
  };
  if (!isFinitePoint(nextCorner)) return null;
  return start.startPolygon.map((point, index) =>
    index === start.cornerIndex ? nextCorner : { x: point.x, y: point.y }
  ) as [FloorDragPoint, FloorDragPoint, FloorDragPoint, FloorDragPoint];
}

/** True only when a candidate differs from the currently applied Floor geometry. */
export function floorDragCandidateDiffersFromCurrent(
  candidate: readonly FloorDragPoint[],
  currentPolygon: readonly FloorDragPoint[]
): boolean {
  if (
    candidate.length !== 4 ||
    currentPolygon.length !== 4 ||
    !candidate.every(isFinitePoint) ||
    !currentPolygon.every(isFinitePoint)
  ) {
    return false;
  }
  return candidate.some(
    (point, index) =>
      point.x !== currentPolygon[index].x || point.y !== currentPolygon[index].y
  );
}

/** A basis change cancels the active drag instead of reinterpreting its delta. */
export function floorDragOverlayRectEquals(
  left: FloorDragOverlayRect,
  right: FloorDragOverlayRect
): boolean {
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  );
}
