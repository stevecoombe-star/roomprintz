import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalizeSourceUnitBoundaryCoordinate,
  canonicalizeSourceUnitBoundaryPoint,
  SOURCE_UNIT_BOUNDARY_EPSILON,
} from "./floor-coordinate-extent";
import { resolveFloorHandlePresentation } from "./floor-handle-presentation";
import {
  containerNormToSourceNorm,
  containerNormToSourceNormUnclamped,
  sourceNormToContainerNorm,
  sourceNormToContainerNormUnclamped,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./image-space";
import {
  buildSceneStatePayload,
  SCENE_STATE_SCHEMA_VERSION,
  SCENE_STATE_SCHEMA_VERSION_V2,
  validateImportedSceneJson,
  type FloorPoint,
  type SceneStatePayloadInput,
  type SceneStateValidationConfig,
} from "./scene-state";

// AFC-CP1A final corrections.
//
// H1: the unclamped projection pair must be reachable from FLOOR authority
//     paths only. Wall and Ceiling keep the pre-CP1A clamped behaviour so
//     their handles stay reachable without a boundary proxy.
//
// H2: a lossless boundary round trip can land one ULP outside the unit range
//     (1 -> 1.0000000000000002). Scene-v1 rejects anything above 1, so the
//     Floor container->source authority path canonicalizes that noise away.

const FRAME_16_10: ImageFrameSize = { width: 1600, height: 1000 };
const INTRINSIC_1264_848: ImageIntrinsicSize = { width: 1264, height: 848 };

// ---------------------------------------------------------------------------
// Production-equivalent projection models.
//
// These mirror the ThreeRoomLab callbacks exactly. The structural tests at the
// bottom of this file prove the production callbacks have these same bodies.
// ---------------------------------------------------------------------------

function projectFloorSourcePolygonToContainer(
  polygon: readonly FloorPoint[],
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint[] | null {
  const projected = polygon
    .map((point) => sourceNormToContainerNormUnclamped(point, intrinsic, frame))
    .filter((point): point is FloorPoint => point !== null);
  return projected.length === polygon.length ? projected : null;
}

function projectFloorContainerPolygonToSource(
  polygon: readonly FloorPoint[],
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint[] | null {
  const projected = polygon
    .map((point) => {
      const source = containerNormToSourceNormUnclamped(point, intrinsic, frame);
      return source ? canonicalizeSourceUnitBoundaryPoint(source) : null;
    })
    .filter((point): point is FloorPoint => point !== null);
  return projected.length === polygon.length ? projected : null;
}

/** Generic clamped projection used by Wall and Ceiling, unchanged since dfb5dea. */
function projectSourcePolygonToContainer(
  polygon: readonly FloorPoint[],
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint[] | null {
  const projected = polygon
    .map((point) => sourceNormToContainerNorm(point, intrinsic, frame))
    .filter((point): point is FloorPoint => point !== null);
  return projected.length === polygon.length ? projected : null;
}

function projectContainerPolygonToSource(
  polygon: readonly FloorPoint[],
  intrinsic: ImageIntrinsicSize,
  frame: ImageFrameSize
): FloorPoint[] | null {
  const projected = polygon
    .map((point) => containerNormToSourceNorm(point, intrinsic, frame))
    .filter((point): point is FloorPoint => point !== null);
  return projected.length === polygon.length ? projected : null;
}

function boundaryQuad(): FloorPoint[] {
  return [
    { x: 0.2, y: 1 },
    { x: 0.8, y: 1 },
    { x: 0.7, y: 0.55 },
    { x: 0.3, y: 0.55 },
  ];
}

// ===========================================================================
// H1 — Floor-only lossless projection
// ===========================================================================

test("H1: Floor source y=1 on 1264x848 in a 16:10 frame derives container y > 1", () => {
  const container = projectFloorSourcePolygonToContainer(
    boundaryQuad(),
    INTRINSIC_1264_848,
    FRAME_16_10
  );
  assert.ok(container);
  assert.ok(container[0].y > 1, `expected container y > 1, got ${container[0].y}`);
  assert.ok(Math.abs(container[0].y - 1.036709) < 1e-6);
});

test("H1: Floor gets a boundary proxy while the raw polygon geometry stays truthful", () => {
  const source = boundaryQuad();
  const container = projectFloorSourcePolygonToContainer(source, INTRINSIC_1264_848, FRAME_16_10);
  assert.ok(container);

  const presentation = resolveFloorHandlePresentation(container[0]);
  assert.ok(presentation);
  assert.equal(presentation.offFrame, true);
  assert.equal(presentation.point.y, 1);
  assert.ok(presentation.directions.includes("below"));

  // The polygon outline still consumes the truthful, unclamped coordinate.
  assert.ok(container[0].y > 1, "the raw polygon coordinate must remain off-frame");
  assert.notEqual(presentation.point.y, container[0].y);
});

test("H1: Wall source y=1 under the same dimensions derives container y = 1", () => {
  const container = projectSourcePolygonToContainer(boundaryQuad(), INTRINSIC_1264_848, FRAME_16_10);
  assert.ok(container);
  assert.equal(container[0].y, 1, "the clamped Wall path must stay inside the frame");
  assert.equal(container[1].y, 1);
  for (const point of container) {
    assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  }
});

test("H1: Ceiling source y=1 under the same dimensions derives container y = 1", () => {
  // Ceiling uses the identical generic clamped callback as Wall.
  const ceilingSource: FloorPoint[] = [
    { x: 0.2, y: 1 },
    { x: 0.8, y: 1 },
    { x: 0.8, y: 0 },
    { x: 0.2, y: 0 },
  ];
  const container = projectSourcePolygonToContainer(ceilingSource, INTRINSIC_1264_848, FRAME_16_10);
  assert.ok(container);
  assert.equal(container[0].y, 1);
  assert.equal(container[2].y, 0);
  for (const point of container) {
    assert.ok(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1);
  }
});

test("H1: Wall and Ceiling handles stay reachable without any proxy logic", () => {
  const container = projectSourcePolygonToContainer(boundaryQuad(), INTRINSIC_1264_848, FRAME_16_10);
  assert.ok(container);
  for (const point of container) {
    // Feeding a Wall/Ceiling handle through the Floor proxy resolver would be a
    // no-op, which is exactly why no Wall/Ceiling proxy is needed.
    const presentation = resolveFloorHandlePresentation(point);
    assert.ok(presentation);
    assert.equal(presentation.offFrame, false);
    assert.equal(presentation.point.x * 100 >= 0 && presentation.point.x * 100 <= 100, true);
    assert.equal(presentation.point.y * 100 >= 0 && presentation.point.y * 100 <= 100, true);
  }
});

test("H1: switching images never strands a Wall or Ceiling handle outside the frame", () => {
  const frames: ImageFrameSize[] = [
    { width: 1600, height: 1000 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
    { width: 900, height: 900 },
  ];
  const intrinsics: ImageIntrinsicSize[] = [
    { width: 1264, height: 848 },
    { width: 7360, height: 4912 },
    { width: 1600, height: 1200 },
    { width: 2000, height: 1000 },
    { width: 1263, height: 847 },
    { width: 3007, height: 1993 },
  ];
  const sources: FloorPoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 0.5, y: 0.5 },
  ];
  for (const frame of frames) {
    for (const intrinsic of intrinsics) {
      const container = projectSourcePolygonToContainer(sources, intrinsic, frame);
      assert.ok(container, `projection must succeed for ${intrinsic.width}x${intrinsic.height}`);
      for (const point of container) {
        assert.ok(
          point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1,
          `Wall/Ceiling handle stranded at ${JSON.stringify(point)} for frame ${frame.width}x${frame.height} image ${intrinsic.width}x${intrinsic.height}`
        );
        assert.equal(resolveFloorHandlePresentation(point)?.offFrame, false);
      }
    }
  }
});

test("H1: Wall and Ceiling round-trip behaviour matches the dfb5dea clamped baseline", () => {
  // The dfb5dea baseline algorithm, written out independently of image-space.
  const baselineClamp = (v: number) => Math.max(0, Math.min(1, v));
  const baselineSourceToContainer = (
    point: FloorPoint,
    intrinsic: ImageIntrinsicSize,
    frame: ImageFrameSize
  ): FloorPoint => {
    const scale = Math.max(frame.width / intrinsic.width, frame.height / intrinsic.height);
    const offsetX = (frame.width - intrinsic.width * scale) / 2;
    const offsetY = (frame.height - intrinsic.height * scale) / 2;
    const frameX = baselineClamp(point.x) * intrinsic.width * scale + offsetX;
    const frameY = baselineClamp(point.y) * intrinsic.height * scale + offsetY;
    return { x: baselineClamp(frameX / frame.width), y: baselineClamp(frameY / frame.height) };
  };
  const baselineContainerToSource = (
    point: FloorPoint,
    intrinsic: ImageIntrinsicSize,
    frame: ImageFrameSize
  ): FloorPoint => {
    const scale = Math.max(frame.width / intrinsic.width, frame.height / intrinsic.height);
    const offsetX = (frame.width - intrinsic.width * scale) / 2;
    const offsetY = (frame.height - intrinsic.height * scale) / 2;
    const sourceX = (baselineClamp(point.x) * frame.width - offsetX) / scale;
    const sourceY = (baselineClamp(point.y) * frame.height - offsetY) / scale;
    return {
      x: baselineClamp(sourceX / intrinsic.width),
      y: baselineClamp(sourceY / intrinsic.height),
    };
  };

  const intrinsics: ImageIntrinsicSize[] = [
    INTRINSIC_1264_848,
    { width: 7360, height: 4912 },
    { width: 1600, height: 1200 },
    { width: 2000, height: 1000 },
  ];
  const points: FloorPoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0.25, y: 0.9 },
    { x: 0.5, y: 1 },
  ];
  for (const intrinsic of intrinsics) {
    const forward = projectSourcePolygonToContainer(points, intrinsic, FRAME_16_10);
    const backward = projectContainerPolygonToSource(points, intrinsic, FRAME_16_10);
    assert.ok(forward && backward);
    for (let i = 0; i < points.length; i += 1) {
      assert.deepEqual(forward[i], baselineSourceToContainer(points[i], intrinsic, FRAME_16_10));
      assert.deepEqual(backward[i], baselineContainerToSource(points[i], intrinsic, FRAME_16_10));
    }
  }
});

// ===========================================================================
// H2 — machine-precision unit-boundary canonicalization
// ===========================================================================

test("H2: the tolerance is the documented 8 * Number.EPSILON", () => {
  assert.equal(SOURCE_UNIT_BOUNDARY_EPSILON, 8 * Number.EPSILON);
});

test("H2: values within tolerance of 0 or 1 canonicalize exactly", () => {
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(-7.1e-17), 0);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(Number.EPSILON), 0);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(-Number.EPSILON), 0);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(4.137151837046574e-18), 0);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(1 - Number.EPSILON), 1);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(1 + Number.EPSILON), 1);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(1.0000000000000002), 1);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(0.9999999999999997), 1);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(0), 0);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(1), 1);
});

test("H2: meaningful values are returned untouched, with no rounding grid or clamp", () => {
  for (const value of [-0.05, -0.000001, 1.000001, 1.25, -0.25, 0.5, 0.123456789012345, 0.9999, 1.0001]) {
    assert.equal(
      canonicalizeSourceUnitBoundaryCoordinate(value),
      value,
      `${value} must pass through unchanged`
    );
  }
  // Just beyond the window on either boundary.
  const justOutside = SOURCE_UNIT_BOUNDARY_EPSILON * 4;
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(justOutside), justOutside);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(1 + justOutside), 1 + justOutside);
});

test("H2: canonicalization fails closed and never mutates its input", () => {
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(Number.NaN), null);
  assert.equal(canonicalizeSourceUnitBoundaryCoordinate(Number.POSITIVE_INFINITY), null);
  assert.equal(canonicalizeSourceUnitBoundaryPoint({ x: Number.NaN, y: 0.5 }), null);
  assert.equal(canonicalizeSourceUnitBoundaryPoint({ x: 0.5, y: Number.NaN }), null);
  assert.equal(canonicalizeSourceUnitBoundaryPoint(null), null);

  const input = { x: 1.0000000000000002, y: -0.05 };
  const snapshot = { ...input };
  const result = canonicalizeSourceUnitBoundaryPoint(input);
  assert.deepEqual(input, snapshot, "input must not be mutated");
  assert.ok(result);
  assert.equal(result.x, 1);
  assert.equal(result.y, -0.05);
  assert.notEqual(result, input);
});

test("H2: the raw generic unclamped transform really does produce 1.0000000000000002", () => {
  // Empirically observed: a 3007x1993 image in a 1600x1000 frame.
  const intrinsic: ImageIntrinsicSize = { width: 3007, height: 1993 };
  const container = sourceNormToContainerNormUnclamped({ x: 0.5, y: 1 }, intrinsic, FRAME_16_10);
  assert.ok(container);
  const raw = containerNormToSourceNormUnclamped(container, intrinsic, FRAME_16_10);
  assert.ok(raw);
  assert.equal(raw.y, 1.0000000000000002, "the raw transform must stay a truthful raw transform");
  assert.ok(raw.y > 1, "the raw value is above 1 and would be rejected by scene v1");

  // The Floor authority projection canonicalizes it.
  const authority = projectFloorContainerPolygonToSource([container], intrinsic, FRAME_16_10);
  assert.ok(authority);
  assert.equal(authority[0].y, 1, "the Floor authority path must yield exactly 1");
});

test("H2: the same holds near 0", () => {
  const intrinsic: ImageIntrinsicSize = { width: 1264, height: 848 };
  const frame: ImageFrameSize = { width: 1280, height: 800 };
  const container = sourceNormToContainerNormUnclamped({ x: 0.5, y: 0 }, intrinsic, frame);
  assert.ok(container);
  const raw = containerNormToSourceNormUnclamped(container, intrinsic, frame);
  assert.ok(raw);
  assert.equal(raw.y, 4.137151837046574e-18, "the raw transform keeps its sub-ULP residue");
  assert.notEqual(raw.y, 0);

  const authority = projectFloorContainerPolygonToSource([container], intrinsic, frame);
  assert.ok(authority);
  assert.equal(authority[0].y, 0, "the Floor authority path must yield exactly 0");
});

test("H2: 1264x848 boundary round trips produce exact 0 and 1", () => {
  const frames: ImageFrameSize[] = [
    { width: 1600, height: 1000 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ];
  const source: FloorPoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  for (const frame of frames) {
    const container = projectFloorSourcePolygonToContainer(source, INTRINSIC_1264_848, frame);
    assert.ok(container);
    const back = projectFloorContainerPolygonToSource(container, INTRINSIC_1264_848, frame);
    assert.ok(back);
    for (let i = 0; i < source.length; i += 1) {
      assert.equal(back[i].x, source[i].x, `exact x for frame ${frame.width}x${frame.height}`);
      assert.equal(back[i].y, source[i].y, `exact y for frame ${frame.width}x${frame.height}`);
    }
  }
});

test("H2: 7360x4912 boundary round trips produce exact 0 and 1", () => {
  const intrinsic: ImageIntrinsicSize = { width: 7360, height: 4912 };
  const frames: ImageFrameSize[] = [
    { width: 1600, height: 1000 },
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ];
  const source: FloorPoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  for (const frame of frames) {
    const container = projectFloorSourcePolygonToContainer(source, intrinsic, frame);
    assert.ok(container);
    const back = projectFloorContainerPolygonToSource(container, intrinsic, frame);
    assert.ok(back);
    for (let i = 0; i < source.length; i += 1) {
      assert.equal(back[i].x, source[i].x, `exact x for frame ${frame.width}x${frame.height}`);
      assert.equal(back[i].y, source[i].y, `exact y for frame ${frame.width}x${frame.height}`);
    }
  }
});

test("H2: odd-dimension one-ULP noise is canonicalized on both axes", () => {
  // 1263x847 in a 1280x800 frame drifts on x; several combinations drift on y.
  const cases: Array<{ intrinsic: ImageIntrinsicSize; frame: ImageFrameSize }> = [
    { intrinsic: { width: 1263, height: 847 }, frame: { width: 1280, height: 800 } },
    { intrinsic: { width: 1601, height: 1067 }, frame: { width: 1440, height: 900 } },
    { intrinsic: { width: 999, height: 667 }, frame: { width: 1600, height: 1000 } },
    { intrinsic: { width: 4001, height: 2999 }, frame: { width: 1280, height: 800 } },
    { intrinsic: { width: 3007, height: 1993 }, frame: { width: 1600, height: 1000 } },
  ];
  const source: FloorPoint[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  let sawRawDrift = false;
  for (const { intrinsic, frame } of cases) {
    const container = projectFloorSourcePolygonToContainer(source, intrinsic, frame);
    assert.ok(container);

    const raw = container.map((p) => containerNormToSourceNormUnclamped(p, intrinsic, frame));
    if (raw.some((p, i) => p && (p.x !== source[i].x || p.y !== source[i].y))) sawRawDrift = true;

    const back = projectFloorContainerPolygonToSource(container, intrinsic, frame);
    assert.ok(back);
    for (let i = 0; i < source.length; i += 1) {
      assert.equal(back[i].x, source[i].x, `${intrinsic.width}x${intrinsic.height} exact x`);
      assert.equal(back[i].y, source[i].y, `${intrinsic.width}x${intrinsic.height} exact y`);
    }
  }
  assert.ok(sawRawDrift, "the fixture set must actually exercise raw ULP drift");
});

test("H2: genuinely out-of-frame values survive the Floor authority path untouched", () => {
  const intrinsic: ImageIntrinsicSize = { width: 3007, height: 1993 };
  const source: FloorPoint[] = [
    { x: -0.05, y: 1.25 },
    { x: 1.25, y: -0.25 },
    { x: -0.25, y: 1.000001 },
    { x: 0.999999, y: 0.000001 },
  ];
  const container = projectFloorSourcePolygonToContainer(source, intrinsic, FRAME_16_10);
  assert.ok(container);
  const back = projectFloorContainerPolygonToSource(container, intrinsic, FRAME_16_10);
  assert.ok(back);
  for (let i = 0; i < source.length; i += 1) {
    assert.ok(
      Math.abs(back[i].x - source[i].x) < 1e-12 && Math.abs(back[i].y - source[i].y) < 1e-12,
      `off-frame corner ${i} must be preserved: ${JSON.stringify(back[i])}`
    );
    // Nothing was snapped to a boundary.
    if (source[i].x !== 0 && source[i].x !== 1) assert.notEqual(back[i].x, Math.round(back[i].x));
  }
});

test("H2: repeated round trips reach a fixed point and never drift", () => {
  // Canonicalization guarantees EXACTNESS at the semantic boundary. An interior
  // coordinate may absorb a single ULP on the first round trip; the invariant
  // that matters is that it then stops moving, so error cannot accumulate.
  const intrinsic: ImageIntrinsicSize = { width: 3007, height: 1993 };
  const original = boundaryQuad();
  const cycle = (polygon: FloorPoint[]): FloorPoint[] => {
    const container = projectFloorSourcePolygonToContainer(polygon, intrinsic, FRAME_16_10);
    assert.ok(container);
    const back = projectFloorContainerPolygonToSource(container, intrinsic, FRAME_16_10);
    assert.ok(back);
    return back;
  };

  const afterFirst = cycle(original);
  let source = afterFirst;
  for (let i = 1; i < 1000; i += 1) {
    source = cycle(source);
    assert.deepEqual(source, afterFirst, `cycle ${i + 1} must equal the cycle-1 fixed point`);
  }

  for (let i = 0; i < original.length; i += 1) {
    // Boundary coordinates are exact, forever.
    if (original[i].y === 1 || original[i].y === 0) {
      assert.equal(source[i].y, original[i].y, `boundary corner ${i} y exact after 1000 cycles`);
    }
    // Interior coordinates stay within one ULP of the original and never grow.
    assert.ok(
      Math.abs(source[i].x - original[i].x) <= 4 * Number.EPSILON,
      `corner ${i} x within one ULP after 1000 cycles: ${source[i].x}`
    );
    assert.ok(Math.abs(source[i].y - original[i].y) <= 4 * Number.EPSILON);
  }
});

test("H2: editing one corner leaves every untouched corner unchanged, boundary exactly", () => {
  const intrinsic: ImageIntrinsicSize = { width: 3007, height: 1993 };
  const source = boundaryQuad();
  const container = projectFloorSourcePolygonToContainer(source, intrinsic, FRAME_16_10);
  assert.ok(container);
  const edited = container.map((point, index) => (index === 2 ? { x: 0.62, y: point.y } : point));
  const back = projectFloorContainerPolygonToSource(edited, intrinsic, FRAME_16_10);
  assert.ok(back);

  // The two boundary-touching corners survive exactly: this is the value that
  // scene-v1 persistence depends on.
  assert.equal(back[0].y, 1, "corner NL y must be exactly 1");
  assert.equal(back[1].y, 1, "corner NR y must be exactly 1");
  for (const index of [0, 1, 3]) {
    assert.ok(
      Math.abs(back[index].x - source[index].x) <= 4 * Number.EPSILON,
      `corner ${index} x preserved to within one ULP`
    );
    assert.ok(
      Math.abs(back[index].y - source[index].y) <= 4 * Number.EPSILON,
      `corner ${index} y preserved to within one ULP`
    );
  }
  assert.ok(Math.abs(back[2].x - source[2].x) > 1e-3, "the edited corner must actually have moved");
  // The historic corruption value must not reappear.
  assert.notEqual(back[0].y, 1100 / 1200);
});

// ===========================================================================
// Scene-v1 re-import regression
// ===========================================================================

const VALIDATION_CONFIG: SceneStateValidationConfig = {
  transformLimits: {
    positionX: { min: -10, max: 10 },
    positionY: { min: -10, max: 10 },
    positionZ: { min: -10, max: 10 },
    rotationYDeg: { min: -180, max: 180 },
    uniformScale: { min: 0.1, max: 10 },
  },
  modelNormalizationLimits: {
    modelYOffset: { min: -10, max: 10 },
    modelYawOffsetDeg: { min: -180, max: 180 },
    modelScaleMultiplier: { min: 0.1, max: 10 },
  },
  floorMappingLimits: {
    worldWidth: { min: 0.1, max: 50 },
    worldDepth: { min: 0.1, max: 50 },
    depthCenterY: { min: -5, max: 5 },
  },
  perspectiveDepthScalingLimits: {
    nearScaleMultiplier: { min: 0.1, max: 4 },
    farScaleMultiplier: { min: 0.1, max: 4 },
    nearFloorY: { min: 0, max: 1 },
    farFloorY: { min: 0, max: 1 },
  },
  defaultModelNormalization: { modelYOffset: 0, modelYawOffsetDeg: 0, modelScaleMultiplier: 1 },
  defaultFloorMapping: { worldWidth: 6, worldDepth: 5, depthCenterY: 0.5 },
  defaultPerspectiveDepthScaling: {
    enabled: false,
    nearScaleMultiplier: 1,
    farScaleMultiplier: 1,
    nearFloorY: 0,
    farFloorY: 1,
  },
};

const SCENE_BASIS = {
  basisId: "basis-cp1a",
  basisFingerprint: "fingerprint-cp1a",
  sourceImageUrl: "https://example.test/room.jpg",
  decodedWidth: 3007,
  decodedHeight: 1993,
  encodedOrientation: 1,
  decodedOrientationNormal: true as const,
  orientationTransform: "identity" as const,
  dimensionSource: "server" as const,
  coordinateSpaceVersion: {
    decoderId: "sharp-metadata/v1",
    normalizationPolicyVersion: "orientation-normal/v1",
    orientationApplied: false,
  },
  basisKind: "original" as const,
};

type Quad = [FloorPoint, FloorPoint, FloorPoint, FloorPoint];

function sceneInput(sourceQuad: Quad, containerQuad: Quad): SceneStatePayloadInput {
  const wallQuad: Quad = [
    { x: 0.2, y: 0.8 },
    { x: 0.8, y: 0.8 },
    { x: 0.8, y: 0.2 },
    { x: 0.2, y: 0.2 },
  ];
  const wall = (kind: "wall_back" | "wall_left" | "wall_right") => ({
    draft: {
      kind,
      enabled: true,
      source: "manual" as const,
      imagePolygonSourceNorm: structuredClone(wallQuad),
      reviewStatus: "manually_confirmed" as const,
      confirmationStamp: {
        wallPolygonKey: `${kind}-polygon`,
        imageBasisId: SCENE_BASIS.basisId,
        imageBasisFingerprint: SCENE_BASIS.basisFingerprint,
        cameraAppliedAtIso: "2026-08-01T00:00:00.000Z",
        frameWidth: 1600,
        frameHeight: 1000,
      },
    },
    supportImageBasis: structuredClone(SCENE_BASIS),
  });
  return {
    exportedAtIso: "2026-08-01T00:00:00.000Z",
    roomImageUrl: SCENE_BASIS.sourceImageUrl,
    modelPath: "/cube.glb",
    activeObjectType: "fallbackCube",
    glbLoadStatus: "fallback",
    modelNormalization: { modelYOffset: 0, modelYawOffsetDeg: 0, modelScaleMultiplier: 1 },
    transform: { positionX: 0, positionY: 0, positionZ: 0, rotationYDeg: 0, uniformScale: 1, autoRotate: false },
    floor: {
      polygon: structuredClone(containerQuad),
      overlayVisible: true,
      placementModeEnabled: false,
      lastAcceptedClick: null,
      lastRejectedClick: null,
      mapping: { worldWidth: 6, worldDepth: 5, depthCenterY: 0.5 },
      perspectiveDepthScaling: {
        enabled: false,
        nearScaleMultiplier: 1,
        farScaleMultiplier: 1,
        nearFloorY: 0,
        farFloorY: 1,
      },
    },
    image: { intrinsicWidth: 3007, intrinsicHeight: 1993, coordinateSpace: "container-normalized-v0" },
    calibration: {
      calibrationVersion: "calibrated-camera/v2",
      solver: "homography-planar-cv/v1",
      intrinsics: { verticalFovDeg: 50 },
      source: {
        imageBasis: structuredClone(SCENE_BASIS),
        sourceFloorPolygon: structuredClone(sourceQuad),
      },
    },
    supports: {
      floor: {
        sourceNormalizedPolygon: structuredClone(sourceQuad),
        reviewStatus: "manually_confirmed",
        source: "manual",
        supportImageBasis: structuredClone(SCENE_BASIS),
        authorityEligible: true,
      },
      walls: { wall_back: wall("wall_back"), wall_left: wall("wall_left"), wall_right: wall("wall_right") },
      ceiling: null,
    },
    attachment: null,
    debug: { rendererSize: { width: 1600, height: 1000 }, imageStatus: "loaded", modelStatus: "fallback" },
  };
}

function build(input: SceneStatePayloadInput) {
  const result = buildSceneStatePayload(input);
  assert.ok(result.ok, result.ok ? "" : result.reason);
  return result.payload;
}

test("scene v1: a boundary-touching Floor scene survives edit, export, and re-import", () => {
  const intrinsic: ImageIntrinsicSize = { width: 3007, height: 1993 };
  const sourceQuad: Quad = [
    { x: 0.2, y: 1 },
    { x: 0.8, y: 1 },
    { x: 0.7, y: 0.55 },
    { x: 0.3, y: 0.55 },
  ];

  // Derive the container polygon, then edit ONE other corner through the
  // production-equivalent Floor path.
  const container = projectFloorSourcePolygonToContainer(sourceQuad, intrinsic, FRAME_16_10);
  assert.ok(container);
  const edited = container.map((point, index) => (index === 2 ? { x: 0.62, y: point.y } : point));
  const editedSource = projectFloorContainerPolygonToSource(edited, intrinsic, FRAME_16_10);
  assert.ok(editedSource && editedSource.length === 4);

  // The untouched boundary corners are exactly 1, not 1.0000000000000002.
  assert.equal(editedSource[0].y, 1);
  assert.equal(editedSource[1].y, 1);

  const payload = build(
    sceneInput(editedSource as Quad, edited as Quad)
  );
  const parsed = validateImportedSceneJson(JSON.parse(JSON.stringify(payload)), VALIDATION_CONFIG);
  assert.notEqual(typeof parsed, "string", `import must be accepted, got: ${String(parsed)}`);
  if (typeof parsed === "string") return;

  assert.equal(parsed.supports?.floor.sourceNormalizedPolygon[0].y, 1);
  assert.equal(parsed.supports?.floor.sourceNormalizedPolygon[1].y, 1);
  assert.equal(payload.schemaVersion, SCENE_STATE_SCHEMA_VERSION);
  assert.equal(payload.schemaVersion, "vibode-3d-room-lab-scene-state/v1");
});

test("scene v1: the uncanonicalized raw value would have been rejected", () => {
  // Proves the regression is real rather than vacuous: the same scene carrying
  // the raw one-ULP overshoot fails to import.
  const rawQuad: Quad = [
    { x: 0.2, y: 1.0000000000000002 },
    { x: 0.8, y: 1 },
    { x: 0.7, y: 0.55 },
    { x: 0.3, y: 0.55 },
  ];
  const containerQuad: Quad = [
    { x: 0.2, y: 1 },
    { x: 0.8, y: 1 },
    { x: 0.62, y: 0.7 },
    { x: 0.3, y: 0.7 },
  ];
  const payload = build(sceneInput(rawQuad, containerQuad));
  payload.schemaVersion = SCENE_STATE_SCHEMA_VERSION;
  const parsed = validateImportedSceneJson(JSON.parse(JSON.stringify(payload)), VALIDATION_CONFIG);
  assert.equal(typeof parsed, "string", "a raw >1 source coordinate must still be rejected by scene v1");
});

test("scene v1: genuine values above 1 beyond the tiny tolerance remain rejected", () => {
  for (const badY of [1.000001, 1.05, 1.25]) {
    const quad: Quad = [
      { x: 0.2, y: badY },
      { x: 0.8, y: 1 },
      { x: 0.7, y: 0.55 },
      { x: 0.3, y: 0.55 },
    ];
    const containerQuad: Quad = [
      { x: 0.2, y: 1 },
      { x: 0.8, y: 1 },
      { x: 0.7, y: 0.7 },
      { x: 0.3, y: 0.7 },
    ];
    const payload = build(sceneInput(quad, containerQuad));
    payload.schemaVersion = SCENE_STATE_SCHEMA_VERSION;
    const parsed = validateImportedSceneJson(JSON.parse(JSON.stringify(payload)), VALIDATION_CONFIG);
    assert.equal(typeof parsed, "string", `source y=${badY} must remain rejected by scene v1`);
  }
});

test("scene versions retain v1 unit bounds and activate widened Floor bounds only for v2", () => {
  assert.equal(SCENE_STATE_SCHEMA_VERSION, "vibode-3d-room-lab-scene-state/v1");
  assert.equal(SCENE_STATE_SCHEMA_VERSION_V2, "vibode-3d-room-lab-scene-state/v2");
  const sceneStateSource = readFileSync(path.join(LAB_DIR, "scene-state.ts"), "utf8");
  assert.ok(
    /if \(x === null \|\| y === null \|\| x < 0 \|\| x > 1 \|\| y < 0 \|\| y > 1\) return null;/.test(
      sceneStateSource
    ),
    "the source-normalized quad parser must keep its strict [0,1] bound"
  );
  assert.ok(
    /schemaVersion: SCENE_STATE_SCHEMA_VERSION_V2,[\s\S]*floorSourceCoordinateExtent: FLOOR_SOURCE_COORDINATE_EXTENT/.test(
      sceneStateSource
    ),
    "only scene v2 may activate the widened Floor source extent"
  );
});

// ===========================================================================
// Containment / structural guards
// ===========================================================================

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_SOURCE = readFileSync(path.join(LAB_DIR, "ThreeRoomLab.tsx"), "utf8");
const EXTENT_SOURCE = readFileSync(path.join(LAB_DIR, "floor-coordinate-extent.ts"), "utf8");
const IMAGE_SPACE_SOURCE = readFileSync(path.join(LAB_DIR, "image-space.ts"), "utf8");

function extractCallbackBlock(name: string): string {
  const start = UI_SOURCE.indexOf(`const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} must exist in ThreeRoomLab.tsx`);
  const end = UI_SOURCE.indexOf("\n  );", start);
  assert.ok(end > start, `${name} must be a closed useCallback block`);
  return UI_SOURCE.slice(start, end);
}

const FLOOR_C2S = extractCallbackBlock("projectFloorContainerPolygonToSource");
const FLOOR_S2C = extractCallbackBlock("projectFloorSourcePolygonToContainer");
const GENERIC_C2S = extractCallbackBlock("projectContainerPolygonToSource");
const GENERIC_S2C = extractCallbackBlock("projectSourcePolygonToContainer");

test("containment: Floor-specific callbacks use the unclamped transforms", () => {
  assert.ok(/containerNormToSourceNormUnclamped\s*\(/.test(FLOOR_C2S));
  assert.ok(/sourceNormToContainerNormUnclamped\s*\(/.test(FLOOR_S2C));
  assert.ok(!/containerNormToSourceNorm\s*\(/.test(FLOOR_C2S));
  assert.ok(!/sourceNormToContainerNorm\s*\(/.test(FLOOR_S2C));
});

test("containment: generic (Wall/Ceiling) callbacks use the clamped transforms", () => {
  assert.ok(/containerNormToSourceNorm\s*\(/.test(GENERIC_C2S));
  assert.ok(/sourceNormToContainerNorm\s*\(/.test(GENERIC_S2C));
  assert.ok(!/Unclamped\s*\(/.test(GENERIC_C2S));
  assert.ok(!/Unclamped\s*\(/.test(GENERIC_S2C));
  assert.ok(!/canonicalizeSourceUnitBoundary/.test(GENERIC_C2S));
  assert.ok(!/canonicalizeSourceUnitBoundary/.test(GENERIC_S2C));
});

test("containment: Floor authority planning uses Floor-specific callbacks", () => {
  // container-first authority planning
  assert.ok(/const plan = planContainerFloorPolygon\(\{[\s\S]*projectFloorContainerPolygonToSource/.test(UI_SOURCE));
  // source-first authority planning
  assert.ok(/const plan = planSourceNormalizedFloorPolygon\(\{[\s\S]*projectFloorSourcePolygonToContainer/.test(UI_SOURCE));
  // source -> container Floor synchronization effect
  assert.ok(
    /const projectedContainer = projectFloorSourcePolygonToContainer\(sourceNormalizedFloorPolygon\);/.test(
      UI_SOURCE
    )
  );
  // Floor calibration restore projection/comparison
  assert.ok(
    /const projectedRestorePolygon = projectFloorSourcePolygonToContainer\(\s*pending\.calibration\.source\.sourceFloorPolygon\s*\);/.test(
      UI_SOURCE
    )
  );
});

test("import precedence: supports-bearing scenes install source authority without container-first reconstruction", () => {
  const importStart = UI_SOURCE.indexOf("const applyValidatedSceneState =");
  const supportsStart = UI_SOURCE.indexOf("if (validated.supports) {", importStart);
  const legacyStart = UI_SOURCE.indexOf("} else {", supportsStart);
  const importEnd = UI_SOURCE.indexOf("const handleApplyImportedSceneJson =", importStart);
  assert.ok(importStart >= 0 && supportsStart > importStart && legacyStart > supportsStart && importEnd > legacyStart);

  const supportsRestore = UI_SOURCE.slice(supportsStart, legacyStart);
  assert.match(supportsRestore, /setFloorPolygon\(validated\.floor\.polygon\.map/);
  assert.match(supportsRestore, /setSourceNormalizedFloorPolygon\(\s*validated\.supports\.floor\.sourceNormalizedPolygon\.map/);
  assert.ok(
    supportsRestore.indexOf("setSourceNormalizedFloorPolygon(") < supportsRestore.indexOf("setFloorPolygon("),
    "canonical source authority must be installed before the provisional mirror"
  );
  assert.match(
    supportsRestore,
    /floorPolygonAuthorityKeyRef\.current = buildDurableSourceFloorAuthorityKey\(\s*validated\.supports\.floor\.sourceNormalizedPolygon/
  );
  assert.equal(
    supportsRestore.includes("applyContainerFloorPolygon("),
    false,
    "v1/v2 source authority must not be reconstructed from the mirror"
  );

  const legacyRestore = UI_SOURCE.slice(legacyStart, importEnd);
  assert.match(
    legacyRestore,
    /applyContainerFloorPolygon\(validated\.floor\.polygon, \{\s*status: "needs_review",\s*source: "derived",\s*\}\)/
  );
});

test("containment: every Wall and Ceiling consumer stays on the generic clamped callbacks", () => {
  const wallCeilingConsumers = [
    // wallContainerPolygons
    "const projected = projectSourcePolygonToContainer(sourcePolygon);",
    // ceilingContainerPolygon
    "const projected = source ? projectSourcePolygonToContainer(source) : null;",
    // configureWall
    "const sourcePolygon = projectContainerPolygonToSource(containerPolygon);",
    // configureCeiling
    "const source = projectContainerPolygonToSource(DEFAULT_CEILING_CONTAINER_POLYGON);",
  ];
  for (const consumer of wallCeilingConsumers) {
    assert.ok(UI_SOURCE.includes(consumer), `Wall/Ceiling consumer must be unchanged: ${consumer}`);
  }
  // Ceiling and Wall handle drags.
  assert.equal(
    (UI_SOURCE.match(/const nextSource = projectContainerPolygonToSource\(nextContainer\);/g) ?? []).length,
    2,
    "the Ceiling and Wall handle drags must both stay on the clamped callback"
  );
});

test("containment: canonicalization is used only in the Floor container->source path", () => {
  const calls = UI_SOURCE.match(/canonicalizeSourceUnitBoundary\w*\s*\(/g) ?? [];
  assert.equal(calls.length, 1, "exactly one canonicalization call site in the lab UI");
  assert.ok(
    /canonicalizeSourceUnitBoundaryPoint\s*\(/.test(FLOOR_C2S),
    "the single call site must be the Floor container->source authority callback"
  );
  assert.ok(
    !/canonicalizeSourceUnitBoundary/.test(FLOOR_S2C),
    "Floor source->container must not canonicalize"
  );
  // The generic image-space transforms stay raw. Inspect code, not the doc
  // comment that points readers at the Floor-only helper.
  const imageSpaceCode = IMAGE_SPACE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/canonicalizeSourceUnitBoundary/.test(imageSpaceCode),
    "image-space transforms must remain raw mathematical transforms"
  );
  assert.equal((IMAGE_SPACE_SOURCE.match(/^import\b/gm) ?? []).length, 1);
});

test("containment: no Wall or Ceiling boundary proxy was introduced", () => {
  const proxyCalls = UI_SOURCE.match(/resolveFloorHandlePresentation\s*\(/g) ?? [];
  assert.equal(proxyCalls.length, 1, "the proxy resolver must have exactly one call site");
  assert.ok(
    /const floorHandlePresentations = useMemo\(\s*\(\) => floorPolygon\.map\(\(point\) => resolveFloorHandlePresentation\(point\)\),/.test(
      UI_SOURCE
    ),
    "the single call site must be the Floor presentation memo"
  );
  for (const forbidden of [
    "wallHandlePresentations",
    "ceilingHandlePresentations",
    "resolveWallHandlePresentation",
    "resolveCeilingHandlePresentation",
  ]) {
    assert.ok(!UI_SOURCE.includes(forbidden), `no ${forbidden} may exist in AFC-CP1A`);
  }
});

test("containment: presentation values never reach authority state", () => {
  assert.ok(!/set[A-Z]\w*\([^)]*floorHandlePresentations/.test(UI_SOURCE));
  assert.ok(!/applyContainerFloorPolygon\([^)]*presentation/.test(UI_SOURCE));
  assert.ok(!/projectFloor\w+\([^)]*presentation/.test(UI_SOURCE));
});

test("containment: no solver caller switched and no scene parser widened", () => {
  assert.ok(/const pixels = normToPixels\(point, frameSize\);/.test(UI_SOURCE));
  assert.ok(!/normToPixelsUnclamped/.test(UI_SOURCE));
  assert.equal(SCENE_STATE_SCHEMA_VERSION, "vibode-3d-room-lab-scene-state/v1");
});

test("containment: the extent module stays pure and free of side effects", () => {
  assert.equal((EXTENT_SOURCE.match(/^import\b/gm) ?? []).length, 0);
  const code = EXTENT_SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["fetch(", "fs.", "process.", "provider", "compositor", "capture", "proposal"]) {
    assert.ok(!code.includes(forbidden), `the extent module must not reference ${forbidden}`);
  }
});

test("containment: image-space documentation states the Floor/non-Floor split accurately", () => {
  assert.ok(/FLOOR authority projection uses the UNCLAMPED transforms/.test(IMAGE_SPACE_SOURCE));
  assert.ok(/WALL, CEILING, seam, Type B, Empty-Room-Assist/.test(IMAGE_SPACE_SOURCE));
  assert.ok(/SOLVER INPUT remains clamped in AFC-CP1A/.test(IMAGE_SPACE_SOURCE));
  assert.ok(/FLOOR HANDLES are drawn through a presentation-only boundary proxy/.test(IMAGE_SPACE_SOURCE));
  assert.ok(
    !/It must NOT be used for UI\/manual overlay conversion/.test(IMAGE_SPACE_SOURCE),
    "the superseded prohibition must stay removed"
  );
  assert.ok(
    !/[Cc]eiling[^.\n]*unclamped/.test(IMAGE_SPACE_SOURCE),
    "nothing may suggest Ceiling was switched to unclamped projection"
  );
});

test("CP1B-B: runtime authority mutations converge through source-authority planning and one commit", () => {
  const commitStart = UI_SOURCE.indexOf("const commitFloorAuthorityMutation = useCallback(");
  const containerStart = UI_SOURCE.indexOf("const applyContainerFloorPolygon = useCallback(");
  const sourceStart = UI_SOURCE.indexOf("const applySourceNormalizedFloorPolygon = useCallback(");
  assert.ok(commitStart >= 0 && containerStart > commitStart && sourceStart > containerStart);
  const commit = UI_SOURCE.slice(commitStart, containerStart);
  const container = UI_SOURCE.slice(containerStart, sourceStart);
  const source = UI_SOURCE.slice(sourceStart, UI_SOURCE.indexOf("\n  useEffect(() => {", sourceStart));

  assert.match(commit, /setSourceNormalizedFloorPolygon\(sourcePolygon\)/);
  assert.match(commit, /floorPolygonAuthorityKeyRef\.current = plan\.authorityKey/);
  assert.match(commit, /previousAuthorityKey !== plan\.authorityKey/);
  assert.match(commit, /cancelPendingCalibrationRestoreAfterManualGeometryChange\(\)/);
  assert.match(commit, /deactivateCalibratedCameraMode\(\)/);
  assert.match(container, /planContainerFloorPolygon/);
  assert.match(container, /commitFloorAuthorityMutation\(plan, review, options\)/);
  assert.match(source, /planSourceNormalizedFloorPolygon/);
  assert.match(source, /commitFloorAuthorityMutation\(plan, review, options\)/);
  assert.ok(!/localStorage|buildCurrentSceneStatePayload|sceneStateExportedAt/.test(source));
});

test("CP1B-B: durable runtime identity is source-only while restores remain specialized", () => {
  assert.match(
    UI_SOURCE,
    /useRef\(buildDurableSourceFloorAuthorityKey\(DEFAULT_FLOOR_POLYGON\)\)/
  );
  assert.match(
    UI_SOURCE,
    /floorPolygonAuthorityKey: buildDurableSourceFloorAuthorityKey\(sourceNormalizedFloorPolygon\)/
  );
  assert.match(
    UI_SOURCE,
    /floorPolygonAuthorityKeyRef\.current = buildDurableSourceFloorAuthorityKey\(\s*pending\.calibration\.source\.sourceFloorPolygon/
  );
  assert.match(
    UI_SOURCE,
    /floorPolygonAuthorityKeyRef\.current = buildDurableSourceFloorAuthorityKey\(\s*validated\.supports\.floor\.sourceNormalizedPolygon/
  );
  assert.equal(
    UI_SOURCE.includes("shouldDropAuthorityOnManualAdjustment"),
    false,
    "container-space invalidation effect must not remain"
  );
});

test("CP1B-B: no Apply Verified AFC Quad UI or persistence side effect was introduced", () => {
  assert.equal(UI_SOURCE.includes("Apply Verified AFC Quad"), false);
  assert.match(UI_SOURCE, /const LOCAL_DRAFT_STORAGE_KEY = "vibode:3d-room-lab:scene-state:v0";/);
});

test("CP1B-B correction: legacy v0 import fails closed when canonical source projection is unavailable", () => {
  const installerStart = UI_SOURCE.indexOf("const applyValidatedSceneState =");
  const legacyStart = UI_SOURCE.indexOf("} else {", UI_SOURCE.indexOf("if (validated.supports) {", installerStart));
  const verticalEvidenceStart = UI_SOURCE.indexOf("setVerticalEvidence(", legacyStart);
  assert.ok(installerStart >= 0 && legacyStart > installerStart && verticalEvidenceStart > legacyStart);
  const legacyBranch = UI_SOURCE.slice(legacyStart, verticalEvidenceStart);

  assert.match(
    legacyBranch,
    /const legacyFloorInstalled = applyContainerFloorPolygon\(validated\.floor\.polygon, \{\s*status: "needs_review",\s*source: "derived",\s*\}\)/
  );
  assert.match(legacyBranch, /if \(!legacyFloorInstalled\) return false;/);
  assert.ok(
    legacyBranch.indexOf("if (!legacyFloorInstalled) return false;") <
      legacyBranch.indexOf("setWallSupportDrafts("),
    "failure must stop before later legacy support installation"
  );

  const importStart = UI_SOURCE.indexOf("const handleApplyImportedSceneJson =");
  const importEnd = UI_SOURCE.indexOf("const handleClearImportedSceneJson =", importStart);
  const draftStart = UI_SOURCE.indexOf("const handleRestoreLocalDraft =");
  const draftEnd = UI_SOURCE.indexOf("const handleClearLocalDraft =", draftStart);
  assert.ok(importStart >= 0 && importEnd > importStart && draftStart >= 0 && draftEnd > draftStart);
  const importHandler = UI_SOURCE.slice(importStart, importEnd);
  const draftHandler = UI_SOURCE.slice(draftStart, draftEnd);
  for (const handler of [importHandler, draftHandler]) {
    assert.match(
      handler,
      /if \(!applyValidatedSceneState\([\s\S]*?\)\) \{\s*set(?:ImportScene|LocalDraft)Status\(\{ kind: "error", message: LEGACY_V0_FLOOR_PROJECTION_NOT_READY_MESSAGE \}\);\s*return;\s*\}/
    );
    assert.ok(
      handler.indexOf("LEGACY_V0_FLOOR_PROJECTION_NOT_READY_MESSAGE") <
        handler.indexOf("successfully."),
      "failed installation must not reach the success status"
    );
  }
});
