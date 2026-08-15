import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const labDirectory = path.dirname(fileURLToPath(import.meta.url));
const uiSource = readFileSync(path.join(labDirectory, "ThreeRoomLab.tsx"), "utf8");
const controlSource = readFileSync(path.join(labDirectory, "AfcPerspectiveAdjustControl.tsx"), "utf8");

function between(startMarker: string, endMarker: string): string {
  const start = uiSource.indexOf(startMarker);
  const end = uiSource.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `expected source region ${startMarker} through ${endMarker}`);
  return uiSource.slice(start, end);
}

test("Perspective Adjust renders two surfaces from one shared props/controller binding", () => {
  assert.equal((uiSource.match(/<AfcPerspectiveAdjustControl\b/g) ?? []).length, 2);
  assert.equal((uiSource.match(/\{\.\.\.perspectiveAdjustControlProps\}/g) ?? []).length, 2);
  const sharedProps = between("const perspectiveAdjustControlProps =", "useEffect(() => clearPerspectiveKeyboardCommitTimer");
  for (const sharedBinding of [
    "previewDeltaSeamT:",
    "committedDeltaSeamT:",
    "deltaLimit:",
    "enabled:",
    "pending:",
    "onChange:",
    "onPointerDown:",
    "onPointerUp:",
    "onPointerCancel:",
    "onKeyDown:",
    "onReset:",
  ]) {
    assert.ok(sharedProps.includes(sharedBinding), `shared surface props include ${sharedBinding}`);
  }
});

test("Perspective Adjust presentation owns no independent state or realization dependencies", () => {
  assert.doesNotMatch(controlSource, /useState|useRef|setTimeout/);
  assert.doesNotMatch(controlSource, /afc-fixed-seam-calibration|Floor|floor|camera|solver/);
  assert.match(controlSource, /onPointerDown=\{onPointerDown\}/);
  assert.match(controlSource, /onKeyDown=\{onKeyDown\}/);
  assert.match(controlSource, /onClick=\{onReset\}/);
});

test("both surfaces use the shared keyboard path including PageUp and PageDown", () => {
  const keyboard = between("const handlePerspectiveAdjustKeyDown =", "const handlePerspectiveAdjustReset =");
  assert.match(keyboard, /"PageUp"/);
  assert.match(keyboard, /"PageDown"/);
  assert.match(keyboard, /schedulePerspectiveKeyboardCommit\(\)/);
});

test("pointer, reset, and external Floor installations cancel stale Perspective work", () => {
  const reset = between("const handlePerspectiveAdjustReset =", "const perspectiveAdjustControlProps =");
  assert.match(reset, /clearPerspectiveKeyboardCommitTimer\(\)/);
  const invalidate = between("const invalidatePerspectiveAdjustSession =", "const [calibratedCameraSnapshot");
  assert.match(invalidate, /clearTimeout/);
  assert.match(invalidate, /setPerspectiveAdjustSession\(null\)/);

  const floorUndo = between("const restoreSupportPointUndoSnapshot =", "supportPointUndoKeyboardHandlerRef.current");
  const sceneImport = between("const applyValidatedSceneState =", "const handleApplyImportedSceneJson =");
  const calibrationRestore = between("const projectedRestorePolygon =", "// Provenance compatibility");
  for (const source of [floorUndo, sceneImport, calibrationRestore]) {
    assert.match(source, /invalidatePerspectiveAdjustSession\(\)/);
  }
});

test("a rejected Perspective Floor Apply keeps the existing camera until Floor authority is confirmed", () => {
  const realization = between("const realizeAfcLabGeometry =", "const handleApplyRoomCAfcLab =");
  const floorApply = realization.indexOf("const floorOutcome = applySourceNormalizedFloorPolygon(");
  const expectedAuthority = realization.indexOf("const expectedFloorAuthorityKey =");
  const deactivation = realization.indexOf("deactivateCalibratedCameraMode();", expectedAuthority);
  assert.ok(floorApply >= 0 && expectedAuthority > floorApply && deactivation > expectedAuthority);
  assert.ok(realization.indexOf("deactivateCalibratedCameraMode();") === deactivation);
});

test("failed Perspective realization restores preview from committed geometry", () => {
  const commit = between("const commitPerspectiveAdjust =", "const handlePerspectiveAdjustPreviewChange =");
  assert.match(commit, /if \(!settle\) \{\s*restorePerspectivePreviewToCommitted\(\);/);
  const reset = between("const handlePerspectiveAdjustReset =", "const perspectiveAdjustControlProps =");
  assert.doesNotMatch(reset, /handlePerspectiveAdjustPreviewChange\(0\)/);
  assert.match(reset, /commitPerspectiveAdjust\(0\)/);
});
