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
const contractSource = readFileSync(
  path.join(process.cwd(), "app/admin/3d-room-lab-v2/room-collision-authority-contract.ts"),
  "utf8",
);

test("S4A wall-base diagnostics remain distinct from S4B collision diagnostics", () => {
  assert.match(viewerSource, /diagnosticWallBase/);
  assert.match(viewerSource, /diagnosticCollisionWall/);
  assert.match(viewerSource, /color: 0xfbbf24/);
  assert.match(viewerSource, /color: 0xf43f5e/);
  assert.match(viewerSource, /collisionWallLayer/);
  assert.match(viewerSource, /line\.raycast = ignoreRaycast/);
  assert.doesNotMatch(viewerSource, /collisionWallLayer[\s\S]{0,80}objectLayer\.add/);
  assert.match(overlaySource, /data-evidence-role="s4a-room-boundary-status"/);
});

test("Room Boundaries panel keeps S4A and adds S4B collision authority", () => {
  assert.match(roomLabSource, /Room Boundaries/);
  assert.match(
    roomLabSource,
    /collisionAuthority = \{String\(applied\.roomBoundaries\.collisionAuthority\)\}/,
  );
  assert.match(roomLabSource, /Collision Authority/);
  assert.match(
    roomLabSource,
    /collisionAuthority = \{String\(applied\.roomCollision\.collisionAuthority\)\}/,
  );
  assert.match(roomLabSource, /roomCollisionQualificationBasisLabel\(boundary\)/);
  assert.match(contractSource, /two-point region-corroborated/);
  assert.match(contractSource, /two-point region corroboration failed/);
  assert.match(contractSource, /multi-point residual-supported/);
  assert.match(contractSource, /residual-underdetermined region-corroborated/);
  assert.doesNotMatch(roomLabSource, /two-point refused/);
  assert.doesNotMatch(contractSource, /twoPointRejected/);
  assert.match(roomLabSource, /openingsNotSubtracted = true/);
  assert.match(roomLabSource, /verticalExtentUnknown = true/);
  assert.match(
    roomLabSource,
    /Floor-standing objects cannot cross S4B collision-enabled/,
  );
  assert.match(roomLabSource, /Download V2-S4A Room-Boundary authority/);
  assert.match(roomLabSource, /Download V2-S4B Room-Collision authority/);
  assert.match(roomLabSource, /Not implemented/);
});

test("S4B viewer diagnostics do not intercept raycast", () => {
  assert.match(viewerSource, /raycaster\.intersectObject\(objectLayer, true\)/);
  assert.match(viewerSource, /baseLine\.raycast = ignoreRaycast/);
  assert.match(viewerSource, /collisionWallMaterial/);
});
