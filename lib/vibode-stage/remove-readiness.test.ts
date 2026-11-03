import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  editorRoomPath,
  nextRemoveReadinessGenerationId,
  planCleanupAcceptance,
  shouldApplyRemoveAlignmentLookup,
  uploadedRoomUrlSync,
} from "@/lib/vibode-stage/remove-readiness";

const ROOM = "077ef88b-c359-4253-bac3-ffc9efbe3a55";
const OTHER = "96063c22-c76a-485d-b77b-6d74a991c4c2";
const GENERATION = "44b6bbd2-dcf4-4842-a752-efc52202d0eb";
const NEXT_GENERATION = "55b6bbd2-dcf4-4842-a752-efc52202d0eb";
const JOB = "08e11e8a-c3b5-4845-80ef-4a0a25b48e97";
const ASSET = "9b44883f-f7f8-4a2f-9a5d-2d321045e29e";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("upload synchronizes a current room URL and ignores stale or missing ids", () => {
  assert.equal(editorRoomPath(ROOM), `/editor?roomId=${ROOM}`);
  assert.deepEqual(uploadedRoomUrlSync({
    roomId: ` ${ROOM} `,
    uploadSerial: 2,
    activeUploadSerial: 2,
    openSession: 4,
    activeOpenSession: 4,
  }), { roomId: ROOM, path: `/editor?roomId=${ROOM}` });
  assert.equal(uploadedRoomUrlSync({
    roomId: ROOM,
    uploadSerial: 1,
    activeUploadSerial: 2,
    openSession: 4,
    activeOpenSession: 4,
  }), null);
  assert.equal(uploadedRoomUrlSync({
    roomId: ROOM,
    uploadSerial: 2,
    activeUploadSerial: 2,
    openSession: 4,
    activeOpenSession: 5,
  }), null);
  assert.equal(uploadedRoomUrlSync({
    roomId: "  ",
    uploadSerial: 2,
    activeUploadSerial: 2,
    openSession: 4,
    activeOpenSession: 4,
  }), null);
  assert.equal(uploadedRoomUrlSync({
    roomId: null,
    uploadSerial: 2,
    activeUploadSerial: 2,
    openSession: 4,
    activeOpenSession: 4,
  }), null);

  const editor = source("app/editor/page.tsx");
  const upload = editor.slice(
    editor.indexOf("const handleRoomPhotoFile"),
    editor.indexOf("const handleRoomPhotoInputChange"),
  );
  assert.ok(upload.indexOf("uploadedRoomUrlSync") < upload.indexOf("hydratedRoomIdRef.current = sync.roomId"));
  assert.ok(upload.indexOf("hydratedRoomIdRef.current = sync.roomId") < upload.indexOf("router.replace(sync.path)"));
  const failure = upload.slice(upload.lastIndexOf("} catch (err: unknown)"));
  assert.doesNotMatch(failure, /router\.replace/);
  const hydration = editor.slice(
    editor.indexOf("if (hydratedRoomIdRef.current === effectiveRequestedRoomId)"),
    editor.indexOf("const hydrateFromRoom"),
  );
  assert.match(hydration, /return;/);
  assert.doesNotMatch(hydration, /resetWorkflowForIncomingImage/);
});

test("Remove stays disabled until a ready generation and ignores stale lookups", () => {
  assert.equal(nextRemoveReadinessGenerationId({
    phase: "checking",
    generationId: null,
    previous: null,
  }), null);
  assert.equal(nextRemoveReadinessGenerationId({
    phase: "idle",
    generationId: null,
    previous: null,
  }), null);
  assert.equal(nextRemoveReadinessGenerationId({
    phase: "running",
    generationId: null,
    previous: null,
  }), null);
  assert.equal(nextRemoveReadinessGenerationId({
    phase: "ready",
    generationId: GENERATION,
    previous: null,
  }), GENERATION);
  assert.equal(nextRemoveReadinessGenerationId({
    phase: "running",
    generationId: null,
    previous: GENERATION,
  }), GENERATION);
  assert.equal(nextRemoveReadinessGenerationId({
    phase: "ready",
    generationId: NEXT_GENERATION,
    previous: GENERATION,
  }), NEXT_GENERATION);
  assert.equal(nextRemoveReadinessGenerationId({
    phase: "error",
    generationId: null,
    previous: GENERATION,
  }), null);
  assert.equal(nextRemoveReadinessGenerationId({
    phase: "ready",
    generationId: GENERATION,
    previous: GENERATION,
    roomChanged: true,
  }), null);

  assert.equal(shouldApplyRemoveAlignmentLookup({
    requestRoomId: ROOM,
    currentRoomId: ROOM,
    requestSerial: 2,
    currentSerial: 2,
    requestedGenerationId: GENERATION,
    reportGenerationId: null,
    access: "disabled",
  }), true);
  assert.equal(shouldApplyRemoveAlignmentLookup({
    requestRoomId: ROOM,
    currentRoomId: ROOM,
    requestSerial: 2,
    currentSerial: 2,
    requestedGenerationId: GENERATION,
    reportGenerationId: NEXT_GENERATION,
    access: "ready",
  }), false);
  assert.equal(shouldApplyRemoveAlignmentLookup({
    requestRoomId: ROOM,
    currentRoomId: OTHER,
    requestSerial: 2,
    currentSerial: 2,
    requestedGenerationId: GENERATION,
    reportGenerationId: GENERATION,
    access: "ready",
  }), false);
  assert.equal(shouldApplyRemoveAlignmentLookup({
    requestRoomId: ROOM,
    currentRoomId: ROOM,
    requestSerial: 1,
    currentSerial: 2,
    requestedGenerationId: GENERATION,
    reportGenerationId: GENERATION,
    access: "ready",
  }), false);
  assert.equal(shouldApplyRemoveAlignmentLookup({
    requestRoomId: ROOM,
    currentRoomId: ROOM,
    requestSerial: 2,
    currentSerial: 2,
    requestedGenerationId: GENERATION,
    reportGenerationId: GENERATION,
    access: "ready",
  }), true);

  const session = source("components/stage/RemoveAlignmentSession.tsx");
  const shell = source("components/stage/StageEditorShell.tsx");
  const editor = source("app/editor/page.tsx");
  const route = source("app/api/vibode/admin/remove-alignment/route.ts");
  const effect = session.slice(
    session.indexOf("const requestedGenerationId = alignmentGenerationId"),
    session.indexOf("}, [alignmentGenerationId, commitLookup, roomId]"),
  );
  const commit = session.slice(session.indexOf("const commitLookup"), session.indexOf("const refresh = useCallback"));
  assert.match(effect, /commitLookup\(next/);
  assert.match(commit, /shouldApplyRemoveAlignmentLookup/);
  assert.doesNotMatch(effect, /dispatch\(\{ type: "exit" \}\)|saveRemoveEdits/);
  assert.match(shell, /alignmentGenerationId=\{alignmentGenerationId\}/);
  assert.match(editor, /alignmentGenerationId=\{removeReadinessGenerationId\}/);
  assert.match(editor, /nextRemoveReadinessGenerationId/);
  assert.match(route, /assessRemoveAlignment/);
  assert.match(route, /This room has no production-ready AFC generation/);
  const rooms = source("components/my-rooms/MyRoomsPage.tsx");
  assert.match(rooms, /roomId: room\.id/);
  assert.match(rooms, /router\.push\(`\/editor\?\$\{params\.toString\(\)\}`\)/);
});

test("Clean Up acceptance finalizes only after the saved asset activates", () => {
  const refreshed = new Set<string>();
  assert.deepEqual(planCleanupAcceptance({
    responseOk: false,
    activated: false,
    roomId: ROOM,
    jobId: JOB,
    assetId: ASSET,
    refreshedJobIds: refreshed,
  }), { type: "rejected" });
  assert.deepEqual(planCleanupAcceptance({
    responseOk: true,
    activated: true,
    roomId: ROOM,
    jobId: JOB,
    assetId: ASSET,
    refreshedJobIds: refreshed,
  }), { type: "activated-unexpected" });
  assert.deepEqual(planCleanupAcceptance({
    responseOk: true,
    activated: false,
    roomId: ROOM,
    jobId: JOB,
    assetId: "  ",
    refreshedJobIds: refreshed,
  }), { type: "missing-asset" });
  assert.deepEqual(planCleanupAcceptance({
    responseOk: true,
    activated: false,
    roomId: ROOM,
    jobId: JOB,
    assetId: ASSET,
    refreshedJobIds: refreshed,
  }), { type: "accepted", roomId: ROOM, jobId: JOB, assetId: ASSET });
  refreshed.add(JOB);
  assert.deepEqual(planCleanupAcceptance({
    responseOk: true,
    activated: false,
    roomId: ROOM,
    jobId: JOB,
    assetId: ASSET,
    refreshedJobIds: refreshed,
  }), { type: "already-refreshed" });

  const session = source("components/stage/RemoveAlignmentSession.tsx");
  const generation = source("components/stage/RemoveCleanupGeneration.tsx");
  const save = session.slice(session.indexOf("const saveRemoveEdits"), session.indexOf("const value = useMemo"));
  const finalize = session.slice(
    session.indexOf("const finalizeCleanupHistory"),
    session.indexOf("const showSavedCleanupImage"),
  );
  assert.ok(save.indexOf("cleanupFinalizingRef.current || cleanupActivationRef.current") < save.indexOf("fetch("));
  assert.match(save, /\/api\/vibode\/admin\/remove-edits/);
  assert.match(finalize, /await activate\(acceptedRoomId, assetId, stillCurrent\)/);
  assert.ok(finalize.indexOf("await activate(acceptedRoomId, assetId, stillCurrent)") < finalize.indexOf("exit();"));
  assert.equal(finalize.match(/exit\(\);/g)?.length, 1);
  assert.doesNotMatch(finalize, /saveRemoveEdits|remove-edits/);
  const exit = session.slice(session.indexOf("const exit = useCallback"), session.indexOf("exitRef.current = exit"));
  assert.match(exit, /clearCleanupActivation\(\)/);
  assert.match(exit, /dispatch\(\{ type: "exit" \}\)/);
  assert.match(session, /disabled=\{doneBlocked\}/);
  assert.match(session, /data-remove-cleanup-activation="show-saved"/);
  assert.match(session, /onClick=\{session\.exit\}/);
  const footer = session.slice(session.indexOf("function RemoveInspectionFooter"), session.indexOf("function ModeButton"));
  assert.doesNotMatch(footer, /presentation === "simple"|presentation === "advanced"/);
  assert.equal(generation.match(/\/api\/vibode\/admin\/remove-cleanup-jobs\/\$\{job\.jobId\}\/accept/g)?.length, 1);
  assert.doesNotMatch(generation, /saveRemoveEdits|\/api\/vibode\/admin\/remove-edits/);
  assert.match(generation, /CLEANUP_HISTORY_ACTIVATION_ERROR/);
});
