import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  afcRuntimeRestoreIdentity,
  integratedAfcRuntimeRestoreInput,
  shouldAutoPrepareIntegrated3d,
  shouldRestoreIntegratedAfcRuntime,
} from "./editor-viewport-mode";
import { buildAnalyzeRequest } from "./prepare-3d-room-client";
import { createPi3aAuthority, PI3A_GENERATION_A, PI3A_ROOM_ID } from "./pi3a-test-fixture";
import {
  integratedViewerWorldLifecycleKey,
  productionViewerWorldLifecycleKey,
  resolveIntegratedEditorBackgroundImageUrl,
  resolveViewerBackgroundImageUrl,
} from "./viewer-presentation";

const ROOT = process.cwd();
const ORIGINAL = "https://images.example.test/original.jpg";
const VERSION_B = {
  id: "version-b",
  image_url: "https://images.example.test/decluttered.png",
} as const;
const VERSION_C = {
  id: "version-c",
  image_url: "https://images.example.test/staged.png",
} as const;
const EDITOR_VISUAL = "https://images.example.test/editor-visual.png";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("selected version image is preferred over runtime ORIGINAL for integrated 3D", () => {
  const selected = resolveIntegratedEditorBackgroundImageUrl({
    selectedVersionImageUrl: VERSION_B.image_url,
    editorVisualUrl: EDITOR_VISUAL,
    originalImageUrl: ORIGINAL,
  });
  assert.equal(selected, VERSION_B.image_url);
  assert.notEqual(selected, ORIGINAL);
  assert.equal(
    resolveViewerBackgroundImageUrl({
      backgroundImageUrl: VERSION_B.image_url,
      originalImageUrl: ORIGINAL,
    }),
    VERSION_B.image_url,
  );

  const editor = source("app/editor/page.tsx");
  assert.match(editor, /resolveIntegratedEditorBackgroundImageUrl/);
  assert.match(
    editor,
    /selectedVersionImageUrl: selectedVersion\?\.image_url/,
  );
  assert.match(editor, /editorVisualUrl: workingImageUrl/);
  assert.match(
    editor,
    /backgroundImageUrl=\{integratedViewerBackgroundImageUrl\}/,
  );

  const mount = editor.slice(
    editor.indexOf("<AfcIntegratedEditorViewport"),
    editor.indexOf("<AfcIntegratedEditorViewport") + 700,
  );
  assert.match(mount, /backgroundImageUrl=\{integratedViewerBackgroundImageUrl\}/);
  assert.doesNotMatch(mount, /runtime\.originalImageUrl/);
  assert.doesNotMatch(mount, /canvasImageUrl/);
  assert.doesNotMatch(mount, /activeStageOutputImageUrl/);
  assert.doesNotMatch(mount, /scene\.baseImageUrl/);
  assert.doesNotMatch(mount, /threeActiveVersionId/);
  assert.doesNotMatch(mount, /afcVersionId/);
  assert.doesNotMatch(mount, /viewerVersionId/);
  assert.doesNotMatch(mount, /3dSelectedVersionId/);
});

test("runtime ORIGINAL is presentation fallback only when selected visual is unavailable", () => {
  assert.equal(
    resolveIntegratedEditorBackgroundImageUrl({
      selectedVersionImageUrl: VERSION_B.image_url,
      originalImageUrl: ORIGINAL,
    }),
    VERSION_B.image_url,
  );
  assert.equal(
    resolveIntegratedEditorBackgroundImageUrl({
      selectedVersionImageUrl: "   ",
      editorVisualUrl: EDITOR_VISUAL,
      originalImageUrl: ORIGINAL,
    }),
    EDITOR_VISUAL,
  );
  assert.equal(
    resolveIntegratedEditorBackgroundImageUrl({
      selectedVersionImageUrl: null,
      editorVisualUrl: null,
      originalImageUrl: ORIGINAL,
    }),
    ORIGINAL,
  );
  assert.equal(
    resolveIntegratedEditorBackgroundImageUrl({
      selectedVersionImageUrl: VERSION_C.image_url,
      editorVisualUrl: EDITOR_VISUAL,
      originalImageUrl: ORIGINAL,
    }),
    VERSION_C.image_url,
  );

  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  assert.match(integrated, /backgroundImageUrl=\{backgroundImageUrl\}/);
  assert.match(integrated, /originalImageUrl=\{runtime\.originalImageUrl\}/);
  assert.doesNotMatch(integrated, /selectedVersion/);
  assert.doesNotMatch(integrated, /activeAssetId/);
  assert.doesNotMatch(integrated, /workingImageUrl/);

  const diagnostic = source("components/afc-3d/AfcProductionRuntimePage.tsx");
  assert.match(diagnostic, /originalImageUrl=\{runtime\.originalImageUrl\}/);
  assert.doesNotMatch(diagnostic, /backgroundImageUrl=/);
  assert.doesNotMatch(diagnostic, /selectedVersion/);
});

test("History version change does not change AFC world or restore identity", () => {
  const authority = createPi3aAuthority({ generationId: PI3A_GENERATION_A });
  const worldKeyB = integratedViewerWorldLifecycleKey({
    generationId: authority.generationId,
    selectedVersionId: VERSION_B.id,
    activeAssetId: VERSION_B.id,
    backgroundImageUrl: VERSION_B.image_url,
    originalImageUrl: ORIGINAL,
  });
  const worldKeyC = integratedViewerWorldLifecycleKey({
    generationId: authority.generationId,
    selectedVersionId: VERSION_C.id,
    activeAssetId: VERSION_C.id,
    backgroundImageUrl: VERSION_C.image_url,
    originalImageUrl: ORIGINAL,
  });
  assert.equal(worldKeyB, worldKeyC);
  assert.equal(worldKeyB, productionViewerWorldLifecycleKey(authority));
  assert.notEqual(
    integratedViewerWorldLifecycleKey({
      generationId: "generation-other",
      selectedVersionId: VERSION_B.id,
      backgroundImageUrl: VERSION_B.image_url,
    }),
    worldKeyB,
  );

  const restoreB = afcRuntimeRestoreIdentity(PI3A_ROOM_ID);
  const restoreC = afcRuntimeRestoreIdentity(PI3A_ROOM_ID);
  assert.deepEqual(restoreB, restoreC);
  assert.equal("selectedVersionId" in restoreB, false);
  assert.equal("activeAssetId" in restoreB, false);

  const backgroundB = resolveIntegratedEditorBackgroundImageUrl({
    selectedVersionImageUrl: VERSION_B.image_url,
    originalImageUrl: ORIGINAL,
  });
  const backgroundC = resolveIntegratedEditorBackgroundImageUrl({
    selectedVersionImageUrl: VERSION_C.image_url,
    originalImageUrl: ORIGINAL,
  });
  assert.notEqual(backgroundB, backgroundC);
  assert.equal(worldKeyB, worldKeyC);

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(
    viewer,
    /key=\{productionViewerWorldLifecycleKey\(validated\.authority\)\}/,
  );
  assert.doesNotMatch(viewer, /key=\{[^}]*backgroundImageUrl/);
  assert.doesNotMatch(viewer, /key=\{[^}]*visualImageUrl/);
  assert.doesNotMatch(viewer, /key=\{[^}]*selectedVersion/);
  assert.doesNotMatch(viewer, /key=\{[^}]*activeAssetId/);
  assert.match(
    viewer,
    /\}, \[authority\.generationId, cube\.objectId, cube\.transform, world\]\);/,
  );
  assert.doesNotMatch(
    viewer,
    /\[authority\.generationId, cube\.objectId, cube\.transform, world, visualImageUrl\]/,
  );

  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  assert.doesNotMatch(integrated, /key=\{/);
});

test("production restore hook does not depend on activeAssetId or selected version", () => {
  const hook = source("lib/afc-v2-runtime/use-afc-production-runtime.ts");
  assert.match(hook, /\[enabled, roomId, reloadKey\]/);
  assert.doesNotMatch(hook, /activeAssetId/);
  assert.doesNotMatch(hook, /selectedVersionId/);
  assert.doesNotMatch(hook, /selectedVersion/);
  assert.doesNotMatch(hook, /workingImageUrl/);
  assert.doesNotMatch(hook, /backgroundImageUrl/);
  assert.doesNotMatch(hook, /image_url/);

  const editor = source("app/editor/page.tsx");
  assert.match(editor, /useAfcProductionRuntime\(editorRoomId/);
  assert.match(editor, /enabled: restoreIntegratedAfcRuntime/);
  assert.match(editor, /shouldRestoreIntegratedAfcRuntime/);
  assert.equal(
    shouldRestoreIntegratedAfcRuntime({
      viewportMode: "3d",
      preparePhase: "ready",
    }),
    true,
  );
  const restore = integratedAfcRuntimeRestoreInput({
    roomId: PI3A_ROOM_ID,
    viewportMode: "3d",
    preparePhase: "ready",
  });
  assert.deepEqual(restore, { roomId: PI3A_ROOM_ID, enabled: true });
  assert.equal("activeAssetId" in restore, false);
  assert.equal("selectedVersionId" in restore, false);
  assert.equal("backgroundImageUrl" in restore, false);
});

test("History version change does not trigger AFC prepare or analyze", () => {
  const prepareHook = source("lib/afc-v2-runtime/use-prepare-3d-room.ts");
  assert.match(prepareHook, /\[roomId\]/);
  assert.doesNotMatch(prepareHook, /activeAssetId/);
  assert.doesNotMatch(prepareHook, /selectedVersionId/);
  assert.doesNotMatch(prepareHook, /selectedVersion/);
  assert.doesNotMatch(prepareHook, /workingImageUrl/);
  assert.doesNotMatch(prepareHook, /backgroundImageUrl/);

  const request = buildAnalyzeRequest(PI3A_ROOM_ID, "analyze");
  assert.deepEqual(request.body, { roomId: PI3A_ROOM_ID, intent: "analyze" });
  assert.equal("activeAssetId" in request.body, false);
  assert.equal("selectedVersionId" in request.body, false);
  assert.equal("imageUrl" in request.body, false);

  assert.equal(
    shouldAutoPrepareIntegrated3d({
      viewportMode: "3d",
      preparePhase: "ready",
    }),
    false,
  );
  assert.equal(
    shouldAutoPrepareIntegrated3d({
      viewportMode: "3d",
      preparePhase: "idle",
    }),
    true,
  );

  const editor = source("app/editor/page.tsx");
  assert.match(
    editor,
    /shouldAutoPrepareIntegrated3d\(\{\s*viewportMode,\s*preparePhase: prepare3dPhase,/,
  );
  assert.match(editor, /\[prepare3dPhase, requestPrepare3d, viewportMode\]/);
  const autoPrepareCall = editor.slice(
    editor.indexOf("shouldAutoPrepareIntegrated3d({"),
    editor.indexOf("[prepare3dPhase, requestPrepare3d, viewportMode]") + 50,
  );
  assert.doesNotMatch(autoPrepareCall, /activeAssetId/);
  assert.doesNotMatch(autoPrepareCall, /selectedVersionId/);
});

test("2D and 3D share the same selected version state across mode switches", () => {
  const editor = source("app/editor/page.tsx");
  assert.match(
    editor,
    /const selectedVersionId =\s*activeAssetId \?\? versions\.find\(\(asset\) => asset\.is_active\)\?\.id \?\? null;/,
  );
  assert.match(editor, /activeVersionId=\{selectedVersionId\}/);
  assert.match(editor, /imageUrl=\{canvasImageUrl\}/);
  assert.match(editor, /onChange=\{setViewportMode\}/);
  assert.match(editor, /setWorkingImageUrl\(nextUrl\)/);
  assert.match(editor, /setActiveAssetId\(asset\.id\)/);

  const modeControl = source("components/afc-3d/EditorViewportModeControl.tsx");
  assert.match(modeControl, /onChange\("2d"\)/);
  assert.match(modeControl, /onChange\("3d"\)/);
  assert.doesNotMatch(modeControl, /setActiveAssetId/);
  assert.doesNotMatch(modeControl, /activeAssetId/);
  assert.doesNotMatch(modeControl, /selectedVersion/);

  const applyVersion = editor.slice(
    editor.indexOf("const applyVersionToEditorState"),
    editor.indexOf("const handleSelectVersion"),
  );
  assert.match(applyVersion, /setWorkingImageUrl\(nextUrl\)/);
  assert.match(applyVersion, /setActiveAssetId\(asset\.id\)/);
  assert.doesNotMatch(applyVersion, /setViewportMode/);
  assert.doesNotMatch(applyVersion, /setRuntimeTransformMode/);
  assert.doesNotMatch(applyVersion, /threeActiveVersionId/);
  assert.doesNotMatch(applyVersion, /afcVersionId/);

  const historyMount = editor.slice(
    editor.indexOf("<ImageHistoryTimeline"),
    editor.indexOf("<ImageHistoryTimeline") + 400,
  );
  assert.match(historyMount, /activeVersionId=\{selectedVersionId\}/);
  assert.doesNotMatch(historyMount, /viewportMode/);
  assert.doesNotMatch(editor, /<Editor3dVersionPicker/);
  assert.doesNotMatch(editor, /threeActiveVersionId/);
  assert.doesNotMatch(editor, /afcVersionId/);
  assert.doesNotMatch(editor, /viewerVersionId/);
  assert.doesNotMatch(editor, /3dSelectedVersionId/);
});
