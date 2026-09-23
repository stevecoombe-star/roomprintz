import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  P2_S2E_TERMINATION_COLLISION_POLICY_VERSION,
  classifyP2S2ETerminationCollisionPolicies,
  classifyP2S2ETerminationCollisionPolicy,
} from "./empty-visible-floor-termination-collision-policy";

test("P2-S2E exposes the certified v1 metadata-only contract", () => {
  assert.equal(
    P2_S2E_TERMINATION_COLLISION_POLICY_VERSION,
    "p2-s2e-visible-floor-termination-collision-policy/v1"
  );
  const record = classifyP2S2ETerminationCollisionPolicy({
    id: "arbitrary-fragment",
  });
  assert.deepEqual(record, {
    fragmentId: "arbitrary-fragment",
    evidenceClass: "observed_floor_termination",
    collisionPolicy: "block",
    policyReasons: ["observed_floor_termination"],
  });
  assert.deepEqual(Object.keys(record).sort(), [
    "collisionPolicy",
    "evidenceClass",
    "fragmentId",
    "policyReasons",
  ]);
  assert.ok(Object.isFrozen(record));
  assert.ok(Object.isFrozen(record.policyReasons));
});

test("P2-S2E emits one ordered block record per existing P2-S2D fragment", () => {
  const fragments = [
    { id: "first-finite-span" },
    { id: "gap-independent-second-span" },
    { id: "last-finite-span" },
  ] as const;
  const records = classifyP2S2ETerminationCollisionPolicies(fragments);
  assert.equal(records.length, fragments.length);
  assert.deepEqual(
    records.map(record => record.fragmentId),
    fragments.map(fragment => fragment.id)
  );
  assert.ok(records.every(record =>
    record.evidenceClass === "observed_floor_termination" &&
    record.collisionPolicy === "block"
  ));
  assert.ok(Object.isFrozen(records));
});

test("P2-S2E cannot mutate, merge, close, or replace source geometry", () => {
  const points = Object.freeze([
    Object.freeze({ x: 0.1, y: 0.7 }),
    Object.freeze({ x: 0.2, y: 0.68 }),
    Object.freeze({ x: 0.3, y: 0.67 }),
  ]);
  const fragments = Object.freeze([
    Object.freeze({
      id: "finite-open-one",
      pointsSourceNormalized: points,
      startEndpoint: Object.freeze({
        state: "uncertain_support_limit",
        pointSourceNormalized: points[0],
      }),
      endEndpoint: Object.freeze({
        state: "uncertain_support_limit",
        pointSourceNormalized: points[2],
      }),
    }),
    Object.freeze({
      id: "finite-open-two",
      pointsSourceNormalized: Object.freeze([
        Object.freeze({ x: 0.7, y: 0.71 }),
        Object.freeze({ x: 0.8, y: 0.73 }),
      ]),
    }),
  ]);
  const before = structuredClone(fragments);
  const firstPointsReference = fragments[0].pointsSourceNormalized;
  const records = classifyP2S2ETerminationCollisionPolicies(fragments);

  assert.deepEqual(fragments, before);
  assert.equal(fragments[0].pointsSourceNormalized, firstPointsReference);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => record.fragmentId), [
    "finite-open-one",
    "finite-open-two",
  ]);
  for (const record of records) {
    assert.equal("pointsSourceNormalized" in record, false);
    assert.equal("startEndpoint" in record, false);
    assert.equal("endEndpoint" in record, false);
    assert.equal("geometryKind" in record, false);
  }
});

test("P2-S2E policy has no room branches, prior-stage gates, or identity vocabulary", async () => {
  const source = await readFile(path.join(
    process.cwd(),
    "app/admin/3d-room-lab/research/empty-visible-floor-termination-collision-policy.ts"
  ), "utf8");
  assert.doesNotMatch(source, /room-[a-e]|boundaryState|physical_wall|verified_wall_contact/);
  assert.doesNotMatch(
    source,
    /outsideFloorLikeFraction|touchesImageFrame|frame_truncated|verification/
  );
  assert.doesNotMatch(source, /\b48\b|\b0\.8\b|\b0\.2\b/);
  assert.doesNotMatch(source, /empty-boundary-collision-policy|physical-room-envelope/);
});
