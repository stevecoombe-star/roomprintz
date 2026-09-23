import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createPi4bSceneObjectDefinitions } from "@/lib/afc-v2-runtime/furniture-runtime";
import { AFC_V2_RUNTIME_FURNITURE_ASSET_ID } from "@/lib/afc-v2-runtime/types";
import {
  STAGE_STUDIO_CHAIR_PRODUCT_ID,
  STAGE_STUDIO_SOFA_PRODUCT_ID,
  STAGE_SEED_PRODUCTS,
  favoriteKey,
  fallbackProductIdForAsset,
} from "./catalog";
import { filterStageCatalogProducts, rememberRecentlyUsed } from "./catalog-query";
import {
  STAGE_CANVAS_HEIGHT_CLASS,
  STAGE_CANVAS_WIDTH_CLASS,
} from "./types";
import { stageDrawerLayout } from "./drawer-state";
import { toggleFavoriteKeys } from "./favorites";
import { snapRotationDegIfNear } from "./rotate";
import { formatSizePercent, isAuthoredSize } from "./size";
import {
  buildStageSummary,
  summaryGroupKey,
  summaryItemCountLabel,
} from "./summary";
import { placeStageToolbar, shouldHideToolbarDuringPointer } from "./toolbar";

const ROOT = process.cwd();

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("PI-5B summary groups matching product/variant instances", () => {
  const defaults = createPi4bSceneObjectDefinitions();
  const sofaA = defaults[0];
  const sofaB = defaults[1];
  assert.ok(sofaA && sofaB);
  const summary = buildStageSummary({
    objects: [
      sofaA,
      sofaB,
      {
        ...sofaA,
        objectId: "so-chair",
        productId: STAGE_STUDIO_CHAIR_PRODUCT_ID,
        variantId: "var-vibode-studio-chair-default",
      },
    ],
  });
  assert.equal(summary.itemCount, 3);
  assert.equal(summary.lines.length, 2);
  const sofaLine = summary.lines.find((line) => line.productId === STAGE_STUDIO_SOFA_PRODUCT_ID);
  const chairLine = summary.lines.find((line) => line.productId === STAGE_STUDIO_CHAIR_PRODUCT_ID);
  assert.equal(sofaLine?.quantity, 2);
  assert.equal(chairLine?.quantity, 1);
  assert.equal(summary.estimatedTotal, 2495 * 2 + 895);
  assert.equal(summaryItemCountLabel(3), "3 items in this room");
});

test("PI-5B default sofas resolve to catalog identity without rewriting persistence", () => {
  assert.equal(
    fallbackProductIdForAsset(AFC_V2_RUNTIME_FURNITURE_ASSET_ID),
    STAGE_STUDIO_SOFA_PRODUCT_ID,
  );
  const object = createPi4bSceneObjectDefinitions()[0];
  assert.ok(object);
  assert.equal(object.productId, undefined);
  assert.match(summaryGroupKey(object), new RegExp(STAGE_STUDIO_SOFA_PRODUCT_ID));
});

test("PI-5B version-specific summary is a pure function of that version's objects", () => {
  const parent = buildStageSummary({ objects: createPi4bSceneObjectDefinitions() });
  const child = buildStageSummary({ objects: [] });
  assert.equal(parent.itemCount, 2);
  assert.equal(child.itemCount, 0);
  assert.equal(child.lines.length, 0);
});

test("PI-5B drawer state does not change canvas dimension classes", () => {
  const closed = stageDrawerLayout({ catalogOpen: false, summaryOpen: false });
  const open = stageDrawerLayout({ catalogOpen: true, summaryOpen: true });
  assert.equal(closed.canvasWidthClass, STAGE_CANVAS_WIDTH_CLASS);
  assert.equal(open.canvasWidthClass, STAGE_CANVAS_WIDTH_CLASS);
  assert.equal(closed.canvasHeightClass, STAGE_CANVAS_HEIGHT_CLASS);
  assert.equal(open.canvasHeightClass, STAGE_CANVAS_HEIGHT_CLASS);
  assert.equal(closed.catalogWidthPx, 0);
  assert.equal(open.catalogWidthPx, 340);
  assert.equal(open.summaryWidthPx, 340);
});

test("PI-5B toolbar hides during pointer-down/drag and stays in canvas", () => {
  assert.equal(
    shouldHideToolbarDuringPointer({ pointerDownOnObject: true, dragging: false }),
    true,
  );
  assert.equal(
    shouldHideToolbarDuringPointer({ pointerDownOnObject: false, dragging: true }),
    true,
  );
  assert.equal(
    shouldHideToolbarDuringPointer({ pointerDownOnObject: false, dragging: false }),
    false,
  );
  const above = placeStageToolbar({
    anchorX: 400,
    anchorY: 200,
    canvasWidth: 800,
    canvasHeight: 500,
  });
  assert.equal(above.side, "above");
  const below = placeStageToolbar({
    anchorX: 400,
    anchorY: 20,
    canvasWidth: 800,
    canvasHeight: 500,
  });
  assert.equal(below.side, "below");
  assert.ok(below.top >= 0);
  assert.ok(below.left >= 0);
  assert.ok(below.left + 430 <= 800);
});

test("PI-5B size stays a user multiplier and rotation snap is optional", () => {
  assert.equal(formatSizePercent(1), "100%");
  assert.equal(isAuthoredSize(1), true);
  assert.equal(isAuthoredSize(1.25), false);
  assert.equal(snapRotationDegIfNear(2), 0);
  assert.equal(snapRotationDegIfNear(37), 37);
  assert.equal(snapRotationDegIfNear(88), 90);
});

test("PI-5B favorites are product/variant keys, not scene objects", () => {
  const next = toggleFavoriteKeys(new Set(), STAGE_STUDIO_SOFA_PRODUCT_ID, "var-1");
  assert.equal(next.has(favoriteKey(STAGE_STUDIO_SOFA_PRODUCT_ID, "var-1")), true);
  assert.equal(next.has("pi4b-sofa-a"), false);
  const cleared = toggleFavoriteKeys(next, STAGE_STUDIO_SOFA_PRODUCT_ID, "var-1");
  assert.equal(cleared.size, 0);
});

test("PI-5B catalog browse filters by category without requiring scene presence", () => {
  const living = filterStageCatalogProducts({
    products: STAGE_SEED_PRODUCTS,
    mode: "browse",
    query: "",
    categoryId: "living-room",
    subcategoryId: "chairs",
    collectionId: null,
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
  });
  assert.equal(living.length, 1);
  assert.equal(living[0]?.productId, STAGE_STUDIO_CHAIR_PRODUCT_ID);
  const bedroom = filterStageCatalogProducts({
    products: STAGE_SEED_PRODUCTS,
    mode: "browse",
    query: "",
    categoryId: "bedroom",
    subcategoryId: null,
    collectionId: null,
    favoriteKeys: new Set(),
    favoriteKeyFor: (product) => favoriteKey(product.productId, product.defaultVariantId),
  });
  assert.equal(bedroom.length, 0);
  assert.deepEqual(rememberRecentlyUsed(["a"], "b"), ["b", "a"]);
});

test("PI-5B STAGE shell extends certified editor chrome instead of replacing it", () => {
  const editor = source("app/editor/page.tsx");
  const header = source("components/stage/StageEditorHeader.tsx");
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const shell = source("components/stage/StageEditorShell.tsx");

  assert.match(editor, /← My Rooms/);
  assert.match(editor, /My Furniture/);
  assert.match(editor, /Furniture Layer:/);
  assert.match(editor, /<ImageHistoryTimeline/);
  assert.match(editor, /h-\[70vh\] w-\[70vw\] max-w-\[1200px\]/);
  assert.doesNotMatch(editor, /<Editor3dModePanel/);
  assert.match(editor, /<StageEditorShell active=\{viewportMode === "3d"\}>/);
  assert.match(editor, /data-stage-canvas="true"/);

  assert.match(header, /Catalog/);
  assert.match(header, /Undo/);
  assert.match(header, /Summary →/);
  assert.doesNotMatch(header, /2D \/ 3D|Furniture Layer|Download|Sign out|My Rooms/);

  assert.match(shell, /StageCatalogDrawer/);
  assert.match(shell, /StageSummaryDrawer/);

  assert.doesNotMatch(viewer, />Add Furniture<|>Delete<|>Duplicate</);
  assert.match(
    viewer,
    /\}, \[authority\.generationId, furniture\.objectId, furniture\.transform, world\]\);/,
  );
});
