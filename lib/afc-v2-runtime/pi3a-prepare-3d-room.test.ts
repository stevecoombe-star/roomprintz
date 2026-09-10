import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  NO_APPLY_SAFE_CANDIDATE_FAILURE,
  PREPARE_3D_ROOM_ANALYZE_PATH,
  PREPARE_3D_ROOM_FAILURE_MESSAGE,
  PREPARE_3D_ROOM_FIRST_INTENT,
  PREPARE_3D_ROOM_RESTORE_PATH,
  buildAnalyzeRequest,
  canRequestPrepare,
  classifyPrepare3dRetry,
  createInitialPrepare3dRoomState,
  enter3dRoomHref,
  isReadyProductionResponse,
  prepareButtonLabel,
  productionFailureReason,
  reducePrepare3dRoom,
  restoreStatusUrl,
} from "./prepare-3d-room-client";

const ROOT = process.cwd();
const ROOM_ID = "e6466c0a-1a3f-4184-b828-05e943fa1b12";
const OTHER_ROOM_ID = "11111111-1111-4111-8111-111111111111";

function source(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

function idleState() {
  return reducePrepare3dRoom(
    createInitialPrepare3dRoomState(),
    { type: "restore_absent" },
  );
}

function runningFrom(state = idleState()) {
  return reducePrepare3dRoom(state, { type: "prepare_requested" });
}

test("first-ever prepare sends intent analyze", () => {
  const idle = idleState();
  assert.equal(idle.nextIntent, PREPARE_3D_ROOM_FIRST_INTENT);
  assert.equal(idle.nextIntent, "analyze");
  const request = buildAnalyzeRequest(ROOM_ID, idle.nextIntent);
  assert.equal(request.url, PREPARE_3D_ROOM_ANALYZE_PATH);
  assert.equal(request.url, "/api/vibode/afc/analyze");
  assert.equal(request.method, "POST");
  assert.equal(request.body.roomId, ROOM_ID);
  assert.equal(request.body.intent, "analyze");
  assert.notEqual(request.body.roomId, OTHER_ROOM_ID);
});

test("known no_apply_safe_candidate failure classifies as reread_perspective", () => {
  assert.equal(
    classifyPrepare3dRetry(NO_APPLY_SAFE_CANDIDATE_FAILURE),
    "reread_perspective",
  );
  assert.equal(
    classifyPrepare3dRetry("AFC settle failed closed: no_apply_safe_candidate."),
    "reread_perspective",
  );
  assert.equal(
    classifyPrepare3dRetry("  AFC settle failed closed: no_apply_safe_candidate.  "),
    "reread_perspective",
  );
});

test("vague or unrelated failures do not classify as reread_perspective", () => {
  assert.equal(classifyPrepare3dRetry("failed"), "run_again");
  assert.equal(classifyPrepare3dRetry("camera"), "run_again");
  assert.equal(classifyPrepare3dRetry("floor"), "run_again");
  assert.equal(classifyPrepare3dRetry("perspective"), "run_again");
  assert.equal(classifyPrepare3dRetry("AFC analysis failed."), "run_again");
  assert.equal(classifyPrepare3dRetry("ORIGINAL image is unavailable."), "run_again");
  assert.equal(classifyPrepare3dRetry(null), "run_again");
  assert.equal(classifyPrepare3dRetry(undefined), "run_again");
  assert.equal(
    classifyPrepare3dRetry("AFC settle failed closed: no_apply_safe_candidate. extra"),
    "run_again",
  );
});

test("Try Again after no_apply_safe_candidate sends reread_perspective", () => {
  const failed = reducePrepare3dRoom(runningFrom(), {
    type: "prepare_failed",
    failureReason: NO_APPLY_SAFE_CANDIDATE_FAILURE,
  });
  assert.equal(failed.phase, "error");
  assert.equal(failed.nextIntent, "reread_perspective");
  assert.equal(prepareButtonLabel(failed), "Try Again");
  const request = buildAnalyzeRequest(ROOM_ID, failed.nextIntent);
  assert.equal(request.body.intent, "reread_perspective");
  assert.equal(request.body.roomId, ROOM_ID);
});

test("generic non-perspective retry sends run_again", () => {
  const failed = reducePrepare3dRoom(runningFrom(), {
    type: "prepare_failed",
    failureReason: "ORIGINAL image is unavailable.",
  });
  assert.equal(failed.nextIntent, "run_again");
  assert.equal(prepareButtonLabel(failed), "Try Again");
  const request = buildAnalyzeRequest(ROOM_ID, failed.nextIntent);
  assert.equal(request.body.intent, "run_again");
});

test("retry button disables while analysis is in flight and duplicate requests are ignored", () => {
  const idle = idleState();
  assert.equal(canRequestPrepare(idle), true);
  assert.equal(prepareButtonLabel(idle), "Prepare 3D Room");

  const running = runningFrom(idle);
  assert.equal(running.phase, "running");
  assert.equal(running.inFlight, true);
  assert.equal(canRequestPrepare(running), false);
  assert.equal(prepareButtonLabel(running), "Preparing your room…");

  const duplicate = reducePrepare3dRoom(running, { type: "prepare_requested" });
  assert.equal(duplicate, running);
  assert.equal(duplicate.phase, "running");

  const failed = reducePrepare3dRoom(running, {
    type: "prepare_failed",
    failureReason: NO_APPLY_SAFE_CANDIDATE_FAILURE,
  });
  const retrying = runningFrom(failed);
  assert.equal(retrying.phase, "running");
  assert.equal(canRequestPrepare(retrying), false);
  assert.equal(prepareButtonLabel(retrying), "Preparing your room…");
  const duplicateRetry = reducePrepare3dRoom(retrying, { type: "prepare_requested" });
  assert.equal(duplicateRetry, retrying);
});

test("raw AFC failure reason is not rendered in production UI", () => {
  const failed = reducePrepare3dRoom(runningFrom(), {
    type: "prepare_failed",
    failureReason: NO_APPLY_SAFE_CANDIDATE_FAILURE,
  });
  assert.equal(failed.errorMessage, PREPARE_3D_ROOM_FAILURE_MESSAGE);
  assert.equal(failed.errorMessage, "We couldn't prepare this room for 3D.");
  assert.doesNotMatch(failed.errorMessage ?? "", /no_apply_safe_candidate/);
  assert.doesNotMatch(failed.errorMessage ?? "", /EMPTY|TILED|Gemini|Reader|S4/);
  assert.equal(
    productionFailureReason({
      status: "failed",
      failureReason: NO_APPLY_SAFE_CANDIDATE_FAILURE,
    }),
    NO_APPLY_SAFE_CANDIDATE_FAILURE,
  );

  const control = source("components/afc-3d/Prepare3dRoomControl.tsx");
  const markup = control.slice(control.indexOf('data-prepare-3d-room="true"'));
  assert.match(markup, /PREPARE_3D_ROOM_FAILURE_MESSAGE/);
  assert.doesNotMatch(markup, /no_apply_safe_candidate/);
  assert.doesNotMatch(markup, /failureReason/);
  assert.doesNotMatch(markup, /AFC settle failed/);
});

test("successful retry changes UI to Room ready and Enter 3D Room", () => {
  const failed = reducePrepare3dRoom(runningFrom(), {
    type: "prepare_failed",
    failureReason: NO_APPLY_SAFE_CANDIDATE_FAILURE,
  });
  const retrying = runningFrom(failed);
  const ready = reducePrepare3dRoom(retrying, { type: "prepare_succeeded" });
  assert.equal(ready.phase, "ready");
  assert.equal(ready.inFlight, false);
  assert.equal(canRequestPrepare(ready), false);
  assert.equal(prepareButtonLabel(ready), "Prepare 3D Room");
});

test("failed retry remains retryable", () => {
  const firstFail = reducePrepare3dRoom(runningFrom(), {
    type: "prepare_failed",
    failureReason: NO_APPLY_SAFE_CANDIDATE_FAILURE,
  });
  const retrying = runningFrom(firstFail);
  const secondFail = reducePrepare3dRoom(retrying, {
    type: "prepare_failed",
    failureReason: NO_APPLY_SAFE_CANDIDATE_FAILURE,
  });
  assert.equal(secondFail.phase, "error");
  assert.equal(canRequestPrepare(secondFail), true);
  assert.equal(secondFail.nextIntent, "reread_perspective");
  assert.equal(prepareButtonLabel(secondFail), "Try Again");
  const third = runningFrom(secondFail);
  assert.equal(third.phase, "running");
});

test("Enter 3D Room href stays on the same room ID", () => {
  assert.equal(
    enter3dRoomHref(ROOM_ID),
    `/editor/afc-3d?roomId=${ROOM_ID}`,
  );
  assert.equal(
    enter3dRoomHref(OTHER_ROOM_ID),
    `/editor/afc-3d?roomId=${OTHER_ROOM_ID}`,
  );
});

test("restore probe is restore-only and uses the current room ID", () => {
  assert.equal(
    restoreStatusUrl(ROOM_ID),
    `${PREPARE_3D_ROOM_RESTORE_PATH}?roomId=${ROOM_ID}`,
  );
  assert.match(restoreStatusUrl(ROOM_ID), /\/api\/vibode\/afc\/restore/);
  assert.equal(isReadyProductionResponse({
    status: "ready",
    authority: { schemaVersion: "afc-v2-production-room-authority/v1" },
  }), true);
  assert.equal(isReadyProductionResponse({ status: "none", authority: null }), false);
});

test("existing successful generation becomes Enter 3D Room without re-analysis", () => {
  const ready = reducePrepare3dRoom(
    createInitialPrepare3dRoomState(),
    { type: "restore_ready" },
  );
  assert.equal(ready.phase, "ready");
  const ignored = reducePrepare3dRoom(ready, { type: "prepare_requested" });
  assert.equal(ignored, ready);
  assert.equal(canRequestPrepare(ready), false);
});

test("refresh after failure without a ready generation returns to first-ever Prepare 3D Room", () => {
  const failed = reducePrepare3dRoom(runningFrom(), {
    type: "prepare_failed",
    failureReason: NO_APPLY_SAFE_CANDIDATE_FAILURE,
  });
  assert.equal(failed.nextIntent, "reread_perspective");
  const refreshed = reducePrepare3dRoom(failed, { type: "restore_absent" });
  assert.equal(refreshed.phase, "idle");
  assert.equal(refreshed.nextIntent, "analyze");
  assert.equal(prepareButtonLabel(refreshed), "Prepare 3D Room");
});

test("client UI does not import AFC engine, providers, or 2D authority", () => {
  const client = source("lib/afc-v2-runtime/prepare-3d-room-client.ts");
  const retry = source("lib/afc-v2-runtime/prepare-3d-room-retry.ts");
  const control = source("components/afc-3d/Prepare3dRoomControl.tsx");
  const joined = `${client}\n${retry}\n${control}`;
  assert.match(control, /getSupabaseBrowserAccessToken/);
  assert.match(control, /buildAnalyzeRequest/);
  assert.match(control, /state\.nextIntent/);
  assert.match(control, /inFlightRef/);
  assert.match(client, /Preparing your room/);
  assert.match(client, /Try Again/);
  assert.match(control, /Room ready/);
  assert.match(control, /Enter 3D Room/);
  assert.doesNotMatch(joined, /executeAfcV2Analysis/);
  assert.doesNotMatch(joined, /runProductionAfcAnalysis/);
  assert.doesNotMatch(joined, /observeRoom|generateTiled|readTiledPerspective/);
  assert.doesNotMatch(joined, /collisionV1|editorStore|EditorCanvas/);
  assert.doesNotMatch(joined, /app\/admin\/3d-room-lab-v2/);
  assert.doesNotMatch(control, /e6466c0a-1a3f-4184-b828-05e943fa1b12/);
});

test("editor shell mounts the prepare control without giving it editorStore world authority", () => {
  const editor = source("app/editor/page.tsx");
  assert.match(editor, /Prepare3dRoomControl/);
  assert.match(editor, /roomId=\{vibodeRoomId \?\? requestedRoomId\}/);
  const mount = editor.slice(
    editor.indexOf("<Prepare3dRoomControl"),
    editor.indexOf("<Prepare3dRoomControl") + 180,
  );
  assert.doesNotMatch(mount, /useEditorStore/);
  assert.doesNotMatch(mount, /EditorCanvas/);
});

test("PI-2 reread_perspective still reuses durable EMPTY and bypasses durable TILED", () => {
  const adapter = source("lib/afc-v2-production/production-adapter.server.ts");
  assert.match(
    adapter,
    /const forceTiledRegeneration = intent === "reread_perspective"/,
  );
  const emptyBlock = adapter.slice(
    adapter.indexOf("resolveEmpty: async"),
    adapter.indexOf("generateTiled: async"),
  );
  assert.match(emptyBlock, /lookupDurableEmpty/);
  assert.doesNotMatch(emptyBlock, /forceTiledRegeneration/);
  const tiledBlock = adapter.slice(
    adapter.indexOf("generateTiled: async"),
    adapter.indexOf("useTiledArtifactCache"),
  );
  assert.match(tiledBlock, /if \(!forceTiledRegeneration\)/);
  assert.match(tiledBlock, /lookupDurableTiled/);
});
