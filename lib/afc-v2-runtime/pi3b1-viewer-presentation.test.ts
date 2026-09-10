import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  VIEWER_BACKGROUND_IMAGE_ALT,
  productionViewerFloorPresentation,
  productionViewerWorldLifecycleKey,
  resolveViewerBackgroundImageUrl,
} from "./viewer-presentation";

const ROOT = process.cwd();
const VIEWER = "components/afc-3d/AfcProductionRoomViewer.tsx";
const RUNTIME_PAGE = "components/afc-3d/AfcProductionRuntimePage.tsx";
const RUNTIME_ROUTE = "app/api/vibode/afc/runtime/route.ts";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("production viewer floor presentation contributes zero render pixels", () => {
  assert.equal(productionViewerFloorPresentation().renderMesh, false);

  const viewer = source(VIEWER);
  assert.doesNotMatch(viewer, /floorSurface/);
  assert.doesNotMatch(viewer, /floorGeometry/);
  assert.doesNotMatch(viewer, /floorMaterial/);
  assert.doesNotMatch(viewer, /PlaneGeometry/);
  assert.doesNotMatch(viewer, /0x22d3ee/);
  assert.doesNotMatch(viewer, /MeshBasicMaterial/);
  assert.match(viewer, /intersectRayWithHorizontalPlane/);
  assert.match(viewer, /world\.collisionWalls/);
  assert.match(viewer, /realizeProductionWorld/);
  assert.doesNotMatch(viewer, /world\.floor/);
});

test("background image prefers presentation-neutral URL and keeps ORIGINAL compatibility", () => {
  assert.equal(
    resolveViewerBackgroundImageUrl({
      originalImageUrl: "https://images.example.test/original.jpg",
    }),
    "https://images.example.test/original.jpg",
  );
  assert.equal(
    resolveViewerBackgroundImageUrl({
      backgroundImageUrl: "https://images.example.test/selected-version.jpg",
    }),
    "https://images.example.test/selected-version.jpg",
  );
  assert.equal(
    resolveViewerBackgroundImageUrl({
      backgroundImageUrl: "https://images.example.test/selected-version.jpg",
      originalImageUrl: "https://images.example.test/original.jpg",
    }),
    "https://images.example.test/selected-version.jpg",
  );
  assert.equal(
    resolveViewerBackgroundImageUrl({
      backgroundImageUrl: "   ",
      originalImageUrl: "https://images.example.test/original.jpg",
    }),
    "https://images.example.test/original.jpg",
  );
  assert.equal(resolveViewerBackgroundImageUrl({}), null);

  const viewer = source(VIEWER);
  assert.match(viewer, /backgroundImageUrl\?: string/);
  assert.match(viewer, /originalImageUrl\?: string/);
  assert.match(viewer, /resolveViewerBackgroundImageUrl/);
  assert.match(viewer, /src=\{visualImageUrl\}/);
  assert.match(viewer, /alt=\{VIEWER_BACKGROUND_IMAGE_ALT\}/);
  assert.equal(VIEWER_BACKGROUND_IMAGE_ALT, "Active Vibode room version");
  assert.doesNotMatch(viewer, /Canonical ORIGINAL room basis/);

  const page = source(RUNTIME_PAGE);
  assert.match(page, /originalImageUrl=\{originalImageUrl\}/);
  assert.doesNotMatch(page, /backgroundImageUrl=/);

  const route = source(RUNTIME_ROUTE);
  assert.match(route, /originalImageUrl/);
});

test("AFC world lifecycle is generation-only and ignores background image identity", () => {
  const generationId = "generation-pi3b1";
  assert.equal(
    productionViewerWorldLifecycleKey({ generationId }),
    generationId,
  );
  assert.equal(
    productionViewerWorldLifecycleKey({ generationId }),
    productionViewerWorldLifecycleKey({ generationId }),
  );
  assert.notEqual(
    productionViewerWorldLifecycleKey({ generationId: "generation-a" }),
    productionViewerWorldLifecycleKey({ generationId: "generation-b" }),
  );

  const helper = source("lib/afc-v2-runtime/viewer-presentation.ts");
  const lifecycleFn = helper.slice(
    helper.indexOf("export function productionViewerWorldLifecycleKey"),
    helper.indexOf("function normalizePresentationImageUrl"),
  );
  assert.match(lifecycleFn, /generationId/);
  assert.doesNotMatch(lifecycleFn, /backgroundImageUrl/);
  assert.doesNotMatch(lifecycleFn, /originalImageUrl/);
  assert.doesNotMatch(lifecycleFn, /versionId/);
  assert.doesNotMatch(lifecycleFn, /activeAssetId/);

  const viewer = source(VIEWER);
  assert.match(
    viewer,
    /key=\{productionViewerWorldLifecycleKey\(validated\.authority\)\}/,
  );
  assert.doesNotMatch(viewer, /key=\{[^}]*backgroundImageUrl/);
  assert.doesNotMatch(viewer, /key=\{[^}]*originalImageUrl/);
  assert.doesNotMatch(viewer, /key=\{[^}]*visualImageUrl/);
  assert.doesNotMatch(viewer, /key=\{[^}]*versionId/);
  assert.doesNotMatch(viewer, /key=\{[^}]*activeAssetId/);
  assert.match(
    viewer,
    /\}, \[authority\.generationId, cube\.objectId, cube\.transform, world\]\);/,
  );
  assert.doesNotMatch(
    viewer,
    /\[authority\.generationId, cube\.objectId, cube\.transform, world, visualImageUrl\]/,
  );
});
