import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS,
  P2_S2C_COLLISION_OVERLAY_REVIEW_TARGETS,
  p2S2CCollisionOverlayFragmentPolyline,
  p2S2CCollisionOverlayPolicyForFragment,
} from "./p2-s2c-collision-overlay-review";
import {
  loadP2S2CCollisionOverlayReviewImage,
  loadP2S2CCollisionOverlayReviewRecord,
} from "./p2-s2c-collision-overlay-review-server";

const RESEARCH_ROOT = path.join(
  process.cwd(),
  "app",
  "admin",
  "3d-room-lab",
  "research"
);

async function loadedRecord(
  roomId: typeof P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS[number]
) {
  const loaded = await loadP2S2CCollisionOverlayReviewRecord(roomId);
  if (!loaded.ok) assert.fail(`${roomId}: ${loaded.code}`);
  return loaded.record;
}

test("P2-S2C review loads all certified sources with one policy per fragment", async () => {
  const records = await Promise.all(
    P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS.map(loadedRecord)
  );
  for (const record of records) {
    assert.ok(record.fragments.length > 0);
    assert.equal(record.policies.length, record.fragments.length);
    assert.deepEqual(
      record.policies.map(policy => policy.fragmentId),
      record.fragments.map(fragment => fragment.id)
    );
    assert.ok(record.fragments
      .filter(fragment =>
        fragment.boundaryState === "frame_truncated" ||
        fragment.touchesImageFrame
      )
      .every(fragment =>
        p2S2CCollisionOverlayPolicyForFragment(record, fragment.id)
          .collisionPolicy === "pass"
      ));
  }
});

test("P2-S2C review keeps B/D on the exact frozen receipt seals", async () => {
  const [roomB, roomD] = await Promise.all([
    loadedRecord("room-b"),
    loadedRecord("room-d"),
  ]);
  assert.equal(roomB.sourceAuthority, "frozen_p2_s2b_receipt");
  assert.equal(
    roomB.receiptSha256,
    "fbf7f3fafdb1a0eff9ccb0677755c7ceef2d1e08a4016ee6752aa7365bbad15e"
  );
  assert.equal(roomD.sourceAuthority, "frozen_p2_s2b_receipt");
  assert.equal(
    roomD.receiptSha256,
    "fd7673799be656c8cbd1ed910885a97e8e5965afa0af8c79c9e228a31bfc43e2"
  );
});

test("P2-S2C review highlights the required B/C/D human-review fragments", async () => {
  assert.deepEqual(P2_S2C_COLLISION_OVERLAY_REVIEW_TARGETS["room-b"], [
    "0012",
    "0013",
    "0014",
    "0015",
    "0024",
  ]);
  assert.deepEqual(P2_S2C_COLLISION_OVERLAY_REVIEW_TARGETS["room-c"], [
    "0007",
    "0008",
    "0009",
    "0010",
  ]);
  assert.deepEqual(P2_S2C_COLLISION_OVERLAY_REVIEW_TARGETS["room-d"], [
    "0001",
    "0006",
    "0007",
    "0008",
    "0009",
  ]);

  const roomC = await loadedRecord("room-c");
  for (const suffix of ["0007", "0008", "0009", "0010"]) {
    const fragment = roomC.fragments.find(item => item.id.endsWith(`:${suffix}`));
    assert.ok(fragment);
    assert.equal(fragment.boundaryState, "unknown");
  }
  for (const suffix of ["0008", "0009"]) {
    const fragment = roomC.fragments.find(item => item.id.endsWith(`:${suffix}`));
    assert.ok(fragment);
    const policy = p2S2CCollisionOverlayPolicyForFragment(roomC, fragment.id);
    assert.equal(policy.evidenceClass, "observed_floor_termination");
    assert.equal(policy.collisionPolicy, "block");
  }
});

test("P2-S2C review derives display polylines without changing source geometry", async () => {
  const roomB = await loadedRecord("room-b");
  const sourceBefore = structuredClone(roomB.fragments);
  for (const fragment of roomB.fragments) {
    const display = p2S2CCollisionOverlayFragmentPolyline(
      fragment,
      roomB.dimensions
    );
    assert.equal(display.length, fragment.pointsSourceNormalized.length);
    assert.deepEqual(display, fragment.pointsSourceNormalized.map(point => ({
      x: point.x * roomB.dimensions.width,
      y: point.y * roomB.dimensions.height,
    })));
    assert.notDeepEqual(display[0], display.at(-1));
  }
  assert.deepEqual(roomB.fragments, sourceBefore);
});

test("P2-S2C image endpoint authority verifies every certified EMPTY", async () => {
  for (const roomId of P2_S2C_COLLISION_OVERLAY_REVIEW_ROOMS) {
    const [image, record] = await Promise.all([
      loadP2S2CCollisionOverlayReviewImage(roomId),
      loadedRecord(roomId),
    ]);
    if (!image.ok) assert.fail(`${roomId}: ${image.code}`);
    assert.equal(image.sha256, record.emptyImageSha256);
    assert.equal(image.contentType, "image/png");
    assert.ok(image.bytes.byteLength > 0);
  }
});

test("P2-S2C overlay and viewer stay isolated from product authorities", async () => {
  const sources = await Promise.all([
    readFile(path.join(RESEARCH_ROOT, "empty-boundary-collision-policy.ts"), "utf8"),
    readFile(
      path.join(RESEARCH_ROOT, "p2-s2c-collision-overlay-review.ts"),
      "utf8"
    ),
    readFile(
      path.join(RESEARCH_ROOT, "p2-s2c-collision-overlay-review-server.ts"),
      "utf8"
    ),
    readFile(
      path.join(
        RESEARCH_ROOT,
        "p2-s2c-collision-overlay-review",
        "page.tsx"
      ),
      "utf8"
    ),
    readFile(
      path.join(
        RESEARCH_ROOT,
        "p2-s2c-collision-overlay-review",
        "CollisionOverlayReviewClient.tsx"
      ),
      "utf8"
    ),
  ]);
  const combined = sources.join("\n");
  assert.doesNotMatch(
    combined,
    /P2-S0|world-XZ|worldXZ|camera|TILED|compositor|Gemini|physical-room-envelope|placement-constraint|ThreeRoomLab|oracle-authoring/
  );
  assert.doesNotMatch(combined, /\b(writeFile|unlink|rename)\b/);
  assert.doesNotMatch(combined, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
  assert.match(sources[3], /NODE_ENV === "production"\) notFound\(\)/);

  const pureOverlay = sources[0];
  assert.doesNotMatch(
    pureOverlay,
    /node:fs|node:path|sharp|readCertifiedEmptyRegionBoundaryFragments|oracle|projection/
  );
});
