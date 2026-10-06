import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_MODEL_SIZING_MODE,
  deriveModelAxisScale,
  editExactModelSize,
  editLockedModelSize,
  editModelDimension,
  explicitModelDimensions,
  modelAxisScaleOrIdentity,
  modelDimensionsAfterAssetReplacement,
  resolveEffectiveModelDimensions,
  setModelSizingMode,
} from "./model-dimensions";

const native = { widthM: 0.8, heightM: 0.7, depthM: 0.9 };
const corrected = { widthM: 0.84, heightM: 0.73, depthM: 0.94, sizingMode: "exact" as const };

test("equal native and effective dimensions scale to 1,1,1", () => {
  const scale = deriveModelAxisScale({ native, effective: native });
  assert.equal(scale.ok, true);
  if (!scale.ok) return;
  assert.deepEqual(scale.scale, { x: 1, y: 1, z: 1 });
});

test("uniform 2x resize scales every axis by 2", () => {
  const scale = deriveModelAxisScale({
    native,
    effective: { widthM: 1.6, heightM: 1.4, depthM: 1.8 },
  });
  assert.equal(scale.ok, true);
  if (!scale.ok) return;
  assert.deepEqual(scale.scale, { x: 2, y: 2, z: 2 });
});

test("exact correction produces independent axis scales", () => {
  const scale = deriveModelAxisScale({
    native: { widthM: 0.8, heightM: 0.7, depthM: 0.9 },
    effective: { widthM: 1, heightM: 0.7, depthM: 1.8 },
  });
  assert.equal(scale.ok, true);
  if (!scale.ok) return;
  assert.equal(scale.scale.x, 1.25);
  assert.equal(scale.scale.y, 1);
  assert.equal(scale.scale.z, 2);
});

test("invalid native or effective dimensions fail closed", () => {
  assert.equal(deriveModelAxisScale({
    native: { widthM: 0, heightM: 0.7, depthM: 0.9 },
    effective: native,
  }).ok, false);
  assert.equal(deriveModelAxisScale({
    native: { widthM: Number.NaN, heightM: 0.7, depthM: 0.9 },
    effective: native,
  }).ok, false);
  assert.equal(deriveModelAxisScale({
    native,
    effective: { widthM: -1, heightM: 0.7, depthM: 0.9 },
  }).ok, false);
  assert.deepEqual(modelAxisScaleOrIdentity({
    native: null,
    effective: native,
  }), { x: 1, y: 1, z: 1 });
});

test("locked edits share one scale from the baseline", () => {
  assert.equal(DEFAULT_MODEL_SIZING_MODE, "uniform");
  const width = editLockedModelSize(native, "width", 1);
  assert.deepEqual(width, { widthM: 1, heightM: 0.875, depthM: 1.125 });
  const depth = editLockedModelSize(native, "depth", 1.125);
  assert.deepEqual(depth, { widthM: 1, heightM: 0.875, depthM: 1.125 });
  const height = editLockedModelSize(native, "height", 0.875);
  assert.deepEqual(height, { widthM: 1, heightM: 0.875, depthM: 1.125 });
  const again = editModelDimension({
    mode: "uniform",
    baseline: native,
    current: width!,
    axis: "width",
    nextValue: 0.8,
  });
  assert.deepEqual(again, native);
});

test("unlocked edits change one dimension and relock keeps that ratio", () => {
  const exact = editExactModelSize(native, "width", 1);
  assert.deepEqual(exact, { widthM: 1, heightM: 0.7, depthM: 0.9 });
  const relocked = setModelSizingMode(exact!, "uniform");
  assert.deepEqual(relocked, { widthM: 1, heightM: 0.7, depthM: 0.9, sizingMode: "uniform" });
  const next = editLockedModelSize(relocked!, "height", 1.4);
  assert.deepEqual(next, { widthM: 2, heightM: 1.4, depthM: 1.8 });
});

test("replacement keeps explicit product dimensions and a new association seeds native size", () => {
  const kept = modelDimensionsAfterAssetReplacement({
    previousExplicit: corrected,
    nextNative: { widthM: 0.42, heightM: 0.365, depthM: 0.47 },
  });
  assert.equal(kept?.seeded, false);
  assert.deepEqual(kept?.dimensions, corrected);
  const seeded = modelDimensionsAfterAssetReplacement({
    previousExplicit: null,
    nextNative: { widthM: 0.42, heightM: 0.365, depthM: 0.47 },
  });
  assert.equal(seeded?.seeded, true);
  assert.deepEqual(seeded?.dimensions, {
    widthM: 0.42,
    heightM: 0.365,
    depthM: 0.47,
    sizingMode: "uniform",
  });
});

test("a variant without explicit sizing uses the asset measurement", () => {
  const asset = { authoredWidthM: 0.8, authoredHeightM: 0.7, authoredDepthM: 0.9 };
  assert.equal(explicitModelDimensions({}), null);
  assert.deepEqual(resolveEffectiveModelDimensions({}, asset), {
    widthM: 0.8,
    heightM: 0.7,
    depthM: 0.9,
  });
  assert.deepEqual(resolveEffectiveModelDimensions({
    modelWidthM: 1,
    modelHeightM: 0.7,
    modelDepthM: 0.9,
    modelSizingMode: "exact",
  }, asset), { widthM: 1, heightM: 0.7, depthM: 0.9 });
});

test("technical upload copy no longer tells partners the GLB is already real-world size", () => {
  const workspace = readFileSync(
    path.join(process.cwd(), "app/partner/assets/PartnerAssetWorkspaceClient.tsx"),
    "utf8",
  );
  assert.doesNotMatch(workspace, /already be modeled at real-world scale/);
  assert.match(workspace, /Placement size is set on the product variant/);
  const intake = readFileSync(
    path.join(process.cwd(), "lib/vibode-stage/partner-asset-intake.ts"),
    "utf8",
  );
  assert.match(intake, /does not automatically resize/);
});
