import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  initialRemoveInspectionState,
  reduceRemoveInspection,
} from "@/lib/vibode-stage/remove-alignment";
import {
  buildRemoveEditCoverage,
  compositeRemoveEditRgba,
  removeEditHasChanges,
} from "@/lib/vibode-stage/remove-edit";
import { paintRemoveBrush, revealRemoveBrushMask } from "@/lib/vibode-stage/remove-mask";
import {
  REMOVE_OBJECT_ELIGIBILITY_DEFAULTS,
  packRemoveMask,
  prepareRemoveObjectMasks,
  type RemoveObjectRecord,
} from "@/lib/vibode-stage/remove-objects";
import {
  initialRemoveVocabularyConfirmState,
  requestRemoveVocabularyChange,
} from "@/lib/vibode-stage/remove-vocabulary-profile";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function rectObject(
  width: number,
  height: number,
  x: number,
  y: number,
  rectWidth: number,
  rectHeight: number,
): RemoveObjectRecord {
  const coverage = new Uint8Array(width * height);
  for (let py = y; py < y + rectHeight; py += 1) {
    for (let px = x; px < x + rectWidth; px += 1) coverage[py * width + px] = 255;
  }
  const mask = packRemoveMask(coverage, width, height);
  assert.ok(mask);
  const eligible = prepareRemoveObjectMasks({
    candidates: [{ id: "object-1", confidence: 0.95, concept: "table", mask }],
    thresholds: { ...REMOVE_OBJECT_ELIGIBILITY_DEFAULTS, minAreaPx: 1 },
  }).eligible;
  assert.equal(eligible.length, 1);
  return eligible[0];
}

function solid(width: number, height: number, rgb: readonly [number, number, number]): Uint8Array {
  const bytes = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    bytes[index * 4] = rgb[0];
    bytes[index * 4 + 1] = rgb[1];
    bytes[index * 4 + 2] = rgb[2];
    bytes[index * 4 + 3] = 255;
  }
  return bytes;
}

test("Objects and Brush switches keep the brush, mask epoch, and selection owner", () => {
  const entered = reduceRemoveInspection(initialRemoveInspectionState(), { type: "enter" });
  assert.equal(entered.mode, "objects");
  assert.equal(entered.active, true);
  const tuned = reduceRemoveInspection(
    reduceRemoveInspection(entered, { type: "tool", tool: "restore" }),
    { type: "diameter", diameterPx: 18 },
  );
  const feathered = reduceRemoveInspection(tuned, { type: "feather", featherPx: 4 });
  const protectedOff = reduceRemoveInspection(feathered, { type: "object-protection", enabled: false });
  const brush = reduceRemoveInspection(protectedOff, { type: "mode", mode: "brush" });
  assert.equal(brush.mode, "brush");
  assert.equal(brush.tool, "restore");
  assert.equal(brush.diameterPx, 18);
  assert.equal(brush.featherPx, 4);
  assert.equal(brush.objectProtectionEnabled, false);
  assert.equal(brush.maskEpoch, entered.maskEpoch);
  assert.equal(brush.sessionSerial, entered.sessionSerial);
  assert.equal(brush.objectOutlinesVisible, true);
  assert.equal(brush.objectExpansionPx, entered.objectExpansionPx);
  const objects = reduceRemoveInspection(brush, { type: "mode", mode: "objects" });
  assert.equal(objects.tool, "restore");
  assert.equal(objects.diameterPx, 18);
  assert.equal(objects.maskEpoch, entered.maskEpoch);
  const cleared = reduceRemoveInspection(objects, { type: "clear-mask" });
  assert.equal(cleared.maskEpoch, objects.maskEpoch + 1);
  assert.equal(cleared.tool, "restore");
  assert.equal(cleared.objectProtectionEnabled, false);
  assert.equal("selectedIds" in cleared, false);
});

test("a full-frame reveal publishes EMPTY, and hidden objects survive Restore and Clear Mask", () => {
  const width = 5;
  const height = 5;
  const object = rectObject(width, height, 2, 2, 1, 1);
  const selected = new Set(["object-1"]);
  const pixels = new Uint8Array(width * height);
  pixels[1] = 12;
  const hold = {
    sessionSerial: 1,
    roomId: "room-1",
    generationId: "generation-1",
    width,
    height,
    epoch: 1,
    pixels,
  };
  assert.equal(revealRemoveBrushMask({
    hold,
    roomId: hold.roomId,
    generationId: hold.generationId,
    sessionSerial: hold.sessionSerial,
    width,
    height,
    epoch: hold.epoch,
  }), true);
  assert.equal(selected.size, 1);
  const revealed = buildRemoveEditCoverage({
    brush: pixels,
    width,
    height,
    objects: [object],
    selectedIds: new Set(),
    expansionPx: 0,
  });
  assert.ok(revealed);
  assert.ok(revealed.every((value) => value === 255));
  assert.equal(removeEditHasChanges(revealed), true);

  paintRemoveBrush({
    mask: pixels,
    width,
    height,
    from: null,
    to: { x: 0.5, y: 0.5 },
    diameterPx: 1,
    featherPx: 0,
    tool: "restore",
  });
  const restored = buildRemoveEditCoverage({
    brush: pixels,
    width,
    height,
    objects: [object],
    selectedIds: selected,
    expansionPx: 0,
  });
  assert.equal(restored?.[0], 0);
  assert.equal(restored?.[2 * width + 2], 255);
  assert.equal(selected.has("object-1"), true);

  const clearedBrush = new Uint8Array(width * height);
  const cleared = buildRemoveEditCoverage({
    brush: clearedBrush,
    width,
    height,
    objects: [object],
    selectedIds: selected,
    expansionPx: 0,
  });
  assert.equal(cleared?.[0], 0);
  assert.equal(cleared?.[2 * width + 2], 255);
  assert.equal(selected.size, 1);

  const blended = compositeRemoveEditRgba({
    keep: solid(2, 1, [10, 20, 30]),
    empty: solid(2, 1, [200, 210, 220]),
    coverage: Uint8Array.of(255, 0),
    width: 2,
    height: 1,
  });
  assert.ok(blended);
  assert.equal(blended[0], 200);
  assert.equal(blended[4], 10);
});

test("Room Type confirmation stays on the existing vocabulary transition", () => {
  const idle = initialRemoveVocabularyConfirmState();
  assert.deepEqual(requestRemoveVocabularyChange(idle, {
    displayed: "default",
    requested: "default",
  }), idle);
  assert.deepEqual(requestRemoveVocabularyChange(idle, {
    displayed: "default",
    requested: "bedroom",
  }), { phase: "confirming", requested: "bedroom" });
  const maskSource = source("lib/vibode-stage/remove-mask.ts");
  const reveal = maskSource.slice(
    maskSource.indexOf("export function revealRemoveBrushMask"),
    maskSource.indexOf("export function removeMaskedCoveragePercent"),
  );
  assert.match(reveal, /\.fill\(255\)/);
  assert.doesNotMatch(reveal, /featherPx|diameterPx|protection|selectedIds|opacity/);
});

test("the simple panel reuses one session, one footer, and the existing Clean Up mount", () => {
  const session = source("components/stage/RemoveAlignmentSession.tsx");
  const panel = session.slice(
    session.indexOf("function RemoveInspectionPanel"),
    session.indexOf("function RemoveInspectionFooter"),
  );
  assert.match(panel, /useState<"simple" \| "advanced">\("simple"\)/);
  assert.match(panel, /data-remove-presentation=\{presentation\}/);
  assert.match(panel, /max-h-\[70vh\]/);
  assert.match(panel, /max-w-\[calc\(100vw-1\.5rem\)\]/);
  assert.match(panel, /overflow-x-hidden overflow-y-auto/);
  const scroll = panel.indexOf("overflow-y-auto");
  const footer = panel.indexOf("<RemoveInspectionFooter");
  assert.ok(scroll > 0 && footer > scroll);
  assert.match(panel, /onClick=\{\(\) => setPresentation\("simple"\)\}/);
  assert.match(panel, /onClick=\{\(\) => setPresentation\("advanced"\)\}/);
  const simpleReturn = panel.slice(
    panel.indexOf('onClick={() => setPresentation("simple")}'),
    panel.indexOf('onClick={() => setPresentation("simple")}') + 'onClick={() => setPresentation("simple")}'.length,
  );
  assert.doesNotMatch(simpleReturn, /setMode/);
  const simpleHeader = panel.slice(panel.indexOf('presentation === "simple"'), panel.indexOf(") : ("));
  assert.match(simpleHeader, />\s*Objects\s*</);
  assert.match(simpleHeader, />\s*Brush\s*</);
  assert.match(simpleHeader, />\s*Advanced\s*</);
  assert.doesNotMatch(simpleHeader, />\s*Alignment\s*</);
  assert.match(panel, /session\.mode === "alignment" \? \([\s\S]*EMPTY opacity[\s\S]*session\.mode === "brush"/);
  assert.match(panel, /session\.mode === "brush" \? \([\s\S]*<ObjectControls session=\{session\} \/>/);
  assert.match(session, /inspection\.mode === "brush"[\s\S]*dispatch\(\{ type: "mode", mode: "alignment" \}\)/);

  const objects = session.slice(session.indexOf("function ObjectControls"), session.indexOf("function objectStatus"));
  const room = objects.indexOf('aria-label="Room Type"');
  const hide = objects.indexOf("Hide All");
  const simpleOutline = objects.indexOf('outlineButton("Show Mask Outline")');
  const cleanup = objects.indexOf("<RemoveCleanupGeneration");
  const expansion = objects.indexOf("Mask Expansion");
  const advancedOutline = objects.indexOf('outlineButton("Show Mask Outlines")');
  assert.ok(room > 0 && room < hide && hide < simpleOutline && simpleOutline < cleanup);
  assert.ok(cleanup < expansion && expansion < advancedOutline);
  assert.match(objects, /session\.requestVocabulary\(value\)/);
  assert.match(objects, /session\.confirmVocabulary/);
  assert.match(objects, /Detection vocabulary/);
  assert.match(objects, /data-remove-cleanup="export"/);
  assert.match(objects, /key="remove-cleanup-generation"/);
  assert.equal(session.match(/<RemoveCleanupGeneration/g)?.length, 1);
  assert.equal(session.match(/<ObjectControls session=\{session\} \/>/g)?.length, 1);

  const brush = session.slice(session.indexOf("function BrushControls"), session.indexOf("function BrushSlider"));
  assert.match(brush, /presentation === "simple" \? \([\s\S]*Empty Room/);
  assert.match(brush, /data-remove-brush="empty-room"/);
  assert.match(brush, /session\.revealEmptyRoom/);
  assert.match(brush, /session\.clearMask/);
  assert.match(brush, /Protect Objects/);

  assert.equal(session.match(/data-remove-footer="true"/g)?.length, 1);
  assert.match(session, /Hide Furniture/);
  assert.match(session, /Show Furniture/);
  assert.match(session, /data-remove-objects="done"[\s\S]*?onClick=\{session\.saveRemoveEdits\}/);
  assert.match(session, /data-remove-edit="cancel"[\s\S]*?onClick=\{session\.exit\}/);
  assert.match(session, /dispatch\(\{ type: "clear-mask" \}\)/);
  assert.doesNotMatch(session.slice(
    session.indexOf("const clearMask"),
    session.indexOf("const revealEmptyRoom"),
  ), /selectedIds|requestVocabulary|setMode/);
});
