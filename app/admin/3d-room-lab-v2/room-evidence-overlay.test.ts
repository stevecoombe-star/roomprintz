import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const overlaySource = readFileSync(
  path.join(
    process.cwd(),
    "app/admin/3d-room-lab-v2/RoomEvidenceOverlay.tsx",
  ),
  "utf8",
);
const roomLabSource = readFileSync(
  path.join(process.cwd(), "app/admin/3d-room-lab-v2/RoomLabV2.tsx"),
  "utf8",
);
const calibratedViewerSource = readFileSync(
  path.join(
    process.cwd(),
    "app/admin/3d-room-lab-v2/CalibratedRoomViewer.tsx",
  ),
  "utf8",
);

test("cyan authoritative Floor is shown on the TILED authority basis", () => {
  assert.match(overlaySource, /data-evidence-role="authoritative-floor"/);
  assert.match(overlaySource, /rgb\(103, 232, 249\)/);
  assert.match(
    roomLabSource,
    /\{applied \? \([\s\S]*<RoomEvidenceOverlay[\s\S]*floorPolygon=\{applied\.floor\.sourceNormalizedPolygon\}/,
  );
  assert.match(
    roomLabSource,
    /showFloorAuthority=\{[\s\S]*selectedRepresentation === "TILED"/,
  );
  assert.match(calibratedViewerSource, /new THREE\.LineSegments/);
  assert.match(calibratedViewerSource, /color: 0x67e8f9/);
});

test("live S3C defers room-observation overlays during EMPTY migration", () => {
  assert.match(
    roomLabSource,
    /showRoomObservation=\{false\}/,
  );
  assert.doesNotMatch(roomLabSource, /FULLY_TILED/);
  // The read-only renderer remains available for the later EMPTY certification.
  assert.match(overlaySource, /room\.observedPlanes\.map/);
  assert.match(overlaySource, /room\.observedGridFamilies\.flatMap/);
  assert.match(overlaySource, /room\.observedSeams\.map/);
  assert.match(overlaySource, /room\.observedOpenings\.map/);
  assert.match(
    overlaySource,
    /data-evidence-role="diagnostic-room-observation"/,
  );
});

test("overlay distinguishes normalized evidence categories from Floor authority", () => {
  assert.match(overlaySource, /data-plane-category=\{plane\.category\}/);
  assert.match(overlaySource, /data-seam-category=\{seam\.category\}/);
  assert.match(overlaySource, /data-grid-axis=\{family\.axis\}/);
  assert.match(overlaySource, /data-evidence-kind="opening"/);
  assert.match(overlaySource, /data-evidence-role="room-observation-legend"/);
  assert.match(overlaySource, /visible Floor/);
  assert.match(overlaySource, /calibration quad/);
  assert.match(overlaySource, /rgb\(251, 146, 60\)/);
  assert.match(overlaySource, /rgb\(103, 232, 249\)/);
});

test("overlay is a read-only evidence consumer", () => {
  assert.match(overlaySource, /pointer-events-none/);
  assert.doesNotMatch(
    overlaySource,
    /onClick|onChange|setFloor|setCamera|dispatch|evaluateQuadSolvability/,
  );
});
