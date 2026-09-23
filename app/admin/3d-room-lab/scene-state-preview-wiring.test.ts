import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const labSource = readFileSync(new URL("./ThreeRoomLab.tsx", import.meta.url), "utf8");
const assemblerSource = readFileSync(
  fileURLToPath(new URL("./scene-state-current-assembly.ts", import.meta.url)),
  "utf8"
);

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

const assemblyCallback = sliceBetween(
  labSource,
  "const assembleCurrentSceneState = useCallback(",
  "const sceneStateJson = useMemo("
);
const previewMemo = sliceBetween(
  labSource,
  "const sceneStateJson = useMemo(",
  "const recordVerticalEvidenceDecision"
);
const copyHandler = sliceBetween(
  labSource,
  "const handleCopySceneJson = async () => {",
  "const handleDownloadSceneJson"
);
const downloadHandler = sliceBetween(
  labSource,
  "const handleDownloadSceneJson = () => {",
  "const handleDownloadAfcCameraFreezeReceipt"
);
const saveHandler = sliceBetween(
  labSource,
  "const handleSaveLocalDraft = () => {",
  "const handleRestoreLocalDraft"
);

const serializedInputs = [
  "roomImageUrl",
  "imageIntrinsicSize",
  "rendererSize",
  "calibratedCameraSnapshot",
  "isCalibratedCameraActive",
  "qualifiedImageBasis",
  "sourceNormalizedFloorPolygon",
  "floorMapping",
  "modelPath",
  "currentActiveObjectType",
  "modelLoadState",
  "modelLoadError",
  "modelNormalization",
  "transform",
  "autoRotateEnabled",
  "floorPolygon",
  "showFloorOverlay",
  "isFloorClickPlacementEnabled",
  "lastAcceptedFloorClick",
  "lastRejectedFloorClick",
  "perspectiveDepthScaling",
  "floorSupportReviewStatus",
  "floorSupportSource",
  "floorSupportImageBasis",
  "floorPolygonAuthorityEligible",
  "wallSupportDrafts",
  "wallSupportImageBases",
  "ceilingSupportDraft",
  "ceilingSupportImageBasis",
  "objectSupportAttachment",
  "verticalEvidence",
  "imageLoadState",
] as const;

test("preview and export actions share one current-scene assembler", () => {
  assert.equal(labSource.includes("buildCurrentSceneStatePayload"), false);
  assert.equal(labSource.split("assembleCurrentSceneStatePayload(").length - 1, 1);
  assert.equal(labSource.split("assembleCurrentSceneState(").length - 1, 4);
  assert.match(assemblyCallback, /assembleCurrentSceneStatePayload\(\{/);
  assert.match(previewMemo, /assembleCurrentSceneState\(sceneStateExportedAt\)/);
  assert.match(copyHandler, /assembleCurrentSceneState\(exportedAtIso\)/);
  assert.match(downloadHandler, /assembleCurrentSceneState\(exportedAtIso\)/);
  assert.match(saveHandler, /assembleCurrentSceneState\(exportedAtIso\)/);
  assert.doesNotMatch(previewMemo, /eslint-disable/);
  assert.doesNotMatch(assemblyCallback, /eslint-disable/);
});

test("preview memo dependencies are the stable assembler and the stored export timestamp", () => {
  assert.match(previewMemo, /\[assembleCurrentSceneState, sceneStateExportedAt\]/);
  assert.match(
    previewMemo,
    /result\.ok\s*\?\s*JSON\.stringify\(result\.payload, null, 2\)\s*:\s*`Scene export unavailable: \$\{result\.reason\}`/
  );
});

test("assembler callback dependencies include every serialized support and scene input", () => {
  const dependencyStart = assemblyCallback.lastIndexOf("\n    [");
  assert.ok(dependencyStart > 0);
  const dependencies = assemblyCallback.slice(dependencyStart);
  for (const name of serializedInputs) {
    assert.match(assemblyCallback, new RegExp(`\\b${name}\\b`));
    assert.match(dependencies, new RegExp(`\\b${name}\\b`));
  }
  assert.doesNotMatch(dependencies, /\bsceneStateExportedAt\b/);
});

test("copy, download, and save keep their previous timestamp and transport behavior", () => {
  assert.match(copyHandler, /const exportedAtIso = new Date\(\)\.toISOString\(\)/);
  assert.match(copyHandler, /setSceneStateExportedAt\(exportedAtIso\)/);
  assert.match(copyHandler, /navigator\.clipboard\.writeText\(jsonText\)/);
  assert.match(copyHandler, /JSON\.stringify\(result\.payload, null, 2\)/);

  assert.match(downloadHandler, /const exportedAtIso = new Date\(\)\.toISOString\(\)/);
  assert.match(downloadHandler, /setSceneStateExportedAt\(exportedAtIso\)/);
  assert.match(downloadHandler, /type: "application\/json"/);
  assert.match(downloadHandler, /anchor\.download = "vibode-3d-room-lab-scene-state\.json"/);
  assert.match(downloadHandler, /JSON\.stringify\(result\.payload, null, 2\)/);

  assert.match(saveHandler, /const exportedAtIso = new Date\(\)\.toISOString\(\)/);
  assert.match(saveHandler, /JSON\.stringify\(result\.payload\)/);
  assert.match(saveHandler, /LOCAL_DRAFT_STORAGE_KEY/);
  assert.match(saveHandler, /setLocalDraftLastSavedAt\(exportedAtIso\)/);
  assert.doesNotMatch(saveHandler, /setSceneStateExportedAt/);
  assert.match(labSource, /const LOCAL_DRAFT_STORAGE_KEY = "vibode:3d-room-lab:scene-state:v0";/);
});

test("current-scene assembler stays a pure function of its argument", () => {
  assert.doesNotMatch(assemblerSource, /\bDate\b/);
  assert.doesNotMatch(assemblerSource, /Math\.random/);
  assert.doesNotMatch(assemblerSource, /localStorage/);
  assert.doesNotMatch(assemblerSource, /useState|useMemo|useCallback|useRef/);
  assert.match(assemblerSource, /export function assembleCurrentSceneStatePayload\(/);
  assert.match(assemblerSource, /return buildSceneStatePayload\(/);
});
