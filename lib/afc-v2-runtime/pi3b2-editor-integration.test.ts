import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createInitialEditorViewportMode,
  editorRightPanelSurface,
  editorViewportShowsAfcRuntime,
  editorViewportShowsCanvas,
  integratedAfcRuntimeRestoreInput,
  shouldAutoPrepareIntegrated3d,
  shouldRestoreIntegratedAfcRuntime,
  afcRuntimeRestoreIdentity,
} from "./editor-viewport-mode";
import {
  AFC_PRODUCTION_RUNTIME_PATH,
  interpretProductionRuntimeResponse,
  runtimeRestoreUrl,
} from "./production-runtime-client";
import {
  createInitialPrepare3dRoomState,
  enter3dRoomHref,
  reducePrepare3dRoom,
} from "./prepare-3d-room-client";
import { createPi3aAuthority, PI3A_ROOM_ID } from "./pi3a-test-fixture";

const ROOT = process.cwd();
const OTHER_ROOM_ID = "22222222-2222-4222-8222-222222222222";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("editor viewport mode is presentation-only 2d|3d and defaults to 2d", () => {
  assert.equal(createInitialEditorViewportMode(), "2d");
  assert.equal(editorViewportShowsCanvas("2d"), true);
  assert.equal(editorViewportShowsAfcRuntime("2d"), false);
  assert.equal(editorViewportShowsCanvas("3d"), false);
  assert.equal(editorViewportShowsAfcRuntime("3d"), true);
  assert.equal(editorRightPanelSurface("2d"), "workflow");
  assert.equal(editorRightPanelSurface("3d"), "3d");
});

test("normal 3D selection does not navigate to the diagnostic route", () => {
  const editor = source("app/editor/page.tsx");
  const modeControl = source("components/afc-3d/EditorViewportModeControl.tsx");
  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  const prepareControl = source("components/afc-3d/Prepare3dRoomControl.tsx");
  const diagnosticPage = source("app/editor/afc-3d/page.tsx");

  assert.match(modeControl, /onChange\("2d"\)/);
  assert.match(modeControl, /onChange\("3d"\)/);
  assert.doesNotMatch(modeControl, /Link/);
  assert.doesNotMatch(modeControl, /enter3dRoomHref/);
  assert.doesNotMatch(modeControl, /\/editor\/afc-3d/);
  assert.doesNotMatch(editor, /enter3dRoomHref/);
  assert.doesNotMatch(editor, /router\.replace\(`\/editor\/afc-3d/);
  assert.doesNotMatch(editor, /href=\{enter3dRoomHref/);
  assert.doesNotMatch(prepareControl, /enter3dRoomHref/);
  assert.doesNotMatch(prepareControl, /\/editor\/afc-3d/);
  assert.doesNotMatch(integrated, /\/editor\/afc-3d/);
  assert.match(diagnosticPage, /AfcProductionRuntimePage/);
  assert.equal(
    enter3dRoomHref(PI3A_ROOM_ID),
    `/editor/afc-3d?roomId=${PI3A_ROOM_ID}`,
  );
});

test("ready 3D selection restores runtime and does not analyze", () => {
  const ready = reducePrepare3dRoom(
    createInitialPrepare3dRoomState(),
    { type: "restore_ready" },
  );
  assert.equal(ready.phase, "ready");
  assert.equal(
    shouldRestoreIntegratedAfcRuntime({
      viewportMode: "3d",
      preparePhase: "ready",
    }),
    true,
  );
  assert.equal(
    shouldAutoPrepareIntegrated3d({
      viewportMode: "3d",
      preparePhase: "ready",
    }),
    false,
  );
  assert.equal(
    shouldRestoreIntegratedAfcRuntime({
      viewportMode: "2d",
      preparePhase: "ready",
    }),
    false,
  );

  const restore = integratedAfcRuntimeRestoreInput({
    roomId: PI3A_ROOM_ID,
    viewportMode: "3d",
    preparePhase: "ready",
  });
  assert.deepEqual(restore, { roomId: PI3A_ROOM_ID, enabled: true });
  assert.equal(runtimeRestoreUrl(PI3A_ROOM_ID), `${AFC_PRODUCTION_RUNTIME_PATH}?roomId=${PI3A_ROOM_ID}`);
  assert.match(runtimeRestoreUrl(PI3A_ROOM_ID), /\/api\/vibode\/afc\/runtime/);
  assert.doesNotMatch(runtimeRestoreUrl(PI3A_ROOM_ID), /\/api\/vibode\/afc\/analyze/);

  const hook = source("lib/afc-v2-runtime/use-afc-production-runtime.ts");
  assert.match(hook, /runtimeRestoreUrl/);
  assert.doesNotMatch(hook, /buildAnalyzeRequest/);
  assert.doesNotMatch(hook, /\/api\/vibode\/afc\/analyze/);

  const editor = source("app/editor/page.tsx");
  assert.match(editor, /shouldRestoreIntegratedAfcRuntime/);
  assert.match(editor, /useAfcProductionRuntime\(editorRoomId/);
  assert.match(editor, /enabled: restoreIntegratedAfcRuntime/);
});

test("absent 3D selection follows the prepare path then enables restore", () => {
  const idle = reducePrepare3dRoom(
    createInitialPrepare3dRoomState(),
    { type: "restore_absent" },
  );
  assert.equal(idle.phase, "idle");
  assert.equal(
    shouldAutoPrepareIntegrated3d({
      viewportMode: "3d",
      preparePhase: "idle",
    }),
    true,
  );
  assert.equal(
    shouldRestoreIntegratedAfcRuntime({
      viewportMode: "3d",
      preparePhase: "idle",
    }),
    false,
  );

  const running = reducePrepare3dRoom(idle, { type: "prepare_requested" });
  assert.equal(
    shouldAutoPrepareIntegrated3d({
      viewportMode: "3d",
      preparePhase: running.phase,
    }),
    false,
  );
  const ready = reducePrepare3dRoom(running, { type: "prepare_succeeded" });
  assert.equal(
    shouldRestoreIntegratedAfcRuntime({
      viewportMode: "3d",
      preparePhase: ready.phase,
    }),
    true,
  );

  const failed = reducePrepare3dRoom(running, { type: "prepare_failed" });
  assert.equal(failed.phase, "error");
  assert.equal(
    shouldAutoPrepareIntegrated3d({
      viewportMode: "3d",
      preparePhase: "error",
    }),
    false,
  );
  assert.equal(
    shouldRestoreIntegratedAfcRuntime({
      viewportMode: "3d",
      preparePhase: "error",
    }),
    false,
  );

  const editor = source("app/editor/page.tsx");
  assert.match(editor, /shouldAutoPrepareIntegrated3d/);
  assert.match(editor, /requestPrepare3d/);
});

test("sibling renderers occupy the viewport exclusively", () => {
  assert.equal(editorViewportShowsCanvas("2d") && editorViewportShowsAfcRuntime("2d"), false);
  assert.equal(editorViewportShowsCanvas("3d") && editorViewportShowsAfcRuntime("3d"), false);

  const editor = source("app/editor/page.tsx");
  assert.match(editor, /viewportMode === "3d" && editorRoomId/);
  assert.match(editor, /<AfcIntegratedEditorViewport/);
  assert.match(editor, /<EditorCanvas/);
  assert.match(editor, /data-editor-viewport-renderer="canvas"/);
  assert.match(editor, /<ImageHistoryTimeline/);

  const historyMount = editor.slice(
    editor.indexOf("<ImageHistoryTimeline"),
    editor.indexOf("<ImageHistoryTimeline") + 400,
  );
  assert.doesNotMatch(historyMount, /viewportMode/);

  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  assert.match(integrated, /<AfcProductionRoomViewer/);
  assert.doesNotMatch(integrated, /EditorCanvas/);
  assert.doesNotMatch(integrated, /editorStore/);
  assert.match(integrated, /originalImageUrl=\{runtime\.originalImageUrl\}/);
  assert.doesNotMatch(integrated, /backgroundImageUrl=/);
  assert.doesNotMatch(integrated, /selectedVersion/);
  assert.doesNotMatch(integrated, /workingImageUrl/);
  assert.doesNotMatch(integrated, /DEFAULT_PX_PER_IN/);
});

test("AFC restore identity is room-only and ignores version and UI mode", () => {
  const identity = afcRuntimeRestoreIdentity(PI3A_ROOM_ID);
  assert.deepEqual(identity, { roomId: PI3A_ROOM_ID });
  assert.notEqual(identity.roomId, OTHER_ROOM_ID);
  assert.equal("activeAssetId" in identity, false);
  assert.equal("selectedVersionId" in identity, false);
  assert.equal("workingImageUrl" in identity, false);
  assert.equal("backgroundImageUrl" in identity, false);
  assert.equal("viewportMode" in identity, false);

  const twoD = integratedAfcRuntimeRestoreInput({
    roomId: PI3A_ROOM_ID,
    viewportMode: "2d",
    preparePhase: "ready",
  });
  const threeD = integratedAfcRuntimeRestoreInput({
    roomId: PI3A_ROOM_ID,
    viewportMode: "3d",
    preparePhase: "ready",
  });
  assert.equal(twoD.roomId, threeD.roomId);
  assert.equal(twoD.enabled, false);
  assert.equal(threeD.enabled, true);

  const hook = source("lib/afc-v2-runtime/use-afc-production-runtime.ts");
  assert.match(hook, /\[enabled, roomId\]/);
  assert.doesNotMatch(hook, /activeAssetId/);
  assert.doesNotMatch(hook, /selectedVersionId/);
  assert.doesNotMatch(hook, /workingImageUrl/);
});

test("shared runtime interpreter is restore-only and reused by diagnostic and editor", () => {
  const authority = createPi3aAuthority();
  const ready = interpretProductionRuntimeResponse({
    ok: true,
    payload: {
      status: "ready",
      generationId: authority.generationId,
      authority,
      originalImageUrl: "https://images.example.test/original.jpg",
    },
  });
  assert.equal(ready.status, "ready");
  if (ready.status !== "ready") return;
  assert.equal(ready.originalImageUrl, "https://images.example.test/original.jpg");
  assert.equal(ready.generationId, authority.generationId);

  const absent = interpretProductionRuntimeResponse({
    ok: true,
    payload: { status: "none", authority: null, currentGenerationId: null },
  });
  assert.equal(absent.status, "error");

  const failedHttp = interpretProductionRuntimeResponse({
    ok: false,
    payload: { error: "Room not found." },
  });
  assert.equal(failedHttp.status, "error");
  if (failedHttp.status !== "error") return;
  assert.equal(failedHttp.message, "Room not found.");

  const diagnostic = source("components/afc-3d/AfcProductionRuntimePage.tsx");
  const editor = source("app/editor/page.tsx");
  assert.match(diagnostic, /useAfcProductionRuntime/);
  assert.match(editor, /useAfcProductionRuntime/);
  assert.doesNotMatch(diagnostic, /buildAnalyzeRequest/);
  assert.doesNotMatch(
    source("lib/afc-v2-runtime/use-afc-production-runtime.ts"),
    /executeAfcV2Analysis/,
  );
});

test("room change resets editor 3D presentation without carrying prior runtime identity", () => {
  const editor = source("app/editor/page.tsx");
  assert.match(editor, /previousEditorRoomIdRef/);
  assert.match(editor, /setViewportMode\(createInitialEditorViewportMode\(\)\)/);
  assert.match(editor, /usePrepare3dRoom\(editorRoomId\)/);
  assert.match(editor, /useAfcProductionRuntime\(editorRoomId/);

  const prepareHook = source("lib/afc-v2-runtime/use-prepare-3d-room.ts");
  assert.match(prepareHook, /createInitialPrepare3dRoomState\(\)/);
  assert.match(prepareHook, /\[roomId\]/);
});

test("integrated 3D panel owns Move/Rotate and hides 2D workflow controls", () => {
  const editor = source("app/editor/page.tsx");
  assert.match(editor, /<Editor3dModePanel/);
  assert.match(editor, /data-editor-right-panel-surface=\{viewportMode === "3d" \? "3d" : "workflow"\}/);

  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  assert.match(integrated, /showInternalControls=\{false\}/);

  const panel = source("components/afc-3d/Editor3dModePanel.tsx");
  assert.match(panel, /3D MODE/);
  assert.match(panel, /Move/);
  assert.match(panel, /Rotate/);
  assert.doesNotMatch(panel, /getWorkflowStepDisplayLabel/);
  assert.doesNotMatch(panel, /SETUP/);

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(viewer, /transformMode\?: RuntimeTransformMode/);
  assert.match(viewer, /showInternalControls\?: boolean/);
  assert.match(viewer, /key=\{productionViewerWorldLifecycleKey\(validated\.authority\)\}/);
});
