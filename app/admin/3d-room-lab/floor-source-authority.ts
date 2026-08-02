import {
  FLOOR_SOURCE_COORDINATE_EXTENT,
  canonicalizeSourceUnitBoundaryPoint,
  validateFloorSourcePolygonExtent,
  type FloorSourceExtentRejectReason,
} from "./floor-coordinate-extent";

/**
 * A deliberately narrow structural point type. Runtime Floor authority must
 * not depend on scene persistence types to validate or identify its geometry.
 */
export type FloorPoint = Readonly<{ x: number; y: number }>;

export type FloorSourceAuthorityRejectReason =
  | FloorSourceExtentRejectReason
  | "source_projection_unavailable";

export type FloorSourceAuthorityPlan =
  | Readonly<{
      ok: true;
      sourcePolygon: readonly [FloorPoint, FloorPoint, FloorPoint, FloorPoint];
      containerPolygon: readonly FloorPoint[] | null;
      authorityKey: string;
    }>
  | Readonly<{
      ok: false;
      reason: FloorSourceAuthorityRejectReason;
      rejectedCornerIndex: number | null;
    }>;

const serializeAuthorityNumber = (value: number): string => (Object.is(value, -0) ? "0" : String(value));

function copyPolygon(polygon: readonly FloorPoint[]): readonly FloorPoint[] {
  return polygon.map((point) => ({ x: point.x, y: point.y }));
}

function normalizeAndValidateSourcePolygon(points: readonly FloorPoint[]): FloorSourceAuthorityPlan {
  if (points.length !== 4) {
    return { ok: false, reason: "source_corner_count", rejectedCornerIndex: null };
  }

  const canonicalized = points.map((point) => canonicalizeSourceUnitBoundaryPoint(point));
  const validation = validateFloorSourcePolygonExtent(canonicalized, FLOOR_SOURCE_COORDINATE_EXTENT);
  if (!validation.ok) {
    return {
      ok: false,
      reason: validation.reason,
      rejectedCornerIndex: validation.rejectedCornerIndex,
    };
  }

  const sourcePolygon = validation.points.map((point) => ({ x: point.x, y: point.y })) as [
    FloorPoint,
    FloorPoint,
    FloorPoint,
    FloorPoint,
  ];
  return {
    ok: true,
    sourcePolygon,
    containerPolygon: null,
    authorityKey: buildDurableSourceFloorAuthorityKey(sourcePolygon),
  };
}

function normalizeContainerProjection(
  projected: readonly FloorPoint[] | null | undefined
): readonly FloorPoint[] | null {
  if (!projected || projected.length !== 4) return null;
  if (projected.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  return copyPolygon(projected);
}

/**
 * Builds the durable Floor identity from the exact, semantic-order source
 * coordinates. It intentionally uses neither viewport geometry nor rounded
 * container coordinates.
 */
export function buildDurableSourceFloorAuthorityKey(polygon: readonly FloorPoint[]): string {
  if (polygon.length !== 4) {
    throw new TypeError("A durable Floor authority key requires exactly four source corners.");
  }
  if (polygon.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    throw new TypeError("A durable Floor authority key requires finite source coordinates.");
  }
  return polygon
    .map((point) => `${serializeAuthorityNumber(point.x)},${serializeAuthorityNumber(point.y)}`)
    .join("|");
}

/**
 * Plans source-first authority intake. Unit-boundary machine noise is
 * canonicalized before widened-extent validation; meaningful off-frame values
 * remain exact. Projection may legitimately be unavailable while the image
 * frame is not ready.
 */
export function planSourceNormalizedFloorPolygon(input: {
  points: readonly FloorPoint[];
  projectToContainer?: (sourcePolygon: readonly FloorPoint[]) => readonly FloorPoint[] | null;
}): FloorSourceAuthorityPlan {
  const plan = normalizeAndValidateSourcePolygon(input.points);
  if (!plan.ok) return plan;
  return {
    ...plan,
    containerPolygon: input.projectToContainer
      ? normalizeContainerProjection(input.projectToContainer(plan.sourcePolygon))
      : null,
  };
}

/**
 * Plans a container-first edit without allowing container geometry to become
 * durable authority. A failed source projection fails closed, leaving callers
 * with no new source key or authority claim to commit.
 */
export function planContainerFloorPolygon(input: {
  containerPolygon: readonly FloorPoint[];
  projectToSource: (containerPolygon: readonly FloorPoint[]) => readonly FloorPoint[] | null;
}): FloorSourceAuthorityPlan {
  const projected = input.projectToSource(input.containerPolygon);
  if (!projected) {
    return { ok: false, reason: "source_projection_unavailable", rejectedCornerIndex: null };
  }
  const plan = normalizeAndValidateSourcePolygon(projected);
  if (!plan.ok) return plan;
  return {
    ...plan,
    containerPolygon: normalizeContainerProjection(input.containerPolygon),
  };
}
