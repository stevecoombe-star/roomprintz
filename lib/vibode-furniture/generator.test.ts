import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";

import {
  PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M,
  PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M,
  PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M,
} from "@/lib/afc-v2-runtime/pi5d-lounge-chair-geometry";

import { PERSONAL_FURNITURE_GLB_MAX_BYTES } from "./asset-id";
import { FurnitureGeneratorPanel } from "@/components/stage/FurnitureGeneratorPanel";
import { FurnitureGlbPreviewDialog } from "@/components/stage/FurnitureGlbPreviewModal";
import {
  emptyFurniturePhotoSet,
  furnitureInputMode,
  orderedViewSlots,
  replacePreviewUrl,
  setFurniturePhoto,
  validateFurniturePhotoFile,
  validateFurniturePhotoPixels,
  type FurniturePhotoRecord,
  type FurnitureViewSlot,
} from "./generator/images";
import {
  closedPreviewModal,
  closeGlbPreview,
  cycleFocusableIndex,
  disposePreviewObject,
  FURNITURE_PREVIEW_FIXTURE_URL,
  formatFurnitureDimensions,
  groundAlignPreviewModel,
  initialPreviewCamera,
  nudgePreviewOrbit,
  openGlbPreview,
  previewKeyboardAction,
  previewLoadPlan,
  previewOrbitLimits,
  previewSaveState,
  readPreviewGlb,
} from "./generator/preview";
import { mapMeshyGenerationDraft } from "./generator/request";
import {
  defaultFurnitureGeneratorSettings,
  generatorCapabilities,
  generatorSettingsIssues,
  reconcileGeneratorSettings,
} from "./generator/settings";
import {
  initialFurnitureGeneratorUi,
  reduceFurnitureGenerator,
} from "./generator/ui-state";

const ROOT = process.cwd();
const CHAIR_GLB = path.join(ROOT, "public/afc-v2-runtime/test-fixtures/pi5d-lounge-chair.glb");

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function photo(slot: FurnitureViewSlot, fileName = `${slot}.jpg`): FurniturePhotoRecord {
  return {
    slot,
    fileName,
    mimeType: "image/jpeg",
    byteLength: 120_000,
    widthPx: 1024,
    heightPx: 768,
  };
}

function photosFor(slots: readonly FurnitureViewSlot[]) {
  const photos = emptyFurniturePhotoSet();
  return slots.reduce((set, slot) => setFurniturePhoto(set, photo(slot)), photos);
}

test("view selection distinguishes one photo from several and keeps front first", () => {
  const empty = emptyFurniturePhotoSet();
  assert.equal(furnitureInputMode(empty), "incomplete");
  assert.deepEqual(orderedViewSlots(empty), []);

  const frontOnly = setFurniturePhoto(empty, photo("front", "front.jpg"));
  assert.equal(furnitureInputMode(frontOnly), "single");
  assert.deepEqual(orderedViewSlots(frontOnly), ["front"]);

  const sideOnly = setFurniturePhoto(empty, photo("left"));
  assert.equal(furnitureInputMode(sideOnly), "incomplete");
  assert.deepEqual(orderedViewSlots(sideOnly), ["left"]);

  const multi = setFurniturePhoto(setFurniturePhoto(frontOnly, photo("back")), photo("left"));
  assert.equal(furnitureInputMode(multi), "multi");
  assert.deepEqual(orderedViewSlots(multi), ["front", "left", "back"]);
});

test("photo replacement and removal report the object URL to revoke", () => {
  const added = reduceFurnitureGenerator(initialFurnitureGeneratorUi(), {
    type: "set-photo",
    photo: photo("front", "first.jpg"),
    previewUrl: "blob:first",
  });
  assert.deepEqual(added.revokeUrls, []);
  assert.equal(added.state.photos.front?.fileName, "first.jpg");
  assert.equal(furnitureInputMode(added.state.photos), "single");

  const replaced = reduceFurnitureGenerator(added.state, {
    type: "set-photo",
    photo: photo("front", "second.jpg"),
    previewUrl: "blob:second",
  });
  assert.deepEqual(replaced.revokeUrls, ["blob:first"]);
  assert.equal(replaced.state.previewUrls.front, "blob:second");
  assert.equal(replaced.state.photos.front?.fileName, "second.jpg");

  const withSide = reduceFurnitureGenerator(replaced.state, {
    type: "set-photo",
    photo: photo("right", "side.jpg"),
    previewUrl: "blob:side",
  });
  assert.equal(furnitureInputMode(withSide.state.photos), "multi");

  const removed = reduceFurnitureGenerator(withSide.state, { type: "remove-photo", slot: "front" });
  assert.deepEqual(removed.revokeUrls, ["blob:second"]);
  assert.equal(removed.state.photos.front, null);
  assert.equal(furnitureInputMode(removed.state.photos), "incomplete");

  const urls = replacePreviewUrl({ left: "blob:left" }, "left", null);
  assert.deepEqual(urls.revoke, ["blob:left"]);
  assert.equal(urls.urls.left, undefined);
});

test("client image checks follow the documented Meshy limits", () => {
  assert.equal(validateFurniturePhotoFile({
    fileName: "chair.jpg",
    mimeType: "image/jpeg",
    byteLength: 10,
  }).ok, true);
  assert.equal(validateFurniturePhotoFile({
    fileName: "chair.png",
    mimeType: "",
    byteLength: 10,
  }).ok, true);
  assert.equal(validateFurniturePhotoFile({
    fileName: "chair.gif",
    mimeType: "image/gif",
    byteLength: 10,
  }).ok, false);
  assert.match(validateFurniturePhotoFile({
    fileName: "huge.jpg",
    mimeType: "image/jpeg",
    byteLength: 20 * 1024 * 1024 + 1,
  }).ok ? "" : "over 20 MB", /20 MB/);
  assert.equal(validateFurniturePhotoPixels({ widthPx: 32, heightPx: 32 }).ok, true);
  assert.equal(validateFurniturePhotoPixels({ widthPx: 31, heightPx: 800 }).ok, false);
  assert.equal(validateFurniturePhotoPixels({ widthPx: 20_000, heightPx: 20_000 }).ok, false);
});

test("Meshy 7.1 settings accept supported combinations and normalize the rest", () => {
  const defaults = defaultFurnitureGeneratorSettings();
  assert.equal(defaults.geometryResolution, "standard");
  assert.equal(defaults.shouldTexture, true);
  assert.equal(defaults.textureResolution, "2k");
  assert.equal(defaults.enablePbr, false);
  assert.deepEqual(generatorSettingsIssues(defaults, "single"), []);
  assert.deepEqual(generatorSettingsIssues(defaults, "multi"), []);

  const singleUltra = { ...defaults, geometryResolution: "4k" as const, textureResolution: "8k" as const, enablePbr: true };
  assert.deepEqual(generatorSettingsIssues(singleUltra, "single"), []);
  assert.equal(generatorCapabilities(singleUltra, "single").geometry["4k"].enabled, true);

  const multiUltra = reconcileGeneratorSettings(singleUltra, "multi");
  assert.equal(multiUltra.settings.geometryResolution, "2k");
  assert.equal(multiUltra.settings.textureResolution, "8k");
  assert.ok(multiUltra.notices.some((notice) => notice.includes("4K Ultra")));
  assert.equal(generatorCapabilities(multiUltra.settings, "multi").geometry["4k"].enabled, false);
  assert.deepEqual(generatorSettingsIssues({ ...defaults, geometryResolution: "4k" }, "multi").map((issue) => issue.code), ["geometry-4k-multi"]);

  const n1 = reconcileGeneratorSettings({
    ...defaults,
    textureModel: "meshy-n1",
    textureResolution: "4k",
    enablePbr: true,
    texturePrompt: "oak grain",
    shouldRemesh: true,
    topology: "quad",
  }, "single");
  assert.equal(n1.settings.textureResolution, "2k");
  assert.equal(n1.settings.enablePbr, false);
  assert.equal(n1.settings.topology, "triangle");
  assert.equal(n1.settings.texturePrompt, "oak grain");
  assert.equal(generatorCapabilities(n1.settings, "single").texturePrompt.enabled, false);
  assert.equal(generatorCapabilities(n1.settings, "single").enablePbr.enabled, false);

  const lite = reconcileGeneratorSettings({
    ...defaults,
    textureModel: "meshy-6-lite",
    textureResolution: "8k",
  }, "multi");
  assert.equal(lite.settings.textureModel, "default");
  assert.ok(lite.notices.some((notice) => notice.includes("Meshy 6 Lite")));
  assert.equal(generatorCapabilities(defaults, "multi").textureModel["meshy-6-lite"].enabled, false);
  assert.equal(generatorCapabilities({ ...defaults, textureModel: "meshy-6-lite" }, "single").textureResolution["4k"].enabled, false);

  assert.deepEqual(
    generatorSettingsIssues({ ...defaults, shouldRemesh: true, targetPolycount: 50 }, "single").map((issue) => issue.code),
    ["polycount"],
  );
  assert.deepEqual(
    generatorSettingsIssues({ ...defaults, texturePrompt: "x".repeat(801) }, "single").map((issue) => issue.code),
    ["texture-prompt-length"],
  );
});

test("provider mapping keeps image bytes out of the request and rejects unsupported settings", () => {
  const settings = defaultFurnitureGeneratorSettings();
  const missing = mapMeshyGenerationDraft({ photos: emptyFurniturePhotoSet(), settings });
  assert.equal(missing.ok, false);

  const single = mapMeshyGenerationDraft({
    photos: photosFor(["front"]),
    settings: {
      ...settings,
      geometryResolution: "4k",
      enablePbr: true,
      texturePrompt: "  walnut  ",
      imageEnhancement: false,
      shouldRemesh: true,
      targetPolycount: 80_000,
    },
  });
  assert.equal(single.ok, true);
  if (!single.ok) return;
  assert.equal(single.draft.operation, "image-to-3d");
  assert.equal(single.draft.endpoint, "/openapi/v1/image-to-3d");
  assert.deepEqual(single.draft.imageSlots, ["front"]);
  assert.equal(single.draft.body.ai_model, "meshy-7.1");
  assert.equal(single.draft.body.geometry_resolution, "4k");
  assert.equal(single.draft.body.enable_pbr, true);
  assert.equal(single.draft.body.texture_prompt, "walnut");
  assert.equal(single.draft.body.image_enhancement, false);
  assert.equal(single.draft.body.should_remesh, true);
  assert.equal(single.draft.body.target_polycount, 80_000);
  assert.deepEqual(single.draft.body.target_formats, ["glb"]);
  assert.equal(single.draft.intakeLimitBytes, PERSONAL_FURNITURE_GLB_MAX_BYTES);
  assert.match(single.draft.intakeNote, /25 MiB/);
  const serialized = JSON.stringify(single.draft);
  assert.doesNotMatch(serialized, /image_url|image_urls|pose_mode|ultra_mode|remove_lighting|api_key|data:image|blob:/);

  const untextured = mapMeshyGenerationDraft({
    photos: photosFor(["front", "left", "right"]),
    settings: { ...settings, shouldTexture: false, enablePbr: false, texturePrompt: "ignored" },
  });
  assert.equal(untextured.ok, true);
  if (!untextured.ok) return;
  assert.equal(untextured.draft.operation, "multi-image-to-3d");
  assert.deepEqual(untextured.draft.imageSlots, ["front", "left", "right"]);
  assert.equal(untextured.draft.body.texture_model, undefined);
  assert.equal(untextured.draft.body.texture_resolution, undefined);
  assert.equal(untextured.draft.body.enable_pbr, undefined);
  assert.equal(untextured.draft.body.texture_prompt, undefined);

  const n1 = mapMeshyGenerationDraft({
    photos: photosFor(["front", "back"]),
    settings: {
      ...settings,
      textureModel: "meshy-n1",
      texturePrompt: "do not send",
      enablePbr: false,
    },
  });
  assert.equal(n1.ok, true);
  if (!n1.ok) return;
  assert.equal(n1.draft.body.texture_model, "meshy-n1");
  assert.equal(n1.draft.body.texture_resolution, "2k");
  assert.equal("enable_pbr" in n1.draft.body, false);
  assert.equal("texture_prompt" in n1.draft.body, false);

  const rejected = mapMeshyGenerationDraft({
    photos: photosFor(["front", "left"]),
    settings: { ...settings, geometryResolution: "4k" },
  });
  assert.equal(rejected.ok, false);
});

test("preview modal lifecycle stays local and save stays disabled", () => {
  const closed = closedPreviewModal();
  const fixture = openGlbPreview(closed, { kind: "fixture", label: "Local test fixture" });
  assert.equal(fixture.open, true);
  assert.equal(fixture.session, 1);
  if (!fixture.open) return;
  assert.deepEqual(previewLoadPlan(fixture.request), {
    action: "load",
    url: FURNITURE_PREVIEW_FIXTURE_URL,
  });
  const afterClose = closeGlbPreview(fixture);
  assert.deepEqual(afterClose, { open: false, session: 1 });
  const reopened = openGlbPreview(afterClose, {
    kind: "library",
    label: "Chair",
    url: "https://signed.example/model.glb",
    assetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.equal(reopened.open, true);
  assert.equal(reopened.session, 2);

  assert.equal(previewSaveState({ kind: "fixture", label: "Local test fixture" }).shown, false);
  assert.equal(previewSaveState({ kind: "fixture", label: "Local test fixture" }).enabled, false);
  const candidate = previewSaveState({
    kind: "candidate",
    label: "Generated chair",
    url: "https://signed.example/candidate.glb",
  });
  assert.equal(candidate.shown, true);
  assert.equal(candidate.enabled, false);
  assert.match(candidate.reason, /trusted finalization/);

  assert.equal(previewLoadPlan({ kind: "candidate", label: "Generated", url: "https://signed.example/a.glb" }).action, "refuse");
  assert.equal(previewLoadPlan({
    kind: "library",
    label: "Chair",
    url: "javascript:alert(1)",
    assetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }).action, "refuse");
  assert.equal(previewLoadPlan({
    kind: "library",
    label: "Chair",
    url: "http://files.example/model.glb",
    assetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }).action, "refuse");
  assert.equal(previewLoadPlan({
    kind: "library",
    label: "Chair",
    url: "http://127.0.0.1:54321/storage/v1/object/sign/model.glb",
    assetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }).action, "load");
  assert.equal(cycleFocusableIndex(0, 3, true), 2);
  assert.equal(cycleFocusableIndex(2, 3, false), 0);
});

test("fixture GLB loads, grounds, and leaves another object untouched", async () => {
  const stageObject = new THREE.Object3D();
  stageObject.position.set(1.25, 2.5, -3);
  const bytes = readFileSync(CHAIR_GLB);
  const loaded = await readPreviewGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  assert.equal(stageObject.position.x, 1.25);
  assert.equal(stageObject.position.y, 2.5);
  assert.equal(stageObject.position.z, -3);
  assert.equal(loaded.ok, true);
  if (!loaded.ok) return;
  assert.ok(Math.abs(loaded.bounds.widthM - PI5D_LOUNGE_CHAIR_AUTHORED_WIDTH_M) < 1e-3);
  assert.ok(Math.abs(loaded.bounds.heightM - PI5D_LOUNGE_CHAIR_AUTHORED_HEIGHT_M) < 1e-3);
  assert.ok(Math.abs(loaded.bounds.depthM - PI5D_LOUNGE_CHAIR_AUTHORED_DEPTH_M) < 1e-3);
  assert.ok(Math.abs(loaded.bounds.minY) < 1e-3);
  assert.ok(Math.abs(loaded.bounds.centerX) < 1e-3);
  assert.ok(Math.abs(loaded.bounds.centerZ) < 1e-3);
  assert.match(formatFurnitureDimensions(loaded.bounds), /0\.80 m wide/);
  assert.match(formatFurnitureDimensions(loaded.bounds), /0\.78 m deep/);
  assert.match(formatFurnitureDimensions(loaded.bounds), /0\.80 m high/);

  const pose = initialPreviewCamera(loaded.bounds, 1.6);
  assert.equal(pose.target.x, 0);
  assert.ok(Math.abs(pose.target.y - loaded.bounds.heightM / 2) < 1e-6);
  assert.equal(pose.target.z, 0);
  const limits = previewOrbitLimits(loaded.bounds);
  assert.ok(pose.distance >= limits.minDistance && pose.distance <= limits.maxDistance);
  const narrow = initialPreviewCamera(loaded.bounds, 0.45);
  assert.ok(narrow.distance > pose.distance);
  const raised = nudgePreviewOrbit(pose, "ArrowUp", limits);
  assert.ok(raised);
  assert.ok(raised.phi < pose.phi);
  const floor = nudgePreviewOrbit({ ...pose, phi: limits.minPhi }, "ArrowUp", limits);
  assert.equal(floor?.phi, limits.minPhi);

  const displaced = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  displaced.position.set(4, 4, 4);
  const before = displaced.position.clone();
  groundAlignPreviewModel(loaded.scene);
  assert.ok(before.equals(displaced.position));
  let geometryDisposed = 0;
  displaced.geometry.dispose = () => {
    geometryDisposed += 1;
  };
  disposePreviewObject(displaced);
  disposePreviewObject(loaded.scene);
  assert.equal(geometryDisposed, 1);

  const rejected = await readPreviewGlb(new Uint8Array([1, 2, 3, 4]).buffer);
  assert.deepEqual(rejected, { ok: false, message: "This file isn't a supported GLB." });
});

test("preview keys stay inside the dialog and do not reach STAGE", () => {
  const shift = previewKeyboardAction({
    key: "Shift",
    shiftKey: true,
    nudged: false,
    focusIndex: 1,
    focusCount: 3,
  });
  assert.equal(shift.stopPropagation, true);
  assert.equal(shift.preventDefault, false);
  assert.equal(shift.close, false);

  const undo = previewKeyboardAction({
    key: "z",
    shiftKey: false,
    nudged: false,
    focusIndex: 0,
    focusCount: 3,
  });
  assert.equal(undo.stopPropagation, true);
  assert.equal(undo.close, false);
  assert.equal(undo.nextFocusIndex, null);

  const escape = previewKeyboardAction({
    key: "Escape",
    shiftKey: false,
    nudged: false,
    focusIndex: 2,
    focusCount: 3,
  });
  assert.deepEqual(escape, {
    stopPropagation: true,
    preventDefault: true,
    close: true,
    nextFocusIndex: null,
  });

  const orbit = previewKeyboardAction({
    key: "ArrowRight",
    shiftKey: false,
    nudged: true,
    focusIndex: 1,
    focusCount: 3,
  });
  assert.equal(orbit.preventDefault, true);
  assert.equal(orbit.close, false);

  const tabInside = previewKeyboardAction({
    key: "Tab",
    shiftKey: false,
    nudged: false,
    focusIndex: 0,
    focusCount: 3,
  });
  assert.equal(tabInside.preventDefault, false);
  assert.equal(tabInside.nextFocusIndex, null);

  const tabWrap = previewKeyboardAction({
    key: "Tab",
    shiftKey: false,
    nudged: false,
    focusIndex: 2,
    focusCount: 3,
  });
  assert.equal(tabWrap.preventDefault, true);
  assert.equal(tabWrap.nextFocusIndex, 0);

  const modalSource = source("components/stage/FurnitureGlbPreviewModal.tsx");
  assert.match(modalSource, /previewKeyboardAction/);
  assert.match(modalSource, /event\.stopPropagation\(\)/);
  assert.match(modalSource, /addEventListener\("keydown", onKey, true\)/);

  const furniture = source("components/stage/StageMyFurniturePanel.tsx");
  assert.match(furniture, /furnitureSubmode === "library" \? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"/);
  assert.match(furniture, /furnitureSubmode === "generator" \? "flex min-h-0 min-w-0 flex-1 flex-col" : "hidden"/);
  assert.doesNotMatch(furniture, /undo\(|boundScene|camera|selection/);
});

test("generator and preview markup stay disconnected from Meshy and from STAGE", () => {
  const panel = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
  }));
  assert.match(panel, /Meshy 7\.1/);
  assert.match(panel, /data-generation-available="false"/);
  assert.match(panel, /data-input-mode="incomplete"/);
  assert.match(panel, /data-generate="unavailable"/);
  assert.match(panel, /disabled/);
  assert.match(panel, /aria-expanded="false"/);
  assert.match(panel, /Preview test fixture/);
  assert.match(panel, /Meshy did not generate it/);
  assert.doesNotMatch(panel, /credit|queue|estimated/i);
  assert.doesNotMatch(panel, /Coming Soon/);

  const withoutFixture = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
  }));
  assert.doesNotMatch(withoutFixture, /Preview test fixture/);

  const multi = initialFurnitureGeneratorUi({
    photos: photosFor(["front", "left"]),
    previewUrls: {},
    settings: { ...defaultFurnitureGeneratorSettings(), geometryResolution: "4k" },
    notices: [],
    slotErrors: {},
  });
  const normalized = renderToStaticMarkup(createElement(FurnitureGeneratorPanel, {
    onOpenPreview: () => undefined,
    showFixturePreview: false,
    initialState: multi,
  }));
  assert.match(normalized, /data-input-mode="multi"/);
  assert.match(normalized, /data-ultra="2k"/);
  assert.match(normalized, /4K Ultra geometry is available for one photo only/);
  assert.match(normalized, /disabled=""[^>]*value="4k"|value="4k"[^>]*disabled=""/);

  const fixtureDialog = renderToStaticMarkup(createElement(FurnitureGlbPreviewDialog, {
    request: { kind: "fixture", label: "Do not use this title" },
    titleId: "preview-title",
    phase: { status: "loading" },
    bounds: null,
    onClose: () => undefined,
    onReset: () => undefined,
  }));
  assert.match(fixtureDialog, /role="dialog"/);
  assert.match(fixtureDialog, /aria-modal="true"/);
  assert.match(fixtureDialog, /Local test fixture/);
  assert.match(fixtureDialog, /Meshy did not generate this model/);
  assert.match(fixtureDialog, /Loading model/);
  assert.match(fixtureDialog, />Close</);
  assert.doesNotMatch(fixtureDialog, /Save to My Furniture/);
  assert.match(fixtureDialog, /data-save-enabled="false"/);

  const candidateDialog = renderToStaticMarkup(createElement(FurnitureGlbPreviewDialog, {
    request: { kind: "candidate", label: "Generated chair", url: "https://signed.example/candidate.glb" },
    titleId: "candidate-title",
    phase: { status: "error", message: "Generated models are not available to preview yet." },
    bounds: null,
    onClose: () => undefined,
    onReset: () => undefined,
  }));
  assert.match(candidateDialog, /Save to My Furniture/);
  assert.match(candidateDialog, /disabled=""/);
  assert.match(candidateDialog, /trusted finalization/);
  assert.match(candidateDialog, /role="alert"/);

  const previewSource = source("lib/vibode-furniture/generator/preview.ts");
  const modalSource = source("components/stage/FurnitureGlbPreviewModal.tsx");
  const panelSource = source("components/stage/FurnitureGeneratorPanel.tsx");
  const requestSource = source("lib/vibode-furniture/generator/request.ts");
  assert.doesNotMatch(previewSource, /useStageEditor|StageEditorContext/);
  assert.doesNotMatch(modalSource, /useStageEditor|StageEditorContext|TransformControls|api\.meshy\.ai/);
  assert.match(modalSource, /disposePreviewObject/);
  assert.match(modalSource, /forceContextLoss/);
  assert.match(modalSource, /cancelAnimationFrame/);
  assert.doesNotMatch(panelSource, /fetch\(|api\.meshy\.ai|supabase|pose_mode/);
  assert.doesNotMatch(requestSource, /fetch\(|MESHY_API_KEY|process\.env/);
  assert.match(source("components/stage/StageMyFurniturePanel.tsx"), /Upload GLB/);
  assert.match(source("components/stage/StageMyFurniturePanel.tsx"), /Archive/);
});
