import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  P2_S2D_FLOOR_CONTACT_REVIEW_ROOMS,
  P2_S2D_ROOM_C_REVIEW_NEIGHBORHOODS,
  p2S2DFloorContactPointerToSourcePixel,
  p2S2DFloorContactPolyline,
} from "./p2-s2d-floor-contact-overlay-review";
import {
  loadP2S2DFloorContactReviewImage,
  loadP2S2DFloorContactReviewRecord,
} from "./p2-s2d-floor-contact-overlay-review-server";

const RESEARCH_ROOT = path.join(
  process.cwd(),
  "app",
  "admin",
  "3d-room-lab",
  "research"
);

test("P2-S2D viewer loads old and new A-E geometry from certified EMPTY", async () => {
  for (const roomId of P2_S2D_FLOOR_CONTACT_REVIEW_ROOMS) {
    const [loaded, image] = await Promise.all([
      loadP2S2DFloorContactReviewRecord(roomId),
      loadP2S2DFloorContactReviewImage(roomId),
    ]);
    if (!loaded.ok) assert.fail(`${roomId}: ${loaded.code}`);
    if (!image.ok) assert.fail(`${roomId}: ${image.code}`);
    assert.equal(image.sha256, loaded.record.emptyImageSha256);
    assert.ok(loaded.record.oldFragments.length > 0);
    assert.ok(loaded.record.newFragments.length > 0);
    assert.equal(
      loaded.record.diagnostics.fragmentCount,
      loaded.record.newFragments.length
    );
    assert.equal(
      loaded.record.oldSourceAuthority,
      roomId === "room-b" || roomId === "room-d"
        ? "frozen_p2_s2b_receipt"
        : "certified_p2_s2a_current"
    );
  }
});

test("P2-S2D viewer preserves source geometry and source-pixel cursor mapping", async () => {
  const loaded = await loadP2S2DFloorContactReviewRecord("room-c");
  if (!loaded.ok) assert.fail(loaded.code);
  const fragment = loaded.record.newFragments[0];
  const before = structuredClone(fragment);
  const pixels = p2S2DFloorContactPolyline(
    fragment,
    loaded.record.dimensions
  );
  assert.deepEqual(pixels, fragment.pointsSourceNormalized.map(point => ({
    x: point.x * loaded.record.dimensions.width,
    y: point.y * loaded.record.dimensions.height,
  })));
  assert.deepEqual(fragment, before);
  assert.deepEqual(
    p2S2DFloorContactPointerToSourcePixel(
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

test("P2-S2D viewer declares every required Room C review neighborhood", () => {
  assert.deepEqual(
    P2_S2D_ROOM_C_REVIEW_NEIGHBORHOODS.map(item => item.id),
    ["0000–0002", "0007–0010", "0012–0018", "0021–0023", "0031–0041", "0043"]
  );
});

test("P2-S2D viewer is read-only and isolated from product and policy authorities", async () => {
  const sources = await Promise.all([
    "p2-s2d-floor-contact-overlay-review.ts",
    "p2-s2d-floor-contact-overlay-review-server.ts",
    "p2-s2d-floor-contact-overlay-review/page.tsx",
    "p2-s2d-floor-contact-overlay-review/FloorContactOverlayReviewClient.tsx",
  ].map(file => readFile(path.join(RESEARCH_ROOT, file), "utf8")));
  const combined = sources.join("\n");
  assert.doesNotMatch(
    combined,
    /P2-S0|world-XZ|worldXZ|camera|TILED|\bproduct\b|compositor|collisionEligible|collisionPolicy|P2S2C|p2-s2c/
  );
  assert.doesNotMatch(combined, /\b(writeFile|unlink|rename)\b/);
  assert.doesNotMatch(combined, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.match(sources[2], /NODE_ENV === "production"\) notFound\(\)/);
});
