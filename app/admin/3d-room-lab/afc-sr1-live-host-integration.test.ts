import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ThreeRoomLab.tsx", import.meta.url),
  "utf8"
);

function handlerSource(): string {
  const start = source.indexOf("const handleAnalyzeAndApplyLiveAfc");
  const end = source.indexOf(
    "const restorePerspectivePreviewToCommitted",
    start
  );
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test("live AFC host calls only the product route then the existing realization sink", () => {
  const handler = handlerSource();
  assert.match(handler, /\/api\/admin\/3d-room-lab\/afc-sr1\/live-analyze/);
  assert.doesNotMatch(handler, /afc-ui2a|afc-ui2b|certified-control/);
  assert.equal(
    handler.match(/realizeAfcLabGeometry\(\{/g)?.length,
    1,
    "one accepted result enters realization exactly once"
  );
});

test("stale acceptance is immediately before canonical realization", () => {
  const handler = handlerSource();
  const validation = handler.indexOf("validateAfcSr1LiveResultAcceptance");
  const realization = handler.indexOf("realizeAfcLabGeometry({");
  assert.ok(validation >= 0);
  assert.ok(realization > validation);
  assert.doesNotMatch(
    handler.slice(0, validation),
    /applySourceNormalizedFloorPolygon|commitFloorAuthorityMutation/
  );
});

test("image changes and second clicks supersede in-flight AFC", () => {
  const handler = handlerSource();
  assert.match(handler, /afcLiveAbortControllerRef\.current\?\.abort\(\)/);
  assert.match(source, /supersedeAfcLiveAttemptForLoadChange\(\)/);
  assert.match(source, /afcLiveLoadGenerationRef\.current \+= 1/);
  assert.match(source, /afcLiveAttemptIdRef\.current = null/);
  assert.match(source, /afcLabCameraApplyTokenRef\.current \+= 1/);
  assert.match(source, /setPendingAfcLabCameraApply\(null\)/);
  assert.match(source, /setAfcLiveResult\(null\)/);
});

test("an authoritative result is exposed only after stale acceptance", () => {
  const handler = handlerSource();
  const validation = handler.indexOf("validateAfcSr1LiveResultAcceptance");
  const authoritativeResult = handler.indexOf(
    "setAfcLiveResult(result)",
    validation
  );
  assert.ok(validation >= 0);
  assert.ok(authoritativeResult > validation);
  assert.doesNotMatch(
    handler.slice(0, validation),
    /setAfcLiveResult\(result\)[\s\S]*result\.status === "authoritative_geometry"/
  );
});

test("analysis leaves prior calibration and Perspective session untouched", () => {
  const handler = handlerSource();
  const analyzeStart = handler.indexOf(
    'setAfcLiveAnalyzeStatus({ kind: "analyzing", attemptId })'
  );
  const responseRead = handler.indexOf("await response.json()");
  const analyzingSlice = handler.slice(analyzeStart, responseRead);
  assert.doesNotMatch(
    analyzingSlice,
    /invalidatePerspectiveAdjustSession|setFloorMapping|setCameraPoseFovYDeg|deactivateCalibratedCameraMode/
  );
});

test("ambiguous classifier diagnostics render read-only without Floor routing", () => {
  assert.match(source, /diagnostics\.supportedRoomClassifier/);
  assert.match(source, /classifier=\{classifier\.classifierVersion\}/);
  assert.match(source, /point\("NL", semanticFloorPolygon\.NL\)/);
  assert.match(source, /point\("NR", semanticFloorPolygon\.NR\)/);
  assert.match(source, /point\("FR", semanticFloorPolygon\.FR\)/);
  assert.match(source, /point\("FL", semanticFloorPolygon\.FL\)/);
  const diagnosticsStart = source.indexOf("supportedRoomClassifier ? (");
  const diagnosticsEnd = source.indexOf("</div>", diagnosticsStart);
  assert.ok(diagnosticsStart >= 0 && diagnosticsEnd > diagnosticsStart);
  assert.doesNotMatch(
    source.slice(diagnosticsStart, diagnosticsEnd),
    /realizeAfcLabGeometry|applySourceNormalizedFloorPolygon|commitFloorAuthorityMutation/
  );
});

test("live off-axis session owns its immutable result baseline; on-axis suppresses it", () => {
  const handler = handlerSource();
  assert.match(
    handler,
    /rawSourceNormalizedPolygon:\s+result\.geometry\.rawSourceNormalizedPolygon/
  );
  assert.match(handler, /baselineSeamT/);
  assert.match(handler, /adjustableCorner/);
  assert.match(handler, /attemptId: result\.attemptId/);
  assert.match(handler, /resultId: result\.resultId/);
  assert.match(
    handler,
    /result\.photoClass === "on_axis"[\s\S]*invalidatePerspectiveAdjustSession\(\)/
  );

  const perspectiveCommitStart = source.indexOf(
    "const commitPerspectiveAdjust"
  );
  const perspectiveCommitEnd = source.indexOf(
    "const handlePerspectiveAdjustPreviewChange",
    perspectiveCommitStart
  );
  const perspectiveCommit = source.slice(
    perspectiveCommitStart,
    perspectiveCommitEnd
  );
  assert.doesNotMatch(
    perspectiveCommit,
    /ROOM_C_AFC_LAB_GEOMETRY_CANDIDATE/
  );
  assert.match(
    perspectiveCommit,
    /session\.rawSourceNormalizedPolygon/
  );
});

test("existing deferred camera token validation remains the post-Floor gate", () => {
  assert.match(source, /validatePendingAfcLabCameraApply\(pending,/);
  assert.match(
    source,
    /currentToken: afcLabCameraApplyTokenRef\.current/
  );
  assert.match(
    source,
    /applyCalibratedCameraSnapshotFromCandidate\(candidate, pending\.verticalFovDeg\)/
  );
});

test("live panel owns the exact settle failure and replay snapshot", () => {
  assert.match(source, /setAfcLiveSettleFailure\(\{/);
  assert.match(source, /Live AFC settle:/);
  assert.match(source, /Cells evaluated:/);
  assert.match(source, /Best rejected/);
  assert.match(source, /Rejection counts:/);
  assert.match(source, /Replay snapshot/);
  assert.match(source, /AFC settle failed closed: \$\{settle\.reason\}/);
});

test("live Floor read display is current-attempt bound and never routes the diagnostic to Floor Apply", () => {
  assert.match(source, /AfcSr1LiveFloorReadOverlay/);
  assert.match(
    source,
    /afcLiveResult\.attemptId === afcLiveAttemptIdRef\.current/
  );
  assert.match(source, /setAfcLiveSettleFailure\(null\)/);
  const panelStart = source.lastIndexOf("<AfcSr1LiveFloorReadOverlay");
  const panelEnd = source.indexOf("supportedRoomClassifier ? (", panelStart);
  assert.ok(panelStart >= 0 && panelEnd > panelStart);
  assert.doesNotMatch(
    source.slice(panelStart, panelEnd),
    /realizeAfcLabGeometry|applySourceNormalizedFloorPolygon|commitFloorAuthorityMutation/
  );
});

test("dual Floor overlay receives only authoritative final AFC geometry fields", () => {
  assert.match(
    source,
    /polygon:\s+afcLiveResult\.geometry\.sourceNormalizedPolygon/
  );
  assert.match(
    source,
    /fixedAnchor: afcLiveResult\.geometry\.fixedAnchor/
  );
  assert.match(
    source,
    /adjustableCorner:\s+afcLiveResult\.geometry\.adjustableCorner/
  );
  assert.match(
    source,
    /baselineSeamT:\s+afcLiveResult\.geometry\.baselineSeamT/
  );
  const overlayStart = source.lastIndexOf("<AfcSr1LiveFloorReadOverlay");
  const overlayEnd = source.indexOf("originalPreviewUrl=", overlayStart);
  assert.ok(overlayStart >= 0 && overlayEnd > overlayStart);
  assert.doesNotMatch(
    source.slice(overlayStart, overlayEnd),
    /floorMapping|perspectiveAdjustSession|sourceNormalizedFloorPolygon/
  );
});

test("TILED Perspective viewer mounts from reader authority even when Lab settle fails", () => {
  assert.match(source, /AfcTiledPerspectiveDiagnosticViewer/);
  const viewerStart = source.lastIndexOf("<AfcTiledPerspectiveDiagnosticViewer");
  const viewerEnd = source.indexOf(") : afcLiveResult?.diagnostics.floorReadDiagnostic", viewerStart);
  assert.ok(viewerStart >= 0 && viewerEnd > viewerStart);
  const viewer = source.slice(viewerStart - 250, viewerEnd);
  assert.match(viewer, /afcLiveResult\?\.status === "authoritative_geometry"/);
  assert.match(viewer, /afcLiveResult\.geometry\.mode === "tiled-perspective-core"/);
  assert.match(viewer, /key=\{afcLiveResult\.attemptId\}/);
  assert.match(viewer, /roomImageUrl/);
  assert.match(viewer, /perspectiveAdjustSession\.committedDelta/);
  assert.match(viewer, /afcLiveSettleFailure\.settle\.reason === "no_apply_safe_candidate"/);
  assert.doesNotMatch(viewer, /afcLiveAnalyzeStatus\.kind === "completed"/);
});

test("V3 panel distinguishes RAW from CHILD provenance without child overlay", () => {
  assert.match(source, /Authoritative Reader role:/);
  assert.match(source, /RAW V3 Reader/);
  assert.match(source, /CHILD V3 Reader/);
  assert.match(source, /Child horizon is intentionally not drawn over parent EMPTY\./);
  const overlayStart = source.lastIndexOf("<AfcSr1LiveFloorReadOverlay");
  const overlayEnd = source.indexOf("originalPreviewUrl=", overlayStart);
  assert.ok(overlayStart >= 0 && overlayEnd > overlayStart);
  const overlayProps = source.slice(overlayStart, overlayEnd);
  assert.match(overlayProps, /rawV3ReaderDiagnostics/);
  assert.doesNotMatch(overlayProps, /childReader/);
});
