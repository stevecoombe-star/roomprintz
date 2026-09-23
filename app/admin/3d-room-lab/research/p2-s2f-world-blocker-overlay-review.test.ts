import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildP2S2FFragmentReviewDiagnostics,
  P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS,
  p2S2FImagePolyline,
  p2S2FWorldPlotViewBox,
} from "./p2-s2f-world-blocker-overlay-review";
import {
  loadP2S2FWorldBlockerReviewImage,
  loadP2S2FWorldBlockerReviewRecord,
} from "./p2-s2f-world-blocker-overlay-review-server";

const RESEARCH_ROOT = path.join(
  process.cwd(),
  "app",
  "admin",
  "3d-room-lab",
  "research"
);

test("viewer loads certified P2-S2D/P2-S2E source for A-E and fails camera provenance visibly", async () => {
  const previous = process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT;
  delete process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT;
  try {
    for (const roomId of P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS) {
      const [loaded, image] = await Promise.all([
        loadP2S2FWorldBlockerReviewRecord(roomId),
        loadP2S2FWorldBlockerReviewImage(roomId),
      ]);
      if (!loaded.ok) assert.fail(`${roomId}: ${loaded.code}`);
      if (!image.ok) assert.fail(`${roomId}: ${image.code}`);
      assert.equal(image.sha256, loaded.record.emptyImageSha256);
      assert.ok(loaded.record.fragments.length > 0);
      assert.equal(loaded.record.policies.length, loaded.record.fragments.length);
      assert.deepEqual(loaded.record.projection, {
        status: "unavailable",
        cameraProvenance: "unavailable",
        reason: "accepted_camera_snapshot_not_configured",
        detail: "P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT is not configured.",
      });
      assert.ok(loaded.record.diagnostics.every(diagnostic =>
        diagnostic.projectionStatus === "unavailable" &&
        diagnostic.worldPointCount === 0 &&
        diagnostic.projectedLengthMeters === null
      ));
    }
  } finally {
    if (typeof previous === "string") {
      process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT = previous;
    } else {
      delete process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT;
    }
  }
});

test("viewer diagnostics preserve zero spacing and sum only consecutive source-order edges", () => {
  const fragments = [{
    id: "f-1",
    pointsSourceNormalized: [{ x: 0.1, y: 0.7 }, { x: 0.9, y: 0.7 }],
  }];
  const diagnostics = buildP2S2FFragmentReviewDiagnostics(
    fragments,
    [{ fragmentId: "f-1", collisionPolicy: "block" }],
    {
      ok: true,
      blockers: [{
        sourceFragmentId: "f-1",
        sourceGeometryVersion: "p2-s2d-visible-floor-contact-localizer/v1",
        sourcePolicyVersion:
          "p2-s2e-visible-floor-termination-collision-policy/v1",
        projectionVersion:
          "p2-s2f-visible-floor-blocker-world-projection/v1",
        coordinateSpace: "calibrated-world-xz/v1",
        geometryKind: "finite_open_blocking_polyline",
        pointsWorldXZ: [
          { x: 0, z: 0 },
          { x: 0, z: 0 },
          { x: 3, z: 4 },
        ],
        startEndpoint: { state: "uncertain_support_limit" },
        endEndpoint: { state: "uncertain_support_limit" },
      }],
      failures: [],
    }
  );

  assert.deepEqual(diagnostics[0], {
    sourceFragmentId: "f-1",
    sourcePointCount: 2,
    worldPointCount: 3,
    projectedLengthMeters: 5,
    minimumConsecutiveSpacingMeters: 0,
    maximumConsecutiveSpacingMeters: 5,
    projectionStatus: "projected",
    failureReason: null,
    failedPointIndex: null,
  });
});

test("viewer image scaling and world view-box helpers do not mutate geometry", async () => {
  const loaded = await loadP2S2FWorldBlockerReviewRecord("room-e");
  if (!loaded.ok) assert.fail(loaded.code);
  const fragment = loaded.record.fragments[0];
  const before = structuredClone(fragment);
  const pixels = p2S2FImagePolyline(fragment, loaded.record.dimensions);
  assert.deepEqual(pixels, fragment.pointsSourceNormalized.map(point => ({
    x: point.x * loaded.record.dimensions.width,
    y: point.y * loaded.record.dimensions.height,
  })));
  assert.deepEqual(fragment, before);

  const view = p2S2FWorldPlotViewBox([{
    sourceFragmentId: "f",
    sourceGeometryVersion: "p2-s2d-visible-floor-contact-localizer/v1",
    sourcePolicyVersion:
      "p2-s2e-visible-floor-termination-collision-policy/v1",
    projectionVersion: "p2-s2f-visible-floor-blocker-world-projection/v1",
    coordinateSpace: "calibrated-world-xz/v1",
    geometryKind: "finite_open_blocking_polyline",
    pointsWorldXZ: [{ x: -5, z: -1 }, { x: 5, z: 1 }],
    startEndpoint: { state: "uncertain_support_limit" },
    endEndpoint: { state: "uncertain_support_limit" },
  }]);
  assert.equal(view.extent, 11.6);
  assert.equal(view.minX, -5.8);
  assert.equal(view.minZ, -5.8);
});

test("viewer is research-only, read-only, and renders open SVG polylines", async () => {
  const researchFiles = [
    "empty-visible-floor-blocker-world-projection.ts",
    "p2-s2f-world-blocker-overlay-review.ts",
    "p2-s2f-world-blocker-overlay-review-server.ts",
    "p2-s2f-world-blocker-overlay-review/page.tsx",
    "p2-s2f-world-blocker-overlay-review/WorldBlockerOverlayReviewClient.tsx",
  ];
  const sources = await Promise.all(researchFiles.map(file =>
    readFile(path.join(RESEARCH_ROOT, file), "utf8")
  ));
  const apiSource = await readFile(path.join(
    process.cwd(),
    "app/api/admin/3d-room-lab/p2-s2f-world-blocker-overlay-review-image/route.ts"
  ), "utf8");
  const combined = [...sources, apiSource].join("\n");

  assert.doesNotMatch(
    combined,
    /tile-floor-reader|ratio-fov-harness|compositor|placement-constraint|physical-room-envelope/
  );
  assert.doesNotMatch(combined, /\b(writeFile|unlink|rename)\b/);
  assert.doesNotMatch(combined, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.doesNotMatch(combined, /projectEmptyPhysicalBoundaryAnnotation/);
  assert.doesNotMatch(combined, /solvePerspective|evaluateFov|new Homography/);
  assert.doesNotMatch(sources[2], /calibrated-camera-restore-authority/);
  assert.match(sources[2], /parseCalibratedCameraFreezeReceipt/);
  assert.match(sources[2], /extractCalibratedCameraAppliedAuthority/);
  assert.match(sources[2], /buildCalibratedReadOnlyProjectionCamera/);
  assert.match(sources[0], /projectEmptyFloorPointToWorldXZ/);
  assert.match(sources[0], /pointsWorldXZ\.push/);
  assert.match(sources[3], /NODE_ENV === "production"\) notFound\(\)/);
  assert.match(sources[4], /<polyline/);
  assert.doesNotMatch(sources[4], /<polygon/);
  assert.doesNotMatch(sources[4], /<button/);
  assert.match(sources[4], /Read-only camera authority/);
  assert.match(sources[4], /Receipt version/);
  assert.match(sources[4], /camera authority unavailable — projection gated/);
  assert.match(
    sources[4],
    /viewBox=\{`\$\{view\.minX\} \$\{view\.minZ\} \$\{view\.extent\} \$\{view\.extent\}`\}/
  );
  assert.match(apiSource, /getAuthenticatedAdminUser/);
  assert.match(apiSource, /"Cache-Control": "no-store"/);
});
