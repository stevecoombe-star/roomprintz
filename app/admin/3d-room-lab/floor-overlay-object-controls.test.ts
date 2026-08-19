import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./ThreeRoomLab.tsx", import.meta.url), "utf8");

function between(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `expected source region ${startMarker} through ${endMarker}`);
  return source.slice(start, end);
}

const sharedOverlay = between(
  '<svg\n              ref={floorOverlayRef}',
  "{afcMainViewportProjection.kind === \"projected\" ?"
);
const calibratedControls = between(
  "{showCalibratedObjectControls &&",
  "{isObject2DHandlesEffectivelyEnabled && lastAcceptedFloorClick && ("
);
const calibratedMove = between(
  "if (calibratedMoveDragPointerIdRef.current === event.pointerId) {",
  "if (calibratedRotateDragPointerIdRef.current === event.pointerId) {"
);
const clickToPlace = between(
  "const handleFloorOverlayPointerDown =",
  "const handleFloorAnchorPointerDown ="
);
const legacyAnchor = between(
  "{isFloorAnchorDragEffectivelyEnabled && lastAcceptedFloorClick && (",
  '{objectTransformMode === "support_attached_current"'
);

test("the interactive shared SVG remains mounted when Floor presentation is hidden", () => {
  assert.match(sharedOverlay, /<svg\s+ref=\{floorOverlayRef\}/);
  assert.match(sharedOverlay, /onPointerMove=\{handleFloorOverlayPointerMove\}/);
  assert.match(sharedOverlay, /onPointerUp=\{stopFloorHandleDrag\}/);
  assert.match(sharedOverlay, /onLostPointerCapture=\{stopFloorHandleDrag\}/);
  assert.doesNotMatch(
    source,
    /\{showFloorOverlay && \(\s*<svg\s+ref=\{floorOverlayRef\}/,
    "Floor visibility must not conditionally mount the interactive SVG"
  );
});

test("Floor presentation gates hide only the Floor polygon and its edit handles", () => {
  assert.match(
    sharedOverlay,
    /\{showFloorOverlay && \(\s*<polygon\s+points=\{floorPolygonPointsAttribute\}/
  );
  assert.match(
    sharedOverlay,
    /\{showFloorOverlay && !supportEditInteractionStates\.floor\.focused && floorHandlePresentations\.map/
  );
  assert.match(sharedOverlay, /if \(kind === "floor" && !showFloorOverlay\) return null;/);
});

test("the four-state matrix keeps object controls independent from Floor presentation", () => {
  assert.match(
    source,
    /const \[isObject2DHandlesEnabled, setIsObject2DHandlesEnabled\] = useState\(true\);/
  );
  assert.match(
    source,
    /const showCalibratedObjectControls =\s*isObject2DHandlesEnabled && isCalibratedCameraActive && objectTransformMode === "detached";/
  );

  const evaluate = (floorVisible: boolean, objectControlsVisible: boolean) => ({
    floorVisible,
    objectControlsVisible,
  });
  assert.deepEqual(evaluate(true, true), { floorVisible: true, objectControlsVisible: true });
  assert.deepEqual(evaluate(false, true), { floorVisible: false, objectControlsVisible: true });
  assert.deepEqual(evaluate(true, false), { floorVisible: true, objectControlsVisible: false });
  assert.deepEqual(evaluate(false, false), { floorVisible: false, objectControlsVisible: false });
});

test("all calibrated handles depend on object controls, not Floor presentation", () => {
  for (const availability of [
    "calibratedMoveHandleStatus.available",
    "calibratedRotateHandleStatus.available",
    "calibratedScaleHandleStatus.available",
    "calibratedLiftHandleStatus.available",
  ]) {
    assert.match(
      calibratedControls,
      new RegExp(`showCalibratedObjectControls &&\\s*${availability.replace(".", "\\.")}`)
    );
  }
  assert.doesNotMatch(calibratedControls, /showFloorOverlay/);
});

test("legacy handles retain their uncalibrated and detached eligibility", () => {
  assert.match(
    source,
    /const isObject2DHandlesEffectivelyEnabled =\s*isObject2DHandlesEnabled && !isCalibratedCameraActive && !objectSupportAttachment;/
  );
});

test("calibrated controls-off hides the legacy anchor while legacy anchor drag remains available", () => {
  assert.match(
    source,
    /const isFloorAnchorDragEffectivelyEnabled = isFloorAnchorDragEnabled && !isCalibratedCameraActive;/
  );
  assert.match(legacyAnchor, /aria-label="Object floor anchor marker"/);
  assert.match(
    legacyAnchor,
    /pointerEvents=\{isFloorAnchorDragEffectivelyEnabled \? "all" : "none"\}/
  );

  const evaluate = (calibrated: boolean, objectControls: boolean, legacyAnchorDrag: boolean) => ({
    calibratedHandles: calibrated && objectControls,
    legacyAnchor: !calibrated && legacyAnchorDrag,
  });
  assert.deepEqual(evaluate(true, false, true), { calibratedHandles: false, legacyAnchor: false });
  assert.deepEqual(evaluate(true, true, true), { calibratedHandles: true, legacyAnchor: false });
  assert.deepEqual(evaluate(false, true, true), { calibratedHandles: false, legacyAnchor: true });
});

test("Floor-hidden object interaction preserves calibrated MOVE and inert background clicks", () => {
  assert.match(calibratedMove, /intersectOverlayRayWithFloorPlane\(normalizedPoint, cameraRef\.current, 0\)/);
  assert.match(
    calibratedMove,
    /applyPlacementConstraint\(DEFAULT_PLACEMENT_CONSTRAINT, \{\s*x: nextX,\s*z: nextZ,\s*\}\)/
  );
  assert.match(calibratedMove, /updateTransformState\(/);
  assert.match(clickToPlace, /if \(!showFloorOverlay \|\| !isFloorClickPlacementEnabled\) return;/);
});

test("visibility wiring contains no Floor, camera, TILED, or placement-authority mutation", () => {
  const visibilityWiring = `${sharedOverlay}\n${calibratedControls}`;
  for (const forbidden of [
    "setFloorPolygon",
    "setSourceNormalizedFloorPolygon",
    "applySourceNormalizedFloorPolygon",
    "commitFloorAuthorityMutation",
    "setCalibratedCameraSnapshot",
    "setCameraPoseFovYDeg",
    "realizeAfcLabGeometry",
    "applyPlacementConstraint(",
  ]) {
    assert.equal(visibilityWiring.includes(forbidden), false, `${forbidden} must not be part of visibility wiring`);
  }
});
