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
    /<RoomEvidenceOverlay[\s\S]*floorPolygon=\{applied\?\.floor\.sourceNormalizedPolygon \?\? \[\]\}/,
  );
  assert.match(
    roomLabSource,
    /showFloorAuthority=\{[\s\S]*selectedRepresentation === "TILED"/,
  );
  assert.match(roomLabSource, /showFloorQuad/);
  assert.match(calibratedViewerSource, /new THREE\.LineSegments/);
  assert.match(calibratedViewerSource, /color: 0x67e8f9/);
  assert.match(calibratedViewerSource, /floorSurface\.visible/);
});

test("live S3D renders room-observation overlays only on EMPTY", () => {
  assert.match(
    roomLabSource,
    /showRoomObservation=\{[\s\S]*selectedRepresentation === "EMPTY"/,
  );
  assert.match(roomLabSource, /Observation overlay/);
  assert.doesNotMatch(roomLabSource, /FULLY_TILED/);
  assert.match(overlaySource, /room\.observedPlanes\.map/);
  assert.match(overlaySource, /room\.observedSeams\.map/);
  assert.match(overlaySource, /room\.observedOpenings\.map/);
  assert.match(overlaySource, /room\.observedJunctions\.map/);
  assert.match(
    overlaySource,
    /data-evidence-role="diagnostic-room-observation"/,
  );
});

test("overlay distinguishes normalized evidence categories from Floor authority", () => {
  assert.match(overlaySource, /data-plane-category=\{plane\.category\}/);
  assert.match(overlaySource, /data-seam-category=\{seam\.category\}/);
  assert.match(
    overlaySource,
    /data-evidence-role="visible-plane-extent-not-seam"/,
  );
  assert.match(
    overlaySource,
    /data-evidence-role="explicit-observed-architectural-seam"/,
  );
  assert.match(overlaySource, /strokeOpacity="0\.45"/);
  assert.match(overlaySource, /faint dashed = plane extent/);
  assert.match(overlaySource, /data-evidence-kind="opening"/);
  assert.match(overlaySource, /data-evidence-kind="junction"/);
  assert.match(overlaySource, /data-evidence-role="room-observation-legend"/);
  assert.match(overlaySource, /EMPTY · observation only/);
  assert.match(overlaySource, /Not Floor or Camera authority/);
  assert.match(overlaySource, /rgb\(251, 146, 60\)/);
  assert.match(overlaySource, /rgb\(103, 232, 249\)/);
});

test("legend is independently toggleable and hidden when overlay is off", () => {
  assert.match(roomLabSource, /Observation overlay/);
  assert.match(roomLabSource, /showRoomObservationLegend/);
  assert.match(
    roomLabSource,
    /const \[showRoomObservationLegend, setShowRoomObservationLegend\] =\s*useState\(true\)/,
  );
  assert.match(
    roomLabSource,
    /showObservationLegend=\{showRoomObservationLegend\}/,
  );
  assert.match(overlaySource, /room && showObservationLegend/);
  assert.doesNotMatch(
    roomLabSource,
    /setPipeline\([\s\S]{0,60}showRoomObservationLegend|setShowRoomObservationLegend[\s\S]{0,80}setPipeline/,
  );
});

test("overlay is a read-only evidence consumer", () => {
  assert.match(overlaySource, /pointer-events-none/);
  assert.doesNotMatch(
    overlaySource,
    /onClick|onChange|setFloor|setCamera|dispatch|evaluateQuadSolvability/,
  );
});

test("Trusted Metric Span is an EMPTY overlay; ORIGINAL keeps localization only", () => {
  assert.match(
    overlaySource,
    /overlaySpace === "empty" &&[\s\S]*metricCorrespondenceEmptyImage/,
  );
  assert.doesNotMatch(
    overlaySource,
    /overlaySpace === "original" &&[\s\S]{0,80}metricCorrespondenceSpan/,
  );
  assert.match(
    overlaySource,
    /overlaySpace === "original" && originalLocalizationStructures/,
  );
  assert.match(roomLabSource, /emptyImageEndpointsFromS4aCandidate/);
  assert.match(
    roomLabSource,
    /selectedRepresentation === "EMPTY"[\s\S]*metricCorrespondenceEmptyImage/,
  );
});
