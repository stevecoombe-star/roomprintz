import {
  floorVec3ToPlane2D,
  getFloorRectCorners,
  projectFloorPointThroughPose,
  type Vec2,
} from "@/app/admin/3d-room-lab/perspective-solve";

export const P_STALE_PRECONDITION_V2_ASSET_ID = "P-stale-precondition-v2";
export const P_STALE_PRECONDITION_V2_FILE_NAME = "P-stale-precondition-v2.jpg";
export const P_STALE_PRECONDITION_V2_PUBLIC_URL_PATH = "/3d-lab/room-images/P-stale-precondition-v2.jpg";

export const P_STALE_PRECONDITION_V2_CANONICAL_RELATIVE_PATH =
  "app/admin/3d-room-lab/g0-containment/synthetic-assets/P-stale-precondition-v2.jpg";
export const P_STALE_PRECONDITION_V2_PUBLIC_MIRROR_RELATIVE_PATH =
  "public/3d-lab/room-images/P-stale-precondition-v2.jpg";

export const P_STALE_PRECONDITION_V2_SOURCE_SIZE = {
  width: 1280,
  height: 720,
} as const;

export const P_STALE_PRECONDITION_V2_FLOOR_RECT_METERS = {
  widthMeters: 4,
  depthMeters: 4,
} as const;

export const P_STALE_PRECONDITION_V2_INTRINSICS = {
  verticalFovDeg: 60,
} as const;

export const P_STALE_PRECONDITION_V2_CAMERA_POSE = {
  position: { x: 0, y: 3, z: 3 },
  lookAt: { x: 0, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
} as const;

export type PStalePreconditionV2CornerKey = "NL" | "NR" | "FR" | "FL";

export type PStalePreconditionV2Corner = {
  px: Vec2;
  sourceNorm: Vec2;
};

export const P_STALE_PRECONDITION_V2_MARKER_SIZE_SOURCE_PX = 28;
export const P_STALE_PRECONDITION_V2_CORNER_ASSERT_TOLERANCE_PX = 0.02;
export const P_STALE_PRECONDITION_V2_TEXT =
  "SYNTHETIC TEST PATTERN - NON-BENCHMARK - P-stale precondition v2";

export const P_STALE_PRECONDITION_V2_DECLARED_CORNERS: Record<PStalePreconditionV2CornerKey, PStalePreconditionV2Corner> = {
  NL: {
    px: { x: 199.09, y: 671.77 },
    sourceNorm: { x: 0.1555, y: 0.933 },
  },
  NR: {
    px: { x: 1080.91, y: 671.77 },
    sourceNorm: { x: 0.8445, y: 0.933 },
  },
  FR: {
    px: { x: 860.45, y: 204.12 },
    sourceNorm: { x: 0.6722, y: 0.2835 },
  },
  FL: {
    px: { x: 419.55, y: 204.12 },
    sourceNorm: { x: 0.3278, y: 0.2835 },
  },
};

export function sourcePxToNorm(point: Vec2): Vec2 {
  return {
    x: point.x / P_STALE_PRECONDITION_V2_SOURCE_SIZE.width,
    y: point.y / P_STALE_PRECONDITION_V2_SOURCE_SIZE.height,
  };
}

export function derivePStalePreconditionV2SourceCorners(): Record<PStalePreconditionV2CornerKey, Vec2> {
  const floorRect = getFloorRectCorners(P_STALE_PRECONDITION_V2_FLOOR_RECT_METERS);
  if (!floorRect.ok) {
    throw new Error(`Failed to derive floor rectangle for ${P_STALE_PRECONDITION_V2_ASSET_ID}: ${floorRect.reason}`);
  }

  const orderedFloorPlanePoints = floorRect.value.asArray.map((point) => floorVec3ToPlane2D(point));
  const projectedCorners = orderedFloorPlanePoints.map((point) => {
    const projection = projectFloorPointThroughPose(
      P_STALE_PRECONDITION_V2_CAMERA_POSE,
      P_STALE_PRECONDITION_V2_SOURCE_SIZE,
      P_STALE_PRECONDITION_V2_INTRINSICS,
      point
    );
    if (!projection.ok) {
      throw new Error(
        `Failed to project floor corner for ${P_STALE_PRECONDITION_V2_ASSET_ID}: ${projection.reason}`
      );
    }
    return projection.value;
  });

  return {
    NL: projectedCorners[0],
    NR: projectedCorners[1],
    FR: projectedCorners[2],
    FL: projectedCorners[3],
  };
}

export function assertDerivedPStalePreconditionV2CornersMatchSpec(
  derivedCorners: Record<PStalePreconditionV2CornerKey, Vec2>,
  tolerancePx = P_STALE_PRECONDITION_V2_CORNER_ASSERT_TOLERANCE_PX
): void {
  for (const key of ["NL", "NR", "FR", "FL"] as const) {
    const expected = P_STALE_PRECONDITION_V2_DECLARED_CORNERS[key].px;
    const actual = derivedCorners[key];
    const dx = Math.abs(actual.x - expected.x);
    const dy = Math.abs(actual.y - expected.y);
    if (dx > tolerancePx || dy > tolerancePx) {
      throw new Error(
        `Derived ${key} corner is outside tolerance: dx=${dx.toFixed(4)} dy=${dy.toFixed(4)} tolerance=${tolerancePx}`
      );
    }
  }
}

