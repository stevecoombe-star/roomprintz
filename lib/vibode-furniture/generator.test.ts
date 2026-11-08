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
import { generationCandidateStillPreviewable } from "./generation/preview-access";
import { requestCandidatePreview } from "./generator/candidate-preview";
import { preferredAddCanonicalTransform } from "@/lib/afc-v2-runtime/scene-crud";
import { CandidateCalibrationForm } from "@/components/stage/CandidateCalibrationForm";
import { FurnitureGeneratorPanel } from "@/components/stage/FurnitureGeneratorPanel";
import { FurnitureGlbPreviewDialog } from "@/components/stage/FurnitureGlbPreviewModal";
import { saveCalibratedCandidate } from "@/lib/vibode-furniture/generator/calibrated-save-client";
import {
  buildCalibrationPreview,
  calibrationFailureLocks,
  claimCalibrationSubmit,
  nextCalibrationPhase,
  parseCalibrationTargetMetres,
} from "@/lib/vibode-furniture/generator/calibration-ui";
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
  formatGeneratedDimensions,
  groundAlignPreviewModel,
  initialPreviewCamera,
  nudgePreviewOrbit,
  openGlbPreview,
  orbitPreviewFromPointer,
  orbitPreviewPosition,
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

test("preview modal stays local and only a measured candidate can be saved", () => {
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
  assert.equal(previewSaveState({ kind: "fixture", label: "Local test fixture" }).available, false);
  const candidate = previewSaveState({
    kind: "candidate",
    label: "Generated chair",
    url: "https://signed.example/candidate.glb",
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.equal(candidate.shown, true);
  assert.equal(candidate.available, true);
  assert.match(candidate.reason, /one real-world measurement/);
  assert.equal(previewSaveState({
    kind: "candidate",
    label: "Generated chair",
    url: "https://signed.example/candidate.glb",
    jobId: "not-a-job",
  }).available, false);

  assert.equal(previewLoadPlan({
    kind: "candidate",
    label: "Generated",
    url: "https://signed.example/a.glb",
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }).action, "load");
  assert.equal(previewLoadPlan({
    kind: "candidate",
    label: "Generated",
    url: "https://assets.meshy.ai/model.glb",
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }).action, "refuse");
  assert.equal(previewLoadPlan({
    kind: "candidate",
    label: "Generated",
    url: "https://api.meshy.ai/model.glb",
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }).action, "refuse");
  assert.equal(previewLoadPlan({
    kind: "candidate",
    label: "Generated",
    url: "javascript:alert(1)",
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }).action, "refuse");
  assert.equal(previewLoadPlan({
    kind: "candidate",
    label: "Generated",
    url: "http://files.example/model.glb",
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }).action, "refuse");
  assert.equal(previewLoadPlan({
    kind: "candidate",
    label: "Generated",
    url: "https://user:pass@signed.example/a.glb",
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }).action, "refuse");
  assert.equal(previewLoadPlan({
    kind: "candidate",
    label: "Generated",
    url: "http://127.0.0.1:54321/storage/v1/object/sign/model.glb",
    jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }).action, "load");
  assert.equal(formatGeneratedDimensions({ widthM: 1.798, depthM: 1.486, heightM: 1.903 }), "1.798 m wide · 1.486 m deep · 1.903 m high");
  assert.equal(generationCandidateStillPreviewable(2_000, 1_000), true);
  assert.equal(generationCandidateStillPreviewable(1_000, 1_000), false);
  assert.equal(generationCandidateStillPreviewable(null, 1_000), false);
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
  const raisedPosition = orbitPreviewPosition(pose.target, raised);
  assert.ok(raisedPosition.y > pose.position.y);
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
    request: {
      kind: "candidate",
      label: "Generated chair",
      url: "https://signed.example/candidate.glb",
      jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    titleId: "candidate-title",
    phase: { status: "ready" },
    bounds: { widthM: 1.798, heightM: 1.903, depthM: 1.486, minY: 0, centerX: 0, centerZ: 0 },
    onClose: () => undefined,
    onReset: () => undefined,
  }));
  assert.match(candidateDialog, /1\.798 m wide · 1\.486 m deep · 1\.903 m high/);
  assert.match(candidateDialog, /179\.8 × 148\.6 × 190\.3 cm/);
  assert.match(candidateDialog, /Uncalibrated generated measurements, not verified product sizes/);
  assert.match(candidateDialog, /scale width, depth, and height together/);
  assert.match(candidateDialog, /Save to My Furniture/);
  assert.match(candidateDialog, /placeholder="Metres"/);
  assert.match(candidateDialog, /data-calibration-axis="height"/);
  assert.match(candidateDialog, /disabled=""/);
  assert.match(candidateDialog, /Reset camera/);
  assert.match(candidateDialog, /data-save-enabled="false"/);
  assert.match(candidateDialog, /data-calibration="candidate"/);
  assert.match(candidateDialog, /data-preview-kind="candidate"/);
  assert.doesNotMatch(candidateDialog, /0\.85/);
  assert.doesNotMatch(candidateDialog, /https:\/\/signed\.example/);

  const libraryDialog = renderToStaticMarkup(createElement(FurnitureGlbPreviewDialog, {
    request: {
      kind: "library",
      label: "Uploaded chair",
      url: "https://signed.example/library.glb",
      assetId: "vibode-furniture/personal/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    titleId: "library-title",
    phase: { status: "ready" },
    bounds: { widthM: 0.8, heightM: 0.8, depthM: 0.78, minY: 0, centerX: 0, centerZ: 0 },
    onClose: () => undefined,
    onReset: () => undefined,
  }));
  assert.match(libraryDialog, /0\.80 m wide/);
  assert.doesNotMatch(libraryDialog, /data-calibration="candidate"/);
  assert.doesNotMatch(libraryDialog, /Save to My Furniture/);
  assert.match(libraryDialog, /data-save-enabled="false"/);

  const refusedCandidate = renderToStaticMarkup(createElement(FurnitureGlbPreviewDialog, {
    request: {
      kind: "candidate",
      label: "Generated chair",
      url: "https://assets.meshy.ai/model.glb",
      jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    },
    titleId: "refused-title",
    phase: { status: "error", message: "This preview link cannot be opened." },
    bounds: null,
    onClose: () => undefined,
    onReset: () => undefined,
  }));
  assert.match(refusedCandidate, /role="alert"/);
  assert.match(refusedCandidate, /This preview link cannot be opened/);
  assert.doesNotMatch(refusedCandidate, /assets\.meshy\.ai/);

  const previewSource = source("lib/vibode-furniture/generator/preview.ts");
  const modalSource = source("components/stage/FurnitureGlbPreviewModal.tsx");
  const panelSource = source("components/stage/FurnitureGeneratorPanel.tsx");
  const requestSource = source("lib/vibode-furniture/generator/request.ts");
  assert.doesNotMatch(previewSource, /useStageEditor|StageEditorContext/);
  assert.doesNotMatch(modalSource, /useStageEditor|StageEditorContext|TransformControls|api\.meshy\.ai/);
  assert.match(modalSource, /disposePreviewObject/);
  assert.match(modalSource, /forceContextLoss/);
  assert.match(modalSource, /cancelAnimationFrame/);
  assert.match(modalSource, /stopPropagation/);
  assert.match(modalSource, /The private preview link could not be loaded/);
  assert.doesNotMatch(panelSource, /fetch\(|api\.meshy\.ai|supabase|pose_mode/);
  assert.match(panelSource, /data-generate="unavailable"/);
  assert.match(panelSource, /CandidatePreviewEntry/);
  const entrySource = source("components/stage/CandidatePreviewEntry.tsx");
  assert.match(entrySource, /\/api\/auth\/admin-access/);
  assert.match(entrySource, /requestCandidatePreview/);
  assert.doesNotMatch(entrySource, /localStorage|sessionStorage|console\.|c097b220-ed48-463e-aca0-5403d3ca0414/);
  assert.match(source("lib/vibode-furniture/generator/candidate-preview.ts"), /\/api\/vibode\/furniture-generations\//);
  assert.doesNotMatch(requestSource, /fetch\(|MESHY_API_KEY|process\.env/);
  assert.match(source("components/stage/StageMyFurniturePanel.tsx"), /Upload GLB/);
  assert.match(source("components/stage/StageMyFurniturePanel.tsx"), /Archive/);
  assert.match(source("components/stage/StageMyFurniturePanel.tsx"), /onCandidateSaved/);
  assert.match(source("components/stage/StageMyFurniturePanel.tsx"), /setFurnitureSubmode\("library"\)/);
  assert.doesNotMatch(modalSource, /console\.|localStorage|c097b220-ed48-463e-aca0-5403d3ca0414/);
  assert.doesNotMatch(source("lib/vibode-furniture/generator/calibrated-save-client.ts"), /console\.|localStorage|previewUrl/);
  assert.doesNotMatch(source("components/stage/FurnitureGeneratorPanel.tsx"), /paidSubmissionAuthorized|grantPaidSubmission|credit/);
});

test("an upward pointer drag looks upward and a sideways drag keeps its direction", () => {
  const limits = previewOrbitLimits({ widthM: 1, heightM: 1, depthM: 1 });
  const orbit = { theta: 0.55, phi: 1.02, distance: 4 };
  const target = { x: 0, y: 0.5, z: 0 };
  const before = orbitPreviewPosition(target, orbit);

  const draggedUp = orbitPreviewFromPointer(orbit, { x: 0, y: -80 }, limits);
  const upPosition = orbitPreviewPosition(target, draggedUp);
  assert.ok(draggedUp.phi > orbit.phi);
  assert.ok(upPosition.y < before.y);
  assert.equal(draggedUp.theta, orbit.theta);
  assert.equal(draggedUp.distance, orbit.distance);

  const draggedDown = orbitPreviewFromPointer(orbit, { x: 0, y: 80 }, limits);
  const downPosition = orbitPreviewPosition(target, draggedDown);
  assert.ok(draggedDown.phi < orbit.phi);
  assert.ok(downPosition.y > before.y);
  assert.equal(draggedDown.theta, orbit.theta);

  const draggedLeft = orbitPreviewFromPointer(orbit, { x: -80, y: 0 }, limits);
  const draggedRight = orbitPreviewFromPointer(orbit, { x: 80, y: 0 }, limits);
  assert.ok(Math.abs(draggedLeft.theta - (orbit.theta + 0.4)) < 1e-12);
  assert.ok(Math.abs(draggedRight.theta - (orbit.theta - 0.4)) < 1e-12);
  assert.equal(draggedLeft.phi, orbit.phi);
  assert.equal(draggedRight.phi, orbit.phi);
  assert.equal(draggedLeft.distance, orbit.distance);
});

test("an owned candidate preview fetches a fresh private link and rejects the rest", async () => {
  const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let opens = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    opens += 1;
    assert.equal(String(input), `/api/vibode/furniture-generations/${jobId}/preview`);
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer owner-session");
    return new Response(JSON.stringify({
      ok: true,
      previewUrl: `https://signed.example/candidate.glb?open=${opens}`,
    }), { status: 200 });
  };
  const first = await requestCandidatePreview({ jobId, token: "owner-session", fetchImpl });
  const second = await requestCandidatePreview({ jobId, token: "owner-session", fetchImpl });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok && second.ok) assert.notEqual(first.previewUrl, second.previewUrl);
  assert.equal(opens, 2);

  const calls = { count: 0 };
  const blocked: typeof fetch = async () => {
    calls.count += 1;
    return new Response("no", { status: 500 });
  };
  const invalidJob = await requestCandidatePreview({ jobId: "not-a-job", token: "owner-session", fetchImpl: blocked });
  assert.equal(invalidJob.ok, false);
  if (!invalidJob.ok) assert.match(invalidJob.message, /valid generation job ID/);
  const signedOut = await requestCandidatePreview({ jobId, token: "", fetchImpl: blocked });
  assert.equal(signedOut.ok, false);
  if (!signedOut.ok) assert.match(signedOut.message, /Sign in again/);
  assert.equal(calls.count, 0);

  const unauthorized = await requestCandidatePreview({
    jobId,
    token: "owner-session",
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "Unauthorized." }), { status: 401 }),
  });
  assert.equal(unauthorized.ok, false);
  if (!unauthorized.ok) assert.match(unauthorized.message, /Sign in again/);

  const missing = await requestCandidatePreview({
    jobId,
    token: "owner-session",
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "That preview is not available." }), { status: 404 }),
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.match(missing.message, /another account or may have expired/);
    assert.equal(missing.message.includes("http"), false);
  }

  const providerLink = await requestCandidatePreview({
    jobId,
    token: "owner-session",
    fetchImpl: async () => new Response(JSON.stringify({
      ok: true,
      previewUrl: "https://assets.meshy.ai/model.glb",
    }), { status: 200 }),
  });
  assert.equal(providerLink.ok, false);
  if (!providerLink.ok) {
    assert.match(providerLink.message, /cannot be opened/);
    assert.equal(providerLink.message.includes("meshy"), false);
  }

  const offline = await requestCandidatePreview({
    jobId,
    token: "owner-session",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(offline.ok, false);
  if (!offline.ok) assert.equal(offline.message, "The preview could not be opened.");
});

const GENERATED_CHAIR = { widthM: 1.798, heightM: 1.903, depthM: 1.486 };
const SAVE_JOB = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function chairCalibration(axis: "height" | "width" | "depth", targetText: string, displayName = "Armchair", category = "Seating") {
  return buildCalibrationPreview({
    measured: GENERATED_CHAIR,
    axis,
    targetText,
    displayName,
    category,
  });
}

test("calibration accepts one real measurement on each axis and rejects the rest", () => {
  assert.equal(parseCalibrationTargetMetres(""), null);
  assert.equal(parseCalibrationTargetMetres("0"), null);
  assert.equal(parseCalibrationTargetMetres("-0.2"), null);
  assert.equal(parseCalibrationTargetMetres("abc"), null);
  assert.equal(parseCalibrationTargetMetres("0.85 metres"), null);
  assert.equal(parseCalibrationTargetMetres("85cm"), 0.85);
  assert.equal(parseCalibrationTargetMetres("0.8500004"), 0.8500004);

  const empty = chairCalibration("height", "");
  assert.equal(empty.ready, false);
  assert.equal(empty.result, null);
  assert.equal(empty.measurementIssue, null);

  const height = chairCalibration("height", "0.85");
  assert.equal(height.ready, true);
  assert.equal(height.axis, "height");
  assert.equal(height.targetM, 0.85);
  assert.ok(height.result);
  if (!height.result) return;
  const factor = height.result.heightM / GENERATED_CHAIR.heightM;
  assert.ok(Math.abs(factor - 0.4467) < 0.0001);
  assert.ok(Math.abs(height.result.heightM - 0.85) < 1e-9);
  assert.ok(Math.abs(height.result.widthM - 0.803) < 0.001);
  assert.ok(Math.abs(height.result.depthM - 0.664) < 0.001);
  assert.ok(Math.abs(height.result.widthM / GENERATED_CHAIR.widthM - factor) < 1e-12);
  assert.ok(Math.abs(height.result.depthM / GENERATED_CHAIR.depthM - factor) < 1e-12);
  assert.match(height.resultLabel ?? "", /0\.803 × 0\.664 × 0\.850 m/);
  assert.match(height.resultLabel ?? "", /80\.3 × 66\.4 × 85\.0 cm/);
  assert.equal(chairCalibration("height", "85cm").targetM, height.targetM);

  const width = chairCalibration("width", "0.9");
  assert.equal(width.ready, true);
  assert.ok(width.result);
  if (!width.result) return;
  assert.ok(Math.abs(width.result.widthM - 0.9) < 1e-9);
  const widthFactor = 0.9 / GENERATED_CHAIR.widthM;
  assert.ok(Math.abs(width.result.heightM - GENERATED_CHAIR.heightM * widthFactor) < 1e-9);
  assert.ok(Math.abs(width.result.depthM - GENERATED_CHAIR.depthM * widthFactor) < 1e-9);

  const depth = chairCalibration("depth", "0.7");
  assert.equal(depth.ready, true);
  assert.ok(depth.result);
  if (!depth.result) return;
  assert.ok(Math.abs(depth.result.depthM - 0.7) < 1e-9);
  const depthFactor = 0.7 / GENERATED_CHAIR.depthM;
  assert.ok(Math.abs(depth.result.widthM - GENERATED_CHAIR.widthM * depthFactor) < 1e-9);
  assert.ok(Math.abs(depth.result.heightM - GENERATED_CHAIR.heightM * depthFactor) < 1e-9);

  assert.equal(chairCalibration("height", "0.04").ready, false);
  assert.match(chairCalibration("height", "0.04").measurementIssue ?? "", /0\.05 m to 8 m/);
  assert.equal(chairCalibration("height", "9").ready, false);
  assert.equal(chairCalibration("width", "0.05").ready, false);
  assert.match(chairCalibration("height", "0.85", "").detailIssue ?? "", /^$/);
  assert.equal(chairCalibration("height", "0.85", "").ready, false);
  assert.ok(chairCalibration("height", "0.85", "").result);
  assert.equal(chairCalibration("height", "0.85", "Armchair", "x".repeat(41)).ready, false);
  assert.match(chairCalibration("height", "0.85", "Armchair", "x".repeat(41)).detailIssue ?? "", /40 characters/);

  let phase: "edit" | "confirm" | "saving" = "edit";
  phase = nextCalibrationPhase(phase, "review", false);
  assert.equal(phase, "edit");
  phase = nextCalibrationPhase(phase, "review", true);
  assert.equal(phase, "confirm");
  phase = nextCalibrationPhase(phase, "commit", true);
  assert.equal(phase, "saving");
  phase = nextCalibrationPhase(phase, "commit", true);
  assert.equal(phase, "saving");
  const gate = { pending: false };
  assert.equal(claimCalibrationSubmit(gate), true);
  assert.equal(claimCalibrationSubmit(gate), false);
  assert.equal(calibrationFailureLocks("CANDIDATE_EXPIRED"), true);
  assert.equal(calibrationFailureLocks("ALREADY_SAVED"), true);
  assert.equal(calibrationFailureLocks("NETWORK"), false);

  const confirmed = renderToStaticMarkup(createElement(CandidateCalibrationForm, {
    generatedCentimetres: "179.8 × 148.6 × 190.3 cm",
    axis: "height",
    targetText: "0.85",
    displayName: "Armchair",
    category: "Seating",
    targetLabel: height.targetLabel,
    resultLabel: height.resultLabel,
    issue: null,
    phase: "confirm",
    notice: null,
    canReview: true,
    locked: false,
    onAxis: () => undefined,
    onTarget: () => undefined,
    onDisplayName: () => undefined,
    onCategory: () => undefined,
    onReview: () => undefined,
    onBack: () => undefined,
    onCommit: () => undefined,
  }));
  assert.match(confirmed, /Create a permanent My Furniture model/);
  assert.match(confirmed, /data-save-enabled="true"/);
  assert.match(confirmed, /Create permanent model/);
  assert.doesNotMatch(confirmed, /https?:/);

  assert.equal(preferredAddCanonicalTransform().uniformScale, 1);
  assert.match(source("components/stage/StageMyFurniturePanel.tsx"), /addPersonalAssetToRoom\(item\.assetId\)/);
});

test("save posts the owner measurement once and keeps private links out of the result", async () => {
  const jobId = SAVE_JOB;
  const item = {
    assetId: "vibode-furniture/personal/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    displayName: "Armchair",
    category: "Seating",
    authoredWidthM: 0.803,
    authoredHeightM: 0.85,
    authoredDepthM: 0.664,
    previewUrl: "https://signed.example/private-model.glb?token=secret",
  };
  let calls = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    calls += 1;
    assert.equal(String(input), `/api/vibode/furniture-generations/${jobId}/save`);
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer owner-session");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["axis", "category", "displayName", "targetM"]);
    assert.equal(body.displayName, "Armchair");
    assert.equal(body.category, "Seating");
    assert.equal(body.axis, "height");
    assert.equal(body.targetM, 0.85);
    assert.equal(String(init?.body).includes("signed"), false);
    assert.equal(String(init?.body).includes("owner-session"), false);
    return new Response(JSON.stringify({
      ok: true,
      idempotent: calls > 1,
      item,
    }), { status: 200 });
  };
  const first = await saveCalibratedCandidate({
    jobId,
    token: "owner-session",
    displayName: "Armchair",
    category: "Seating",
    axis: "height",
    targetM: 0.85,
    fetchImpl,
  });
  const second = await saveCalibratedCandidate({
    jobId,
    token: "owner-session",
    displayName: "Armchair",
    category: "Seating",
    axis: "height",
    targetM: 0.85,
    fetchImpl,
  });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(first.idempotent, false);
  assert.equal(second.idempotent, true);
  assert.equal(first.assetId, second.assetId);
  assert.deepEqual(Object.keys(first).sort(), ["assetId", "displayName", "idempotent", "ok"]);
  assert.equal(JSON.stringify(first).includes("signed"), false);
  assert.equal(JSON.stringify(first).includes("owner-session"), false);
  assert.equal(calls, 2);

  const conflict = await saveCalibratedCandidate({
    jobId,
    token: "owner-session",
    displayName: "Armchair",
    category: null,
    axis: "width",
    targetM: 0.9,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      error: "see https://signed.example/secret",
      errorCode: "ALREADY_SAVED",
    }), { status: 409 }),
  });
  assert.equal(conflict.ok, false);
  if (conflict.ok) return;
  assert.equal(conflict.errorCode, "ALREADY_SAVED");
  assert.match(conflict.message, /different size/);
  assert.equal(conflict.message.includes("http"), false);

  const expired = await saveCalibratedCandidate({
    jobId,
    token: "owner-session",
    displayName: "Armchair",
    category: null,
    axis: "height",
    targetM: 0.85,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      errorCode: "CANDIDATE_EXPIRED",
      error: "expired",
    }), { status: 409 }),
  });
  assert.equal(expired.ok, false);
  if (!expired.ok) assert.match(expired.message, /expired/);

  const denied = await saveCalibratedCandidate({
    jobId,
    token: "owner-session",
    displayName: "Armchair",
    category: null,
    axis: "height",
    targetM: 0.85,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      error: "Unauthorized.",
    }), { status: 401 }),
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.match(denied.message, /Sign in again/);

  const foreign = await saveCalibratedCandidate({
    jobId,
    token: "owner-session",
    displayName: "Armchair",
    category: null,
    axis: "height",
    targetM: 0.85,
    fetchImpl: async () => new Response(JSON.stringify({
      ok: false,
      error: "https://signed.example/other-account",
      errorCode: "NOT_FOUND",
    }), { status: 404 }),
  });
  assert.equal(foreign.ok, false);
  if (!foreign.ok) {
    assert.match(foreign.message, /another account/);
    assert.equal(foreign.message.includes("http"), false);
  }

  const offlineSave = await saveCalibratedCandidate({
    jobId,
    token: "owner-session",
    displayName: "Armchair",
    category: null,
    axis: "depth",
    targetM: 0.7,
    fetchImpl: async () => {
      throw new Error("Bearer owner-session failed at https://signed.example/save");
    },
  });
  assert.equal(offlineSave.ok, false);
  if (!offlineSave.ok) {
    assert.equal(offlineSave.errorCode, "NETWORK");
    assert.match(offlineSave.message, /connection/);
    assert.equal(offlineSave.message.includes("owner-session"), false);
    assert.equal(offlineSave.message.includes("http"), false);
  }

  const unsigned = await saveCalibratedCandidate({
    jobId: "not-a-job",
    token: "owner-session",
    displayName: "Armchair",
    category: null,
    axis: "height",
    targetM: 0.85,
    fetchImpl: async () => {
      throw new Error("should not post");
    },
  });
  assert.equal(unsigned.ok, false);
});
