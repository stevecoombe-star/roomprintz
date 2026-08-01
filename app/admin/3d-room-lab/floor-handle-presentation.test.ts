import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  describeFloorHandleAccessibleLabel,
  resolveFloorHandlePresentation,
  type FloorHandlePresentation,
} from "./floor-handle-presentation";
import {
  containerNormToSourceNormUnclamped,
  sourceNormToContainerNormUnclamped,
  type ImageFrameSize,
  type ImageIntrinsicSize,
} from "./image-space";
import { SCENE_STATE_SCHEMA_VERSION } from "./scene-state";
import type { FloorPoint } from "./scene-state";

// AFC-CP1A hardening — presentation-only boundary proxy for Floor handles.
//
// The lossless authority transforms let a Floor corner project truthfully
// outside [0,1]. The polygon outline must keep that truthful geometry, but an
// interactive handle drawn off-frame is clipped and unreachable. The helper
// under test resolves a reachable render/hit target WITHOUT touching authority
// state.

function ok(presentation: FloorHandlePresentation | null): FloorHandlePresentation {
  assert.ok(presentation, "presentation must resolve");
  return presentation;
}

// --- 1. Pure presentation-helper behaviour ---------------------------------

test("presentation: an in-frame point is returned unchanged and is not off-frame", () => {
  const result = ok(resolveFloorHandlePresentation({ x: 0.375, y: 0.625 }));
  assert.equal(result.point.x, 0.375);
  assert.equal(result.point.y, 0.625);
  assert.equal(result.offFrame, false);
  assert.deepEqual(result.directions, []);
});

test("presentation: x below 0 clamps to 0 and reports left", () => {
  const result = ok(resolveFloorHandlePresentation({ x: -0.125, y: 0.4 }));
  assert.equal(result.point.x, 0);
  assert.equal(result.point.y, 0.4);
  assert.equal(result.offFrame, true);
  assert.deepEqual(result.directions, ["left"]);
});

test("presentation: x above 1 clamps to 1 and reports right", () => {
  const result = ok(resolveFloorHandlePresentation({ x: 1.4, y: 0.4 }));
  assert.equal(result.point.x, 1);
  assert.equal(result.point.y, 0.4);
  assert.equal(result.offFrame, true);
  assert.deepEqual(result.directions, ["right"]);
});

test("presentation: y below 0 clamps to 0 and reports above", () => {
  const result = ok(resolveFloorHandlePresentation({ x: 0.4, y: -0.3 }));
  assert.equal(result.point.x, 0.4);
  assert.equal(result.point.y, 0);
  assert.equal(result.offFrame, true);
  assert.deepEqual(result.directions, ["above"]);
});

test("presentation: y above 1 clamps to 1 and reports below", () => {
  const result = ok(resolveFloorHandlePresentation({ x: 0.4, y: 1.036709 }));
  assert.equal(result.point.x, 0.4);
  assert.equal(result.point.y, 1);
  assert.equal(result.offFrame, true);
  assert.deepEqual(result.directions, ["below"]);
});

test("presentation: diagonal overshoot reports both directions in a deterministic order", () => {
  // x-axis direction always precedes the y-axis direction.
  assert.deepEqual(ok(resolveFloorHandlePresentation({ x: -0.2, y: -0.2 })).directions, ["left", "above"]);
  assert.deepEqual(ok(resolveFloorHandlePresentation({ x: -0.2, y: 1.2 })).directions, ["left", "below"]);
  assert.deepEqual(ok(resolveFloorHandlePresentation({ x: 1.2, y: -0.2 })).directions, ["right", "above"]);
  assert.deepEqual(ok(resolveFloorHandlePresentation({ x: 1.2, y: 1.2 })).directions, ["right", "below"]);

  const corner = ok(resolveFloorHandlePresentation({ x: 1.2, y: 1.2 }));
  assert.equal(corner.point.x, 1);
  assert.equal(corner.point.y, 1);

  // Repeated calls are stable.
  assert.deepEqual(
    ok(resolveFloorHandlePresentation({ x: -0.5, y: 1.5 })).directions,
    ok(resolveFloorHandlePresentation({ x: -0.5, y: 1.5 })).directions
  );
});

test("presentation: exact boundary values 0 and 1 are in-frame", () => {
  for (const point of [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: 0.5 },
    { x: 0.5, y: 1 },
  ]) {
    const result = ok(resolveFloorHandlePresentation(point));
    assert.equal(result.offFrame, false, `${JSON.stringify(point)} must be in-frame`);
    assert.deepEqual(result.directions, []);
    assert.equal(result.point.x, point.x);
    assert.equal(result.point.y, point.y);
  }
});

test("presentation: the input object is never mutated", () => {
  const input = { x: -0.4, y: 1.7 };
  const snapshot = { ...input };
  const result = ok(resolveFloorHandlePresentation(input));
  assert.deepEqual(input, snapshot, "input must be untouched");
  assert.notEqual(result.point, input, "the result must not alias the input");
});

test("presentation: the returned result is deeply frozen", () => {
  const result = ok(resolveFloorHandlePresentation({ x: 1.5, y: -0.5 }));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.point), true);
  assert.equal(Object.isFrozen(result.directions), true);
  assert.throws(() => {
    (result.point as { x: number }).x = 0.5;
  }, TypeError);
});

test("presentation: non-finite or missing input fails closed with null", () => {
  assert.equal(resolveFloorHandlePresentation({ x: Number.NaN, y: 0.5 }), null);
  assert.equal(resolveFloorHandlePresentation({ x: 0.5, y: Number.NaN }), null);
  assert.equal(resolveFloorHandlePresentation({ x: Number.POSITIVE_INFINITY, y: 0.5 }), null);
  assert.equal(resolveFloorHandlePresentation({ x: 0.5, y: Number.NEGATIVE_INFINITY }), null);
  assert.equal(resolveFloorHandlePresentation(null), null);
  assert.equal(resolveFloorHandlePresentation(undefined), null);
});

// --- 2. Accessible labelling ------------------------------------------------

test("label: an in-frame handle keeps its existing label verbatim", () => {
  const presentation = ok(resolveFloorHandlePresentation({ x: 0.4, y: 0.4 }));
  assert.equal(describeFloorHandleAccessibleLabel(0, "NL", presentation), "Floor polygon handle 1");
  assert.equal(describeFloorHandleAccessibleLabel(3, "FL", presentation), "Floor polygon handle 4");
});

test("label: an off-frame handle names the corner, the proxy, and the direction", () => {
  const presentation = ok(resolveFloorHandlePresentation({ x: 0.4, y: 1.036709 }));
  const label = describeFloorHandleAccessibleLabel(0, "NL", presentation);
  assert.match(label, /Floor polygon handle 1/);
  assert.match(label, /\(NL\)/);
  assert.match(label, /off-frame boundary proxy/);
  assert.match(label, /below the visible frame/);
});

test("label: a diagonal off-frame handle names both directions", () => {
  const presentation = ok(resolveFloorHandlePresentation({ x: -0.2, y: 1.2 }));
  const label = describeFloorHandleAccessibleLabel(1, "NR", presentation);
  assert.match(label, /off-frame boundary proxy/);
  assert.match(label, /left of and below the visible frame/);
});

// --- 3. Required regression fixture: 1264x848 source in a 16:10 frame -------

const FIXTURE_INTRINSIC: ImageIntrinsicSize = { width: 1264, height: 848 };
const FIXTURE_FRAME: ImageFrameSize = { width: 1600, height: 1000 };

test("fixture: 1264x848 source corner y=1.0 projects truthfully to container y ~= 1.036709", () => {
  assert.ok(
    Math.abs(FIXTURE_FRAME.width / FIXTURE_FRAME.height - 1.6) < 1e-12,
    "the fixture frame must be 16:10"
  );
  const container = sourceNormToContainerNormUnclamped({ x: 0.5, y: 1 }, FIXTURE_INTRINSIC, FIXTURE_FRAME);
  assert.ok(container);
  assert.ok(
    Math.abs(container.y - 1.036709) < 1e-6,
    `expected container y ~= 1.036709, got ${container.y}`
  );
  assert.ok(container.y > 1, "the truthful corner is below the visible frame");
});

test("fixture: the presentation handle for that corner sits at y=1.0 and reports below", () => {
  const container = sourceNormToContainerNormUnclamped({ x: 0.5, y: 1 }, FIXTURE_INTRINSIC, FIXTURE_FRAME);
  assert.ok(container);
  const presentation = ok(resolveFloorHandlePresentation(container));
  assert.equal(presentation.offFrame, true);
  assert.equal(presentation.point.y, 1);
  assert.equal(presentation.point.x, container.x);
  assert.ok(presentation.directions.includes("below"));
});

test("fixture: the proxy restores handle reachability inside the 0..100 viewBox", () => {
  // The Floor overlay SVG is viewBox "0 0 100 100", so a handle drawn at the
  // truthful coordinate falls outside the drawable area and is clipped: that is
  // the access regression this hardening removes.
  const container = sourceNormToContainerNormUnclamped({ x: 0.5, y: 1 }, FIXTURE_INTRINSIC, FIXTURE_FRAME);
  assert.ok(container);
  const truthfulCy = container.y * 100;
  assert.ok(truthfulCy > 100, `truthful cy ${truthfulCy} is outside the viewBox and unreachable`);

  const presentation = ok(resolveFloorHandlePresentation(container));
  const proxyCy = presentation.point.y * 100;
  const proxyCx = presentation.point.x * 100;
  assert.equal(proxyCy, 100);
  assert.ok(proxyCy >= 0 && proxyCy <= 100, "the proxy cy is inside the viewBox");
  assert.ok(proxyCx >= 0 && proxyCx <= 100, "the proxy cx is inside the viewBox");
});

test("fixture: the truthful point still round trips to source y=1.0 through the authority transforms", () => {
  const source = { x: 0.5, y: 1 };
  const container = sourceNormToContainerNormUnclamped(source, FIXTURE_INTRINSIC, FIXTURE_FRAME);
  assert.ok(container);
  // The presentation proxy is derived but deliberately NOT substituted.
  const presentation = ok(resolveFloorHandlePresentation(container));
  assert.notEqual(presentation.point.y, container.y, "the proxy target differs from the truth");

  const restored = containerNormToSourceNormUnclamped(container, FIXTURE_INTRINSIC, FIXTURE_FRAME);
  assert.ok(restored);
  assert.ok(Math.abs(restored.y - 1) <= 1e-9, `expected source y=1.0, got ${restored.y}`);
  assert.ok(Math.abs(restored.x - source.x) <= 1e-9);
});

test("fixture: no presentation value reaches source state without an explicit pointer action", () => {
  const source: FloorPoint[] = [
    { x: 0.2, y: 1 },
    { x: 0.8, y: 1 },
    { x: 0.7, y: 0.55 },
    { x: 0.3, y: 0.55 },
  ];

  const container = source.map(
    (point) => sourceNormToContainerNormUnclamped(point, FIXTURE_INTRINSIC, FIXTURE_FRAME) as FloorPoint
  );
  const presentations = container.map((point) => ok(resolveFloorHandlePresentation(point)));
  assert.equal(presentations[0].offFrame, true);
  assert.equal(presentations[0].point.y, 1);

  // Merely rendering proxies must not disturb the authority round trip.
  const passiveSource = container.map(
    (point) => containerNormToSourceNormUnclamped(point, FIXTURE_INTRINSIC, FIXTURE_FRAME) as FloorPoint
  );
  for (let i = 0; i < source.length; i += 1) {
    assert.ok(Math.abs(passiveSource[i].x - source[i].x) <= 1e-9, `corner ${i} x undisturbed`);
    assert.ok(Math.abs(passiveSource[i].y - source[i].y) <= 1e-9, `corner ${i} y undisturbed`);
  }

  // An EXPLICIT pointer action on the proxy is allowed to pull that one corner
  // to the reachable boundary. The pointer conversion is already bounded to
  // [0,1], so this models updateFloorHandleFromClientPoint.
  const pointerPoint = { x: 0.22, y: 1 };
  const afterDrag = container.map((point, index) => (index === 0 ? pointerPoint : point));
  const draggedSource = afterDrag.map(
    (point) => containerNormToSourceNormUnclamped(point, FIXTURE_INTRINSIC, FIXTURE_FRAME) as FloorPoint
  );
  assert.ok(draggedSource[0].y < 1, "the explicitly dragged corner moved to the frame boundary");
  for (const index of [1, 2, 3]) {
    assert.ok(
      Math.abs(draggedSource[index].x - source[index].x) <= 1e-9 &&
        Math.abs(draggedSource[index].y - source[index].y) <= 1e-9,
      `untouched corner ${index} must remain lossless during an explicit drag of another corner`
    );
  }
});

test("fixture: the proxy does not reintroduce the 0.9166667 corruption", () => {
  // 4:3 in 16:10 is the shape that produced the original silent rewrite.
  const intrinsic: ImageIntrinsicSize = { width: 1600, height: 1200 };
  const frame: ImageFrameSize = { width: 1600, height: 1000 };
  const source: FloorPoint[] = [
    { x: 0.2, y: 1 },
    { x: 0.8, y: 1 },
    { x: 0.7, y: 0.55 },
    { x: 0.3, y: 0.55 },
  ];
  const container = source.map(
    (point) => sourceNormToContainerNormUnclamped(point, intrinsic, frame) as FloorPoint
  );
  // Rendering proxies for every corner, then editing only FR in container space.
  container.forEach((point) => ok(resolveFloorHandlePresentation(point)));
  const edited = container.map((point, index) => (index === 2 ? { x: 0.62, y: point.y } : point));
  const restored = edited.map(
    (point) => containerNormToSourceNormUnclamped(point, intrinsic, frame) as FloorPoint
  );

  assert.ok(Math.abs(restored[0].y - 1) <= 1e-9, "NL must remain at source y=1.0");
  assert.ok(
    Math.abs(restored[0].y - 1100 / 1200) > 1e-3,
    "NL must not collapse to the old 0.9166667 corrupted value"
  );
  assert.ok(Math.abs(restored[1].y - 1) <= 1e-9, "NR must remain at source y=1.0");
  assert.ok(Math.abs(restored[3].y - source[3].y) <= 1e-9, "FL must be untouched");
});

// --- 4. Containment / structural guards ------------------------------------

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_SOURCE = readFileSync(path.join(LAB_DIR, "ThreeRoomLab.tsx"), "utf8");
const HELPER_SOURCE = readFileSync(path.join(LAB_DIR, "floor-handle-presentation.ts"), "utf8");

/** Extracts the single <circle .../> element carrying the given key literal. */
function extractCircleElement(keyLiteral: string): string {
  const keyIndex = UI_SOURCE.indexOf(keyLiteral);
  assert.ok(keyIndex >= 0, `${keyLiteral} must exist in ThreeRoomLab.tsx`);
  const start = UI_SOURCE.lastIndexOf("<circle", keyIndex);
  const end = UI_SOURCE.indexOf("/>", keyIndex);
  assert.ok(start >= 0 && end > start, `${keyLiteral} must be a closed <circle> element`);
  return UI_SOURCE.slice(start, end + 2);
}

const BASE_HANDLE = extractCircleElement("key={`floor-handle-${index}`}");
const FOCUSED_HANDLE = extractCircleElement("key={`focused-floor-handle-${index}`}");

test("containment: the Floor polygon outline still uses the unmodified floorPolygon", () => {
  assert.ok(
    /const floorPolygonPointsAttribute = useMemo\(\s*\(\) => floorPolygon\.map\(\(point\) => `\$\{point\.x \* 100\},\$\{point\.y \* 100\}`\)\.join\(" "\),\s*\[floorPolygon\]\s*\);/.test(
      UI_SOURCE
    ),
    "the points attribute must be derived from raw floorPolygon coordinates"
  );
  // The outline is rendered in both the base and the focused edit layer.
  assert.equal((UI_SOURCE.match(/points=\{floorPolygonPointsAttribute\}/g) ?? []).length, 2);
  // The outline must never consume the presentation proxy.
  assert.ok(
    !/points=\{[^}]*floorHandlePresentations/.test(UI_SOURCE),
    "the polygon points attribute must not be built from presentation values"
  );
});

test("containment: both Floor handle layers use the shared presentation result", () => {
  assert.equal(
    (UI_SOURCE.match(/floorHandlePresentations\.map\(\(presentation, index\) =>/g) ?? []).length,
    2,
    "exactly two Floor handle layers must map the shared presentation array"
  );
  assert.ok(
    /const floorHandlePresentations = useMemo\(\s*\(\) => floorPolygon\.map\(\(point\) => resolveFloorHandlePresentation\(point\)\),\s*\[floorPolygon\]\s*\);/.test(
      UI_SOURCE
    ),
    "the shared presentation array must be a useMemo over floorPolygon"
  );
  assert.equal(
    (UI_SOURCE.match(/resolveFloorHandlePresentation\(/g) ?? []).length,
    1,
    "the helper must be called from exactly one place so both layers cannot diverge"
  );
});

test("containment: neither handle layer renders at a raw truthful coordinate", () => {
  for (const [name, block] of [
    ["base", BASE_HANDLE],
    ["focused", FOCUSED_HANDLE],
  ] as const) {
    assert.ok(/cx=\{presentation\.point\.x \* 100\}/.test(block), `${name}: cx must use the proxy target`);
    assert.ok(/cy=\{presentation\.point\.y \* 100\}/.test(block), `${name}: cy must use the proxy target`);
    assert.ok(!/cx=\{point\.x \* 100\}/.test(block), `${name}: cx must not use the raw point`);
    assert.ok(!/cy=\{point\.y \* 100\}/.test(block), `${name}: cy must not use the raw point`);
  }
});

test("containment: both layers preserve the corner index, pointer handler, and emphasis", () => {
  for (const [name, block] of [
    ["base", BASE_HANDLE],
    ["focused", FOCUSED_HANDLE],
  ] as const) {
    assert.ok(
      /onPointerDown=\{\(event\) => handleFloorHandlePointerDown\(index, event\)\}/.test(block),
      `${name}: the existing pointer-down handler and corner index must be preserved`
    );
    assert.ok(/r=\{2\.1\}/.test(block), `${name}: the handle radius must be unchanged`);
    assert.ok(
      /activeFloorHandleIndex === index \? "#f97316"/.test(block),
      `${name}: active-handle emphasis must be preserved`
    );
    assert.ok(
      /describeFloorHandleAccessibleLabel\(index, FLOOR_CORNER_LABELS\[index\]/.test(block),
      `${name}: the accessible label must be built from the original corner index`
    );
  }
});

test("containment: an off-frame proxy carries a non-color cue as well as a distinct color", () => {
  for (const [name, block] of [
    ["base", BASE_HANDLE],
    ["focused", FOCUSED_HANDLE],
  ] as const) {
    assert.ok(
      /strokeDasharray=\{presentation\.offFrame \? "1\.1 0\.8" : undefined\}/.test(block),
      `${name}: an off-frame proxy must be dashed`
    );
    assert.ok(
      /strokeWidth=\{presentation\.offFrame \? 0\.95 : 0\.75\}/.test(block),
      `${name}: an off-frame proxy must use a distinct stroke width`
    );
    assert.ok(
      /presentation\.offFrame \? "#a78bfa" : "#22d3ee"/.test(block),
      `${name}: an off-frame proxy must use a distinct colour`
    );
  }
});

/** Strips block and line comments so guards inspect code, not prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const HELPER_CODE = stripComments(HELPER_SOURCE);

test("containment: the presentation helper calls no setter and no authority transform", () => {
  assert.equal((HELPER_SOURCE.match(/^import\b/gm) ?? []).length, 0, "the helper must have no imports");
  for (const forbidden of [
    "setFloorPolygon",
    "setSourceNormalizedFloorPolygon",
    "applyContainerFloorPolygon",
    "containerNormToSourceNorm",
    "sourceNormToContainerNorm",
    "normToPixels",
    "useState",
    "useMemo",
    "provider",
    "compositor",
    "research",
    "capture",
    "react",
  ]) {
    assert.ok(!HELPER_CODE.includes(forbidden), `the helper code must not reference ${forbidden}`);
  }
});

test("containment: no presentation value is written into Floor authority state", () => {
  assert.ok(
    !/set[A-Z]\w*\([^)]*floorHandlePresentations/.test(UI_SOURCE),
    "no setter may consume the presentation array"
  );
  assert.ok(
    !/applyContainerFloorPolygon\([^)]*presentation/.test(UI_SOURCE),
    "the Floor writer must not consume a presentation value"
  );
  // The Floor writer still receives the raw pointer-derived polygon.
  assert.ok(
    /applyContainerFloorPolygon\(\s*floorPolygon\.map\(\(point, index\) => \(index === activeIndex \? normalizedPoint : point\)\),/.test(
      UI_SOURCE
    ),
    "the explicit pointer path must still write the raw pointer point"
  );
});

test("containment: floorPolygon state is not clamped and the pointer bound is unchanged", () => {
  assert.ok(
    /const \[floorPolygon, setFloorPolygon\] = useState/.test(UI_SOURCE),
    "floorPolygon must remain plain state"
  );
  assert.ok(
    !/setFloorPolygon\([^)]*clamp/i.test(UI_SOURCE),
    "no clamp may be introduced into floorPolygon writes"
  );
  assert.ok(
    /x: clampValue\(\(clientX - rect\.left\) \/ rect\.width, 0, 1\),/.test(UI_SOURCE),
    "the pointer conversion must remain bounded to [0,1]"
  );
});

test("containment: no solver caller and no scene schema changed", () => {
  assert.equal(SCENE_STATE_SCHEMA_VERSION, "vibode-3d-room-lab-scene-state/v1");
  assert.ok(
    /const pixels = normToPixels\(point, frameSize\);/.test(UI_SOURCE),
    "quad solvability must still use the clamped normToPixels"
  );
  assert.ok(!/normToPixelsUnclamped/.test(UI_SOURCE), "no solver caller may switch to the unclamped helper");
});

test("containment: image-space documents all three sanctioned unclamped call sites", () => {
  const imageSpace = readFileSync(path.join(LAB_DIR, "image-space.ts"), "utf8");
  assert.ok(/Truthful authority-derived geometry projection/.test(imageSpace));
  assert.ok(/Ordinary UI-safe overlays/.test(imageSpace));
  assert.ok(/Presentation-only proxy handles/.test(imageSpace));
  assert.ok(
    !/It must NOT be used for UI\/manual overlay conversion/.test(imageSpace),
    "the superseded prohibition must be removed"
  );
});
