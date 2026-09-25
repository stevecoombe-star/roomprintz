import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  VIBODE_PRODUCTION_AMBIENT_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY,
  VIBODE_PRODUCTION_DIRECTIONAL_POSITION,
  VIBODE_THUMBNAIL_RENDERER_DPR,
} from "./still-renderer";

test("still-render constants match the production viewer literals", () => {
  const viewer = readFileSync(
    "components/afc-3d/AfcProductionRoomViewer.tsx",
    "utf8",
  );
  assert.equal(VIBODE_PRODUCTION_AMBIENT_INTENSITY, 0.8);
  assert.equal(VIBODE_PRODUCTION_DIRECTIONAL_INTENSITY, 1);
  assert.deepEqual(VIBODE_PRODUCTION_DIRECTIONAL_POSITION, { x: 3, y: 6, z: 5 });
  assert.equal(VIBODE_THUMBNAIL_RENDERER_DPR, 1);
  assert.match(viewer, /new THREE\.WebGLRenderer\(\{ alpha: true, antialias: true \}\)/);
  assert.match(viewer, /new THREE\.AmbientLight\(0xffffff, 0\.8\)/);
  assert.match(viewer, /new THREE\.DirectionalLight\(0xffffff, 1\.0\)/);
  assert.match(viewer, /keyLight\.position\.set\(3, 6, 5\)/);
  assert.match(viewer, /renderer\.outputColorSpace = THREE\.SRGBColorSpace/);
  assert.match(viewer, /renderer\.setClearAlpha\(0\)/);
  assert.match(
    viewer,
    /renderer\.setPixelRatio\(Math\.min\(window\.devicePixelRatio, 2\)\)/,
  );
  assert.doesNotMatch(viewer, /VIBODE_THUMBNAIL_RENDERER_DPR/);
});
