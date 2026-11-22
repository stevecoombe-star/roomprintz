import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { validatePersistedSceneObjects } from "@/lib/afc-v2-runtime/persisted-scene";
import { DEFAULT_WORLD_TRANSFORM } from "@/lib/afc-v2-runtime/types";
import { LibraryDimensionEditor } from "@/components/stage/LibraryDimensionEditor";
import { FurnitureGlbPreviewDialog } from "@/components/stage/FurnitureGlbPreviewModal";
import { modelAxisScaleForPlacement } from "@/lib/vibode-stage/furniture-model-scale";
import { scaledPreviewPosition } from "@/lib/vibode-furniture/generator/preview";

import {
  DIMENSION_INDEPENDENT_NOTE,
  DIMENSION_PLACEMENT_NOTE,
  DIMENSION_RANGE_MESSAGE,
  blurDimensionDraft,
  dimensionDraftCanSave,
  editDimensionDraft,
  effectivePersonalDimensions,
  formatDimensionInput,
  personalPlacementScale,
  setDimensionDraftLocked,
  setDimensionDraftUnit,
  startDimensionDraft,
} from "./dimension-edit";

const TABLE = {
  widthM: 1.2,
  heightM: 0.45,
  depthM: 0.7,
  sizingMode: "uniform" as const,
};

test("uniform edits scale every side and independent edits keep the others", () => {
  const started = startDimensionDraft(TABLE);
  assert.ok(started);
  if (!started) return;
  assert.equal(started.locked, true);
  assert.equal(started.texts.width, "120");
  const wider = editDimensionDraft(started, "width", "240");
  assert.equal(wider.issue, null);
  assert.equal(wider.current.widthM, 2.4);
  assert.equal(wider.current.heightM, 0.9);
  assert.equal(wider.current.depthM, 1.4);
  const unlocked = setDimensionDraftLocked(wider, false);
  assert.equal(unlocked.current.heightM, 0.9);
  const shorter = editDimensionDraft(unlocked, "height", "40");
  assert.equal(shorter.current.heightM, 0.4);
  assert.equal(shorter.current.widthM, 2.4);
  assert.equal(shorter.current.depthM, 1.4);
  const relocked = setDimensionDraftLocked(shorter, true);
  const deeper = editDimensionDraft(relocked, "depth", "70");
  assert.ok(Math.abs(deeper.current.widthM / 2.4 - deeper.current.heightM / 0.4) < 1e-9);
  assert.equal(deeper.current.depthM, 0.7);
});

test("typing one side does not compound, and units convert from metres", () => {
  const started = startDimensionDraft(TABLE);
  assert.ok(started);
  if (!started) return;
  const partial = editDimensionDraft(started, "width", "1");
  const finished = editDimensionDraft(partial, "width", "180");
  assert.equal(finished.current.widthM, 1.8);
  assert.equal(finished.current.heightM, 0.675);
  const inches = setDimensionDraftUnit(finished, "in");
  assert.equal(inches.unit, "in");
  assert.equal(inches.texts.width, formatDimensionInput(1.8, "in"));
  assert.equal(inches.current.widthM, 1.8);
  const fromInches = editDimensionDraft(setDimensionDraftLocked(inches, false), "height", "18");
  assert.equal(fromInches.current.heightM, 0.457);
  assert.equal(fromInches.current.widthM, 1.8);
  const restored = blurDimensionDraft(setDimensionDraftUnit(fromInches, "cm"));
  assert.equal(restored.texts.height, "45.7");
  assert.equal(restored.current.widthM, 1.8);
});

test("preview scaling keeps a raised model origin on the floor", () => {
  assert.deepEqual(scaledPreviewPosition({ x: 0, y: 0.5, z: 0 }, { x: 2, y: 2, z: 1.5 }), {
    x: 0,
    y: 1,
    z: 0,
  });
});

test("invalid measurements do not replace the last good size", () => {
  const started = startDimensionDraft(TABLE);
  assert.ok(started);
  if (!started) return;
  for (const value of ["", "0", "-1", "abc", "900"]) {
    const rejected = editDimensionDraft(started, "width", value);
    assert.equal(rejected.current.widthM, TABLE.widthM);
    assert.ok(rejected.issue);
  }
  assert.equal(editDimensionDraft(started, "width", "900").issue, DIMENSION_RANGE_MESSAGE);
  assert.equal(dimensionDraftCanSave(editDimensionDraft(started, "width", "0")), false);
  const same = blurDimensionDraft(started);
  assert.equal(dimensionDraftCanSave(same), false);
});

test("a saved room keeps its placement scale when the library default changes", () => {
  const asset = {
    authoredWidthM: 1,
    authoredHeightM: 0.4,
    authoredDepthM: 0.6,
  };
  assert.equal(personalPlacementScale(asset), null);
  assert.equal(effectivePersonalDimensions(asset)?.sizingMode, "uniform");
  const existing = {
    objectId: "so-existing",
    assetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    transform: DEFAULT_WORLD_TRANSFORM,
  };
  const validated = validatePersistedSceneObjects([existing]);
  assert.equal(validated.ok, true);
  if (!validated.ok) return;
  assert.equal(validated.objects[0]?.modelAxisScale, undefined);

  const edited = {
    ...asset,
    displayWidthM: 2,
    displayHeightM: 0.5,
    displayDepthM: 0.9,
    sizingMode: "exact" as const,
  };
  const scale = personalPlacementScale(edited);
  assert.deepEqual(scale, { x: 2, y: 1.25, z: 1.5 });
  const placed = validatePersistedSceneObjects([{ ...existing, objectId: "so-new", modelAxisScale: scale }]);
  assert.equal(placed.ok, true);
  if (!placed.ok) return;
  assert.deepEqual(placed.objects[0]?.modelAxisScale, scale);
  assert.equal(validated.objects[0]?.modelAxisScale, undefined);
  assert.deepEqual(modelAxisScaleForPlacement({
    persisted: validated.objects[0]?.modelAxisScale,
    lookedUp: { x: 9, y: 9, z: 9 },
  }), { x: 9, y: 9, z: 9 });
  assert.deepEqual(modelAxisScaleForPlacement({
    persisted: placed.objects[0]?.modelAxisScale,
    lookedUp: { x: 9, y: 9, z: 9 },
  }), scale);
  const identity = validatePersistedSceneObjects([{
    ...existing,
    modelAxisScale: { x: 1, y: 1, z: 1 },
  }]);
  assert.equal(identity.ok, true);
  if (!identity.ok) return;
  assert.equal(identity.objects[0]?.modelAxisScale, undefined);
  const broken = validatePersistedSceneObjects([{
    ...existing,
    modelAxisScale: { x: 0, y: 1, z: 1 },
  }]);
  assert.equal(broken.ok, false);
});

test("the preview offers dimension editing without calling it a failed generation", () => {
  const dialog = renderToStaticMarkup(createElement(FurnitureGlbPreviewDialog, {
    request: {
      kind: "library",
      label: "Coffee table",
      url: "https://example.com/model.glb",
      assetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      dimensions: TABLE,
    },
    titleId: "preview-title",
    phase: { status: "ready" },
    bounds: { widthM: 1.2, heightM: 0.45, depthM: 0.7, minY: 0, centerX: 0, centerZ: 0 },
    onClose: () => undefined,
    onReset: () => undefined,
  }));
  assert.match(dialog, /Edit dimensions/);
  assert.match(dialog, /1\.20 m wide/);
  assert.doesNotMatch(dialog, /Save changes/);
  assert.doesNotMatch(dialog, /The generation did not finish/);
  const draft = startDimensionDraft(TABLE);
  assert.ok(draft);
  if (!draft) return;
  const editor = renderToStaticMarkup(createElement(LibraryDimensionEditor, {
    draft,
    saving: false,
    notice: null,
    onEdit: () => undefined,
    onUnit: () => undefined,
    onLocked: () => undefined,
    onBlur: () => undefined,
    onSave: () => undefined,
    onCancel: () => undefined,
  }));
  assert.match(editor, /Proportions locked/);
  assert.match(editor, /aria-pressed="true"/);
  assert.match(editor, /Save changes/);
  assert.match(editor, /Cancel/);
  assert.match(editor, new RegExp(DIMENSION_PLACEMENT_NOTE));
  const unlocked = renderToStaticMarkup(createElement(LibraryDimensionEditor, {
    draft: setDimensionDraftLocked(draft, false),
    saving: false,
    notice: null,
    onEdit: () => undefined,
    onUnit: () => undefined,
    onLocked: () => undefined,
    onBlur: () => undefined,
    onSave: () => undefined,
    onCancel: () => undefined,
  }));
  assert.match(unlocked, /Proportions unlocked/);
  assert.match(unlocked, new RegExp(DIMENSION_INDEPENDENT_NOTE));
});

test("dimension editing does not contact a provider or a credit balance", () => {
  const route = readFileSync("app/api/vibode/furniture-assets/dimensions/route.ts", "utf8");
  const client = readFileSync("lib/vibode-furniture/dimension-client.ts", "utf8");
  const editor = readFileSync("lib/vibode-furniture/dimension-edit.ts", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20261122190000_vibode_furniture_display_dimensions.sql",
    "utf8",
  );
  for (const source of [route, client, editor, migration]) {
    assert.doesNotMatch(source, /meshy|credits_consumed|paid_submissions|allowance|generation_jobs/i);
  }
  assert.match(migration, /display_width_m/);
  assert.match(migration, /VIBODE_FURNITURE_ASSET:IMMUTABLE/);
  assert.doesNotMatch(migration, /update\s+public\.vibode_furniture_assets/i);
  assert.doesNotMatch(migration, /vibode-photo-preparations|vibode-furniture-generation-inputs/);
});
