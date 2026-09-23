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

const calibratedMove = between(
  "if (calibratedMoveDragPointerIdRef.current === event.pointerId) {",
  "if (calibratedRotateDragPointerIdRef.current === event.pointerId) {"
);
const legacyObjectMove = between(
  'if (activeObjectHandleMode === "move" && objectHandleDragPointerIdRef.current === event.pointerId) {',
  "if (calibratedMoveDragPointerIdRef.current === event.pointerId) {"
);
const floorAnchorDrag = between(
  "if (!isFloorAnchorDragActive || floorAnchorDragPointerIdRef.current !== event.pointerId) return;",
  "const handleFloorOverlayPointerDown ="
);
const clickToPlace = between(
  "const handleFloorOverlayPointerDown =",
  "const handleFloorAnchorPointerDown ="
);
const applyFloorPlacement = between(
  "const applyFloorPlacement =",
  "const updateFloorHandleFromClientPoint ="
);
const afcRealization = between(
  "const realizeAfcLabGeometry =",
  "const handleApplyRoomCAfcLab ="
);
const sceneConstruction = between(
  "const placementGroup = new THREE.Group();",
  "const animate = () =>"
);

test("calibrated MOVE applies unbounded world-XZ policy after ray and off-screen guards", () => {
  assert.match(calibratedMove, /intersectOverlayRayWithFloorPlane\(normalizedPoint, cameraRef\.current, 0\)/);
  assert.match(calibratedMove, /projectWorldPointToOverlayNormalized\(cameraRef\.current, frameSize/);
  assert.match(
    calibratedMove,
    /applyPlacementConstraint\(DEFAULT_PLACEMENT_CONSTRAINT, \{\s*x: nextX,\s*z: nextZ,\s*\}\)/
  );
  assert.match(
    calibratedMove,
    /updateTransformState\(\(prev\) => \(\{\s*\.\.\.prev,\s*positionX: placementResult\.positionXZ\.x,\s*positionZ: placementResult\.positionXZ\.z/
  );
  assert.ok(
    calibratedMove.indexOf("floor-contact projection is off-screen") <
      calibratedMove.indexOf("applyPlacementConstraint("),
    "the existing visible photo-frame guard must remain before policy evaluation"
  );
  assert.doesNotMatch(calibratedMove, /isPointInsidePolygon|floorPolygon/);
});

test("object MOVE does not invoke AFC, camera, Floor authority, or provider work", () => {
  for (const forbidden of [
    "realizeAfcLabGeometry",
    "settleAfcFixedSeamCalibration",
    "setCameraPoseFovYDeg",
    "applySourceNormalizedFloorPolygon",
    "commitFloorAuthorityMutation",
    "fetch(",
    "callCompositor",
  ]) {
    assert.equal(calibratedMove.includes(forbidden), false, `${forbidden} must not run during calibrated MOVE`);
  }
});

test("legacy detached placement gates share the world-XZ policy instead of the Floor polygon", () => {
  for (const path of [legacyObjectMove, floorAnchorDrag, clickToPlace]) {
    assert.match(path, /applyFloorPlacement\(/);
    assert.doesNotMatch(path, /isPointInsidePolygon|floorPolygon/);
  }
  assert.match(
    applyFloorPlacement,
    /applyPlacementConstraint\(DEFAULT_PLACEMENT_CONSTRAINT, \{\s*x: mapped\.positionX,\s*z: mapped\.positionZ,\s*\}\)/
  );
  assert.match(applyFloorPlacement, /updateTransformState\(/);
  assert.doesNotMatch(applyFloorPlacement, /setFloorMapping|applySourceNormalizedFloorPolygon|commitFloorAuthorityMutation/);
});

test("cube and GLB retain the shared detached placement and ground-contact hierarchy", () => {
  assert.match(
    sceneConstruction,
    /modelNormalizationGroup\.add\(autoBoundsGroup\);[\s\S]*placementGroup\.add\(modelNormalizationGroup\);/
  );
  assert.match(sceneConstruction, /const setActiveObject = \(object: THREE\.Object3D, kind: ActiveObjectKind\) =>/);
  assert.match(sceneConstruction, /autoBoundsGroup\.add\(object\);/);
  assert.match(sceneConstruction, /setActiveObject\(cube, "fallback"\);/);
  assert.match(sceneConstruction, /setActiveObject\(gltf\.scene, "gltf"\);/);
});

test("AFC realization does not rewrite the detached transform", () => {
  assert.doesNotMatch(afcRealization, /updateTransformState|setTransform\(|transformRef\.current/);
});
