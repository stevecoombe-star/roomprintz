import assert from "node:assert/strict";
import test from "node:test";

import { loadP2S2ETerminationCollisionReviewRecord } from "./p2-s2e-termination-collision-overlay-review-server";
import { P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS } from "./p2-s2f-world-blocker-overlay-review";
import { loadP2S2FWorldBlockerReviewRecord } from "./p2-s2f-world-blocker-overlay-review-server";

test("A-E source topology remains exact while metric projection is provenance-unavailable", async () => {
  const previous = process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT;
  delete process.env.P2_S2F_ACCEPTED_CAMERA_SNAPSHOT_ROOT;
  try {
    for (const roomId of P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS) {
      const [source, review] = await Promise.all([
        loadP2S2ETerminationCollisionReviewRecord(roomId),
        loadP2S2FWorldBlockerReviewRecord(roomId),
      ]);
      if (!source.ok) assert.fail(`${roomId}: ${source.code}`);
      if (!review.ok) assert.fail(`${roomId}: ${review.code}`);

      assert.deepEqual(review.record.fragments, source.record.fragments);
      assert.deepEqual(review.record.policies, source.record.policies);
      assert.deepEqual(
        review.record.fragments.map(fragment => fragment.id),
        review.record.policies.map(policy => policy.fragmentId)
      );
      assert.equal(review.record.projection.status, "unavailable");
      assert.ok(review.record.diagnostics.every(diagnostic =>
        diagnostic.sourcePointCount > 1 &&
        diagnostic.worldPointCount === 0 &&
        diagnostic.projectionStatus === "unavailable"
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

test("A-E reviewed gaps remain separate records with no synthetic blocker", async () => {
  const loaded = await Promise.all(P2_S2F_WORLD_BLOCKER_REVIEW_ROOMS.map(
    async roomId => {
      const result = await loadP2S2ETerminationCollisionReviewRecord(roomId);
      if (!result.ok) assert.fail(`${roomId}: ${result.code}`);
      return result.record;
    }
  ));
  const byRoom = new Map(loaded.map(record => [record.roomId, record] as const));
  const roomA = byRoom.get("room-a");
  const roomB = byRoom.get("room-b");
  const roomC = byRoom.get("room-c");
  const roomD = byRoom.get("room-d");
  const roomE = byRoom.get("room-e");
  assert.ok(roomA && roomB && roomC && roomD && roomE);

  assert.ok(roomA.fragments.length > 1, "Room A remains multiple finite records");
  assert.ok(roomB.fragments.every(fragment => {
    const xs = fragment.pointsSourceNormalized.map(point => point.x);
    return !(Math.min(...xs) < 0.865 && Math.max(...xs) > 0.875);
  }), "Room B opening remains outside every blocker");
  assert.ok(roomC.fragments.every(fragment =>
    fragment.pointsSourceNormalized.every(point => point.y > 0.55)
  ), "Room C has no upper-radiator fake");
  assert.ok(
    roomD.fragments.reduce(
      (sum, fragment) => sum + fragment.evidence.sourcePixelLength,
      0
    ) > 300,
    "Room D occupied-structure termination stays finite"
  );

  const roomEShortIds = roomE.fragments.map(fragment =>
    fragment.id.split(":").at(-1)
  );
  assert.ok(roomEShortIds.includes("0006"));
  assert.ok(roomEShortIds.includes("0007"));
  assert.notEqual(
    roomE.fragments.find(fragment => fragment.id.endsWith(":0006"))?.id,
    roomE.fragments.find(fragment => fragment.id.endsWith(":0007"))?.id
  );
});
