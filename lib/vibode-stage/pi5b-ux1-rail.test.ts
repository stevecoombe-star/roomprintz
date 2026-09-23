import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { editorRightPanelSurface } from "@/lib/afc-v2-runtime/editor-viewport-mode";
import {
  addSceneObject,
  deleteSceneObject,
  duplicateSceneObject,
} from "@/lib/afc-v2-runtime/scene-crud";
import {
  AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
  clampUserSizeMultiplier,
} from "@/lib/afc-v2-runtime/types";
import { wrapSceneRotationDeg } from "@/lib/afc-v2-runtime/viewport-interaction";
import { nextBoundScene } from "@/lib/vibode-stage/bound-scene";
import { containFitRect, nextFrameBox } from "@/lib/afc-v2-runtime/frame-layout";
import {
  STAGE_CANVAS_HEIGHT_CLASS,
  STAGE_CANVAS_WIDTH_CLASS,
} from "./types";
import { stageDrawerLayout } from "./drawer-state";

const ROOT = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("PI-5B-UX1 production STAGE 3D does not render the legacy right rail", () => {
  const editor = source("app/editor/page.tsx");
  assert.doesNotMatch(editor, /<Editor3dModePanel/);
  assert.doesNotMatch(
    editor,
    /data-editor-right-panel-surface=\{viewportMode === "3d"/,
  );
  assert.equal(editorRightPanelSurface("3d"), "none");
  assert.equal(editorRightPanelSurface("2d"), "workflow");
  assert.match(editor, /editorRightPanelSurface\(viewportMode\) === "workflow"/);
  assert.match(editor, /showWorkflowRightPanel \? \(/);
  assert.match(editor, /data-editor-right-panel-surface="workflow"/);
});

test("PI-5B-UX1 contextual toolbar still drives certified scene actions", () => {
  const toolbar = source("components/stage/StageFurnitureToolbar.tsx");
  const header = source("components/stage/StageEditorHeader.tsx");
  const context = source("components/stage/StageEditorContext.tsx");
  const catalog = source("components/stage/StageCatalogDrawer.tsx");
  const detail = source("components/stage/StageProductDetail.tsx");
  const session = source("components/afc-3d/AfcSceneObjectCrudSession.tsx");
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");

  assert.match(toolbar, /label="Move"/);
  assert.match(toolbar, /label="Rotate"/);
  assert.match(toolbar, /label="Size"/);
  assert.match(toolbar, /label="Duplicate"/);
  assert.match(toolbar, /label="Delete"/);
  assert.match(toolbar, /setTransformMode\("move"\)/);
  assert.match(toolbar, /setTransformMode\("rotate"\)/);
  assert.match(toolbar, /commitRotationYDeg/);
  assert.match(toolbar, /commitUserSizeMultiplier/);
  assert.match(toolbar, /session\.duplicateSelected\(\)/);
  assert.match(toolbar, /session\.deleteSelected\(\)/);
  assert.doesNotMatch(toolbar, />Scale</);

  assert.match(header, /stage\.undo/);
  assert.match(header, /disabled=\{!stage\.canUndo\}/);

  assert.match(context, /addFurnitureWithIdentity/);
  assert.match(catalog, /addProductToRoom/);
  assert.match(detail, /addProductToRoom/);

  assert.match(session, /addFurniture:/);
  assert.match(session, /duplicateSelected/);
  assert.match(session, /deleteSelected/);
  assert.match(session, /commitRotationYDeg/);
  assert.match(session, /commitUserSizeMultiplier/);

  assert.doesNotMatch(viewer, />Add Furniture<|>Delete<|>Duplicate</);
  assert.match(integrated, /<StageFurnitureToolbar/);
  assert.match(integrated, /showInternalControls=\{false\}/);
});

test("PI-5B-UX1 Add Duplicate Delete Size Rotate still mutate scene state", () => {
  const added = addSceneObject({
    objects: [],
    assetId: AFC_V2_RUNTIME_FURNITURE_ASSET_ID,
    createObjectId: () => "so-ux1-a",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;

  const duplicated = duplicateSceneObject({
    objects: added.objects,
    objectId: added.object.objectId,
    createObjectId: () => "so-ux1-b",
  });
  assert.equal(duplicated.ok, true);
  if (!duplicated.ok) return;
  assert.equal(duplicated.objects.length, 2);

  const deleted = deleteSceneObject({
    objects: duplicated.objects,
    objectId: duplicated.object.objectId,
  });
  assert.equal(deleted.ok, true);
  if (!deleted.ok) return;
  assert.equal(deleted.objects.length, 1);
  assert.equal(deleted.objects[0]?.objectId, "so-ux1-a");

  assert.equal(clampUserSizeMultiplier(1.25), 1.25);
  assert.equal(clampUserSizeMultiplier(0.25), 0.5);
  assert.equal(wrapSceneRotationDeg(90), 90);
  assert.equal(wrapSceneRotationDeg(270), -90);
});

test("PI-5B-UX1 canvas Catalog Summary and 2D workflow remain unchanged", () => {
  const editor = source("app/editor/page.tsx");
  const closed = stageDrawerLayout({ catalogOpen: false, summaryOpen: false });
  const open = stageDrawerLayout({ catalogOpen: true, summaryOpen: true });
  assert.equal(closed.canvasWidthClass, STAGE_CANVAS_WIDTH_CLASS);
  assert.equal(open.canvasWidthClass, STAGE_CANVAS_WIDTH_CLASS);
  assert.equal(closed.canvasHeightClass, STAGE_CANVAS_HEIGHT_CLASS);
  assert.equal(open.canvasHeightClass, STAGE_CANVAS_HEIGHT_CLASS);
  assert.match(editor, /h-\[70vh\] w-\[70vw\] max-w-\[1200px\]/);
  assert.match(editor, /getWorkflowStepDisplayLabel/);
  assert.match(editor, /workflow-panel-body/);
  assert.match(editor, /w-\[340px\]/);

  const shell = source("components/stage/StageEditorShell.tsx");
  assert.match(shell, /StageCatalogDrawer/);
  assert.match(shell, /StageSummaryDrawer/);
});

test("PI-5B-UX1 FIX1 idempotence guards remain in place", () => {
  const undo = () => undefined;
  const first = nextBoundScene(
    { objects: [], canUndo: false, undo },
    { objects: [], canUndo: false, undo },
  );
  const second = nextBoundScene(first, { objects: [], canUndo: false, undo });
  assert.equal(second, first);

  const rect = containFitRect(1600, 900, 1200, 800);
  assert.ok(rect);
  const box = nextFrameBox(null, rect);
  assert.equal(nextFrameBox(box, containFitRect(1600, 900, 1200, 800)!), box);
});
