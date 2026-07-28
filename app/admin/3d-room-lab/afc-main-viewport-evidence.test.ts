import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";

import {
  AFC_VIEWPORT_CORNER_ORDER,
  DEFAULT_AFC_VIEWPORT_DISPLAY_CONTROLS,
  buildAfcViewportEvidenceSnapshot,
  projectAfcViewportEvidence,
  type AfcViewportEvidenceSnapshot,
} from "./afc-main-viewport-evidence";

const ORIGINAL_SHA = "a".repeat(64);
const EMPTY_SHA = "b".repeat(64);
const ROOM_A_INTRINSIC = { width: 1264, height: 848 };
const FRAME_16_10 = { width: 1600, height: 1000 };

function viewModel() {
  return {
    artifactIdentity: {
      receiptFileName: "room-a-live3.receipt.json",
      receiptSha256: "c".repeat(64),
      requestId: "request-not-published",
      createdAt: "2026-07-28T00:00:00.000Z",
      roomId: "Room A",
      studyMode: "live3",
      imageRole: "empty",
    },
    imageBasis: {
      original: { sha256: ORIGINAL_SHA, width: 1264, height: 848, mimeType: "image/jpeg" },
      emptyRoom: { sha256: EMPTY_SHA, width: 1264, height: 848, mimeType: "image/jpeg", generatedFromOriginalSha256: ORIGINAL_SHA },
    },
    candidate: { r3bCandidateId: "afc-r3b:01", r3cCandidateId: "afc-r3c:empty:afc-r3:fnv1a32:0b43131e#01", coordinateSpace: "source-normalized/v1", semanticOrder: ["NL", "NR", "FR", "FL"] },
    corners: {
      NL: { x: 0, y: 0.98, support: "direct_visible" },
      NR: { x: 1, y: 0.93, support: "direct_visible" },
      FR: { x: 0.69, y: 0.64, support: "direct_visible" },
      FL: { x: 0.36, y: 0.65, support: "direct_visible" },
    },
    raw: { receipt: { filesystemPath: "/private/receipt" }, modelOutput: { provider: "Gemini" } },
    provenance: { provider: { providerId: "Gemini", usageMetadata: { tokens: 1 } } },
  } as never;
}

function snapshot(
  selectedImageRole: "original" | "empty" = "empty",
  display = { ...DEFAULT_AFC_VIEWPORT_DISPLAY_CONTROLS, showInMainViewport: true }
) {
  const result = buildAfcViewportEvidenceSnapshot({
    viewModel: viewModel(),
    status: "valid",
    imageUrl: "/verified-image",
    selectedImageRole,
    display,
  });
  assert.ok(result);
  return result;
}

function approximately(actual: number, expected: number, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
}

test("AFC-UI1B projects Room A with unclamped object-cover coordinates and semantic order", () => {
  const result = projectAfcViewportEvidence(snapshot(), ORIGINAL_SHA, ROOM_A_INTRINSIC, FRAME_16_10);
  assert.equal(result.kind, "projected");
  if (result.kind !== "projected") return;

  assert.deepEqual(result.cornerOrder, AFC_VIEWPORT_CORNER_ORDER);
  approximately(result.corners.NL.x, 0);
  approximately(result.corners.NL.y, 1.015241);
  assert.equal(result.corners.NL.visibleInFrame, false);
  approximately(result.corners.NL.overshootX, 0);
  approximately(result.corners.NL.overshootY, 0.015241);
  approximately(result.corners.NR.x, 1);
  approximately(result.corners.NR.y, 0.961570);
  assert.equal(result.corners.NR.visibleInFrame, true);
  approximately(result.corners.FR.x, 0.69);
  approximately(result.corners.FR.y, 0.650278);
  approximately(result.corners.FL.x, 0.36);
  approximately(result.corners.FL.y, 0.661013);
  assert.equal(result.corners.NR.overshootX, 0);
  assert.equal(result.corners.FR.overshootY, 0);
  assert.equal(result.corners.FL.visibleInFrame, true);
  assert.match(result.polygonPointsAttribute, /^0,101\./);
  assert.ok(!result.polygonPointsAttribute.startsWith("0,100"), "NL must not be clamped to the viewport edge");

  const resized = projectAfcViewportEvidence(snapshot(), ORIGINAL_SHA, ROOM_A_INTRINSIC, { width: 800, height: 500 });
  assert.equal(resized.kind, "projected");
  if (resized.kind === "projected") {
    approximately(resized.corners.NL.y, result.corners.NL.y);
    assert.equal(resized.polygonPointsAttribute, result.polygonPointsAttribute);
  }
});

test("AFC-UI1B exact fingerprint, role, dimension, and fail-closed gates", () => {
  const original = projectAfcViewportEvidence(snapshot("original"), ORIGINAL_SHA, ROOM_A_INTRINSIC, FRAME_16_10);
  assert.equal(original.kind, "projected");
  if (original.kind === "projected") {
    assert.equal(original.matchedRole, "original");
    assert.equal(original.crossRole, false);
  }

  const empty = projectAfcViewportEvidence(snapshot("original"), EMPTY_SHA, ROOM_A_INTRINSIC, FRAME_16_10);
  assert.equal(empty.kind, "projected");
  if (empty.kind === "projected") {
    assert.equal(empty.matchedRole, "empty");
    assert.equal(empty.crossRole, true);
  }

  const cases = [
    [null, ROOM_A_INTRINSIC, FRAME_16_10, "basis_pending"],
    ["z".repeat(64), ROOM_A_INTRINSIC, FRAME_16_10, "basis_mismatch"],
    [ORIGINAL_SHA, null, FRAME_16_10, "intrinsic_dimensions_missing"],
    [ORIGINAL_SHA, { width: 0, height: 848 }, FRAME_16_10, "intrinsic_dimensions_missing"],
    [ORIGINAL_SHA, { width: 1265, height: 848 }, FRAME_16_10, "intrinsic_dimensions_mismatch"],
    [ORIGINAL_SHA, ROOM_A_INTRINSIC, { width: 0, height: 1000 }, "frame_dimensions_invalid"],
  ] as const;
  for (const [fingerprint, intrinsic, frame, reason] of cases) {
    const result = projectAfcViewportEvidence(snapshot(), fingerprint, intrinsic, frame);
    assert.deepEqual(result, { kind: "suppressed", reason });
    assert.equal("corners" in result, false, `${reason} must not leak partial geometry`);
  }

  const disabled = projectAfcViewportEvidence(
    snapshot("empty", { ...DEFAULT_AFC_VIEWPORT_DISPLAY_CONTROLS, showInMainViewport: false }),
    ORIGINAL_SHA,
    ROOM_A_INTRINSIC,
    FRAME_16_10
  );
  assert.deepEqual(disabled, { kind: "suppressed", reason: "display_disabled" });

  const malformed = {
    ...snapshot(),
    corners: { ...snapshot().corners, FR: { ...snapshot().corners.FR, x: Number.NaN } },
  } as unknown as AfcViewportEvidenceSnapshot;
  const failed = projectAfcViewportEvidence(malformed, ORIGINAL_SHA, ROOM_A_INTRINSIC, FRAME_16_10);
  assert.deepEqual(failed, { kind: "suppressed", reason: "projection_failed" });
  assert.equal("polygonPointsAttribute" in failed, false);
});

test("AFC-UI1B snapshot copies and deeply freezes only minimal evidence", () => {
  assert.equal(buildAfcViewportEvidenceSnapshot({
    viewModel: null,
    status: "valid",
    imageUrl: "/verified-image",
    selectedImageRole: "empty",
    display: DEFAULT_AFC_VIEWPORT_DISPLAY_CONTROLS,
  }), null);

  const controls = { ...DEFAULT_AFC_VIEWPORT_DISPLAY_CONTROLS, opacity: 0.25 };
  const result = snapshot("original", controls);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.receipt), true);
  assert.equal(Object.isFrozen(result.images.original), true);
  assert.equal(Object.isFrozen(result.corners.NL), true);
  assert.equal(result.selectedImageRole, "original");
  assert.equal(result.corners.NL.y, 0.98);
  assert.equal(result.display.opacity, 0.25);
  assert.notEqual(result.display, controls);
  assert.deepEqual(result.safety, {
    readOnly: true,
    unapplied: true,
    nonAuthoritative: true,
    notPersisted: true,
  });
  assert.equal("raw" in result, false);
  assert.equal("provenance" in result, false);
  assert.equal("imageUrl" in result, false);
  assert.equal(JSON.stringify(result).includes("filesystemPath"), false);
  assert.equal(JSON.stringify(result).includes("Gemini"), false);
  assert.throws(() => Object.assign(result.corners.NL, { y: 0 }), TypeError);

  assert.equal(buildAfcViewportEvidenceSnapshot({
    viewModel: viewModel(),
    status: "loading",
    imageUrl: null,
    selectedImageRole: "empty",
    display: DEFAULT_AFC_VIEWPORT_DISPLAY_CONTROLS,
  }), null);
});

test("AFC-UI1B structural containment keeps the renderer separate and passive", () => {
  const root = process.cwd();
  const overlay = readFileSync(path.join(root, "app/admin/3d-room-lab/AfcMainViewportEvidenceOverlay.tsx"), "utf8");
  const evidence = readFileSync(path.join(root, "app/admin/3d-room-lab/afc-main-viewport-evidence.ts"), "utf8");
  const lab = readFileSync(path.join(root, "app/admin/3d-room-lab/ThreeRoomLab.tsx"), "utf8");
  const panel = readFileSync(path.join(root, "app/admin/3d-room-lab/AfcProposalOverlayPanel.tsx"), "utf8");
  const sceneState = readFileSync(path.join(root, "app/admin/3d-room-lab/scene-state.ts"), "utf8");
  const scenePanel = readFileSync(path.join(root, "app/admin/3d-room-lab/SceneJsonPanel.tsx"), "utf8");

  assert.match(overlay, /pointer-events-none/);
  assert.match(overlay, /select-none/);
  assert.match(overlay, /aria-hidden="true"/);
  assert.doesNotMatch(overlay, /\bon(?:Pointer|Mouse|Touch|Drag|Key|Wheel)[A-Z]/);
  assert.doesNotMatch(overlay, /\b(?:set[A-Z]|on[A-Z]\w*\s*:)\b/);
  assert.doesNotMatch(evidence, /provider|gemini|afc-r2|compositor|localStorage/i);
  assert.doesNotMatch(overlay, /provider|server-only|floor|camera|scene|localStorage/i);
  assert.doesNotMatch(evidence, /setFloorPolygon|setSourceNormalizedFloorPolygon|applyContainerFloorPolygon|setCalibratedCameraSnapshot/);
  assert.doesNotMatch(panel, /setFloorPolygon|setSourceNormalizedFloorPolygon|applyContainerFloorPolygon|setCalibratedCameraSnapshot/);
  assert.match(lab, /<AfcMainViewportEvidenceOverlay projection=\{afcMainViewportProjection\} \/>/);
  assert.ok(lab.indexOf("floorOverlayRef") < lab.indexOf("<AfcMainViewportEvidenceOverlay"), "AFC overlay mounts after the interactive Floor SVG as a sibling");
  assert.match(lab, /onViewportEvidenceChange=\{setAfcViewportEvidence\}/);
  assert.doesNotMatch(sceneState, /afc-ui1b-viewport-evidence|afcViewportEvidence|AfcViewportEvidence/);
  assert.doesNotMatch(scenePanel, /afc-ui1b-viewport-evidence|afcViewportEvidence|AfcViewportEvidence/);
});
