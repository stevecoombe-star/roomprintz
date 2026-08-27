import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import RoomLabV2, { formatSelectedModelHeading } from "./RoomLabV2";
import {
  addTestCube,
  createInitialSceneLayerState,
  deleteSelectedSceneObject,
  getSelectedSceneObject,
  resetSceneObjectTransform,
  setViewportTransformMode,
  updateSelectedPositionAxis,
} from "./scene-layer-state";

const V2_DIRECTORY = path.join(process.cwd(), "app/admin/3d-room-lab-v2");

function read(fileName: string): string {
  return readFileSync(path.join(V2_DIRECTORY, fileName), "utf8");
}

const roomLabSource = read("RoomLabV2.tsx");
const viewerSource = read("CalibratedRoomViewer.tsx");
const interactionSource = read("scene-viewport-interaction.ts");
const sceneLayerSource = read("scene-layer-state.ts");

function workspaceColumnSource(): string {
  return roomLabSource.slice(
    roomLabSource.indexOf('aria-label="AFC v2 workspace"'),
    roomLabSource.indexOf('aria-label="AFC architecture status"'),
  );
}

function asideColumnSource(): string {
  return roomLabSource.slice(
    roomLabSource.indexOf('aria-label="AFC architecture status"'),
  );
}

function selectedModelSource(): string {
  const aside = asideColumnSource();
  const start = aside.indexOf("aria-expanded={selectedModelExpanded}");
  const end = aside.indexOf("Room Boundaries");
  assert.ok(start >= 0 && end > start);
  return aside.slice(start, end);
}

test("Scene / Models renders once, in the main viewport column", () => {
  const markup = renderToStaticMarkup(createElement(RoomLabV2));
  const viewerIdx = markup.indexOf('role="tabpanel"');
  const sceneIdx = markup.indexOf("Scene / Models");
  const asideIdx = markup.indexOf("AFC architecture status");
  const selectedIdx = markup.indexOf("Selected Model — None");

  assert.ok(viewerIdx >= 0);
  assert.ok(sceneIdx > viewerIdx);
  assert.ok(asideIdx > sceneIdx);
  assert.ok(selectedIdx > asideIdx);
  assert.equal([...markup.matchAll(/Scene \/ Models/g)].length, 1);

  const main = workspaceColumnSource();
  const aside = asideColumnSource();
  assert.match(main, /Scene \/ Models/);
  assert.match(main, /viewerRef/);
  assert.doesNotMatch(aside, /Scene \/ Models/);
  assert.match(aside, /formatSelectedModelHeading/);
});

test("Move / Rotate / Scale remain in Scene / Models and still set transform mode", () => {
  const markup = renderToStaticMarkup(createElement(RoomLabV2));
  assert.match(markup, />Move</);
  assert.match(markup, />Rotate</);
  assert.match(markup, />Scale</);

  const main = workspaceColumnSource();
  assert.match(
    main,
    /mode === "move" \? "Move" : mode === "rotate" \? "Rotate" : "Scale"/,
  );
  assert.match(
    main,
    /setViewportTransformMode\(current, mode\)/,
  );
  assert.match(
    main,
    /aria-pressed=\{sceneLayer\.transformMode === mode\}/,
  );

  let state = addTestCube(createInitialSceneLayerState());
  assert.equal(state.transformMode, "move");
  state = setViewportTransformMode(state, "rotate");
  assert.equal(state.transformMode, "rotate");
  state = setViewportTransformMode(state, "scale");
  assert.equal(state.transformMode, "scale");
  assert.equal(state.selectedObjectId, state.objects[0]?.id);
});

test("Reset Transform and Delete Object live in Scene / Models, not Selected Model", () => {
  const markup = renderToStaticMarkup(createElement(RoomLabV2));
  assert.doesNotMatch(markup, /Reset Transform/);
  assert.doesNotMatch(markup, /Delete Object/);

  const main = workspaceColumnSource();
  const selected = selectedModelSource();
  assert.match(main, /Reset Transform/);
  assert.match(main, /Delete Object/);
  assert.match(main, /onClick=\{handleResetSelectedTransform\}/);
  assert.match(main, /onClick=\{handleDeleteSelectedObject\}/);
  assert.match(
    main,
    /\{selectedSceneObject \? \([\s\S]*Reset Transform[\s\S]*Delete Object[\s\S]*\) : null\}/,
  );
  assert.doesNotMatch(selected, /Reset Transform/);
  assert.doesNotMatch(selected, /Delete Object/);
  assert.match(
    roomLabSource,
    /function handleResetSelectedTransform\(\) \{\s*setSceneLayer\(\(current\) => resetSceneObjectTransform\(current\)\);/,
  );
  assert.match(
    roomLabSource,
    /const next = deleteSceneObject\(current, selected\.id\);/,
  );
});

test("Selected Model defaults collapsed and keeps selection identity in the header", () => {
  const markup = renderToStaticMarkup(createElement(RoomLabV2));
  assert.equal(formatSelectedModelHeading(null), "Selected Model — None");
  assert.equal(
    formatSelectedModelHeading("Chair.glb"),
    "Selected Model — Chair.glb",
  );
  assert.match(markup, /Selected Model — None/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /▸/);
  assert.doesNotMatch(markup, /▾/);
  assert.doesNotMatch(markup, /label="Uniform"|Uniform<\/span>|Uniform/);
  assert.doesNotMatch(markup, /No selected model/);

  assert.match(
    roomLabSource,
    /const \[selectedModelExpanded, setSelectedModelExpanded\] = useState\(false\)/,
  );
  assert.match(
    roomLabSource,
    /onClick=\{\(\) =>\s*setSelectedModelExpanded\(\(open\) => !open\)/,
  );
  assert.match(
    roomLabSource,
    /\{selectedModelExpanded \? "▾" : "▸"\}/,
  );

  const selected = selectedModelSource();
  const header = selected.slice(
    0,
    selected.indexOf("selectedModelExpanded ? ("),
  );
  const details = selected.slice(selected.indexOf("selectedModelExpanded ? ("));
  assert.match(header, /formatSelectedModelHeading/);
  assert.match(header, /aria-expanded=\{selectedModelExpanded\}/);
  assert.doesNotMatch(header, /TransformControlRow/);
  assert.match(details, /TransformControlRow/);
  assert.match(details, /updateSelectedPositionAxis/);
  assert.match(details, /updateSelectedRotationAxis/);
  assert.match(details, /updateSelectedUniformScale/);
  assert.match(details, /label="Uniform"/);
});

test("Reset and Delete still operate on the current selection only", () => {
  let state = addTestCube(createInitialSceneLayerState());
  const id = state.selectedObjectId;
  state = updateSelectedPositionAxis(state, "x", 2);
  state = resetSceneObjectTransform(state);
  assert.equal(state.selectedObjectId, id);
  assert.equal(getSelectedSceneObject(state)?.transform.position.x, 0);

  state = addTestCube(state);
  const remainingId = state.objects[0]!.id;
  state = deleteSelectedSceneObject(state);
  assert.equal(state.objects.length, 1);
  assert.equal(state.objects[0]?.id, remainingId);
  assert.equal(state.selectedObjectId, null);
});

test("layout polish does not change viewport interaction, clamp, or persistence contracts", () => {
  assert.match(viewerSource, /TransformControls/);
  assert.match(viewerSource, /grabPlaneY/);
  assert.match(viewerSource, /applyPlacementWorldPosition/);
  assert.match(interactionSource, /SCENE_SELECTION_POINTER_SLOP_PX/);
  assert.match(sceneLayerSource, /CALIBRATED_FLOOR_PLANE_Y/);
  assert.match(sceneLayerSource, /resetSceneObjectTransform/);
  assert.match(sceneLayerSource, /deleteSceneObject/);
  assert.match(roomLabSource, /URL\.createObjectURL/);
  assert.match(roomLabSource, /URL\.revokeObjectURL/);
  assert.doesNotMatch(viewerSource, /revokeObjectURL|createObjectURL/);
  assert.doesNotMatch(roomLabSource, /FULLY_TILED/);
  assert.match(roomLabSource, /Final world geometry is deferred to V2-S4/);
});
