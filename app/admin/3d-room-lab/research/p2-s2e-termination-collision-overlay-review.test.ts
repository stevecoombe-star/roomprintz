import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  P2_S2E_TERMINATION_COLLISION_REVIEW_ROOMS,
  p2S2ETerminationCollisionPointerToSourcePixel,
  p2S2ETerminationCollisionPolyline,
} from "./p2-s2e-termination-collision-overlay-review";
import {
  loadP2S2ETerminationCollisionReviewImage,
  loadP2S2ETerminationCollisionReviewRecord,
} from "./p2-s2e-termination-collision-overlay-review-server";

const RESEARCH_ROOT = path.join(
  process.cwd(),
  "app",
  "admin",
  "3d-room-lab",
  "research"
);

test("P2-S2E viewer loads fresh P2-S2D geometry and policy for A-E", async () => {
  for (const roomId of P2_S2E_TERMINATION_COLLISION_REVIEW_ROOMS) {
    const [loaded, image] = await Promise.all([
      loadP2S2ETerminationCollisionReviewRecord(roomId),
      loadP2S2ETerminationCollisionReviewImage(roomId),
    ]);
    if (!loaded.ok) assert.fail(`${roomId}: ${loaded.code}`);
    if (!image.ok) assert.fail(`${roomId}: ${image.code}`);
    assert.equal(image.sha256, loaded.record.emptyImageSha256);
    assert.equal(loaded.record.geometryAuthority, "certified_p2_s2d_current");
    assert.equal(
      loaded.record.policyVersion,
      "p2-s2e-visible-floor-termination-collision-policy/v1"
    );
    assert.ok(loaded.record.fragments.length > 0);
    assert.equal(loaded.record.policies.length, loaded.record.fragments.length);
    assert.equal(
      loaded.record.diagnostics.fragmentCount,
      loaded.record.fragments.length
    );
    assert.deepEqual(
      loaded.record.policies.map(policy => policy.fragmentId),
      loaded.record.fragments.map(fragment => fragment.id)
    );
  }
});

test("P2-S2E viewer scales source geometry without changing it", async () => {
  const loaded = await loadP2S2ETerminationCollisionReviewRecord("room-e");
  if (!loaded.ok) assert.fail(loaded.code);
  const fragment = loaded.record.fragments[0];
  const before = structuredClone(fragment);
  const pixels = p2S2ETerminationCollisionPolyline(
    fragment,
    loaded.record.dimensions
  );
  assert.deepEqual(pixels, fragment.pointsSourceNormalized.map(point => ({
    x: point.x * loaded.record.dimensions.width,
    y: point.y * loaded.record.dimensions.height,
  })));
  assert.deepEqual(fragment, before);
});

test("P2-S2E viewer maps its cursor to certified source pixels", async () => {
  const loaded = await loadP2S2ETerminationCollisionReviewRecord("room-c");
  if (!loaded.ok) assert.fail(loaded.code);
  assert.deepEqual(
    p2S2ETerminationCollisionPointerToSourcePixel(
      { x: 50, y: 25 },
      { width: 100, height: 50 },
      loaded.record.dimensions
    ),
    {
      x: Math.floor(loaded.record.dimensions.width / 2),
      y: Math.floor(loaded.record.dimensions.height / 2),
    }
  );
});

test("P2-S2E viewer is read-only, guarded, and isolated from forbidden authorities", async () => {
  const researchFiles = [
    "empty-visible-floor-termination-collision-policy.ts",
    "p2-s2e-termination-collision-overlay-review.ts",
    "p2-s2e-termination-collision-overlay-review-server.ts",
    "p2-s2e-termination-collision-overlay-review/page.tsx",
    "p2-s2e-termination-collision-overlay-review/TerminationCollisionOverlayReviewClient.tsx",
  ];
  const sources = await Promise.all(researchFiles.map(file =>
    readFile(path.join(RESEARCH_ROOT, file), "utf8")
  ));
  const apiSource = await readFile(path.join(
    process.cwd(),
    "app/api/admin/3d-room-lab/p2-s2e-termination-collision-overlay-review-image/route.ts"
  ), "utf8");
  const combined = [...sources, apiSource].join("\n");
  assert.doesNotMatch(
    combined,
    /empty-boundary-collision-policy|p2-s2c|P2S2C|P2-S0|empty-to-world-xz-projection|world-XZ|worldXZ|camera|TILED|compositor|physical-room-envelope|placement-constraint|ThreeRoomLab|Gemini|VLM/
  );
  assert.doesNotMatch(combined, /\bproduct\b|oldFragments|oldSourceAuthority/);
  assert.doesNotMatch(combined, /readCertifiedEmptyRegionBoundaryFragments/);
  assert.doesNotMatch(combined, /\b(writeFile|unlink|rename)\b/);
  assert.doesNotMatch(combined, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.match(sources[3], /NODE_ENV === "production"\) notFound\(\)/);
  assert.match(sources[4], /showSource/);
  assert.match(sources[4], /showBlock/);
  assert.match(apiSource, /getAuthenticatedAdminUser/);
  assert.match(apiSource, /nodeEnv === "production"/);
  assert.match(apiSource, /"Cache-Control": "no-store"/);
});
