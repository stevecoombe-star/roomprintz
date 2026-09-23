import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  EMPTY_BOUND_SCENE_OBJECTS,
  nextBoundScene,
} from "@/lib/vibode-stage/bound-scene";

import { containFitRect, nextFrameBox } from "./frame-layout";
import { createPi4bSceneObjectDefinitions } from "./furniture-runtime";

const ROOT = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("PI-5B-FIX1 rebinding a logically unchanged scene keeps the same BoundScene", () => {
  const undo = () => undefined;
  const emptyIncoming = {
    objects: [] as const,
    canUndo: false,
    undo,
  };
  const initial = {
    objects: EMPTY_BOUND_SCENE_OBJECTS,
    canUndo: false,
    undo,
  };

  const first = nextBoundScene(initial, emptyIncoming);
  assert.equal(first, initial);

  const second = nextBoundScene(first, {
    objects: [],
    canUndo: false,
    undo,
  });
  assert.equal(second, first);

  const furniture = createPi4bSceneObjectDefinitions();
  const loaded = nextBoundScene(first, {
    objects: furniture,
    canUndo: false,
    undo,
  });
  assert.equal(loaded.objects, furniture);
  assert.notEqual(loaded, first);

  const rebound = nextBoundScene(loaded, {
    objects: furniture,
    canUndo: false,
    undo,
  });
  assert.equal(rebound, loaded);

  const afterUndo = nextBoundScene(loaded, {
    objects: furniture,
    canUndo: true,
    undo,
  });
  assert.equal(afterUndo.canUndo, true);
  assert.notEqual(afterUndo, loaded);
});

test("PI-5B-FIX1 unbound persisted objects keep a stable empty identity", () => {
  const hook = source("lib/afc-v2-runtime/use-persisted-3d-scene.ts");
  assert.match(hook, /export const EMPTY_PERSISTED_SCENE_OBJECTS/);
  assert.match(
    hook,
    /objects: sceneReady \? objects : EMPTY_PERSISTED_SCENE_OBJECTS/,
  );
  assert.doesNotMatch(hook, /objects: sceneReady \? objects : \[\]/);
});

test("PI-5B-FIX1 unchanged measured frame geometry keeps the same frameBox", () => {
  const firstRect = containFitRect(1600, 900, 1200, 800);
  assert.ok(firstRect);
  const first = nextFrameBox(null, firstRect);
  assert.equal(first.width, firstRect.width);
  assert.equal(first.height, firstRect.height);
  assert.equal(first.left, firstRect.left);
  assert.equal(first.top, firstRect.top);

  const remeasured = containFitRect(1600, 900, 1200, 800);
  assert.ok(remeasured);
  assert.notEqual(remeasured, first);
  const second = nextFrameBox(first, remeasured);
  assert.equal(second, first);
  assert.equal(second.width, firstRect.width);
  assert.equal(second.height, firstRect.height);

  const changed = containFitRect(1200, 1200, 1200, 800);
  assert.ok(changed);
  const third = nextFrameBox(first, changed);
  assert.equal(third, changed);
  assert.notEqual(third, first);
  assert.equal(third.width, changed.width);
  assert.equal(third.height, changed.height);
  assert.equal(third.left, changed.left);
  assert.equal(third.top, changed.top);
});

test("PI-5B-FIX1 wires idempotent scene bind and frameBox updates", () => {
  const context = source("components/stage/StageEditorContext.tsx");
  const boundScene = source("lib/vibode-stage/bound-scene.ts");
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const viewport = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  const frameLayout = source("lib/afc-v2-runtime/frame-layout.ts");

  assert.match(context, /nextBoundScene\(current, scene\)/);
  assert.match(viewer, /nextFrameBox\(current, rect\)/);
  assert.match(viewer, /containFitRect\(/);
  assert.match(
    viewer,
    /\}, \[authority\.generationId, furniture\.objectId, furniture\.transform, world\]\);/,
  );
  assert.match(viewport, /bindScene\?\.\(\{/);
  assert.match(viewport, /objects: persistedScene\.objects/);
  assert.match(viewport, /canUndo: persistedScene\.canUndo/);
  assert.match(viewport, /undo: persistedScene\.undo/);
  assert.doesNotMatch(boundScene, /JSON\.stringify/);
  assert.doesNotMatch(frameLayout, /JSON\.stringify/);
});
