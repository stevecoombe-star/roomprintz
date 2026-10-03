import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  selectionTransformSessionAfterBodyDrag,
  selectionTransformSessionAfterChange,
} from "./selection-transform-session";

test("the same object keeps Rotate", () => {
  const next = selectionTransformSessionAfterChange({
    objectId: "chair",
    transformMode: "rotate",
    toolbarSlider: "rotate",
  }, "chair");
  assert.equal(next.transformMode, "rotate");
  assert.equal(next.toolbarSlider, "rotate");
  assert.equal(next.objectId, "chair");
});

test("the same object keeps Size", () => {
  const next = selectionTransformSessionAfterChange({
    objectId: "chair",
    transformMode: "move",
    toolbarSlider: "size",
  }, "chair");
  assert.equal(next.transformMode, "move");
  assert.equal(next.toolbarSlider, "size");
});

test("clearing the selection ends the Rotate or Size session", () => {
  const fromRotate = selectionTransformSessionAfterChange({
    objectId: "chair",
    transformMode: "rotate",
    toolbarSlider: "rotate",
  }, null);
  assert.equal(fromRotate.objectId, null);
  assert.equal(fromRotate.transformMode, "move");
  assert.equal(fromRotate.toolbarSlider, null);

  const fromSize = selectionTransformSessionAfterChange({
    objectId: "chair",
    transformMode: "move",
    toolbarSlider: "size",
  }, null);
  assert.equal(fromSize.transformMode, "move");
  assert.equal(fromSize.toolbarSlider, null);
});

test("selecting a different object starts in Move", () => {
  const fromRotate = selectionTransformSessionAfterChange({
    objectId: "chair",
    transformMode: "rotate",
    toolbarSlider: "rotate",
  }, "table");
  assert.equal(fromRotate.objectId, "table");
  assert.equal(fromRotate.transformMode, "move");
  assert.equal(fromRotate.toolbarSlider, null);

  const fromSize = selectionTransformSessionAfterChange({
    objectId: "chair",
    transformMode: "move",
    toolbarSlider: "size",
  }, "table");
  assert.equal(fromSize.transformMode, "move");
  assert.equal(fromSize.toolbarSlider, null);
});

test("a selection after none starts in Move", () => {
  const next = selectionTransformSessionAfterChange({
    objectId: null,
    transformMode: "rotate",
    toolbarSlider: "rotate",
  }, "chair");
  assert.equal(next.objectId, "chair");
  assert.equal(next.transformMode, "move");
  assert.equal(next.toolbarSlider, null);
});

test("Move stays Move when the selection changes", () => {
  const cleared = selectionTransformSessionAfterChange({
    objectId: "chair",
    transformMode: "move",
    toolbarSlider: null,
  }, null);
  assert.equal(cleared.transformMode, "move");
  assert.equal(cleared.toolbarSlider, null);

  const switched = selectionTransformSessionAfterChange({
    objectId: "chair",
    transformMode: "move",
    toolbarSlider: null,
  }, "table");
  assert.equal(switched.transformMode, "move");
  assert.equal(switched.toolbarSlider, null);

  const opened = selectionTransformSessionAfterChange(cleared, "chair");
  assert.equal(opened.transformMode, "move");
  assert.equal(opened.toolbarSlider, null);
});

test("delete and duplicate follow the same Move default", () => {
  const deleted = selectionTransformSessionAfterChange({
    objectId: "chair",
    transformMode: "rotate",
    toolbarSlider: "rotate",
  }, null);
  assert.equal(deleted.transformMode, "move");
  const duplicated = selectionTransformSessionAfterChange({
    objectId: "chair",
    transformMode: "move",
    toolbarSlider: "size",
  }, "chair-copy");
  assert.equal(duplicated.objectId, "chair-copy");
  assert.equal(duplicated.transformMode, "move");
  assert.equal(duplicated.toolbarSlider, null);
});

test("the stage editor applies the rule from the scene selection id", () => {
  const source = readFileSync("components/stage/StageEditorContext.tsx", "utf8");
  assert.match(source, /selectionTransformSessionAfterChange/);
  assert.match(source, /selectionTransformSessionAfterTranslation/);
  assert.match(source, /session\?\.selectedObjectId/);
  const viewer = readFileSync("components/afc-3d/AfcProductionRoomViewer.tsx", "utf8");
  assert.doesNotMatch(viewer, /selectionTransformSessionAfterChange/);
  assert.match(viewer, /bodyDragSampleTranslatedObject/);
  assert.match(viewer, /if \(session\.translated\) \{\s*onSelectedObjectTranslatedRef\.current\?\.\(session\.objectId\)/);
  const rotationCommit = viewer.slice(
    viewer.indexOf("commitRotationYDeg:"),
    viewer.indexOf("commitUserSizeMultiplier:"),
  );
  const sizeCommit = viewer.slice(
    viewer.indexOf("commitUserSizeMultiplier:"),
    viewer.indexOf("commitUserSizeMultiplier:") + 600,
  );
  assert.doesNotMatch(rotationCommit, /onSelectedObjectTranslatedRef/);
  assert.doesNotMatch(sizeCommit, /onSelectedObjectTranslatedRef/);
  assert.match(
    readFileSync("components/afc-3d/AfcIntegratedEditorViewport.tsx", "utf8"),
    /onSelectedObjectTranslated=\{stage\?\.noteSelectedObjectTranslated\}/,
  );
});

const still = { x: 1, z: 2 };
const moved = { x: 1.4, z: 2.2 };

test("Rotate plus a real translation ends in Move", () => {
  const next = selectionTransformSessionAfterBodyDrag({
    objectId: "chair",
    transformMode: "rotate",
    toolbarSlider: "rotate",
  }, "chair", [
    { kind: "translate", before: still, after: moved },
  ]);
  assert.equal(next.objectId, "chair");
  assert.equal(next.transformMode, "move");
  assert.equal(next.toolbarSlider, null);
});

test("Size plus a real translation ends in Move", () => {
  const next = selectionTransformSessionAfterBodyDrag({
    objectId: "chair",
    transformMode: "move",
    toolbarSlider: "size",
  }, "chair", [
    { kind: "translate", before: still, after: moved },
  ]);
  assert.equal(next.objectId, "chair");
  assert.equal(next.transformMode, "move");
  assert.equal(next.toolbarSlider, null);
});

test("a Rotate sample without translation stays in Rotate", () => {
  const next = selectionTransformSessionAfterBodyDrag({
    objectId: "chair",
    transformMode: "rotate",
    toolbarSlider: "rotate",
  }, "chair", [
    { kind: "shift-rotate", before: still, after: still },
  ]);
  assert.equal(next.transformMode, "rotate");
  assert.equal(next.toolbarSlider, "rotate");
});

test("a Size sample without translation stays in Size", () => {
  const next = selectionTransformSessionAfterBodyDrag({
    objectId: "chair",
    transformMode: "move",
    toolbarSlider: "size",
  }, "chair", []);
  assert.equal(next.transformMode, "move");
  assert.equal(next.toolbarSlider, "size");
});

test("a click or no-op drag does not change the mode", () => {
  const rotate = selectionTransformSessionAfterBodyDrag({
    objectId: "chair",
    transformMode: "rotate",
    toolbarSlider: "rotate",
  }, "chair", [
    { kind: "translate", before: still, after: still },
    { kind: "translate", before: still, after: { x: still.x + 0.0004, z: still.z } },
  ]);
  assert.equal(rotate.transformMode, "rotate");
  assert.equal(rotate.toolbarSlider, "rotate");
});

test("a settled Push-to-Align hold is not a later translation", () => {
  const next = selectionTransformSessionAfterBodyDrag({
    objectId: "chair",
    transformMode: "rotate",
    toolbarSlider: "rotate",
  }, "chair", [
    { kind: "push-align", before: { x: 0.2, z: 0 }, after: { x: 0.5, z: 0 } },
    { kind: "translate", before: { x: 0.5, z: 0 }, after: { x: 0.5, z: 0 } },
  ]);
  assert.equal(next.transformMode, "rotate");
  assert.equal(next.toolbarSlider, "rotate");
});

test("Shift-rotate and Push-to-Align rotation do not return to Move", () => {
  const shift = selectionTransformSessionAfterBodyDrag({
    objectId: "chair",
    transformMode: "move",
    toolbarSlider: "size",
  }, "chair", [
    { kind: "shift-rotate", before: still, after: { x: 3, z: 4 } },
  ]);
  assert.equal(shift.toolbarSlider, "size");

  const aligned = selectionTransformSessionAfterBodyDrag({
    objectId: "chair",
    transformMode: "rotate",
    toolbarSlider: "rotate",
  }, "chair", [
    { kind: "push-align", before: { x: 0.2, z: 0 }, after: { x: 0.5, z: -0.3 } },
  ]);
  assert.equal(aligned.transformMode, "rotate");
  assert.equal(aligned.toolbarSlider, "rotate");
});
