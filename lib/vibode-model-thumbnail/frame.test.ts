import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { frameModelThumbnail } from "./frame";
import { staticModelThumbnailSha } from "./identity";
import {
  isDisplayableModelThumbnailUrl,
  isModelThumbnailAssetId,
  modelThumbnailObjectPath,
} from "./policy";

const SHA = "ab".repeat(32);

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("camera frames the bounding-box center from a finite three-quarter view", () => {
  const framed = frameModelThumbnail({
    min: { x: -1, y: 0, z: -0.5 },
    max: { x: 1, y: 2, z: 0.5 },
  });
  assert.equal(framed.ok, true);
  if (!framed.ok) return;
  assert.deepEqual(framed.camera.lookAt, { x: 0, y: 1, z: 0 });
  assert.ok(framed.camera.position.y > framed.camera.lookAt.y);
  assert.ok(framed.camera.position.x > framed.camera.lookAt.x);
  assert.ok(framed.camera.position.z > framed.camera.lookAt.z);
  assert.ok(framed.camera.near > 0);
  assert.ok(framed.camera.far > framed.camera.near);
  const distance = Math.hypot(
    framed.camera.position.x - framed.camera.lookAt.x,
    framed.camera.position.y - framed.camera.lookAt.y,
    framed.camera.position.z - framed.camera.lookAt.z,
  );
  assert.ok(Number.isFinite(distance));
  assert.ok(distance - framed.radius > framed.camera.near);
  assert.ok(distance + framed.radius < framed.camera.far);
});

test("extreme aspect ratios stay finite and fully in front of the camera", () => {
  const cases = [
    { min: { x: 0, y: 0, z: 0 }, max: { x: 0.2, y: 40, z: 0.2 } },
    { min: { x: 0, y: 0, z: 0 }, max: { x: 80, y: 0.15, z: 0.15 } },
    { min: { x: -0.05, y: 0, z: -30 }, max: { x: 0.05, y: 0.1, z: 30 } },
  ];
  for (const bounds of cases) {
    const framed = frameModelThumbnail(bounds);
    assert.equal(framed.ok, true);
    if (!framed.ok) continue;
    for (const value of [
      framed.camera.position.x,
      framed.camera.position.y,
      framed.camera.position.z,
      framed.camera.near,
      framed.camera.far,
      framed.radius,
    ]) {
      assert.equal(Number.isFinite(value), true);
    }
    const distance = Math.hypot(
      framed.camera.position.x - framed.camera.lookAt.x,
      framed.camera.position.y - framed.camera.lookAt.y,
      framed.camera.position.z - framed.camera.lookAt.z,
    );
    assert.ok(distance > framed.radius);
    assert.ok(framed.camera.far > distance + framed.radius);
  }
});

test("degenerate and non-finite bounds do not produce a camera", () => {
  assert.equal(frameModelThumbnail({
    min: { x: 0, y: 0, z: 0 },
    max: { x: 0, y: 0, z: 0 },
  }).ok, false);
  assert.equal(frameModelThumbnail({
    min: { x: 0, y: 0, z: 0 },
    max: { x: Number.POSITIVE_INFINITY, y: 1, z: 1 },
  }).ok, false);
  assert.equal(frameModelThumbnail({
    min: { x: 2, y: 0, z: 0 },
    max: { x: 1, y: 1, z: 1 },
  }).ok, false);
});

test("a model stays addressable when it has no thumbnail yet", () => {
  const asset = { assetId: "vibode-stage/partner-intake/abc", status: "ready" as const, thumbnailUrl: null };
  assert.equal(asset.status, "ready");
  assert.equal(asset.thumbnailUrl, null);
  assert.equal(isModelThumbnailAssetId(asset.assetId), true);
  assert.equal(isModelThumbnailAssetId("../secret"), false);
});

test("thumbnail paths stay content-addressed and display URLs stay ordinary http(s)", () => {
  const assetId = "vibode-stage/partner-intake/11111111-1111-4111-8111-111111111111";
  assert.equal(
    modelThumbnailObjectPath(assetId, SHA),
    `models/${assetId}/${SHA}.webp`,
  );
  assert.equal(modelThumbnailObjectPath("../secret", SHA), null);
  assert.equal(modelThumbnailObjectPath(assetId, "not-a-sha"), null);
  assert.equal(isDisplayableModelThumbnailUrl("javascript:alert(1)"), false);
  assert.equal(
    isDisplayableModelThumbnailUrl("https://example.test/storage/v1/object/sign/vibode-thumbnails/models/a/b.webp?token=1"),
    true,
  );
  assert.equal(staticModelThumbnailSha(assetId, "/afc-v2-runtime/chair.glb")?.length, 64);
});

test("thumbnail generation is sequential and disposes the temporary renderer", () => {
  const renderer = source("lib/vibode-model-thumbnail/render-browser.ts");
  const client = source("lib/vibode-model-thumbnail/generate-client.ts");
  assert.match(renderer, /geometry\.dispose\(\)/);
  assert.match(renderer, /material\.dispose\(\)/);
  assert.match(renderer, /texture\.dispose\(\)/);
  assert.match(renderer, /forceContextLoss\(\)/);
  assert.match(renderer, /revokeObjectURL/);
  assert.match(renderer, /frameModelThumbnail/);
  assert.doesNotMatch(client, /Promise\.all/);
  assert.match(client, /for \(let index = 0/);
  assert.match(client, /renderModelThumbnailPng/);
});
