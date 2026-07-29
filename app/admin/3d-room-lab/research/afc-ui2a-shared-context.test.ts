import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  buildAfcUi2aSharedComparisonContext,
  digestAfcUi2aSharedContext,
} from "./afc-ui2a-shared-context";

const roomA = {
  roomId: "room-a",
  originalSha256: "ca9d77cb4b951ce95ed4fa261b55b288164b07e757dbdf5da565eafefc3439b7",
  originalWidth: 1264,
  originalHeight: 848,
};

test("UI2A package context is canonical, frozen, and Room A stable", async () => {
  const built = buildAfcUi2aSharedComparisonContext(roomA);
  assert.equal(built.ok, true);
  if (!built.ok) return;
  const fixture = JSON.parse(await readFile(path.join(process.cwd(), "app/admin/3d-room-lab/research/fixtures/afc-ui2a-room-a-manifest.v1.json"), "utf8"));
  assert.deepEqual(built.context, fixture.sharedComparisonContext);
  assert.equal(built.context.basisId, "room-a-original-ca9d77cb-source-normalized-v1");
  assert.equal(built.context.normalizationPolicyVersion, "source-normalized/v1");
  assert.equal(digestAfcUi2aSharedContext(built.context), "b340b312674fa17595338426803b2fb7616e17d3f995d66167a813b2eef483a8");
  assert.equal(Object.isFrozen(built.context), true);
  assert.equal(Object.isFrozen(built.context.frameSize), true);
});

test("UI2A package context rejects untrusted malformed identity", () => {
  assert.equal(buildAfcUi2aSharedComparisonContext({ ...roomA, roomId: "Room A" }).ok, false);
  assert.equal(buildAfcUi2aSharedComparisonContext({ ...roomA, originalSha256: "bad" }).ok, false);
  assert.equal(buildAfcUi2aSharedComparisonContext({ ...roomA, originalWidth: 0 }).ok, false);
});
