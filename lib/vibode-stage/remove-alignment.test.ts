import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { assertProductionPayloadPrivacy } from "@/lib/afc-v2-production/privacy";

import {
  REMOVE_PIXEL_REGISTRATION,
  assessRemoveAlignment,
  initialRemoveInspectionState,
  interpretRemoveAlignmentResponse,
  reduceRemoveInspection,
  removeAlignmentArtifactPath,
  removeDecodedSizeDisagreement,
  removeFurnitureRenderingVisible,
  removeInspectionAllowsCatalogPlacement,
  removeInspectionAllowsFurnitureManipulation,
  removeInspectionAllowsHistorySelection,
  removeInspectionInteraction,
  settleRemoveInspectionGesture,
  removeOpacityPreset,
  removeOverlayLayers,
  type RemoveAlignmentFacts,
  type RemoveImageDescriptor,
} from "./remove-alignment";

const GENERATION = "22222222-2222-4222-8222-222222222222";
const REUSED = "33333333-3333-4333-8333-333333333333";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function source(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function image(
  sha256: string,
  width: number,
  height: number,
): RemoveImageDescriptor {
  return {
    sha256,
    decodedWidth: width,
    decodedHeight: height,
    byteCount: 128,
    mimeType: "image/png",
    orientation: 1,
  };
}

function facts(patch: Partial<RemoveAlignmentFacts> = {}): RemoveAlignmentFacts {
  return {
    generationId: GENERATION,
    status: "ready",
    original: image(SHA_A, 1200, 800),
    originalBytesMatch: true,
    empty: image(SHA_B, 1200, 800),
    emptyBytesMatch: true,
    emptyFailure: null,
    emptyArtifactSource: "durable",
    lineageSource: "durable",
    reusedFromGenerationId: REUSED,
    lineageSha256: SHA_B,
    frame: { width: 1200, height: 800 },
    frozenCameraFrame: { width: 1200, height: 800 },
    ...patch,
  };
}

test("equal dimensions stay unverified and presets map onto the EMPTY opacity stack", () => {
  const assessment = assessRemoveAlignment(facts());
  assert.equal(assessment.usable, true);
  if (!assessment.usable) return;
  assert.equal(assessment.report.pixelRegistration, REMOVE_PIXEL_REGISTRATION);
  assert.equal(assessment.report.gridCompatibility, "exact_grid_compatible");
  assert.equal(assessment.report.relativeAspectError, 0);
  assert.equal(assessment.report.empty.lineageSource, "durable");
  assert.equal(assessment.report.empty.lineageShaMatches, true);
  assertProductionPayloadPrivacy({ usable: true, report: assessment.report });

  const different = assessRemoveAlignment(facts({
    empty: image(SHA_B, 2000, 800),
  }));
  assert.equal(different.usable, true);
  if (!different.usable) return;
  assert.equal(different.report.pixelRegistration, "unverified");
  assert.equal(different.report.gridCompatibility, "incompatible");
  assert.ok((different.report.relativeAspectError ?? 0) > 0.015);

  assert.deepEqual(removeOverlayLayers(0), {
    showOriginal: true,
    showEmpty: false,
    emptyOpacity: 0,
  });
  assert.deepEqual(removeOverlayLayers(50), {
    showOriginal: true,
    showEmpty: true,
    emptyOpacity: 0.5,
  });
  assert.deepEqual(removeOverlayLayers(100), {
    showOriginal: false,
    showEmpty: true,
    emptyOpacity: 1,
  });
  assert.equal(removeOpacityPreset(0), "original");
  assert.equal(removeOpacityPreset(50), "blend");
  assert.equal(removeOpacityPreset(100), "empty");
  assert.equal(removeOpacityPreset(25), null);
  assert.equal(
    removeDecodedSizeDisagreement({ width: 1200, height: 800 }, { width: 600, height: 400 }),
    "Displayed 600×400 differs from certified 1200×800.",
  );
  assert.equal(
    removeDecodedSizeDisagreement({ width: 1200, height: 800 }, { width: 1200, height: 800 }),
    null,
  );
});

test("inspection blocks furniture manipulation and History selection only while active", () => {
  const scene = {
    versionId: "version-1",
    undoDepth: 3,
    roomScale: 1.25,
    objects: ["sofa"],
  };
  const before = { ...scene, objects: [...scene.objects] };
  const idle = initialRemoveInspectionState();
  assert.equal(removeInspectionAllowsFurnitureManipulation(idle.active), true);
  assert.equal(removeInspectionAllowsHistorySelection(idle.active), true);
  assert.deepEqual(removeInspectionInteraction(false), {
    furnitureManipulation: true,
    historySelection: true,
    undo: true,
    roomScale: true,
    catalogPlacement: true,
  });

  const entered = reduceRemoveInspection(idle, { type: "enter" });
  assert.equal(entered.active, true);
  assert.equal(entered.opacity, 50);
  assert.equal(entered.furnitureHidden, false);
  assert.equal(removeInspectionAllowsFurnitureManipulation(entered.active), false);
  assert.equal(removeInspectionAllowsHistorySelection(entered.active), false);
  assert.equal(removeInspectionInteraction(true).undo, false);
  assert.equal(removeInspectionInteraction(true).roomScale, false);
  assert.equal(removeInspectionAllowsCatalogPlacement(entered.active), false);
  assert.equal(settleRemoveInspectionGesture({
    manipulationEnabled: false,
    bodyDrag: "active",
    gizmoDragging: false,
  }), "restore");
  assert.equal(settleRemoveInspectionGesture({
    manipulationEnabled: false,
    bodyDrag: "none",
    gizmoDragging: true,
  }), "restore");
  assert.equal(settleRemoveInspectionGesture({
    manipulationEnabled: false,
    bodyDrag: "armed",
    gizmoDragging: false,
  }), "clear");
  assert.equal(settleRemoveInspectionGesture({
    manipulationEnabled: true,
    bodyDrag: "active",
    gizmoDragging: true,
  }), "keep");

  const hidden = reduceRemoveInspection(entered, { type: "furniture", hidden: true });
  assert.equal(removeFurnitureRenderingVisible({
    active: hidden.active,
    furnitureHidden: hidden.furnitureHidden,
  }), false);
  const originalPreset = reduceRemoveInspection(hidden, { type: "preset", preset: "original" });
  assert.equal(originalPreset.opacity, 0);
  const emptyPreset = reduceRemoveInspection(originalPreset, { type: "preset", preset: "empty" });
  assert.equal(emptyPreset.opacity, 100);
  assert.equal(reduceRemoveInspection(idle, { type: "opacity", opacity: 10 }).opacity, 50);

  const exited = reduceRemoveInspection(emptyPreset, { type: "exit" });
  assert.equal(exited.active, false);
  assert.equal(exited.furnitureHidden, false);
  assert.equal(removeInspectionAllowsFurnitureManipulation(exited.active), true);
  assert.equal(removeInspectionAllowsHistorySelection(exited.active), true);
  assert.equal(removeInspectionAllowsCatalogPlacement(exited.active), true);
  assert.equal(settleRemoveInspectionGesture({
    manipulationEnabled: true,
    bodyDrag: "none",
    gizmoDragging: false,
  }), "keep");
  assert.equal(removeFurnitureRenderingVisible({
    active: exited.active,
    furnitureHidden: true,
  }), true);
  assert.equal(exited.mode, "alignment");
  assert.equal(exited.sessionSerial, entered.sessionSerial + 1);
  assert.equal(exited.maskEpoch, hidden.maskEpoch + 1);
  assert.deepEqual(scene, before);
});

test("brush mode shares the inspection session and discards its mask epoch on exit", () => {
  const idle = initialRemoveInspectionState();
  assert.equal(idle.mode, "alignment");
  assert.equal(reduceRemoveInspection(idle, { type: "mode", mode: "brush" }), idle);
  assert.equal(reduceRemoveInspection(idle, { type: "mode", mode: "objects" }), idle);
  assert.equal(reduceRemoveInspection(idle, { type: "clear-mask" }), idle);
  const entered = reduceRemoveInspection(idle, { type: "enter" });
  assert.equal(entered.mode, "objects");
  assert.equal(entered.maskEpoch, 1);
  assert.equal(entered.sessionSerial, 1);
  const brush = reduceRemoveInspection(entered, { type: "mode", mode: "brush" });
  assert.equal(brush.mode, "brush");
  assert.equal(brush.maskEpoch, entered.maskEpoch);
  const shaped = reduceRemoveInspection(
    reduceRemoveInspection(brush, { type: "tool", tool: "restore" }),
    { type: "diameter", diameterPx: 3 },
  );
  assert.equal(shaped.tool, "restore");
  assert.equal(shaped.diameterPx, 3);
  assert.equal(shaped.featherPx, 1);
  const cleared = reduceRemoveInspection(shaped, { type: "clear-mask" });
  assert.equal(cleared.maskEpoch, shaped.maskEpoch + 1);
  assert.equal(cleared.mode, "brush");
  assert.equal(cleared.sessionSerial, shaped.sessionSerial);
  const exited = reduceRemoveInspection(cleared, { type: "exit" });
  assert.equal(exited.active, false);
  assert.equal(exited.mode, "alignment");
  assert.equal(exited.maskEpoch, cleared.maskEpoch + 1);
  assert.equal(exited.sessionSerial, cleared.sessionSerial + 1);
  assert.equal(removeInspectionAllowsFurnitureManipulation(exited.active), true);
  const again = reduceRemoveInspection(exited, { type: "enter" });
  assert.equal(again.sessionSerial, exited.sessionSerial + 1);
  assert.equal(again.mode, "objects");
  assert.equal(again.tool, "restore");
});

test("mask expansion and outline visibility follow the REMOVE session", () => {
  const idle = initialRemoveInspectionState();
  assert.equal(idle.objectExpansionPx, 2);
  assert.equal(idle.objectOutlinesVisible, true);
  assert.equal(idle.objectProtectionEnabled, true);
  assert.equal(reduceRemoveInspection(idle, { type: "object-expansion", expansionPx: 6 }), idle);
  assert.equal(reduceRemoveInspection(idle, { type: "object-outlines", visible: false }), idle);
  assert.equal(reduceRemoveInspection(idle, { type: "object-protection", enabled: false }), idle);

  const entered = reduceRemoveInspection(idle, { type: "enter" });
  assert.equal(entered.mode, "objects");
  assert.equal(entered.objectExpansionPx, 2);
  assert.equal(entered.objectOutlinesVisible, true);
  assert.equal(entered.objectProtectionEnabled, true);
  assert.equal(reduceRemoveInspection(entered, { type: "object-expansion", expansionPx: 2 }), entered);
  assert.equal(reduceRemoveInspection(entered, { type: "object-outlines", visible: true }), entered);
  assert.equal(reduceRemoveInspection(entered, { type: "object-protection", enabled: true }), entered);
  assert.equal(reduceRemoveInspection(entered, { type: "object-expansion", expansionPx: 0 }).objectExpansionPx, 0);
  assert.equal(reduceRemoveInspection(entered, { type: "object-expansion", expansionPx: 6 }).objectExpansionPx, 6);

  const tuned = reduceRemoveInspection(
    reduceRemoveInspection(entered, { type: "object-expansion", expansionPx: 6 }),
    { type: "object-outlines", visible: false },
  );
  assert.equal(tuned.objectExpansionPx, 6);
  assert.equal(tuned.objectOutlinesVisible, false);
  assert.equal(tuned.sessionSerial, entered.sessionSerial);
  assert.equal(tuned.maskEpoch, entered.maskEpoch);
  const alignment = reduceRemoveInspection(tuned, { type: "mode", mode: "alignment" });
  const brush = reduceRemoveInspection(alignment, { type: "mode", mode: "brush" });
  assert.equal(brush.mode, "brush");
  assert.equal(brush.objectExpansionPx, 6);
  assert.equal(brush.objectOutlinesVisible, false);
  const cleared = reduceRemoveInspection(brush, { type: "clear-mask" });
  assert.equal(cleared.objectExpansionPx, 6);
  assert.equal(cleared.objectOutlinesVisible, false);
  assert.equal(cleared.objectProtectionEnabled, true);
  assert.equal(cleared.maskEpoch, brush.maskEpoch + 1);

  const exited = reduceRemoveInspection(cleared, { type: "exit" });
  assert.equal(exited.active, false);
  assert.equal(exited.mode, "alignment");
  assert.equal(exited.objectExpansionPx, 2);
  assert.equal(exited.objectOutlinesVisible, true);
  assert.equal(exited.objectProtectionEnabled, true);
  const again = reduceRemoveInspection(exited, { type: "enter" });
  assert.equal(again.objectExpansionPx, 2);
  assert.equal(again.objectOutlinesVisible, true);
  assert.equal(again.objectProtectionEnabled, true);
  assert.equal(again.mode, "objects");

  const reentered = reduceRemoveInspection(tuned, { type: "enter" });
  assert.equal(reentered.objectExpansionPx, 2);
  assert.equal(reentered.objectOutlinesVisible, true);
  assert.equal(reentered.objectProtectionEnabled, true);
  assert.equal(
    reduceRemoveInspection(entered, { type: "object-expansion", expansionPx: 8 }).objectExpansionPx,
    6,
  );
  assert.equal(
    reduceRemoveInspection(entered, { type: "object-expansion", expansionPx: -1 }).objectExpansionPx,
    0,
  );
});

test("object protection is session-local and does not follow Clear Mask", () => {
  const entered = reduceRemoveInspection(initialRemoveInspectionState(), { type: "enter" });
  const off = reduceRemoveInspection(entered, { type: "object-protection", enabled: false });
  assert.equal(off.objectProtectionEnabled, false);
  assert.equal(off.maskEpoch, entered.maskEpoch);
  assert.equal(off.objectExpansionPx, 2);
  const brush = reduceRemoveInspection(off, { type: "mode", mode: "brush" });
  const cleared = reduceRemoveInspection(brush, { type: "clear-mask" });
  assert.equal(cleared.objectProtectionEnabled, false);
  assert.equal(cleared.maskEpoch, brush.maskEpoch + 1);
  assert.equal(cleared.objectExpansionPx, 2);
  const exited = reduceRemoveInspection(cleared, { type: "exit" });
  assert.equal(exited.objectProtectionEnabled, true);
  assert.equal(reduceRemoveInspection(exited, { type: "enter" }).objectProtectionEnabled, true);
});

test("lookup stays hidden unless the admin report is usable", () => {
  assert.equal(interpretRemoveAlignmentResponse({ status: 403, payload: { usable: true } }).access, "hidden");
  assert.equal(interpretRemoveAlignmentResponse({ status: 404, payload: { usable: false, reason: "Room not found." } }).access, "hidden");
  const disabled = interpretRemoveAlignmentResponse({
    status: 200,
    payload: { usable: false, reason: "Authoritative EMPTY image is unavailable." },
  });
  assert.deepEqual(disabled, {
    access: "disabled",
    reason: "Authoritative EMPTY image is unavailable.",
  });
  const assessment = assessRemoveAlignment(facts());
  assert.equal(assessment.usable, true);
  if (!assessment.usable) return;
  const ready = interpretRemoveAlignmentResponse({
    status: 200,
    payload: { usable: true, report: assessment.report },
  });
  assert.equal(ready.access, "ready");
  if (ready.access !== "ready") return;
  assert.equal(ready.report.pixelRegistration, "unverified");
  const forged = {
    ...assessment.report,
    pixelRegistration: "aligned",
  };
  assert.equal(interpretRemoveAlignmentResponse({
    status: 200,
    payload: { usable: true, report: forged },
  }).access, "disabled");
  assert.equal(
    removeAlignmentArtifactPath(GENERATION, "empty", GENERATION).includes("artifact=empty"),
    true,
  );
  assert.equal(assessRemoveAlignment(facts({
    originalBytesMatch: false,
  })).usable, false);
});

test("Remove is wired into the 3D header, overlay, and inspection gates", () => {
  const header = source("components/stage/StageEditorHeader.tsx");
  const shell = source("components/stage/StageEditorShell.tsx");
  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  const timeline = source("components/editor/ImageHistoryTimeline.tsx");
  const toolbar = source("components/stage/StageFurnitureToolbar.tsx");
  const catalog = source("components/stage/StageCatalogDrawer.tsx");
  const detail = source("components/stage/StageProductDetail.tsx");
  const route = source("app/api/vibode/admin/remove-alignment/route.ts");
  const session = source("components/stage/RemoveAlignmentSession.tsx");

  assert.match(header, /<RemoveAlignmentControl \/>\s*<HarmonizeButton \/>/);
  assert.equal(header.match(/<HarmonizeButton \/>/g)?.length, 1);
  assert.match(header, /min-w-0/);
  const scrollRow = header.slice(
    header.indexOf("overflow-x-auto"),
    header.indexOf("</div>", header.indexOf("overflow-x-auto")),
  );
  assert.match(scrollRow, /aria-label="Undo"/);
  assert.match(scrollRow, /aria-label="Summary"/);
  assert.doesNotMatch(scrollRow, /RemoveAlignmentControl|HarmonizeButton|RoomScaleControl/);
  assert.match(header, /inspection\.undo/);
  assert.match(shell, /onCleanupHistoryAccepted=\{onCleanupHistoryAccepted\}/);
  assert.match(shell, /onRemoveEditSaved=\{onRemoveEditSaved\}/);
  assert.match(shell, /activeHistoryImageUrl=\{activeHistoryImageUrl\}/);
  assert.match(integrated, /removeInspectionAllowsFurnitureManipulation\(removeActive\)/);
  assert.match(integrated, /removeFurnitureRenderingVisible/);
  assert.match(integrated, /<RemoveAlignmentOverlay \/>/);
  assert.match(timeline, /removeInspectionAllowsHistorySelection/);
  assert.match(timeline, /const selectVersion = historySelectionOpen \? onSelectVersion : undefined/);
  assert.match(toolbar, /removeInspectionAllowsFurnitureManipulation/);
  assert.match(catalog, /removeInspectionAllowsCatalogPlacement/);
  assert.match(catalog, /data-catalog-placement=\{placementOpen \? "open" : "blocked"\}/);
  assert.match(catalog, /if \(!placementOpen\) return;/);
  assert.match(detail, /removeInspectionAllowsCatalogPlacement/);
  assert.match(detail, /if \(!placementOpen\) return;/);
  const release = viewer.slice(
    viewer.indexOf("const releaseUncommittedGesture = () => {"),
    viewer.indexOf("releaseUncommittedGestureRef.current = releaseUncommittedGesture;"),
  );
  assert.match(release, /settleRemoveInspectionGesture/);
  assert.match(release, /restorePersistedPose/);
  assert.doesNotMatch(release, /emitCommittedScene/);
  assert.match(viewer, /releaseUncommittedGestureRef\.current\?\.\(\)/);
  assert.match(session, /pointer-events-none absolute inset-0 z-\[1\]/);
  assert.match(session, /removeAlignmentArtifactPath/);
  assert.doesNotMatch(session, /openai|gemini|sharp\(/);

  const frame = viewer.indexOf('data-afc-runtime-frame="true"');
  const historyImage = viewer.indexOf("src={visualImageUrl}", frame);
  const overlay = viewer.indexOf("{inspectionOverlay}", historyImage);
  const canvas = viewer.indexOf("ref={mountRef}", overlay);
  assert.ok(frame >= 0 && historyImage > frame && overlay > historyImage && canvas > overlay);
  assert.match(viewer, /if \(!furnitureManipulationRef\.current\) return;/);
  assert.match(viewer, /canMutate: \(\) => furnitureReady && sceneReadyRef\.current && furnitureManipulationRef\.current/);
  const capture = viewer.slice(
    viewer.indexOf("harmonizeCaptureRef.current ="),
    viewer.indexOf("animate();"),
  );
  const reveal = capture.indexOf("objectLayer.visible = true;");
  const render = capture.indexOf("renderHarmonizeFurniturePixels");
  assert.ok(reveal >= 0 && reveal < render);
  assert.match(capture, /objectLayer\.visible = sceneReadyRef\.current && furnitureRenderingRef\.current/);

  assert.match(route, /readRemoveActor/);
  assert.doesNotMatch(route, /getAuthenticatedAdminUser|isAdminEmail/);
  assert.match(route, /selectHarmonizeEmptyBytes/);
  assert.match(route, /durableArtifactBytesMatch/);
  assert.match(route, /assertProductionPayloadPrivacy/);
  assert.match(route, /assessRemoveAlignment/);
  assert.doesNotMatch(route, /updateGeneration|insert\(|openai|gemini|CREATE TABLE|migration/i);
  assert.doesNotMatch(route, /sourceImageUrl/);
  const adminAt = route.indexOf("readRemoveActor");
  const storeAt = route.indexOf("createProductionAfcStoreFromEnv");
  assert.ok(adminAt >= 0 && storeAt > adminAt);
});
