import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const overlaySource = readFileSync(
  path.join(process.cwd(), "app/admin/3d-room-lab-v2/RoomEvidenceOverlay.tsx"),
  "utf8",
);
const roomLabSource = readFileSync(
  path.join(process.cwd(), "app/admin/3d-room-lab-v2/RoomLabV2.tsx"),
  "utf8",
);
const viewerSource = readFileSync(
  path.join(process.cwd(), "app/admin/3d-room-lab-v2/CalibratedRoomViewer.tsx"),
  "utf8",
);
const analysisSource = readFileSync(
  path.join(process.cwd(), "app/admin/3d-room-lab-v2/afc-v2-analysis.server.ts"),
  "utf8",
);

test("EMPTY overlay shows S4A floor_wall status without recoloring other categories", () => {
  assert.match(overlaySource, /data-boundary-status/);
  assert.match(overlaySource, /data-evidence-role="s4a-room-boundary-status"/);
  assert.match(overlaySource, /SEAM_STROKES\[seam\.category\]/);
  assert.match(overlaySource, /floor_wall: "rgb\(251, 191, 36\)"/);
  assert.match(overlaySource, /wall_ceiling: "rgb\(96, 165, 250\)"/);
  assert.match(roomLabSource, /floorWallBoundaryStatusBySeamId/);
  assert.match(overlaySource, /S4A floor-wall endpoints/);
});

test("ORIGINAL viewer draws accepted finite wall-base diagnostics outside the object layer", () => {
  assert.match(viewerSource, /wallBaseDiagnostics/);
  assert.match(viewerSource, /diagnosticWallBase/);
  assert.match(viewerSource, /objectLayer/);
  assert.match(viewerSource, /wallBaseLayer/);
  assert.match(viewerSource, /raycaster\.intersectObject\(objectLayer, true\)/);
  assert.doesNotMatch(viewerSource, /wallBaseLayer[\s\S]{0,80}objectLayer\.add/);
  assert.match(viewerSource, /diagnosticCollisionWall/);
  assert.doesNotMatch(viewerSource, /collisionWallLayer[\s\S]{0,80}objectLayer\.add/);
  assert.doesNotMatch(viewerSource, /live-collision-blockers|support-attachment|room-envelope-reconciliation/);
  assert.match(
    viewerSource,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot\]\);/,
  );
});

test("Show Collision Boundary does not hide S4A wall-base diagnostics", () => {
  assert.match(
    viewerSource,
    /collisionWallLayer\.visible = showCollisionBoundaryRef\.current/,
  );
  assert.doesNotMatch(
    viewerSource,
    /wallBaseLayer\.visible = showCollisionBoundaryRef\.current/,
  );
  assert.match(
    viewerSource,
    /wallBaseLayer\.visible = showWallBoundaryRef\.current/,
  );
  assert.doesNotMatch(
    roomLabSource,
    /setShowCollisionBoundary\([\s\S]{0,200}wallBaseDiagnostics/,
  );
});

test("Show Wall Boundary hides only S4A wall-base diagnostics and does not rewrite S4A", () => {
  assert.match(roomLabSource, /aria-label="Show Wall Boundary"/);
  assert.match(
    viewerSource,
    /wallBaseLayer\.visible = showWallBoundaryRef\.current/,
  );
  assert.doesNotMatch(
    viewerSource,
    /collisionWallLayer\.visible = showWallBoundaryRef\.current/,
  );
  assert.doesNotMatch(
    roomLabSource,
    /setShowWallBoundary\([\s\S]{0,160}setApplied|setShowWallBoundary\([\s\S]{0,200}constructAfcV2RoomBoundaryAuthority/,
  );
  assert.match(roomLabSource, /wallBaseDiagnostics=\{wallBaseDiagnosticsFromReceipt/);
  assert.match(
    viewerSource,
    /\}, \[floor\.referenceDepthM, floor\.worldWidthM, snapshot\]\);/,
  );
});

test("Room Boundaries inspector receipts S4A without claiming collision authority", () => {
  assert.match(roomLabSource, /Room Boundaries/);
  assert.match(roomLabSource, /collisionAuthority = \{String\(applied\.roomBoundaries\.collisionAuthority\)\}/);
  assert.match(roomLabSource, /EMPTY↔Original/);
  assert.match(roomLabSource, /afc-v2-s4a-room-boundary-authority\.json/);
  assert.doesNotMatch(roomLabSource, /Final world geometry is deferred to V2-S4/);
});

test("S4A is constructed only after freeze and cannot roll back Floor\/Camera", () => {
  assert.match(analysisSource, /constructAfcV2RoomBoundaryAuthority/);
  assert.match(analysisSource, /freezeAppliedTiledAfcCamera/);
  const freezeIndex = analysisSource.indexOf("freezeAppliedTiledAfcCamera");
  const constructIndex = analysisSource.indexOf("constructAfcV2RoomBoundaryAuthority");
  assert.ok(freezeIndex > 0 && constructIndex > freezeIndex);
  assert.match(analysisSource, /status: "applied"/);
  assert.match(analysisSource, /roomBoundaries,/);
  assert.match(analysisSource, /constructAfcV2RoomCollisionAuthority/);
  const s4bIndex = analysisSource.indexOf("constructAfcV2RoomCollisionAuthority");
  assert.ok(s4bIndex > constructIndex);
});
