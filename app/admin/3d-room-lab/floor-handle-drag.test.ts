import assert from "node:assert/strict";
import test from "node:test";

import {
  createFloorHandleDragStart,
  deriveFloorHandleDragCandidate,
  floorDragCandidateDiffersFromCurrent,
  floorDragOverlayRectEquals,
  floorDragPointerFromClient,
} from "./floor-handle-drag";
import { resolveFloorHandlePresentation } from "./floor-handle-presentation";
import { planContainerFloorPolygon } from "./floor-source-authority";
import {
  beginSupportPointDragTransaction,
  consumeSupportPointUndo,
  finalizeSupportPointDragTransaction,
} from "./support-point-undo";

const RECT = { left: 0, top: 0, width: 1000, height: 1000 };
const OFF_FRAME_POLYGON = [
  { x: 0.38, y: 1.141 },
  { x: 0.62, y: 1.141 },
  { x: 0.82, y: 0.76 },
  { x: 0.18, y: 0.76 },
] as const;

function start(
  polygon: readonly { x: number; y: number }[] = OFF_FRAME_POLYGON,
  cornerIndex = 0,
  pointer = { x: 0.38, y: 1 }
) {
  const value = createFloorHandleDragStart({
    cornerIndex,
    floorPolygon: polygon,
    startPointer: pointer,
    overlayRect: RECT,
  });
  assert.ok(value);
  return value;
}

function key(polygon: readonly { x: number; y: number }[]): string {
  return JSON.stringify(polygon);
}

function assertPointClose(
  actual: { x: number; y: number },
  expected: { x: number; y: number }
): void {
  assert.ok(Math.abs(actual.x - expected.x) < 1e-12, `x: expected ${expected.x}, got ${actual.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-12, `y: expected ${expected.y}, got ${actual.y}`);
}

test("proxy pointer-down preserves the truthful off-frame corner without mutation", () => {
  const drag = start();
  assert.deepEqual(drag.startCorner, { x: 0.38, y: 1.141 });
  assert.deepEqual(drag.startPointer, { x: 0.38, y: 1 });
  assert.deepEqual(drag.startPolygon[0], { x: 0.38, y: 1.141 });
  assert.notDeepEqual(drag.startPolygon[0], drag.startPointer);
});

test("delta transfer applies proxy pointer movement to the truthful corner", () => {
  const candidate = deriveFloorHandleDragCandidate(start(), { x: 0.4, y: 0.95 });
  assert.ok(candidate);
  assert.deepEqual(candidate[0], { x: 0.4, y: 1.091 });
  assert.deepEqual(candidate.slice(1), OFF_FRAME_POLYGON.slice(1));
});

test("returning to the frozen pointer start reapplies the truthful start polygon after an intermediate move", () => {
  const drag = start();
  const intermediate = deriveFloorHandleDragCandidate(drag, { x: 0.4, y: 0.95 });
  assert.ok(intermediate);
  assert.equal(floorDragCandidateDiffersFromCurrent(intermediate, OFF_FRAME_POLYGON), true);

  let appliedPolygon = intermediate;
  const returned = deriveFloorHandleDragCandidate(drag, drag.startPointer);
  assert.ok(returned);
  assert.deepEqual(returned, OFF_FRAME_POLYGON, "the frozen-start math returns the original truthful polygon");
  assert.equal(
    floorDragCandidateDiffersFromCurrent(returned, appliedPolygon),
    true,
    "the return candidate must be applied against the current intermediate geometry"
  );
  appliedPolygon = returned;
  assert.deepEqual(appliedPolygon[0], { x: 0.38, y: 1.141 });
  assert.equal(
    floorDragCandidateDiffersFromCurrent(returned, OFF_FRAME_POLYGON),
    false,
    "only an already-live start polygon is a true no-op"
  );
});

test("crossing frame boundaries retains corner identity and changes presentation only", () => {
  const outward = deriveFloorHandleDragCandidate(
    start(
      [
        { x: 0.4, y: 0.4 },
        { x: 0.8, y: 0.9 },
        { x: 0.7, y: 0.45 },
        { x: 0.3, y: 0.45 },
      ],
      0,
      { x: 0.4, y: 0.4 }
    ),
    { x: -0.1, y: 1.2 }
  );
  assert.ok(outward);
  assertPointClose(outward[0], { x: -0.1, y: 1.2 });
  assert.equal(resolveFloorHandlePresentation(outward[0])?.offFrame, true);

  const inward = deriveFloorHandleDragCandidate(start(), { x: 0.38, y: 0.8 });
  assert.ok(inward);
  assertPointClose(inward[0], { x: 0.38, y: 0.941 });
  assert.equal(resolveFloorHandlePresentation(inward[0])?.offFrame, false);
  assert.deepEqual(inward.slice(1), OFF_FRAME_POLYGON.slice(1));
});

test("delta transfer preserves all four off-frame directions and diagonal magnitude", () => {
  const cases = [
    { point: { x: 0.5, y: 1.1 }, pointer: { x: 0.5, y: 1 }, current: { x: 0.5, y: 0.9 }, expected: { x: 0.5, y: 1 } },
    { point: { x: 0.5, y: -0.1 }, pointer: { x: 0.5, y: 0 }, current: { x: 0.5, y: 0.2 }, expected: { x: 0.5, y: 0.1 } },
    { point: { x: -0.1, y: 0.5 }, pointer: { x: 0, y: 0.5 }, current: { x: 0.2, y: 0.5 }, expected: { x: 0.1, y: 0.5 } },
    { point: { x: 1.1, y: 0.5 }, pointer: { x: 1, y: 0.5 }, current: { x: 0.8, y: 0.5 }, expected: { x: 0.9, y: 0.5 } },
    { point: { x: -0.1, y: 1.1 }, pointer: { x: 0, y: 1 }, current: { x: 0.2, y: 0.8 }, expected: { x: 0.1, y: 0.9 } },
  ];

  for (const { point, pointer, current, expected } of cases) {
    const polygon = [point, { x: 0.8, y: 0.9 }, { x: 0.7, y: 0.45 }, { x: 0.3, y: 0.45 }];
    const candidate = deriveFloorHandleDragCandidate(start(polygon, 0, pointer), current);
    assert.ok(candidate);
    assertPointClose(candidate[0], expected);
  }
});

test("Floor drag pointer conversion remains unclamped and fails closed", () => {
  assert.deepEqual(floorDragPointerFromClient(500, 250, RECT), { x: 0.5, y: 0.25 });
  assert.deepEqual(floorDragPointerFromClient(-250, 1250, RECT), { x: -0.25, y: 1.25 });
  assert.equal(floorDragPointerFromClient(1, 1, { ...RECT, width: 0 }), null);
  assert.equal(floorDragPointerFromClient(1, 1, { ...RECT, height: 0 }), null);
  assert.equal(floorDragPointerFromClient(Number.NaN, 1, RECT), null);
  assert.equal(floorDragPointerFromClient(1, Number.POSITIVE_INFINITY, RECT), null);
  assert.equal(floorDragPointerFromClient(1, 1, null), null);
});

test("source extent accepts exact bounds and rejects candidates beyond them without clamping", () => {
  const base = [
    { x: 0.2, y: 0.9 },
    { x: 0.8, y: 0.9 },
    { x: 0.7, y: 0.45 },
    { x: 0.3, y: 0.45 },
  ];
  const exact = planContainerFloorPolygon({
    containerPolygon: [{ x: -0.25, y: 1.25 }, ...base.slice(1)],
    projectToSource: (polygon) => polygon,
  });
  assert.equal(exact.ok, true);
  if (exact.ok) assert.deepEqual(exact.sourcePolygon[0], { x: -0.25, y: 1.25 });

  for (const point of [
    { x: -0.250001, y: 1.25 },
    { x: -0.25, y: 1.250001 },
  ]) {
    const rejected = planContainerFloorPolygon({
      containerPolygon: [point, ...base.slice(1)],
      projectToSource: (polygon) => polygon,
    });
    assert.equal(rejected.ok, false);
  }
});

test("one material drag creates one undo record while a no-move drag creates none", () => {
  const before = OFF_FRAME_POLYGON.map((point) => ({ ...point }));
  const material = deriveFloorHandleDragCandidate(start(), { x: 0.4, y: 0.95 });
  assert.ok(material);
  const transaction = beginSupportPointDragTransaction("floor", before, key(before));
  const record = finalizeSupportPointDragTransaction(transaction, key(material), null);
  assert.ok(record);
  assert.deepEqual(consumeSupportPointUndo(record)?.snapshot, before);

  const noMove = finalizeSupportPointDragTransaction(
    beginSupportPointDragTransaction("floor", before, key(before)),
    key(before),
    null
  );
  assert.equal(noMove, null);
});

test("a changed overlay basis is distinguishable from the frozen drag basis", () => {
  assert.equal(floorDragOverlayRectEquals(RECT, { ...RECT }), true);
  assert.equal(floorDragOverlayRectEquals(RECT, { ...RECT, width: 900 }), false);
});
