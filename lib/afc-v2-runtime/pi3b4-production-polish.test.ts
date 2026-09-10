import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  INTEGRATED_3D_LOADING_MESSAGE,
  INTEGRATED_3D_PREPARING_MESSAGE,
  INTEGRATED_3D_RESTORE_ERROR_MESSAGE,
  canEscapeIntegrated3dTo2d,
  createInitialEditorViewportMode,
  integrated3dViewportPresentation,
  integratedAfcRuntimeRestoreInput,
  isEditor3dModeButtonDisabled,
  isIntegrated3dModeBusy,
  sanitizeIntegrated3dRuntimeError,
  shouldAutoPrepareIntegrated3d,
  shouldRestoreIntegratedAfcRuntime,
} from "./editor-viewport-mode";
import {
  createInitialPrepare3dRoomState,
  enter3dRoomHref,
  reducePrepare3dRoom,
  shouldApplyPrepareRoomResponse,
} from "./prepare-3d-room-client";
import { createPi3aAuthority, PI3A_GENERATION_A, PI3A_ROOM_ID } from "./pi3a-test-fixture";
import {
  integratedViewerWorldLifecycleKey,
  productionViewerWorldLifecycleKey,
} from "./viewer-presentation";

const ROOT = process.cwd();
const OTHER_ROOM_ID = "22222222-2222-4222-8222-222222222222";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function twoDButtonSource(modeControl: string): string {
  const start = modeControl.indexOf("aria-label=\"2D\"");
  const threeD = modeControl.indexOf("aria-label=\"3D\"");
  assert.ok(start >= 0 && threeD > start);
  return modeControl.slice(start, threeD);
}

test("PI-3B4 mode control stays local with distinct 2D/3D state and no route navigation", () => {
  const modeControl = source("components/afc-3d/EditorViewportModeControl.tsx");
  const twoDButton = twoDButtonSource(modeControl);

  assert.match(modeControl, /onChange\("2d"\)/);
  assert.match(modeControl, /onChange\("3d"\)/);
  assert.doesNotMatch(modeControl, /Link/);
  assert.doesNotMatch(modeControl, /enter3dRoomHref/);
  assert.doesNotMatch(modeControl, /\/editor\/afc-3d/);
  assert.doesNotMatch(modeControl, /router\./);
  assert.doesNotMatch(twoDButton, /disabled/);
  assert.match(modeControl, /disabled=\{threeDDisabled\}/);
  assert.match(modeControl, /aria-busy=\{busy\}/);
  assert.match(modeControl, /bg-neutral-200 text-neutral-950/);
  assert.match(modeControl, /bg-emerald-800 text-emerald-50/);
  assert.doesNotMatch(modeControl, /AFC|Runtime|Restore|Generation/);

  assert.equal(isEditor3dModeButtonDisabled({ hasRoom: false, busy: false }), true);
  assert.equal(isEditor3dModeButtonDisabled({ hasRoom: true, busy: true }), true);
  assert.equal(isEditor3dModeButtonDisabled({ hasRoom: true, busy: false }), false);
  assert.equal(
    isIntegrated3dModeBusy({
      viewportMode: "2d",
      preparePhase: "running",
      runtimeLoading: true,
    }),
    false,
  );
  assert.equal(
    isIntegrated3dModeBusy({
      viewportMode: "3d",
      preparePhase: "running",
      runtimeLoading: false,
    }),
    true,
  );
  assert.equal(
    isIntegrated3dModeBusy({
      viewportMode: "3d",
      preparePhase: "ready",
      runtimeLoading: true,
    }),
    true,
  );
  assert.equal(
    isIntegrated3dModeBusy({
      viewportMode: "3d",
      preparePhase: "error",
      runtimeLoading: false,
    }),
    false,
  );

  const editor = source("app/editor/page.tsx");
  const modeMount = editor.slice(
    editor.indexOf("<EditorViewportModeControl"),
    editor.indexOf("<EditorViewportModeControl") + 280,
  );
  assert.match(modeMount, /onChange=\{setViewportMode\}/);
  assert.match(modeMount, /busy=\{integrated3dBusy\}/);
  assert.doesNotMatch(modeMount, /href=/);
  assert.doesNotMatch(modeMount, /router\./);
});

test("PI-3B4 user can escape to 2D from restoring, preparing, and error without corrupting prepare", () => {
  assert.equal(canEscapeIntegrated3dTo2d(), true);

  for (const preparePhase of ["checking", "idle", "running", "error", "ready"] as const) {
    assert.equal(
      shouldAutoPrepareIntegrated3d({
        viewportMode: "2d",
        preparePhase,
      }),
      false,
    );
    assert.equal(
      shouldRestoreIntegratedAfcRuntime({
        viewportMode: "2d",
        preparePhase,
      }),
      false,
    );
    assert.equal(
      isIntegrated3dModeBusy({
        viewportMode: "2d",
        preparePhase,
        runtimeLoading: true,
      }),
      false,
    );
  }

  const running = reducePrepare3dRoom(
    reducePrepare3dRoom(createInitialPrepare3dRoomState(), { type: "restore_absent" }),
    { type: "prepare_requested" },
  );
  assert.equal(running.phase, "running");
  const stillRunning = reducePrepare3dRoom(running, { type: "prepare_requested" });
  assert.equal(stillRunning, running);

  const modeControl = source("components/afc-3d/EditorViewportModeControl.tsx");
  assert.doesNotMatch(twoDButtonSource(modeControl), /disabled/);

  const prepareHook = source("lib/afc-v2-runtime/use-prepare-3d-room.ts");
  assert.match(prepareHook, /\[roomId\]/);
  assert.doesNotMatch(prepareHook, /viewportMode/);
  assert.doesNotMatch(prepareHook, /setViewportMode/);

  const editor = source("app/editor/page.tsx");
  const autoPrepare = editor.slice(
    editor.indexOf("shouldAutoPrepareIntegrated3d({"),
    editor.indexOf("[prepare3dPhase, requestPrepare3d, viewportMode]"),
  );
  assert.match(autoPrepare, /viewportMode/);
  assert.doesNotMatch(editor, /usePrepare3dRoom\(editorRoomId, \{\s*enabled/);
});

test("PI-3B4 stale Room A prepare/runtime responses cannot become Room B authority", () => {
  assert.equal(
    shouldApplyPrepareRoomResponse({
      requestRoomId: PI3A_ROOM_ID,
      currentRoomId: PI3A_ROOM_ID,
    }),
    true,
  );
  assert.equal(
    shouldApplyPrepareRoomResponse({
      requestRoomId: PI3A_ROOM_ID,
      currentRoomId: OTHER_ROOM_ID,
    }),
    false,
  );
  assert.equal(
    shouldApplyPrepareRoomResponse({
      requestRoomId: PI3A_ROOM_ID,
      currentRoomId: null,
    }),
    false,
  );

  const prepareHook = source("lib/afc-v2-runtime/use-prepare-3d-room.ts");
  assert.match(prepareHook, /shouldApplyPrepareRoomResponse/);
  assert.match(prepareHook, /roomIdRef/);
  assert.match(prepareHook, /createInitialPrepare3dRoomState\(\)/);
  assert.match(prepareHook, /\[roomId\]/);

  const runtimeHook = source("lib/afc-v2-runtime/use-afc-production-runtime.ts");
  assert.match(runtimeHook, /let cancelled = false/);
  assert.match(runtimeHook, /if \(cancelled\) return/);
  assert.match(runtimeHook, /cancelled = true/);
  assert.match(runtimeHook, /\[enabled, roomId, reloadKey\]/);

  const editor = source("app/editor/page.tsx");
  const roomSwitch = editor.slice(
    editor.indexOf("const previousEditorRoomIdRef"),
    editor.indexOf("usePrepare3dRoom(editorRoomId)"),
  );
  assert.match(roomSwitch, /setViewportMode\(createInitialEditorViewportMode\(\)\)/);
  assert.match(roomSwitch, /setRuntimeTransformMode\("move"\)/);
  assert.doesNotMatch(roomSwitch, /useEffect/);
  assert.equal(createInitialEditorViewportMode(), "2d");
});

test("PI-3B4 History changes do not alter generation, restore, prepare, or transform mode identity", () => {
  const authority = createPi3aAuthority({ generationId: PI3A_GENERATION_A });
  const worldKeyB = integratedViewerWorldLifecycleKey({
    generationId: authority.generationId,
    selectedVersionId: "version-b",
    backgroundImageUrl: "https://images.example.test/b.png",
  });
  const worldKeyC = integratedViewerWorldLifecycleKey({
    generationId: authority.generationId,
    selectedVersionId: "version-c",
    backgroundImageUrl: "https://images.example.test/c.png",
  });
  assert.equal(worldKeyB, worldKeyC);
  assert.equal(worldKeyB, productionViewerWorldLifecycleKey(authority));

  const restore = integratedAfcRuntimeRestoreInput({
    roomId: PI3A_ROOM_ID,
    viewportMode: "3d",
    preparePhase: "ready",
  });
  assert.deepEqual(restore, { roomId: PI3A_ROOM_ID, enabled: true });
  assert.equal("selectedVersionId" in restore, false);

  const editor = source("app/editor/page.tsx");
  const applyVersion = editor.slice(
    editor.indexOf("const applyVersionToEditorState"),
    editor.indexOf("const handleSelectVersion"),
  );
  assert.doesNotMatch(applyVersion, /setViewportMode/);
  assert.doesNotMatch(applyVersion, /setRuntimeTransformMode/);
  assert.doesNotMatch(applyVersion, /setAfcRuntimeReloadKey/);
  assert.match(editor, /setRuntimeTransformMode\("move"\)/);

  const prepareHook = source("lib/afc-v2-runtime/use-prepare-3d-room.ts");
  assert.match(prepareHook, /\[roomId\]/);
  assert.doesNotMatch(prepareHook, /selectedVersionId/);
  assert.doesNotMatch(prepareHook, /activeAssetId/);

  const runtimeHook = source("lib/afc-v2-runtime/use-afc-production-runtime.ts");
  assert.match(runtimeHook, /\[enabled, roomId, reloadKey\]/);
  assert.doesNotMatch(runtimeHook, /selectedVersionId/);
  assert.doesNotMatch(runtimeHook, /activeAssetId/);

  const viewer = source("components/afc-3d/AfcProductionRoomViewer.tsx");
  assert.match(
    viewer,
    /key=\{productionViewerWorldLifecycleKey\(validated\.authority\)\}/,
  );
  assert.match(
    viewer,
    /\}, \[authority\.generationId, furniture\.objectId, furniture\.transform, world\]\);/,
  );
});

test("PI-3B4 diagnostic route remains intact and is not the production 3D entry", () => {
  assert.equal(
    enter3dRoomHref(PI3A_ROOM_ID),
    `/editor/afc-3d?roomId=${PI3A_ROOM_ID}`,
  );

  const diagnosticPage = source("app/editor/afc-3d/page.tsx");
  const diagnosticRuntime = source("components/afc-3d/AfcProductionRuntimePage.tsx");
  const editor = source("app/editor/page.tsx");
  const modeControl = source("components/afc-3d/EditorViewportModeControl.tsx");
  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");

  assert.match(diagnosticPage, /AfcProductionRuntimePage/);
  assert.match(diagnosticRuntime, /useAfcProductionRuntime/);
  assert.match(diagnosticRuntime, /originalImageUrl=\{runtime\.originalImageUrl\}/);
  assert.doesNotMatch(diagnosticRuntime, /backgroundImageUrl=/);
  assert.match(editor, /useAfcProductionRuntime\(editorRoomId/);
  assert.match(editor, /usePrepare3dRoom\(editorRoomId\)/);
  assert.doesNotMatch(editor, /enter3dRoomHref/);
  assert.doesNotMatch(editor, /href=\{enter3dRoomHref/);
  assert.doesNotMatch(modeControl, /\/editor\/afc-3d/);
  assert.doesNotMatch(integrated, /\/editor\/afc-3d/);
  assert.doesNotMatch(integrated, /Enter 3D Room/);
});

test("PI-3B4 restore/prepare/error copy is product language and fail-closed", () => {
  assert.equal(
    integrated3dViewportPresentation({
      preparePhase: "checking",
      runtimeLoading: false,
      runtimeError: null,
      hasAuthority: false,
      hasOriginalImage: false,
    }).message,
    INTEGRATED_3D_LOADING_MESSAGE,
  );
  assert.equal(
    integrated3dViewportPresentation({
      preparePhase: "idle",
      runtimeLoading: false,
      runtimeError: null,
      hasAuthority: false,
      hasOriginalImage: false,
    }).message,
    INTEGRATED_3D_PREPARING_MESSAGE,
  );
  assert.equal(
    integrated3dViewportPresentation({
      preparePhase: "running",
      runtimeLoading: false,
      runtimeError: null,
      hasAuthority: false,
      hasOriginalImage: false,
    }).message,
    INTEGRATED_3D_PREPARING_MESSAGE,
  );
  assert.equal(
    integrated3dViewportPresentation({
      preparePhase: "ready",
      runtimeLoading: true,
      runtimeError: null,
      hasAuthority: false,
      hasOriginalImage: false,
    }).message,
    INTEGRATED_3D_LOADING_MESSAGE,
  );
  assert.equal(
    integrated3dViewportPresentation({
      preparePhase: "ready",
      runtimeLoading: false,
      runtimeError: "Failed to restore AFC runtime.",
      hasAuthority: false,
      hasOriginalImage: false,
    }).surface,
    "restore-error",
  );
  assert.equal(
    sanitizeIntegrated3dRuntimeError("Failed to restore AFC runtime."),
    INTEGRATED_3D_RESTORE_ERROR_MESSAGE,
  );
  assert.equal(
    sanitizeIntegrated3dRuntimeError("This room has no production-ready AFC generation."),
    INTEGRATED_3D_RESTORE_ERROR_MESSAGE,
  );
  assert.equal(
    sanitizeIntegrated3dRuntimeError("Your session expired. Sign in again."),
    "Your session expired. Sign in again.",
  );
  assert.equal(INTEGRATED_3D_LOADING_MESSAGE, "Loading 3D room…");
  assert.equal(INTEGRATED_3D_PREPARING_MESSAGE, "Preparing 3D room…");

  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  assert.match(integrated, /integrated3dViewportPresentation/);
  assert.match(integrated, /Try Again/);
  assert.match(integrated, /onRetryRestore/);
  assert.doesNotMatch(integrated, /This room has no production-ready AFC generation/);
  assert.doesNotMatch(integrated, /generationId/);
  assert.doesNotMatch(integrated, /metricScale/);
  assert.doesNotMatch(integrated, /collision authority/);
  assert.doesNotMatch(integrated, /OrbitControls|collisionV1|DEFAULT_PX_PER_IN/);

  const editor = source("app/editor/page.tsx");
  assert.match(editor, /reloadKey: afcRuntimeReloadKey/);
  assert.match(editor, /onRetryRestore=\{retryIntegratedAfcRestore\}/);
});

test("PI-3B4 3D panel remains concise Move/Rotate owner without extra object tools", () => {
  const panel = source("components/afc-3d/Editor3dModePanel.tsx");
  assert.match(panel, />3D</);
  assert.match(panel, /aria-pressed=\{transformMode === "move"\}/);
  assert.match(panel, /aria-pressed=\{transformMode === "rotate"\}/);
  assert.doesNotMatch(panel, /Scale|Delete|Duplicate|Material|Lighting|GLB/);
  assert.doesNotMatch(panel, /3D MODE/);

  const integrated = source("components/afc-3d/AfcIntegratedEditorViewport.tsx");
  assert.match(integrated, /showInternalControls=\{false\}/);

  const editor = source("app/editor/page.tsx");
  assert.match(editor, /data-editor-right-panel-surface=\{viewportMode === "3d" \? "3d" : "workflow"\}/);
});
